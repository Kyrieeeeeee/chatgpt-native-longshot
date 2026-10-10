import test from 'node:test';
import assert from 'node:assert/strict';
import { build, type Plugin } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function code(name: string, plugins: Plugin[] = []) {
  const baseline = process.env.AUDIT_BASELINE;
  const source = baseline
    ? { stdin: { contents: execFileSync('git', ['show', `${baseline === '1' ? 'HEAD' : baseline}:src/${name}.ts`], { encoding: 'utf8' }),
      resolveDir: path.resolve('src'), sourcefile: `${name}.ts`, loader: 'ts' as const } }
    : { entryPoints: [`src/${name}.ts`] };
  const result = await build({ ...source, plugins, bundle: true, write: false, format: 'iife', platform: 'browser', define: { __TEST__: 'false' } });
  return result.outputFiles[0]!.text;
}
type Reply = { ok: boolean; error?: string; data?: string };
async function background() {
  let listener!: (message: object, sender: object, reply: (value: Reply) => void) => void;
  let navigation!: (id: number, change: object) => void;
  let detached!: (source: object) => void;
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const state = { attached: false, attachGate: undefined as ReturnType<typeof deferred<void>> | undefined,
    detachGate: undefined as ReturnType<typeof deferred<void>> | undefined, detachError: false, attachError: false, detaches: 0 };
  const context = createContext({ console, crypto: webcrypto, URL,
    setTimeout: (fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    chrome: {
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, getURL: (p: string) => `chrome-extension://test/${p}` },
      tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener: (fn: typeof navigation) => { navigation = fn; } }, get: async () => ({ active: true }) },
      debugger: { onDetach: { addListener: (fn: typeof detached) => { detached = fn; } },
        attach: async () => { if (state.attachGate) await state.attachGate.promise; if (state.attachError) throw new Error('attach failed'); state.attached = true; },
        detach: async () => { state.detaches++; if (state.detachGate) await state.detachGate.promise;
          if (state.detachError) throw new Error('detach failed'); state.attached = false; detached({ tabId: 1 }); },
        sendCommand: async () => { assert.equal(state.attached, true); return { data: 'AA==' }; },
      },
    },
  });
  runInContext(await code('background'), context);
  const send = (type: string, job = 'one') => new Promise<Reply>(resolve => listener(
    { channel: 'native-longshot-v1', type, job }, { frameId: 0, url: 'https://chatgpt.com/c/test', tab: { id: 1 } }, resolve));
  return { state, timers, send, navigate: () => navigation(1, { status: 'loading' }) };
}

test('navigation during pending attach releases debugger and rejects an overlapping capture', async () => {
  const h = await background(); const gate = deferred(); h.state.attachGate = gate;
  const begin = h.send('begin'); await tick(); h.navigate();
  const overlapping = h.send('begin', 'two'); const end = h.send('end'); await tick(); gate.resolve();
  assert.equal((await overlapping).ok, false, 'keep reservation during attach cleanup');
  assert.equal((await begin).ok, false); assert.equal((await end).ok, true);
  assert.equal(h.state.attached, false); assert.equal(h.state.detaches, 1); assert.equal(h.timers.size, 0);
  h.state.attachGate = undefined;
  assert.equal((await h.send('begin', 'two')).ok, true); await h.send('end', 'two');
});

test('concurrent end requests wait for a single pending detach', async () => {
  const h = await background(); await h.send('begin'); h.state.detachGate = deferred();
  const first = h.send('end'); const second = h.send('end'); await tick();
  assert.equal((await h.send('begin', 'two')).ok, false);
  assert.equal(h.state.detaches, 1); h.state.detachGate.resolve();
  assert.equal((await first).ok, true); assert.equal((await second).ok, true); assert.equal(h.state.attached, false);
});

test('failed detach retains reservation and a retry releases it', async () => {
  const h = await background(); await h.send('begin'); h.state.detachError = true;
  assert.equal((await h.send('end')).ok, false); assert.equal(h.state.attached, true);
  assert.equal((await h.send('begin', 'two')).ok, false);
  h.state.detachError = false; assert.equal((await h.send('end')).ok, true);
  assert.equal(h.state.attached, false); assert.equal(h.timers.size, 0);
});

test('attach rejection racing navigation does not block the next capture', async () => {
  const h = await background(); const gate = deferred(); h.state.attachGate = gate;
  const begin = h.send('begin'); await tick(); h.navigate(); h.state.attachError = true; gate.resolve();
  assert.equal((await begin).ok, false); await tick(); assert.equal(h.timers.size, 0);
  h.state.attachError = false; h.state.attachGate = undefined;
  assert.equal((await h.send('begin', 'two')).ok, true); await h.send('end', 'two');
});

class Element {
  textContent = ''; className = ''; disabled = false; href = ''; download = ''; src = ''; alt = '';
  children: Element[] = []; listeners = new Map<string, () => void>();
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); }
  click() { this.listeners.get('click')?.(); }
}
async function preview(delayMeta = false) {
  const status = new Element(); const results = new Element(); const close = new Element();
  const pending = deferred<Reply>(); const writing = deferred(); const created: string[] = []; const revoked: string[] = [];
  const meta = { ok: true, data: JSON.stringify({ warnings: [], count: 1 }) };
  const chunk = { ok: true, data: JSON.stringify({ index: 0, chunk: 'data:image/png;base64,AA==', width: 1, height: 1 }) };
  const context = createContext({ console, Blob, Uint8Array, atob, location: { hash: '#test' },
    URL: { createObjectURL: () => { const u = `blob:${created.length}`; created.push(u); return u; }, revokeObjectURL: (u: string) => revoked.push(u) },
    window: { addEventListener() {} },
    document: { querySelector: (s: string) => ({ '#status': status, '#results': results, '#close': close })[s],
      createElement: () => new Element(), hasFocus: () => true },
    navigator: { clipboard: { write: () => writing.promise } }, ClipboardItem: class {},
    chrome: { runtime: { sendMessage: (m: { index?: number }) => m.index === undefined
      ? (delayMeta ? pending.promise : Promise.resolve(meta)) : pending.promise } },
  });
  runInContext(await code('preview'), context); await tick();
  return { status, results, close, pending, writing, created, revoked, complete: () => pending.resolve(delayMeta ? meta : chunk) };
}

