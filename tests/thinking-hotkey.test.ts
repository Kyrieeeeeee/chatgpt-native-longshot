import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createContext,runInContext} from 'node:vm';
async function harness(){
 let listener!:(event:Record<string,unknown>)=>void;const directions:number[]=[];
 class Host { constructor(private owned=false){}hasAttribute(){return this.owned;} }
 const source=await build({entryPoints:['src/thinking-hotkey.ts'],bundle:true,write:false,format:'iife',globalName:'Hotkey'});
 const context=createContext({HTMLElement:Host,window:{addEventListener(_type:string,fn:typeof listener){listener=fn;}},cycle:(direction:number)=>directions.push(direction)});
 runInContext(source.outputFiles[0]!.text+';Hotkey.installThinkingHotkey(cycle)',context);
 const press=(overrides:Record<string,unknown>={})=>{let prevented=false,stopped=false;listener({isTrusted:true,key:'End',code:'End',keyCode:35,composedPath:()=>[],getModifierState:()=>false,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;},...overrides});return {prevented,stopped};};
 return {press,directions,Host};
}
test('native End/Home and explicit Fn arrows keep directions; ordinary arrows remain editing keys',async()=>{
 const h=await harness();h.press();h.press({key:'Home',code:'Home',keyCode:36});h.press({key:'ArrowRight',code:'ArrowRight',keyCode:39,getModifierState:()=>true});h.press({key:'ArrowLeft',code:'ArrowLeft',keyCode:37,getModifierState:()=>true});
 assert.deepEqual(h.directions,[1,-1,1,-1]);assert.deepEqual(h.press({key:'ArrowRight',code:'ArrowRight',keyCode:39}),{prevented:false,stopped:false});
});
test('IME fallback, untrusted events, modifiers and own panels never consume shortcut',async()=>{
 const h=await harness();for(const override of [{isComposing:true},{keyCode:229},{isTrusted:false},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{composedPath:()=>[new h.Host(true)]}])assert.deepEqual(h.press(override),{prevented:false,stopped:false});assert.deepEqual(h.directions,[]);
});
test('held-key repeat is consumed but discrete presses are all delivered',async()=>{
 const h=await harness();h.press();assert.deepEqual(h.press({repeat:true}),{prevented:true,stopped:true});h.press();assert.deepEqual(h.directions,[1,1]);
});
