const params = new URLSearchParams(location.search);
if (params.has('rich-editor')) {
  const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.setAttribute('role','textbox'); editor.setAttribute('aria-label','Prompt');
  editor.innerHTML = '<p>Keep <strong>this</strong> draft</p>';
  document.querySelector('textarea').replaceWith(editor);
}
const labels = (params.get('levels') || 'Standard,Extended').split(',');
let selected = Number(params.get('selected') || 0);
const trigger = document.querySelector('#effort');
let clicks = 0, opens=0;
trigger.textContent = labels[selected];
if (params.has('picker')) trigger.setAttribute('aria-label','选择 ChatGPT 模型');
function close() { document.querySelector('#effort-menu')?.remove(); trigger.setAttribute('aria-expanded','false'); }
trigger.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
trigger.addEventListener(params.has('keyboard-open') ? 'keydown' : 'click', e => {
  if (params.has('keyboard-open') && e.key !== 'ArrowDown') return;
  if (trigger.getAttribute('aria-expanded') === 'true') { close(); return; }
  opens++;trigger.setAttribute('aria-expanded','true');
  const menu = document.createElement('div'); menu.id = 'effort-menu'; menu.setAttribute('role','menu');
  if (params.has('slider')) {
    menu.setAttribute('role','dialog'); menu.setAttribute('aria-label','选择 ChatGPT 模型');
    const range = document.createElement(params.has('custom-slider') ? 'div' : 'input');
    range.setAttribute('aria-label','强度'); range.setAttribute('aria-valuetext',labels[selected]);
    if (range instanceof HTMLInputElement) {
      range.type = 'range'; range.min = '0'; range.max = String(labels.length-1); range.step = '1'; range.value = String(selected);
      range.addEventListener('input', () => {
        clicks++;
        if (params.has('no-confirm')) { range.value = String(selected); return; }
        selected = Number(range.value); range.setAttribute('aria-valuetext',labels[selected]); trigger.textContent = labels[selected];
      });
    } else {
      range.setAttribute('role','slider'); range.tabIndex=0;
      range.setAttribute('aria-valuemin','0'); range.setAttribute('aria-valuemax',String(labels.length-1)); range.setAttribute('aria-valuenow',String(selected));
      range.addEventListener('keydown', event => {
        if (!['Home','End','ArrowRight','ArrowLeft'].includes(event.key)) return;
        event.preventDefault(); clicks++;
        if (params.has('no-confirm')) return;
        selected = event.key === 'Home' ? 0 : event.key === 'End' ? labels.length-1 :
          Math.max(0,Math.min(selected+(event.key === 'ArrowRight' ? 1 : -1),labels.length-1));
        range.setAttribute('aria-valuenow',String(selected)); range.setAttribute('aria-valuetext',labels[selected]); trigger.textContent = labels[selected];
      });
    }
    menu.append(range); setTimeout(()=>document.body.append(menu),Number(params.get('delay') || 0)); return;
  }
  labels.forEach((label, index) => {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = label;
    item.setAttribute('role','menuitemradio'); item.setAttribute('aria-checked', String(index === selected));
    if (params.has('disabled') && index === Number(params.get('disabled'))) item.disabled = true;
    item.onclick = () => {
      clicks++;
      if (params.has('no-confirm')) { close(); return; }
      selected = index;
      trigger.textContent = labels[selected];
      close();
    };
    menu.append(item);
  });
  setTimeout(() => document.body.append(menu), Number(params.get('delay') || 0));
});
window.fixtureClicks = () => clicks;
window.fixtureOpens = () => opens;
if (params.has('missing')) trigger.remove();
