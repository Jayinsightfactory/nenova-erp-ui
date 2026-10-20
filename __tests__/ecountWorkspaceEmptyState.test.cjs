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
  const localRequire=id=>id.endsWith('.css')?styles:id.endsWith('.cjs')?require(path.resolve(path.dirname(file),id)):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id.endsWith('.js')?id:id+'.js'))):require(id);
  vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:localRequire,process,console});return module.exports;
}
const source=fs.readFileSync(path.join(root,'pages/ecount/workbench.js'),'utf8');
const ast=babel.parseSync(source,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});
const node=ast.program.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='Table');assert.ok(node);
const moduleBox={exports:{}};
vm.runInNewContext(compile("import React from 'react';\n"+source.slice(node.start,node.end)+';module.exports=Table;','Table.js'),{
  module:moduleBox,exports:moduleBox.exports,require,styles,
  ...load('components/ecount/StockLedgerPageControls.js'),...load('components/ecount/WarehouseStockPageControls.js'),...load('components/ecount/StockMovementPageControls.js'),...load('components/ecount/PurchaseTaxStatusPageControls.js'),...load('components/ecount/SalesTaxStatusPageControls.js'),...load('components/ecount/PurchaseTaxQueryPageControls.js'),...load('components/ecount/StockStatusPageControls.js'),...load('components/ecount/SaleQueryPageControls.js'),...load('components/ecount/SalesTaxQueryPageControls.js'),...load('components/ecount/PurchaseOrderPageControls.js'),...load('components/ecount/SettlementPageControls.js'),...load('components/ecount/QuoteStatusPageControls.js')
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

test('tax search follows observed sales-only radios and purchase missing-data state',()=>{
 const {TaxSearchPanel}=load('components/ecount/TaxSearchPanel.js');
 for(const dataset of ['salesTax','buyTax']){
 const html=renderToStaticMarkup(React.createElement(TaxSearchPanel,{dataset,from:'2026-09-30',to:'2026-09-30'}));
 assert.equal((html.match(/type="radio"/g)||[]).length,dataset==='salesTax'?3:0);
 assert(html.includes('회계전표No.'));assert(!html.includes('메뉴검색'));
 }
 const html=render({dataset:'buyTax',rows:[],dataState:'uncollected'});assert.equal((html.match(/<th scope=/g)||[]).length,7);assert(html.includes('아직 수집되지 않았습니다'));assert(!html.includes('등록된 데이터가 없습니다'));
 const c=load('components/ecount/PurchaseTaxQueryPageControls.js');const footer=renderToStaticMarkup(React.createElement(c.PurchaseTaxFooter));assert(!footer.includes('Email'));
});
test('stock displays safe typed code and exact quantity; unknown date is not a zero query',()=>{
 const rows=[{productCode:'P-01',quantity:'123456789012345.67890000',prodName:'not-permitted'}];
 const html=render({dataset:'stock',rows,dataState:'loaded'});assert.equal((html.match(/<th scope=/g)||[]).length,3);assert(html.includes('P-01'));assert(html.includes('123,456,789,012,345.67890000'));assert(!html.includes('not-permitted'));
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
 const expected=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8')).pages.find(page=>page.program==='E040701').buttons.filter(button=>!['기준연도 메뉴','기준월 메뉴'].includes(button.source.context)).map(button=>button.matchId);
 assert.deepEqual(ids.sort(),expected.sort());assert(html.includes('aria-label="기준일 일"'));assert(!html.includes('type="date"'));
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
 const declaration=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');
 const box={exports:{}},errors=[];
 vm.runInNewContext(source.slice(declaration.start,declaration.end)+';module.exports=runSearch;',{module:box,busy:false,dataset:'stock',searchDraft:{from:'2026-02-31',to:'2026-02-31'},setError:message=>errors.push(message),policy:require('../lib/ecountWorkspaceClient.cjs'),ERRORS:{}});
 return box.exports().then(()=>assert.equal(errors.length,1));
});

test('tax and stock queries normalize day input and require a real purchase version',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
 const fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');
 for(const dataset of ['salesTax','buyTax','stock','whStock','taxStat','buyTaxStat'])for(const available of [false,true]){
  const captured={},errors=[],box={exports:{}};
  const context={warehouseDraft:['W1'],setWarehouseFilter:v=>captured.warehouses=v,module:box,busy:false,dataset,version:available?{}:null,searchDraft:{from:'2026-10-2',to:'2026-10-3',flow:'',query:''},policy:require('../lib/ecountWorkspaceClient.cjs'),ERRORS:{},setError:e=>errors.push(e),setFilterFrom:v=>captured.from=v,setFilterTo:v=>captured.to=v,setFlow(){},setRowQuery(){},setSearchOpen(){},load:async()=>{captured.loaded=true;},setTimeout:fn=>fn(),searchToggleRef:{current:{focus(){}}}};
  vm.runInNewContext(source.slice(fn.start,fn.end)+';module.exports=runSearch;',context);await box.exports();
  if(['buyTax','taxStat','buyTaxStat'].includes(dataset)&&!available){assert.equal(errors.length,1);assert.equal(captured.loaded,undefined);}else{assert.equal(captured.from,'2026-10-02');assert.equal(captured.to,['stock','whStock'].includes(dataset)?'2026-10-02':'2026-10-03');assert.equal(captured.loaded,true);if(dataset==='whStock')assert.deepEqual([...captured.warehouses],['W1']);}
 }
});
test('stock year/month/manual selection is local, exact and Escape restores trigger focus',()=>{
 const file=path.join(root,'components/ecount/ObservedDateWidget.js'),module={exports:{}};
 let states=[],refs=[],stateIndex=0,refIndex=0,value='2026-10-20',focused=0;
 const mock={...React,useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});},useEffect(){}};
 vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:id=>id==='react'?mock:id.endsWith('.css')?styles:id==='./ObservedPageControls'?load('components/ecount/ObservedPageControls.js'):require(id),Intl,Date});
 const {ObservedDateWidget,stockYearOptions}=module.exports;
 assert.deepEqual([...stockYearOptions(new Date('2026-12-31T14:59:00Z'))],['2027','2026','2025','2024']);assert.deepEqual([...stockYearOptions(new Date('2026-12-31T15:00:00Z'))],['2028','2027','2026','2025']);
 function tree(){stateIndex=0;refIndex=0;return ObservedDateWidget({dataset:'stock',value,onChange:v=>value=v,interactive:true});}
 function all(e){return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];}
 function find(predicate){return all(tree()).find(predicate);}
 const click={currentTarget:{focus(){focused++;}}};
 find(e=>e.props?.['aria-label']==='기준월 선택').props.onClick(click);
 assert.equal(all(tree()).filter(e=>e.type==='button'&&/^\d{2}$/.test(e.props.children)).length,14);
 find(e=>e.type==='button'&&e.props.children==='02').props.onClick();assert.equal(value,'2026-02-20');assert.equal(focused,1);
 find(e=>e.props?.['aria-label']==='기준연도 선택').props.onClick(click);find(e=>e.type==='button'&&e.props.children==='직접입력').props.onClick();
 find(e=>e.props?.['aria-label']==='연도 직접입력').props.onChange({target:{value:'2028'}});
 find(e=>e.props?.['aria-label']==='연도 직접입력').props.onKeyDown({key:'Enter',preventDefault(){},stopPropagation(){}});assert.equal(value,'2028-02-20');
 find(e=>e.props?.['aria-label']==='기준월 선택').props.onClick(click);find(e=>e.type==='span'&&typeof e.props?.onKeyDown==='function').props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(value,'2028-02-20');assert.equal(focused,3);
});

