export const CHANNEL = 'native-longshot-v1';
export const LIMITS = {
  canvasSide: 16384,
  partHeight: 65535,
  canvasPixels: 128_000_000,
  totalPixels: 192_000_000,
  pngBytes: 64 * 1024 * 1024,
  parts: 16,
  timeout: 120_000,
} as const;
export type ExportMode = { kind: 'native' } | { kind: 'custom'; width: number; padding: number };
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface OutputPart { data: string; width: number; height: number }
export interface Result { parts: OutputPart[]; warnings: string[] }
export interface Reply { ok: boolean; error?: string; token?: string; data?: string; result?: Result }
export type Request =
  | { channel: typeof CHANNEL; type: 'begin' | 'frame' | 'end'; job: string }
  | { channel: typeof CHANNEL; type: 'preview-start'; warnings: string[] }
  | { channel: typeof CHANNEL; type: 'preview-chunk'; token: string; index: number; chunk: string; width: number; height: number }
  | { channel: typeof CHANNEL; type: 'preview-open'; token: string }
  | { channel: typeof CHANNEL; type: 'preview-release'; token: string }
  | { channel: typeof CHANNEL; type: 'take'; token: string; index?: number };
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function assertAlive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError');
}
export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal) assertAlive(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
