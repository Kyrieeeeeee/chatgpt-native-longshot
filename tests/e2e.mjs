import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
execFileSync(process.execPath, ['scripts/build.mjs', '--test'], { stdio:'inherit' });
await mkdir('artifacts', { recursive:true });
const server = createServer(async (req,res) => {
  try {
    const filename = path.resolve('.'+new URL(req.url,'http://localhost').pathname);
    if (!filename.startsWith(process.cwd()+path.sep)) throw new Error('path');
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' };
    res.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    res.end(await readFile(filename));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(8799,'127.0.0.1',resolve); });
const records=[];
function diff(actual,reference) {
  assert.equal(actual.width,reference.width,'PNG width'); assert.equal(actual.height,reference.height,'PNG height');
  const out = new PNG({ width:actual.width,height:actual.height });
  let pixels=0,sum=0,max=0;
  for (let i=0;i<actual.data.length;i+=4) {
    let changed=false;
    for (let c=0;c<3;c++) { const d=Math.abs(actual.data[i+c]-reference.data[i+c]);sum+=d;max=Math.max(max,d);if(d)changed=true; }
    if(changed) { pixels++; out.data[i]=255;out.data[i+2]=120; }
    out.data[i+3]=255;
  }
  return { pixels,mean:sum/(actual.width*actual.height*3),max,out };
}
async function notice(page) { return page.locator('[data-native-longshot-ui="notice"] .notice').textContent(); }
async function ready(page,url) {
  await page.goto(url); await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{ await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode())); });
  await page.locator('[data-native-longshot-ui="button"] button').first().waitFor();
}
async function scrollSnapshot(page) { return page.evaluate(()=>[...document.querySelectorAll('html,body,main,#outer')].map(e=>({ tag:e.tagName,id:e.id,top:e.scrollTop,left:e.scrollLeft,style:e.getAttribute('style')||'' }))); }
async function armClickSnapshot(page){
  await page.evaluate(()=>{
    window.__longshotClickScroll=null;
    window.__longshotProgress=[];
    const host=document.querySelector('[data-native-longshot-ui="notice"]');
    const status=host.shadowRoot.querySelector('.notice');
    new MutationObserver(()=>{
      const r=host.getBoundingClientRect();
      window.__longshotProgress.push({text:status.textContent,busy:status.hasAttribute('data-busy'),
        visible:getComputedStyle(host).visibility==='visible' && r.height>0 && r.top>=0 && r.bottom<=innerHeight});
    }).observe(status,{childList:true,subtree:true,attributes:true});
    document.addEventListener('click',()=>{
      window.__longshotClickScroll=[...document.querySelectorAll('html,body,main,#outer')].map(e=>({tag:e.tagName,id:e.id,top:e.scrollTop,left:e.scrollLeft,style:e.getAttribute('style')||''}));
    },{capture:true,once:true});
  });
}
async function rawClipboard(page) {
  return page.evaluate(async()=>{
    const items=await navigator.clipboard.read();
    const item=items.find(i=>i.types.includes('image/png'));
    if(!item)throw Error('No actual PNG on clipboard');
    const blob=await item.getType('image/png');
    return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});
  });
}
async function ownsDebugger(worker) {
  return worker.evaluate(async()=>{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    try { await chrome.debugger.sendCommand({tabId:tab.id},'Page.getLayoutMetrics');return true; }
    catch { return false; }
  });
}
async function resize(context,page,width,height){
  const cdp=await context.newCDPSession(page);
  const {windowId}=await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width,height}});
  await cdp.detach();
}
async function stableViewport(page){
  let prior='';let equal=0;
  for(let i=0;i<30;i++){
    const current=await page.evaluate(()=>`${innerWidth}/${innerHeight}/${devicePixelRatio}`);
    equal=current===prior?equal+1:0;if(equal>=5)return;prior=current;
    await new Promise(r=>setTimeout(r,50));
  }
  throw Error('Reference viewport did not settle');
}
async function reference(context,url,worker) {
  const refPage=await context.newPage();
  await ready(refPage,url);
  // Independent reference excludes the fixture's unrelated composer overlay.
  // Its descendants deliberately override inherited visibility, matching the
  // failure caught by real-site paste inspection.
  await refPage.evaluate(()=>document.querySelectorAll('#composer-fixture *').forEach(el=>el.style.visibility='hidden'));
  // Independent reference removes only the explicitly unrelated test overlay.
  await refPage.evaluate(()=>{const overlay=document.querySelector('#shadow-overlay-fixture');if(overlay)overlay.style.opacity='0';});
  // Include Chrome's actual debugger infobar in the reference environment as
  // well. A vh-based ancestor otherwise changes raster phase even with equal
  // target width/height. No emulated metrics or target CSS are changed.
  const refTab=await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.debugger.attach({tabId:t.id},'1.3');return t.id;});
  await stableViewport(refPage);
  const box=await refPage.locator('#answer').boundingBox();
  const dpr=await refPage.evaluate(()=>devicePixelRatio);
  const left=Math.round((box.x-8)*dpr), top=Math.round(box.y*dpr);
  const right=Math.round((box.x+box.width+8)*dpr), bottom=Math.round((box.y+box.height)*dpr);
  const output=new PNG({width:right-left,height:bottom-top});
  const nativeSession=await context.newCDPSession(refPage);
  const rootOffset=await refPage.evaluate(()=>{
    const inner=document.documentElement.classList.contains('inner')||document.documentElement.classList.contains('nested');
    const root=inner?document.querySelector('main'):document.scrollingElement;
    return {inner,top:inner?root.getBoundingClientRect().top+root.clientTop:0,scroll:root.scrollTop};
  });
  // Independent native reference, sampled in 256 physical-row bands. Chrome's
  // beyond-viewport compositor in this environment repeats the first viewport.
  // This keeps the actual viewport fixed and does not share extension geometry.
  for(let row=0;row<output.height;row+=256){
    await refPage.evaluate(({inner,y})=>{if(inner)document.querySelector('main').scrollTop=y;else window.scrollTo(0,y);},
      {inner:rootOffset.inner,y:(top+row)/dpr-rootOffset.top+rootOffset.scroll-128});
    await refPage.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    let prior='';let equal=0;
    for(let k=0;k<20;k++){
      const geometry=await refPage.locator('#answer').evaluate(e=>JSON.stringify([e.getBoundingClientRect().top,window.scrollY,document.querySelector('main').scrollTop]));
      equal=geometry===prior?equal+1:0;if(equal>=3)break;prior=geometry;
      await new Promise(r=>setTimeout(r,50));
    }
    const targetY=await refPage.locator('#answer').evaluate(e=>e.getBoundingClientRect().top);
    let capture=await nativeSession.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    for(let k=0;k<5;k++){
      await new Promise(r=>setTimeout(r,50));
      const next=await nativeSession.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      if(next.data===capture.data)break;
      capture=next;if(k===4)throw Error('Reference compositor did not settle');
    }
    const shot=PNG.sync.read(Buffer.from(capture.data,'base64'));
    assert.equal(shot.width,Math.round((await refPage.evaluate(()=>innerWidth))*dpr));
    const sourceY=Math.round(targetY*dpr)+row;
    const height=Math.min(256,output.height-row);
    assert.ok(sourceY>=0 && sourceY+height<=shot.height,'native reference visible band');
    PNG.bitblt(shot,output,left,sourceY,right-left,height,0,row);
  }
  await nativeSession.detach();
  await worker.evaluate(id=>chrome.debugger.detach({tabId:id}),refTab);
  await stableViewport(refPage);await refPage.close();
  return output;
}
const profiles=[
 {dpr:1,cases:['short','long','headings','lists','quote','code','longcode','math','table','longtable','images','rich','lazy','wide','sticky','sticky_negative','longsingle','split','renderer_role','renderer_semantic','shadow_overlay']},
 {dpr:2,cases:['short','math','rich']},
 {dpr:1.25,cases:['short','longtable','rich']},
 {dpr:1,zoom:1.25,cases:['short','math','rich']},
];
let failed=false;
for(const profile of profiles.filter(p=>!process.env.DPRS||process.env.DPRS.split(',').includes(String(p.dpr)))) {
 const dir=await mkdtemp(path.join(tmpdir(),'native-longshot-e2e-'));
 let context;
 try {
  context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:process.env.HEADED!=='1',viewport:null,
    args:['--window-size=1100,900',`--force-device-scale-factor=${profile.dpr}`,`--disable-extensions-except=${path.resolve('dist-test')}`,`--load-extension=${path.resolve('dist-test')}`]});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:8799'});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=context.pages()[0] || await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const scenarios=[...profile.cases.map(name=>({name,inner:0,dark:name==='rich'?1:0})),
    ...(profile.dpr===1?[{name:'rich',inner:1,dark:1,fixed:1},{name:'longtable',inner:1},{name:'long',nested:1},{name:'rich',dark:0},{name:'short',denyClipboard:1}]:[])];
  for(const scenario of scenarios.filter(s=>process.env.EXTRA_ONLY!=='1' && (!process.env.CASES||process.env.CASES.split(',').includes(s.name)))) {
   const label=Object.entries({...(process.env.HEADED==='1'?{mode:'headed'}:{}),dpr:profile.dpr,...(profile.zoom?{zoom:profile.zoom}:{}),...scenario}).map(([k,v])=>`${k}-${v}`).join('_');
   const url='http://127.0.0.1:8799/tests/fixture.html?'+new URLSearchParams({case:scenario.name,...scenario});
   try {
    await ready(page,url);
    if(scenario.name.startsWith('renderer_')) {
      assert.equal(await page.locator('[data-native-longshot-ui="button"]').evaluate(el=>
        !!(document.querySelector('#answer').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)),true,'button follows assistant, not user actions');
    }
    if(profile.zoom){
      await worker.evaluate(async zoom=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,zoom);},profile.zoom);
      await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<0.01,profile.dpr*profile.zoom);
    }
    const ref=await reference(context,url,worker);
    await page.bringToFront();
    await page.evaluate(()=>{const root=document.documentElement.classList.contains('inner')||document.documentElement.classList.contains('nested')?document.querySelector('main'):document.scrollingElement;root.scrollTop=170;});
    await page.locator('[data-native-longshot-ui="button"] button').first().scrollIntoViewIfNeeded();
    await armClickSnapshot(page);
    const started=Date.now();
    await page.locator('[data-native-longshot-ui="button"] button').first().click();
    const before=await page.evaluate(()=>window.__longshotClickScroll);
    await expect.poll(()=>notice(page),{timeout:120000}).toMatch(/长图已复制|超过单张安全尺寸|图片生成成功，但复制失败|截图失败|已取消/);
    const message=await notice(page);
    if(scenario.name==='longsingle')assert.match(message,/长图已复制/);
    assert.ok(!message.startsWith('截图失败'),message);
    const progress=await page.evaluate(()=>window.__longshotProgress);
    assert.ok(progress.some(p=>p.busy && p.text.includes('正在截图')),'immediate capture feedback');
    assert.ok(progress.some(p=>p.busy && /正在拼接 \d+%/.test(p.text)),'stitching progress');
    assert.ok(progress.filter(p=>p.busy).every(p=>p.visible),'progress stays visible during capture');
    if(scenario.name!=='split')assert.ok(progress.some(p=>p.busy && p.text.includes('正在复制到剪贴板')),'clipboard feedback');
    assert.equal(progress.at(-1).busy,false,'stop busy indicator when finished');
    if(scenario.name==='split')assert.match(message,/超过单张安全尺寸/);
    if(scenario.denyClipboard)assert.match(message,/图片生成成功，但复制失败.*权限被拒绝/);
    assert.deepEqual(await scrollSnapshot(page),before,'restore original scroll and styles');
    if(scenario.name==='shadow_overlay')assert.equal(await page.locator('#shadow-overlay-fixture').getAttribute('style') || '', '', 'restore external shadow host styles');
    await expect.poll(()=>ownsDebugger(worker)).toBe(false);
    let pngs=[];
    if(message.includes('超过单张安全尺寸')||message.includes('图片生成成功，但复制失败')) {
      const popup=context.waitForEvent('page');
      await page.getByText('打开预览 / 保存 PNG',{exact:true}).click();
      const preview=await popup;
      await expect(preview.locator('#status')).toContainText(/图片仅保存|共 \d+ 张 PNG/,{timeout:20000});
      const data=await preview.locator('img').evaluateAll(async images=>Promise.all(images.map(async img=>{
        const b=await(await fetch(img.src)).blob();return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(b);});
      })));
      pngs=data.map(d=>PNG.sync.read(Buffer.from(d.split(',')[1],'base64')));
      if(scenario.name==='split')assert.ok(pngs.length>1,'safe split');
      const download=preview.waitForEvent('download');await preview.getByText('保存 PNG',{exact:true}).first().click();
      assert.ok((await download).suggestedFilename().endsWith('.png'));
      await preview.getByText('复制图片',{exact:true}).first().click();
      await expect(preview.locator('#status')).toContainText('图片已复制');
      await preview.close();await page.bringToFront();
    } else {
      pngs=[PNG.sync.read(Buffer.from((await rawClipboard(page)).split(',')[1],'base64'))];
    }
    const output=new PNG({width:pngs[0].width,height:pngs.reduce((a,p)=>a+p.height,0)});let y=0;
    for(const p of pngs){PNG.bitblt(p,output,0,0,p.width,p.height,0,y);y+=p.height;}
    await writeFile(`artifacts/${label}-output.png`,PNG.sync.write(output));
    if(process.env.HEADED==='1' && pngs.length===1 && !scenario.denyClipboard){
      const systemPath=path.resolve(`artifacts/${label}-system-clipboard.png`);
      execFileSync('/usr/bin/swift',['tests/clipboard-probe.swift',systemPath],{stdio:'inherit'});
      assert.equal(diff(PNG.sync.read(await readFile(systemPath)),output).pixels,0,'macOS NSPasteboard image pixels');
    }
    let metrics;
    if(ref){
      metrics=diff(output,ref);await writeFile(`artifacts/${label}-reference.png`,PNG.sync.write(ref));await writeFile(`artifacts/${label}-diff.png`,PNG.sync.write(metrics.out));
      assert.equal(metrics.pixels,0,`native pixel mismatch: ${metrics.pixels}, mean ${metrics.mean}, max ${metrics.max}`);
    }
    if(scenario.name==='wide')assert.match(message,/横向|独立纵向/);
    records.push({label,passed:true,message,width:output.width,height:output.height,parts:pngs.length,milliseconds:Date.now()-started,pixels:metrics?.pixels,mean:metrics?.mean,max:metrics?.max});
    console.log('PASS',label,output.width,output.height,metrics?.pixels??'no full reference');
   } catch(e) {
    records.push({label,passed:false,error:e.message,notice:await notice(page).catch(()=>null)});console.error('FAIL',label,e.message);failed=true;
    await page.screenshot({path:`artifacts/${label}-failure.png`}).catch(()=>{});
    if(process.env.FAIL_FAST==='1')throw e;
   }
  }
  if(profile.dpr===1 && !profile.zoom && !process.env.CASES){
    for(const scenario of ['cancel','cancel_cleanup','dynamic','streaming','navigation','detach','resize']){
      const label='lifecycle-'+scenario;
      try{
        await ready(page,`http://127.0.0.1:8799/tests/fixture.html?case=${scenario==='streaming'?'streaming':'long'}&inner=1`);
        await page.evaluate(()=>document.querySelector('main').scrollTop=160);
        await page.locator('[data-native-longshot-ui="button"] button').first().scrollIntoViewIfNeeded();
        if(scenario.startsWith('cancel'))await page.evaluate(()=>navigator.clipboard.writeText('longshot-cancel-sentinel'));
        await armClickSnapshot(page);
        if(['dynamic','resize'].includes(scenario))await worker.evaluate(()=>{globalThis.__longshotFrameGate=true;globalThis.__longshotFrameReady=false;});
        await page.locator('[data-native-longshot-ui="button"] button').first().click();
        const before=await page.evaluate(()=>window.__longshotClickScroll);
        if(scenario!=='streaming'){
          await expect.poll(()=>ownsDebugger(worker)).toBe(true);
          if(scenario==='cancel')await page.keyboard.press('Escape');
          if(scenario==='cancel_cleanup'){
            await expect.poll(()=>ownsDebugger(worker),{timeout:15000,intervals:[30]}).toBe(false);
            await page.keyboard.press('Escape');
          }
          if(scenario==='dynamic'){
            await expect.poll(()=>worker.evaluate(()=>globalThis.__longshotFrameReady),{timeout:15000}).toBe(true);
            await page.evaluate(()=>{const x=document.createElement('p');x.textContent='动态新增正文';document.querySelector('#answer').append(x);});
            await worker.evaluate(()=>globalThis.__longshotFrameGate=false);
          }
          if(scenario==='navigation')await page.evaluate(()=>history.pushState({},'', '/tests/fixture.html?switched=1'));
          if(scenario==='detach')await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.debugger.detach({tabId:tab.id});});
          if(scenario==='resize'){
            await expect.poll(()=>worker.evaluate(()=>globalThis.__longshotFrameReady),{timeout:15000}).toBe(true);
            await resize(context,page,1080,880);
            await worker.evaluate(()=>globalThis.__longshotFrameGate=false);
          }
        }
        await expect.poll(()=>notice(page),{timeout:15000}).toMatch(/截图失败|已取消/);
        const expected={cancel:/已取消/,cancel_cleanup:/已取消/,dynamic:/回答内容在截图过程中改变|捕获时页面发生移动/,streaming:/回答正在生成/,navigation:/对话已切换/,detach:/调试会话已断开|not attached|Detached/,resize:/窗口尺寸或缩放改变/};
        assert.match(await notice(page),expected[scenario]);
        if(scenario!=='resize')assert.deepEqual(await scrollSnapshot(page),before);
        assert.ok(!(await notice(page)).includes('长图已复制'));
        if(scenario.startsWith('cancel'))assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'longshot-cancel-sentinel','cancel must not replace clipboard');
        await expect.poll(()=>ownsDebugger(worker)).toBe(false);
        records.push({label,passed:true,message:await notice(page)});console.log('PASS',label);
      }catch(e){records.push({label,passed:false,error:e.message,notice:await notice(page)});console.error('FAIL',label,e.message);failed=true;}
      await worker.evaluate(()=>globalThis.__longshotFrameGate=false);
      if(scenario==='resize')await resize(context,page,1100,900);
    }
    await ready(page,'http://127.0.0.1:8799/tests/fixture.html?case=long&inner=1');
    await page.evaluate(()=>navigator.clipboard.writeText('longshot-navigation-sentinel'));
    await page.locator('[data-native-longshot-ui="button"] button').first().click();
    await expect.poll(()=>ownsDebugger(worker)).toBe(true);
    await ready(page,'http://127.0.0.1:8799/tests/fixture.html?case=short&afterNavigation=1');
    await expect.poll(()=>ownsDebugger(worker)).toBe(false);
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'longshot-navigation-sentinel');
    records.push({label:'full-navigation-releases-debugger',passed:true});
    await ready(page,'http://127.0.0.1:8799/tests/fixture.html?case=short');
    await page.evaluate(()=>{const clone=document.querySelector('#turn').cloneNode(true);clone.id='turn2';for(const el of clone.querySelectorAll('[data-native-longshot-ui]'))el.remove();const body=clone.querySelector('[data-message-author-role="assistant"]');body.id='answer2';body.innerHTML='<p>仅第二条回答 SECOND ANSWER。</p><p>目标绑定必须正确。</p>';document.querySelector('main').append(clone);});
    await expect(page.locator('[data-native-longshot-ui="button"]')).toHaveCount(2);
    await page.locator('[data-native-longshot-ui="button"] button').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect.poll(()=>notice(page),{timeout:15000}).toContain('长图已复制');
    const second=PNG.sync.read(Buffer.from((await rawClipboard(page)).split(',')[1],'base64'));
    const box=await page.locator('#answer2').boundingBox();
    const native=PNG.sync.read(await page.screenshot());
    const crop=new PNG({width:second.width,height:second.height});
    PNG.bitblt(native,crop,Math.round(box.x-8),Math.round(box.y),crop.width,crop.height,0,0);
    assert.equal(diff(second,crop).pixels,0,'clicked second answer only');
    const extensionPage=await context.newPage();
    await extensionPage.goto(worker.url().replace('background.js','preview.html'));
    const rejected=await extensionPage.evaluate(()=>chrome.runtime.sendMessage({channel:'native-longshot-v1',type:'begin',job:'forbidden-source'}));
    assert.equal(rejected.ok,false);assert.match(rejected.error,/仅允许 ChatGPT/);
    await extensionPage.close();await page.bringToFront();
    await page.evaluate(()=>{document.querySelector('main').replaceChildren();});
    assert.equal(await page.locator('[data-native-longshot-ui="button"]').count(),0);
    records.push({label:'multi-turn-target-spa-dedup-origin-boundary',passed:true});
  }
  assert.deepEqual(errors,[],'no page JS errors');
 }catch(e){failed=true;console.error(e);if(process.env.FAIL_FAST==='1')break;}
 finally{await context?.close();await rm(dir,{recursive:true,force:true});}
}
await new Promise(resolve=>server.close(resolve));
await writeFile(`artifacts/results${process.env.HEADED==='1'?'-headed':process.env.EXTRA_ONLY==='1'?'-extra':''}.json`,JSON.stringify({browser:chromium.executablePath(),mode:process.env.HEADED==='1'?'headed':'headless',date:new Date().toISOString(),records},null,2));
if(failed)process.exitCode=1;
