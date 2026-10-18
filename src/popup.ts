import {DEFAULT_SETTINGS,readSettings,SETTINGS_KEY,type Settings} from './settings';
import {parsePrompts,mergePrompts,PROMPT_KEY,type Prompt} from './prompt-data';
const $=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
let settings:Settings={...DEFAULT_SETTINGS};
const status=(message:string)=>{$('#status').textContent=message;};
async function send(type:string):Promise<boolean>{
 try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.id===undefined)return false;
 const result=await chrome.tabs.sendMessage(tab.id,{type,settings});return result?.ok===true;}catch{return false;}
}
function render():void{
 for(const key of ['prompts','latex','widthEnabled','timeline'] as const)$<HTMLInputElement>('#'+key).checked=settings[key];
 $<HTMLInputElement>('#width').value=String(settings.width);$('#width-value').textContent=`${settings.width}%`;
 document.documentElement.style.colorScheme=settings.theme==='auto'?'light dark':settings.theme;
 $('#width-controls').hidden=!settings.widthEnabled;
 $('#timeline-controls').hidden=!settings.timeline;
 $<HTMLSelectElement>('#timeline-style').value=settings.timelineStyle;
 $<HTMLSelectElement>('#timeline-motion').value=settings.timelineSmooth?'smooth':'instant';
 document.querySelectorAll<HTMLButtonElement>('[data-width]').forEach(b=>b.setAttribute('aria-pressed',String(settings.widthEnabled&&Number(b.dataset.width)===settings.width)));
}
let saving=Promise.resolve();
let pending:Settings|undefined,savingNow=false;
async function flushSettings():Promise<void>{
 try{
 while(pending){
  const snapshot=pending;pending=undefined;
  try{
   await chrome.storage.local.set({[SETTINGS_KEY]:snapshot});
   const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
   const applied=tab?.id!==undefined?await chrome.tabs.sendMessage(tab.id,{type:'native-longshot-settings',settings:snapshot}).then(r=>r?.ok===true,()=>false):false;
   status(applied?'已保存并应用到当前页面。':'已保存，下次打开或刷新 ChatGPT / Gemini 时生效。');
  }catch(e){status('保存失败：'+String(e));}
 }
 }finally{savingNow=false;}
}
function save():void {
 pending={...settings};
 // Start the first write immediately. While it is in flight, only the latest
 // complete snapshot matters; callers awaiting saving still wait for its drain.
 if(!savingNow){savingNow=true;saving=flushSettings();}
 render();
}
void chrome.storage.local.get(SETTINGS_KEY).then(data=>{settings=readSettings(data[SETTINGS_KEY]);render();}).catch(e=>status('读取失败：'+String(e)));
$('.version').textContent=chrome.runtime.getManifest().version;
for(const key of ['prompts','latex','widthEnabled','timeline'] as const)$<HTMLInputElement>('#'+key).onchange=e=>{settings[key]=(e.target as HTMLInputElement).checked;save();};
$<HTMLInputElement>('#width').oninput=e=>{settings.width=Number((e.target as HTMLInputElement).value);save();};
document.querySelectorAll<HTMLButtonElement>('[data-width]').forEach(b=>b.onclick=()=>{settings.width=Number(b.dataset.width);settings.widthEnabled=true;save();});
$('#native-width').onclick=()=>{settings.widthEnabled=false;save();};
$('#theme').onclick=()=>{const dark=settings.theme==='auto'?matchMedia('(prefers-color-scheme: dark)').matches:settings.theme==='dark';settings.theme=dark?'light':'dark';save();};
$('#open-prompts').onclick=()=>{void saving.then(async()=>{const ok=await send('native-longshot-open-prompts');if(ok)window.close();else status('请在 ChatGPT 或 Gemini 页面打开提示词库。');});};
$('#export').onclick=()=>{void chrome.storage.local.get(PROMPT_KEY).then(data=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,prompts:data[PROMPT_KEY]??[]},null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='chatgpt-prompts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('提示词已导出。');
}).catch(e=>status('导出失败：'+String(e)));};
$('#import').onclick=()=>$<HTMLInputElement>('#file').click();
$<HTMLInputElement>('#file').onchange=async()=>{
 const input=$<HTMLInputElement>('#file');try{const file=input.files?.[0];if(!file)return;
 const imported=parsePrompts(JSON.parse(await file.text()));const data=await chrome.storage.local.get(PROMPT_KEY);const existing:Prompt[]=Array.isArray(data[PROMPT_KEY])?data[PROMPT_KEY]:[];const before=existing.length;const next=mergePrompts(existing,imported);
 await chrome.storage.local.set({[PROMPT_KEY]:next});status(`已导入 ${next.length-before} 条提示词，重复项跳过。`);
 }catch(e){status('导入失败：'+String(e));}finally{input.value='';}
};

$<HTMLSelectElement>('#timeline-style').onchange=e=>{const value=(e.target as HTMLSelectElement).value;settings.timelineStyle=value==='ruler'||value==='dots'?value:'compact';save();};
$<HTMLSelectElement>('#timeline-motion').onchange=e=>{settings.timelineSmooth=(e.target as HTMLSelectElement).value==='smooth';save();};
$('#open-timeline').onclick=()=>{void saving.then(async()=>{if(await send('native-longshot-open-timeline'))window.close();else status('请在 ChatGPT 页面打开时间线。');});};
$('#reset-timeline').onclick=()=>{void saving.then(async()=>status(await send('native-longshot-reset-timeline')?'时间线位置已重置。':'请在 ChatGPT 页面重置。'));};
