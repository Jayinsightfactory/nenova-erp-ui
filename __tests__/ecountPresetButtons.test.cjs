'use strict';
// 2026-10-21 조사 라벨 중 datePreset 으로 매핑되는 간편검색 프리셋 버튼이 각 검색 패널 SSR 에서 활성(disabled 아님)이고
// data-ecount-action-id 가 기존 actionId(dataset,label,context) 값인지, 미관측·미매핑 라벨은 비활성 자리표시로 남는지 확인한다.
// 원본 ECOUNT 조회 결과 동일성은 검증하지 않는다(라벨 존재와 날짜 계산만 근거).
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
const survey=require('../lib/ecountPresetSurvey.cjs');
const pageActions=require('../lib/ecountPageActions.cjs');
const observed=load('components/ecount/ObservedPageControls.js');
const noop=()=>{};
const base={busy:false,from:'2026-10-01',to:'2026-10-21',asOf:'2026-10-21',flow:'',query:'',kinds:[],warehouseCodes:[],canQuery:true,mode:'detail',productCode:'P-1',inputRef:{current:null},onFrom:noop,onTo:noop,onDate:noop,onSubmit:noop,onFlow:noop,onQuery:noop,onCustomer:noop,onMode:noop,onKinds:noop,onProduct:noop,onWarehouse:noop,onConditionLookup:noop};
// [program, dataset, module, export, extra props, action id context]
const PANELS=[
  ['E010701','journal','JournalPageControls','JournalSearchPanel',{}],
  ['E010205','cash','ObservedPageControls','SearchPanel',{dataset:'cash'},'unknown'],
  ['E040214','ar','ObservedPageControls','SearchPanel',{dataset:'ar'}],
  ['E040309','ap','ObservedPageControls','SearchPanel',{dataset:'ap'}],
  ['E040207','sales','ObservedPageControls','SearchPanel',{dataset:'sales'},'unknown'],
  ['E040202','quote','QuotePageControls','QuoteSearchPanel',{},'unknown'],
  ['E040304','purchase','PurchasePageControls','PurchaseSearchPanel',{}],
  ['E040305','buyStatus','PurchaseStatusPageControls','PurchaseStatusSearchPanel',{}],
  ['E040302','poQuery','PurchaseOrderPageControls','PurchaseOrderSearchPanel',{}],
  ['E040217','receipt','SettlementPageControls','SettlementSearchPanel',{dataset:'receipt'}],
  ['E040310','payment','SettlementPageControls','SettlementSearchPanel',{dataset:'payment'}],
  ['E040216','discount','DiscountPageControls','DiscountSearchPanel',{dataset:'discount'}],
  ['E040313','buyDisc','DiscountPageControls','DiscountSearchPanel',{dataset:'buyDisc'}],
  ['E040206','saleQuery','SaleQueryPageControls','SaleQuerySearchPanel',{}],
  ['E040212','unsold','UnfulfilledPageControls','UnfulfilledSearchPanel',{dataset:'unsold'}],
  ['E040307','unbought','UnfulfilledPageControls','UnfulfilledSearchPanel',{dataset:'unbought'}],
  ['E040208','quoteStat','QuoteStatusPageControls','QuoteStatusSearchPanel',{}],
  ['E040204','orderQuery','OrderQueryPageControls','OrderQuerySearchPanel',{}],
  ['E040209','orderStat','OrderStatusPageControls','OrderStatusSearchPanel',{}],
  ['E040306','poStat','PoStatusPageControls','PoStatusSearchPanel',{}],
  ['E040609','unpSale','UnpostedSalesPageControls','UnpostedSalesSearchPanel',{mode:'date_range'}],
  ['E040708','daySale','InventoryDailyPageControls','InventoryDailySearchPanel',{}],
  ['E040218','salesTax','TaxSearchPanel','TaxSearchPanel',{dataset:'salesTax'}],
  ['E040219','buyTax','TaxSearchPanel','TaxSearchPanel',{dataset:'buyTax'}],
  ['E040223','taxStat','SalesTaxStatusPageControls','SalesTaxStatusSearchPanel',{dataset:'taxStat'}],
  ['E040320','buyTaxStat','PurchaseTaxStatusPageControls','PurchaseTaxStatusSearchPanel',{}],
  ['E040701','stock','StockStatusPageControls','StockSearchPanel',{}],
  ['E040711','whStock','WarehouseStockPageControls','WarehouseStockSearchPanel',{mode:'horizontal'}],
  ['E040719','stockMove','StockMovementPageControls','StockMovementSearchPanel',{}],
  ['E040702','stkLedger','StockLedgerPageControls','StockLedgerSearchPanel',{}],
  ['E040727','stkBalance','StockBalancePageControls','StockBalanceSearchPanel',{}],
  ['E040726','bomStock','BomStockPageControls','BomStockSearchPanel',{}],
  ['E040728','relStock','RelationStockPageControls','RelationStockSearchPanel',{}],
];
const DATE_LABELS=new Set([...Object.keys(pageActions.OBSERVED_PRESET_LABELS),...pageActions.KNOWN_UNVERIFIED_PRESET_LABELS]);
const RESET=new Set(survey.RESET_LABELS);
function buttons(html){
  const found=[];const re=/<button([^>]*)>([^<]*)<\/button>/g;let m;
  while((m=re.exec(html))){const attrs=m[1];const id=/data-ecount-action-id="([^"]*)"/.exec(attrs);found.push({label:m[2],disabled:/\sdisabled(=""|\s|$)/.test(attrs+' '),id:id?id[1]:undefined});}
  return found;
}
function render(panel,extra={}){
  const [program,dataset,module,name,props]=panel;
  const Component=(module==='ObservedPageControls'?observed:load(`components/ecount/${module}.js`))[name];
  assert.equal(typeof Component,'function',`${program} ${name}`);
  const presets=survey.enabledPresetLabels(program);
  const onReset=survey.resetObserved(program)?noop:undefined;
  return {html:renderToStaticMarkup(React.createElement(Component,{...base,...props,presets,onPreset:noop,onReset,...extra})),presets,onReset,dataset,program};
}
const summary=[];
test('survey-mapped preset buttons are enabled with their observed action ids; unobserved labels stay disabled placeholders',()=>{
  let activeTotal=0;
  for(const panel of PANELS){
    const context=panel[5]||'검색 패널';
    const {html,presets,onReset,dataset,program}=render(panel);
    const rendered=buttons(html).filter(button=>DATE_LABELS.has(button.label));
    assert.ok(rendered.length,`${program}: no preset buttons rendered`);
    const active=[];
    for(const button of rendered){
      const expectActive=RESET.has(button.label)?!!onReset:presets.includes(button.label);
      assert.equal(!button.disabled,expectActive,`${program}/${dataset} ${button.label} enabled=${!button.disabled}`);
      if(!expectActive)continue;
      const expectedId=observed.actionId(dataset,button.label,context);
      assert.equal(button.id,expectedId,`${program}/${dataset} ${button.label} action id`);
      active.push(button.label+(expectedId?'':'(no-id)'));
    }
    // Labels that exist in a panel and were observed must all be active; labels observed but not rendered are listed for the report only.
    const labelsInPanel=new Set(rendered.map(button=>button.label));
    const notRendered=presets.filter(label=>!labelsInPanel.has(label));
    activeTotal+=active.length;
    summary.push({program,dataset,active,notRendered});
  }
  console.log('ACTIVE_PRESET_BUTTONS_TOTAL',activeTotal);
  for(const row of summary)console.log('ACTIVE',row.program,row.dataset,row.active.length,row.active.join(','),row.notRendered.length?'| not rendered: '+row.notRendered.join(','):'');
  assert.equal(summary.length,33);
  // Pinned so a survey or panel change that silently drops/adds an active button fails here (218 = 33 panels, 2026-10-21 survey).
  assert.equal(activeTotal,218);
});
test('without survey props every preset stays a disabled placeholder and nothing crashes',()=>{
  for(const panel of PANELS){
    const [program,dataset,module,name,props]=panel;
    const Component=(module==='ObservedPageControls'?observed:load(`components/ecount/${module}.js`))[name];
    const html=renderToStaticMarkup(React.createElement(Component,{...base,...props}));
    for(const button of buttons(html).filter(button=>DATE_LABELS.has(button.label)))assert.ok(button.disabled,`${program}/${dataset} ${button.label} should be disabled without presets`);
  }
});
test('mode-gated panels keep presets disabled outside the observed detail/date-range mode',()=>{
  const gated=PANELS.filter(panel=>['quoteStat','orderStat','poStat','unpSale'].includes(panel[1]));
  for(const panel of gated){
    const extra=panel[1]==='unpSale'?{mode:'business_cycle'}:{mode:'aggregate'};
    const {html,presets,program}=render(panel,extra);
    for(const button of buttons(html).filter(button=>presets.includes(button.label)))assert.ok(button.disabled,`${program} ${button.label} must be disabled in ${extra.mode}`);
  }
  for(const panel of PANELS.filter(panel=>['taxStat','buyTaxStat','buyTax'].includes(panel[1]))){
    const {html,presets,program}=render(panel,{canQuery:false});
    for(const button of buttons(html).filter(button=>presets.includes(button.label)))assert.ok(button.disabled,`${program} ${button.label} must be disabled before data is collected`);
  }
});
test('read-only period panels show the draft dates and keep 검색(F8) as a placeholder',()=>{
  for(const panel of PANELS.filter(panel=>['discount','buyDisc','unsold','unbought','orderQuery'].includes(panel[1]))){
    const {html,program}=render(panel,{from:'2026-09-01',to:'2026-09-30'});
    assert.match(html,/aria-label="조회 시작일"[^>]*value="2026-09-01"/,program);
    assert.match(html,/aria-label="조회 종료일"[^>]*value="2026-09-30"/,program);
    const search=buttons(html).find(button=>button.label==='검색(F8)');
    assert.ok(search&&search.disabled,`${program} 검색(F8) placeholder`);
  }
  for(const dataset of ['ar','ap']){
    const {html}=render(PANELS.find(panel=>panel[1]===dataset));
    assert.match(html,/aria-label="조회 시작일"/,dataset);
    assert.match(html,/aria-label="조회 종료일"/,dataset);
    assert.ok(html.includes('조회 자료에 일자가 없어 기간 조건은 표시만 적용됩니다.'),dataset);
  }
});
test('presetButtons helper: reset needs onReset, preset needs onPreset and an enabled label, ids follow dataset/context',()=>{
  const html=renderToStaticMarkup(React.createElement(React.Fragment,null,observed.presetButtons({dataset:'journal',labels:['금일','이번기수','설정','다시작성'],enabled:['금일'],onPreset:noop,onReset:noop})));
  const list=buttons(html);
  assert.deepEqual(list.map(button=>[button.label,button.disabled,button.id]),[['금일',false,'E010701-A10'],['이번기수',true,'E010701-A16'],['설정',true,undefined],['다시작성',false,'E010701-A17']]);
  const none=buttons(renderToStaticMarkup(React.createElement(React.Fragment,null,observed.presetButtons({dataset:'journal',labels:['금일','다시작성'],enabled:['금일']}))));
  assert.deepEqual(none.map(button=>button.disabled),[true,true]);
  const busy=buttons(renderToStaticMarkup(React.createElement(React.Fragment,null,observed.presetButtons({dataset:'journal',labels:['금일'],enabled:['금일'],onPreset:noop,busy:true}))));
  assert.equal(busy[0].disabled,true);
});