test('clear while preview chunk is pending prevents image resurrection and new Blob URLs', async () => {
  const h = await preview(); h.close.click(); h.complete(); await tick();
  assert.equal(h.status.textContent, '图片已清除。'); assert.equal(h.results.children.length, 0); assert.deepEqual(h.created, []);
});

test('clear before metadata arrives prevents loading from continuing', async () => {
  const h = await preview(true); h.close.click(); h.complete(); await tick();
  assert.equal(h.status.textContent, '图片已清除。'); assert.equal(h.results.children.length, 0); assert.deepEqual(h.created, []);
});

test('late preview load rejection does not replace cleared status', async () => {
  const h = await preview(); h.close.click(); h.pending.reject(new Error('late transport failure')); await tick();
  assert.equal(h.status.textContent, '图片已清除。'); assert.equal(h.results.children.length, 0);
});

test('clear during clipboard write revokes images and prevents stale status updates', async () => {
  const h = await preview(); h.complete(); await tick();
  const copy = h.results.children[0]!.children[0]!.children[1]!;
  copy.click(); h.close.click(); h.writing.resolve(); await tick();
  assert.equal(h.status.textContent, '图片已清除。'); assert.equal(h.results.children.length, 0); assert.deepEqual(h.revoked, h.created);
});

// Exercise the real content coordinator with only its capture/clipboard I/O
// deferred, so cancellation can be checked on both sides of the phase boundary.
async function content() {
  class UiElement extends Element {
    dataset: Record<string, string> = {}; isConnected = true; parentElement?: UiElement;
    shadow?: UiElement; selected = new Map<string, UiElement>();
    innerHTML = ''; title = '';
    attachShadow() { return this.shadow = new UiElement(); }
    querySelector(selector: string) {
      if (!this.selected.has(selector)) this.selected.set(selector, new UiElement());
      return this.selected.get(selector)!;
    }
    setAttribute() {} removeAttribute() {}
    after() {}
  }
  const roots: UiElement[] = []; const body = new UiElement(); const actions = new UiElement();
  type KeyListener = (event: { key: string; preventDefault(): void }) => void;
  const listeners = new Map<string, KeyListener>();
  const timers = new Map<number, { fn: () => void; ms: number }>(); let nextTimer = 0;
  const capturing = deferred<{ parts: { data: string; width: number; height: number }[]; warnings: string[] }>();
  const writing = deferred(); let signal!: AbortSignal; let writes = 0;
  const context = createContext({ console, Error, AbortController, DOMException, Element: UiElement,
    __answers: [{ body, actions }],
    __capture: (_answer: unknown, value: AbortSignal) => { signal = value; return capturing.promise; },
    __copy: () => { writes++; return writing.promise; },
    setTimeout: (fn: () => void, ms: number) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    MutationObserver: class { observe() {} },
    document: { body, documentElement: { append: (root: UiElement) => roots.push(root) },
      createElement: () => new UiElement(), addEventListener: (type: string, fn: KeyListener) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type) },
  });
  const stubs: Record<string, string> = {
    './adapter': 'export const answers = () => globalThis.__answers;',
    './capture': 'export const capture = (...args) => globalThis.__capture(...args);',
    './clipboard': 'export const copyPng = () => globalThis.__copy();',
    './transport': 'export const openPreview = async () => {};',
  };
  await code('content', [{ name: 'deferred-content-io', setup(b) {
    b.onResolve({ filter: /^\.\/(adapter|capture|clipboard|transport)$/ }, args => ({ path: args.path, namespace: 'test-io' }));
    b.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: stubs[args.path]!, loader: 'js' }));
  } }]).then(source => runInContext(source, context));
  (actions.children[0] as UiElement).shadow!.querySelector('button').click(); await tick();
  return { capturing, writing, timers, signal, writes: () => writes, status: roots[0]!.shadow!.querySelector('.notice'),
    escape: () => { let prevented = false; listeners.get('keydown')?.({ key: 'Escape', preventDefault: () => { prevented = true; } }); return prevented; } };
}

test('Escape still cancels capture before clipboard submission', async () => {
  const h = await content(); assert.equal(h.escape(), true); assert.equal(h.signal.aborted, true);
  h.capturing.resolve({ parts: [{ data: '', width: 1, height: 1 }], warnings: [] }); await tick();
  assert.equal(h.writes(), 0); assert.equal(h.status.textContent, '已取消');
});

test('clipboard submission removes screenshot timeout and Escape interception', async () => {
  const h = await content(); h.capturing.resolve({ parts: [{ data: '', width: 1, height: 1 }], warnings: [] }); await tick();
  assert.equal(h.writes(), 1); assert.equal(h.status.textContent, '正在复制到剪贴板…');
  assert.equal(h.escape(), false); assert.equal(h.signal.aborted, false);
  assert.equal([...h.timers.values()].some(timer => timer.ms === 120_000), false);
  h.writing.resolve(); await tick(); assert.equal(h.status.textContent, '长图已复制。');
});
