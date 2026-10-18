import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
execFileSync(process.execPath,['scripts/build.mjs','--test'],{stdio:'inherit'});
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type','text/html');res.end(await readFile('tests/layout-fixture.html'));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8799,'127.0.0.1',r));const dir=await mkdtemp(path.join(tmpdir(),'timeline-'));let context;
try{
 context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'nativeLongshot.settings.v1':{timeline:true,timelineStyle:'ruler',timelineSmooth:false}}));
 const page=context.pages()[0];const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8799/conversation-a');await expect(page.locator('.node')).toHaveCount(3);
 await page.evaluate(()=>{const main=document.querySelector('main');main.replaceChildren();for(let i=0;i<120;i++){const q=document.createElement('article');q.dataset.testid=`conversation-turn-q-${i}`;q.innerHTML=`<h4 style="position:fixed;top:0;left:-10000px;width:1px;height:1px;overflow:hidden">你说：</h4><div data-message-author-role="user" data-message-id="question-${i}" class="user-bubble">第${i+1}题：概率论问题</div>`;const a=document.createElement('article');a.innerHTML=`<div data-message-author-role="assistant" class="answer" style="height:${i===0?4000:200}px">回复${i+1}${i===79?'：这是只在回复里出现的检索暗号':'：解析过程'}</div>`;main.append(q,a);}});
 await expect(page.locator('.node')).toHaveCount(120);expect((await page.locator('.track').boundingBox()).height).toBeLessThan(700);
 // A long reply must retain question 1 even when the next question is closer.
 await page.locator('main').evaluate(el=>el.scrollTop=3000);await expect(page.locator('.index')).toHaveText('1\n120');
 const draft=await page.getByRole('textbox',{name:'消息'}).innerText();const before=await page.locator('main').evaluate(el=>el.scrollTop);
 await page.getByRole('button',{name:'打开时间线列表'}).click();await expect(page.getByRole('dialog',{name:'时间线问题列表'})).toBeVisible();expect(await page.locator('main').evaluate(el=>el.scrollTop)).toBe(before);
 await page.getByRole('textbox',{name:'搜索时间线'}).fill('检索暗号');await expect(page.locator('.timeline-row')).toHaveCount(1);await expect(page.locator('.question-title')).toContainText('第80题');
 await page.getByRole('button',{name:'收藏第 80 条问题',exact:true}).click();await page.getByRole('textbox',{name:'搜索时间线'}).fill('');await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.timeline-row')).toHaveCount(1);
 await page.getByRole('button',{name:'固定时间线面板'}).click();await page.locator('.row-jump').click();await expect(page.getByRole('dialog',{name:'时间线问题列表'})).toBeVisible();await expect(page.locator('.index')).toHaveText('80\n120');
 await page.screenshot({path:'artifacts/timeline-search-stars.png'});
 await page.getByRole('button',{name:'关闭时间线列表'}).click();await page.locator('.node').nth(79).focus();await expect(page.locator('.preview')).toContainText('检索暗号');await page.locator('.node').nth(79).press('Home');await expect(page.locator('.index')).toHaveText('1\n120');
 const dense=await page.locator('.node').nth(79).boundingBox();await page.mouse.click(dense.x+15,dense.y+dense.height/2);await expect(page.locator('.index')).toHaveText('80\n120');
 // Drag rail left, then verify viewport boundaries and persisted location.
 const grip=await page.getByRole('button',{name:'拖动时间线'}).boundingBox();await page.mouse.move(grip.x+15,grip.y+7);await page.mouse.down();await page.mouse.move(20,300,{steps:10});await page.mouse.up();expect((await page.locator('[data-native-longshot-ui="timeline"]').boundingBox()).x).toBe(12);
 await page.getByRole('button',{name:'打开时间线列表'}).click();await page.getByRole('button',{name:'全部',exact:true}).click();await page.setViewportSize({width:390,height:844});
 // setViewportSize can resolve before the resize/RAF callback has positioned
 // the panel. Wait for the same strict boundary rather than sampling old layout.
 await expect.poll(async()=>{const box=await page.getByRole('dialog',{name:'时间线问题列表'}).boundingBox();return box.y+box.height;}).toBeLessThanOrEqual(844);
 const panel=await page.getByRole('dialog',{name:'时间线问题列表'}).boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(390);expect(panel.y+panel.height).toBeLessThanOrEqual(844);await page.screenshot({path:'artifacts/timeline-panel-mobile.png'});
 expect(await page.getByRole('textbox',{name:'消息'}).innerText()).toBe(draft);
 await page.getByRole('textbox',{name:'搜索时间线'}).press('Escape');await expect(page.getByRole('dialog',{name:'时间线问题列表'})).toBeHidden();
 await page.setViewportSize({width:1280,height:900});
 // Persist stars without storing conversation bodies; reconstruct loaded conversation.
 await page.reload();await expect(page.locator('.node')).toHaveCount(3);
 await page.evaluate(()=>{const q=document.querySelector('[data-message-author-role="user"]');q.dataset.messageId='question-79';q.textContent='第80题：概率论问题';});await expect(page.locator('.node[data-starred=true]')).toHaveCount(1);
 expect((await page.locator('[data-native-longshot-ui="timeline"]').boundingBox()).x).toBe(12);
 const nodeBox=await page.locator('.node').nth(1).boundingBox();await page.mouse.move(nodeBox.x+15,nodeBox.y+4);await page.mouse.down();await page.mouse.move(nodeBox.x-80,nodeBox.y+4);await page.waitForTimeout(600);await page.mouse.up();await expect(page.locator('.node').nth(1)).toHaveAttribute('data-starred','false');
 const routeHold=await page.locator('.node').nth(2).boundingBox();await page.mouse.move(routeHold.x+15,routeHold.y+routeHold.height/2);await page.mouse.down();
 await page.evaluate(()=>history.pushState({},'', '/conversation-b'));await page.waitForTimeout(650);await page.mouse.move(routeHold.x-80,routeHold.y);await page.mouse.up();await expect(page.locator('.node[data-starred=true]')).toHaveCount(0);
 const tabId=await worker.evaluate(async()=>{return (await chrome.tabs.query({}))[0].id;});
 await worker.evaluate(async(tabId)=>{await chrome.tabs.sendMessage(tabId,{type:'native-longshot-settings',settings:{timeline:true,timelineSmooth:true}});},tabId);
 await page.locator('main').evaluate(el=>el.scrollTop=0);await expect(page.locator('.index')).toHaveText('1\n3');await page.getByRole('button',{name:'下一条问题',exact:true}).click();await page.getByRole('button',{name:'下一条问题',exact:true}).click();await expect(page.locator('.index')).toHaveText('3\n3');await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBeGreaterThan(1500);
 await worker.evaluate(async(tabId)=>{await chrome.tabs.sendMessage(tabId,{type:'native-longshot-settings',settings:{timeline:true,timelineStyle:'compact',timelineSmooth:false}});},tabId);await expect(page.locator('.track')).toHaveAttribute('data-style','compact');await page.getByRole('textbox',{name:'消息'}).focus();await page.locator('.track').hover();await expect(page.getByRole('dialog',{name:'时间线问题列表'})).toBeVisible();await expect(page.getByRole('textbox',{name:'消息'})).toBeFocused();await page.screenshot({path:'artifacts/timeline-compact.png'});await page.getByRole('button',{name:'关闭时间线列表'}).click();
 await page.locator('main').evaluate(el=>{el.style.overflow='hidden';el.scrollTop=0;});await page.locator('.node').nth(1).click();await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBeGreaterThan(600);
 await page.evaluate(()=>{document.querySelector('main').style.height='auto';document.querySelector('main').style.overflow='visible';});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight)).toBeGreaterThan(2000);await page.locator('.node').nth(1).click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(600);
 await page.locator('[data-message-author-role=assistant]').first().evaluate(el=>el.append(document.createElement('p')));await expect(page.locator('.node')).toHaveCount(3);await page.locator('.node').nth(2).click();const firstJump=await page.evaluate(()=>scrollY);await page.locator('.node').nth(1).click();await page.locator('.node').nth(2).click();expect(Math.abs(await page.evaluate(()=>scrollY)-firstJump)).toBeLessThan(3);
 await page.evaluate(()=>{scrollTo(0,0);document.body.style.height='100vh';document.body.style.overflow='auto';});await page.locator('.node').nth(1).click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(600);
 await page.evaluate(()=>{scrollTo(0,0);document.documentElement.style.overflow='hidden';document.body.scrollTop=0;});await page.locator('.node').nth(2).click();await expect.poll(()=>page.evaluate(()=>document.body.scrollTop)).toBeGreaterThan(1500);
 await worker.evaluate(async(tabId)=>{await chrome.tabs.sendMessage(tabId,{type:'native-longshot-settings',settings:{timeline:false}});},tabId);await expect(page.getByRole('navigation',{name:'对话时间线'})).toBeHidden();expect(errors).toEqual([]);
 console.log('PASS: 120 questions, long-reply active marker, reply search, stars/reload/route isolation, pinned panel, keyboard jumps, draggable position persistence, 390px panel, draft preservation and disable');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
