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
  ...load('components/ecount/StockStatusPageControls.js'),...load('components/ecount/SaleQueryPageControls.js'),...load('components/ecount/SalesTaxQueryPageControls.js'),...load('components/ecount/PurchaseOrderPageControls.js'),...load('components/ecount/SettlementPageControls.js'),...load('components/ecount/QuoteStatusPageControls.js')
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

test('sales tax keeps eight columns and exact safe decimals without private identities',()=>{
 const html=render({dataset:'salesTax',dataState:'loaded',rows:[{sourceDateLabel:'2026/09/30 -1',refDate:'2026-09-30',supplyAmt:'12345678901234567890.01',vat:'123.40',total:'12345678901234568013.41',custName:'must-not-render'}]});
 assert.equal((html.match(/<th scope=/g)||[]).length,8);assert(html.includes('12345678901234567890.01'));assert(html.includes('2026/09/30 -1'));assert(!html.includes('must-not-render'));
 const empty=render({dataset:'salesTax',dataState:'uncollected',rows:[]});assert(empty.includes('아직 수집되지 않았습니다'));assert(!empty.includes('조회된 자료가 없습니다'));
});

test('sales tax observed buttons and row links stay disabled and F3/F8 cannot invent a form',async()=>{
 const controls=load('components/ecount/SalesTaxQueryPageControls.js');
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(controls.SalesTaxToolbar),React.createElement(controls.SalesTaxFooter)));
 assert.equal((html.match(/<button/g)||[]).length,8);assert.equal((html.match(/disabled=""/g)||[]).length,8);
 const rowHtml=render({dataset:'salesTax',dataState:'loaded',rows:[{sourceDateLabel:'2026/09/30 -1',supplyAmt:'1',vat:'0.1',total:'1.1'}]});
 assert.equal((rowHtml.match(/aria-disabled="true"/g)||[]).length,3);
 const ids=[...(html+rowHtml).matchAll(/data-ecount-action-id="([^"]+)"/g)].map(match=>match[1]);
 const expected=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8')).pages.find(page=>page.program==='E040218').buttons.map(button=>button.matchId);
 assert.deepEqual(ids.sort(),expected.sort());
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
 for(const name of ['toggleSearch','runSearch']){
  const declaration=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert(declaration);
  const box={exports:{}},errors=[];
  vm.runInNewContext(source.slice(declaration.start,declaration.end)+';module.exports='+name,{module:box,busy:false,dataset:'salesTax',searchDraft:{},setError:message=>errors.push(message)});
  await box.exports();assert.equal(errors.length,1);assert.match(errors[0],/아직 확인하지 않았습니다/);
 }
});

test('stock displays safe typed code and exact quantity; unknown date is not a zero query',()=>{
 const rows=[{productCode:'P-01',quantity:'123456789012345.67890000',prodName:'not-permitted'}];
 const html=render({dataset:'stock',rows,dataState:'loaded'});assert.equal((html.match(/<th scope=/g)||[]).length,3);assert(html.includes('P-01'));assert(html.includes('123456789012345.67890000'));assert(!html.includes('not-permitted'));
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
 const declaration=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0];
 const callback=declaration.init.arguments[0];
 function select(version,filterFrom){return vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'stock',version,filterFrom,pageActions:require('../lib/ecountPageActions.cjs')});}
 assert.equal(select(null,'').snapshotUnavailable,true);
 const version={rows,periodFrom:'2026-10-20',periodTo:'2026-10-20'};
 assert.equal(select(version,'2026-10-20').rows.length,1);assert.equal(select(version,'2025-10-20').snapshotUnavailable,true);
 const missing=select(version,'2026-10-19');assert.equal(missing.rows.length,0);assert.equal(missing.snapshotUnavailable,true);
 assert(render({dataset:'stock',rows:missing.rows,dataState:'uncollected'}).includes('아직 수집되지 않았습니다'));
 assert(select(version,'12345-10-20').filterError);
});
test('sale amount thousands formatting preserves precision and decimal zeros',()=>{
 const {formatSaleAmount}=load('components/ecount/SaleQueryPageControls.js');
 assert.equal(formatSaleAmount('12345678901234567890.00100'),'12,345,678,901,234,567,890.00100');assert.equal(formatSaleAmount('-1234.50'),'-1,234.50');assert.equal(formatSaleAmount('0'),'0');assert.equal(formatSaleAmount(null),'');
});

test('stock observed year/month buttons and day textbox preserve fourteen action IDs',()=>{
 const c=load('components/ecount/StockStatusPageControls.js');
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(c.StockToolbar,{searchOpen:true}),React.createElement(c.StockSearchPanel,{asOf:'2026-10-20'}),React.createElement(c.StockFooter)));
 const ids=[...html.matchAll(/data-ecount-action-id="([^"]+)"/g)].map(match=>match[1]);
 const expected=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8')).pages.find(page=>page.program==='E040701').buttons.map(button=>button.matchId);
 assert.deepEqual(ids.sort(),expected.sort());assert(html.includes('aria-label="기준일 일"'));assert(!html.includes('type="date"'));
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
 const declaration=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');
 const box={exports:{}},errors=[];
 vm.runInNewContext(source.slice(declaration.start,declaration.end)+';module.exports=runSearch;',{module:box,busy:false,dataset:'stock',searchDraft:{from:'2026-02-31',to:'2026-02-31'},setError:message=>errors.push(message),policy:require('../lib/ecountWorkspaceClient.cjs'),ERRORS:{}});
 return box.exports().then(()=>assert.equal(errors.length,1));
});