test('tax status retains six report columns and observed confirmed state without treating missing data as zero',()=>{
 const html=render({dataset:'taxStat',rows:[],dataState:'uncollected'});assert.equal((html.match(/<th scope=/g)||[]).length,6);assert(html.includes('매출부가세'));assert(html.includes('매출합계'));assert(html.includes('아직 수집되지 않았습니다'));
 const c=load('components/ecount/SalesTaxStatusPageControls.js');
 const form=renderToStaticMarkup(React.createElement(c.SalesTaxStatusSearchPanel,{from:'2026-10-20',to:'2026-10-20',canQuery:false}));
 assert.equal((form.match(/type="radio"/g)||[]).length,4);assert.equal((form.match(/checked=""/g)||[]).length,1);assert.match(form,/<input[^>]*checked=""[^>]*\/>확인/);assert(!form.includes('최종수정자'));assert(form.includes('청구서'));assert(!form.includes('직전반기'));
});

test('purchase tax report keeps separate labels and form without sales tax customer checkbox',()=>{
 const html=render({dataset:'buyTaxStat',rows:[],dataState:'uncollected'});assert.equal((html.match(/<th scope=/g)||[]).length,6);assert(html.includes('매입부가세'));assert(html.includes('매입합계'));assert(html.includes('아직 수집되지 않았습니다'));
 const c=load('components/ecount/PurchaseTaxStatusPageControls.js');const form=renderToStaticMarkup(React.createElement(c.PurchaseTaxStatusSearchPanel,{from:'2026-10-20',to:'2026-10-20',canQuery:false}));assert(!form.includes('세무신고거래처'));assert(form.includes('기본(수정불가)'));assert.match(form,/<input[^>]*checked=""[^>]*\/>확인/);
});

