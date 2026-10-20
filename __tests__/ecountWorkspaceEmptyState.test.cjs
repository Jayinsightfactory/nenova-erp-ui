const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');
const root=path.join(__dirname,'..'),cache=new Map();
const styles=new Proxy({},{get:(_,key)=>key});
function compile(source,filename){return babel.transformSync(source,{filename,babelrc:false,configFile:false,presets:[[require('next/babel'),{'preset-env':{modules:'commonjs'}}]]}).code;}
function load(relative){
  const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const localRequire=id=>id.endsWith('.css')?styles:id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id.endsWith('.js')?id:id+'.js'))):require(id);
  vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:localRequire,process,console});return module.exports;
}
const source=fs.readFileSync(path.join(root,'pages/ecount/workbench.js'),'utf8');
const ast=babel.parseSync(source,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});
const node=ast.program.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='Table');assert.ok(node);
const moduleBox={exports:{}};
vm.runInNewContext(compile("import React from 'react';\n"+source.slice(node.start,node.end)+';module.exports=Table;','Table.js'),{
  module:moduleBox,exports:moduleBox.exports,require,styles,
  ...load('components/ecount/PurchaseOrderPageControls.js'),...load('components/ecount/SettlementPageControls.js'),...load('components/ecount/QuoteStatusPageControls.js')
});
const render=props=>renderToStaticMarkup(React.createElement(moduleBox.exports,props));
test('uncollected PO retains ten source columns without implying a zero-row query',()=>{
  const html=render({dataset:'poQuery',rows:[],dataState:'uncollected'});
  assert.equal((html.match(/<th scope=/g)||[]).length,10);assert.ok(html.includes('작업 자료가 아직 수집되지 않았습니다.'));assert.ok(!html.includes('등록된 데이터가 없습니다.'));
});
test('loaded version filtered to zero is distinct from unavailable or loading data',()=>{
  assert.ok(render({dataset:'receipt',rows:[],dataState:'loaded'}).includes('등록된 데이터가 없습니다.'));
  for(const [dataState,text] of [['loading','작업 자료를 불러오는 중입니다.'],['unavailable','작업 자료를 불러오지 못했습니다.']]){
    const html=render({dataset:'receipt',rows:[],dataState});assert.ok(html.includes(text));assert.ok(!html.includes('등록된 데이터가 없습니다.'));assert.equal((html.match(/<th scope=/g)||[]).length,4);
  }
});
test('quote status local modes retain eight/seven observed columns while both remain uncollected',()=>{
  for(const [quoteReportMode,count,label]of[['aggregate',8,'단가(vat포함)'],['detail',7,'단가(var별도)']]){
    const html=render({dataset:'quoteStat',rows:[],dataState:'uncollected',quoteReportMode});assert.equal((html.match(/<th scope=/g)||[]).length,count);assert.ok(html.includes(label));assert.ok(html.includes('작업 자료가 아직 수집되지 않았습니다.'));
  }
});
