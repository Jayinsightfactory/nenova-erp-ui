const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');
const root=path.join(__dirname,'..'),cache=new Map();
const styles=new Proxy({},{get:(_,key)=>key==='__esModule'?false:key});
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
  ...load('components/ecount/InventoryDailyPageControls.js'),...load('components/ecount/PoStatusPageControls.js'),...load('components/ecount/RelationStockPageControls.js'),...load('components/ecount/BomStockPageControls.js'),...load('components/ecount/StockBalancePageControls.js'),...load('components/ecount/StockLedgerPageControls.js'),...load('components/ecount/WarehouseStockPageControls.js'),...load('components/ecount/StockMovementPageControls.js'),...load('components/ecount/PurchaseTaxStatusPageControls.js'),...load('components/ecount/SalesTaxStatusPageControls.js'),...load('components/ecount/PurchaseTaxQueryPageControls.js'),...load('components/ecount/StockStatusPageControls.js'),...load('components/ecount/SaleQueryPageControls.js'),...load('components/ecount/SalesTaxQueryPageControls.js'),...load('components/ecount/PurchaseOrderPageControls.js'),...load('components/ecount/SettlementPageControls.js'),...load('components/ecount/QuoteStatusPageControls.js'),...load('components/ecount/OrderStatusPageControls.js')
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
 for(const dataset of ['whStock','stockMove']){const version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:dataset==='whStock'?[{productCode:'P1',warehouseCode:'W1',quantity:'11.00000001'}]:rows};for(const date of ['2026-10-20','2025-10-20']){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset,workspaceDataset:dataset,version,warehouseFilter:[],filterFrom:date,filterTo:date,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,date!=='2026-10-20');assert.equal(result.rows.length,date==='2026-10-20'?1:0);}}
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

test('balance analysis preserves two-level headers and observed month values without deriving totals',()=>{
 const values={quantity:'123456789012345.1200',currentMonthQuantity:'1',previousMonthQuantity:'2',twoMonthsAgoQuantity:'3',threeMonthsAgoQuantity:'4',otherQuantity:'5',unsoldQuantity:'6',monthLabels:[10,9,8,7]};
 const rows=[{...values,productCode:'P1',prodName:'private-name'},{...values,isSubtotal:true,productCode:null,quantity:'99999'}];const html=render({dataset:'stkBalance',rows,dataState:'loaded'});
 assert.equal((html.match(/<th scope="col"/g)||[]).length,9);assert(html.includes('colSpan="5"'));assert.equal((html.match(/rowSpan="2"/gi)||[]).length,4);assert(html.includes('10월'));assert(html.includes('7월'));assert(html.includes('123,456,789,012,345.1200'));assert(html.includes('99,999'));assert(html.includes('colSpan="2">합계'));assert(!html.includes('private-name'));
 const empty=render({dataset:'stkBalance',rows:[],dataState:'uncollected'});assert(empty.includes('아직 수집되지 않았습니다'));assert(!empty.includes('10월'));
 const {actionId}=load('components/ecount/ObservedPageControls.js');for(const b of require('../data/ecount-workbench/button-matches.json').pages.find(p=>p.program==='E040727').buttons)assert.equal(actionId('stkBalance',b.source.label,b.source.context),b.matchId);
 const c=load('components/ecount/StockBalancePageControls.js');const search=renderToStaticMarkup(React.createElement(c.StockBalanceSearchPanel,{asOf:'2026-10-20'}));assert.equal((search.match(/type="checkbox"/g)||[]).length,5);assert(!search.includes('창고'));
});

test('balance snapshot keeps stored month labels and refuses a different year or missing version',()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 const row={productCode:'P1',quantity:'7',currentMonthQuantity:'1',previousMonthQuantity:'1',twoMonthsAgoQuantity:'1',threeMonthsAgoQuantity:'1',otherQuantity:'1',unsoldQuantity:'2',monthLabels:[10,9,8,7]},version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[row]};
 for(const [stored,date,available] of [[version,'2026-10-20',true],[version,'2025-10-20',false],[null,'2026-10-20',false]]){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'stkBalance',version:stored,filterFrom:date,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,!available);assert.equal(result.rows.length,available?1:0);if(available)assert.deepEqual([...result.rows[0].monthLabels],[10,9,8,7]);}
});

