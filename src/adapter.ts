export const ASSISTANT = '[data-message-author-role="assistant"], [data-role="assistant"], [data-testid="assistant-message"]';
export interface Answer { body: HTMLElement; message: HTMLElement; actions: HTMLElement | null }
const TURN = 'article, [data-testid^="conversation-turn-"], [data-talvt-turn-state]';
export function answers(root: ParentNode): Answer[] {
  const result: Answer[] = [];
  const bodies = new Set<HTMLElement>();
  const add = (body: HTMLElement, message: HTMLElement): void => {
    if (bodies.has(body)) return;
    if (!body.textContent?.trim() && !body.querySelector('img,svg,canvas,iframe')) return;
    const follows = (el: HTMLElement): boolean => !body.contains(el) &&
      !!(body.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const actions = [...message.querySelectorAll<HTMLElement>('[data-longshot-actions], [role="toolbar"], .turn-action-controls')].find(follows) ??
      [...message.querySelectorAll<HTMLElement>('[data-testid="copy-turn-action-button"], button[aria-label="Copy"], button[aria-label="复制"]')]
        .map(el => el.parentElement).find((el): el is HTMLElement => !!el && follows(el)) ?? null;
    bodies.add(body);
    result.push({ body, message, actions: actions && !body.contains(actions) ? actions : null });
  };
  for (const node of root.querySelectorAll<HTMLElement>(ASSISTANT)) {
    if (node.parentElement?.closest(ASSISTANT)) continue;
    const message = node.closest<HTMLElement>(`${TURN}, [data-message-id]`) ?? node;
    // Keep all rich components in the role element, not just its first Markdown child.
    add(node, message);
  }
  // ChatGPT's newer turn renderer uses a screen-reader heading followed by
  // the rich response, with user prompt and reasoning in separate siblings.
  // Use its semantic role first, then the native localized heading as fallback.
  for (const heading of root.querySelectorAll<HTMLElement>('[data-conversation-role="assistant"], h4')) {
    if (heading.closest(ASSISTANT)) continue;
    const message = heading.closest<HTMLElement>(TURN);
    if (!message || message.querySelector(ASSISTANT)) continue;
    if (heading.getAttribute('data-conversation-role') !== 'assistant' &&
      !/^(ChatGPT\s*(说[：:]|said[：:]?)|Assistant[：:])$/i.test(heading.textContent?.trim() ?? '')) continue;
    const body = heading.nextElementSibling;
    if (body instanceof HTMLElement && !body.querySelector('h4[data-conversation-role]')) add(body, message);
  }
  return result;
}
export function isGenerating(answer: Answer): boolean {
  return !!answer.body.closest('[data-is-streaming="true"], [data-talvt-turn-state="streaming"], [data-talvt-turn-state="in_progress"]') ||
    !!answer.body.querySelector('[data-is-streaming="true"], .result-streaming') ||
    !!document.querySelector('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="停止生成"]');
}
export function scrollAncestors(element: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let p = element.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 1) result.push(p);
  }
  const root = document.scrollingElement as HTMLElement;
  if (root && !result.includes(root)) result.push(root);
  return result;
}
export function warnings(body: HTMLElement): string[] {
  const result = new Set<string>();
  for (const el of body.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2)
      result.add('宽表格或代码块按当前横向滚动位置捕获，隐藏的横向内容不包含在图片中。');
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2)
      result.add('回答内部有独立纵向滚动区域，仅保留该区域当前可见内容。');
  }
  if (body.querySelector('iframe')) result.add('嵌入式页面按浏览器当前可见状态捕获，无法检查跨域内容的加载状态。');
  return [...result];
}
