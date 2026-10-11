import { answers, type Answer } from './adapter';
import { capture } from './capture';
import { copyPng } from './clipboard';
import { openPreview } from './transport';
import { LIMITS, errorText, assertAlive } from './shared';
const flag = '__nativeLongshotInstalled';
const globals = globalThis as typeof globalThis & { [flag]?: boolean };
if (!globals[flag]) { globals[flag] = true; install(); }
function install(): void {
  let busy = false;
  const bound = new WeakMap<HTMLElement, HTMLElement>();
  const notice = document.createElement('div');
  notice.dataset.nativeLongshotUi = 'notice';
  const shadow = notice.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:2147483647; color-scheme:inherit; }
    .notice { max-width:min(580px,85vw); padding:12px 16px; background:light-dark(#fff,#292929); color:light-dark(#222,#eee); border:1px solid light-dark(#ddd,#555); border-radius:8px; font:13px/1.6 system-ui; box-shadow:0 2px 12px #0002; }
    .notice:empty { display:none } button { font:inherit; margin:6px 8px 0 0; cursor:pointer; } button:focus-visible { outline:2px solid currentColor; outline-offset:2px }
    .notice[data-busy] { box-shadow:none }
    .notice[data-busy]::before { content:""; display:inline-block; width:12px; height:12px; margin-right:8px; vertical-align:-2px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg) } }
    @media (prefers-reduced-motion:reduce) { .notice[data-busy]::before { animation:none } }
  </style><div class="notice" role="status" aria-live="polite"></div>`;
  const text = shadow.querySelector<HTMLDivElement>('.notice')!;
  let dismiss: ReturnType<typeof setTimeout> | undefined;
  function setBusy(value: boolean): void {
    busy = value;
    for (const host of document.querySelectorAll('[data-native-longshot-ui="button"]')) {
      const button = host.shadowRoot?.querySelector('button');
      if (button) button.disabled = value;
    }
  }
  function show(message: string, retry?: () => Promise<void>): void {
    clearTimeout(dismiss); delete text.dataset.busy; text.textContent = message;
    if (retry) {
      const open = document.createElement('button'); open.textContent = '打开预览 / 保存 PNG';
      open.addEventListener('click', () => {
        if (busy) return;
        setBusy(true); open.disabled = true; close.disabled = true;
        text.dataset.busy = 'true'; open.textContent = '正在准备预览…';
        void retry().then(() => { delete text.dataset.busy; text.textContent = ''; },
          e => { show('预览打开失败：' + errorText(e), retry); }).finally(() => { setBusy(false); });
      });
      text.append(document.createElement('br'), open);
      const close = document.createElement('button'); close.textContent = '关闭';
      close.addEventListener('click', () => { text.textContent = ''; }); text.append(close);
    } else dismiss = setTimeout(() => { if (!busy) text.textContent = ''; }, 6500);
  }
  document.documentElement.append(notice);
  async function run(answer: Answer, button: HTMLButtonElement): Promise<void> {
    if (busy) return;
    setBusy(true); button.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); controller.abort(new DOMException('已取消', 'AbortError')); }
    };
    document.addEventListener('keydown', cancel, true);
    const timer = setTimeout(() => controller.abort(new Error('截图超时，请缩短回答或重新尝试。')), LIMITS.timeout);
    const progress = (message: string): void => {
      clearTimeout(dismiss); text.dataset.busy = 'true'; text.textContent = message; button.title = message;
    };
    try {
      progress('正在截图，按 Esc 取消。');
      const result = await capture(answer, controller.signal, progress);
      assertAlive(controller.signal);
      // Clipboard writes cannot be cancelled once submitted. Stop intercepting
      // Escape and stop the screenshot timer before entering that phase.
      clearTimeout(timer); document.removeEventListener('keydown', cancel, true);
      if (result.parts.length !== 1) {
        show(`图片已生成，超过单张安全尺寸，已分为 ${result.parts.length} 张 PNG。` + result.warnings.join(' '), () => openPreview(result));
      } else {
        progress('正在复制到剪贴板…');
        try {
          await copyPng(result.parts[0]!);
          show('长图已复制。' + result.warnings.join(' '));
        } catch (e) {
          show('图片生成成功，但复制失败：' + errorText(e) + ' ' + result.warnings.join(' '), () => openPreview(result));
        }
      }
    } catch (e) {
      show(controller.signal.aborted && e === controller.signal.reason ? errorText(controller.signal.reason) : '截图失败：' + errorText(e));
    } finally {
      clearTimeout(timer); document.removeEventListener('keydown', cancel, true);
      setBusy(false); button.removeAttribute('aria-busy'); button.title = '复制长图';
    }
  }
  function bind(answer: Answer): void {
    const existing = bound.get(answer.body);
    if (existing?.isConnected) {
      if (answer.actions && existing.parentElement !== answer.actions) answer.actions.append(existing);
      return;
    }
    const host = document.createElement('span'); host.dataset.nativeLongshotUi = 'button';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display:inline-flex; vertical-align:middle; color:inherit; }
      button { width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; background:transparent; color:inherit; opacity:.65; border:0; border-radius:6px; cursor:pointer; padding:6px; }
      button:hover { background:#8882; opacity:1 } button:focus-visible { outline:2px solid currentColor; outline-offset:2px }
      button:disabled { cursor:wait; opacity:.35 } svg { width:18px; height:18px; }
    </style><button type="button" title="复制长图" aria-label="复制这条回答为 PNG 长图"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h6M9 11h6m-3 3v4m-2-2 2 2 2-2"/></svg></button>`;
    const button = root.querySelector('button')!;
    button.disabled = busy;
    button.addEventListener('click', () => { void run(answer, button); });
    if (answer.actions) answer.actions.append(host); else answer.body.after(host);
    bound.set(answer.body, host);
  }
  const dirty = new Set<ParentNode>();
  let scheduled = false;
  function scan(): void {
    scheduled = false;
    for (const parent of dirty) {
      if (parent instanceof Element && !parent.isConnected) continue;
      for (const answer of answers(parent)) bind(answer);
    }
    dirty.clear();
  }
  function queue(node: Node): void {
    const el = node instanceof Element ? node : node.parentElement;
    if (!el || el.closest('[data-native-longshot-ui]')) return;
    dirty.add(el.closest('article, [data-testid^="conversation-turn-"], [data-talvt-turn-state]') ?? el.parentElement ?? document);
    if (!scheduled) { scheduled = true; setTimeout(scan, 150); }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        if ([...record.addedNodes, ...record.removedNodes].every(n => n instanceof Element && n.hasAttribute('data-native-longshot-ui'))) continue;
        queue(record.target);
      } else queue(record.target);
    }
  });
  // Watch insertion/replacement for SPA routing. Scans are scoped to changed turns.
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  dirty.add(document); scan();
}