test('BOM shows exactly selected and upper tables without deriving conversion or unknown empty',()=>{
 const row={productCode:'P1',quantity:'1000.00',convertedQuantity:'3456.7800',upperResult:'empty_observed'};const html=render({dataset:'bomStock',rows:[row],dataState:'loaded'});assert.equal((html.match(/<th scope=/g)||[]).length,14);assert(html.includes('I.검색품목'));assert(html.includes('II.환산수량(상위품목)'));assert(html.includes('3,456.7800'));assert(html.includes('등록된 데이터가 없습니다.'));
 const unknown=render({dataset:'bomStock',rows:[{...row,upperResult:'uncollected'}],dataState:'loaded'});assert(!unknown.includes('등록된 데이터가 없습니다.'));assert(unknown.includes('아직 수집되지 않았습니다'));
 const missing=render({dataset:'bomStock',rows:[],dataState:'uncollected'});assert(!missing.includes('등록된 데이터가 없습니다.'));
 const {actionId}=load('components/ecount/ObservedPageControls.js');for(const b of require('../data/ecount-workbench/button-matches.json').pages.find(p=>p.program==='E040726').buttons)assert.equal(actionId('bomStock',b.source.label,b.source.context),b.matchId);const c=load('components/ecount/BomStockPageControls.js');const search=renderToStaticMarkup(React.createElement(c.BomStockSearchPanel,{asOf:'2026-10-20',productCode:''}));assert(!/type="submit"[^>]*disabled/.test(search));assert(!search.includes('기본(수정불가)'));
});
test('BOM requires code without querying or erasing results; only exact code/date gets observed empty upper',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch'),seen={},box={exports:{}};
 const context={module:box,busy:false,dataset:'bomStock',bomProductDraft:'',searchDraft:{from:'2026-10-20',to:'2026-10-20'},setError(){throw Error('unexpected error');},setFilterFrom(){throw Error('must preserve results');},load(){throw Error('unexpected load');}};vm.runInNewContext(source.slice(fn.start,fn.end)+';module.exports=runSearch;',context);await box.exports();
 const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0],version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[{productCode:'P1',quantity:'1',convertedQuantity:'5',upperResult:'empty_observed'}]};for(const [code,date,available]of[['P1','2026-10-20',true],['P2','2026-10-20',false],['P1','2025-10-20',false],['','2026-10-20',false]]){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'bomStock',bomProductFilter:code,version,filterFrom:date,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,!available);assert.equal(result.rows.length,available?1:0);}
});

test('relation stock preserves source four columns and actual subtotal, never infers an unselected zero result',()=>{
 const rows=[{productCode:'P1',quantity:'1234.5600',convertedQuantity:'9876.54',isSubtotal:false,prodName:'private-name'},{productCode:null,quantity:'9999',convertedQuantity:'8888',isSubtotal:true}];const html=render({dataset:'relStock',rows,dataState:'loaded'});assert.equal((html.match(/<th scope=/g)||[]).length,4);assert(html.includes('1,234.5600'));assert(html.includes('9,876.54'));assert(html.includes('9,999'));assert(html.includes('colSpan="2">합계'));assert(!html.includes('private-name'));
 const empty=render({dataset:'relStock',rows:[],dataState:'uncollected'});assert(empty.includes('아직 수집되지 않았습니다'));assert(!empty.includes('등록된 데이터가 없습니다'));
 const {actionId}=load('components/ecount/ObservedPageControls.js');for(const b of require('../data/ecount-workbench/button-matches.json').pages.find(p=>p.program==='E040728').buttons)assert.equal(actionId('relStock',b.source.label,b.source.context),b.matchId);const c=load('components/ecount/RelationStockPageControls.js');const form=renderToStaticMarkup(React.createElement(c.RelationStockSearchPanel,{asOf:'2026-10-20',productCode:''}));assert(form.includes('기본(수정불가)'));assert(!/type="submit"[^>]*disabled/.test(form));assert(!form.includes('required='));
});

test('relation scope supports only observed selected date/code and retains original total',()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];const version={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[{productCode:'P1',quantity:'1',convertedQuantity:'2',isSubtotal:false},{productCode:null,quantity:'4',convertedQuantity:'8',isSubtotal:true}]};
 for(const [code,date,available]of[['P1','2026-10-20',true],['P2','2026-10-20',false],['P1','2025-10-20',false],['','2026-10-20',false]]){const result=vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'relStock',relationProductFilter:code,version,filterFrom:date,pageActions:require('../lib/ecountPageActions.cjs')});assert.equal(result.snapshotUnavailable,!available);assert.equal(result.rows.length,available?2:0);if(available)assert.equal(result.rows[1].quantity,'4');}
});

