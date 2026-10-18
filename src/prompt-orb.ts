const POSITION_KEY = 'nativeLongshot.promptOrb.v1';
interface Position { side: 'left' | 'right'; ratio: number }
export function installPromptOrb(button: HTMLElement, changed: () => void, show: (message: string) => void): () => void {
  let position: Position = {side:'left', ratio:.86};
  let touched = false;
  let suppressClick = false;
  let drag: {id: number; x: number; y: number; left: number; top: number; moved: boolean} | null = null;
  const clamp = (value: number, max: number) => Math.max(12, Math.min(value, Math.max(12,max)));
  function place(): void {
    const top = 12 + position.ratio * Math.max(0,innerHeight - 68);
    button.style.left = `${position.side === 'left' ? 16 : Math.max(12,innerWidth-60)}px`;
    button.style.top = `${clamp(top,innerHeight-56)}px`;
    button.dataset.side = position.side;
    changed();
  }
  function save(): void {
    touched = true;
    void chrome.storage.local.set({[POSITION_KEY]:position}).catch(e=>show('悬浮球位置保存失败：'+String(e)));
  }
  function snap(): void {
    const r=button.getBoundingClientRect();
    position = {side:r.left+22 < innerWidth/2 ? 'left':'right',ratio:Math.max(0,Math.min(1,(r.top-12)/Math.max(1,innerHeight-68)))};
    place(); save();
  }
  void chrome.storage.local.get(POSITION_KEY).then(data=> {
    const p=data[POSITION_KEY] as Partial<Position> | undefined;
    if (!touched && p && (p.side==='left'||p.side==='right') && typeof p.ratio==='number' && Number.isFinite(p.ratio)) {
      position={side:p.side,ratio:Math.max(0,Math.min(1,p.ratio))}; place();
    }
  }).catch(()=>{});
  button.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault(); suppressClick=false;
    const r=button.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};
    button.setPointerCapture(e.pointerId);
  });
  button.addEventListener('pointermove',e=>{
    if (!drag || e.pointerId!==drag.id) return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>5)drag.moved=true;
    if (!drag.moved) return;
    touched=true;button.dataset.dragging='true';
    button.style.left=`${clamp(drag.left+dx,innerWidth-56)}px`;
    button.style.top=`${clamp(drag.top+dy,innerHeight-56)}px`;changed();
  });
  function end(e: PointerEvent): void {
    if(!drag||e.pointerId!==drag.id)return;
    suppressClick=drag.moved;drag=null;delete button.dataset.dragging;snap();
  }
  button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
  button.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
  button.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    if(e.key==='ArrowLeft'||e.key==='ArrowRight')position.side=e.key==='ArrowLeft'?'left':'right';
    else position.ratio=Math.max(0,Math.min(1,position.ratio+(e.key==='ArrowUp'?-24:24)/Math.max(1,innerHeight-68)));
    place();save();
  });
  window.addEventListener('resize',place);place();
  return ()=>{position={side:'left',ratio:.86};place();save();};
}
