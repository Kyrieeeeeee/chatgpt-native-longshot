import { type Answer, isGenerating, warnings } from './adapter';
import { CHANNEL, assertAlive, errorText, type ExportMode, type Result } from './shared';
import { rpc } from './transport';
import { PageState, waitForDebuggerViewport } from './page-state';
import { Stitcher, bitmap } from './stitcher';
import { visibleRows } from './geometry';
export async function capture(answer: Answer, signal: AbortSignal, status: (s: string) => void,
  mode: ExportMode = { kind: 'native' }): Promise<Result> {
  if (mode.kind !== 'native') throw new Error('自定义模式尚未开放。');
  if (isGenerating(answer)) throw new Error('回答正在生成，请结束后再复制长图。');
  if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) throw new Error('请关闭页面对话框后再截图。');
  const state = new PageState(answer.body, signal);
  const initial = answer.body.getBoundingClientRect();
  const widthBefore = innerWidth;
  const job = crypto.randomUUID();
  let attached = false;
  let stitcher: Stitcher | undefined;
  let cleanupError: unknown;
  try {
    status('正在截图（Esc 取消）');
    await rpc({ channel: CHANNEL, type: 'begin', job }); attached = true;
    // Debugger infobar may reduce height. Never change device metrics to compensate.
    await state.freezeViewport();
    const after = answer.body.getBoundingClientRect();
    if (innerWidth !== widthBefore || Math.abs(initial.width - after.width) > 0.1 || Math.abs(initial.height - after.height) > 0.5)
      throw new Error('Chrome 调试提示条改变了回答布局，已停止。请增大窗口后重试。');
    state.hideInterference();
    await state.mediaReady();
    await state.moveTo(0);
    await state.mediaReady();
    state.hideInterference();
    const reference = answer.body.getBoundingClientRect();
    const revision = state.revision;
    let cursor = 0; let scale = 0; let total = 0; let cropLeft = 0; let cropRight = 0;
    let frames = 0;
    while (!total || cursor < total) {
      state.check();
      if (isGenerating(answer)) throw new Error('回答重新开始生成，截图已停止。');
      if (cursor) await state.moveTo(cursor / scale, scale);
      await state.settle();
      state.hideInterference();
      const before = answer.body.getBoundingClientRect();
      if (state.revision !== revision || Math.abs(before.width - reference.width) > 0.1 || Math.abs(before.height - reference.height) > 0.1)
        throw new Error('回答内容在截图过程中改变，请待其稳定后重试。');
      const safe = state.safeRect();
      if (safe.bottom - safe.top < 64 || before.left < safe.left - 0.5 || before.right > safe.right + 0.5)
        throw new Error('正文被窗口或祖先容器裁切，请展开页面后重试。');
      const response = await rpc({ channel: CHANNEL, type: 'frame', job });
      if (!response.data) throw new Error('浏览器截图为空。');
      state.check();
      const now = answer.body.getBoundingClientRect();
      if (state.revision !== revision || now.x !== before.x || now.y !== before.y || now.height !== before.height)
        throw new Error('捕获时页面发生移动，已停止以避免错位。');
      const image = await bitmap(response.data);
      try {
        const sx = image.width / innerWidth;
        const sy = image.height / innerHeight;
        if (Math.abs(sx - sy) > 0.01) throw new Error(`浏览器截图像素比例不一致（位图 ${image.width}×${image.height}，视口 ${innerWidth}×${innerHeight}）。`);
        if (!stitcher) {
          scale = sx;
          cropLeft = Math.round(Math.max(safe.left, before.left - 8) * scale);
          cropRight = Math.round(Math.min(safe.right, before.right + 8) * scale);
          total = Math.round(before.bottom * scale) - Math.round(before.top * scale);
          stitcher = new Stitcher(cropRight - cropLeft, total);
        } else if (Math.abs(scale - sx) > 0.001 || Math.round(Math.max(safe.left, before.left - 8) * scale) !== cropLeft ||
          Math.round(Math.min(safe.right, before.right + 8) * scale) !== cropRight)
          throw new Error('正文横向位置或像素密度改变。');
        const rows = visibleRows(before, safe, scale, cursor, total);
        status(`正在拼接 ${Math.round((cursor + rows.rows) / total * 100)}%（Esc 取消）`);
        await stitcher.append(image, cropLeft, rows.sourceY, rows.rows);
        cursor += rows.rows; frames++;
        if (frames > 500) throw new Error('截图分片过多，已停止。');
      } finally { image.close(); }
      assertAlive(signal);
    }
    return { parts: stitcher!.finish(), warnings: warnings(answer.body) };
  } finally {
    stitcher?.dispose();
    // Restore even if detach fails. Do not misreport cleanup failures as success.
    try {
      if (attached) {
        try { await rpc({ channel: CHANNEL, type: 'end', job }); } catch (e) { cleanupError = e; }
        await waitForDebuggerViewport();
      }
    } finally { state.restore(); }
    if (cleanupError) throw new Error('截图已停止，但调试会话清理失败：' + errorText(cleanupError));
  }
}
