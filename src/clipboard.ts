import type { OutputPart } from './shared';
import { decodeBase64 } from './base64';
export function pngBlob(part: OutputPart): Blob {
  const encoded = part.data.split(',')[1];
  if (!encoded || !part.data.startsWith('data:image/png;base64,')) throw new Error('PNG 数据无效。');
  return new Blob([decodeBase64(encoded)], { type: 'image/png' });
}
async function writePng(makeBlob: () => Blob): Promise<void> {
  if (__TEST__ && new URLSearchParams(location.search).get('denyClipboard') === '1')
    throw new DOMException('测试注入：剪贴板权限被拒绝。', 'NotAllowedError');
  if (!document.hasFocus()) throw new Error('页面失去焦点，请在预览中点击复制图片。');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持 PNG 剪贴板。');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': makeBlob() })]);
}
export async function copyPngBlob(blob: Blob): Promise<void> { await writePng(() => blob); }
export async function copyPng(part: OutputPart): Promise<void> { await writePng(() => pngBlob(part)); }
