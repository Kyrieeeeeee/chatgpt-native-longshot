import {PROMPT_EDITOR as SELECTOR} from './prompt-editor';
import {installPromptTokens} from './prompt-tokens';
import { promptView } from './prompt-view';
import { installPromptOrb } from './prompt-orb';
import { promptIndex, mergePrompts, parsePrompts, PROMPT_KEY, type Prompt } from './prompt-data';
type Editor = HTMLTextAreaElement | HTMLElement;
interface Cursor { editor: Editor; start?: number; end?: number; range?: Range }
function samePrompt(a:Prompt,b:Prompt):boolean {
  // storage.onChanged delivers fresh objects, even for unchanged rows.
  return a.id===b.id&&a.name===b.name&&a.content===b.content&&a.favorite===b.favorite
    &&a.useCount===b.useCount&&a.lastUsedAt===b.lastUsedAt
    &&a.tags.length===b.tags.length&&a.tags.every((tag,i)=>tag===b.tags[i]);
}
function cursor(editor: Editor): Cursor | null {
  if (editor instanceof HTMLTextAreaElement) return {editor, start:editor.selectionStart, end:editor.selectionEnd};
  const selection = getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return null;
  return {editor, range:selection.getRangeAt(0).cloneRange()};
}
function prefix(c: Cursor): string {
  if (c.editor instanceof HTMLTextAreaElement) return c.editor.value.slice(0,c.start);
  const r = c.range!.cloneRange(); r.selectNodeContents(c.editor); r.setEnd(c.range!.startContainer,c.range!.startOffset);
  return r.toString();
}
function queryPrefix(c: Cursor): string {
  if (c.editor instanceof HTMLTextAreaElement) return prefix(c);
  const node = c.range!.startContainer;
  const block = (node instanceof Element ? node : node.parentElement)?.closest('p,div,li');
  if (!block || block === c.editor || !c.editor.contains(block)) return prefix(c);
  const r = c.range!.cloneRange(); r.selectNodeContents(block);
  r.setEnd(c.range!.startContainer, c.range!.startOffset);
  return r.toString();
}
function insert(c: Cursor, text: string, remove = 0): boolean {
  if (!c.editor.isConnected) return false;
  c.editor.focus();
  if (c.editor instanceof HTMLTextAreaElement) c.editor.setSelectionRange(Math.max(0,c.start! - remove),c.end!);
  else {
    const r = c.range!.cloneRange();
    if (remove) {
      // Slash queries may span several text nodes in ProseMirror.
      const walker = document.createTreeWalker(c.editor, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const before = prefix(c).length - remove;
      let offset = 0;
      for (const node of nodes) { if (offset + node.length > before) { r.setStart(node,Math.max(0,before-offset)); break; } offset += node.length; }
    }
    getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
  }
  // Browser editing commands participate in the editor's input/undo pipeline.
  return document.execCommand('insertText',false,text);
}
export function installPrompts(show: (message: string) => void, busy: () => boolean): {setEnabled:(enabled:boolean)=>void;open:()=>void} {
  const tokens=installPromptTokens(show,busy);
  let prompts: Prompt[] = [];
  let dataRevision=0;
  let index = promptIndex(prompts);
  const rows = new Map<string, {prompt:Prompt; mode:string; expanded:boolean; row:HTMLElement}>();
  function updatePrompts(next:Prompt[]):void { dataRevision++;prompts=next;index=promptIndex(prompts);render(); }
  let saved: Cursor | null = null;
  let slash: Cursor | null = null;
  let selected = 0;
  let matches: Prompt[] = [];
  let optionButtons:HTMLButtonElement[]=[],paintedSelection=-1;
  const UI_KEY='nativeLongshot.promptManager.v1';
  let viewMode: 'compact' | 'cards'='compact';
  let theme: 'auto' | 'light' | 'dark'='auto';
  let pinned=false;
  let favoritesOnly=false;
  const expanded=new Set<string>();
  let panelPosition: {x:number;y:number} | null=null;
  let tag: string | null = null;
  let nativeMode = false;
  let composing = false;
  const host = document.createElement('div'); host.dataset.nativeLongshotUi = 'prompts';
  const root = host.attachShadow({mode:'open'}); root.innerHTML = promptView;
  document.documentElement.append(host);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const modal = $<HTMLDivElement>('.backdrop');
  const panel = $('.panel');
  const quick = $<HTMLDivElement>('.quick');
  const form = $<HTMLFormElement>('form');
  const launch = $('.launch');
  const style = document.createElement('style');
  style.dataset.nativeLongshotUi = 'slash-style';
  // Verified on ChatGPT's real slash menu. Scope to the composer commands
  // overlay, rather than hiding generic menus or unrelated extension UIs.
  style.textContent = 'html[data-native-longshot-slash] [data-composer-overlay-floating-ui]:has([data-mention-section-id="commands"]){display:none!important}';
  document.documentElement.append(style);
  const queryAt = (c: Cursor) => queryPrefix(c).match(/(?:^|\s)(\/[^\s/]{0,80})$/u);
  const status = (text: string) => { $('.status').textContent = text; };
  function closeQuick(): void {
    if(!quick.hidden&&modal.hidden)index=promptIndex(prompts);
    quick.hidden = true; slash = null; matches=[];optionButtons=[];paintedSelection=-1;$('.options').replaceChildren();hideHover();
    document.documentElement.removeAttribute('data-native-longshot-slash');
  }
  function placePanel(): void {
    if (modal.hidden) return;
    const r=launch.getBoundingClientRect();
    const w=panel.getBoundingClientRect().width,h=panel.getBoundingClientRect().height;
    const x=panelPosition?panelPosition.x*Math.max(0,innerWidth-w):launch.dataset.side==='left'?r.left:r.right-w;
    const y=panelPosition?panelPosition.y*Math.max(0,innerHeight-h):r.top-h-12;
    panel.style.left=`${Math.max(10,Math.min(x,innerWidth-w-10))}px`;
    panel.style.top=`${Math.max(10,Math.min(y,innerHeight-h-10))}px`;
  }
  const resetPosition = installPromptOrb(launch,placePanel,show);
  function saveUI(): void { void chrome.storage.local.set({[UI_KEY]:{viewMode,theme,pinned,panelPosition}}).catch(e=>show('面板设置保存失败：'+String(e))); }
  function applyUI(): void {
    host.style.colorScheme=theme==='auto'?'':theme;
    $('.list').dataset.view=viewMode;
    $('.view-toggle').textContent=viewMode==='compact'?'▦':'≡';
    $('.view-toggle').setAttribute('aria-label',viewMode==='compact'?'切换为卡片视图':'切换为列表视图');
    $('.pin').setAttribute('aria-pressed',String(pinned));panel.setAttribute('aria-modal',String(!pinned));
    $('.favorites-library').setAttribute('aria-pressed',String(favoritesOnly));
    $('.favorites-library').textContent=favoritesOnly?'☆ 全部提示词':'☆ 收藏库';
  }
  $('.reset-position').onclick=()=>{panelPosition=null;resetPosition();saveUI();$<HTMLDetailsElement>('.backup').open=false;};
  async function persist(next: Prompt[]): Promise<void> {
    await chrome.storage.local.set({[PROMPT_KEY]:next}); updatePrompts(next);
  }
  void chrome.storage.local.get([PROMPT_KEY,UI_KEY]).then(data=>{
    if(!dataRevision){prompts=(data[PROMPT_KEY]??[]) as Prompt[];index=promptIndex(prompts);}
    const ui=data[UI_KEY] as {viewMode?:string;theme?:string;pinned?:boolean;panelPosition?:{x:number;y:number}} | undefined;
    if(ui?.viewMode==='cards')viewMode='cards';
    if(ui?.theme==='dark'||ui?.theme==='light')theme=ui.theme;
    pinned=ui?.pinned===true;
    if(ui?.panelPosition&&Number.isFinite(ui.panelPosition.x)&&Number.isFinite(ui.panelPosition.y))panelPosition=ui.panelPosition;
    applyUI();render();
  }).catch(e=>show('提示词读取失败：'+String(e)));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes[PROMPT_KEY])updatePrompts((changes[PROMPT_KEY].newValue??[]) as Prompt[]);
  });
  function close(): void {
    modal.hidden=true; form.hidden=true; $('.library').hidden=false;hideHover();
    $('.list').replaceChildren();rows.clear();matches=[];index=promptIndex(prompts);
    launch.setAttribute('aria-expanded','false');
    if(saved?.editor.isConnected)saved.editor.focus();else launch.focus();
    saved=null;
  }
  function choose(p: Prompt, fast=false): void {
    // Read at acceptance: ProseMirror may finish its paste after input fires.
    const fresh=fast&&slash?cursor(slash.editor):null;
    const query=fresh?queryAt(fresh):null;
    const currentEditor=document.activeElement?.closest<Editor>(SELECTOR);
    const target=fast?fresh:currentEditor?cursor(currentEditor)??saved:saved;
    if(!target||(fast&&!query)||!tokens.insert(target.editor,p,prefix(target).length-(fast?query![1]!.length:0),label=>insert(target,label,fast?query![1]!.length:0))){
      show('插入失败，请先点击消息输入框再试。');return;
    }
    // The input transaction closes ChatGPT's own slash state before releasing
    // our scoped CSS, preventing its command menu from flashing back on accept.
    quick.hidden=true;slash=null;requestAnimationFrame(closeQuick);
    if(!fast)close();
    void persist(prompts.map(x=>x.id===p.id?{...x,useCount:(x.useCount??0)+1,lastUsedAt:Date.now()}:x))
      .catch(e=>show('使用记录保存失败：'+String(e)));
  }
  function action(label: string, fn: () => void, className=''): HTMLButtonElement {
    const b=document.createElement('button');b.type='button';b.textContent=label;b.className=className;b.onclick=fn;return b;
  }
  const hover=$('.hover-preview');
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  function hideHover(): void { clearTimeout(hoverTimer);hover.hidden=true; }
  function preview(p: Prompt, anchor: HTMLElement): void {
    hideHover();hoverTimer=setTimeout(()=>{
      if((modal.hidden&&quick.hidden)||(!modal.hidden&&!form.hidden))return;
      hover.textContent=p.content;hover.hidden=false;
      const r=anchor.getBoundingClientRect(),box=hover.getBoundingClientRect();
      const x=r.right+12+box.width<innerWidth?r.right+12:r.left-box.width-12;
      hover.style.left=`${Math.max(12,Math.min(x,innerWidth-box.width-12))}px`;
      hover.style.top=`${Math.max(12,Math.min(r.top,innerHeight-box.height-12))}px`;
    },250);
  }
  function render(): void {
    if (modal.hidden || host.hidden) return;
    const focusKey=(root.activeElement as HTMLElement | null)?.dataset.focusKey;
    hideHover();applyUI();
    const filters=$('.filters');filters.replaceChildren();
    const allTags=index.tags;if(tag&&!allTags.includes(tag))tag=null;
    for(const t of [null,...allTags]){
      const button=action(t??'全部',()=>{tag=t;status('');render();});button.dataset.focusKey='tag:'+(t??'');button.setAttribute('aria-pressed',String(tag===t));filters.append(button);
    }
    const list=$('.list');list.replaceChildren();
    const filtered=index.search($<HTMLInputElement>('.search').value).filter(p=>(!tag||p.tags.includes(tag))&&(!favoritesOnly||p.favorite));
    const valid=new Set(prompts.map(p=>p.id));for(const id of rows.keys())if(!valid.has(id))rows.delete(id);
    const fragment=document.createDocumentFragment();
    for(const p of filtered){
      const cached=rows.get(p.id);
      if(cached&&(cached.prompt===p||samePrompt(cached.prompt,p))&&cached.mode===viewMode&&cached.expanded===expanded.has(p.id)){fragment.append(cached.row);continue;}
      const row=document.createElement('div');row.className='row';row.dataset.promptId=p.id;
      const head=document.createElement('div');head.className='row-head';
      const use=action(p.name,()=>choose(p),'name');use.setAttribute('aria-label','使用提示词：'+p.name);use.dataset.focusKey='use:'+p.id;use.onmousedown=e=>e.preventDefault();
      use.onpointerenter=()=>preview(p,use);use.onpointerleave=hideHover;use.onfocus=()=>preview(p,use);use.onblur=hideHover;
      const tools=document.createElement('div');tools.className='row-tools';
      const tags=document.createElement('div');tags.className='row-tags';
      for(const t of p.tags){const chip=document.createElement('span');chip.className='chip';chip.textContent=t;chip.title=t;tags.append(chip);}
      const toggle=action(expanded.has(p.id)?'▴':'▾',()=>{if(expanded.has(p.id))expanded.delete(p.id);else expanded.add(p.id);render();},'icon-button expand');
      toggle.dataset.focusKey='expand:'+p.id;toggle.setAttribute('aria-label',expanded.has(p.id)?'收起提示词：'+p.name:'展开提示词：'+p.name);toggle.setAttribute('aria-expanded',String(expanded.has(p.id)));
      const edit=action('',()=>editPrompt(p),'icon-button edit');const pencil=document.createElement('span');pencil.className='pencil-icon';pencil.setAttribute('aria-hidden','true');edit.append(pencil);edit.setAttribute('aria-label','编辑');edit.title='编辑';
      const del=action('',()=>{if(confirm(`删除提示词「${p.name}」？`))void persist(prompts.filter(x=>x.id!==p.id)).catch(e=>status(String(e)));},'icon-button delete');
      del.setAttribute('aria-label','删除');del.title='删除';const trash=document.createElement('span');trash.className='trash-icon';trash.setAttribute('aria-hidden','true');del.append(trash);
      const star=action(p.favorite?'★':'☆',()=>{void persist(prompts.map(x=>x.id===p.id?{...x,favorite:!x.favorite}:x)).catch(e=>status(String(e)));},'icon-button quick-favorite');
      star.dataset.focusKey='star:'+p.id;star.setAttribute('aria-pressed',String(!!p.favorite));
      star.setAttribute('aria-label',(p.favorite?'取消常用：':'设为常用：')+p.name);star.title=p.favorite?'取消常用置顶':'常用置顶';
      tools.append(tags,star,toggle,edit,del);head.append(use,tools);row.append(head);
      const body=document.createElement('div');body.className='row-body';body.hidden=viewMode==='compact'&&!expanded.has(p.id);
      if(!body.hidden){
      const content=document.createElement('div');content.className='content';content.textContent=p.content;if(expanded.has(p.id))content.dataset.expanded='true';
      const bodyActions=document.createElement('div');bodyActions.className='body-actions';
      const favorite=action(p.favorite?'★ 已收藏':'☆ 收藏',()=>{void persist(prompts.map(x=>x.id===p.id?{...x,favorite:!x.favorite}:x)).catch(e=>status(String(e)));},'favorite');favorite.dataset.focusKey='favorite:'+p.id;favorite.setAttribute('aria-pressed',String(!!p.favorite));
      const insertButton=action('插入输入框',()=>choose(p),'primary');insertButton.onmousedown=e=>e.preventDefault();bodyActions.append(favorite,insertButton);body.append(content,bodyActions);
      }
      row.append(body);fragment.append(row);
      rows.set(p.id,{prompt:p,mode:viewMode,expanded:expanded.has(p.id),row});
    }
    list.append(fragment);
    if(focusKey)[...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(el=>el.dataset.focusKey===focusKey)?.focus();
    if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=favoritesOnly?'暂无常用提示词。点击列表里的 ☆ 即可置顶。':prompts.length?'没有匹配的提示词':'暂无提示词，点击右上角「新增」创建。';list.append(empty);}
  }
  let editing: string | null=null;
  function editPrompt(p?: Prompt, content=''): void {
    editing=p?.id??null;$('.library').hidden=true;form.hidden=false;hideHover();
    $('.form-caption').textContent=p?'编辑提示词，保存后立即生效。':'保存后可用 /名称 或标签快速调用。';
    (form.elements.namedItem('name') as HTMLInputElement).value=p?.name??'';
    (form.elements.namedItem('tags') as HTMLInputElement).value=p?.tags.join(', ')??'';
    (form.elements.namedItem('content') as HTMLTextAreaElement).value=p?.content??content;
    (form.elements.namedItem('name') as HTMLInputElement).focus();
  }
  form.onsubmit=e=>{
    e.preventDefault();const data=new FormData(form);
    try{
      const p=parsePrompts([{name:data.get('name'),content:data.get('content'),tags:data.get('tags')}])[0]!;p.id=editing??p.id;
      const previous=prompts.find(x=>x.id===editing);if(previous?.favorite)p.favorite=true;if(previous?.useCount)p.useCount=previous.useCount;if(previous?.lastUsedAt)p.lastUsedAt=previous.lastUsedAt;
      void persist(editing?prompts.map(x=>x.id===editing?p:x):[...prompts,p]).then(()=>{
        form.hidden=true;$('.library').hidden=false;status('已保存');
      }).catch(e=>status(String(e)));
    }catch(e){status(String(e));}
  };
  launch.onclick=()=>{
    if(busy())return;if(!modal.hidden){close();return;}
    const editor=document.activeElement?.closest<Editor>(SELECTOR)??document.querySelector<Editor>(SELECTOR);
    saved=editor?cursor(editor):null;
    if(editor&&!saved){editor.focus();saved=cursor(editor);}
    closeQuick();modal.hidden=false;launch.setAttribute('aria-expanded','true');placePanel();
    status('');render();$<HTMLInputElement>('.search').focus();
  };
  const header=$('header');
  let panelDrag: {id:number;x:number;y:number;left:number;top:number} | null=null;
  header.addEventListener('pointerdown',e=>{
    if(e.button!==0||(e.target instanceof Element&&e.target.closest('button')))return;
    const r=panel.getBoundingClientRect();panelDrag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
    e.preventDefault();header.setPointerCapture(e.pointerId);header.dataset.dragging='true';hideHover();
  });
  header.addEventListener('pointermove',e=>{
    if(!panelDrag||e.pointerId!==panelDrag.id)return;
    const r=panel.getBoundingClientRect();
    const left=Math.max(10,Math.min(panelDrag.left+e.clientX-panelDrag.x,innerWidth-r.width-10));
    const top=Math.max(10,Math.min(panelDrag.top+e.clientY-panelDrag.y,innerHeight-r.height-10));
    panel.style.left=`${left}px`;panel.style.top=`${top}px`;
    panelPosition={x:left/Math.max(1,innerWidth-r.width),y:top/Math.max(1,innerHeight-r.height)};
  });
  const finishPanelDrag=(e:PointerEvent)=>{if(e.pointerId===panelDrag?.id){panelDrag=null;delete header.dataset.dragging;saveUI();}};
  header.addEventListener('pointerup',finishPanelDrag);header.addEventListener('pointercancel',finishPanelDrag);
  $('.close').onclick=close;
  $('.cancel').onclick=()=>{form.hidden=true;$('.library').hidden=false;};
  $('.new').onclick=()=>editPrompt();
  $('.draft').onclick=()=>{editPrompt(undefined,saved?.editor?tokens.text(saved.editor):'');$<HTMLDetailsElement>('.backup').open=false;};
  $('.search').oninput=render;
  $('.list').addEventListener('scroll',hideHover);
  $('.view-toggle').onclick=()=>{viewMode=viewMode==='compact'?'cards':'compact';render();saveUI();};
  $('.favorites-library').onclick=()=>{favoritesOnly=!favoritesOnly;render();};
  $('.theme').onclick=()=>{theme=getComputedStyle(host).colorScheme==='dark'?'light':'dark';applyUI();saveUI();};
  $('.pin').onclick=()=>{pinned=!pinned;applyUI();saveUI();};
  $('.export').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,prompts},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='chatgpt-prompts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $<HTMLDetailsElement>('.backup').open=false;
  };
  $('.import').onclick=()=>$<HTMLInputElement>('.file').click();
  $<HTMLInputElement>('.file').onchange=async()=>{
    const input=$<HTMLInputElement>('.file');
    try{
      const file=input.files?.[0];if(!file)return;
      const imported=parsePrompts(JSON.parse(await file.text()));const next=mergePrompts(prompts,imported);
      const added=next.length-prompts.length;await persist(next);status(`已导入 ${added} 条（重复项跳过）`);
    }catch(e){status('导入失败：'+String(e));}finally{input.value='';$<HTMLDetailsElement>('.backup').open=false;}
  };
  function update(): void {
    if(host.hidden||composing||!modal.hidden||busy()){closeQuick();return;}
    const editor=document.activeElement?.closest<Editor>(SELECTOR);const c=editor?cursor(editor):null;
    const collapsed=c&&(c.range?c.range.collapsed:c.start===c.end);
    const match=collapsed?queryAt(c):null;
    if(!c||!match){nativeMode=false;closeQuick();return;}
    if(nativeMode){closeQuick();return;}
    slash=c;const next=index.search(match[1]!.slice(1));const unchanged=matches.length===next.length&&matches.every((p,i)=>p===next[i]);matches=next;selected=0;
    const r=editor!.getBoundingClientRect();
    quick.style.left=`${Math.max(12,Math.min(r.left,innerWidth-Math.min(380,innerWidth-24)-12))}px`;
    $('.options').style.maxHeight=`${Math.max(40,Math.min(288,innerHeight-32))}px`;
    if(!unchanged||!$('.options').childElementCount)drawQuick();else paintSelection();quick.hidden=false;
    const h=quick.getBoundingClientRect().height;
    const above=r.top-h-8;
    const y=above>=12?above:Math.min(r.bottom+8,innerHeight-h-12);
    quick.style.top=`${Math.max(12,Math.min(y,innerHeight-h-12))}px`;
    quick.style.bottom='auto';
    document.documentElement.setAttribute('data-native-longshot-slash','');
  }
  function drawQuick(): void {
    const options=$('.options');options.replaceChildren();optionButtons=[];paintedSelection=-1;
    matches.forEach((p,i)=>{
      const b=action('',()=>choose(p,true));b.role='option';b.id=`native-prompt-option-${i}`;b.setAttribute('aria-selected',String(i===selected));
      const name=document.createElement('strong');name.className='option-name';name.textContent=p.name;if(p.favorite){const star=document.createElement('span');star.className='option-star';star.textContent=' ★';star.setAttribute('aria-hidden','true');name.append(star);}
      const tags=document.createElement('span');tags.className='option-tags';
      p.tags.forEach(tag=>{const chip=document.createElement('span');chip.className='option-tag';chip.textContent=tag;tags.append(chip);});
      b.append(name,tags);
      b.onpointerenter=()=>preview(p,b);b.onpointerleave=hideHover;
      b.onmousedown=e=>e.preventDefault();
      b.onpointermove=()=>{selected=i;paintSelection();};options.append(b);optionButtons.push(b);
    });
    if(!matches.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=prompts.length?'没有匹配的提示词':'暂无提示词，点击悬浮球新增';options.append(empty);}
    paintSelection();
  }
  function paintSelection(): void {
    if(paintedSelection===selected)return;
    optionButtons[paintedSelection]?.setAttribute('aria-selected','false');
    optionButtons[selected]?.setAttribute('aria-selected','true');paintedSelection=selected;
    $('.options').setAttribute('aria-activedescendant',`native-prompt-option-${selected}`);
    optionButtons[selected]?.scrollIntoView({block:'nearest'});
  }
  $('.options').addEventListener('scroll',hideHover);
  document.addEventListener('input',e=>{
    if(host.hidden)return;
    if(e instanceof InputEvent&&e.isComposing)return;
    if(nativeMode&&e.target instanceof HTMLElement){
      const value=e.target instanceof HTMLTextAreaElement?e.target.value:e.target.textContent??'';
      if(!value.includes('/'))nativeMode=false;
    }
    queueUpdate();
  });
  function rememberComposer(): void {
    if(modal.hidden||!pinned)return;
    const editor=document.activeElement?.closest<Editor>(SELECTOR);
    if(editor){const current=cursor(editor);if(current)saved=current;}
  }
  // ProseMirror may settle the pasted selection after the input frame.
  let selectionFrame=0;
  function queueUpdate():void{cancelAnimationFrame(selectionFrame);selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;rememberComposer();update();});}
  document.addEventListener('selectionchange',()=>{
    if(host.hidden)return;
    rememberComposer();
    if(!document.activeElement?.closest(SELECTOR))return;
    queueUpdate();
  });
  document.addEventListener('compositionstart',()=>{composing=true;closeQuick();});
  document.addEventListener('compositionend',()=>{composing=false;queueUpdate();});
  document.addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))update();});
  document.addEventListener('click',e=>{if(e.target!==host)update();});
  window.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(!modal.hidden&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
    if(!modal.hidden&&e.key==='Tab'){
      const controls=[...modal.querySelectorAll<HTMLElement>('button,input,textarea,summary')].filter(el=>el.getClientRects().length>0);
      const current=root.activeElement;
      if(!current||!modal.contains(current)){e.preventDefault();(e.shiftKey?controls.at(-1):controls[0])?.focus();}
      else if(e.shiftKey&&current===controls[0]){e.preventDefault();controls.at(-1)?.focus();}
      else if(!e.shiftKey&&current===controls.at(-1)){e.preventDefault();controls[0]?.focus();}
      return;
    }
    if(quick.hidden||!slash)return;
    if(e.altKey&&(e.key==='/'||e.code==='Slash')){e.preventDefault();e.stopImmediatePropagation();nativeMode=true;closeQuick();return;}
    if(e.key==='Escape'){
      // Let the same real Escape also dismiss the native command menu state.
      e.preventDefault();closeQuick();return;
    }
    if(['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)){
      e.preventDefault();e.stopImmediatePropagation();
      if(!matches.length)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){selected=(selected+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;paintSelection();}
      else choose(matches[selected]!,true);
    }
  },true);
  document.addEventListener('pointerdown',e=>{
    if(e.target===host)return;
    if(!modal.hidden&&!pinned)close();
    if(!(e.target instanceof Element&&e.target.closest(SELECTOR)))closeQuick();
  },true);
  document.addEventListener('focusin',e=>{
    if(e.target!==host&&!(e.target instanceof Element&&e.target.closest(SELECTOR)))closeQuick();
  });
  window.addEventListener('resize',()=>{placePanel();if(!quick.hidden)update();});
  return {setEnabled(enabled){tokens.setEnabled(enabled);host.hidden=!enabled;if(!enabled){cancelAnimationFrame(selectionFrame);selectionFrame=0;close();closeQuick();}},open(){if(!host.hidden)launch.click();}};
}
