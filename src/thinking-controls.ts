// Native visible controls only; never bypass the site state with private APIs.
const optionSelector = '[role="menuitemradio"], [role="option"], [role="radio"], [role="menuitem"]';
const surfaceSelector = '[role="menu"], [role="listbox"], [role="radiogroup"], [role="dialog"]';
const beforeOpen = new WeakMap<HTMLElement, Set<Element>>();
const aliases = [
  ['light', 'low', '低', '轻度', '輕度', '轻量', '輕量'],
  ['standard', 'medium', '标准', '標準', '中等', '中'],
  ['extended', 'high', '扩展', '擴展', '延长', '延長', '高'],
  ['heavy', 'extra high', '深度', '超高', '极高', '極高', '重度'],
];
export function levelOf(text: string): number {
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases.findIndex(group => group.some(label => value === label || value.startsWith(label + ' ') || value.startsWith(label + '\n')));
}
function visible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return el.isConnected && el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}
function label(el: HTMLElement): string {
  return el.getAttribute('aria-label') || el.innerText || el.textContent || '';
}
function enabled(el: HTMLElement): boolean {
  return !el.matches(':disabled, [aria-disabled="true"], [data-disabled]');
}
function associated(trigger: HTMLElement, el: HTMLElement, controlledRoot: HTMLElement | null): boolean {
  if (controlledRoot) return controlledRoot.contains(el);
  const surface = el.closest(surfaceSelector);
  if (!surface) return false;
  if (trigger.id && surface.getAttribute('aria-labelledby')?.split(/\s+/).includes(trigger.id)) return true;
  const composer = trigger.closest('form, [data-testid="composer"], #composer-background');
  if (composer?.contains(surface)) return true;
  const previous = beforeOpen.get(trigger);
  return !!previous && !previous.has(surface);
}
function findTrigger(): HTMLElement | undefined {
  const candidates = [...document.querySelectorAll<HTMLElement>('button[aria-haspopup], [role="button"][aria-haspopup]')]
    .filter(el => visible(el) && enabled(el) && !el.closest('[data-message-author-role], article, [data-native-longshot-ui]'));
  // Explicit thinking labels are safe anywhere outside conversation content.
  const explicit = candidates.filter(el => /thinking (time|effort)|reasoning (effort|level)|思考(时间|時間|强度|強度|程度)/i.test(label(el)));
  if (explicit.length === 1) return explicit[0];
  // Some versions show only the selected level or "Thinking" in the composer.
  const composer = candidates.filter(el => el.closest('form, [data-testid="composer"], #composer-background') &&
    (levelOf(label(el)) >= 0 || /^(thinking|思考|深度思考)$/i.test(label(el).trim())));
  if (composer.length === 1) return composer[0];
  // Newer layouts place the effort options inside the composer model picker.
  const picker = candidates.filter(el => /^(选择 ChatGPT 模型|選擇 ChatGPT 模型|select chatgpt model|choose chatgpt model)$/i.test(label(el).trim()));
  return picker.length === 1 ? picker[0] : undefined;
}
function options(trigger: HTMLElement): HTMLElement[] {
  const controlled = trigger.getAttribute('aria-controls');
  const root = controlled ? document.getElementById(controlled) : null;
  if (controlled && !root) return [];
  const candidates = [...(root ?? document).querySelectorAll<HTMLElement>(optionSelector + ', [role="radiogroup"] button[aria-pressed]')]
    .filter(el => visible(el) && associated(trigger, el, root) && levelOf(label(el)) >= 0 && !el.closest('article, [data-message-author-role], [data-native-longshot-ui]'));
  // Never use similarly named options from two different menus.
  const groups = new Set(candidates.map(el => el.closest('[role="menu"], [role="listbox"], [role="radiogroup"]')));
  return groups.size === 1 ? candidates : [];
}
function checked(el: HTMLElement): boolean {
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-pressed') === 'true' || el.dataset.state === 'checked';
}
function thinkingSlider(trigger: HTMLElement): HTMLElement | undefined {
  const controlled = trigger.getAttribute('aria-controls');
  const root = controlled ? document.getElementById(controlled) : null;
  if (controlled && !root) return undefined;
  const sliders = [...(root ?? document).querySelectorAll<HTMLElement>('input[type="range"], [role="slider"]')]
    .filter(el => visible(el) && associated(trigger, el, root) && enabled(el) && !el.closest('article, [data-message-author-role], [data-native-longshot-ui]') &&
      (root?.contains(el) || /强度|強度|思考|thinking|effort|intensity/i.test(label(el)) ||
        /选择 ChatGPT 模型|select chatgpt model/i.test(el.closest('[role="dialog"]')?.getAttribute('aria-label') ?? '')));
  return sliders.length === 1 ? sliders[0] : undefined;
}
function sliderValue(el: HTMLElement): number {
  const raw = el instanceof HTMLInputElement ? el.value : el.getAttribute('aria-valuenow');
  return raw === null || raw.trim() === '' ? NaN : Number(raw);
}
export interface ThinkingSession { opened: Set<HTMLElement>; roots: Set<Element>; trigger?: HTMLElement; url: string; check?:()=>void }
export function createThinkingSession(): ThinkingSession { return { opened: new Set(), roots: new Set(), url: location.href }; }
export function thinkingOwnsFocus(session: ThinkingSession, el: Element | null): boolean {
  if (!el) return false;
  if (el === session.trigger) return true;
  const controlled = session.trigger?.getAttribute('aria-controls');
  if (controlled) return !!document.getElementById(controlled)?.contains(el);
  return [...session.roots].some(root => root.contains(el));
}
export function closeThinkingSession(session: ThinkingSession): void {
  for (const trigger of session.opened) {
    beforeOpen.delete(trigger);
    if (trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true')
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  session.opened.clear();
}
function aborted(signal: AbortSignal): void { signal.throwIfAborted(); }
// Observe only for the lifetime of an outstanding operation. Mutation bursts
// are already batched; text-only bursts use a frame and property-only inputs a sparse fallback.
function waitFor<T>(read: () => T | undefined, signal: AbortSignal): Promise<T> {
  aborted(signal);
  const immediate = read();
  if (immediate !== undefined) return Promise.resolve(immediate);
  return new Promise<T>((resolve, reject) => {
    let frame = 0;
    const observer = new MutationObserver(records => {
      // DOM mutation callbacks already batch a commit. Opening a portal or
      // acknowledging an ARIA value should not incur an extra animation frame.
      if(records.some(record=>record.type!=='characterData'))check();
      else if (!frame) frame = requestAnimationFrame(() => { frame = 0; check(); });
    });
    const cleanup = () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      clearInterval(fallback); clearTimeout(timeout); signal.removeEventListener('abort', cancel);
    };
    const cancel = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const check = () => {
      try { const result = read(); if (result !== undefined) { cleanup(); resolve(result); } }
      catch (error) { cleanup(); reject(error); }
    };
    const fallback = setInterval(check, 120);
    const timeout = setTimeout(() => { cleanup(); reject(new Error('页面没有确认思考强度，请手动检查菜单后重试。')); }, 1800);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    signal.addEventListener('abort', cancel, { once: true });
    // Close the read/observe race without waiting for a timer.
    check();
  });
}
function nextFrame(signal: AbortSignal): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { cancelAnimationFrame(frame); clearTimeout(fallback); signal.removeEventListener('abort', cancel); };
    const done = () => { cleanup(); resolve(); };
    const cancel = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const frame = requestAnimationFrame(done);
    // Background tabs can suspend animation frames indefinitely.
    const fallback = setTimeout(done, 100);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
function currentTrigger(session: ThinkingSession): HTMLElement | undefined {
  session.check?.();
  if (session.url !== location.href) throw new Error('页面已变化，已停止切换思考强度。');
  if (session.trigger?.isConnected && visible(session.trigger) && enabled(session.trigger)) return session.trigger;
  if (session.trigger) throw new Error('思考强度选择器已变化，请重试。');
  return session.trigger = findTrigger();
}
async function openSelector(trigger: HTMLElement, signal: AbortSignal, session: ThinkingSession): Promise<void> {
  aborted(signal); session.check?.();
  if (trigger.getAttribute('aria-expanded') === 'true') return;
  session.opened.add(trigger);
  beforeOpen.set(trigger, new Set([...document.querySelectorAll<HTMLElement>(surfaceSelector)].filter(visible)));
  trigger.click();
  // Let React process the event before the keyboard-only Radix fallback.
  await Promise.resolve(); aborted(signal); currentTrigger(session);
  if (trigger.getAttribute('aria-expanded') === 'true' || thinkingSlider(trigger) || options(trigger).length) return;
  await nextFrame(signal); aborted(signal); currentTrigger(session);
  if (trigger.getAttribute('aria-expanded') === 'true' || thinkingSlider(trigger) || options(trigger).length) return;
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
}
async function cycleSlider(trigger: HTMLElement, slider: HTMLElement, direction: 1 | -1,
  signal: AbortSignal, session: ThinkingSession): Promise<string> {
  const native = slider instanceof HTMLInputElement;
  const minText = native ? slider.min || '0' : slider.getAttribute('aria-valuemin');
  const maxText = native ? slider.max || '100' : slider.getAttribute('aria-valuemax');
  const stepText = native ? slider.step || '1' : slider.getAttribute('data-step') || '1';
  const min = Number(minText), max = Number(maxText), step = Number(stepText), current = sliderValue(slider);
  const count = (max - min) / step + 1;
  if (minText === null || maxText === null || stepText === null ||
    !minText.trim() || !maxText.trim() || !stepText.trim() || ![min,max,step,current].every(Number.isFinite) ||
    step <= 0 || !Number.isInteger(count) || count < 2 || count > 8 || current < min || current > max ||
    !Number.isInteger((current - min) / step))
    throw new Error('无法识别思考强度滑块档位，请手动检查。');
  const candidate = current + direction * step;
  const next = candidate > max ? min : candidate < min ? max : candidate;
  const previousText = slider.getAttribute('aria-valuetext');
  const previousValueAttribute = slider.getAttribute('value');
  const previousTriggerLabel = label(trigger);
  aborted(signal); session.check?.();
  if (native) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(next));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    slider.focus({ preventScroll: true });
    const key = candidate > max ? 'Home' : candidate < min ? 'End' : direction === 1 ? 'ArrowRight' : 'ArrowLeft';
    slider.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    slider.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
  }
  const confirmed = () => {
    const liveTrigger = currentTrigger(session);
    if (!liveTrigger) return undefined;
    const updated = thinkingSlider(liveTrigger);
    if (!updated || !enabled(updated) || sliderValue(updated) !== next) return undefined;
    // Assigning input.value is not acceptance. Require site-owned state too.
    const text = updated.getAttribute('aria-valuetext');
    const previousLevel = previousText === null ? -1 : levelOf(previousText);
    const updatedLevel = text === null ? -1 : levelOf(text);
    const wrapped = candidate > max || candidate < min;
    // A loading placeholder or a label moving against the requested direction
    // is not a site acknowledgment of the value assigned above.
    const plausibleText = previousLevel < 0 || (updatedLevel >= 0 &&
      (wrapped ? direction * (updatedLevel - previousLevel) < 0 : direction * (updatedLevel - previousLevel) > 0));
    const previousTriggerLevel = levelOf(previousTriggerLabel);
    const triggerLevel = levelOf(label(liveTrigger));
    const triggerAcknowledged = previousTriggerLevel >= 0 && triggerLevel >= 0 &&
      (wrapped ? direction * (triggerLevel - previousTriggerLevel) < 0 : direction * (triggerLevel - previousTriggerLevel) > 0);
    const accepted = !native || (previousText !== null
      ? !!text?.trim() && text !== previousText && plausibleText
      : (updated.getAttribute('value') === String(next) && updated.getAttribute('value') !== previousValueAttribute) ||
        triggerAcknowledged);
    return accepted ? updated : undefined;
  };
  await waitFor(confirmed, signal);
  // Reject synchronous controlled rerenders/reverts before reporting success.
  await nextFrame(signal);
  const updated = await waitFor(confirmed, signal);
  return updated.getAttribute('aria-valuetext') || `第 ${(next - min) / step + 1}/${count} 档`;
}
export async function switchThinking(direction: 1 | -1, signal: AbortSignal, session: ThinkingSession): Promise<string> {
  aborted(signal);
  const trigger = currentTrigger(session);
  if (!trigger) throw new Error('未找到思考强度选择器，请先选择支持调整思考强度的模型。');
  const previous = levelOf(label(trigger));
  await openSelector(trigger, signal, session);
  aborted(signal);
  const control = await waitFor(() => {
    const liveTrigger = currentTrigger(session);
    if (!liveTrigger) return undefined;
    const slider = thinkingSlider(liveTrigger);
    if (slider) {
      const root = slider.closest('[role="menu"], [role="listbox"], [role="radiogroup"], [role="dialog"]');
      if (root) session.roots.add(root);
      return { slider, items: undefined };
    }
    const items = options(liveTrigger);
    if (items.length >= 2) {
      const root = items[0]!.closest('[role="menu"], [role="listbox"], [role="radiogroup"], [role="dialog"]');
      if (root) session.roots.add(root);
    }
    return items.length >= 2 ? { slider: undefined, items } : undefined;
  }, signal);
  const liveTrigger = currentTrigger(session)!;
  if (control.slider) return cycleSlider(liveTrigger, control.slider, direction, signal, session);
  const items = control.items!;
  const checkedItems = items.filter(checked);
  if (checkedItems.length > 1) throw new Error('当前菜单的思考强度状态不明确，请手动检查。');
  const selected = checkedItems[0];
  const current = selected ? levelOf(label(selected)) : previous;
  if (current < 0) throw new Error('无法识别当前思考强度，请先手动选择一次。');
  const available = items.filter(enabled).sort((a, b) => levelOf(label(a)) - levelOf(label(b)));
  if (new Set(available.map(el => levelOf(label(el)))).size !== available.length || available.length < 2)
    throw new Error('当前菜单没有可安全切换的思考强度。');
  const next = direction === 1
    ? available.find(el => levelOf(label(el)) > current) ?? available[0]!
    : [...available].reverse().find(el => levelOf(label(el)) < current) ?? available[available.length - 1]!;
  const nextLevel = levelOf(label(next));
  const nextLabel = label(next).trim().split('\n')[0]!;
  aborted(signal); session.check?.(); next.click();
  // Generic picker labels cannot prove selection. Reopen to read checked state.
  const verifyTrigger = currentTrigger(session);
  if (previous < 0 && verifyTrigger && verifyTrigger.getAttribute('aria-expanded') !== 'true')
    await openSelector(verifyTrigger, signal, session);
  await waitFor(() => {
    const updated = currentTrigger(session);
    if (!updated) return undefined;
    const checkedItems = options(updated).filter(checked);
    if (checkedItems.length > 1) throw new Error('当前菜单的思考强度状态不明确，请手动检查。');
    return levelOf(label(updated)) === nextLevel ||
      (checkedItems.length === 1 && levelOf(label(checkedItems[0]!)) === nextLevel) ? true : undefined;
  }, signal);
  aborted(signal);
  return nextLabel;
}
