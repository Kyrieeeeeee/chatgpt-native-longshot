import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
execFileSync(process.execPath,['scripts/build.mjs','--test'],{stdio:'inherit'});
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type','text/html');res.end(await readFile('tests/tokens-fixture.html'));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(8799,'127.0.0.1',r));const dir=await mkdtemp(path.join(tmpdir(),'tokens-'));let context;
try{
 context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,colorScheme:'dark',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`]});const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const content='请逐步解释。\n保留公式 \\frac{1}{2} 与 <script> 原文。';
 await worker.evaluate(async content=>chrome.storage.local.set({'nativeLongshot.prompts.v1':[{id:'one',name:'讲解',content,tags:[]},{id:'two',name:'核对',content:'核对每一步。',tags:[]}]}),content);
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:8799'});
 for(const query of ['', '?textarea=1']){
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:8799/tokens'+query);await page.getByRole('button',{name:'提示词',exact:true}).waitFor();const editor=page.getByRole('textbox',{name:'消息'});
  const choose=async()=>{await page.getByRole('option',{name:'讲解',exact:true}).waitFor();await editor.press('Enter');await page.getByRole('button',{name:'提示词胶囊：讲解',exact:true}).waitFor();};
  await editor.fill('前文 /讲解');await choose();expect(await page.evaluate(()=>window.sentTexts)).toEqual([]);if(query)await expect(editor).toHaveValue('前文 ✦ \u00a0讲解');else await expect(editor).toHaveText('前文 ✦ 讲解');
  const chip=page.getByRole('button',{name:'提示词胶囊：讲解',exact:true});const box=await chip.boundingBox();expect(box.height).toBeLessThan(40);await chip.hover();await expect(page.locator('.token-preview')).toContainText(content);
  await page.screenshot({path:`artifacts/prompt-capsule${query?'-textarea':''}.png`});
  await editor.focus();await editor.press('ControlOrMeta+End');await editor.pressSequentially(' 后文');await editor.press('Enter');await expect.poll(()=>page.evaluate(()=>window.sentTexts)).toEqual(['前文 '+content+' 后文']);
  await editor.fill('/讲解');await choose();await editor.focus();await editor.press('ControlOrMeta+End');await editor.press('Backspace');await expect(page.locator('.prompt-token')).toHaveCount(0);await editor.press('ControlOrMeta+z');await expect(page.locator('.prompt-token')).toHaveCount(1);
  // Explicit copy carries the full body; the draft stays a capsule.
  await editor.press('ControlOrMeta+a');await editor.press('ControlOrMeta+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(content);await expect(page.locator('.prompt-token')).toHaveCount(1);
  await editor.press('ArrowRight');await editor.pressSequentially(' /核对');await page.getByRole('option',{name:'核对',exact:true}).waitFor();await editor.press('Tab');await expect(page.locator('.prompt-token')).toHaveCount(2);
  await page.getByRole('button',{name:'发送提示',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sentTexts.at(-1))).toBe(content+' 核对每一步。');
  await editor.fill('/讲解');await choose();await expect.poll(()=>worker.evaluate(async()=>Object.values(await chrome.storage.local.get(null)).filter(x=>x&&typeof x==='object'&&Array.isArray(x.tokens)&&x.tokens.length).length)).toBeGreaterThan(0);
  await page.reload();await expect(page.locator('.prompt-token')).toHaveCount(1);await page.getByRole('button',{name:'发送提示',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sentTexts)).toEqual([content]);
  if(!query){await editor.fill('/讲解');await choose();await editor.focus();await editor.press('ControlOrMeta+End');await editor.pressSequentially(' /核对');await page.getByRole('option',{name:'核对',exact:true}).waitFor();await editor.press('Tab');await page.getByRole('button',{name:'提示词胶囊：讲解',exact:true}).dblclick();await expect(page.getByRole('button',{name:'提示词胶囊：核对',exact:true})).toBeVisible();await page.getByRole('button',{name:'发送提示',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sentTexts.at(-1))).toBe(content+' 核对每一步。');
 await editor.fill('/讲解');await page.getByRole('option',{name:'讲解',exact:true}).waitFor();await editor.evaluate(el=>{for(let i=0;i<2;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));});await expect.poll(()=>page.evaluate(()=>window.sentTexts.at(-1))).toBe(content);
 await editor.fill('/讲解');await choose();await page.evaluate(()=>window.rebuildEditor());await expect(page.locator('.prompt-token')).toHaveCount(1);await page.getByRole('button',{name:'提示词胶囊：讲解',exact:true}).dblclick();await expect(editor).toHaveText(content,{useInnerText:true});await expect(page.locator('.prompt-token')).toHaveCount(0);}
  await editor.fill('/讲解');await choose();await worker.evaluate(()=>chrome.storage.local.set({'nativeLongshot.settings.v1':{prompts:false,latex:true}}));await page.reload();if(query)await expect(editor).toHaveValue(content);else await expect(editor).toHaveText(content,{useInnerText:true});await expect(page.locator('.prompt-token')).toHaveCount(0);await worker.evaluate(()=>chrome.storage.local.set({'nativeLongshot.settings.v1':{prompts:true,latex:true}}));
  await editor.fill('');await page.locator('.katex-html').first().hover();const geometry=await page.locator('.katex').first().boundingBox();await expect(page.getByRole('button',{name:'复制公式 LaTeX'})).toHaveCount(0);await expect(page.locator('[data-native-latex-copy]')).toHaveCSS('box-shadow','rgb(0, 168, 232) 0px 0px 0px 1px');expect(await page.locator('.katex').first().boundingBox()).toEqual(geometry);await page.locator('.katex-html').first().click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('$x^2$');
  await page.locator('.katex-display').hover();await page.locator('.katex-display').click({position:{x:700,y:10}});await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('$$\\int f(x)\\,dx$$');
  expect(errors).toEqual([]);await page.close();
 }
 console.log('PASS: capsules, preview, Enter/click full-body send, atomic delete/undo, copy, multiple tokens, reload, editor rebuild, textarea, direct inline/display formula hitbox and no layout shift');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