test('initial BOM F3 opens the actual search panel without a selected product, while query stays blocked',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,toggle=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='toggleSearch'),run=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch'),box={exports:{}};let open=false,focused=0;
 const context={module:box,busy:false,dataset:'bomStock',bomProductDraft:'',version:null,searchDraft:{from:'',to:'',flow:'',query:''},searchOpen:false,setSearchDraft:fn=>context.searchDraft=fn(context.searchDraft),setSearchOpen:fn=>{open=typeof fn==='function'?fn(open):fn;},setTimeout:fn=>fn(),searchInputRef:{current:{focus(){focused++;}}},setError(){throw Error('unexpected validation before opening');},setFilterFrom(){throw Error('query must preserve existing rows');},load(){throw Error('query must not run without a code');}};
 vm.runInNewContext(source.slice(toggle.start,toggle.end)+';'+source.slice(run.start,run.end)+';module.exports={toggleSearch,runSearch};',context);
 const {BomStockToolbar}=load('components/ecount/BomStockPageControls.js');const tree=BomStockToolbar({busy:false,searchOpen:false,onSearch:box.exports.toggleSearch});function all(e){return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];}const button=all(tree).find(e=>e.type==='button'&&e.props.children==='Search(F3)');assert(button);assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(open,true);assert.equal(focused,1);context.searchOpen=open;await box.exports.runSearch();assert.equal(open,true);box.exports.toggleSearch();assert.equal(open,false);
});

test('observed quote/order widths and search choices retain uncollected semantics',()=>{
 for(const [dataset,mode,width,widths] of [['quoteStat','aggregate',875,[158,100,100,56,100,120,120,120]],['quoteStat','detail',716,[60,150,75,90,90,150,100]],['orderStat','detail',751,[60,150,75,90,90,150,135]]]){
  const html=render({dataset,rows:[],dataState:'uncollected',quoteReportMode:mode,orderReportMode:mode});
  assert(html.includes('<table style="width:'+width+'px">'));assert(html.includes(widths.map(w=>'<col style="width:'+w+'px"/>').join('')));assert(html.includes('아직 수집되지 않았습니다'));
 }
 for(const [file,name] of [['QuoteStatus','QuoteStatusSearchPanel'],['OrderStatus','OrderStatusSearchPanel']]){
 const c=load('components/ecount/'+file+'PageControls.js');const html=renderToStaticMarkup(React.createElement(c[name],{mode:'detail'}));assert.equal((html.match(/type="radio"/g)||[]).length,10);assert(html.includes('전월동일기간'));assert(html.includes('외자'));
 }
 const c=load('components/ecount/OrderStatusPageControls.js');assert(!renderToStaticMarkup(React.createElement(c.OrderStatusFooter)).includes('Search(F3)'));
});
test('quote Excel Escape preserves observed open state, toggle closes; other menus keep Escape close',()=>{
 const src=fs.readFileSync(path.join(root,'components/ecount/ObservedPageControls.js'),'utf8');const tree=babel.parseSync(src,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});const fn=tree.program.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='ObservedDropdown').declaration;
 for(const closeOnEscape of [false,true]){
 let state=false,effect;const handlers={};const box={exports:{}};
 vm.runInNewContext(compile("import React from 'react';\n"+src.slice(fn.start,fn.end)+';module.exports=ObservedDropdown;','Dropdown.js'),{module:box,exports:box.exports,require,styles,pending:'미검증',ActionContext:{},actionId:()=>undefined,useContext:()=>({dataset:'quoteStat'}),useState:()=>[state,v=>state=typeof v==='function'?v(state):v],useRef:()=>({current:null}),useEffect:fn=>effect=fn,document:{addEventListener:(k,v)=>handlers[k]=v,removeEventListener(){}}});
 const renderDropdown=()=>box.exports({label:'Excel 드롭다운',items:['Excel(표시형식)','Excel(데이터)'],closeOnEscape});
 renderDropdown().props.children[0].props.onClick();assert.equal(state,true);const open=renderDropdown();effect();assert(open.props.children[1].props.children.every(item=>item.props.children.props.disabled));handlers.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(state,!closeOnEscape);
 if(!closeOnEscape){renderDropdown().props.children[0].props.onClick();assert.equal(state,false);}
 }
});

