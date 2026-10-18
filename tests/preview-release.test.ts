import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import path from 'node:path';

type Reply = { ok: boolean; token?: string; data?: string; error?: string };
type Sender = { frameId?: number; url?: string; tab?: { id: number } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function bundle(name: string, extra = '') {
  const result = await build({ stdin: { contents: await readFile(`src/${name}.ts`, 'utf8') + extra,
    resolveDir: path.resolve('src'), sourcefile: `${name}.ts`, loader: 'ts' },
    bundle: true, write: false, format: 'iife', define: { __TEST__: 'false' } });
  return result.outputFiles[0]!.text;
}
async function background() {
  let listener!: (message: object, sender: Sender, reply: (value: Reply) => void) => void;
  const ignore = { addListener() {} };
  const context = createContext({ console, crypto: webcrypto, URL, setTimeout, clearTimeout,
    chrome: { commands: { onCommand: ignore }, debugger: { onDetach: ignore },
      runtime: { getURL: (p: string) => `chrome-extension://test/${p}`, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
      tabs: { onRemoved: ignore, onUpdated: ignore, create: async () => ({ id: 8 }) } } });
  runInContext(await bundle('background', '\nObject.assign(globalThis,{stats:()=>({count:previews.size,chars:[...previews.values()].reduce((sum,p)=>sum+p.chunks.reduce((n,c)=>n+c.chunk.length,0),0)})});'), context);
  const owner: Sender = { frameId: 0, url: 'https://chatgpt.com/c/test', tab: { id: 1 } };
  const send = (message: object, sender = owner) => new Promise<Reply>(resolve => listener({ channel: 'native-longshot-v1', ...message }, sender, resolve));
  const token = (await send({ type: 'preview-start', warnings: [] })).token!;
  for (let i = 0; i < 8; i++) assert.equal((await send({ type: 'preview-chunk', token, index: 0, chunk: 'A'.repeat(1_048_576), width: 8, height: 8 })).ok, true);
  assert.equal((await send({ type: 'preview-open', token })).ok, true);
  const preview: Sender = { frameId: 0, url: `chrome-extension://test/preview.html#${token}`, tab: { id: 8 } };
  return { send, token, preview, owner, stats: () => context.stats() as { count: number; chars: number } };
}

test('preview clear releases all pending base64 and late take cannot resurrect it', async () => {
  const h = await background();
  assert.equal(h.stats().chars, 8_388_608);
  assert.equal((await h.send({ type: 'take', token: h.token }, h.preview)).ok, true);
  assert.equal((await h.send({ type: 'preview-release', token: h.token }, h.preview)).ok, true);
  assert.equal(h.stats().count, 0); assert.equal(h.stats().chars, 0);
  assert.equal((await h.send({ type: 'preview-release', token: h.token }, h.preview)).ok, true, 'duplicate release is harmless');
  assert.equal((await h.send({ type: 'take', token: h.token, index: 0 }, h.preview)).ok, false);
  assert.equal((await h.send({ type: 'preview-chunk', token: h.token, index: 0, chunk: 'AA==', width: 8, height: 8 })).ok, false);
});

test('release requires exact preview token URL, actual tab and top frame', async () => {
  const h = await background();
  const bad: Sender[] = [h.owner, { ...h.preview, frameId: 2 }, { ...h.preview, frameId: undefined },
    { ...h.preview, tab: { id: 9 } }, { ...h.preview, tab: undefined },
    { ...h.preview, url: h.preview.url + 'wrong' }, { ...h.preview, url: 'chrome-extension://test/popup.html' }];
  for (const sender of bad) {
    assert.equal((await h.send({ type: 'preview-release', token: h.token }, sender)).ok, false);
    assert.equal(h.stats().chars, 8_388_608, 'rejected sender retains buffer');
  }
  assert.equal((await h.send({ type: 'take', token: h.token, index: 0 }, h.preview)).ok, true);
  assert.equal((await h.send({ type: 'take', token: h.token, index: 0 }, h.preview)).ok, true, 'retrieval retry behavior retained');
  assert.equal((await h.send({ type: 'preview-release', token: h.token }, h.preview)).ok, true);
});

class Element {
  textContent = ''; children: Element[] = []; listeners = new Map<string, () => void>();
  replaceChildren() { this.children = []; }
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); }
  click() { this.listeners.get('click')?.(); }
}
for (const trigger of ['clear', 'clear-chunk', 'pagehide', 'load-error'] as const) test(`${trigger} releases pending preview without waiting for data`, async () => {
  const status = new Element(), results = new Element(), close = new Element();
  const messages: { type: string }[] = [];
  let finish!: (reply: Reply) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<Reply>((resolve, no) => { finish = resolve; reject = no; });
  let hide!: () => void;
  const context = createContext({ console, location: { hash: '#token' },
    document: { querySelector: (s: string) => s === '#status' ? status : s === '#results' ? results : close },
    window: { addEventListener: (_type: string, fn: () => void) => { hide = fn; } },
    URL: { revokeObjectURL() {} },
    chrome: { runtime: { sendMessage: (m: { type: string; index?: number }) => {
      messages.push(m);
      if (trigger === 'clear-chunk' && m.type === 'take' && m.index === undefined)
        return Promise.resolve({ ok: true, data: JSON.stringify({ warnings: [], count: 8 }) });
      return m.type === 'take' ? pending : Promise.resolve({ ok: true });
    } } } });
  runInContext(await bundle('preview'), context); await tick();
  if (trigger === 'clear' || trigger === 'clear-chunk') close.click();
  else if (trigger === 'pagehide') hide();
  else reject(new Error('transport failure'));
  await tick();
  const takes = trigger === 'clear-chunk' ? 2 : 1;
  assert.deepEqual(messages.map(m => m.type), [...Array(takes).fill('take'), 'preview-release']);
  finish({ ok: true, data: JSON.stringify({ warnings: [], count: 8 }) }); await tick();
  assert.equal(messages.filter(m => m.type === 'take').length, takes, 'late response starts no additional chunk transfer');
  close.click(); hide(); await tick();
  assert.equal(messages.filter(m => m.type === 'preview-release').length, 1);
});
