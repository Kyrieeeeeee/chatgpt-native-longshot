import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=async name=>(await build({entryPoints:[`src/${name}.ts`],bundle:true,write:false,format:'iife',globalName:'PerfModule',define:{__TEST__:'false'}})).outputFiles[0].text;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>.fixed{position:fixed;top:0}</style><div id="cssom">CSSOM 元素</div><div id="external">普通元素</div><div id="shadow-host"></div><article id="answer">正文</article>');
 await page.evaluate(()=>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<span>普通组件</span>');
 await page.addScriptTag({content:await bundle('page-state')});
 await page.evaluate(()=>{window.__state=new PerfModule.PageState(document.querySelector('#answer'),new AbortController().signal);__state.hideInterference();__state.safeRect();});
 await expect(page.locator('#external')).toBeVisible();
 await page.evaluate(()=>{document.styleSheets[0].insertRule('#cssom{position:fixed;top:0}',0);__state.hideInterference();});
 await expect(page.locator('#cssom')).toHaveCSS('visibility','hidden');
 await page.evaluate(()=>{document.querySelector('#external').className='fixed';__state.hideInterference();});
 await expect(page.locator('#external')).toHaveCSS('visibility','hidden');
 await page.evaluate(()=>document.querySelector('#shadow-host').shadowRoot.innerHTML='<div style="position:fixed;top:10px">新浮层</div>');
 await page.evaluate(()=>__state.hideInterference());
 await expect(page.locator('#shadow-host')).toHaveCSS('opacity','0');
 await page.evaluate(()=>{const sticky=document.createElement('div');sticky.id='new-sticky';sticky.style.cssText='position:sticky;top:0;height:32px';const answer=document.querySelector('#answer');answer.style.height='2000px';answer.prepend(sticky);scrollTo(0,answer.offsetTop);});
 const safe=await page.evaluate(()=>{__state.hideInterference();return __state.safeRect();});assert.ok(safe.top>=32,'new sticky is included in clipping');
 await page.evaluate(()=>__state.restore());await expect(page.locator('#external')).toHaveCSS('visibility','visible');await expect(page.locator('#shadow-host')).toHaveCSS('opacity','1');
 const stability=await page.evaluate(async()=>{
  const state=new PerfModule.PageState(document.querySelector('#answer'),new AbortController().signal),original=window.setTimeout;
  let waits=0;window.setTimeout=(fn,ms,...args)=>{if(ms===50)waits++;return original(fn,ms,...args);};
  try{
   const token=await state.settle(),full=waits;waits=0;await state.settle(token);const reused=waits;
   // Same geometry, pending attribute mutation: must drain and reject reuse.
   document.querySelector('#answer').dataset.performanceProbe='changed';waits=0;
   const changed=await state.settle(token);return {full,reused,changedWaits:waits,different:changed!==token};
  }finally{window.setTimeout=original;state.restore();}
 });
 assert.ok(stability.full>=3);assert.equal(stability.reused,0);assert.ok(stability.changedWaits>=3);assert.equal(stability.different,true);
 console.log('PASS immediate stable signature reuse; pending same-geometry DOM mutation forces full stability verification');
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
 await page.evaluate(()=>{for(let i=0;i<25;i++){const state=new PerfModule.PageState(document.querySelector('#answer'),new AbortController().signal);state.hideInterference();state.safeRect();state.restore();}});
 await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');assert.equal(after.nodes,before.nodes);assert.equal(after.jsEventListeners,before.jsEventListeners);
 console.log('PASS computed-style checks: CSSOM, class, inserted open-Shadow overlay, new sticky, restoration, stable DOM/listener counts after 25 capture-state cycles');
 await page.close();
 const timeline=await browser.newPage();
 await timeline.setContent('<main>'+Array.from({length:100},(_,i)=>`<article data-testid="conversation-turn-q-${i}"><div data-message-author-role="user">问题 ${i}</div></article><article><div data-message-author-role="assistant">回复 ${i}</div></article>`).join('')+'</main>');
 await timeline.evaluate(()=>{window.chrome={runtime:{sendMessage:async()=>({})},storage:{local:{get:async()=>({}),set:async()=>{}}}};window.__busy=false;});
 await timeline.addScriptTag({content:await bundle('timeline')});
 await timeline.evaluate(()=>{window.__settings={timeline:true,timelineStyle:'ruler',timelineSmooth:false};window.__timeline=PerfModule.installTimeline(()=>__busy);__timeline.apply(__settings);window.__first=document.querySelector('[data-native-longshot-ui="timeline"]').shadowRoot.querySelector('.node');});
 await timeline.evaluate(()=>{document.querySelectorAll('[data-message-author-role="assistant"]')[50].firstChild.data='只在回复里出现的新关键词';});await timeline.waitForTimeout(250);
 assert.equal(await timeline.evaluate(()=>__first===document.querySelector('[data-native-longshot-ui="timeline"]').shadowRoot.querySelector('.node')),true,'streaming keeps rail node identity');
 await timeline.evaluate(()=>__timeline.open());await timeline.getByRole('textbox',{name:'搜索时间线'}).fill('新关键词');await expect(timeline.locator('.timeline-row')).toHaveCount(1);await expect(timeline.locator('.question-title')).toContainText('问题 50');
 await timeline.getByRole('button',{name:'关闭时间线列表'}).click();
 await timeline.evaluate(()=>{__busy=true;document.querySelectorAll('[data-message-author-role="assistant"]')[51].firstChild.data='捕获结束后检索我';});await timeline.waitForTimeout(250);await timeline.evaluate(()=>__busy=false);await timeline.waitForTimeout(250);
 await timeline.evaluate(()=>__timeline.open());await timeline.getByRole('textbox',{name:'搜索时间线'}).fill('检索我');await expect(timeline.locator('.question-title')).toHaveText('问题 51');
 await timeline.evaluate(()=>__timeline.apply({...__settings,timeline:false}));await expect(timeline.locator('.node')).toHaveCount(0);await expect(timeline.locator('.timeline-row')).toHaveCount(0);
 await timeline.evaluate(()=>{document.querySelectorAll('[data-message-author-role="assistant"]')[51].textContent='重新启用后的回复';__timeline.apply(__settings);__timeline.open();});await timeline.getByRole('textbox',{name:'搜索时间线'}).fill('重新启用');await expect(timeline.locator('.question-title')).toHaveText('问题 51');
 await timeline.getByRole('textbox',{name:'搜索时间线'}).fill('');await timeline.locator('.timeline-list').evaluate(el=>el.scrollTop=300);await timeline.getByRole('button',{name:'关闭时间线列表'}).click();await expect(timeline.locator('.timeline-row')).toHaveCount(0);
 await timeline.locator('.index').hover();await expect(timeline.getByRole('dialog',{name:'时间线问题列表'})).toBeVisible();assert.equal(await timeline.locator('.timeline-list').evaluate(el=>el.scrollTop),300,'hover restores scroll without retaining hidden rows');
 await timeline.close();
 console.log('PASS timeline incremental reply search, rail identity, capture busy/resume and disable/re-enable');
 const prompts=await browser.newPage();prompts.on('pageerror',e=>errors.push(e.message));await prompts.setContent('<textarea id="prompt-textarea"></textarea>');
 await prompts.evaluate(()=>{const listeners=[];window.__emit=changes=>listeners.forEach(fn=>fn(changes,'local'));window.chrome={runtime:{sendMessage:async()=>({})},storage:{local:{get:keys=>Array.isArray(keys)?new Promise(resolve=>window.__initialRead=resolve):Promise.resolve({}),set:async()=>{}},onChanged:{addListener:fn=>listeners.push(fn)}}};});
 await prompts.addScriptTag({content:await bundle('prompts')});
 await prompts.evaluate(()=>{window.__prompts=PerfModule.installPrompts(()=>{},()=>false);__emit({'nativeLongshot.prompts.v1':{newValue:[{id:'new',name:'较新的数据',content:'new',tags:[]}]}});__initialRead({'nativeLongshot.prompts.v1':[{id:'old',name:'迟到的旧数据',content:'old',tags:[]}]});});
 await prompts.evaluate(()=>__prompts.open());await expect(prompts.getByRole('button',{name:'使用提示词：较新的数据',exact:true})).toBeVisible();await expect(prompts.getByRole('button',{name:'使用提示词：迟到的旧数据',exact:true})).toHaveCount(0);await prompts.close();
 console.log('PASS late initial prompt read cannot overwrite a newer storage change');
 const latex=await browser.newPage();latex.on('pageerror',e=>errors.push(e.message));await latex.setContent('<span class="katex" data-math="x^2">公式</span><div id="outside">正文</div>');await latex.addScriptTag({content:await bundle('latex')});
 const hovering=await latex.evaluate(()=>{
  const api=PerfModule.installLatexCopy(()=>{},()=>false),set=window.setTimeout;let scheduled=0;
  window.setTimeout=(...args)=>{scheduled++;return set(...args);};
  const formula=document.querySelector('.katex'),outside=document.querySelector('#outside');
  const over=el=>el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
  try{
   for(let i=0;i<100;i++){over(formula);over(outside);}
   over(formula);const marked=formula.hasAttribute('data-native-latex-copy');api.setEnabled(false);
   return {scheduled,marked,cleared:!formula.hasAttribute('data-native-latex-copy'),buttons:document.querySelectorAll('[data-native-longshot-ui="latex"]').length};
  }finally{window.setTimeout=set;}
 });
 assert.deepEqual(hovering,{scheduled:0,marked:true,cleared:true,buttons:0});await latex.close();
 assert.deepEqual(errors,[]);console.log('PASS direct LaTeX hover has no timers or copy-button nodes; disabling clears marker');
}finally{await browser.close();}