test('movement daily/monthly preserve source groups, actual total and nullable cells',()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 for(const [mode,workspaceDataset] of [['daily','stkDaily'],['monthly','stkMonth']]){
 const rows=[{reportMode:mode,rowKind:'opening',productCode:'P-01',dateLabel:'전일재고',inQuantity:'1000',outQuantity:'2',quantity:'123456789012345.12000000'},{reportMode:mode,rowKind:'group_summary',productCode:'P-01',dateLabel:null,inQuantity:'1000',outQuantity:'2',quantity:null},{reportMode:mode,rowKind:'total',productCode:null,dateLabel:null,inQuantity:'1000',outQuantity:'2',quantity:null}];
 const version={dataset:workspaceDataset,periodFrom:'2026-10-20',periodTo:'2026-10-20',rows};
 const select=(date,v=version)=>vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'stockMove',workspaceDataset,version:v,filterFrom:date,filterTo:date,pageActions:require('../lib/ecountPageActions.cjs')});
 assert.equal(select('2026-10-20').rows.length,3);assert.equal(select('2026-10-19').snapshotUnavailable,true);assert.equal(select('2026-10-20',{...version,dataset:mode==='daily'?'stkMonth':'stkDaily'}).snapshotUnavailable,true);
 const html=render({dataset:'stockMove',movementMode:mode,rows:select('2026-10-20').rows,dataState:'loaded'});assert.equal((html.match(/<th /g)||[]).length,7);assert(html.includes('123,456,789,012,345.12000000'));assert(html.includes('<td colSpan="2">P-01 계</td>'));assert(html.includes('<td colSpan="2">합계</td>'));assert.equal((html.match(/<td style="text-align:right"><\/td>/g)||[]).length,2);assert(html.includes('전일재고'));
 }
});
test('movement mode change invalidates request/version/history and isolates API dataset',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='changeMovementMode');const calls={};const requestId={current:7};const env={busy:false,movementMode:'aggregate',requestId};for(const name of ['setVersion','setRevision','setHistory','setAudit','setDialog','setUpload','setSheet','setRollbackId','setError','setMessage','setRowQuery','setMovementMode'])env[name]=value=>calls[name]=value;
 vm.runInNewContext('('+source.slice(fn.start,fn.end)+')',env)('daily');assert.equal(requestId.current,8);assert.equal(calls.setVersion,null);assert.equal(calls.setRevision,null);assert.equal(calls.setMovementMode,'daily');assert.equal(calls.setHistory.length,0);
 const apiFn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='api');let request;
 const api=vm.runInNewContext('('+source.slice(apiFn.start,apiFn.end)+')',{URLSearchParams,currentCriteria:{},orderCriteria:{},workspaceDataset:'stkDaily',dataset:'stockMove',menuId:'MENUTREE_001713',fetch:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({success:true})};}});
 await api('current',{action:'import'});assert(request.url.includes('dataset=stkDaily'));assert.equal(JSON.parse(request.options.body).dataset,'stkDaily');
 const panel=load('components/ecount/StockMovementPageControls.js').StockMovementSearchPanel;const html=renderToStaticMarkup(React.createElement(panel,{mode:'monthly',from:'2026-10-20',to:'2026-10-20'}));assert(html.includes('E040719-A22'));assert(!html.includes('name="stock-move-0" disabled'));
});

test('observed sidebar follows manifest ancestry and leaf selection without querying groups',()=>{
 const file=path.join(root,'components/ecount/EcountNavigation.js');const states=[];let index=0;const calls=[];
 const mock={...React,useState:initial=>{const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useMemo:fn=>fn(),useEffect(){}};const box={exports:{}};
 vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module:box,exports:box.exports,require:id=>id==='react'?mock:id.endsWith('.css')?styles:require(id)});
 const menus=require('../data/ecount-workbench/source-menu.json').menus;const props={menus,tab:'MENUTREE_000004',menuId:'MENUTREE_002537',busy:false,onSelect:id=>calls.push(id),children:React.createElement('p',null,'report')};
 const build=()=>{index=0;return box.exports.default(props);};const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of React.Children.toArray(tree.props?.children)){const hit=find(child,predicate);if(hit)return hit;}return null;};
 let tree=build();const html=renderToStaticMarkup(tree);assert(html.includes('aria-label="업무 그룹"'));assert(html.includes('BOM환산재고현황'));assert(html.includes('aria-current="page"'));assert(!html.includes('메뉴 수'));assert.equal(box.exports.menuAncestors(menus,props.menuId).length,4);
 const leaf=find(tree,n=>n.type==='button'&&n.props['aria-current']==='page');leaf.props.onClick();assert.deepEqual(calls,['MENUTREE_002537']);calls.length=0;
 const group=find(tree,n=>n.type==='button'&&n.props['aria-expanded']===true);group.props.onClick();assert.equal(calls.length,0);tree=build();assert(!renderToStaticMarkup(tree).includes('aria-current="page"'));
 const top=find(tree,n=>n.type==='button'&&n.props['aria-pressed']===false);top.props.onClick();assert.equal(calls.length,0);tree=build();assert(!renderToStaticMarkup(tree).includes('BOM환산재고현황'));
 props.busy=true;tree=build();const disabled=find(tree,n=>n.type==='button'&&n.props.disabled);disabled.props.onClick();assert.equal(calls.length,0);
});
test('BOM scoped search card keeps source labels and query controls, outside pages retain shared search class',()=>{
 const c=load('components/ecount/BomStockPageControls.js');const html=renderToStaticMarkup(React.createElement(c.BomStockSearchPanel,{asOf:'2026-10-20',productCode:''}));assert(html.includes('bomSearchCard'));assert(html.includes('기본'));assert(html.includes('양식구분'));assert(html.includes('E040726-A05'));assert(!html.includes('type="submit" class="primary" disabled'));
 const toolbar=renderToStaticMarkup(React.createElement(c.BomStockToolbar,{searchOpen:true}));assert(toolbar.includes('hidden=""'));assert(toolbar.includes('Option'));
 const css=fs.readFileSync(path.join(root,'styles/ecount-workbench.module.css'),'utf8');assert(css.includes('.bomSearchCard.sourceSearch{width:755px'));assert(css.includes('.sidebar{flex:0 0 239.328125px'));assert(css.includes('.groupbar{position:absolute;left:170.40625px'));
});

