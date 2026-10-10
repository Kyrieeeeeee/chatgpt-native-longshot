import { CHANNEL, type Request, type Reply, type Result } from './shared';
export async function rpc(message: Request): Promise<Reply> {
  const reply: Reply | undefined = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error ?? '扩展后台未响应，请刷新页面重试。');
  return reply;
}
export async function openPreview(result: Result): Promise<void> {
  const { token } = await rpc({ channel: CHANNEL, type: 'preview-start', warnings: result.warnings });
  if (!token) throw new Error('无法创建预览。');
  // Chrome runtime messages use JSON. Keep each transfer under 1 MiB.
  for (const [index, part] of result.parts.entries()) {
    for (let i = 0; i < part.data.length; i += 1_048_576) {
      await rpc({ channel: CHANNEL, type: 'preview-chunk', token, index,
        chunk: part.data.slice(i, i + 1_048_576), width: part.width, height: part.height });
    }
  }
  await rpc({ channel: CHANNEL, type: 'preview-open', token });
}
