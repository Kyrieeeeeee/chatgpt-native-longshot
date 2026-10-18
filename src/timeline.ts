import {answers} from './adapter';
import type {Settings} from './settings';
import {indexAt,textHash} from './timeline-data';
import {timelineAnchor,timelineScroller} from './timeline-dom';
import {timelineView} from './timeline-view';
import {isUiMutation} from './dom-mutations';
type Entry={node:HTMLElement;key:string;question:string;answer:string};
const UI_KEY='nativeLongshot.timeline.ui.v1';
export function installTimeline(busy:()=>boolean){
 const host=document.createElement('div');host.dataset.nativeLongshotUi='timeline';host.hidden=true;
 const root=host.attachShadow({mode:'open'});root.innerHTML=timelineView;document.documentElement.append(host);
 const $=<T extends HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 const track=$('.track'),panel=$('.timeline-panel'),preview=$('.preview'),list=$('.timeline-list'),search=$<HTMLInputElement>('.timeline-search');
 let settings:Settings,entries:Entry[]=[],offsets:number[]=[],active=0,scroller:HTMLElement|null=null,timer:ReturnType<typeof setTimeout>|undefined,frame=0;
 const answerOwners=new Map<HTMLElement,number>(),entryAnswers=new Map<number,HTMLElement[]>(),dirtyEntries=new Set<number>(),observed=new Set<Element>();
 let fullScan=true,measureFrame=0,savedListScroll=0;
 let holdTimer:ReturnType<typeof setTimeout>|undefined,suppressClickUntil=0;
 let navigating:{index:number;top:number;until:number}|null=null;
 let route='',stars=new Set<string>(),onlyStars=false,pinned=false,side='right',center=.48,revision=0,previousFocus:HTMLElement|null=null;
 const starKey=()=>`nativeLongshot.timeline.stars.${textHash(location.origin+location.pathname)}`;
 const clean=(el:HTMLElement)=>el.innerText?.trim()||el.textContent?.trim()||'';
 const button=(label:string,cls:string)=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;return b;};
 function position(){
  host.dataset.side=side;const height=$('.rail').getBoundingClientRect().height;
  host.style.top=`${Math.max(8,Math.min(innerHeight-height-8,innerHeight*center-height/2))}px`;
  host.style.left=side==='left'?'12px':'auto';host.style.right=side==='right'?'12px':'auto';
  for(const el of [panel,preview]){el.style.left=side==='left'?'52px':'auto';el.style.right=side==='right'?'52px':'auto';}
  panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.getBoundingClientRect().height-8,innerHeight*center-panel.getBoundingClientRect().height/2))}px`;
 }
 function persistUI(){void chrome.storage.local.set({[UI_KEY]:{side,center,pinned}}).catch(()=>{$('.timeline-status').textContent='位置保存失败，请重试。';});}
 function mark(){
  const pos=(scroller?.scrollTop??scrollY)+(scroller?.clientHeight??innerHeight)*.28;
  if(navigating&&(performance.now()>navigating.until||Math.abs((scroller?.scrollTop??scrollY)-navigating.top)<3))navigating=null;
  const atBottom=scroller?scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2:scrollY+innerHeight>=document.documentElement.scrollHeight-2;
  active=navigating?.index??(entries.length?(atBottom&&(scroller?.scrollTop??scrollY)>0?entries.length-1:indexAt(offsets,pos)):0);
  root.querySelectorAll<HTMLElement>('[data-entry][aria-current="true"]').forEach(el=>{if(Number(el.dataset.entry)!==active)el.setAttribute('aria-current','false');});
  root.querySelectorAll<HTMLElement>(`[data-entry="${active}"]:not([aria-current="true"])`).forEach(el=>el.setAttribute('aria-current','true'));
  $<HTMLButtonElement>('.previous').disabled=active<=0;$<HTMLButtonElement>('.next').disabled=active>=entries.length-1;
  const label=entries.length?`${active+1}\n${entries.length}`:'0';if($('.index').textContent!==label)$('.index').textContent=label;
 }
 function scroll(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!busy())mark();});}
 function jump(i:number){if(busy()||!entries[i])return;if(route!==location.pathname){scan();return;}
  // Re-resolve geometry at click time; hidden headings and streamed replies
  // cannot be used as cached scroll targets.
  measure();const target=entries[i]!.node;
  const behavior=settings.timelineSmooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant';
  const limit=scroller?scroller.scrollHeight-scroller.clientHeight:document.documentElement.scrollHeight-innerHeight;
  const rect=target.getBoundingClientRect(),base=scroller?.getBoundingClientRect().top??0;
  const top=Math.max(0,Math.min(limit,(scroller?.scrollTop??scrollY)+rect.top-base-24));navigating={index:i,top,until:performance.now()+1400};active=i;mark();if(scroller)scroller.scrollTo({top,behavior});else window.scrollTo({top,behavior});
  // Native ancestor discovery also handles programmatically scrollable hidden
  // containers which the site's renderer may introduce after the last scan.
  requestAnimationFrame(()=>{if(!target.isConnected||busy())return;const visible=target.getBoundingClientRect();if(Math.abs(visible.top-(scroller?.getBoundingClientRect().top??0)-24)>Math.max(100,innerHeight)&&behavior==='instant')target.scrollIntoView({block:'start',behavior:'instant'});});
  preview.hidden=true;if(!pinned)close();
 }
 function close(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);hoverOpened=false;const wasOpen=!panel.hidden;const hadFocus=!!root.activeElement,focus=previousFocus;previousFocus=null;if(wasOpen)savedListScroll=list.scrollTop;panel.hidden=true;list.replaceChildren();if(entries.length<2)host.hidden=true;$('.index').setAttribute('aria-expanded','false');if(wasOpen&&hadFocus&&focus?.isConnected)focus.focus({preventScroll:true});}
 function renderList(){
  // Preserve compact hover's old scroll position while releasing hidden rows.
  // A hidden refresh still resets it, matching the original scan/open path.
  if(panel.hidden){savedListScroll=0;return;}
  const oldScroll=list.childElementCount?list.scrollTop:savedListScroll;list.replaceChildren();const query=search.value.trim().toLocaleLowerCase();let count=0;
  entries.forEach((entry,i)=>{if(onlyStars&&!stars.has(entry.key)||query&&!`${entry.question}\n${entry.answer}`.toLocaleLowerCase().includes(query))return;count++;
   const row=document.createElement('div');row.className='timeline-row';row.dataset.entry=String(i);
   const go=button('','row-jump');go.setAttribute('aria-label',`跳转到第 ${i+1} 条问题：${entry.question.slice(0,80)}`);
   const number=document.createElement('span');number.className='number';number.textContent=String(i+1);
   const body=document.createElement('span');body.className='row-text';const q=document.createElement('span');q.className='question-title';q.textContent=entry.question;
   const a=document.createElement('span');a.className='answer-summary';a.textContent=entry.answer.slice(0,180)||'尚无回复';body.append(q,a);go.append(number,body);go.onclick=()=>jump(i);
   const star=button(stars.has(entry.key)?'★':'☆','star');star.setAttribute('aria-label',`${stars.has(entry.key)?'取消收藏':'收藏'}第 ${i+1} 条问题`);star.setAttribute('aria-pressed',String(stars.has(entry.key)));
   star.onclick=()=>toggleStar(entry);
   row.append(go,star);list.append(row);
  });
  if(!count){const empty=document.createElement('div');empty.className='timeline-empty';empty.textContent=!entries.length?'当前页面尚无已加载的问题':onlyStars&&!stars.size?'还没有收藏的问题':'没有匹配的问题或回复';list.append(empty);}
  $('.summary').textContent=`已加载 ${entries.length} 条问题${query||onlyStars?` · 显示 ${count} 条`:''}`;list.scrollTop=oldScroll;mark();
 }
 function toggleStar(entry:Entry){if(route!==location.pathname){scan();return;}stars.has(entry.key)?stars.delete(entry.key):stars.add(entry.key);void chrome.storage.local.set({[starKey()]:[...stars]}).catch(()=>{$('.timeline-status').textContent='收藏保存失败，请重试。';});renderList();paintStars();}
 function paintStars(){track.querySelectorAll<HTMLElement>('.node').forEach((el,i)=>el.dataset.starred=String(stars.has(entries[i]!.key)));}
 function tooltip(i:number,event?:MouseEvent){const entry=entries[i];if(!entry||!panel.hidden)return;preview.replaceChildren();const label=document.createElement('strong');label.textContent=`问题 ${i+1} / ${entries.length}${stars.has(entry.key)?' · 已收藏':''}`;const q=document.createElement('div');q.textContent=entry.question.slice(0,350);const a=document.createElement('div');a.className='answer-preview';a.textContent=entry.answer.slice(0,500)||'尚无回复';preview.append(label,q,a);preview.hidden=false;position();preview.style.top=`${Math.max(8,Math.min(innerHeight-preview.getBoundingClientRect().height-8,event?.clientY??host.getBoundingClientRect().top))}px`;}
 function measure(){
  if(!settings?.timeline||busy())return;
  const nextScroller=entries[0]?timelineScroller(entries[0].node):null;
  if(scroller!==nextScroller){if(scroller&&scroller!==document.body){resize.unobserve(scroller);observed.delete(scroller);}scroller=nextScroller;if(scroller){resize.observe(scroller);observed.add(scroller);}}
  const base=scroller?scroller.getBoundingClientRect().top:0,top=scroller?.scrollTop??scrollY;
  offsets=entries.map(e=>e.node.getBoundingClientRect().top-base+top);
  const count=entries.length,height=track.clientHeight;
  const gap=count>1?Math.min(10,Math.max(0,Math.min(240,height-32))/(count-1)):0;
  track.querySelectorAll<HTMLElement>('.node').forEach((el,i)=>{const top=`${settings.timelineStyle==='dots'?16+i*Math.max(24,(height-32)/Math.max(1,count-1)):height/2+(i-(count-1)/2)*gap}px`;if(el.style.top!==top)el.style.top=top;});
  position();mark();
 }
 function scan(){clearTimeout(timer);timer=undefined;fullScan=false;dirtyEntries.clear();if(!settings?.timeline)return;if(busy()){schedule();return;}
  const routeChanged=route!==location.pathname;
  if(routeChanged){clearTimeout(holdTimer);navigating=null;route=location.pathname;stars=new Set();search.value='';onlyStars=false;$('.all').setAttribute('aria-pressed','true');$('.favorites').setAttribute('aria-pressed','false');const rev=++revision;void chrome.storage.local.get(starKey()).then(data=>{if(rev!==revision)return;const values=data[starKey()];stars=new Set(Array.isArray(values)?values.filter((x:unknown)=>typeof x==='string'):[]);paintStars();renderList();}).catch(()=>{});}
  const allAnswers=answers(document).sort((a,b)=>a.body===b.body?0:a.body.compareDocumentPosition(b.body)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  const bodies=new Set(allAnswers.map(a=>a.body));
  const insideAnswer=(el:HTMLElement)=>{for(let parent:HTMLElement|null=el;parent;parent=parent.parentElement)if(bodies.has(parent))return true;return false;};
  const nodes=[...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"],[data-role="user"],[data-testid="user-message"],[data-conversation-role="user"],h4')].filter(el=>!el.closest('[data-native-longshot-ui]')&&(!el.matches('h4')||/^(你说[：:]|You said[：:]?)$/i.test(clean(el)))&&!el.closest('[data-message-author-role="assistant"],[data-role="assistant"]')&&!insideAnswer(el));
  const seen=new Set<HTMLElement>(),duplicates=new Map<string,number>();
  const previous=entries;entries=[];
  for(const source of nodes){
   const node=source.closest<HTMLElement>('[data-testid^="conversation-turn-"],article[data-turn],[data-talvt-turn-state]')??source;
   if(seen.has(node))continue;seen.add(node);
   const question=clean((source.matches('h4')||source.matches('[data-conversation-role="user"]')&&/^(你说[：:]|You said[：:]?)$/i.test(clean(source)))?(source.nextElementSibling as HTMLElement??node):source);if(!question&&!node.querySelector('img,canvas'))continue;
   const hash=textHash(question),occurrence=duplicates.get(hash)??0;duplicates.set(hash,occurrence+1);
   // Screen-reader h4 is an identifier, never the visual scroll anchor.
   const anchor=timelineAnchor(source,node);
   entries.push({node:anchor,key:source.dataset.messageId??node.dataset.messageId??node.querySelector<HTMLElement>('[data-message-author-role="user"][data-message-id],[data-role="user"][data-message-id]')?.dataset.messageId??(node.id||`${hash}.${occurrence}`),question:question||'图片问题',answer:''});
  }
  answerOwners.clear();entryAnswers.clear();let question=0;
  for(const answer of allAnswers){
   while(question+1<entries.length&&!!(entries[question+1]!.node.compareDocumentPosition(answer.body)&Node.DOCUMENT_POSITION_FOLLOWING))question++;
   if(!entries[question]||!(entries[question]!.node.compareDocumentPosition(answer.body)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
   const group=entryAnswers.get(question)??[];group.push(answer.body);entryAnswers.set(question,group);answerOwners.set(answer.body,question);
  }
  entries.forEach((entry,i)=>entry.answer=(entryAnswers.get(i)??[]).map(clean).join('\n'));
  const nextObserved=new Set<Element>([document.body,...allAnswers.map(a=>a.body)]);
  const nextScroller=entries[0]?timelineScroller(entries[0].node):null;if(nextScroller)nextObserved.add(nextScroller);
  for(const el of observed)if(!nextObserved.has(el)){resize.unobserve(el);observed.delete(el);}for(const el of nextObserved)if(!observed.has(el)){resize.observe(el);observed.add(el);}scroller=nextScroller;
  const changed=routeChanged||entries.length!==previous.length||entries.some((entry,i)=>entry.node!==previous[i]?.node||entry.key!==previous[i]?.key||entry.question!==previous[i]?.question);
  if(changed){clearTimeout(holdTimer);track.replaceChildren();entries.forEach((entry,i)=>{const node=button('','node');node.dataset.entry=String(i);node.setAttribute('aria-label',`第 ${i+1} 条问题：${entry.question.slice(0,80)}`);node.onclick=()=>{if(Date.now()>=suppressClickUntil)jump(i);};
   let startX=0,startY=0,cancelled=false,held=false;
   const cancelHold=()=>clearTimeout(holdTimer);
   node.onpointerdown=e=>{if(e.button!==0)return;cancelHold();cancelled=false;held=false;startX=e.clientX;startY=e.clientY;node.setPointerCapture(e.pointerId);const selected=entries[settings.timelineStyle==='dots'?i:tickIndex(e)];if(!selected)return;holdTimer=setTimeout(()=>{held=true;suppressClickUntil=Date.now()+350;toggleStar(selected);},550);};
   node.onpointermove=e=>{if(Math.hypot(e.clientX-startX,e.clientY-startY)>6){cancelHold();cancelled=true;if(node.hasPointerCapture(e.pointerId))suppressClickUntil=Date.now()+350;}};
   node.onpointerup=()=>{cancelHold();if(held||cancelled)suppressClickUntil=Date.now()+350;};node.onpointercancel=cancelHold;node.onlostpointercapture=cancelHold;
   node.oncontextmenu=e=>{e.preventDefault();cancelHold();const selected=entries[settings.timelineStyle==='dots'?i:tickIndex(e)];if(selected&&Date.now()>=suppressClickUntil)toggleStar(selected);suppressClickUntil=Date.now()+350;};
   node.onmouseenter=e=>tooltip(i,e);node.onfocus=()=>tooltip(i);node.onmouseleave=()=>preview.hidden=true;track.append(node);});}
  host.hidden=entries.length<2&&panel.hidden;paintStars();measure();renderList();
 }
 function flush(){timer=undefined;if(busy()){schedule(fullScan);return;}if(fullScan||route!==location.pathname){scan();return;}for(const i of dirtyEntries)if(entries[i])entries[i]!.answer=(entryAnswers.get(i)??[]).map(clean).join('\n');dirtyEntries.clear();measure();renderList();}
 function schedule(structural=true){if(!settings?.timeline)return;fullScan ||= structural;if(!timer)timer=setTimeout(flush,180);}
 const observer=new MutationObserver(records=>{for(const record of records){if(isUiMutation(record))continue;let target=record.target instanceof HTMLElement?record.target:record.target.parentElement;while(target&&!answerOwners.has(target))target=target.parentElement;if(target){dirtyEntries.add(answerOwners.get(target)!);schedule(false);}else schedule();}});
 const resize=new ResizeObserver(()=>{if(settings?.timeline&&!busy()&&!measureFrame)measureFrame=requestAnimationFrame(()=>{measureFrame=0;measure();});});
 window.addEventListener('popstate',()=>schedule());
 (window as unknown as {navigation?:EventTarget}).navigation?.addEventListener('currententrychange',()=>schedule());
 function open(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);hoverOpened=false;if(!settings?.timeline||busy())return;scan();previousFocus=(root.activeElement??document.activeElement) as HTMLElement;panel.hidden=false;host.hidden=false;preview.hidden=true;$('.index').setAttribute('aria-expanded','true');renderList();position();search.focus({preventScroll:true});}
 let hoverTimer:ReturnType<typeof setTimeout>|undefined,leaveTimer:ReturnType<typeof setTimeout>|undefined,hoverOpened=false;
 function openHover(){clearTimeout(leaveTimer);clearTimeout(hoverTimer);if(!panel.hidden)return;hoverTimer=setTimeout(()=>{if(!settings.timeline||busy())return;previousFocus=(root.activeElement??document.activeElement) as HTMLElement;hoverOpened=true;panel.hidden=false;host.hidden=false;preview.hidden=true;$('.index').setAttribute('aria-expanded','true');renderList();position();},150);}
 function leaveHover(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);if(hoverOpened&&!pinned)leaveTimer=setTimeout(()=>{close();hoverOpened=false;},220);}
 const tickIndex=(e:MouseEvent)=>{const y=e.clientY-track.getBoundingClientRect().top;let closest=0,distance=Infinity;track.querySelectorAll<HTMLElement>('.node').forEach((el,i)=>{const d=Math.abs(parseFloat(el.style.top)-y);if(d<distance){distance=d;closest=i;}});return closest;};
 track.addEventListener('click',e=>{if(!e.detail)return;if(Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();return;}
  if(settings.timelineStyle!=='dots'&&entries.length){e.stopPropagation();jump(tickIndex(e));}
 },true);
 track.onmouseenter=()=>{if(settings.timelineStyle==='compact')openHover();};track.onmousemove=e=>{if(settings.timelineStyle==='ruler'&&panel.hidden)tooltip(tickIndex(e),e);};track.onmouseleave=()=>{preview.hidden=true;leaveHover();};
 $('.index').onmouseenter=openHover;$('.index').onmouseleave=leaveHover;panel.onmouseenter=()=>{clearTimeout(leaveTimer);};panel.onmouseleave=leaveHover;
 $('.index').onclick=()=>panel.hidden?open():close();$('.close').onclick=close;
 $('.previous').onclick=()=>jump(active-1);$('.next').onclick=()=>jump(active+1);
 $('.locate').onclick=()=>{search.value='';onlyStars=false;$('.all').setAttribute('aria-pressed','true');$('.favorites').setAttribute('aria-pressed','false');renderList();list.querySelector('[aria-current=true]')?.scrollIntoView({block:'nearest'});};
 search.oninput=renderList;
 for(const filter of ['all','favorites'])$('.'+filter).onclick=()=>{onlyStars=filter==='favorites';$('.all').setAttribute('aria-pressed',String(!onlyStars));$('.favorites').setAttribute('aria-pressed',String(onlyStars));renderList();};
 $('.pin').onclick=()=>{pinned=!pinned;$('.pin').setAttribute('aria-pressed',String(pinned));persistUI();};
 root.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.key==='Escape'){e.preventDefault();close();preview.hidden=true;}if((e.target as HTMLElement).matches('input'))return;const i=e.key==='ArrowUp'?active-1:e.key==='ArrowDown'?active+1:e.key==='Home'?0:e.key==='End'?entries.length-1:null;if(i!==null){e.preventDefault();jump(i);}});
 const cancelNavigation=()=>{if(!settings?.timeline)return;navigating=null;scroll();};
 document.addEventListener('wheel',cancelNavigation,{passive:true});document.addEventListener('touchstart',cancelNavigation,{passive:true});
 document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(host))cancelNavigation();if(!pinned&&!panel.hidden&&!e.composedPath().includes(host))close();},true);
 let drag:{id:number;y:number;start:number}|null=null;
 $('.timeline-grip').onpointerdown=e=>{if(busy())return;drag={id:e.pointerId,y:e.clientY,start:host.getBoundingClientRect().top+$('.rail').getBoundingClientRect().height/2};$('.timeline-grip').setPointerCapture(e.pointerId);};
 $('.timeline-grip').onpointermove=e=>{if(!drag)return;center=Math.max(0,Math.min(1,(drag.start+e.clientY-drag.y)/innerHeight));side=e.clientX<innerWidth/2?'left':'right';position();};
 const end=()=>{if(drag){drag=null;persistUI();}};$('.timeline-grip').onpointerup=end;$('.timeline-grip').onpointercancel=end;
 function reset(){side='right';center=.48;position();persistUI();}$('.timeline-grip').ondblclick=reset;
 void chrome.storage.local.get(UI_KEY).then(data=>{const value=data[UI_KEY] as {side?:string;center?:number;pinned?:boolean}|undefined;if(value){side=value.side==='left'?'left':'right';center=typeof value.center==='number'?Math.max(0,Math.min(1,value.center)):.48;pinned=value.pinned===true;$('.pin').setAttribute('aria-pressed',String(pinned));position();}}).catch(()=>{});
 return {open,reset,apply(next:Settings){const previous=settings;settings=next;
  // Motion is read when jumping; unrelated settings need no reindex or observer
  // teardown. Width changes are measured by the existing ResizeObserver.
  if(previous&&previous.timeline===next.timeline&&previous.timelineStyle===next.timelineStyle){
   // ResizeObserver deliberately ignores capture-time geometry. If a width
   // setting arrives while busy, retain a retry for the post-capture geometry.
   if(next.timeline&&busy()&&(previous.widthEnabled!==next.widthEnabled||next.widthEnabled&&previous.width!==next.width))schedule(false);
   return;
  }
  navigating=null;observer.disconnect();resize.disconnect();observed.clear();document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',measure);clearTimeout(timer);timer=undefined;cancelAnimationFrame(frame);frame=0;cancelAnimationFrame(measureFrame);measureFrame=0;fullScan=true;dirtyEntries.clear();
  if(!next.timeline){clearTimeout(holdTimer);clearTimeout(hoverTimer);clearTimeout(leaveTimer);hoverOpened=false;host.hidden=true;close();preview.hidden=true;track.replaceChildren();preview.replaceChildren();entries=[];offsets=[];answerOwners.clear();entryAnswers.clear();scroller=null;return;}
  track.dataset.style=next.timelineStyle;observer.observe(document.body,{subtree:true,childList:true,characterData:true});resize.observe(document.body);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',measure);scan();
 }};
}
