import test from 'node:test';
import assert from 'node:assert/strict';
import {readSettings,DEFAULT_SETTINGS} from '../src/settings';
test('settings keep native layout until selected and validate persisted width',()=>{
 assert.deepEqual(readSettings(null),DEFAULT_SETTINGS);
 assert.equal(readSettings({width:180}).width,100);assert.equal(readSettings({width:0}).width,50);
 assert.equal(readSettings({width:NaN}).width,85);assert.equal(readSettings({theme:'invalid'}).theme,'auto');
 assert.equal(readSettings({prompts:false,latex:false}).prompts,false);
});
