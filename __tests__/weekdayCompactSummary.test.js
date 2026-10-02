import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as helper from '../lib/weekdayHorizontalMatrix.js';
import { SHIPPING_DAYS, shiftDate } from '../lib/weekdayEstimateCycle.js';

// Use the installed native compiler: no server, compiler download, network or ERP access.
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const filename = fileURLToPath(new URL('../components/WeekdayCycleMatrix.js', import.meta.url));
const source = readFileSync(filename, 'utf8');
const compiled = transformSync(source + '\nexport { CompactSummary, SummaryDetails, ConfirmationBadges };', false,
  Buffer.from(JSON.stringify({ filename, jsc: { target:'es2020', parser:{syntax:'ecmascript',jsx:true},
    transform:{react:{runtime:'automatic'}} }, module:{type:'commonjs'} })));
const componentRequire = createRequire(filename);
const load = (react = React) => {
  const mod = {exports:{}};
  new Function('require','module','exports',compiled.code)(name => name === 'react' ? react
    : name.includes('weekdayHorizontalMatrix') ? helper : componentRequire(name), mod, mod.exports);
  return mod.exports;
};
const {default:Matrix, CompactSummary, ConfirmationBadges} = load();
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const cycles = [-1,0,1].map(offset => ({offset,year:2026,majorWeek:String(38+offset),calendarState:'FOUND',
  startDate:shiftDate('2026-09-17',offset*7),endDate:shiftDate('2026-09-17',offset*7+6),
  days:SHIPPING_DAYS.map((day,index)=>({...day,date:shiftDate('2026-09-17',offset*7+index),
    orderWeek:`${38+offset}-${day.suffix}`,calendarState:'FOUND'}))}));
const actual = {year:2026,orderWeek:'38-01',custKey:7,prodKey:101,prodName:'CARNATION Blue',
  flowerName:'카네이션',outUnit:'박스',fixed:true,shipmentOutQuantity:1.2,
  packaging:{bunchOf1Box:15,steamOf1Bunch:20,steamOf1Box:300},
  shipmentDates:[{date:'2026-09-17',shipmentQuantity:1.2}]};
const draft = {id:'compact-draft',year:2026,orderWeek:'38-01',custKey:7,prodKey:101,
  prodName:actual.prodName,unit:'박스',date:'2026-09-17',quantity:1,
  sourceYear:2026,sourceOrderWeek:'39-01'};
const baseline = suffix => ({year:2026,orderWeek:`38-${suffix}`,rows:[{prodKey:101,unit:'박스',
  quantity:suffix==='01'?1.2:0,shipmentDates:suffix==='01'?[{date:'2026-09-17',quantity:1.2}]:[]}]});
const comparisons = [actual,{...actual,orderWeek:'38-02',shipmentOutQuantity:0,shipmentDates:[]}];
const props = {cycles,comparisonRows:comparisons,plans:[draft],baselines:[baseline('01'),baseline('02')],
  customer:{CustKey:7},onEditCell(){},onPrint(){}};
