import { CHANNEL, type OutputPart } from './shared';
import { rpc } from './transport';
import { copyPng, pngBlob } from './clipboard';
import { errorText } from './shared';
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const urls: string[] = [];
const parts: OutputPart[] = [];
let generation = 0;
function clear(): void { generation++; for (const url of urls) URL.revokeObjectURL(url); urls.length = 0; parts.length = 0; results.replaceChildren(); }
document.querySelector('#close')!.addEventListener('click', () => { clear(); status.textContent = '图片已清除。'; });
window.addEventListener('pagehide', clear);
async function load(): Promise<void> {
  const loading = generation;
  const token = location.hash.slice(1);
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
  for (const [i, part] of parts.entries()) {
    const section = document.createElement('section');
    const actions = document.createElement('div'); actions.className = 'actions';
    const label = document.createElement('span'); label.textContent = `${parts.length > 1 ? `第 ${i + 1} 张 · ` : ''}${part.width} × ${part.height} 像素`;
    const copy = document.createElement('button'); copy.textContent = '复制图片';
    copy.addEventListener('click', () => {
      copy.disabled = true;
      status.textContent = '正在复制到剪贴板…';
      void copyPng(part).then(() => { if (loading === generation) status.textContent = '图片已复制。'; },
        e => { if (loading === generation) status.textContent = '复制失败：' + errorText(e); }).finally(() => { copy.disabled = false; });
    });
    const url = URL.createObjectURL(pngBlob(part)); urls.push(url);
    const save = document.createElement('a'); save.textContent = '保存 PNG'; save.href = url;
    save.download = `chatgpt-answer${parts.length > 1 ? `-${i + 1}` : ''}.png`;
    const image = document.createElement('img'); image.src = url; image.alt = `回答长图 ${i + 1}`;
    actions.append(label, copy, save); section.append(actions, image); results.append(section);
  }
  status.textContent = parts.length > 1 ? `共 ${parts.length} 张 PNG，请分别复制或保存。关闭此页即释放图片。` : '图片仅保存在此页内存中。关闭此页即释放。';
}
void load().catch(e => { if (generation === 0) { clear(); status.textContent = errorText(e); } });
