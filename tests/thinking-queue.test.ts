import test from 'node:test';
import assert from 'node:assert/strict';
import { createThinkingQueue } from '../src/thinking-queue';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('discrete directions remain FIFO with one start/idle session', async () => {
  const first = deferred();
  const events: unknown[] = [];
  const queue = createThinkingQueue({
    onStart: () => { events.push('start'); }, onIdle: () => { events.push('idle'); },
    run: async direction => { events.push(direction); if (events.length === 2) await first.promise; },
  });
  queue.enqueue(1); queue.enqueue(-1); queue.enqueue(1);
  assert.deepEqual(events, ['start', 1]);
  assert.equal(queue.pendingCount(), 2);
  assert.equal(queue.isBusy(), true);
  first.resolve(); await settle();
  assert.deepEqual(events, ['start', 1, -1, 1, 'idle']);
  assert.equal(queue.isBusy(), false);
});

test('cancel aborts active work, drops pending, waits before cleanup and starts fresh', async () => {
  const gate = deferred();
  const signals: AbortSignal[] = [];
  const errors: unknown[] = [];
  let idle = 0;
  const queue = createThinkingQueue({
    run: async (_direction, signal) => { signals.push(signal); await gate.promise; },
    onIdle: () => { idle++; }, onError: error => { errors.push(error); },
  });
  queue.enqueue(1); queue.enqueue(-1); queue.cancel();
  assert.equal(signals[0]!.aborted, true);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(idle, 0);
  assert.equal(queue.enqueue(1), false);
  assert.equal(errors.length, 1);
  gate.resolve(); await settle();
  assert.equal(idle, 1);
  assert.equal(queue.enqueue(-1), true); await settle();
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[1]!.aborted, false);
});

test('failed step drops pending work and reports once, then allows retry', async () => {
  const gate = deferred();
  let calls = 0;
  const errors: unknown[] = [];
  const queue = createThinkingQueue({ run: async () => { calls++; await gate.promise; }, onError: error => { errors.push(error); } });
  queue.enqueue(1); queue.enqueue(-1);
  const failure = new Error('stale model'); gate.reject(failure); await settle();
  assert.equal(calls, 1); assert.deepEqual(errors, [failure]);
  assert.equal(queue.pendingCount(), 0); assert.equal(queue.isBusy(), false);
});

test('bounded queue reports overflow without dropping accepted directions', async () => {
  const gate = deferred();
  const calls: number[] = [];
  const errors: unknown[] = [];
  const queue = createThinkingQueue({ limit: 2,
    run: async direction => { calls.push(direction); await gate.promise; }, onError: error => { errors.push(error); },
  });
  assert.equal(queue.enqueue(-1), true); assert.equal(queue.enqueue(1), true);
  assert.equal(queue.enqueue(-1), false); assert.equal(errors.length, 1);
  gate.resolve(); await settle(); assert.deepEqual(calls, [-1, 1]);
});

test('cancellation rejection is quiet and still closes the session', async () => {
  const gate = deferred(); const errors: unknown[] = [];
  let idle = 0;
  const queue = createThinkingQueue({ run: async () => gate.promise,
    onError: error => { errors.push(error); }, onIdle: () => { idle++; },
  });
  queue.enqueue(1); queue.cancel(); gate.reject(new Error('AbortError')); await settle();
  assert.deepEqual(errors, []); assert.equal(idle, 1); assert.equal(queue.isBusy(), false);
});
