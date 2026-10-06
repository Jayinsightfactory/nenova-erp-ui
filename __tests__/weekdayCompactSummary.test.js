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
const compiled = transformSync(source + '\nexport { CompactSummary, SummaryDetails, ConfirmationBadges, WilsonCell, QuantityCell, displayCycleColumns };', false,
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
assert.equal((html.match(/class="wcm-compact-summary"/g)||[]).length,9);
assert.equal((html.match(/<td class="wcm-total wcm-major-total(?: [^"]*)?"/g)||[]).length,9,'three actual summary cells per cycle');
assert.equal((html.match(/colspan="18"/gi)||[]).length,3,'cycle spans expanded summary columns');
const crossYearMarkup=render(Matrix,{...props,comparisonRows:[...comparisons,{...actual,year:2025,shipmentOutQuantity:999999,shipmentDates:[{date:'2025-09-17',shipmentQuantity:999999}]}]});
assert.equal((crossYearMarkup.match(/<td class="wcm-total wcm-major-total(?: [^"]*)?"/g)||[]).length,9,'prior-year same-week data does not add summary cells');
assert.match(crossYearMarkup,/data-wcm-label="sum" data-quantity="1"/,'2026 summary preserves its draft projection with a prior-year same-week sentinel');
assert.equal((html.match(/class="wcm-summary-row /g)||[]).length,9,'exactly three stable rows per cycle');
assert.match(html,/data-wcm-label="sum" data-quantity="1"/,'sum uses validated draft projection');
assert.match(html,/data-wcm-label="remainder" data-quantity="0.2"/,'draft remainder preserves calculation');
assert.match(html,/1박스/); assert.match(html,/3단/,'unit decomposition is retained');
assert.match(html,/미적용 초안 수량/); assert.match(html,/wcm-original/);
assert.match(html,/aria-haspopup="dialog" aria-expanded="false"/);
assert.match(html,/01 잔량 내역/); assert.match(html,/기준 확정/);
const quoteError='fixture quote failure: '+('세부 오류 내용 '.repeat(80));
const quoteFailureProps={...props,comparisonRows:[...comparisons,{...actual,prodKey:102,prodName:'CARNATION White'}],
  baselineCandidates:[{year:2026,orderWeek:'38-01'}],
  quoteResults:[{year:2026,majorWeek:'38',error:quoteError}]};
const quoteFailureHtml=render(Matrix,quoteFailureProps);
assert.equal((quoteFailureHtml.match(/견적 조회 실패 · 상세/g)||[]).length,1,'cycle-level quote error is summarized once in its header');
assert.equal((quoteFailureHtml.match(/fixture quote failure:/g)||[]).length,1,'full error content is not copied into product cells');
assert.match(quoteFailureHtml,/<details class="wcm-quote-error"><summary>견적 조회 실패 · 상세<\/summary>/,'header disclosure is collapsed by default');
assert.equal((quoteFailureHtml.match(/aria-label="[^"]+견적 대조 · [^"]+ · 조회 실패"/g)||[]).length,2,'both affected product buttons expose their failure state');
assert.doesNotMatch(quoteFailureHtml,/wcm-error[^>]*role="alert">견적 조회 실패/,'product rows do not contain repeated long quote errors');
const readinessResult=patch=>({year:2026,majorWeek:'38',printReadiness:{scope:'ALL_CUSTOMERS_MAJOR_WEEK',
  positiveCount:0,unfixedCount:0,invalidCount:0,reasons:[],...patch}});
const emptyReadyMarkup=render(Matrix,{...props,plans:[],quoteResults:[readinessResult({})]});
assert.match(emptyReadyMarkup,/분배·확정 후 견적 출력 가능/);
assert.match(emptyReadyMarkup,/저장된 출고 없음 · 입력·분배 적용부터 진행/);
assert.doesNotMatch(emptyReadyMarkup,/견적 조회 실패|<span>실패<\/span>/,'no shipment is an ordinary next-step state');
const waitingMarkup=render(Matrix,{...props,plans:[],quoteResults:[readinessResult({positiveCount:1345,unfixedCount:97})]});
assert.match(waitingMarkup,/확정 대기 97건 · 해당 연도·차수 전체 업체/);
assert.match(waitingMarkup,/href="\/shipment\/fix-status\?popup=1"/);
assert.match(waitingMarkup,/확정 현황에서 2026년 38차를 조회·확정한 뒤 전산 새로고침/);
assert.doesNotMatch(waitingMarkup,/견적 조회 실패|<span>실패<\/span>/,'unfixed rows give actionable scope rather than a network failure');
const invalidMarkup=render(Matrix,{...props,plans:[],quoteResults:[readinessResult({positiveCount:10,invalidCount:2,reasons:['<script>technical link detail</script>']})]});
assert.match(invalidMarkup,/견적 연결 확인 2건 · 상세/);
assert.match(invalidMarkup,/&lt;script&gt;technical link detail&lt;\/script&gt;/);
assert.doesNotMatch(invalidMarkup,/<script>technical/,'diagnostic reasons are safe text');
assert.match(quoteFailureHtml,/data-wcm-label="sum" data-quantity="1"/,'quote error does not change summary quantity');
assert.equal((quoteFailureHtml.match(/aria-label="전체 견적"/g)||[]).length,(html.match(/aria-label="전체 견적"/g)||[]).length,'quote error does not remove existing print actions');
assert.match(quoteFailureHtml,/기준 미확정/,'page baseline preview is distinct from ERP-unfixed labels');
const visibleText=markup=>markup.replace(/<[^>]*>/g,'');
const provisionalMarkup=render(Matrix,{...props,plans:[],baselines:[],
  baselineCandidates:[baseline('01'),baseline('02')].map(record=>({...record,provisional:true}))});
assert.doesNotMatch(visibleText(provisionalMarkup),/기준 미확정|이월 미확정/,'provisional states use cell color without repeated visible labels');
assert.match(provisionalMarkup,/<th[^>]*class="wcm-initial wcm-cycle-start wcm-provisional"/);
assert.match(provisionalMarkup,/<td class="wcm-initial wcm-cycle-start wcm-provisional"/);
assert.match(provisionalMarkup,/<td class="wcm-total wcm-provisional"/,'subweek remainder uses the same provisional cue');
assert.match(provisionalMarkup,/<td class="wcm-total wcm-major-total wcm-provisional"/,'major remainder retains provisional color');
assert.match(provisionalMarkup,/title="기준 미확정/,'accessible detail retains the baseline status');
const unallocatedMarkup=render(Matrix,{...props,plans:[{...draft,quantity:0}],comparisonRows:comparisons.map(item=>({...item,
  state:'NO_SHIPMENT',detailRows:0,shipmentOutQuantity:null,shipmentDates:[]})),baselines:[]});
const bodyText=visibleText(unallocatedMarkup.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'');
assert.match(unallocatedMarkup,/wcm-cell wcm-unallocated/,'known empty quantities have a color class');
assert.doesNotMatch(bodyText,/미분배|기준 미확정/,'unallocated rows have no repeated state text');
assert.match(unallocatedMarkup,/미분배 품목 표시/,'the unallocated row filter remains available');
assert.match(unallocatedMarkup,/미분배 ·/,'unallocated detail remains available in the title');
assert.match(source,/wcm-unallocated:not\(\.wcm-proposed\):not\(\.wcm-changed\):not\(\.wcm-early\)/,'draft, change and early cues take precedence');
assert.match(source,/wcm-provisional:not\(\.wcm-draft\)/,'draft summary styling takes precedence');
assert.match(render(Matrix,{...props,baselines:[]}),/aria-label="2026\/38-01 최초분배 확정"/,'baseline accessible name remains stable');
assert.match(source,/font-size:14px; line-height:1.4/,'default data font is at least14');
assert.match(source,/tbody td \.wcm-quantity-label \{[^\n]*font-size:14px; font-weight:700;[^\n]*text-align:center; justify-content:center/);
assert.match(source,/tbody td \.wcm-cell input \{[^\n]*font-size:14px; font-weight:700;[^\n]*text-align:center/);
assert.match(source,/wcm-early-label \.wcm-quantity-label \{ font-size:14px/);
assert.match(source,/:is\(\.wcm-cell-info,\.wcm-change-note\) \.wcm-quantity-label \{ font-size:14px/);
assert.match(source,/wcm-compact-summary \.wcm-quote \.wcm-quantity-label \{ font-size:14px/);
assert.match(source,/wcm-cell-detail \{[^\n]*justify-content:center/);
assert.match(source,/wcm-original \{[^\n]*justify-content:center/);
assert.match(source,/wcm-summary-row \{ display:flex; flex-direction:column/);
assert.equal((source.match(/width:min\(760px,calc\(100vw - 32px\)\)/g)||[]).length,2);
assert.equal((source.match(/max-block-size:min\(70vh,calc\(100vh - 32px\)\)/g)||[]).length,2);
assert.match(source,/wcm-selected \{[^\n]*font-size:18px; line-height:1.5/);
assert.match(source,/wcm-detail-popover \{[^\n]*font-size:18px; line-height:1.5/);
assert.match(source,/:is\(\.wcm-selected,\.wcm-detail-popover\) strong \{ font-size:20px/);
assert.match(html,/요일표 상단 가로 스크롤/); assert.match(html,/요일표 하단 가로 스크롤/);
assert.match(source,/tbody tr:is\(:hover,:focus-within\)/);
assert.doesNotMatch(source,/\bfetch\s*\(|width:1920px|height:1080px/);
assert.match(source,/table \{ min-width:0/,'table minimum does not inflate compact columns');
assert.match(html,/<table style="width:2642px"/,'three cycles use the sum of actual column widths');
assert.match(render(Matrix,{...props,cycles:[cycles[1]]}),/<table style="width:994px"/,'one cycle stays narrow without three-cycle minimum');
assert.match(source,/wcm-product-col \{ width:170px/);
assert.match(source,/wcm-summary-col \{ width:44px/);
assert.match(source,/wcm-baseline-col, \.weekday-cycle-matrix \.wcm-day-col \{ width:46px/);
assert.match(source,/tbody :is\(th,td\) \{ padding:1px; height:52px/,'rows aim at52px and may grow for long units');
assert.doesNotMatch(source,/\bzoom\s*:|transform\s*:\s*scale\(/,'density uses actual dimensions, not global scaling');
assert.match(source,/wcm-quantity-part \{[^\n]*white-space:normal; overflow-wrap:anywhere/,'long physical units remain visible');
assert.match(source,/wcm-quote-status span \{ white-space:nowrap/,'quote identity and concise state occupy exactly two lines');
assert.match(source,/thead tr:not\(:first-child\) th \{ font-size:10px; line-height:12px/,'dense column headings do not wrap full-size prose');
assert.equal((source.match(/className="wcm-summary-details"/g)||[]).length,1);

const category = {countryFlower:'콜롬비아장미',state:'FIXED',fixedCount:12,totalCount:12,
  warningCount:0,unknownCount:0,orderWeeks:['38-01','38-02','38-03']};
const confirmation = {year:2026,majorWeek:'38',state:'FIXED',allCustomers:true,warningCount:0,unknownCount:0,categories:[category]};
const badgesFor = (cycle,states,patch={})=>render(ConfirmationBadges,{cycle,states,...patch});
const badges = (states=[confirmation],patch={})=>badgesFor(cycles[1],states,patch);
html=badges();
assert.match(html,/콜 장미 ✓/);
assert.match(html,/콜롬비아장미 · ERP확정/);
assert.match(html,/전체 거래처·대차수 전체 세부차수 범위/); assert.match(html,/선택 거래처\/화면 필터와 무관/);
assert.match(html,/확정 12 \/ 전체 12건/); assert.match(html,/38-01, 38-02, 38-03/);
assert.match(html,/ERP 출고 상세 확정 · 저장 가능\/재고 마감\/인쇄 완전성 보장 아님/);
assert.match(html,/wcm-fixed/);
const observed39={...confirmation,majorWeek:'39',state:'FIXED',totalCount:998,fixedCount:998,
  warningCount:606,unknownCount:0,categories:[{...category,totalCount:998,fixedCount:998,warningCount:606,orderWeeks:['39-01','39-02','39-03']}]};
html=badgesFor(cycles[2],[observed39]);
assert.match(html,/ERP확정 ✓ · 연결경고 606건/);
assert.match(html,/콜 장미 확정·연결경고!/);
assert.match(html,/확정 998 \/ 전체 998건 · 연결경고 606건 · 식별불명 0건/);
assert.match(html,/2026\/39차 · 전체 거래처·대차수 전체 세부차수 범위/);
assert.doesNotMatch(html,/wcm-fixed/,'fixed with linkage warnings must not look only green');
assert.match(html,/wcm-warning/);
const observed40={...confirmation,majorWeek:'40',state:'PARTIAL',totalCount:1106,fixedCount:334,
  warningCount:318,unknownCount:0,categories:[{...category,state:'PARTIAL',totalCount:1106,fixedCount:334,warningCount:318,orderWeeks:['40-01','40-02']}]};
html=badgesFor({...cycles[1],majorWeek:'40'},[observed40]);
assert.match(html,/ERP부분확정 · 연결경고 318건/);
assert.match(html,/확정 334 \/ 전체 1106건 · 연결경고 318건 · 식별불명 0건/);
assert.match(html,/2026\/40차 · 전체 거래처·대차수 전체 세부차수 범위/);
assert.doesNotMatch(html,/ERP확정 미확인|미확인 \?/,'known category remains partial despite linkage warnings');
html=badges([{...confirmation,state:'UNKNOWN',unknownCount:1,categories:[
  {countryFlower:null,state:'UNKNOWN',fixedCount:0,totalCount:1,warningCount:0,unknownCount:1,orderWeeks:['38-01']}]}]);
assert.match(html,/품종 미확인 미확인 \?/);
assert.match(html,/식별불명 1건/);
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
assert.match(fixedMatrix,/<strong>현재 2026 \/ 38차<\/strong><details class="wcm-confirmation-disclosure"><summary>ERP 확정 상세 · ERP확정/,'collapsed confirmation retains authoritative summary beside cycle title');
const printButtons=markup=>[...markup.matchAll(/<button[^>]*aria-label="(?:전체 견적|선택요일 출력[^" ]*[^\"]*|\d+차 [^" ]+ 견적 출력)"[^>]*>/g)].map(match=>match[0]);
assert.deepEqual(printButtons(fixedMatrix),printButtons(render(Matrix,props)),'confirmation is display-only, not a new print gate');
assert.match(render(Matrix,{...props,confirmationError:'fixture query failed'}),/role="alert">ERP확정 조회 실패/);
assert.doesNotMatch(render(Matrix,{...props,confirmationStates:[]}),/ERP확정 · 콜롬비아장미/,'fixed visible rows never infer category status');

const row=helper.buildHorizontalWeekdayMatrix(cycles,[draft],comparisons,props.baselines).rows[0];
const block={...row.blocks[1],quote:{state:'견적 불일치',managementQuantity:23,netQuantity:22,unit:'송이',amount:12000},
  remainderMajorView:{...row.blocks[1].remainderMajorView,hasProvisional:true,label:'미확정 예상'},
  pageNote:{note:'수동 비고 근거'},carryover:{active:true,incoming:-2,manual:true,provisional:true,
    hasDraft:true,incomingHasDraft:true,incomingProvisional:true,source:{year:2026,majorWeek:'37'}}};
const record={year:2026,majorWeek:'38',custKey:7,prodKey:101,quantity:0};
const events=[];
const summaryProps={row,block,disabled:false,carryover:{records:[record]},hasCustomer:true,customer:{CustKey:7},
  onOpenCarryover:value=>events.push(['closing',value]),onOpenNote:value=>events.push(['note',value]),onSelect:value=>events.push(['quote',value])};
html=render(CompactSummary,summaryProps);
assert.match(html,/이월 /); assert.match(html,/-2/); assert.match(html,/수동/); assert.match(html,/미확정/);
assert.match(html,/이월 초안/); assert.doesNotMatch(visibleText(html),/이월 미확정|기준 미확정/); assert.match(html,/이월 미확정/); assert.match(html,/기준 미확정/); assert.match(html,/<span>불일치<\/span>/);
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
const failedQuoteBlock={...block,quote:{state:'조회 필요',error:quoteError}};
const failedQuoteTree=CompactSummary({...summaryProps,block:failedQuoteBlock});
const failedQuoteButton=nodes(failedQuoteTree).find(node=>node.type==='button'&&node.props.className.includes('wcm-quote'));
assert.match(renderToStaticMarkup(failedQuoteButton),/<span>견적<\/span><span>실패<\/span>/,'failed quote displays its state in exactly two compact lines');
failedQuoteButton.props.onClick();
assert.match(events.at(-1)[1],/상태: 조회 필요[\s\S]*오류: fixture quote failure:/,'failed quote click sends exact state and full error to selectedInfo');
assert.match(render(CompactSummary,{...summaryProps,carryoverError:'fixture carry error'}),/role="alert"><button[^>]*이월 확인[^>]*>!<\/button>/);
const failedQuoteMarkup=render(CompactSummary,{...summaryProps,block:{...block,quote:{state:'조회 필요',error:'fixture quote error'}}});
assert.match(failedQuoteMarkup,/<span>실패<\/span>/,'quote error remains visible in the item button');
assert.doesNotMatch(failedQuoteMarkup,/wcm-error[^>]*role="alert">견적 조회 실패/,'full quote error is not rendered as a repeated cell alert');
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
assert.equal((many.match(/aria-label="2026\/38차 · 전체 거래처·대차수 전체 세부차수 범위/g)||[]).length,14,'13 categories and one scope group');
for(const countryFlower of thirteenNames) assert.ok(many.includes(countryFlower),'full category identity remains in title/aria');
assert.match(many,/콜 수국 미확정 !/);assert.match(many,/네덜 튤립 ✓/);
assert.doesNotMatch(many,/>ERP확정 ·/,'category chips do not repeat ERP prefix');

console.log('Weekday compact summary: actual column density, centered14px quantities, dynamic one/three-cycle widths, accessible760px/18px popover and focus, fixed/partial linkage warnings, unknown category, scope/error guards, draft/raw conversions, handler/print preservation passed');

// Wilson splits remain web metadata; only one canonical ERP quantity is edited.
const sunday={...actual,shipmentOutQuantity:10,shipmentDates:[{date:'2026-09-20',shipmentQuantity:10}]};
const wilsonRecord={year:2026,majorWeek:'38',orderWeek:'38-01',custKey:7,prodKey:101,date:'2026-09-20',unit:'박스',expectedTotal:10,wilsonQuantity:2,status:'CURRENT'};
const wilsonMarkup=render(Matrix,{...props,plans:[],comparisonRows:[sunday],wilsonRecords:[wilsonRecord],onEditWilson(){}});
assert.match(wilsonMarkup,/aria-label="윌슨 구분 요일"/);
assert.match(wilsonMarkup,/aria-label="CARNATION Blue 2026\/38-01 2026-09-20 미적용 초안 수량"[^>]*value="8"/,'general quantity derives from canonical total minus Wilson');
assert.match(wilsonMarkup,/aria-label="CARNATION Blue 2026-09-20 윌슨 수량"[^>]*value="2"/);
assert.match(wilsonMarkup,/data-wcm-label="sum" data-quantity="10"/,'major total never adds Wilson a second time');
assert.match(wilsonMarkup,/일반·윌슨 합계 내역/);
const staleMarkup=render(Matrix,{...props,plans:[],comparisonRows:[sunday],wilsonRecords:[{...wilsonRecord,expectedTotal:9,status:'STALE'}],onEditWilson(){}});
assert.match(staleMarkup,/윌슨 재확인/);
assert.match(staleMarkup,/<input(?=[^>]*aria-label="CARNATION Blue 2026\/38-01 2026-09-20 미적용 초안 수량")(?=[^>]*disabled="")[^>]*>/,'stale split blocks general editing');
const Wilson=load(harness).WilsonCell;
const wilsonEvents=[];
const wprops={row,block,day:{date:'2026-09-20',editDisabledReason:''},split:{savedTotal:10,savedWilson:2,total:10,wilson:2,error:'',draft:false},disabled:false,onEditWilson:async value=>{wilsonEvents.push(value);return true;},onSelect(){}};
const wdraw=patch=>{index=0;effects=[];return Wilson({...wprops,...patch});};
slots.length=0;
let wview=wdraw();
await nodes(wview).find(node=>node.type==='input').props.onBlur();
assert.equal(wilsonEvents.length,0,'focus and blur without input never invents a zero draft');
nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:'5'}});
wview=wdraw();await nodes(wview).find(node=>node.type==='input').props.onBlur();
assert.equal(wilsonEvents.at(-1).quantity,5);assert.equal(wilsonEvents.at(-1).totalQuantity,13,'ordinary Wilson edit preserves general 8 and yields canonical13');
slots.length=0;
wview=wdraw();nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:'4'}});wview=wdraw();
await nodes(wview).find(node=>node.type==='button').props.onClick();
assert.equal(wilsonEvents.at(-1).quantity,4);assert.equal(wilsonEvents.at(-1).totalQuantity,10,'classification-only action preserves saved canonical total');assert.equal(wilsonEvents.at(-1).classificationOnly,true);
slots.length=0;
const staleProps={split:{...wprops.split,wilson:null,error:'ERP changed'}};
wview=wdraw(staleProps);assert.equal(nodes(wview).find(node=>node.type==='input').props.disabled,false,'stale split allows entering a quantity for explicit reclassification');
nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:'3'}});wview=wdraw(staleProps);
const before=wilsonEvents.length;await nodes(wview).find(node=>node.type==='input').props.onBlur();assert.equal(wilsonEvents.length,before,'stale regular blur never changes ERP canonical total');
await nodes(wview).find(node=>node.type==='button').props.onClick();assert.equal(wilsonEvents.at(-1).totalQuantity,10);assert.equal(wilsonEvents.at(-1).quantity,3);
slots.length=0;
wview=wdraw();nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:'11'}});wview=wdraw();const count=wilsonEvents.length;
await nodes(wview).find(node=>node.type==='button').props.onClick();assert.equal(wilsonEvents.length,count,'classification exceeding stored total is rejected');assert.match(renderToStaticMarkup(wdraw()),/role="alert"/);
console.log('Wilson UI canonical total, split rendering, stale editing and classification-only handlers passed');
slots.length=0;
const emptyProps={split:{savedTotal:null,total:0,wilson:0,savedWilson:0,error:'',draft:false}};
wview=wdraw(emptyProps);
assert.equal(nodes(wview).find(node=>node.type==='input').props.disabled,false,'guarded empty date permits a new Wilson total draft');
assert.equal(nodes(wview).find(node=>node.type==='button').props.disabled,true,'unknown saved total cannot be classified');
nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:'20'}});wview=wdraw(emptyProps);
await nodes(wview).find(node=>node.type==='input').props.onBlur();
assert.equal(wilsonEvents.at(-1).totalQuantity,20,'new Wilson quantity creates exactly one canonical20 draft');

// Retry is an actual actionable header control, never a cosmetic failure label.
harness.useMemo=factory=>factory();
slots.length=0;index=0;effects=[];
const RetryMatrix=load(harness).default;
let retriedCycle;
const retryTree=RetryMatrix({...props,plans:[],quoteResults:[{year:2026,majorWeek:'38',error:'network fixture'}],
  onRetryQuote(cycle){retriedCycle=cycle;}});
const retryButton=nodes(retryTree).find(node=>node.type==='button'&&node.props.children==='다시 조회');
assert.ok(retryButton);assert.equal(retryButton.props.disabled,false);
retryButton.props.onClick();assert.equal(retriedCycle.majorWeek,'38');assert.equal(retriedCycle.year,2026);
slots.length=0;index=0;effects=[];
const neutralTree=RetryMatrix({...props,plans:[],quoteResults:[readinessResult({})]});
assert.equal(nodes(neutralTree).filter(node=>node.type==='button'&&node.props.children==='다시 조회').length,0,
  'expected no-shipment state is not presented as a retriable network error');

// Blank input removes a browser draft; zero remains an explicit quantity.
const Quantity=load(harness).QuantityCell;
const qday=row.blocks[1].days[0],qevents=[];
const qprops={row,block,day:qday,disabled:false,onSelect(){},
  onEditCell:async payload=>{qevents.push(['edit',payload]);return true;},
  onClearCell:async payload=>{qevents.push(['clear',payload]);return true;}};
const qdraw=patch=>{index=0;effects=[];return Quantity({...qprops,...patch});};
slots.length=0;let qview=qdraw();
await nodes(qview).find(node=>node.type==='input').props.onBlur();assert.equal(qevents.length,0);
nodes(qview).find(node=>node.type==='input').props.onChange({target:{value:''}});
await nodes(qdraw()).find(node=>node.type==='input').props.onBlur();
assert.equal(qevents.at(-1)[0],'clear');assert.equal(qevents.at(-1)[1].quantity,null);assert.equal(qevents.at(-1)[1].clear,true);
assert.equal(qevents.at(-1)[1].orderWeek,qday.effectiveOrderWeek);
slots.length=0;qview=qdraw();nodes(qview).find(node=>node.type==='input').props.onChange({target:{value:'0'}});
await nodes(qdraw()).find(node=>node.type==='input').props.onBlur();assert.equal(qevents.at(-1)[0],'edit');assert.equal(qevents.at(-1)[1].quantity,0);
slots.length=0;qview=qdraw();nodes(qview).find(node=>node.type==='input').props.onChange({target:{value:''}});
const rejected={onClearCell:async()=>({success:false,error:'fixture delete failed '.repeat(40)})};
await nodes(qdraw(rejected)).find(node=>node.type==='input').props.onBlur();qview=qdraw(rejected);
assert.equal(nodes(qview).find(node=>node.type==='input').props.value,'','failed delete preserves blank input for retry');
const alert=nodes(qview).find(node=>node.props?.role==='alert');
assert.equal(alert.props.children.props.visibleLabel,'!');assert.match(alert.props.children.props.description,/fixture delete failed/);
assert.doesNotMatch(visibleText(render(CompactSummary,{...summaryProps,carryoverError:'fixture error'})),/이월 조회 실패/,
  'carry failure is a compact alert rather than long row text');
console.log('Blank draft deletion, explicit zero, async failure preservation and compact error details passed');

assert.equal(alert.props.children.props.autoOpen,true,'new input failure opens its details automatically');
slots.length=0;index=0;effects=[];
Details({...detailsProps,autoOpen:true});effects.forEach(effect=>effect());index=0;effects=[];
assert.ok(nodes(Details({...detailsProps,autoOpen:true})).some(node=>node.props?.role==='dialog'),'automatic failure alert uses the accessible dialog');
slots.length=0;let wclear;
wview=wdraw({onClearCell:async payload=>{wclear=payload;return true;}});
nodes(wview).find(node=>node.type==='input').props.onChange({target:{value:''}});
await nodes(wdraw({onClearCell:async payload=>{wclear=payload;return true;}})).find(node=>node.type==='input').props.onBlur();
assert.equal(wclear.quantity,null);assert.equal(wclear.clear,true,'blank Wilson removes the linked date draft instead of recording zero');
assert.deepEqual(qevents.find(item=>item[0]==='clear')[1].expectedDrafts,qday.drafts,'deletion carries rendered draft fingerprints');
console.log('Automatic error dialog, Wilson blank deletion and draft compare evidence passed');


assert.match(source,/wcm-cell-error \{[^\n]*z-index:40/,'input error dialog stacking context stays above selected-cell details');
