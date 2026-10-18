import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real preview DOM/CSS with deferred clipboard I/O: deterministic user feedback
// and concurrency checks complement the extension's real-clipboard E2E suite.
const source = await build({ entryPoints: ['src/preview.ts'], bundle: true, write: false, format: 'iife', define: { __TEST__: 'false' } });
const html = (await readFile('public/preview.html', 'utf8'))
  .replace('<link rel="stylesheet" href="preview.css">', `<style>${await readFile('public/preview.css', 'utf8')}</style>`)
  .replace('<script type="module" src="preview.js"></script>', '');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [800, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 650 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html);
    await page.evaluate(() => {
      const decode=window.atob;window.__decodes=0;window.atob=(...args)=>{window.__decodes++;return decode(...args);};
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 8192;
      const data = canvas.toDataURL('image/png');
      window.__writes = [];
      window.chrome = { runtime: { sendMessage: async m => ({ ok: true, data: JSON.stringify(m.index === undefined
        ? { warnings: [], count: 2 } : { index: m.index, chunk: data, width: 800, height: 8192 }) }) } };
      Object.defineProperty(navigator, 'clipboard', { value: { write: () => new Promise((resolve, reject) => window.__writes.push({ resolve, reject })) } });
      window.ClipboardItem = class {}; document.hasFocus = () => true;
    });
    await page.addScriptTag({ content: source.outputFiles[0].text });
    await expect(page.locator('img')).toHaveCount(2);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    assert.equal(await page.evaluate(()=>window.__decodes),2,'decode each PNG only once');
    const buttons = page.locator('.actions button'); const feedback = page.locator('.copy-status').nth(1);
    await expect(buttons.nth(1)).toHaveAccessibleName(/第 2 张/);
    await expect(page.locator('.actions a').nth(1)).toHaveAccessibleName(/第 2 张/);
    await buttons.nth(1).click();
    await expect(feedback).toContainText('正在复制第 2 张');
    const box = await feedback.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 650, 'feedback visible beside current image');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
    await expect(buttons.nth(0)).toBeDisabled(); await expect(buttons.nth(1)).toBeDisabled();
    await buttons.nth(0).dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.__writes.length), 1, 'only one clipboard submission');
    await page.evaluate(() => window.__writes[0].reject(new Error('permission denied')));
    await expect(feedback).toContainText('第 2 张图片复制失败'); await expect(buttons.nth(0)).toBeEnabled();
    await buttons.nth(1).click(); await page.evaluate(() => window.__writes[1].resolve());
    await expect(feedback).toContainText('第 2 张图片已复制'); await expect(buttons.nth(1)).toBeEnabled();
    await buttons.nth(1).click(); await page.locator('#close').click();
    await page.evaluate(() => window.__writes[2].resolve());
    await expect(page.locator('#status')).toHaveText('图片已清除。'); await expect(page.locator('img')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.__decodes),2,'copy/retry reuse the preview Blob');
    assert.deepEqual(errors, []); console.log(`PASS preview feedback/concurrency/retry/clear at ${width}px`);
    await page.close();
  }
 // Cancel while a chunk is in flight; late replies must not recreate images.
  for (const mode of ['clear','pagehide','error']) {
    const page=await browser.newPage();await page.setContent(html);
    await page.evaluate(()=>{
      window.__messages=[];
      window.chrome={runtime:{sendMessage:m=>{__messages.push(m);if(m.type==='preview-release')return Promise.resolve({ok:true});
        if(m.index===undefined)return Promise.resolve({ok:true,data:JSON.stringify({warnings:[],count:3})});
        return new Promise(resolve=>window.__chunk=resolve);
      }}};
    });
    await page.addScriptTag({content:source.outputFiles[0].text});
    await expect.poll(()=>page.evaluate(()=>typeof __chunk)).toBe('function');
    if(mode==='clear')await page.locator('#close').click();
    else if(mode==='pagehide')await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await page.evaluate(()=>__chunk({ok:false,error:'late/cancelled chunk'}));
    await expect.poll(()=>page.evaluate(()=>__messages.filter(m=>m.type==='preview-release').length)).toBe(1);
    await expect(page.locator('img')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>__messages.filter(m=>m.type==='take').length),2,'no next chunk after cancel/error');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(()=>__messages.filter(m=>m.type==='preview-release').length),1,'release once');
    await page.close();
  }
  console.log('PASS preview in-flight clear/pagehide/error releases buffer once and ignores late replies');
} finally { await browser.close(); }
