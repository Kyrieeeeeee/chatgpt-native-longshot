const MATH='.katex-display, .katex, mjx-container, [data-math]';
function mathElement(el:Element):Element|null{
 const math=el.closest(MATH);return math?.closest('.katex-display')??math;
}
export function latexSource(el: Element): string | null {
 const formula=mathElement(el);if(!formula)return null;
 return formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()||formula.getAttribute('data-math')?.trim()||formula.querySelector('[data-math]')?.getAttribute('data-math')?.trim()||formula.querySelector('mjx-assistive-mml math')?.getAttribute('alttext')||formula.getAttribute('alttext')||null;
}
export function installLatexCopy(show:(message:string)=>void,busy:()=>boolean){
 let enabled=true,current:Element|null=null;
 const style=document.createElement('style');style.dataset.nativeLongshotUi='latex-style';
 // Voyager contentStyle.css: tint + 1px shadow, no padding/layout changes.
 style.textContent=`html:not([data-native-longshot-busy]) [data-native-latex-copy]{cursor:pointer;border-radius:4px;transition:background-color .15s,box-shadow .15s}html:not([data-native-longshot-busy]) [data-native-latex-copy]:hover{background-color:color-mix(in srgb,#00a8e8 12%,transparent);box-shadow:0 0 0 1px #00a8e8}@media(prefers-reduced-motion:reduce){[data-native-latex-copy]{transition:none!important}}`;
 document.documentElement.append(style);
 const clear=()=>{current?.removeAttribute('data-native-latex-copy');current=null;};
 document.addEventListener('pointerover',e=>{
  if(!enabled||busy()||!(e.target instanceof Element))return;
  const next=mathElement(e.target);
  if(!next||next.closest('[contenteditable="true"],textarea,[data-native-longshot-ui]')||!latexSource(next)){clear();return;}
  if(current!==next){clear();current=next;next.setAttribute('data-native-latex-copy','');}
 });
 document.addEventListener('click',e=>{
  if(!enabled||busy()||e.button!==0||e.ctrlKey||e.metaKey||e.altKey||!(e.target instanceof Element))return;
  const formula=mathElement(e.target),source=formula&&latexSource(formula);
  if(!formula||!source||formula.closest('[contenteditable="true"],textarea,[data-native-longshot-ui]'))return;
  if(!getSelection()?.isCollapsed)return;
  const display=!!formula.closest('.katex-display,.math-block,.math-display')||!!formula.querySelector('math[display="block"]')||formula.matches('mjx-container[display="true"]');
  const text=display?`$$${source}$$`:`$${source}$`;
  e.preventDefault();e.stopPropagation();
  void navigator.clipboard.writeText(text).then(()=>show('LaTeX 已复制。'),error=>show('复制失败：'+String(error)));
 },true);
 return {setEnabled(value:boolean){enabled=value;if(!value)clear();}};
}
