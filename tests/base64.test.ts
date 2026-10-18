import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBase64} from '../src/base64';
test('base64 decoding preserves every byte and rejects malformed input',()=>{
 const bytes=Uint8Array.from({length:65536},(_,i)=>i%256);
 assert.deepEqual(decodeBase64(Buffer.from(bytes).toString('base64')),bytes);
 assert.equal(decodeBase64('').length,0);assert.throws(()=>decodeBase64('%%%'));
});