test('order detail empty observation requires exact server coverage; other dates never fabricate zero',async()=>{
 const coverage=require('../lib/ecountObservedCoverage.cjs');const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;const find=name=>component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);const callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 const version={dataset:'ordEmpty',rows:[],periodFrom:'2026-10-20',periodTo:'2026-10-20',coverage:coverage.PROFILE};const criteria=coverage.PROFILE.criteria;
 const select=(v,c)=>vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'orderStat',orderReportMode:'detail',orderCriteria:c,version:v,observedCoverage:coverage});
 assert.equal(select(version,criteria).observedEmpty,true);assert.equal(select({...version,coverage:null},criteria).snapshotUnavailable,true);assert.equal(select(version,{...criteria,periodFrom:'2026-10-19'}).snapshotUnavailable,true);assert.equal(select(null,criteria).snapshotUnavailable,true);
 const loaded=render({dataset:'orderStat',rows:[],dataState:'loaded',orderReportMode:'detail'});assert(loaded.includes('등록된 데이터가 없습니다.'));assert(render({dataset:'orderStat',rows:[],dataState:'uncollected',orderReportMode:'detail'}).includes('아직 수집되지 않았습니다'));
 let fetched=0,stored='old',revision=1;const env={dataset:'orderStat',workspaceDataset:'ordEmpty',currentCriteria:criteria,orderCriteria:criteria,observedCoverage:coverage,requestId:{current:0},setBusy(){},setError(){},setLoginNeeded(){},setVersion:v=>stored=v,setRevision:v=>revision=v,api:async()=>{fetched++;return{version,revision:2};}};
 const runLoad=vm.runInNewContext('('+source.slice(find('load').start,find('load').end)+')',env);await runLoad({...criteria,periodTo:'2026-10-21'});assert.equal(fetched,0);assert.equal(stored,null);assert.equal(revision,null);await runLoad(criteria);assert.equal(fetched,1);assert.equal(stored,version);
 let url;const api=vm.runInNewContext('('+source.slice(find('api').start,find('api').end)+')',{URLSearchParams,workspaceDataset:'ordEmpty',currentCriteria:criteria,orderCriteria:criteria,menuId:'MENUTREE_000575',fetch:async u=>{url=u;return{ok:true,json:async()=>({success:true})};}});await api();assert.deepEqual(JSON.parse(new URLSearchParams(url.split('?')[1]).get('criteria')),criteria);
 const panel=load('components/ecount/OrderStatusPageControls.js').OrderStatusSearchPanel;const html=renderToStaticMarkup(React.createElement(panel,{mode:'detail',from:'2026-10-20',to:'2026-10-20'}));assert(html.includes('value="2026-10-20"'));assert(!html.includes('aria-label="조회 시작일" disabled'));
});

