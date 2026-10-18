import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
execFileSync(process.execPath,['scripts/build.mjs','--test'],{stdio:'inherit'});
const server=createServer(async(req,res)=>{try{const vendor=req.url.startsWith('/vendor/');res.setHeader('Content-Type',vendor?(req.url.endsWith('.css')?'text/css':'text/javascript'):'text/html');res.end(await readFile(vendor?(req.url.endsWith('.css')?'node_modules/quill/dist/quill.core.css':'node_modules/quill/dist/quill.js'):req.url.startsWith('/tests/gemini')?'tests/gemini-fixture.html':'tests/tokens-fixture.html'));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8799,'127.0.0.1',r));
const dir=await mkdtemp(path.join(tmpdir(),'gemini-prompts-'));let context;
try{
 context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,colorScheme:'dark',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const content='逐步讲解。\n保留公式 \\frac{1}{2} 和 <script> 原文。';
 await worker.evaluate(async content=>chrome.storage.local.set({'nativeLongshot.prompts.v1':[{id:'one',name:'讲解',content,tags:['数学'],favorite:true}], 'nativeLongshot.settings.v1':{prompts:true,timeline:true,widthEnabled:true}}),content);
 const gemini=await context.newPage(),gErrors=[];gemini.on('pageerror',e=>gErrors.push(String(e)));await gemini.goto('http://127.0.0.1:8799/tests/gemini-fixture.html');
 const chat=await context.newPage();await chat.goto('http://127.0.0.1:8799/tests/tokens-fixture.html');
 const editor=gemini.locator('rich-textarea [contenteditable=true]');
 await gemini.getByRole('button',{name:'提示词',exact:true}).waitFor();
 await expect(gemini.locator('[data-native-longshot-ui="button"],[data-native-longshot-ui="timeline"],[data-native-longshot-ui="width-style"]')).toHaveCount(0);
 const choose=async()=>{await gemini.getByRole('option',{name:/^讲解/}).waitFor();await editor.press('Tab');await expect(gemini.locator('.prompt-token')).toHaveCount(1);};
 await editor.fill('/数学');await choose();assert.deepEqual(await gemini.evaluate(()=>sentTexts),[]);
 await gemini.getByRole('button',{name:'提示词胶囊：讲解',exact:true}).hover();await expect(gemini.locator('.token-preview')).toContainText(content);
 await gemini.locator('.send-button span').click();await expect.poll(()=>gemini.evaluate(()=>sentTexts.at(-1))).toBe(content);
 await editor.fill('/讲解');await choose();await editor.press('Enter');await expect.poll(()=>gemini.evaluate(()=>sentTexts.length)).toBe(2);assert.equal(await gemini.evaluate(()=>sentTexts.at(-1)),content);
 await editor.fill('/讲解');await choose();await editor.focus();await editor.press('ControlOrMeta+End');await editor.press('Backspace');await expect(gemini.locator('.prompt-token')).toHaveCount(0);await editor.press('ControlOrMeta+z');await expect(gemini.locator('.prompt-token')).toHaveCount(1);await editor.press('ControlOrMeta+Shift+z');await expect(gemini.locator('.prompt-token')).toHaveCount(0);await editor.press('ControlOrMeta+z');await expect(gemini.locator('.prompt-token')).toHaveCount(1);
 await gemini.reload();await expect(gemini.locator('.prompt-token')).toHaveCount(1);await gemini.evaluate(()=>{rebuildEditor();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await expect(gemini.locator('.prompt-token')).toHaveCount(1);
 await gemini.locator('.stop-button').click();await expect(gemini.locator('.prompt-token')).toHaveCount(1);assert.deepEqual(await gemini.evaluate(()=>sentTexts),[]);
 await editor.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});assert.deepEqual(await gemini.evaluate(()=>sentTexts),[]);
 await gemini.locator('.send-button').click();await expect.poll(()=>gemini.evaluate(()=>sentTexts.at(-1))).toBe(content);
 // Shared library update reaches both site entry points without another import.
 await worker.evaluate(async()=>{const d=await chrome.storage.local.get('nativeLongshot.prompts.v1');await chrome.storage.local.set({'nativeLongshot.prompts.v1':[...d['nativeLongshot.prompts.v1'],{id:'two',name:'跨站共享',content:'共享正文',tags:[]}]});});
 await editor.fill('/跨站');await expect(gemini.getByRole('option',{name:'跨站共享',exact:true})).toBeVisible();
 const chatEditor=chat.locator('#prompt-textarea');await chatEditor.fill('/跨站');await expect(chat.getByRole('option',{name:'跨站共享',exact:true})).toBeVisible();
 // Orb uses the latest saved editor selection; no accidental submit.
 await editor.fill('保留草稿 ');await editor.press('ControlOrMeta+End');await gemini.getByRole('button',{name:'提示词',exact:true}).click();await gemini.getByRole('button',{name:'使用提示词：跨站共享',exact:true}).click();await expect(gemini.locator('.prompt-token')).toHaveCount(1);await expect(editor).toContainText('保留草稿');assert.equal(await gemini.evaluate(()=>sentTexts.length),1);
 await gemini.bringToFront();const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
 await worker.evaluate(async tabId=>chrome.tabs.sendMessage(tabId,{type:'native-longshot-settings',settings:{prompts:false}}),tabId);await expect(gemini.getByRole('button',{name:'提示词',exact:true})).toBeHidden();await expect(editor).toContainText('共享正文');
 assert.deepEqual(gErrors,[]);
 console.log('PASS Gemini Quill / search, capsules, direct send/Enter full body, no auto-send, undo, refresh/rebuild, IME/stop guard, shared ChatGPT data, orb draft and prompt toggle; no ChatGPT-only features installed');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
