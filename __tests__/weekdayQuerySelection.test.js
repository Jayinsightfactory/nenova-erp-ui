import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parseWeekdayQuerySelection as parse,stepWeekdayQuerySelection as step,loadWeekdayEntryDefault as loadDefault} from '../lib/weekdayQuerySelection.js';
test('explicit query preserves year/week and rejects omitted/zero/false/stale invalid inputs',()=>{
  assert.deepEqual(parse('2026','43'),{year:'2026',majorWeek:'43'});
  assert.deepEqual(parse('2025','43'),{year:'2025',majorWeek:'43'});
  assert.deepEqual(parse('2026','53'),{year:'2026',majorWeek:'53'});
  assert.deepEqual(parse('2027','1'),{year:'2027',majorWeek:'01'});
  for(const v of ['',undefined,null,false,0,'0','54','1.2','1e1'])assert.throws(()=>parse('2026',v));
  for(const y of ['',undefined,false,0,'1999','2201','2026.0'])assert.throws(()=>parse(y,'43'));
});
test('initial entry renders only local selection without mounting workspace or executing fetch',()=>{
  const require=createRequire(import.meta.url),Module=require('node:module');
  const {transformSync}=require('next/dist/build/swc');
  const filename=path.resolve('components/WeekdayEstimateEntry.js'),loaded=new Module(filename);
  loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  loaded.require=id=>id.includes('weekdayQuerySelection')?{parseWeekdayQuerySelection:parse,stepWeekdayQuerySelection:step,loadWeekdayEntryDefault:loadDefault}:require(id);
  loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}}).code,filename);
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const before=globalThis.fetch;let mounts=0,calls=0;
  globalThis.fetch=()=>{calls++;throw Error('entry must not request data');};
  try{
    const html=renderToStaticMarkup(React.createElement(loaded.exports.default,{renderWorkspace:()=>{mounts++;return null;}}));
    assert.match(html,/조회 차수/);assert.match(html,/>조회<\/button>/);assert.doesNotMatch(html,/통합 요일표/);
    assert.equal(mounts,0);assert.equal(calls,0);
  }finally{globalThis.fetch=before;}
});


test('week stepping keeps the selected value and clamps only at bounds',()=>{
  assert.equal(step('44',-1),'43');assert.equal(step('43',1),'44');
  assert.equal(step('01',-1),'1');assert.equal(step('53',1),'53');
  assert.equal(step('',-1),'');assert.equal(step('',1),'');
  let week='44';for(let i=0;i<10;i++)week=step(week,-1);assert.equal(week,'34');
  assert.equal(step('1e',-1),'1e');
});

test('default requests only the calendar, uses Seoul date and preserves cross-year result',async()=>{
 const calls=[];const scope=await loadDefault({now:new Date('2026-12-31T15:30:00Z'),fetchFn:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({success:true,readOnly:true,scope:{year:2027,majorWeek:'01'}})};}});
 assert.deepEqual(scope,{year:'2027',majorWeek:'01'});assert.equal(calls.length,1);
 assert.equal(calls[0][0],'/api/estimate/weekday-calendar?defaultNext=1&date=2027-01-01');
 assert.equal(calls[0][1].cache,'no-store');
 for(const result of [{success:false},{success:true,readOnly:false},{success:true,readOnly:true,scope:{year:2026,majorWeek:0}}])
  await assert.rejects(loadDefault({fetchFn:async()=>({ok:true,json:async()=>result})}));
});

function entryHarness(){
 const require=createRequire(import.meta.url),Module=require('node:module'),{transformSync}=require('next/dist/build/swc');
 let cursor=0,slots=[],effect,cleanup,resolve,reject,mounts=0,signal;
 const deferred=new Promise((a,b)=>{resolve=a;reject=b;});
 const hooks={useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useEffect(fn){if(!effect)effect=fn;}};
 const filename=path.resolve('components/WeekdayEstimateEntry.js'),loaded=new Module(filename);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
 loaded.require=id=>id==='react'?hooks:id.includes('weekdayQuerySelection')?{parseWeekdayQuerySelection:parse,stepWeekdayQuerySelection:step,loadWeekdayEntryDefault:args=>{signal=args.signal;return deferred;}}:require(id);
 loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}}).code,filename);
 const render=()=>{cursor=0;const tree=loaded.exports.default({renderWorkspace:scope=>{mounts++;return {scope};}});return tree;};
 const find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;};
 const field=label=>find(render(),n=>n.props?.['aria-label']===label);
 render();cleanup=effect();
 return {render,field,resolve,reject,cleanup,get signal(){return signal;},get mounts(){return mounts;},submit(){find(render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});}};
}
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('untouched entry loads actual44, direct down43, repeated steps and explicit submit only',async()=>{
 const h=entryHarness();assert.equal(h.field('차수 1 감소').props.disabled,true);assert.equal(h.mounts,0);
 h.resolve({year:'2026',majorWeek:'44'});await settle();
 assert.equal(h.field('조회 차수').props.value,'44');assert.equal(h.mounts,0);
 h.field('차수 1 감소').props.onClick();assert.equal(h.field('조회 차수').props.value,'43');
 h.field('차수 1 감소').props.onClick();h.field('차수 1 증가').props.onClick();assert.equal(h.field('조회 차수').props.value,'43');
 h.submit();assert.deepEqual(h.render().scope,{year:'2026',majorWeek:'43'});
});
test('late defaults do not overwrite manual input or cleared input; failure never starts at1',async()=>{
 const h=entryHarness(),initialYear=h.field('조회 연도').props.value;h.field('조회 차수').props.onChange({target:{value:'42'}});h.resolve({year:'2027',majorWeek:'01'});await settle();assert.equal(h.field('조회 차수').props.value,'42');assert.equal(h.field('조회 연도').props.value,initialYear);
 h.field('조회 차수').props.onChange({target:{value:''}});assert.equal(h.field('차수 1 감소').props.disabled,true);
 const failed=entryHarness();failed.reject(Error('calendar failed'));await settle();assert.equal(failed.field('조회 차수').props.value,'');assert.equal(failed.field('차수 1 증가').props.disabled,true);
 const disposed=entryHarness();disposed.cleanup();assert.equal(disposed.signal.aborted,true);disposed.resolve({year:'2027',majorWeek:'01'});await settle();assert.equal(disposed.field('조회 차수').props.value,'');
});
