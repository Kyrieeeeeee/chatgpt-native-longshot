/** Use the visual turn, never the clipped screen-reader heading, for geometry. */
export function timelineAnchor(source:HTMLElement,turn:HTMLElement):HTMLElement{
 if(turn!==source)return turn;
 const isHeading=source.matches('h4')||source.dataset.conversationRole==='user'&&/^(你说[：:]|You said[：:]?)$/i.test(source.textContent?.trim()??'');
 return isHeading&&source.nextElementSibling instanceof HTMLElement?source.nextElementSibling:source;
}
/** overflow:hidden is scrollable by script; overflow:clip is deliberately not. */
export function timelineScroller(target:HTMLElement):HTMLElement|null{
 for(let el=target.parentElement;el&&el!==document.documentElement;el=el.parentElement){
  // With a visible HTML root, BODY overflow is propagated to the viewport.
  if(el===document.body&&getComputedStyle(document.documentElement).overflowY==='visible')return null;
  if(/^(auto|scroll|overlay|hidden)$/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1)return el;
 }
 return null;
}
