import {installPrompts} from './prompts';
import {DEFAULT_SETTINGS,readSettings,SETTINGS_KEY} from './settings';
const globals=globalThis as typeof globalThis & {__nativeLongshotGemini?:boolean};
if(!globals.__nativeLongshotGemini){globals.__nativeLongshotGemini=true;install();}
function install():void {
 const host=document.createElement('div');host.dataset.nativeLongshotUi='notice';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML='<style>:host{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647}.notice{max-width:min(580px,85vw);padding:12px 16px;background:light-dark(#fff,#292929);color:light-dark(#222,#eee);border:1px solid light-dark(#ddd,#555);border-radius:8px;font:13px/1.6 system-ui}.notice:empty{display:none}</style><div class="notice" role="status" aria-live="polite"></div>';
 document.documentElement.append(host);
 const text=root.querySelector<HTMLElement>('.notice')!;let dismiss:ReturnType<typeof setTimeout>|undefined;
 const show=(message:string)=>{clearTimeout(dismiss);text.textContent=message;dismiss=setTimeout(()=>text.textContent='',6500);};
 const prompts=installPrompts(show,()=>false);
 let settings={...DEFAULT_SETTINGS},revision=0;
 const apply=(value:unknown)=>{settings=readSettings(value);prompts.setEnabled(settings.prompts);};
 void chrome.storage.local.get(SETTINGS_KEY).then(data=>{if(!revision)apply(data[SETTINGS_KEY]);}).catch(e=>show('设置读取失败：'+String(e)));
 chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.type==='native-longshot-settings'){revision++;apply(message.settings);respond({ok:true});}
  if(message?.type==='native-longshot-open-prompts'){if(settings.prompts)prompts.open();respond({ok:settings.prompts});}
 });
}
