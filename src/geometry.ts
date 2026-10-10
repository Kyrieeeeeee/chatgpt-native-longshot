import { LIMITS, type Rect } from './shared';
export function intersect(a: Rect, b: Rect): Rect {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}
export function dimensions(rect: Rect): { width: number; height: number } {
  return { width: rect.right - rect.left, height: rect.bottom - rect.top };
}
export function planOutput(width: number, height: number): { partHeight: number; count: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error('截图尺寸无效。');
  if (width > LIMITS.canvasSide || width * height > LIMITS.totalPixels)
    throw new Error('回答超过安全像素预算，请分次保存较短的回答。');
  const partHeight = Math.min(LIMITS.partHeight, Math.floor(LIMITS.canvasPixels / width));
  const count = Math.ceil(height / partHeight);
  if (count > LIMITS.parts) throw new Error('回答过长，超过最多 16 张分段 PNG 的预算。');
  return { partHeight, count };
}
// Shared rounded endpoints prevent independent rounding from introducing a missing row.
export function visibleRows(target: Rect, safe: Rect, scale: number, cursor: number, total: number) {
  const origin = Math.round(target.top * scale);
  const start = Math.max(0, Math.ceil(safe.top * scale) - origin);
  const end = Math.min(total, Math.floor(safe.bottom * scale) - origin);
  if (start > cursor) throw new Error('可见区域出现空缺，已停止以避免遗漏正文。');
  if (end <= cursor) throw new Error('滚动未能露出后续正文，请检查折叠或嵌套滚动区域。');
  return { sourceY: origin + cursor, rows: end - cursor };
}
