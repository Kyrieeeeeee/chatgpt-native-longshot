import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const sourceRoot=path.resolve(process.env.THINKING_SOURCE||'.');
const label=process.env.THINKING_LABEL||'current';
const source=await build({entryPoints:[path.join(sourceRoot,'src/thinking.ts')],bundle:true,write:false,format:'iife',globalName:'ThinkingModule',plugins:[{name:'capture-hotkey',setup(b){b.onResolve({filter:/thinking-hotkey$/},()=>({path:'hotkey',namespace:'probe'}));b.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:'export const installThinkingHotkey = fn => globalThis.__cycle = fn;'}));}}]});
const html=(await readFile('tests/thinking-fixture.html','utf8')).replace('<script src="thinking-fixture.js"></script>','');
const fixture=(await readFile('tests/thinking-fixture.js','utf8')).replace('new URLSearchParams(location.search)','new URLSearchParams(window.__params)');
const browser=await chromium.launch({headless:true}),records=[];
try{
 for(const params of ['', 'picker&slider&levels=低,中,高&selected=1','picker&slider&custom-slider&levels=低,中,高&selected=1','delay=250','picker&levels=Medium,High,Extra%20High']){
  for(let run=0;run<5;run++){
   const page=await browser.newPage();await page.setContent(html);await page.evaluate(params=>{window.__params=params;window.chrome={runtime:{id:'test',onMessage:{addListener(){}}}};window.__notices=[];window.__reads=0;const q=document.querySelectorAll.bind(document);document.querySelectorAll=(...args)=>{__reads++;return q(...args);};},params);
   await page.addScriptTag({content:fixture});await page.addScriptTag({content:source.outputFiles[0].text});
   await page.evaluate(()=>{ThinkingModule.installThinkingShortcut(text=>__notices.push({text,at:performance.now()}),()=>false);document.querySelector('[aria-label=Prompt]').focus();window.__start=performance.now();__cycle(1);});
   await page.waitForFunction(()=>__notices.some(n=>n.text.startsWith('思考强度已切换：')));
   const result=await page.evaluate(()=>({ms:__notices.find(n=>n.text.startsWith('思考强度已切换：')).at-__start,reads:__reads,clicks:fixtureClicks(),notices:__notices.map(n=>n.text)}));records.push({params,run,...result});await page.close();
  }
 }
 const output={label,browser:browser.version(),records};await writeFile(`artifacts/thinking-${label}.json`,JSON.stringify(output,null,2));
 for(const params of [...new Set(records.map(r=>r.params))]){const matches=records.filter(r=>r.params===params),times=matches.map(r=>r.ms).sort((a,b)=>a-b);console.log(JSON.stringify({params,medianMs:times[2],reads:matches.map(r=>r.reads),clicks:matches.map(r=>r.clicks)}));}
}finally{await browser.close();}
