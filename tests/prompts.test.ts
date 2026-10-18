import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompts, filterPrompts, rankPrompts, promptIndex, mergePrompts } from '../src/prompt-data';
test('prompt import validates entire file and accepts named/tagged legacy records',()=> {
 const p=parsePrompts({prompts:[{title:'数学',text:'解释公式',tags:'学习, 数学'}, {content:'legacy',tags:['tag']}]});
 assert.equal(parsePrompts([{name:'收藏',content:'保留收藏状态',favorite:true}])[0]!.favorite,true);
 assert.equal(p[0]!.name,'数学');assert.deepEqual(p[0]!.tags,['学习','数学']);assert.equal(p[1]!.name,'legacy');
 assert.throws(()=>parsePrompts([{name:'ok',content:'ok'}, {name:'broken',content:''}]));
 assert.throws(()=>parsePrompts({other:[]}));
 assert.equal(filterPrompts(p,'数').length,1);assert.equal(filterPrompts(p,'TAG').length,1);
 assert.notEqual(parsePrompts([{content:'x'}])[0]!.id,parsePrompts([{content:'x'}])[0]!.id);
});

test('indexed search preserves field boundaries, locale matching and stable ranking',()=>{
 const prompts=parsePrompts([{name:'ABC',content:'DEF',tags:['中文','Tag']},{name:'abc',content:'ghi',favorite:true},{name:'same',content:'same'}]);
 const index=promptIndex(prompts);
 for(const q of ['', ' abc ','中文','tag','cdef','same','不存在'])assert.deepEqual(index.search(q),rankPrompts(filterPrompts(prompts,q)));
 assert.deepEqual(index.tags,['中文','Tag']);assert.equal(prompts[0]!.name,'ABC');
 const changed=prompts.map(p=>p.name==='same'?{...p,content:'修改后的正文'}:p);
 assert.equal(promptIndex(changed).search('修改后').length,1);
});

test('linear import merge retains append order, duplicate semantics and original data',()=>{
 const original=parsePrompts([{name:'A',content:'body',tags:['a,b'],favorite:true}]);
 const imported=parsePrompts([{name:'A',content:'body',tags:['a','b']},{name:'B',content:'new'},{name:'B',content:'new'},{name:'C',content:'last'}]);
 const merged=mergePrompts(original,imported);
 assert.deepEqual(merged.map(p=>p.name),['A','B','C']);assert.equal(merged[0],original[0]);assert.equal(original.length,1);assert.equal(imported.length,4);
});

test('imports Voyager export without changing body, newlines or tag order',()=>{
 const text='第一行\n\n完整公式 \\frac{1}{2}\n';
 const [prompt]=parsePrompts({format:'gemini-voyager.prompts.v1',items:[{name:'讲题',text,tags:['408','数学']}]});
 assert.equal(prompt!.content,text);assert.deepEqual(prompt!.tags,['408','数学']);
 assert.throws(()=>parsePrompts({format:'unknown',items:[]}));
});

test('favorites then frequent then recent prompts rank first without mutating storage order',()=>{
 const prompts=parsePrompts([
  {name:'未使用',content:'a'}, {name:'最近',content:'b',useCount:2,lastUsedAt:200},
  {name:'更常用',content:'c',useCount:3,lastUsedAt:100}, {name:'置顶',content:'d',favorite:true},
  {name:'较早',content:'e',useCount:2,lastUsedAt:100}
 ]);
 assert.deepEqual(rankPrompts(prompts).map(p=>p.name),['置顶','更常用','最近','较早','未使用']);
 assert.equal(prompts[0]!.name,'未使用');
 assert.equal(parsePrompts([{content:'x',useCount:-1,lastUsedAt:NaN}])[0]!.useCount,undefined);
});
