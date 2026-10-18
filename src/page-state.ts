import { intersect } from './geometry';
import { assertAlive, delay, type Rect } from './shared';
import { scrollAncestors } from './adapter';
type Property = { el: HTMLElement; name: string; value: string; priority: string };
function hasShadowOverlay(root: ShadowRoot): boolean {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky' ||
      el.matches('[role="tooltip"], [data-radix-popper-content-wrapper]') ||
      (el.shadowRoot && hasShadowOverlay(el.shadowRoot))) return true;
  }
  return false;
}
export class PageState {
  readonly ancestors: HTMLElement[];
  private savedScroll: { el: HTMLElement; x: number; y: number }[];
  private properties: Property[] = [];
  private hidden = new Set<HTMLElement>();
  private loading: { img: HTMLImageElement; value: string | null }[] = [];
  private observer: MutationObserver;
  revision = 0;
  lastChange = performance.now();
  private url = location.href;
  private viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
  constructor(readonly body: HTMLElement, readonly signal: AbortSignal) {
    this.ancestors = scrollAncestors(body);
    this.savedScroll = this.ancestors.map(el => ({ el, x: el.scrollLeft, y: el.scrollTop }));
    for (const el of this.ancestors) {
      this.set(el, 'scroll-behavior', 'auto');
      this.set(el, 'scroll-snap-type', 'none');
      this.set(el, 'overflow-anchor', 'none');
    }
    this.observer = new MutationObserver(records => this.contentChanged(records));
    this.observer.observe(body, { subtree: true, childList: true, characterData: true, attributes: true });
    for (const img of body.querySelectorAll('img')) {
      this.loading.push({ img, value: img.getAttribute('loading') });
      img.loading = 'eager';
    }
  }
  private contentChanged(records: MutationRecord[]): void {
    // Renderer bookkeeping is not a visual change; all other attributes count.
    if (!records.length || records.every(r => r.type === 'attributes' && r.attributeName === 'data-dil-message-id')) return;
    this.revision++; this.lastChange = performance.now();
  }
  set(el: HTMLElement, name: string, value: string): void {
    this.properties.push({ el, name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) });
    el.style.setProperty(name, value, 'important');
  }
  hide(el: HTMLElement): void {
    if (this.hidden.has(el) || el === this.body || el.contains(this.body) || this.body.contains(el)) return;
    this.hidden.add(el); this.set(el, 'visibility', 'hidden');
  }
  hideInterference(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-native-longshot-ui="button"], [data-native-longshot-ui="latex"], [data-native-longshot-ui="prompt-tokens"], [data-native-longshot-ui="prompts"], [data-native-longshot-ui="timeline"]')) this.hide(el);
    // Current ChatGPT places its composer in a grid overlay with relative
    // positioning, so fixed/sticky detection alone cannot exclude it.
    for (const el of document.querySelectorAll<HTMLElement>(
      '[data-thread-scroll-footer], [data-composer-surface-variant], [data-app-shell-main-titlebar], button[aria-label="滚动到底部"], button[aria-label="Scroll to bottom"]')) this.hide(el);
    // Re-check styles on every tile: CSSOM changes and hover states need not
    // produce DOM mutations. Preserve target components and ancestors.
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (el === this.body || this.body.contains(el) || el.contains(this.body)) continue;
      if (el.matches('[data-native-longshot-ui="notice"]')) continue;
      if (el.shadowRoot && hasShadowOverlay(el.shadowRoot)) {
        // Some extensions use a static host and fixed UI in a shadow tree.
        // Opacity on the unrelated host also covers explicit visibility:visible
        // descendants without changing layout or touching answer components.
        if (!this.hidden.has(el)) { this.hide(el); this.set(el, 'opacity', '0'); }
        continue;
      }
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky' || el.matches('[role="tooltip"], [data-radix-popper-content-wrapper]')) this.hide(el);
    }
  }
  async freezeViewport(): Promise<void> {
    let previous = ''; let equal = 0;
    for (let i = 0; i < 40; i++) {
      assertAlive(this.signal);
      const current = JSON.stringify([innerWidth, innerHeight, devicePixelRatio]);
      equal = current === previous ? equal + 1 : 0;
      if (equal >= 5) { this.viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }; return; }
      previous = current;
      await delay(50, this.signal);
    }
    throw new Error('Chrome 调试提示条出现后视口仍不稳定。');
  }
  check(): void {
    assertAlive(this.signal);
    if (location.href !== this.url || !this.body.isConnected) throw new Error('对话已切换，截图已停止。');
    if (innerWidth !== this.viewport.width || innerHeight !== this.viewport.height || devicePixelRatio !== this.viewport.dpr)
      throw new Error('截图期间窗口尺寸或缩放改变，请重新截图。');
    if (document.visibilityState !== 'visible' || !document.hasFocus()) throw new Error('页面失去焦点，截图已停止。');
  }
  safeRect(): Rect {
    let rect: Rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let el = this.body.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const clipX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
      const clipY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
      rect = intersect(rect, { left: clipX ? r.left + el.clientLeft : rect.left,
        right: clipX ? r.left + el.clientLeft + el.clientWidth : rect.right,
        top: clipY ? r.top + el.clientTop : rect.top,
        bottom: clipY ? r.top + el.clientTop + el.clientHeight : rect.bottom });
    }
    // Keep progress visible throughout capture, but never copy its pixels into
    // the answer. Reserve its bottom overlay band without changing page layout.
    const notice = document.querySelector<HTMLElement>('[data-native-longshot-ui="notice"]');
    if (notice && getComputedStyle(notice).visibility !== 'hidden') {
      const r = notice.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > rect.left && r.left < rect.right)
        rect.bottom = Math.min(rect.bottom, r.top - 8);
    }
    // A stuck code-header is genuine content at its natural position, but an
    // occluder on later tiles. Skip its overlay band, keeping its initial pixels.
    for (const el of this.body.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(el);
      if (style.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      // A negative sticky inset can still leave a visible header at the clipped
      // viewport edge (e.g. ChatGPT writing blocks). Use its actual pixels.
      if (style.top !== 'auto' && r.top <= rect.top + Math.max(0, parseFloat(style.top) || 0) + 1 && r.bottom > rect.top)
        rect.top = Math.max(rect.top, r.bottom);
      if (style.bottom !== 'auto' && r.bottom >= rect.bottom - Math.max(0, parseFloat(style.bottom) || 0) - 1 && r.top < rect.bottom)
        rect.bottom = Math.min(rect.bottom, r.top);
    }
    return rect;
  }
  async settle(justVerified?: string): Promise<string> {
    let previous = ''; let equal = 0;
    for (let i = 0; i < 100; i++) {
      this.check();
      // A caller may change DOM in the same task, before observer delivery.
      this.contentChanged(this.observer.takeRecords());
      const r = this.body.getBoundingClientRect();
      const current = JSON.stringify([r.x, r.y, r.width, r.height, this.revision, ...this.ancestors.map(el => [el.scrollTop, el.scrollLeft])]);
      // Only capture's immediate continuation after moveTo supplies this token.
      // No persistent cache: all other callers do the full stability check.
      if (current === justVerified) return current;
      equal = current === previous ? equal + 1 : 0;
      if (equal >= 3 && performance.now() - this.lastChange > 200) {
        return current;
      }
      previous = current;
      await delay(50, this.signal);
    }
    throw new Error('回答的布局持续变化，请等生成、图片和动画结束后再截图。');
  }
  async moveTo(offset: number, scale = devicePixelRatio): Promise<string | undefined> {
    let verified: string | undefined;
    // Distribute movement over every scrollable ancestor, from inner to outer.
    // Read actual positions after scroll clamping; never assume requested = actual.
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = this.body.getBoundingClientRect();
      const safe = this.safeRect();
      let delta = r.top + offset - safe.top - 24;
      if (Math.abs(delta) < 1 / scale) break;
      let moved = 0;
      for (const el of this.ancestors) {
        const before = el.scrollTop;
        el.scrollTop = Math.round((before + delta) * scale) / scale;
        const actual = el.scrollTop - before;
        moved += actual; delta -= actual;
      }
      verified = await this.settle();
      if (Math.abs(moved) < 0.1) break;
    }
    return verified;
  }
  async mediaReady(): Promise<void> {
    await this.bounded(document.fonts.ready);
    for (const img of this.body.querySelectorAll('img')) {
      await this.bounded(img.decode());
      if (!img.naturalWidth) throw new Error('回答中有图片加载失败，请加载完成后重试。');
    }
    await this.settle();
  }
  private async bounded<T>(promise: Promise<T>): Promise<T> {
    const timer = new AbortController();
    try {
      return await Promise.race([promise, delay(10_000, timer.signal).then(() => { throw new Error('字体或图片加载超时。'); }),
        new Promise<never>((_, reject) => {
          const abort = () => reject(this.signal.reason);
          this.signal.addEventListener('abort', abort, { once: true, signal: timer.signal });
        })]);
    } finally { timer.abort(); }
  }
  restore(): void {
    this.observer.disconnect();
    // Restore before scroll-behavior/snap, so CSS smooth scrolling cannot delay it.
    for (const saved of [...this.savedScroll].reverse()) { saved.el.scrollLeft = saved.x; saved.el.scrollTop = saved.y; }
    for (const { img, value } of this.loading) {
      if (value === null) img.removeAttribute('loading'); else img.setAttribute('loading', value);
    }
    for (const p of [...this.properties].reverse()) {
      if (p.value) p.el.style.setProperty(p.name, p.value, p.priority); else p.el.style.removeProperty(p.name);
    }
  }
}
export async function waitForDebuggerViewport(): Promise<void> {
  let previous = ''; let equal = 0;
  // Detach resolves before Chrome finishes removing its infobar. Restore scroll
  // after that resize, otherwise bottom clamping can move the restored position.
  for (let i = 0; i < 30; i++) {
    const current = `${innerWidth}/${innerHeight}/${devicePixelRatio}`;
    equal = current === previous ? equal + 1 : 0;
    if (equal >= 5) return;
    previous = current;
    await delay(50);
  }
}
