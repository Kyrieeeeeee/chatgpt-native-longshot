export type ThinkingDirection = 1 | -1;

interface ThinkingQueueOptions {
  run: (direction: ThinkingDirection, signal: AbortSignal) => Promise<void>;
  onStart?: () => void;
  onIdle?: () => void;
  onError?: (error: unknown) => void;
  /** Maximum outstanding steps, including the active step. */
  limit?: number;
}

/** Keep discrete presses in order. Never overlap interactions with a menu. */
export function createThinkingQueue(options: ThinkingQueueOptions) {
  const limit = options.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid thinking queue limit');
  const pending: ThinkingDirection[] = [];
  let controller: AbortController | undefined;
  let busy = false;

  async function drain(): Promise<void> {
    busy = true;
    const session = new AbortController();
    controller = session;
    try {
      options.onStart?.();
      while (pending.length && !session.signal.aborted) {
        const direction = pending.shift()!;
        await options.run(direction, session.signal);
      }
    } catch (error) {
      pending.length = 0;
      if (!session.signal.aborted) {
        session.abort();
        options.onError?.(error);
      }
    } finally {
      pending.length = 0;
      try { options.onIdle?.(); }
      finally { controller = undefined; busy = false; }
    }
  }

  return {
    enqueue(direction: ThinkingDirection): boolean {
      if (controller?.signal.aborted) {
        options.onError?.(new Error('上一次切换正在取消，请稍后再试。'));
        return false;
      }
      if (pending.length + Number(busy) >= limit) {
        options.onError?.(new Error('切换操作过多，请稍后再试。'));
        return false;
      }
      pending.push(direction);
      if (!busy) void drain();
      return true;
    },
    cancel(): void {
      pending.length = 0;
      controller?.abort();
    },
    isBusy: (): boolean => busy,
    pendingCount: (): number => pending.length,
  };
}
