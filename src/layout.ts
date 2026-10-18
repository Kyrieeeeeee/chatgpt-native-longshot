import {answers,ASSISTANT} from './adapter';
import {installTimeline} from './timeline';
import type {Settings} from './settings';
import {isUiMutation} from './dom-mutations';
export function installLayout(busy:()=>boolean){
 let settings:Settings;
 let scanTimer:ReturnType<typeof setTimeout>|undefined;
 const columns=new Set<HTMLElement>();
 const widthStyle=document.createElement('style');widthStyle.dataset.nativeLongshotUi='width-style';document.documentElement.append(widthStyle);
 let timeline:ReturnType<typeof installTimeline>|undefined;
 const ensureTimeline=()=>timeline??=installTimeline(busy);
 const USER='[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"]';
 function scan():void{
  scanTimer=undefined;if(busy()){scanTimer=setTimeout(scan,250);return;}
  if(settings.widthEnabled){
   const next=new Set<HTMLElement>();
   const outerSeen=new Set<HTMLElement>();
   const addColumn=(start:HTMLElement|null,turn:HTMLElement)=>{
    if(!start||!turn.contains(start))return;
    for(let el:HTMLElement|null=start;el;el=el.parentElement){
     next.add(el);if(el===turn)break;
    }
    // Some renderers place the native width cap outside the turn. Expanding
    // only descendants is then still capped at 100% of that narrow wrapper.
    for(let el=turn.parentElement;el&&!el.matches('main,[role="main"],body,html');el=el.parentElement){
     if(outerSeen.has(el))break;outerSeen.add(el);
     // Keep the composer and scrolling viewport outside the width override.
     if(el.querySelector('form,textarea,[contenteditable="true"],[role="textbox"]'))break;
     const style=getComputedStyle(el);
     if(/^(auto|scroll)$/.test(style.overflowY)&&el.scrollHeight>el.clientHeight)break;
     if(style.maxWidth!=='none')next.add(el);
    }
   };
   for(const answer of answers(document))addColumn(answer.body,answer.message);
   // Expand each author's column to the same boundary. Keep user bubbles'
   // native fit-content sizing and right alignment; never widen the bubble itself.
   for(const source of document.querySelectorAll<HTMLElement>(`${USER}, [data-conversation-role="user"], h4`)){
    if(source.closest(ASSISTANT))continue;
    if(!source.matches(`${USER}, [data-conversation-role="user"]`)&&!/^(你说[：:]|You said[：:]?)$/i.test(source.textContent?.trim()??''))continue;
    const turn=source.closest<HTMLElement>('article, [data-testid^="conversation-turn-"], [data-talvt-turn-state]');
    if(turn)addColumn(source.parentElement,turn);
   }
   for(const el of columns)if(!next.has(el)){el.removeAttribute('data-native-reply-column');columns.delete(el);}
   for(const el of next){if(!columns.has(el)){el.setAttribute('data-native-reply-column','');columns.add(el);}}
  }
 }
 function schedule():void{if(!scanTimer)scanTimer=setTimeout(scan,150);}
 const observer=new MutationObserver(records=>{if(records.some(r=>!isUiMutation(r)))schedule();});
 window.addEventListener('resize',()=>{if(settings?.widthEnabled)schedule();});
 return {openTimeline(){if(settings?.timeline)ensureTimeline().open();},resetTimeline(){ensureTimeline().reset();},apply(next:Settings){
  const previous=settings;settings=next;
  const enabledChanged=!previous||previous.widthEnabled!==next.widthEnabled;
  if(enabledChanged||previous.width!==next.width){
   if(next.widthEnabled){widthStyle.textContent=`html body [data-native-reply-column]{--thread-content-max-width:${next.width}vw!important;max-width:min(100%,${next.width}vw)!important;width:100%!important;margin-inline:auto!important}`;}
   else if(enabledChanged){widthStyle.textContent='';for(const el of columns)el.removeAttribute('data-native-reply-column');columns.clear();}
  }
  // Text streaming cannot change the set of reply columns. New/replaced DOM
  // and viewport changes still trigger discovery and available-width updates.
  if(enabledChanged){observer.disconnect();clearTimeout(scanTimer);scanTimer=undefined;if(next.widthEnabled){observer.observe(document.body,{childList:true,subtree:true});scan();}}
  if(next.timeline||timeline)ensureTimeline().apply(next);
 }};
}
