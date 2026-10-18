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
type Reply = { ok: boolean; error?: string; data?: string; tabId?: number };
async function background() {
  let listener!: (message: object, sender: object, reply: (value: Reply) => void) => boolean | void;
  let navigation!: (id: number, change: object) => void;
  let detached!: (source: object) => void;
  let command!: (name: string, tab?: { id: number }) => void;
  const forwarded: { id: number; message: object; options: object }[] = [];
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const state = { attached: false, attachGate: undefined as ReturnType<typeof deferred<void>> | undefined,
    detachGate: undefined as ReturnType<typeof deferred<void>> | undefined, detachError: false, attachError: false, detaches: 0 };
  const context = createContext({ console, crypto: webcrypto, URL,
    setTimeout: (fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    chrome: {
      commands: { onCommand: { addListener: (fn: typeof command) => { command = fn; } } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, getURL: (p: string) => `chrome-extension://test/${p}` },
      tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener: (fn: typeof navigation) => { navigation = fn; } }, get: async () => ({ active: true }),
        query: async () => [{ id: 7 }], sendMessage: async (id: number, message: object, options: object) => { forwarded.push({ id, message, options }); } },
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
  const request = (message: object, sender: object) => new Promise<Reply | undefined>(resolve => { const handled=listener(message,sender,resolve); if(handled===false)resolve(undefined); });
  return { state, timers, send, request, command, forwarded, navigate: () => navigation(1, { status: 'loading' }) };
}

test('Gemini may identify its top-frame prompt draft tab but cannot request capture', async () => {
  const h=await background();
  const sender={frameId:0,url:'https://gemini.google.com/app/test',tab:{id:9,url:'https://gemini.google.com/app/test'}};
  assert.equal((await h.request({type:'native-longshot-tab-id'},sender))?.tabId,9);
  assert.equal(await h.request({type:'native-longshot-tab-id'},{...sender,frameId:2}),undefined);
  assert.equal(await h.request({type:'native-longshot-tab-id'},{...sender,url:'https://gemini.google.com.evil.example/app/test'}),undefined);
  assert.equal((await h.request({channel:'native-longshot-v1',type:'begin',job:'gemini'},sender))?.ok,false);
  assert.equal(h.state.attached,false);
});

test('thinking command targets the invocation tab or active tab, top frame only', async () => {
  const h = await background();
  h.command('unrelated', { id: 3 }); await tick(); assert.equal(h.forwarded.length, 0);
  h.command('cycle-thinking-effort', { id: 3 }); await tick();
  h.command('cycle-thinking-effort'); await tick();
  assert.deepEqual(h.forwarded.map(item => item.id), [3, 7]);
  for (const item of h.forwarded) {
    assert.equal(JSON.stringify(item.message), JSON.stringify({ type: 'native-longshot-cycle-thinking' }));
    assert.equal(JSON.stringify(item.options), JSON.stringify({ frameId: 0 }));
  }
});

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
  setAttribute() {} removeAttribute() {}
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
    get shadowRoot() { return this.shadow; }
    querySelector(selector: string) {
      if (!this.selected.has(selector)) this.selected.set(selector, new UiElement());
      return this.selected.get(selector)!;
    }
    setAttribute() {} removeAttribute() {}
    after() {}
  }
  const roots: UiElement[] = []; const body = new UiElement(); const actions = new UiElement();
  const otherActions = new UiElement();
  type KeyListener = (event: { key: string; preventDefault(): void }) => void;
  const listeners = new Map<string, KeyListener>();
  const timers = new Map<number, { fn: () => void; ms: number }>(); let nextTimer = 0;
  const capturing = deferred<{ parts: { data: string; width: number; height: number }[]; warnings: string[] }>();
  const writing = deferred(); const opening = deferred(); let signal!: AbortSignal; let writes = 0; let captures = 0;
  const context = createContext({ console, Error, AbortController, DOMException, Element: UiElement,
    chrome: { runtime: { onMessage: { addListener() {} } },storage:{local:{get:async()=>({})}} },
    __answers: [{ body, actions }, { body: new UiElement(), actions: otherActions }],
    __capture: (_answer: unknown, value: AbortSignal) => { captures++; signal = value; return capturing.promise; },
    __copy: () => { writes++; return writing.promise; },
    __open: () => opening.promise,
    setTimeout: (fn: () => void, ms: number) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    MutationObserver: class { observe() {} },
    document: { body, documentElement: { append: (root: UiElement) => roots.push(root),toggleAttribute(){} },
      querySelectorAll: () => [...actions.children, ...otherActions.children],
      createElement: () => new UiElement(), addEventListener: (type: string, fn: KeyListener) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type) },
  });
  const stubs: Record<string, string> = {
    './thinking-hotkey': 'export const installThinkingHotkey = () => {};',
    './thinking': 'export const installThinkingShortcut = () => ({isBusy:()=>false});',
    './prompts': 'export const installPrompts = () => ({setEnabled(){},open(){}});',
    './layout': 'export const installLayout = () => ({apply(){}});',
    './latex': 'export const installLatexCopy = () => ({setEnabled(){}});',
    './adapter': 'export const answers = () => globalThis.__answers;',
    './capture': 'export const capture = (...args) => globalThis.__capture(...args);',
    './clipboard': 'export const copyPng = () => globalThis.__copy();',
    './transport': 'export const openPreview = () => globalThis.__open();',
  };
  await code('content', [{ name: 'deferred-content-io', setup(b) {
    b.onResolve({ filter: /^\.\/(adapter|capture|clipboard|transport|thinking-hotkey|thinking|prompts|latex|layout)$/ }, args => ({ path: args.path, namespace: 'test-io' }));
    b.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: stubs[args.path]!, loader: 'js' }));
  } }]).then(source => runInContext(source, context));
  (actions.children[0] as UiElement).shadow!.querySelector('button').click(); await tick();
  return { capturing, writing, opening, timers, signal, captures: () => captures, writes: () => writes,
    buttons: [actions, otherActions].map(a => (a.children[0] as UiElement).shadow!.querySelector('button')),
    status: roots[0]!.shadow!.querySelector('.notice'),
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

test('another answer cannot replace feedback during clipboard submission', async () => {
  const h = await content(); h.capturing.resolve({ parts: [{ data: '', width: 1, height: 1 }], warnings: [] }); await tick();
  assert.ok(h.buttons.every(b => b.disabled));
  h.buttons[1]!.click(); // Invoke handler even if a stale/programmatic event arrives.
  assert.equal(h.captures(), 1); assert.equal(h.status.textContent, '正在复制到剪贴板…');
  assert.equal(h.status.dataset.busy, 'true');
  h.writing.resolve(); await tick(); assert.ok(h.buttons.every(b => !b.disabled));
});

for (const failure of [false, true]) test(`preview preparation stays exclusive and recovers on ${failure ? 'failure' : 'success'}`, async () => {
  const h = await content(); h.capturing.resolve({ parts: [{ data: '', width: 1, height: 1 }, { data: '', width: 1, height: 1 }], warnings: [] }); await tick();
  const open = h.status.children.find(el => el.textContent === '打开预览 / 保存 PNG')!;
  open.click(); assert.equal(open.textContent, '正在准备预览…'); assert.equal(h.status.dataset.busy, 'true');
  assert.ok(h.buttons.every(b => b.disabled)); h.buttons[1]!.click(); assert.equal(h.captures(), 1);
  if (failure) h.opening.reject(new Error('transport unavailable')); else h.opening.resolve();
  await tick(); assert.ok(h.buttons.every(b => !b.disabled)); assert.equal(h.status.dataset.busy, undefined);
  if (failure) assert.match(h.status.textContent, /预览打开失败.*transport unavailable/);
  else assert.equal(h.status.textContent, '');
});
