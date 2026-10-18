import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
execFileSync(process.execPath,['scripts/build.mjs','--test'],{stdio:'inherit'});
const server=createServer(async(req,res)=>{try{const file=path.resolve('.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(process.cwd()+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8799,'127.0.0.1',r));const dir=await mkdtemp(path.join(tmpdir(),'layout-'));let context;
try{
 context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,colorScheme:'dark',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const page=context.pages()[0];await page.goto('http://127.0.0.1:8799/tests/layout-fixture.html');await page.getByRole('button',{name:'提示词',exact:true}).waitFor();
 const other=await context.newPage();await other.goto('http://127.0.0.1:8799/tests/layout-fixture.html?other');await other.getByRole('button',{name:'提示词',exact:true}).waitFor();
 const tabId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.sort((a,b)=>a.index-b.index)[0].id;});
 const popup=await context.newPage();await popup.setViewportSize({width:360,height:600});
 // Standalone test page models the action popup's parent active-tab lookup only.
 await popup.addInitScript(({tabId})=>{chrome.tabs.query=async()=>[{id:tabId}];},{tabId});
 await popup.goto(`chrome-extension://${id}/popup.html`);await expect(popup.locator('.version')).toHaveText('0.2.5');
 const popupErrors=[];popup.on('pageerror',e=>popupErrors.push(String(e)));
 const userGeometry=()=>page.locator('.user-bubble').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,align:getComputedStyle(el).textAlign,html:el.innerHTML})));const nativeUsers=await userGeometry();
 await expect(popup.getByRole('switch',{name:'调整回复宽度',exact:false})).not.toBeChecked();await expect(page.locator('[data-native-reply-column]')).toHaveCount(0);
 await popup.getByRole('switch',{name:'调整回复宽度',exact:false}).check();await expect(page.locator('[data-testid="conversation-turn-1"]')).toHaveCSS('max-width','min(100%, 1088px)');
 const originalComposer=await page.locator('body > form').boundingBox();await popup.getByRole('button',{name:'铺满',exact:true}).click();await expect(page.locator('[data-testid="conversation-turn-1"]')).toHaveCSS('max-width','min(100%, 1280px)');
 await popup.locator('#width').focus();await popup.locator('#width').press('ArrowLeft');await expect(popup.locator('#width-value')).toHaveText('99%');
 expect((await page.locator('[data-testid="conversation-turn-1"] .thread-content-max-width').boundingBox()).width).toBeGreaterThan(1000);await expect(page.getByRole('textbox',{name:'消息'})).toHaveText('保留这份草稿');expect((await page.locator('body > form').boundingBox()).width).toBe(originalComposer.width);
 const wideUsers=await userGeometry();
 for(let i=0;i<wideUsers.length;i++){
  expect(wideUsers[i].x+wideUsers[i].width).toBeGreaterThan(nativeUsers[i].x+nativeUsers[i].width+100);
  expect(wideUsers[i].html).toBe(nativeUsers[i].html);
 }
 await expect(page.locator('[data-question][data-native-reply-column]')).toHaveCount(3);
 await expect(page.locator('.user-bubble[data-native-reply-column]')).toHaveCount(0);
 await expect(other.locator('[data-native-reply-column]')).toHaveCount(0);
 await popup.getByRole('switch',{name:'对话时间线',exact:false}).check();await page.getByRole('navigation',{name:'对话时间线'}).waitFor();await popup.locator('#timeline-style').selectOption('ruler');await expect(page.locator('.node')).toHaveCount(3);
 await page.locator('.node').nth(1).hover();await expect(page.locator('.preview')).toContainText('泊松分布');await page.locator('.node').nth(1).click();await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBeGreaterThan(600);
 await page.getByRole('button',{name:'下一条问题',exact:true}).click();await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBeGreaterThan(1500);
 await page.locator('main').evaluate(el=>{const a=document.createElement('article');a.dataset.testid='conversation-turn-6';a.dataset.question='';a.innerHTML='<div data-message-author-role="user">新增问题</div>';el.append(a);});await expect(page.locator('.node')).toHaveCount(4);
 await page.locator('[data-testid="conversation-turn-0"]').evaluate(el=>el.remove());await expect(page.locator('.node')).toHaveCount(3);
 const mixedNative=await page.locator('main').evaluate(main=>{const turn=document.createElement('article');turn.dataset.testid='conversation-turn-mixed';turn.innerHTML='<div class="thread-content-max-width"><div data-message-author-role="user" class="user-bubble">同一轮里有提问和回复时，我的提问应该随回复一起靠右，但气泡仍然保持原来的样式。</div><div data-message-author-role="assistant" class="answer">这是一段独立扩宽的助手回复。</div><div class="turn-action-controls"><button aria-label="复制">复制</button></div></div>';main.append(turn);const r=turn.querySelector('.user-bubble').getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};});
 await expect(page.locator('[data-testid="conversation-turn-mixed"][data-native-reply-column]')).toHaveCount(1);await expect(page.locator('.node')).toHaveCount(4);
 const mixedUser=await page.locator('[data-testid="conversation-turn-mixed"] .user-bubble').boundingBox();expect(mixedUser.x+mixedUser.width).toBeGreaterThan(mixedNative.x+mixedNative.width+100);
 expect((await page.locator('[data-testid="conversation-turn-mixed"] .answer').boundingBox()).width).toBeGreaterThan(720);
 await popup.getByRole('switch',{name:'公式复制',exact:false}).uncheck();await page.locator('main').evaluate(el=>el.scrollTop=0);await page.locator('.katex-html').hover();await expect(page.locator('[data-native-latex-copy]')).toHaveCount(0);
 await popup.getByRole('switch',{name:'公式复制',exact:false}).check();await page.locator('h1').hover();await page.locator('.katex-html').hover();await expect(page.locator('[data-native-latex-copy]')).toHaveCount(1);
 await popup.getByRole('switch',{name:'在 ChatGPT / Gemini 上开启提示词管理器',exact:false}).uncheck();await expect(page.getByRole('button',{name:'提示词',exact:true})).toBeHidden();await popup.getByRole('switch',{name:'在 ChatGPT / Gemini 上开启提示词管理器',exact:false}).check();await expect(page.getByRole('button',{name:'提示词',exact:true})).toBeVisible();
 const data={format:'gemini-voyager.prompts.v1',items:[{name:'本地备份',text:'完整正文\\frac{1}{2}\n第二行',tags:['数学']}]};
 await popup.locator('#file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(popup.locator('#status')).toContainText('已导入 1 条');
 await popup.locator('#file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(popup.locator('#status')).toContainText('已导入 0 条');
 const pending=popup.waitForEvent('download');await popup.getByRole('button',{name:'↓ 导出',exact:true}).click();const exported=JSON.parse(await readFile(await (await pending).path(),'utf8'));expect(exported.prompts[0].content).toBe(data.items[0].text);
 await popup.getByRole('button',{name:'切换主题'}).click();await popup.screenshot({path:'artifacts/settings-panel.png'});await popup.getByRole('button',{name:'切换主题'}).click();await popup.screenshot({path:'artifacts/settings-panel-dark.png'});await popup.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);await popup.screenshot({path:'artifacts/settings-panel-bottom.png'});
 await popup.getByRole('button',{name:'原始宽度',exact:true}).click();await expect(page.locator('[data-native-reply-column]')).toHaveCount(0);await expect(page.locator('[data-testid="conversation-turn-1"] .thread-content-max-width')).toHaveCSS('max-width','680px');
 const restoredUsers=await userGeometry();expect(restoredUsers[0]).toEqual(nativeUsers[1]);expect(restoredUsers[1]).toEqual(nativeUsers[2]);
 await popup.getByRole('switch',{name:'调整回复宽度',exact:false}).check();await popup.getByRole('button',{name:'宽屏',exact:true}).click();await page.reload();await page.getByRole('navigation',{name:'对话时间线'}).waitFor();await expect(page.locator('[data-testid="conversation-turn-1"]')).toHaveCSS('max-width','min(100%, 1088px)');
 await page.screenshot({path:'artifacts/timeline-width.png'});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await expect(page.getByRole('textbox',{name:'消息'})).toHaveText('保留这份草稿');await page.screenshot({path:'artifacts/timeline-mobile.png'});
 await popup.getByRole('switch',{name:'对话时间线',exact:false}).uncheck();await expect(page.getByRole('navigation',{name:'对话时间线'})).toBeHidden();
 expect(popupErrors).toEqual([]);
 console.log('PASS: settings popup, additive Voyager import/export, toggles, reply width/restore, composer intact, target-tab isolation, timeline hover/jump/dynamic content, persistence and mobile');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
