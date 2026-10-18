import test from 'node:test';
import assert from 'node:assert/strict';
import {indexAt,nearestIndex,textHash} from '../src/timeline-data';
import {readSettings} from '../src/settings';
test('long replies keep preceding question active until next question reaches reading anchor',()=>{
 const offsets=[100,10000,10200];
 assert.equal(indexAt(offsets,9000),0);assert.equal(indexAt(offsets,10000),1);assert.equal(indexAt(offsets,-1),0);assert.equal(indexAt(offsets,20000),2);
 assert.equal(nearestIndex(offsets,9900),1);assert.equal(nearestIndex(offsets,150),0);
 const many=Array.from({length:1000},(_,i)=>i*100);assert.equal(indexAt(many,90999),909);
});
test('timeline settings migrate old records and reject unsupported modes',()=>{
 assert.equal(readSettings({timeline:true}).timelineStyle,'compact');assert.equal(readSettings({timelineStyle:'invalid'}).timelineStyle,'compact');assert.equal(readSettings({timelineStyle:'compact',timelineSmooth:false}).timelineSmooth,false);
 assert.equal(textHash('问题\n完整内容'),textHash('问题\n完整内容'));assert.notEqual(textHash('问题一'),textHash('问题二'));
});
