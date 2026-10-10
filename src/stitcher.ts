import { planOutput } from './geometry';
import { LIMITS, type OutputPart } from './shared';
export async function bitmap(data: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}
export async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('PNG 编码失败。'));
    reader.readAsDataURL(blob);
  });
}
export class Stitcher {
  readonly parts: OutputPart[] = [];
  readonly partHeight: number;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private written = 0;
  private partStart = 0;
  private bytes = 0;
  constructor(readonly width: number, readonly height: number) {
    this.partHeight = planOutput(width, height).partHeight;
  }
  private allocate(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = Math.min(this.partHeight, this.height - this.written);
    this.context = this.canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('无法分配截图画布。');
    this.context.imageSmoothingEnabled = false;
    this.partStart = this.written;
  }
  async append(image: ImageBitmap, x: number, y: number, rows: number): Promise<void> {
    if (x < 0 || y < 0 || x + this.width > image.width || y + rows > image.height)
      throw new Error('截图分片边界无效，已停止。');
    while (rows > 0) {
      if (!this.canvas) this.allocate();
      const canvas = this.canvas!;
      const dest = this.written - this.partStart;
      const take = Math.min(rows, canvas.height - dest);
      this.context!.drawImage(image, x, y, this.width, take, 0, dest, this.width, take);
      this.written += take; rows -= take; y += take;
      if (this.written - this.partStart === canvas.height) await this.flush();
    }
  }
  private async flush(): Promise<void> {
    const canvas = this.canvas!;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('PNG 编码失败，可能已超过浏览器内存限制。')), 'image/png'));
    this.bytes += blob.size;
    if (this.bytes > LIMITS.pngBytes) throw new Error('PNG 总大小超过 64 MiB 安全预算，请缩短回答。');
    this.parts.push({ data: await dataUrl(blob), width: canvas.width, height: canvas.height });
    canvas.width = 0; canvas.height = 0;
    this.canvas = null; this.context = null;
  }
  finish(): OutputPart[] {
    if (this.written !== this.height) throw new Error('正文尚未完整捕获。');
    return this.parts;
  }
  dispose(): void {
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; }
    this.canvas = null; this.context = null;
  }
}
