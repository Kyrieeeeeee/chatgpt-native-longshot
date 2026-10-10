import { CHANNEL, LIMITS, errorText, type Request, type Reply } from './shared';
declare const __TEST__: boolean;
type Session = { tabId: number; job: string; timer: ReturnType<typeof setTimeout>; detached: boolean };
type Preview = { owner: number; chunks: { index: number; chunk: string; width: number; height: number }[]; warnings: string[]; bytes: number; expires: number; previewTab?: number };
let session: Session | undefined;
const previews = new Map<string, Preview>();
function allowed(url: string | undefined): boolean {
  if (!url) return false;
  const u = new URL(url);
  return (u.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(u.hostname)) ||
    (__TEST__ && u.origin === 'http://127.0.0.1:8799');
}
async function end(current: Session): Promise<void> {
  clearTimeout(current.timer);
  try {
    if (!current.detached) await chrome.debugger.detach({ tabId: current.tabId });
  } catch (e) {
    // Self-initiated or racing detach can precede onDetach. Already released is
    // an idempotent cleanup result; every other error remains visible.
    if (!errorText(e).includes('Debugger is not attached')) throw e;
    current.detached = true;
  } finally {
    if (session === current) session = undefined;
  }
}
chrome.debugger.onDetach.addListener(source => {
  const current = session;
  if (current && current.tabId === source.tabId) { current.detached = true; clearTimeout(current.timer); session = undefined; }
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [token, p] of previews) if (p.owner === tabId || p.previewTab === tabId) previews.delete(token);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const current = session;
  // Full navigation destroys the content script before its finally can run.
  // Release here so a session cannot follow the tab onto another document.
  if (change.status === 'loading' && current?.tabId === tabId)
    void end(current).catch(e => console.warn('[Longshot] navigation cleanup', errorText(e)));
});
async function handle(m: Request, sender: chrome.runtime.MessageSender): Promise<Reply> {
  for (const [token, p] of previews) if (p.expires < Date.now()) previews.delete(token);
  if (m.type === 'take') {
    const p = previews.get(m.token);
    if (!p || sender.url !== chrome.runtime.getURL('preview.html') + '#' + m.token || sender.tab?.id !== p.previewTab)
      throw new Error('预览已过期，请重新生成。');
    if (m.index === undefined) return { ok: true, data: JSON.stringify({ warnings: p.warnings, count: p.chunks.length }) };
    const chunk = p.chunks[m.index];
    if (!chunk) throw new Error('预览分片不存在。');
    const data = JSON.stringify(chunk);
    if (m.index === p.chunks.length - 1) previews.delete(m.token);
    return { ok: true, data };
  }
  if (sender.frameId !== 0 || !allowed(sender.url) || sender.tab?.id === undefined)
    throw new Error('仅允许 ChatGPT 顶层页面发起截图。');
  const tabId = sender.tab.id;
  if (m.type === 'preview-start') {
    for (const [token, p] of previews) if (p.owner === tabId) previews.delete(token);
    if (previews.size >= 3) throw new Error('待打开的预览过多，请稍后重试。');
    const token = crypto.randomUUID();
    previews.set(token, { owner: tabId, chunks: [], warnings: m.warnings.slice(0, 20), bytes: 0, expires: Date.now() + 300_000 });
    return { ok: true, token };
  }
  if (m.type === 'preview-chunk' || m.type === 'preview-open') {
    const p = previews.get(m.token);
    if (!p || p.owner !== tabId) throw new Error('预览已过期。');
    if (m.type === 'preview-chunk') {
      if (typeof m.chunk !== 'string' || m.chunk.length > 1_048_576 || p.bytes + m.chunk.length > LIMITS.pngBytes * 1.4 ||
        !Number.isInteger(m.index) || m.index < 0 || m.index >= LIMITS.parts) throw new Error('预览超出安全预算。');
      p.bytes += m.chunk.length;
      p.chunks.push({ index: m.index, chunk: m.chunk, width: m.width, height: m.height });
    } else {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') + '#' + m.token });
      p.previewTab = tab.id;
    }
    return { ok: true };
  }
  if (m.type === 'begin') {
    if (session) throw new Error('已有截图任务正在进行，请等待或取消。');
    const current: Session = { tabId, job: m.job, timer: setTimeout(() => {}, 0), detached: true };
    clearTimeout(current.timer);
    session = current;
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      current.detached = false;
      current.timer = setTimeout(() => { void end(current).catch(e => console.warn('[Longshot] detach', errorText(e))); }, LIMITS.timeout + 5000);
      return { ok: true };
    } catch (e) { if (session === current) session = undefined;
      throw new Error('无法启动原生截图，请关闭本标签页的开发者工具，并检查调试权限。' + errorText(e)); }
  }
  const current = session;
  if (!current || current.tabId !== tabId || current.job !== m.job) {
    if (m.type === 'end') return { ok: true };
    throw new Error('调试会话已断开，请重新截图。');
  }
  if (m.type === 'end') { await end(current); return { ok: true }; }
  const tab = await chrome.tabs.get(tabId);
  // Without tabs/host_permissions Chrome omits tab.url. The authenticated
  // sender URL is checked above for every request; active is permission-free.
  if (!tab.active) throw new Error('目标标签页已切换，截图已停止。');
  const response = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: false,
  }) as { data?: string } | undefined;
  if (__TEST__) {
    const hooks = globalThis as typeof globalThis & { __longshotFrameGate?: boolean; __longshotFrameReady?: boolean };
    if (hooks.__longshotFrameGate) {
      hooks.__longshotFrameReady = true;
      while (hooks.__longshotFrameGate) await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  if (!response?.data) throw new Error('浏览器没有返回截图。');
  return { ok: true, data: response.data };
}
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('channel' in message) || message.channel !== CHANNEL) return false;
  void handle(message as Request, sender).then(sendResponse, e => sendResponse({ ok: false, error: errorText(e) }));
  return true;
});
