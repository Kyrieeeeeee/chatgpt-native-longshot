import {PROMPT_EDITOR as EDITOR,isPromptSendButton} from './prompt-editor';
import {textHash} from './timeline-data';
import type {Prompt} from './prompt-data';
type Editor=HTMLElement|HTMLTextAreaElement;
type Token={start:number;label:string;name:string;content:string};
type State={editor:Editor;path:string;value:string;tokens:Token[];history:Map<string,Token[]>};
const value=(editor:Editor)=>editor instanceof HTMLTextAreaElement?editor.value:(()=>{const r=document.createRange();r.selectNodeContents(editor);return r.toString();})();
const clone=(tokens:Token[])=>tokens.map(t=>({...t}));
// Quill clipboard/draft hydration converts NBSP to a same-width plain space.
// Accept only that length-preserving transformation; never rewrite draft text.
const sameDraft=(editor:Editor,a:string,b:string)=>a===b||!!editor.closest('rich-textarea')&&a.replace(/\u00a0/g,' ')===b.replace(/\u00a0/g,' ');
const relabel=(tokens:Token[],text:string)=>tokens.map(t=>({...t,label:text.slice(t.start,t.start+t.label.length)}));
function range(editor:HTMLElement,start:number,end:number):Range|null{
 const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);const r=document.createRange();let pos=0,found=false;
 while(walker.nextNode()){const node=walker.currentNode as Text;
  if(!found&&start<=pos+node.length){r.setStart(node,Math.max(0,start-pos));found=true;}
  if(found&&end<=pos+node.length){r.setEnd(node,Math.max(0,end-pos));return r;}pos+=node.length;
 }return null;
}
function selection(editor:Editor):{start:number;end:number}|null{
 if(editor instanceof HTMLTextAreaElement)return {start:editor.selectionStart,end:editor.selectionEnd};
 const s=getSelection();if(!s?.rangeCount||!editor.contains(s.anchorNode)||!editor.contains(s.focusNode))return null;
 const selected=s.getRangeAt(0),r=document.createRange();r.selectNodeContents(editor);r.setEnd(selected.startContainer,selected.startOffset);const start=r.toString().length;r.setEnd(selected.endContainer,selected.endOffset);return {start,end:r.toString().length};
}
function replace(editor:Editor,start:number,end:number,text:string):boolean{
 editor.focus({preventScroll:true});if(editor instanceof HTMLTextAreaElement)editor.setSelectionRange(start,end);
 else{const r=range(editor,start,end);if(!r)return false;getSelection()?.removeAllRanges();getSelection()?.addRange(r);}
 return document.execCommand('insertText',false,text);
}
export function installPromptTokens(show:(text:string)=>void,busy:()=>boolean){
 const states=new Map<Editor,State>();let mutating=false,tabKey='',revision=0,frame=0,loadedRoute='';let write=Promise.resolve();
 const route=()=>location.origin+location.pathname;
 let enabled=true;let hydration=Promise.resolve();const waiting=new WeakSet<Editor>();
 let stored:{route:string;value:string;tokens:Token[]}|null=null;
 const host=document.createElement('div');host.dataset.nativeLongshotUi='prompt-tokens';
 const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>:host{position:fixed;inset:0;pointer-events:none;z-index:2147483644;font:13px system-ui}[hidden]{display:none!important}.prompt-token{position:fixed;pointer-events:auto;box-sizing:border-box;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;outline:1px solid #00a8e855;border-radius:999px;padding:0;gap:5px;color:#00a8e8;background:var(--editor-bg);box-shadow:inset 0 0 0 100px #00a8e814;cursor:default}.prompt-token svg{width:14px;height:14px;flex-shrink:0}.prompt-token .token-name{overflow:hidden;text-overflow:ellipsis;min-width:0}.token-preview{position:fixed;pointer-events:auto;white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;width:min(380px,calc(100vw - 24px));padding:12px;border:1px solid light-dark(#ddd,#444);border-radius:10px;background:light-dark(#fff,#252529);color:light-dark(#222,#eee);font:13px/1.6 system-ui;box-shadow:0 6px 24px #0003}.token-preview small{display:block;opacity:.6;margin-top:8px}</style><div class="token-preview" role="tooltip" hidden></div>`;
 document.documentElement.append(host);const preview=root.querySelector<HTMLElement>('.token-preview')!;
 const save=()=>{revision++;if(!tabKey)return;const key=tabKey+'.'+textHash(route());const state=[...states.values()].find(s=>s.editor.isConnected&&s.tokens.length);const data=state?{route:route(),value:state.value,tokens:clone(state.tokens)}:null;write=write.then(()=>chrome.storage.local.set({[key]:data})).catch(e=>show('胶囊草稿保存失败：'+String(e)));};
 function remember(s:State){s.history.set(s.value,clone(s.tokens));if(s.history.size>30)s.history.delete(s.history.keys().next().value!);}
 function sync(s:State,type=''){
  const next=value(s.editor);if(next===s.value)return;
  remember(s);
  if(sameDraft(s.editor,next,s.value)){s.tokens=relabel(s.tokens,next);s.value=next;remember(s);save();return;}
  if(type==='historyUndo'||type==='historyRedo')s.tokens=clone(s.history.get(next)??[]);
  else{let a=0,b=0;while(a<Math.min(s.value.length,next.length)&&s.value[a]===next[a])a++;while(b<Math.min(s.value.length-a,next.length-a)&&s.value[s.value.length-1-b]===next[next.length-1-b])b++;
   const oldEnd=s.value.length-b,delta=next.length-s.value.length;
   s.tokens=s.tokens.flatMap(t=>{if(a>=t.start+t.label.length)return [t];if(oldEnd<=t.start)return [{...t,start:t.start+delta}];return [];});
  }
  s.value=next;s.tokens=s.tokens.filter(t=>next.slice(t.start,t.start+t.label.length)===t.label);remember(s);save();
 }
 function restore(){if(!stored||stored.route!==route())return;const editor=document.querySelector<Editor>(EDITOR);if(!editor)return;const next=value(editor);if(!sameDraft(editor,next,stored.value))return;
  if(!states.has(editor))states.set(editor,{editor,path:stored.route,value:next,tokens:relabel(stored.tokens,next),history:new Map()});stored=null;
 }
 const chips=new Map<State,HTMLElement[]>(),mirrors=new Map<State,HTMLElement>();
 function paint(){frame=0;if(loadedRoute&&loadedRoute!==route()){states.clear();stored=null;preview.hidden=true;void loadDraft().catch(()=>{});}restore();if(!enabled){for(const s of states.values())if(s.editor.isConnected&&s.tokens.length)expand(s);if(busy()&&[...states.values()].some(s=>s.tokens.length))setTimeout(schedule,100);return;}
  // Read editor geometry once, then update the projected capsules together.
  const projected:{s:State;token:Token;index:number;rect:DOMRect;box:DOMRect;font:string;lineHeight:string;background:string}[]=[];
  const active=new Map<State,Set<number>>();
  for(const [editor,s]of [...states]){if(!editor.isConnected){const replacement=document.querySelector<Editor>(EDITOR);if(replacement&&sameDraft(replacement,value(replacement),s.value)&&!states.has(replacement)){states.delete(editor);s.editor=replacement;states.set(replacement,s);}else continue;}
   const target=s.editor;sync(s);if(!s.tokens.length)continue;const box=target.getBoundingClientRect();if(!box.width||!box.height)continue;
   const css=getComputedStyle(target),font=css.font,lineHeight=css.lineHeight;
   let background='';for(let el:HTMLElement|null=target;el;el=el.parentElement){const color=el===target?css.backgroundColor:getComputedStyle(el).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){background=color;break;}}
   background||=matchMedia('(prefers-color-scheme:dark)').matches?'#242424':'#fff';
   let source:HTMLElement=target;
   if(target instanceof HTMLTextAreaElement){let mirror=mirrors.get(s);if(!mirror){mirror=document.createElement('div');mirrors.set(s,mirror);root.append(mirror);}
    for(const property of ['font','line-height','letter-spacing','word-spacing','padding','border-width','box-sizing','text-indent','text-transform','tab-size','word-break','overflow-wrap'])mirror.style.setProperty(property,css.getPropertyValue(property));Object.assign(mirror.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',whiteSpace:'pre-wrap',overflow:'auto',visibility:'hidden',borderStyle:'solid'});if(mirror.textContent!==target.value)mirror.textContent=target.value;mirror.scrollTop=target.scrollTop;mirror.scrollLeft=target.scrollLeft;source=mirror;
   }
   for(const [index,token]of s.tokens.entries()){const rect=range(source,token.start,token.start+token.label.length)?.getBoundingClientRect();if(!rect||!rect.width||!rect.height||rect.bottom<box.top||rect.top>box.bottom)continue;
    if(!active.has(s))active.set(s,new Set());active.get(s)!.add(index);projected.push({s,token,index,rect,box,font,lineHeight,background});
   }
  }
  for(const [s,nodes]of chips){for(const [index,node]of nodes.entries())if(node&&!active.get(s)?.has(index)){node.remove();delete nodes[index];}if(!active.has(s))chips.delete(s);}
  for(const [s,mirror]of mirrors)if(!active.has(s)||!(s.editor instanceof HTMLTextAreaElement)){mirror.remove();mirrors.delete(s);}
  for(const {s,token,index,rect,box,font,lineHeight,background}of projected){let nodes=chips.get(s);if(!nodes){nodes=[];chips.set(s,nodes);}let chip=nodes[index];
   if(!chip){chip=document.createElement('span');nodes[index]=chip;chip.className='prompt-token';chip.setAttribute('role','button');chip.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/></svg>';const name=document.createElement('span');name.className='token-name';chip.append(name);chip.onmouseleave=()=>preview.hidden=true;chip.onmousedown=e=>e.preventDefault();root.append(chip);}
   if(chip.dataset.promptName!==token.name){chip.dataset.promptName=token.name;chip.setAttribute('aria-label',`提示词胶囊：${token.name}`);chip.lastElementChild!.textContent=token.name;}
   chip.style.font=font;chip.style.lineHeight=lineHeight;chip.style.left=`${rect.left}px`;chip.style.top=`${rect.top}px`;chip.style.width=`${Math.min(rect.width,box.right-rect.left)}px`;chip.style.height=`${rect.height}px`;chip.style.setProperty('--editor-bg',background);
   chip.onmouseenter=()=>{preview.textContent=token.content;const hint=document.createElement('small');hint.textContent='双击展开正文 · 发送时自动还原完整提示词';preview.append(hint);preview.hidden=false;const r=preview.getBoundingClientRect();preview.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-r.width-8))}px`;preview.style.top=`${Math.max(8,rect.top-r.height-8)}px`;};chip.ondblclick=()=>{expand(s,token);preview.hidden=true;};
  }
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
 function expand(s:State,only?:Token):boolean{
  if(busy())return false;sync(s);const selected=only?[only]:[...s.tokens];remember(s);mutating=true;
  try{for(const t of selected.sort((a,b)=>b.start-a.start)){const before=value(s.editor).length;if(!replace(s.editor,t.start,t.start+t.label.length,t.content))throw Error('编辑器未接受正文');s.tokens=s.tokens.filter(x=>x!==t);const delta=value(s.editor).length-before;s.tokens=s.tokens.map(x=>x.start>t.start?{...x,start:x.start+delta}:x);}
   s.value=value(s.editor);remember(s);save();schedule();return true;
  }catch(e){show('提示词展开失败，已阻止发送：'+String(e));return false;}finally{mutating=false;}
 }
 async function loadDraft(){if(!tabKey)return;const path=route();loadedRoute=path;const rev=revision,key=tabKey+'.'+textHash(path),data=await chrome.storage.local.get(key);if(rev!==revision||path!==route())return;const old=data[key] as typeof stored;if(old&&typeof old.route==='string'&&typeof old.value==='string'&&Array.isArray(old.tokens)&&old.tokens.every(t=>typeof t.start==='number'&&typeof t.label==='string'&&typeof t.name==='string'&&typeof t.content==='string')){stored=old;schedule();}}
 hydration=chrome.runtime.sendMessage({type:'native-longshot-tab-id'}).then(async result=>{if(typeof result?.tabId!=='number')return;tabKey=`nativeLongshot.promptDraft.${result.tabId}`;loadedRoute=route();if(revision)save();else await loadDraft();}).catch(()=>{});
 document.addEventListener('input',e=>{if(mutating)return;const editor=e.target instanceof Element?e.target.closest<Editor>(EDITOR):null;if(editor){const s=states.get(editor);if(s)sync(s,e instanceof InputEvent?e.inputType:'');schedule();}},true);
 const observer=new MutationObserver(records=>{if(records.some(r=>!(r.target instanceof Element&&r.target.closest('[data-native-longshot-ui]'))&&((r.target instanceof Element?r.target:r.target.parentElement)?.closest(EDITOR)||[...r.addedNodes].some(n=>n instanceof Element&&(n.matches(EDITOR)||n.querySelector(EDITOR))))))schedule();});observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 window.addEventListener('popstate',schedule);(window as unknown as {navigation?:EventTarget}).navigation?.addEventListener('currententrychange',schedule);
 document.addEventListener('scroll',()=>{preview.hidden=true;schedule();},true);window.addEventListener('resize',schedule);
 const current=(target:EventTarget|null)=>{restore();const s=target instanceof Element?states.get(target.closest<Editor>(EDITOR)!):undefined;return s?.path===route()?s:undefined;};
 function postponeMissing(editor:Editor,event:Event,replay:()=>void):boolean{if(states.get(editor)?.path===route()||!value(editor).includes('✦ '))return false;event.preventDefault();event.stopImmediatePropagation();if(waiting.has(editor))return true;waiting.add(editor);const path=route();void hydration.then(async()=>{if(path!==route()||!editor.isConnected)return;if(loadedRoute!==path){states.clear();stored=null;await loadDraft();}restore();if(states.get(editor)?.tokens.length)replay();else show('未找到胶囊正文，请重新选择提示词后发送。');}).catch(()=>show('胶囊草稿读取失败，已阻止发送。')).finally(()=>waiting.delete(editor));return true;}
 window.addEventListener('keydown',e=>{
  const editor=e.target instanceof Element?e.target.closest<Editor>(EDITOR):null,quickOpen=document.querySelector('[data-native-longshot-ui="prompts"]')?.shadowRoot?.querySelector<HTMLElement>('.quick')?.hidden===false;
  if(editor&&!quickOpen&&!e.isComposing&&e.key==='Enter'&&!e.altKey&&(!e.shiftKey||e.ctrlKey||e.metaKey)&&postponeMissing(editor,e,()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey}))))return;
  const s=current(e.target);
  // Quill handles undo in its own History module without a native historyUndo
  // input event. Observe the completed keyboard transaction, leaving it native.
  if(s&&!e.isComposing&&(e.ctrlKey||e.metaKey)&&!e.altKey&&s.editor.closest('rich-textarea')){
   const key=e.key.toLowerCase(),history=key==='z'?(e.shiftKey?'historyRedo':'historyUndo'):key==='y'?'historyRedo':null;
   if(history){requestAnimationFrame(()=>{if(s.editor.isConnected&&s.path===route()){sync(s,history);schedule();}});return;}
  }
  if(!s||e.isComposing||!s.tokens.length||document.querySelector('[data-native-longshot-ui="prompts"]')?.shadowRoot?.querySelector<HTMLElement>('.quick')?.hidden===false)return;
  if(['ArrowLeft','ArrowRight'].includes(e.key)&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){const sel=selection(s.editor);if(sel&&sel.start===sel.end){const t=s.tokens.find(t=>e.key==='ArrowLeft'?sel.start>t.start&&sel.start<=t.start+t.label.length:sel.start>=t.start&&sel.start<t.start+t.label.length);if(t){e.preventDefault();e.stopImmediatePropagation();const pos=e.key==='ArrowLeft'?t.start:t.start+t.label.length;if(s.editor instanceof HTMLTextAreaElement)s.editor.setSelectionRange(pos,pos);else{const r=range(s.editor,pos,pos);if(r){getSelection()?.removeAllRanges();getSelection()?.addRange(r);}}return;}}}
  if(e.key==='Enter'&&!e.altKey&&(!e.shiftKey||e.ctrlKey||e.metaKey)){e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(expand(s))setTimeout(()=>s.editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey})),0);}
  if(e.key==='Backspace'||e.key==='Delete'){sync(s);const sel=selection(s.editor);if(!sel)return;const t=s.tokens.find(t=>sel.start===sel.end&&(e.key==='Backspace'?sel.start>t.start&&sel.start<=t.start+t.label.length:sel.start>=t.start&&sel.start<t.start+t.label.length));if(t){e.preventDefault();e.stopImmediatePropagation();mutating=true;replace(s.editor,t.start,t.start+t.label.length,'');mutating=false;sync(s);schedule();}}
 },true);
 window.addEventListener('paste',e=>{const s=current(e.target);if(!s)return;sync(s);const sel=selection(s.editor);if(!sel)return;const affected=s.tokens.filter(t=>sel.end>t.start&&sel.start<t.start+t.label.length);if(!affected.length)return;const start=Math.min(sel.start,...affected.map(t=>t.start)),end=Math.max(sel.end,...affected.map(t=>t.start+t.label.length));if(s.editor instanceof HTMLTextAreaElement)s.editor.setSelectionRange(start,end);else{const r=range(s.editor,start,end);if(r){getSelection()?.removeAllRanges();getSelection()?.addRange(r);}}},true);
 window.addEventListener('beforeinput',event=>{if(mutating)return;const e=event as InputEvent,s=current(e.target);if(!s||e.isComposing)return;sync(s);const sel=selection(s.editor);if(!sel)return;const affected=s.tokens.filter(t=>sel.end>t.start&&sel.start<t.start+t.label.length);if(!affected.length)return;
  const start=Math.min(sel.start,...affected.map(t=>t.start)),end=Math.max(sel.end,...affected.map(t=>t.start+t.label.length));
  if(e.inputType.startsWith('delete')||e.inputType==='insertText'){e.preventDefault();mutating=true;replace(s.editor,start,end,e.inputType==='insertText'?e.data??'':'');mutating=false;sync(s);schedule();}
 },true);
 for(const kind of ['copy','cut'] as const)window.addEventListener(kind,event=>{const e=event as ClipboardEvent,s=current(e.target);if(!s||!e.clipboardData)return;sync(s);const sel=selection(s.editor);if(!sel)return;const affected=s.tokens.filter(t=>sel.end>t.start&&sel.start<t.start+t.label.length);if(!affected.length)return;const start=Math.min(sel.start,...affected.map(t=>t.start)),end=Math.max(sel.end,...affected.map(t=>t.start+t.label.length));let text=s.value.slice(start,end);
  const html=document.createElement('div');html.style.whiteSpace='pre-wrap';if(s.editor instanceof HTMLTextAreaElement)html.textContent=text;else{const fragment=range(s.editor,start,end)?.cloneContents();if(fragment)html.append(fragment);}
  for(const t of [...affected].sort((a,b)=>b.start-a.start)){const offset=t.start-start;text=text.slice(0,offset)+t.content+text.slice(offset+t.label.length);const r=range(html,offset,offset+t.label.length);if(r){r.deleteContents();r.insertNode(document.createTextNode(t.content));}}
  e.preventDefault();e.clipboardData.setData('text/plain',text);e.clipboardData.setData('text/html',html.outerHTML);if(kind==='cut'){mutating=true;replace(s.editor,start,end,'');mutating=false;sync(s);schedule();}
 },true);
 window.addEventListener('click',e=>{const button=e.target instanceof Element?e.target.closest<HTMLButtonElement>('button'):null;if(!button||!isPromptSendButton(button))return;
  const editor=button.closest('form')?.querySelector<Editor>(EDITOR)??document.querySelector<Editor>(EDITOR),s=editor&&current(editor);if(editor&&postponeMissing(editor,e,()=>button.click()))return;if(!s?.tokens.length)return;e.preventDefault();e.stopImmediatePropagation();if(expand(s))setTimeout(()=>button.click(),0);
 },true);
 window.addEventListener('submit',e=>{const form=e.target;if(!(form instanceof HTMLFormElement))return;const editor=form.querySelector<Editor>(EDITOR),s=editor&&current(editor);if(editor&&postponeMissing(editor,e,()=>form.requestSubmit()))return;if(!s?.tokens.length)return;e.preventDefault();e.stopImmediatePropagation();const submitter=(e as SubmitEvent).submitter;if(expand(s))setTimeout(()=>form.requestSubmit(submitter instanceof HTMLButtonElement?submitter:undefined),0);},true);
 return {insert(editor:Editor,p:Prompt,start:number,perform:(label:string)=>boolean){
  let s=states.get(editor);if(!s||s.path!==route()){s={editor,path:route(),value:value(editor),tokens:[],history:new Map()};states.set(editor,s);}sync(s);remember(s);
  const label=`✦ \u00a0${p.name}`;mutating=true;let ok=false;try{ok=perform(label);}finally{mutating=false;}
  if(!ok)return false;sync(s);s.tokens.push({start,label,name:p.name,content:p.content});s.tokens.sort((a,b)=>a.start-b.start);remember(s);save();schedule();return true;
 },text(editor:Editor){const s=current(editor);let text=editor instanceof HTMLTextAreaElement?editor.value:editor.innerText;if(!s)return text;sync(s);for(const t of [...s.tokens].sort((a,b)=>b.start-a.start)){const ordinal=s.value.slice(0,t.start).split(t.label).length-1;let at=-1;for(let i=0;i<=ordinal;i++)at=text.indexOf(t.label,at+1);if(at>=0)text=text.slice(0,at)+t.content+text.slice(at+t.label.length);}return text;},setEnabled(next:boolean){enabled=next;host.hidden=!next;if(!next)preview.hidden=true;schedule();}};
}
