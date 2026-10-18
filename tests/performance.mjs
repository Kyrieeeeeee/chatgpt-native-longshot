import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Same browser, fixtures and work for both source snapshots; no user profile.
const sourceRoot=path.resolve(process.env.PERF_SOURCE||'.');
const label=process.env.PERF_LABEL||'current';
const scenarios=process.env.PERF_SCENARIOS?.split(',');
const shouldRun=name=>!scenarios||scenarios.includes(name);
const bundle=async name=>(await build({entryPoints:[path.join(sourceRoot,`src/${name}.ts`)],bundle:true,write:false,format:'iife',globalName:'PerfModule',define:{__TEST__:'false'}})).outputFiles[0].text;
const sources=Object.fromEntries(await Promise.all(['prompts','timeline','layout','page-state','stitcher'].map(async n=>[n,await bundle(n)])));
const browser=await chromium.launch({headless:true});const records=[];
async function fixture(html,data={}){
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.setContent(html);
 await page.evaluate(data=>{
  window.__stats={created:0,styles:0,attributes:0};
  const create=document.createElement.bind(document);document.createElement=(...args)=>{__stats.created++;return create(...args);};
  const style=window.getComputedStyle;window.getComputedStyle=(...args)=>{__stats.styles++;return style(...args);};
  const attr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(...args){__stats.attributes++;return attr.apply(this,args);};
  const listeners=[];window.__data=data;window.__emit=changes=>listeners.forEach(fn=>fn(changes,'local'));
  window.__reads=[];window.chrome={runtime:{sendMessage:async()=>({})},storage:{local:{get:async keys=>{__reads.push(keys);return structuredClone(__data);},set:async values=>{
   const changes=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{newValue:structuredClone(v)}]));Object.assign(__data,structuredClone(values));queueMicrotask(()=>__emit(changes));
  }},onChanged:{addListener:fn=>listeners.push(fn)}}};
 },data);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const metrics=async()=>{await cdp.send('HeapProfiler.collectGarbage');const {metrics}=await cdp.send('Performance.getMetrics');return {...Object.fromEntries(metrics.map(m=>[m.name,m.value])),...await cdp.send('Memory.getDOMCounters')};};
 return {page,metrics};
}
try{
 for(let run=0;run<3;run++){
  if(shouldRun('layout-disabled')){
   const {page}=await fixture('');await page.addScriptTag({content:sources.layout});
   const result=await page.evaluate(async()=>{const t=performance.now();PerfModule.installLayout(()=>false).apply({timeline:false,widthEnabled:false});await Promise.resolve();return {ms:performance.now()-t,...__stats,timelineHosts:document.querySelectorAll('[data-native-longshot-ui="timeline"]').length,storageReads:__reads.length};});records.push({run,scenario:'layout-disabled',...result});await page.close();
  }
  if(shouldRun('prompts-1000')){
   const prompts=Array.from({length:1000},(_,i)=>({id:String(i),name:`提示词 ${i}`,content:`正文 ${i} `+'保持原有语义。'.repeat(60),tags:[`group${i%10}`,'学习'],useCount:i%7}));
   const {page,metrics}=await fixture('<textarea id="prompt-textarea"></textarea>',{'nativeLongshot.prompts.v1':prompts});
   const base=await metrics();await page.addScriptTag({content:sources.prompts});
   const init=await page.evaluate(async()=>{const t=performance.now();window.__prompts=PerfModule.installPrompts(()=>{},()=>false);const installMs=performance.now()-t;await Promise.resolve();await Promise.resolve();const readyMs=performance.now()-t;await new Promise(r=>setTimeout(r,30));return {ms:performance.now()-t,installMs,readyMs,...__stats};});
   const initial=await metrics();
   const open=await page.evaluate(()=>{const t=performance.now();__prompts.open();return performance.now()-t;});
   const oneChanged=process.env.PERF_SKIP_EDIT==='1'?null:await page.evaluate(()=>{const values=structuredClone(__data['nativeLongshot.prompts.v1']);values[999].name='changed one';__stats.created=0;const t=performance.now();__emit({'nativeLongshot.prompts.v1':{newValue:values}});return {ms:performance.now()-t,created:__stats.created};});
   const searches=await page.evaluate(()=>{const search=document.querySelector('[data-native-longshot-ui="prompts"]').shadowRoot.querySelector('.search');return ['提示词 9','group3','没有匹配',''].map(q=>{search.value=q;const t=performance.now();search.dispatchEvent(new Event('input'));return performance.now()-t;});});
   await page.evaluate(()=>document.querySelector('[data-native-longshot-ui="prompts"]').shadowRoot.querySelector('.close').click());
   const quick=await page.evaluate(async()=>{const editor=document.querySelector('#prompt-textarea');editor.focus();editor.value='/';editor.setSelectionRange(1,1);editor.dispatchEvent(new InputEvent('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));__stats.attributes=0;const t=performance.now();for(let i=0;i<20;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const result={ms:performance.now()-t,attributes:__stats.attributes};window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));editor.value='';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return result;});
   const closed=await page.evaluate(()=>{__stats.created=0;__emit({'nativeLongshot.prompts.v1':{newValue:__data['nativeLongshot.prompts.v1']}});return {created:__stats.created,rows:document.querySelector('[data-native-longshot-ui="prompts"]').shadowRoot.querySelectorAll('.row').length};});
   const end=await metrics();
   await page.evaluate(()=>{for(let i=0;i<10;i++){__prompts.open();document.querySelector('[data-native-longshot-ui="prompts"]').shadowRoot.querySelector('.close').click();}});
   const repeated=await metrics();records.push({run,scenario:'prompts-1000',init,openMs:open,oneChanged,searchMs:searches,quick,closed,initHeapBytes:initial.JSHeapUsedSize-base.JSHeapUsedSize,closedHeapBytes:end.JSHeapUsedSize-base.JSHeapUsedSize,closedNodes:end.nodes-base.nodes,closedListeners:end.jsEventListeners-base.jsEventListeners,repeatHeapDelta:repeated.JSHeapUsedSize-end.JSHeapUsedSize,repeatNodesDelta:repeated.nodes-end.nodes,repeatListenersDelta:repeated.jsEventListeners-end.jsEventListeners});await page.close();
  }
  if(shouldRun('timeline-500')){
   const html='<main style="height:800px;overflow:auto">'+Array.from({length:500},(_,i)=>`<article data-testid="conversation-turn-q-${i}"><div data-message-author-role="user">问题 ${i}</div></article><article><div data-message-author-role="assistant" style="min-height:60px">回答 ${i}</div></article>`).join('')+'</main>';
   const {page,metrics}=await fixture(html);await page.addScriptTag({content:sources.timeline});
   const init=await page.evaluate(()=>{const t=performance.now();window.__timeline=PerfModule.installTimeline(()=>window.__busy===true);window.__settings={timeline:true,timelineStyle:'compact',timelineSmooth:false};__timeline.apply(__settings);return {ms:performance.now()-t,...__stats};});
   await page.waitForTimeout(300);const base=await metrics();
   await page.evaluate(()=>{__stats.created=0;__stats.attributes=0;});
   for(let i=0;i<12;i++){await page.evaluate(i=>document.querySelectorAll('[data-message-author-role="assistant"]')[499].firstChild.data=`回答 499 token ${i}`,i);await page.waitForTimeout(210);}
   const end=await metrics();const streamed=await page.evaluate(()=>({...__stats,rows:document.querySelector('[data-native-longshot-ui="timeline"]').shadowRoot.querySelectorAll('.timeline-row').length}));
   const scrollWrites=await page.evaluate(async()=>{__stats.attributes=0;const scroller=document.querySelector('main');for(let i=0;i<20;i++){scroller.dispatchEvent(new Event('scroll'));await new Promise(requestAnimationFrame);}return __stats.attributes;});
   await page.evaluate(()=>__timeline.apply({...__settings,timeline:false}));
   const disabled=await metrics();records.push({run,scenario:'timeline-500',init,streamed,streamTaskMs:(end.TaskDuration-base.TaskDuration)*1000,streamLayoutMs:(end.LayoutDuration-base.LayoutDuration)*1000,scrollWrites,enabledHeapBytes:end.JSHeapUsedSize,disabledHeapBytes:disabled.JSHeapUsedSize});await page.close();
  }
  if(shouldRun('capture-dom-7000')){
   const html='<section>'+('<div><span>无关消息</span></div>'.repeat(2500))+'</section><article id="answer">'+('<p><span>目标内容</span></p>'.repeat(1000))+'<div style="position:sticky;top:0">标题</div></article>';
   const {page}=await fixture(html);await page.addScriptTag({content:sources['page-state']});
   const result=await page.evaluate(async()=>{const c=new AbortController(),state=new PerfModule.PageState(document.querySelector('#answer'),c.signal);__stats.styles=0;const t=performance.now();for(let i=0;i<10;i++){state.hideInterference();state.safeRect();}const result={ms:performance.now()-t,styles:__stats.styles};state.restore();return result;});
   records.push({run,scenario:'capture-dom-7000',...result});await page.close();
  }
  if(shouldRun('decode-10')){
   const {page}=await fixture('');await page.addScriptTag({content:sources.stitcher});
   const result=await page.evaluate(async()=>{const bytes=new Uint8Array(65536);let seed=12345;for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=seed&255;}const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d'),image=ctx.createImageData(512,512);for(let i=0;i<image.data.length;i++)image.data[i]=bytes[i%bytes.length];ctx.putImageData(image,0,0);const data=canvas.toDataURL().split(',')[1];const t=performance.now();for(let i=0;i<10;i++){const image=await PerfModule.bitmap(data);image.close();}return {ms:performance.now()-t,encodedBytes:data.length};});records.push({run,scenario:'decode-10',...result});await page.close();
  }
 }
 await mkdir('artifacts',{recursive:true});const result={date:new Date().toISOString(),label,sourceRoot,browser:browser.version(),records};await writeFile(`artifacts/performance-${label}.json`,JSON.stringify(result,null,2));
 if(process.env.PERF_ASSERT==='1'||process.argv.includes('--assert')){
  for(const r of records){if(r.scenario==='layout-disabled'){assert.equal(r.timelineHosts,0);assert.equal(r.storageReads,0);}if(r.scenario==='prompts-1000'){assert.deepEqual(r.closed,{created:0,rows:0});if(r.oneChanged)assert.ok(r.oneChanged.created<40);assert.ok(r.quick.attributes<=60);assert.equal(r.repeatNodesDelta,0);assert.equal(r.repeatListenersDelta,0);}if(r.scenario==='timeline-500'){assert.equal(r.streamed.created,0);assert.equal(r.streamed.rows,0);assert.equal(r.scrollWrites,0);}}
 }
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