test('BOM/order source date profiles preserve fixed observed years, distinct month heights and Tab commit',()=>{
 for(const [dataset,sourceProfile,prefix,height] of [['bomStock','bomStock','기준',376.5625],['orderStat','orderStart','시작',260]]){
 const file=path.join(root,'components/ecount/ObservedDateWidget.js'),box={exports:{}};let states=[],refs=[],si=0,ri=0,value='2026-10-20',changes=0;
 const mock={...React,useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=ri++;return refs[i]||(refs[i]={current:initial});},useEffect(){}};
 vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module:box,exports:box.exports,require:id=>id==='react'?mock:id.endsWith('.css')?styles:id==='./ObservedPageControls'?load('components/ecount/ObservedPageControls.js'):require(id),Intl,Date});
 const tree=()=>{si=0;ri=0;return box.exports.ObservedDateWidget({dataset,sourceProfile,prefix,value,interactive:true,onChange:v=>{value=v;changes++;}});};const all=e=>!e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];const find=fn=>all(tree()).find(fn);const click={currentTarget:{focus(){}}};
 const openYear=()=>find(e=>e.props?.['aria-label']===prefix+'연도 선택').props.onClick(click);
 openYear();find(e=>e.type==='button'&&e.props.children==='25').props.onClick();assert.equal(value,'2025-10-20');openYear();const menu=find(e=>e.type==='span'&&e.props.style?.height===164.375);assert(menu);assert.deepEqual(all(menu).filter(n=>n.type==='button').map(n=>n.props.children),['27','26','25','24','직접입력']);
 find(e=>e.type==='button'&&e.props.children==='직접입력').props.onClick();assert.equal(find(e=>e.props?.['aria-label']==='연도 직접입력').props.value,'');find(e=>e.props?.['aria-label']==='연도 직접입력').props.onChange({target:{value:'20'}});let blocked=false;find(e=>e.props?.['aria-label']==='연도 직접입력').props.onKeyDown({key:'Tab',preventDefault(){blocked=true;},stopPropagation(){}});assert(blocked);assert.equal(value,'2025-10-20');find(e=>e.props?.['aria-label']==='연도 직접입력').props.onChange({target:{value:'2026'}});find(e=>e.props?.['aria-label']==='연도 직접입력').props.onKeyDown({key:'Tab',preventDefault(){},stopPropagation(){}});assert.equal(value,'2026-10-20');assert.equal(find(e=>e.props?.['aria-label']===prefix+'연도 선택').props.children,'26');
 find(e=>e.props?.['aria-label']===prefix+'월 선택').props.onClick(click);assert(find(e=>e.type==='span'&&e.props.style?.height===height));find(e=>e.type==='button'&&!e.props['aria-label']&&e.props.children==='10').props.onClick();assert.equal(value,'2026-10-20');assert.equal(changes,3);
 }
});

test('order preview opens a separate safe tab only for exact observed empty coverage',()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='openSalesPreview');const coverage=require('../lib/ecountObservedCoverage.cjs');const version={dataset:'ordEmpty',rows:[],coverage:coverage.PROFILE,periodFrom:'2026-10-20',periodTo:'2026-10-20'};
 let opens=0,closed=0,revokes=0,html='',error='',timer;const child={opener:{},location:{replace:url=>assert.equal(url,'blob:safe')},close(){closed++;}};
 const env={dataset:'orderStat',busy:false,revision:1,version,orderReportMode:'detail',orderCriteria:coverage.PROFILE.criteria,observedCoverage:coverage,rows:[],ORDER_STATUS_COLUMNS:load('components/ecount/OrderStatusPageControls.js').ORDER_STATUS_COLUMNS,window:{open:()=>{opens++;return child;}},pageActions:require('../lib/ecountPageActions.cjs'),printPreview:{renderPrintPreview:(model,options)=>{assert.equal(model.columns.length,7);assert.equal(options.layout,'orderStat-detail');return 'SAFE';}},filterFrom:'',filterTo:'',URL:{createObjectURL:()=> 'blob:safe',revokeObjectURL:()=>revokes++},Blob:class{constructor(parts){html=parts.join('');}},setTimeout:fn=>timer=fn,setError:v=>error=v};
 const open=()=>vm.runInNewContext('('+source.slice(fn.start,fn.end)+')()',env);open();assert.equal(opens,1);assert.equal(child.opener,null);assert.equal(html,'SAFE');timer();assert.equal(revokes,1);
 env.orderCriteria={...coverage.PROFILE.criteria,periodFrom:'2026-10-19'};open();assert.equal(opens,1);env.orderCriteria=coverage.PROFILE.criteria;env.version={...version,coverage:null};open();assert.equal(opens,1);env.version=version;env.orderReportMode='aggregate';open();assert.equal(opens,1);
 env.orderReportMode='detail';env.window.open=()=>null;open();assert(error.includes('차단'));env.window.open=()=>child;env.printPreview.renderPrintPreview=()=>{throw Error('bad model');};open();assert.equal(closed,1);assert(error.includes('만들 수 없습니다'));
});

