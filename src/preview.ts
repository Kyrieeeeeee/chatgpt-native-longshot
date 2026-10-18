import { CHANNEL, type OutputPart } from './shared';
import { rpc } from './transport';
import { copyPngBlob, pngBlob } from './clipboard';
import { errorText } from './shared';
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const urls: string[] = [];
const parts: OutputPart[] = [];
let generation = 0;
const token = location.hash.slice(1);
let released = false;
function clear(): void {
  generation++;
  if (!released) {
    released = true;
    // Best effort: clearing must remain immediate if the SW has gone away.
    // Existing expiry/tab-removal cleanup still covers a lost pagehide message.
    void rpc({ channel: CHANNEL, type: 'preview-release', token }).catch(() => {});
  }
  for (const url of urls) URL.revokeObjectURL(url);
  urls.length = 0; parts.length = 0; results.replaceChildren();
}
document.querySelector('#close')!.addEventListener('click', () => { clear(); status.textContent = '图片已清除。'; });
window.addEventListener('pagehide', clear);
async function load(): Promise<void> {
  const loading = generation;
  const meta = await rpc({ channel: CHANNEL, type: 'take', token });
  if (loading !== generation) return;
  const { warnings, count } = JSON.parse(meta.data!) as { warnings: string[]; count: number };
  if (warnings.length) { const p = document.createElement('p'); p.textContent = warnings.join(' '); results.append(p); }
  for (let i = 0; i < count; i++) {
    const response = await rpc({ channel: CHANNEL, type: 'take', token, index: i });
    if (loading !== generation) return;
    const { index, chunk, width, height } = JSON.parse(response.data!) as { index: number; chunk: string; width: number; height: number };
    const part = parts[index] ?? { data: '', width, height };
    part.data += chunk; parts[index] = part;
  }
  const copyButtons: HTMLButtonElement[] = [];
  let copying = false;
  for (const [i, part] of parts.entries()) {
    const blob=pngBlob(part);
    // The same Blob backs preview/save/copy; no retained base64 duplicate or
    // second decode on every clipboard retry.
    part.data='';
    const section = document.createElement('section');
    const actions = document.createElement('div'); actions.className = 'actions';
    const label = document.createElement('span'); label.textContent = `${parts.length > 1 ? `第 ${i + 1} 张 · ` : ''}${part.width} × ${part.height} 像素`;
    const copy = document.createElement('button'); copy.textContent = '复制图片';
    copy.setAttribute('aria-label', `复制第 ${i + 1} 张图片`);
    const feedback = document.createElement('span'); feedback.className = 'copy-status'; feedback.id = `copy-status-${i + 1}`;
    copy.setAttribute('aria-describedby', feedback.id);
    copyButtons.push(copy);
    const report = (message: string): void => {
      if (loading !== generation) return;
      feedback.textContent = message;
      status.textContent = message;
    };
    copy.addEventListener('click', () => {
      if (copying || loading !== generation) return;
      copying = true;
      for (const button of copyButtons) button.disabled = true;
      report(`正在复制第 ${i + 1} 张图片到剪贴板…`);
      void copyPngBlob(blob).then(() => report(`第 ${i + 1} 张图片已复制。`),
        e => report(`第 ${i + 1} 张图片复制失败：` + errorText(e))).finally(() => {
        copying = false;
        if (loading === generation) for (const button of copyButtons) button.disabled = false;
      });
    });
    const url = URL.createObjectURL(blob); urls.push(url);
    const save = document.createElement('a'); save.textContent = '保存 PNG'; save.href = url;
    save.setAttribute('aria-label', `保存第 ${i + 1} 张图片为 PNG`);
    save.download = `chatgpt-answer${parts.length > 1 ? `-${i + 1}` : ''}.png`;
    const image = document.createElement('img'); image.src = url; image.alt = `回答长图 ${i + 1}`;
    actions.append(label, copy, save, feedback); section.append(actions, image); results.append(section);
  }
  status.textContent = parts.length > 1 ? `共 ${parts.length} 张 PNG，请分别复制或保存。关闭此页即释放图片。` : '图片仅保存在此页内存中。关闭此页即释放。';
}
void load().catch(e => { if (generation === 0) { clear(); status.textContent = errorText(e); } });
