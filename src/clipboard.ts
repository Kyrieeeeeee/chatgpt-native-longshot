import type { OutputPart } from './shared';
export function pngBlob(part: OutputPart): Blob {
  const encoded = part.data.split(',')[1];
  if (!encoded || !part.data.startsWith('data:image/png;base64,')) throw new Error('PNG 数据无效。');
  return new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' });
}
export async function copyPng(part: OutputPart): Promise<void> {
  if (__TEST__ && new URLSearchParams(location.search).get('denyClipboard') === '1')
    throw new DOMException('测试注入：剪贴板权限被拒绝。', 'NotAllowedError');
  if (!document.hasFocus()) throw new Error('页面失去焦点，请在预览中点击复制图片。');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持 PNG 剪贴板。');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(part) })]);
}