const snapshot = JSON.stringify(props);
let html = render(Matrix,props);
assert.equal(JSON.stringify(props),snapshot,'display never mutates raw quantity/baseline/draft inputs');
assert.equal((html.match(/class="wcm-compact-summary"/g)||[]).length,3);
assert.equal((html.match(/class="wcm-summary-row /g)||[]).length,9,'exactly three stable rows per cycle');
assert.match(html,/data-wcm-label="sum" data-quantity="1"/,'sum uses validated draft projection');
assert.match(html,/data-wcm-label="remainder" data-quantity="0.2"/,'draft remainder preserves calculation');
assert.match(html,/1박스/); assert.match(html,/3단/,'unit decomposition is retained');
assert.match(html,/미적용 초안 수량/); assert.match(html,/wcm-original/);
assert.match(html,/aria-haspopup="dialog" aria-expanded="false"/);
assert.match(html,/01 잔량 내역/); assert.match(html,/기준 확정/);
assert.match(render(Matrix,{...props,baselines:[]}),/aria-label="2026\/38-01 최초분배 확정"/,'baseline accessible name remains stable');
assert.match(source,/font-size:14px; line-height:1.4/,'default data font is at least14');
assert.match(source,/wcm-number-display \{[^\n]*text-align:center; font-size:16px; font-weight:700/);
assert.match(source,/wcm-cell input \{[^\n]*text-align:center; font-size:16px; font-weight:700/);
assert.match(source,/wcm-cell-detail \{[^\n]*justify-content:center/);
assert.match(source,/wcm-original \{[^\n]*justify-content:center/);
assert.match(source,/grid-template-columns:36px minmax\(0,1fr\)/);
assert.match(source,/max-block-size:min\(60vh,500px\)/);
assert.match(source,/width:min\(600px,calc\(100vw - 32px\)\)/);
assert.match(source,/wcm-selected \{[^\n]*font-size:16px; line-height:1.5/);
assert.match(source,/wcm-detail-popover \{[^\n]*font-size:16px; line-height:1.5/);
assert.match(html,/요일표 상단 가로 스크롤/); assert.match(html,/요일표 하단 가로 스크롤/);
assert.match(source,/tbody tr:is\(:hover,:focus-within\)/);
assert.doesNotMatch(source,/\bfetch\s*\(|width:1920px|height:1080px/);

const category = {countryFlower:'콜롬비아장미',state:'FIXED',fixedCount:12,totalCount:12,
  unknownCount:0,orderWeeks:['38-01','38-02','38-03']};
const confirmation = {year:2026,majorWeek:'38',state:'FIXED',allCustomers:true,categories:[category]};
const badges = (states=[confirmation],patch={})=>render(ConfirmationBadges,{cycle:cycles[1],states,...patch});
html=badges();
assert.match(html,/콜 장미 ✓/);
assert.match(html,/콜롬비아장미 · ERP확정/);
assert.match(html,/전체 거래처·대차수 범위/); assert.match(html,/선택 거래처\/화면 필터와 무관/);
assert.match(html,/확정 12 \/ 전체 12건/); assert.match(html,/38-01, 38-02, 38-03/);
assert.match(html,/ERP 출고 상세 확정 · 재고 마감\/인쇄 완전성과 별개/);
for(const state of ['PARTIAL','UNFIXED','EMPTY','UNKNOWN']) {
  html=badges([{...confirmation,state,categories:[{...category,state}]}]);
  assert.doesNotMatch(html,/wcm-fixed|✓/);
  assert.match(html,/(?:부분|미확정|자료 없음|미확인)/);
  if(['PARTIAL','UNFIXED'].includes(state))assert.match(html,/미확정 물량은 견적에서 제외/);
}
for(const states of [[],null,[{...confirmation,year:2025}],[{...confirmation,majorWeek:'39'}],
  [confirmation,confirmation],[{...confirmation,allCustomers:false}]]) {
  assert.match(badges(states),/ERP확정 미확인/);
  assert.doesNotMatch(badges(states),/wcm-fixed|✓/,'absent/ambiguous/cross-year state is not confirmed');
}
assert.doesNotMatch(badges([confirmation],{busy:true}),/wcm-fixed|✓/);
assert.doesNotMatch(badges([confirmation],{error:'other cycle query failed'}),/조회 실패/);
assert.match(badges([{...confirmation,error:'fixture query failed'}]),/조회 실패/);
assert.doesNotMatch(badges([{...confirmation,error:'fixture query failed'}]),/wcm-fixed|✓/);
assert.match(badges([confirmation],{error:'other cycle query failed'}),/wcm-fixed|✓/);
const fixedMatrix=render(Matrix,{...props,confirmationStates:[confirmation]});
assert.match(fixedMatrix,/<strong>현재 2026 \/ 38차<\/strong><span class="wcm-confirmations"/,'badges adjacent to cycle title');
const printButtons=markup=>[...markup.matchAll(/<button[^>]*aria-label="(?:전체 견적|선택요일 출력[^" ]*[^\"]*|\d+차 [^" ]+ 견적 출력)"[^>]*>/g)].map(match=>match[0]);
assert.deepEqual(printButtons(fixedMatrix),printButtons(render(Matrix,props)),'confirmation is display-only, not a new print gate');
assert.match(render(Matrix,{...props,confirmationError:'fixture query failed'}),/role="alert">ERP확정 조회 실패/);
assert.doesNotMatch(render(Matrix,{...props,confirmationStates:[]}),/ERP확정 · 콜롬비아장미/,'fixed visible rows never infer category status');

const row=helper.buildHorizontalWeekdayMatrix(cycles,[draft],comparisons,props.baselines).rows[0];
const block={...row.blocks[1],quote:{state:'견적 불일치',managementQuantity:23,netQuantity:22,unit:'송이',amount:12000},
  pageNote:{note:'수동 비고 근거'},carryover:{active:true,incoming:-2,manual:true,provisional:true,
    hasDraft:true,incomingHasDraft:true,incomingProvisional:true,source:{year:2026,majorWeek:'37'}}};
const record={year:2026,majorWeek:'38',custKey:7,prodKey:101,quantity:0};
const events=[];
const summaryProps={row,block,disabled:false,carryover:{records:[record]},hasCustomer:true,customer:{CustKey:7},
  onOpenCarryover:value=>events.push(['closing',value]),onOpenNote:value=>events.push(['note',value]),onSelect:value=>events.push(['quote',value])};
html=render(CompactSummary,summaryProps);
assert.match(html,/이월 /); assert.match(html,/-2/); assert.match(html,/수동/); assert.match(html,/미확정/);
assert.match(html,/이월 초안/); assert.match(html,/이월 미확정/); assert.match(html,/불일치 !/);
assert.match(html,/data-quantity="23"/); assert.match(html,/수동 비고 근거/);
assert.doesNotMatch(html,/>이월 미등록</,'benign unregistered carry is not a visible repeated row');
const nodes = element=>!element || typeof element!=='object'?[]:[element,...React.Children.toArray(element.props?.children).flatMap(nodes)];
const tree=CompactSummary(summaryProps);
const buttons=nodes(tree).filter(node=>node.type==='button');
const trigger={focus(){}};
buttons.find(button=>button.props['data-wcm-label']==='remainder').props.onClick({currentTarget:trigger});
buttons.find(button=>button.props.className.includes('wcm-change-note')).props.onClick();
buttons.find(button=>button.props.className.includes('wcm-quote')).props.onClick();
assert.equal(events[0][1].record,record); assert.equal(events[0][1].trigger,trigger);
assert.equal(events[0][1].row,row); assert.equal(events[0][1].block,block);
assert.deepEqual(events[1],['note',{row,block}]); assert.match(events[2][1],/견적관리 23 \/ 인쇄 22/);
assert.match(render(CompactSummary,{...summaryProps,carryoverError:'fixture carry error'}),/role="alert">이월 조회 실패/);
assert.match(render(CompactSummary,{...summaryProps,block:{...block,quote:{state:'조회 필요',error:'fixture quote error'}}}),/role="alert">견적 조회 실패/);
assert.ok(nodes(CompactSummary({...summaryProps,carryoverBusy:true})).find(node=>node.props?.['data-wcm-label']==='remainder').props.disabled);

// Execute the actual popover handlers with a small hook host, including focus return.
const slots=[]; let index=0; let effects=[];
const harness={...React,useState(initial){const i=index++; if(!(i in slots))slots[i]=initial; return [slots[i],value=>{slots[i]=value;}];},
  useRef(initial){const i=index++; if(!(i in slots))slots[i]={current:initial}; return slots[i];},
  useEffect(effect){effects.push(effect);}};
const Details=load(harness).SummaryDetails;
let focused='';
const detailsProps={label:'fixture 요약 내역',description:'미확정·초안\n저장 기준 0 · ERP 재고 아님'};
const draw=()=>{index=0;effects=[];const tree=Details(detailsProps);for(const node of nodes(tree)) {
  if(node.ref)node.ref.current={focus(){focused=node.type==='button'?'trigger':'dialog';}};
} effects.forEach(effect=>effect());return tree;};
let view=draw();
nodes(view).find(node=>node.type==='button').props.onClick();view=draw();
assert.equal(focused,'dialog'); assert.match(renderToStaticMarkup(view),/role="dialog" aria-modal="false"/);
assert.match(renderToStaticMarkup(view),/aria-expanded="true"/); assert.match(renderToStaticMarkup(view),/저장 기준 0/);
let prevented=false;
nodes(view).find(node=>node.props?.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){}});
assert.ok(prevented); assert.equal(focused,'trigger'); assert.doesNotMatch(renderToStaticMarkup(draw()),/role="dialog"/);
nodes(draw()).find(node=>node.type==='button').props.onClick();view=draw();
nodes(view).find(node=>node.type==='button' && node.props['aria-label']==='fixture 요약 내역 닫기').props.onClick();
assert.equal(focused,'trigger'); assert.match(renderToStaticMarkup(draw()),/aria-expanded="false"/);

const thirteenNames=['콜롬비아장미','콜롬비아수국','콜롬비아카네이션','콜롬비아알스트로','콜롬비아국화',
  '네덜란드장미','네덜란드수국','네덜란드튤립','중국국화','베트남장미','에콰도르장미','태국난','호주왁스'];
const thirteen=thirteenNames.map((countryFlower,i)=>({...category,countryFlower,state:i===1?'UNFIXED':'FIXED'}));
const many=badges([{...confirmation,state:'PARTIAL',categories:thirteen}]);
assert.equal((many.match(/aria-label="2026\/38차 · 전체 거래처·대차수 범위/g)||[]).length,14,'13 categories and one scope group');
for(const countryFlower of thirteenNames) assert.ok(many.includes(countryFlower),'full category identity remains in title/aria');
assert.match(many,/콜 수국 미확정 !/);assert.match(many,/네덜 튤립 ✓/);
assert.doesNotMatch(many,/>ERP확정 ·/,'category chips do not repeat ERP prefix');

console.log('Weekday compact summary: SSR three-row density, centered16px quantities, accessible16px popover/focus, authoritative13-category all-customer badges, year/scope/error/empty guards, draft/raw conversions, handler/print preservation passed');