test('quote detail voucher coverage never substitutes aggregate or missing criteria',async()=>{
 const coverage=require('../lib/ecountObservedCoverage.cjs'),profile=coverage.QUOTE_PROFILE,criteria=profile.criteria,version={dataset:'quoteEmpty',rows:[],periodFrom:criteria.periodFrom,periodTo:criteria.periodTo,coverage:profile};
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,callback=component.body.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='filtered').declarations[0].init.arguments[0];
 const select=c=>vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',{dataset:'quoteStat',quoteReportMode:'detail',quoteCriteria:c,version,observedCoverage:coverage});assert(select(criteria).observedEmpty);for(const diff of [{lineMode:'line'},{quoteNumber:'x'},{periodTo:'2026-10-21'},{reportMode:'aggregate'}])assert(select({...criteria,...diff}).snapshotUnavailable);
 const panel=load('components/ecount/QuoteStatusPageControls.js').QuoteStatusSearchPanel;const html=renderToStaticMarkup(React.createElement(panel,{mode:'detail',from:criteria.periodFrom,to:criteria.periodTo}));for(const label of ['전표별','견적서현황','견적No.','프로젝트','관리항목','시리얼/로트No.'])assert(html.includes(label));assert(!html.includes('aria-label="조회 시작일" disabled'));
 const fn=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');let loaded,from,to;const scope={busy:false,dataset:'quoteStat',quoteReportMode:'detail',currentCriteria:criteria,searchDraft:{from:criteria.periodFrom,to:criteria.periodTo},policy:require('../lib/ecountWorkspaceClient.cjs'),setError:()=>assert.fail('valid exact scope rejected'),setFilterFrom:v=>from=v,setFilterTo:v=>to=v,setSearchOpen(){},load:async c=>loaded=c};await vm.runInNewContext('('+source.slice(fn.start,fn.end)+')()',scope);assert.equal(from,criteria.periodFrom);assert.equal(to,criteria.periodTo);assert.equal(loaded.lineMode,'voucher');assert.equal(loaded.quoteNumber,'');assert.equal(loaded.form,'견적서현황');let apiCalls=0;const loadNode=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='load');const loadEnv={dataset:'quoteStat',workspaceDataset:'quoteEmpty',currentCriteria:criteria,observedCoverage:coverage,requestId:{current:0},setBusy(){},setError(){},setLoginNeeded(){},setVersion(){},setRevision(){},api:async(view,body,c)=>{apiCalls++;assert.equal(c.lineMode,'voucher');return{version,revision:1};}};const loadFn=vm.runInNewContext('('+source.slice(loadNode.start,loadNode.end)+')',loadEnv);await loadFn();assert.equal(apiCalls,1);await loadFn({...criteria,periodTo:'2026-10-21'});assert.equal(apiCalls,1);
});

