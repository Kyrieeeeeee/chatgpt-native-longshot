// Queue discrete presses without overlapping native menus or touching site APIs.
import {installThinkingHotkey} from './thinking-hotkey';
import {createThinkingQueue} from './thinking-queue';
import {createThinkingSession,closeThinkingSession,switchThinking,thinkingOwnsFocus,type ThinkingSession} from './thinking-controls';
export {levelOf} from './thinking-controls';
interface FocusSnapshot {
 element:HTMLElement; text:string;
 input?:{start:number|null;end:number|null;direction:'forward'|'backward'|'none'|null;value:string};
 selection?:{anchor:Node;anchorOffset:number;focus:Node;focusOffset:number};
}
function focusSnapshot():FocusSnapshot|undefined {
 const element=document.activeElement;if(!(element instanceof HTMLElement)||element===document.body)return;
 const snapshot:FocusSnapshot={element,text:element.textContent??''};
 if(element instanceof HTMLTextAreaElement||element instanceof HTMLInputElement)
  snapshot.input={start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection,value:element.value};
 else{const s=getSelection();if(s?.anchorNode&&s.focusNode&&element.contains(s.anchorNode)&&element.contains(s.focusNode))snapshot.selection={anchor:s.anchorNode,anchorOffset:s.anchorOffset,focus:s.focusNode,focusOffset:s.focusOffset};}
 return snapshot;
}
function restoreFocus(snapshot:FocusSnapshot|undefined):void {
 if(!snapshot?.element.isConnected)return;
 const el=snapshot.element;el.focus({preventScroll:true});
 const input=snapshot.input;
 if(input&&(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)&&el.value===input.value&&input.start!==null&&input.end!==null)
  try{el.setSelectionRange(input.start,input.end,input.direction??undefined);}catch{/* Site changed the original input type; preserve its current state. */}
 const s=snapshot.selection;
 const valid=(node:Node,offset:number)=>offset>=0&&offset<=(node instanceof CharacterData?node.length:node.childNodes.length);
 if(s&&el.textContent===snapshot.text&&el.contains(s.anchor)&&el.contains(s.focus)&&valid(s.anchor,s.anchorOffset)&&valid(s.focus,s.focusOffset)){
  try{getSelection()?.setBaseAndExtent(s.anchor,s.anchorOffset,s.focus,s.focusOffset);}catch{/* Native editor rebuilt its selection; leave the live caret alone. */}
 }
}
function shortcutKey(e:KeyboardEvent):boolean {
 if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.isComposing||e.keyCode===229)return false;
 return e.key==='End'||e.code==='End'||e.keyCode===35||e.key==='Home'||e.code==='Home'||e.keyCode===36||
  (e.getModifierState('Fn')&&(e.key==='ArrowLeft'||e.code==='ArrowLeft'||e.key==='ArrowRight'||e.code==='ArrowRight'));
}
export function installThinkingShortcut(show:(message:string)=>void,captureBusy:()=>boolean):{isBusy:()=>boolean}{
 let session:ThinkingSession|undefined,focus:FocusSnapshot|undefined,userIntent=false,cancelReason='';
 const queue=createThinkingQueue({
  onStart(){session=createThinkingSession();session.check=()=>{if(captureBusy())throw new Error('截图结束后再切换思考强度。');};focus=focusSnapshot();userIntent=false;cancelReason='';show('正在切换思考强度…');},
  async run(direction,signal){
   if(signal.aborted)throw signal.reason;
   if(captureBusy())throw new Error('截图结束后再切换思考强度。');
   if(!session||session.url!==location.href)throw new Error('页面已变化，请重新切换思考强度。');
   const next=await switchThinking(direction,signal,session);
   if(signal.aborted)throw signal.reason;
   show('思考强度已切换：'+next);
  },
  onError(error){show(error instanceof Error?error.message:'切换思考强度失败。');},
  onIdle(){
   const active=document.activeElement;
   const restore=!userIntent&&!document.hidden&&(active===document.body||active===focus?.element||!!session&&thinkingOwnsFocus(session,active));
   try{if(session)closeThinkingSession(session);if(restore)restoreFocus(focus);}
   finally{session=undefined;focus=undefined;if(cancelReason&&!document.hidden)show(cancelReason);cancelReason='';}
  },
 });
 const cancel=(reason:string,user=false)=>{if(!queue.isBusy())return;userIntent||=user;cancelReason=reason;queue.cancel();};
 // A user's subsequent action owns the focus/caret. Never steal it back from
 // another dialog or restore a selection captured before their latest editing.
 document.addEventListener('pointerdown',e=>{if(e.isTrusted)cancel('已停止切换思考强度。',true);},true);
 window.addEventListener('keydown',e=>{if(e.isTrusted&&!shortcutKey(e))cancel('已停止切换思考强度。',true);},true);
 document.addEventListener('input',e=>{if(e.isTrusted)cancel('已停止切换思考强度。',true);},true);
 document.addEventListener('compositionstart',()=>cancel('输入法组词期间已停止切换。',true),true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel('');});
 window.addEventListener('pagehide',()=>cancel(''));
 window.addEventListener('popstate',()=>cancel('页面已变化，已停止切换思考强度。'));
 window.addEventListener('hashchange',()=>cancel('页面已变化，已停止切换思考强度。'));
 (window as unknown as {navigation?:EventTarget}).navigation?.addEventListener('currententrychange',()=>cancel('页面已变化，已停止切换思考强度。'));
 const request=(direction:1|-1=1)=>{if(captureBusy()){show('截图结束后再切换思考强度。');return;}queue.enqueue(direction);};
 chrome.runtime.onMessage.addListener((message:unknown,sender)=>{
  if(sender.id===chrome.runtime.id&&message&&typeof message==='object'&&'type'in message&&message.type==='native-longshot-cycle-thinking')request();
  return false;
 });
 installThinkingHotkey(request);
 return {isBusy:()=>queue.isBusy()};
}