test('warehouse stock preserves visible layouts, missing cells and exact collected totals',()=>{
 const rows=[{productCode:'P1',warehouseCode:'W1',quantity:'9007199254740993.1',prodName:'private-name'},{productCode:'P1',warehouseCode:'W2',quantity:'0.2'},{productCode:'P2',warehouseCode:'W1',quantity:'1'}];
 const vertical=render({dataset:'whStock',warehouseMode:'vertical',rows,dataState:'loaded'});assert.equal((vertical.match(/<th /g)||[]).length,5);assert(!vertical.includes('private-name'));assert(vertical.includes('9,007,199,254,740,993.1'));
 const horizontal=render({dataset:'whStock',rows,dataState:'loaded'});assert.equal((horizontal.match(/<th /g)||[]).length,6);assert(horizontal.includes('9,007,199,254,740,993.3'));assert(!horizontal.includes('private-name'));assert.match(horizontal,/>P2<.*?>1<.*?><\/td>/);
 const empty=render({dataset:'whStock',rows:[],dataState:'uncollected'});assert.equal((empty.match(/<th /g)||[]).length,5);assert(empty.includes('아직 수집되지 않았습니다'));
});
test('stock movement has seven visible columns and exact-period data only',()=>{
 const rows=[{productCode:'P1',openingQuantity:'10.00000001',inQuantity:'2',outQuantity:'1',quantity:'11.00000001',prodName:'private-name'}];const html=render({dataset:'stockMove',rows,dataState:'loaded'});assert.equal((html.match(/<th /g)||[]).length,7);assert(html.includes('11.00000001'));assert(!html.includes('private-name'));
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 for(const dataset of ['whStock','stockMove']){const version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:dataset==='whStock'?[{productCode:'P1',warehouseCode:'W1',quantity:'11.00000001'}]:rows};for(const date of ['2026-10-20','2025-10-20']){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset,version,warehouseFilter:[],filterFrom:date,filterTo:date,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,date!=='2026-10-20');assert.equal(result.rows.length,date==='2026-10-20'?1:0);}}
});

test('warehouse and movement observed action IDs cover only their own controls',()=>{
 const report=require('../data/ecount-workbench/button-matches.json');const {actionId}=load('components/ecount/ObservedPageControls.js');
 for(const [dataset,program] of [['whStock','E040711'],['stockMove','E040719']]){for(const b of report.pages.find(p=>p.program===program).buttons)assert.equal(actionId(dataset,b.source.label,b.source.context),b.matchId);}
 const warehouse=load('components/ecount/WarehouseStockPageControls.js');const footer=renderToStaticMarkup(React.createElement(warehouse.WarehouseStockFooter));assert.equal((footer.match(/<button/g)||[]).length,2);
 for(const mode of ['vertical','horizontal']){const html=renderToStaticMarkup(React.createElement(warehouse.WarehouseStockSearchPanel,{asOf:'2026-10-20',mode}));assert(html.includes(mode==='vertical'?'현황(종)':'현황(횡)'));assert.equal((html.match(/type="checkbox"/g)||[]).length,7);}
 const movement=load('components/ecount/StockMovementPageControls.js');const panel=renderToStaticMarkup(React.createElement(movement.StockMovementSearchPanel,{from:'2026-10-20',to:'2026-10-20'}));assert.equal((panel.match(/type="radio"/g)||[]).length,5);assert.equal((panel.match(/type="checkbox"/g)||[]).length,7);
});

test('warehouse and movement quantity separators preserve large decimal strings and leave codes unchanged',()=>{
 const quantity='12345678901234567890.12000000',formatted='12,345,678,901,234,567,890.12000000';
 const wh=render({dataset:'whStock',warehouseMode:'vertical',dataState:'loaded',rows:[{productCode:'1234567',warehouseCode:'7654321',quantity}]});assert(wh.includes(formatted));assert(wh.includes('>1234567<'));assert(wh.includes('>7654321<'));
 const movement=render({dataset:'stockMove',dataState:'loaded',rows:[{productCode:'1234567',openingQuantity:quantity,inQuantity:'1234.5000',outQuantity:'-1234.50',quantity}]});assert.equal(movement.split(formatted).length-1,2);assert(movement.includes('1,234.5000'));assert(movement.includes('-1,234.50'));assert(movement.includes('>1234567<'));
});