test('native date input events commit displayed dates before F8, without requiring change',async()=>{
 const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,run=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch');const coverage=require('../lib/ecountObservedCoverage.cjs');
 const all=e=>!e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];
 for(const [dataset,file,name]of[['quoteStat','QuoteStatus','QuoteStatusSearchPanel'],['orderStat','OrderStatus','OrderStatusSearchPanel']]){
 let draft={from:'2026-10-20',to:'2026-10-20'},captured;
 const profile=dataset==='quoteStat'?coverage.QUOTE_PROFILE:coverage.PROFILE;const scope={busy:false,dataset,quoteReportMode:'detail',orderReportMode:'detail',currentCriteria:profile.criteria,policy:require('../lib/ecountWorkspaceClient.cjs'),setError:()=>assert.fail('date input rejected'),setFilterFrom(){},setFilterTo(){},setSearchOpen(){},load:async c=>captured=c};
 const Panel=load('components/ecount/'+file+'PageControls.js')[name];const tree=()=>Panel({mode:'detail',...draft,onFrom:v=>draft={...draft,from:v},onTo:v=>draft={...draft,to:v},onSubmit:()=>{scope.searchDraft=draft;return vm.runInNewContext('('+source.slice(run.start,run.end)+')()',scope);}});
 if(dataset==='quoteStat')all(tree()).find(e=>e.props?.['aria-label']==='조회 시작일').props.onInput({currentTarget:{value:'2026-10-19'}});else all(tree()).find(e=>e.props?.prefix==='시작').props.onChange('2026-10-19');
 all(tree()).find(e=>e.props?.['aria-label']==='조회 종료일').props.onInput({currentTarget:{value:'2026-10-19'}});
 await all(tree()).find(e=>e.type==='button'&&e.props.children==='검색(F8)').props.onClick();assert.equal(captured.periodFrom,'2026-10-19');assert.equal(captured.periodTo,'2026-10-19');assert.throws(()=>coverage.validateCriteria(captured,dataset==='quoteStat'?'quoteEmpty':'ordEmpty'));
 }
});
test('BOM toolbar exists exactly once inside heading, not in a separate row before its form',()=>{
 const bom=[];function visit(n,parents=[]){if(!n||typeof n!=='object')return;if(n.type==='JSXElement'&&n.openingElement.name.name==='BomStockToolbar')bom.push(parents);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(child=>visit(child,[...parents,n]));else if(v&&typeof v==='object')visit(v,[...parents,n]);}}visit(ast);assert.equal(bom.length,1);assert(bom[0].some(n=>n.type==='JSXElement'&&n.openingElement.attributes.some(a=>a.name?.name==='className'&&a.value?.expression?.property?.name==='heading')));
});
test('PO and daily sales require stored exact coverage and never reuse a different query zero',async()=>{
 const coverage=require('../lib/ecountObservedCoverage.cjs');const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration,run=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='runSearch'),loadNode=component.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='load');
 for(const [dataset,key,profile]of[['poStat','poEmpty',coverage.PO_PROFILE],['daySale','daySale',coverage.DAILY_SALES_PROFILE]]){
 let received,selectedKinds;const context={busy:false,dataset,poReportMode:'detail',dailyKindsDraft:['판매'],searchDraft:{from:'2026-10-20',to:'2026-10-20'},currentCriteria:profile.criteria,policy:require('../lib/ecountWorkspaceClient.cjs'),setError:()=>assert.fail('unexpected date error'),setFilterFrom(){},setFilterTo(){},setSearchOpen(){},setDailyKindsFilter:v=>selectedKinds=v,load:async c=>received=c};await vm.runInNewContext('('+source.slice(run.start,run.end)+')()',context);coverage.validateCriteria(received,key);if(dataset==='daySale')assert.equal(selectedKinds[0],'판매');else assert.equal(received.form,'결제일 기준');
 const version={dataset:key,coverage:profile,rows:[],periodFrom:'2026-10-20',periodTo:'2026-10-20'};let current=version,calls=0;const loadEnv={dataset,workspaceDataset:key,currentCriteria:received,observedCoverage:coverage,requestId:{current:0},setBusy(){},setError(){},setLoginNeeded(){},setVersion:v=>current=v,setRevision(){},api:async()=>{calls++;return{version,revision:1};}};const fetch=vm.runInNewContext('('+source.slice(loadNode.start,loadNode.end)+')',loadEnv);await fetch();assert.equal(calls,1);await fetch({...received,periodFrom:'2026-10-19'});assert.equal(calls,1);assert.equal(current,null);
 const missing=render({dataset,rows:[],dataState:'uncollected'}),empty=render({dataset,rows:[],dataState:'loaded'});assert(missing.includes('아직 수집되지'));assert(!missing.includes('등록된 데이터'));assert(empty.includes('등록된 데이터'));assert.equal((empty.match(/<th scope=/g)||[]).length,9);
 }
});
test('daily kind popup selects only observed sales and reopening resets checks',()=>{
 let state=false,returned;const box={exports:{}};const hookReact={...React,useState:()=>[state,v=>state=v]};const file=path.join(root,'components/ecount/InventoryKindLookup.js');vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module:box,exports:box.exports,require:id=>id==='react'?hookReact:!id.startsWith('.')?require(id):id.endsWith('.css')?styles:id.includes('EcountWorkspaceDialog')?load('components/EcountWorkspaceDialog.js'):load('components/ecount/ObservedPageControls.js')});
 const all=e=>!e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];const tree=()=>box.exports.default({onClose(){},onApply:v=>returned=v});const first=tree();assert.equal(first.props.lookupVariant,'kind');assert.equal(first.props.titleCloseDisabled,true);assert.equal(first.props.footerActions.props.disabled,true);const inputs=all(first).filter(e=>e.type==='input');assert.equal(inputs.filter(e=>!e.props.disabled).length,1);const sales=inputs.find(e=>e.props['aria-label']==='판매');assert.equal(sales.props['data-ecount-action-id'],'E040708-A31');sales.props.onChange({target:{checked:true}});const selected=tree();assert.equal(selected.props.footerActions.props.disabled,false);selected.props.footerActions.props.onClick();assert.equal(returned[0],'판매');state=false;assert.equal(tree().props.footerActions.props.disabled,true);assert.equal(all(first).filter(e=>e.type==='tr').length,35);
});
test('daily print preserves open on arrow and Escape but F3 search closes it',()=>{
 let state=false,effects=[],handler;const box={exports:{}};const hookReact={...React,useState:()=>[state,v=>state=v],useEffect:fn=>effects.push(fn)};const file=path.join(root,'components/ecount/InventoryDailyPageControls.js');vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module:box,exports:box.exports,require:id=>id==='react'?hookReact:!id.startsWith('.')?require(id):id.endsWith('.css')?styles:id.includes('ObservedDateWidget')?load('components/ecount/ObservedDateWidget.js'):load('components/ecount/ObservedPageControls.js'),document:{addEventListener:(name,fn)=>handler=fn,removeEventListener(){}}});const all=e=>!e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(all)];function tree(searchOpen=false){effects=[];const t=box.exports.InventoryDailyFooter({busy:false,searchOpen});effects.forEach(fn=>fn());return t;}const arrow=t=>all(t).find(e=>e.props?.['aria-label']==='인쇄 드롭다운');arrow(tree()).props.onClick();assert.equal(state,true);const opened=tree();assert.deepEqual(all(opened).filter(e=>e.props?.role==='menuitem').map(e=>e.props.children),['PDF','미리보기']);arrow(opened).props.onClick();assert.equal(state,true);handler({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(state,true);tree(true);assert.equal(state,false);
});
