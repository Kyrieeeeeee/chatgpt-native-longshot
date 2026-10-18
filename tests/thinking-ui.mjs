import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
execFileSync(process.execPath, ['scripts/build.mjs', '--test'], { stdio:'inherit' });
const server = createServer(async (req,res) => {
  try {
    const filename = path.resolve('.' + new URL(req.url,'http://localhost').pathname);
    if (!filename.startsWith(process.cwd()+path.sep)) throw Error('path');
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(await readFile(filename));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(8799,'127.0.0.1',resolve));
const dir = await mkdtemp(path.join(tmpdir(),'thinking-shortcut-'));
let context;
try {
  context = await chromium.launchPersistentContext(dir, { channel:'chromium', headless:true,
    args:[`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = context.pages()[0];
  const notice = page.locator('[data-native-longshot-ui="notice"] .notice');
  async function ready(query='') {
    await page.goto('http://127.0.0.1:8799/tests/thinking-fixture.html?' + query);
    await notice.waitFor({state:'attached'});
    await page.getByRole('textbox').focus();
  }
  async function command() {
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      await chrome.tabs.sendMessage(tab.id, {type:'native-longshot-cycle-thinking'}, {frameId:0});
    });
  }
  async function selected(value) {
    await expect(notice).toHaveText('思考强度已切换：'+value);
    await expect(page.locator('#effort')).toHaveText(value);
    await expect(page.getByRole('textbox')).toBeFocused();
    await expect(page.getByRole('textbox')).toHaveValue('Keep this draft');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  for (const labels of [['Standard','Extended'], ['Light','Standard','Extended','Heavy'], ['Medium','High','Extra High'], ['标准','扩展'], ['中等','高','超高'], ['中','高','超高']]) {
    await ready('levels='+encodeURIComponent(labels.join(',')));
    for (const next of [...labels.slice(1),labels[0]]) { await command(); await selected(next); }
    for (const next of [...labels.slice(1).reverse(),labels[0]]) { await page.keyboard.press('Home'); await selected(next); }
  }
  console.log('PASS: English/Chinese two, three and four level cycling + draft/focus');
  for (const custom of ['', '&custom-slider']) {
    await ready('picker&slider&keyboard-open&levels=低,中,高&selected=1'+custom);
    for (const next of ['高','低','中']) { await page.keyboard.press('End'); await selected(next); }
    for (const next of ['低','高','中']) { await page.keyboard.press('Home'); await selected(next); }
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  console.log('PASS: native/custom thinking slider cycles both ways, wraps both ends without synthetic key recursion');
  await ready('picker&slider&levels=低,中,高&selected=1&no-confirm');
  await page.keyboard.press('End'); await expect(notice).toContainText('页面没有确认');
  await expect(page.locator('#effort')).toHaveText('中');
  console.log('PASS: rejected slider update never reports success');
  await ready('picker&levels=Medium,High,Extra%20High'); await command(); await selected('High');
  console.log('PASS: generic model picker reopens to verify checked level');
  await ready();
  await page.getByRole('textbox').press('Meta+ArrowLeft');
  await page.keyboard.press('End'); // macOS Fn+Right translation
  await selected('Extended');
  expect(await page.getByRole('textbox').evaluate(el => el.selectionStart)).toBe(0);
  await page.keyboard.type('some words');
  await expect(page.getByRole('textbox')).toHaveValue('some wordsKeep this draft');
  console.log('PASS: Fn+Right/End switches inside textarea without changing draft or caret');
  await ready();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
    document.addEventListener('keydown', e => e.stopImmediatePropagation(), true);
  });
  await page.keyboard.press('End'); await selected('Extended');
  console.log('PASS: End works with masked platform and conflicting document key handler');
  await ready();
  await page.keyboard.down('s'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('s');
  await expect(page.locator('#effort')).toHaveText('Standard');
  expect(await page.evaluate(()=>window.fixtureClicks())).toBe(0);
  console.log('PASS: old S+Right shortcut removed');
  for (const position of ['Meta+ArrowLeft', 'ArrowRight']) {
    await ready('rich-editor'); await page.getByRole('textbox').press(position);
    const before = await page.getByRole('textbox').innerHTML();
    await page.keyboard.press('End');
    await expect(notice).toHaveText('思考强度已切换：Extended');
    await expect(page.getByRole('textbox')).toHaveText('Keep this draft');
    expect(await page.getByRole('textbox').innerHTML()).toBe(before);
  }
  console.log('PASS: Fn+Right/End preserves rich editor text and formatting');
  await ready('levels=Light,Standard,Extended,Heavy&disabled=1'); await command(); await selected('Extended');
  await page.keyboard.press('Home'); await selected('Light');
  await page.keyboard.press('Home'); await selected('Heavy');
  console.log('PASS: unavailable levels skipped');
  await ready('delay=250'); await Promise.all([command(),command(),command()]); await expect.poll(()=>page.evaluate(()=>window.fixtureClicks())).toBe(3); await selected('Extended');
  console.log('PASS: three discrete commands during delayed menu make three ordered changes');
  await ready('picker&slider&levels=低,中,高&selected=1&delay=100');
  await page.keyboard.press('End');await page.keyboard.press('End');await page.keyboard.press('Home');
  await expect.poll(()=>page.evaluate(()=>window.fixtureClicks())).toBe(3);await selected('高');
  expect(await page.evaluate(()=>window.fixtureOpens())).toBe(1);
  console.log('PASS: rapid End/End/Home retains each direction and reuses one slider menu');
  await ready('missing'); await command(); await expect(notice).toContainText('未找到思考强度选择器');
  expect(await page.evaluate(()=>window.fixtureClicks())).toBe(0);
  console.log('PASS: no selector does not click conversation content');
  await ready('no-confirm'); await command(); await expect(notice).toContainText('页面没有确认');
  await expect(page.locator('#effort')).toHaveText('Standard');
  console.log('PASS: unconfirmed clicks never report success');
  await page.screenshot({path:'artifacts/thinking-shortcut.png'});
} finally {
  await context?.close(); await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true});
}