test('warehouse lookup returns only selected collected codes and supports F8 without names',()=>{
 const file=path.join(root,'components/ecount/WarehouseLookupOverlay.js'),module={exports:{}};let state,returned;
 const mock={...React,useState:initial=>{if(state===undefined)state=typeof initial==='function'?initial():initial;return[state,next=>state=typeof next==='function'?next(state):next];}};
 vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:id=>id==='react'?mock:id.endsWith('.css')?styles:id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id+'.js'))):require(id)});
 const rows=[{warehouseCode:'W1',warehouseName:'private-name'},{warehouseCode:'W2'},{warehouseCode:'W1'}];
 function tree(){return module.exports.WarehouseLookupOverlay({rows,selected:['unknown'],onApply:v=>returned=v,onClose(){}});}
 function all(e){return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];}
 let nodes=all(tree());assert.equal(nodes.filter(e=>e.props?.type==='checkbox').length,2);nodes.find(e=>e.props?.['aria-label']==='창고코드 W2').props.onChange({target:{checked:true}});
 nodes=all(tree());nodes.find(e=>e.props?.onKeyDown).props.onKeyDown({key:'F8',preventDefault(){},stopPropagation(){}});assert.deepEqual([...returned],['W2']);
 const html=renderToStaticMarkup(React.createElement(load('components/ecount/WarehouseLookupOverlay.js').WarehouseLookupOverlay,{rows,onClose(){}}));assert(!html.includes('private-name'));assert.equal((html.match(/<th scope=/g)||[]).length,4);assert(html.includes('E040711-A27'));assert(html.includes('E040711-A28'));
});
test('warehouse filter is applied to the safe snapshot and missing warehouse coverage stays unknown',()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 const version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[{productCode:'P1',warehouseCode:'W1',quantity:'1'},{productCode:'P1',warehouseCode:'W2',quantity:'2'}]};
 for(const [warehouseFilter,count,missing]of[[[],2,false],[['W2'],1,false],[['unknown'],0,true]]){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'whStock',version,warehouseFilter,filterFrom:'2026-10-20',pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.rows.length,count);assert.equal(result.snapshotUnavailable,missing);if(count===1)assert.equal(result.rows[0].warehouseCode,'W2');}
});

test('stock ledger preserves only observed two-row groups and never invents transactions',()=>{
 const rows=[{productCode:'P001',openingQuantity:'123456789012345.12000000',inQuantity:'12.5',outQuantity:'2.5',quantity:'123456789012355.12000000',prodName:'private-name'}];const html=render({dataset:'stkLedger',rows,dataState:'loaded'});assert.equal((html.match(/<th scope=/g)||[]).length,6);assert.equal((html.match(/<tbody><tr>/g)||[]).length,1);assert(html.includes('전일재고'));assert(html.includes('합계'));assert(html.includes('123,456,789,012,345.12000000'));assert(html.includes('123,456,789,012,355.12000000'));assert(!html.includes('private-name'));assert.equal((html.match(/colSpan="3"/gi)||[]).length,2);
 const empty=render({dataset:'stkLedger',rows:[],dataState:'uncollected'});assert(empty.includes('아직 수집되지 않았습니다'));assert(!empty.includes('등록된 데이터가 없습니다'));
});
test('ledger notice defers query until decline-reselection, preserving old results on acceptance',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');const seen={},box={exports:{}};
 const context={module:box,busy:false,dataset:'stkLedger',ledgerProductDraft:'',setLedgerProductFilter:v=>seen.product=v,version:{rows:[]},searchDraft:{from:'2026-10-20',to:'2026-10-20',flow:'',query:''},policy:require('../lib/ecountWorkspaceClient.cjs'),ERRORS:{},setError:e=>{throw Error(e);},setLedgerPending:v=>seen.pending=v,setDialog:v=>seen.dialog=v,setFilterFrom:v=>seen.from=v,setFilterTo:v=>seen.to=v,setFlow(){},setRowQuery(){},setSearchOpen:v=>seen.searchOpen=v,load:async()=>{seen.loaded=true;},setTimeout:fn=>fn(),searchToggleRef:{current:{focus(){}}}};
 vm.runInNewContext(source.slice(fn.start,fn.end)+';module.exports=runSearch;',context);await box.exports();assert.equal(seen.dialog,'ledger-notice');assert.equal(seen.loaded,undefined);assert.equal(seen.from,undefined);await box.exports(seen.pending,true);assert.equal(seen.loaded,true);assert.equal(seen.from,'2026-10-20');assert.equal(seen.searchOpen,false);
});

