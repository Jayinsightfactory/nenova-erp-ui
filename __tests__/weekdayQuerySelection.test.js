import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parseWeekdayQuerySelection as parse,stepWeekdayQuerySelection as step} from '../lib/weekdayQuerySelection.js';
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
  loaded.require=id=>id.includes('weekdayQuerySelection')?{parseWeekdayQuerySelection:parse,stepWeekdayQuerySelection:step}:require(id);
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
  assert.equal(step('',-1),'1');assert.equal(step('',1),'1');
  let week='44';for(let i=0;i<10;i++)week=step(week,-1);assert.equal(week,'34');
  assert.equal(step('1e',-1),'1e');
});