test('ledger price controls and notice actions retain observed identities; confirm never queries',()=>{
 const c=load('components/ecount/StockLedgerPageControls.js'),{actionId}=load('components/ecount/ObservedPageControls.js');const report=require('../data/ecount-workbench/button-matches.json').pages.find(p=>p.program==='E040702');for(const b of report.buttons)assert.equal(actionId('stkLedger',b.source.label,b.source.context),b.matchId);
 const html=renderToStaticMarkup(React.createElement(c.StockLedgerSearchPanel,{from:'2026-10-20',to:'2026-10-20'}));assert.equal((html.match(/type="radio"/g)||[]).length,11);assert.equal((html.match(/type="checkbox"/g)||[]).length,6);
 let confirm;function visit(n){if(!n||typeof n!=='object')return;if(n.type==='JSXElement'&&n.openingElement.name.name==='button'&&n.children.some(c=>c.type==='JSXText'&&c.value==='확인')&&source.slice(n.start,n.end).includes('조회품목 재지정 알림'))confirm=n.openingElement.attributes.find(a=>a.name?.name==='onClick').value.expression;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(ast);
 assert(confirm);const calls=[];vm.runInNewContext('('+source.slice(confirm.start,confirm.end)+')()',{setLedgerPending:v=>calls.push(['pending',v]),setSearchOpen:v=>calls.push(['search',v]),closeDialog:()=>calls.push(['close']),runSearch:()=>{throw Error('unexpected query');}});assert.deepEqual(calls,[['pending',null],['search',true],['close']]);
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];const version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[{productCode:'P1',openingQuantity:'1',inQuantity:'0',outQuantity:'0',quantity:'1'}]};for(const day of ['2026-10-20','2025-10-20']){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'stkLedger',ledgerProductFilter:'',version,filterFrom:day,filterTo:day,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,day!=='2026-10-20');}
});

test('product lookup limits selection to one safe code and retains five observed columns',()=>{
 const file=path.join(root,'components/ecount/ProductLookupOverlay.js'),module={exports:{}};let state,returned;
 const mock={...React,useState:initial=>{if(state===undefined)state=typeof initial==='function'?initial():initial;return[state,next=>state=typeof next==='function'?next(state):next];}};
 vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:id=>id==='react'?mock:id.endsWith('.css')?styles:id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id+'.js'))):require(id)});
 const rows=[{productCode:'P1',prodName:'private-name'},{productCode:'P2'}];function tree(){return module.exports.ProductLookupOverlay({rows,onApply:v=>returned=v,onClose(){}});}function all(e){return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];}
 all(tree()).find(e=>e.props?.['aria-label']==='품목코드 P1').props.onChange({target:{checked:true}});all(tree()).find(e=>e.props?.['aria-label']==='품목코드 P2').props.onChange({target:{checked:true}});assert.deepEqual([...state],['P2']);all(tree()).find(e=>e.props?.onKeyDown).props.onKeyDown({key:'F8',preventDefault(){},stopPropagation(){}});assert.deepEqual([...returned],['P2']);
 const html=renderToStaticMarkup(React.createElement(load('components/ecount/ProductLookupOverlay.js').ProductLookupOverlay,{rows,onClose(){}}));assert.equal((html.match(/<th scope=/g)||[]).length,5);assert(!html.includes('private-name'));assert(html.includes('규격그룹선택'));
});
test('single product ledger query bypasses notice and returns only the matching collected group',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch'),seen={},box={exports:{}};
 const context={module:box,busy:false,dataset:'stkLedger',ledgerProductDraft:'P2',setLedgerProductFilter:v=>seen.product=v,version:{rows:[]},searchDraft:{from:'2026-10-20',to:'2026-10-20',flow:'',query:''},policy:require('../lib/ecountWorkspaceClient.cjs'),ERRORS:{},setError:e=>{throw Error(e);},setLedgerPending(){throw Error('unexpected notice');},setDialog(){throw Error('unexpected notice');},setFilterFrom(){},setFilterTo(){},setFlow(){},setRowQuery(){},setSearchOpen(){},load:async()=>{seen.loaded=true;},setTimeout:fn=>fn(),searchToggleRef:{current:{focus(){}}}};vm.runInNewContext(source.slice(fn.start,fn.end)+';module.exports=runSearch;',context);await box.exports();assert.equal(seen.product,'P2');assert.equal(seen.loaded,true);
 const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0],version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:['P1','P2'].map(productCode=>({productCode,openingQuantity:'1',inQuantity:'0',outQuantity:'0',quantity:'1'}))};for(const code of ['P2','missing']){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'stkLedger',ledgerProductFilter:code,version,filterFrom:'2026-10-20',filterTo:'2026-10-20',pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.rows.length,code==='P2'?1:0);assert.equal(result.snapshotUnavailable,code!=='P2');}
});
