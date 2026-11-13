const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const {transformSync} = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const transform = source => transformSync(source, false, Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}))).code;
const fixtures = [
  {ProdKey:345,ProdName:'CARNATION Apple Tea',OutUnit:'박스',_exeParity:true,prevStock:2,inQty:1,outQty:1},
  {ProdKey:3199,ProdName:'CARNATION Pastel Crimea',OutUnit:'박스',_exeParity:true,prevStock:0,inQty:0,outQty:0},
  {ProdKey:2518,ProdName:'CARNATION Mix Box D (Mariposa. Yukari cherry, Cherrio)',OutUnit:'박스',_exeParity:true,prevStock:4,inQty:4,outQty:4},
].map(p=>({...p,CounName:'콜롬비아',FlowerName:'카네이션'}));
let source = fs.readFileSync('pages/shipment/distribute.js','utf8');
const values = {favoriteGroups:[{groupKey:'콜롬비아::카네이션'}],products:fixtures,selectedProd:fixtures[0],prodGroup:'콜롬비아::카네이션',prodGroups:[{key:'콜롬비아::카네이션',country:'콜롬비아',flower:'카네이션'}],inQty:1};
for (const [state,value] of Object.entries(values)) {
  const pattern = new RegExp(`(const \\[${state}, [^\\]]+\\] = useState\\()([^;]+)(\\);)`);
  assert.match(source,pattern);
  source = source.replace(pattern,(_,a,_old,b)=>a+JSON.stringify(value)+b);
}
function load(source, localRequire) {
  const mod={exports:{}};
  new Function('require','module','exports',transform(source))(localRequire,mod,mod.exports);
  return mod.exports;
}
// lib 끼리의 상대 import(./customerSearch.js → ./qwertyHangul.js)는 lib 기준으로 해석
const libRequire = name => name.startsWith('./') ? load(fs.readFileSync('lib/'+name.slice(2).replace(/\.js$/,'')+'.js','utf8'),libRequire) : require(name);
const display = load(fs.readFileSync('lib/distributeProductDisplay.js','utf8'),require);
const Page = load(source, name=>{
  if(name.endsWith('/useApi')) return {apiGet:()=>{throw Error('Display fixture must not query ERP');}};
  if(name.endsWith('/useWeekInput')) return {useWeekInput:()=>({value:'2026-41-01'}),getCurrentWeek:()=> '2026-41-01',WeekInput:()=>null,
    formatWeekDisplay:w=>String(w).replace(/^2026-/,'')};
  if(name.endsWith('/i18n')) return {useLang:()=>({t:key=>key})};
  if(name.endsWith('/distributeProductDisplay')) return display;
  if(name.endsWith('/shipmentDistributionNavigation.js')) return libRequire('./shipmentDistributionNavigation.js');
  if(name.endsWith('/shipmentMajorInlineDates.js')) return libRequire('./shipmentMajorInlineDates.js');
  if(name.endsWith('/DistributionProductTree')) return load(fs.readFileSync('components/shipment/DistributionProductTree.js','utf8'),n=>n.includes('shipmentDistributionNavigation')?libRequire('./shipmentDistributionNavigation.js'):n.includes('distributeProductDisplay')?display:require(n));
  if(name.endsWith('/DistributionDateFilter')) return load(fs.readFileSync('components/shipment/DistributionDateFilter.js','utf8'),require);
  if(name.endsWith('/DistributionKakaoFeed')) return load(fs.readFileSync('components/shipment/DistributionKakaoFeed.js','utf8'),n=>n.includes('/lib/')?require('../lib/'+n.split('/').pop()):require(n));
  if(name.endsWith('/shipmentDistributionWorkspace.js')) return libRequire('./shipmentDistributionWorkspace.js');
  if(/\/lib\/(displayName|customerSearch|qwertyHangul)$/.test(name)) return libRequire('./'+name.split('/').pop());
  if(name.endsWith('/fixCycleClient')) return {runEditWithFixCycle:async({apply})=>apply()};
  // Unopened date editor and independent guide are outside this product-label SSR fixture.
  if(name.endsWith('/DistributionInlineDates')) return {__esModule:true,default:()=>null,DistributionInlineDatesHeader:()=>null};
  if(name.endsWith('/DistributionDateEditor') || name.endsWith('/WorkflowGuide')) return ()=>null;
  if(name.endsWith('/DistributionPicker')) return load(fs.readFileSync('components/shipment/DistributionPicker.js','utf8'),require);
  return require(name);
}).default;
const html=renderToStaticMarkup(React.createElement(Page));
assert.match(html,/data-product-select="true"[^>]*title="CARNATION Pastel Crimea"[^>]*>Pastel Crimea<\/button>/);
assert.match(html,/data-testid="distribution-previous-stock"[^>]*><div[^>]*>전차수 재고 \(박스\)<\/div><div[^>]*>2\.00<\/div>/);
assert.match(html,/Mix Box D \(Mariposa. Yukari cherry, Cherrio\)/);
assert.match(html,/min-width:180px;max-width:240px;white-space:normal/);
// nenova.exe식 버튼형 차수(±3 → 7개)·세부차수·품목 버튼 + 브리지 검증 표식, 저장 버튼에는 표식 없음
const weekButtons = [...html.matchAll(/data-ai-verify="week-(2026-\d{2}-01)"/g)].map(m=>m[1]);
assert.deepEqual(weekButtons,['2026-38-01','2026-39-01','2026-40-01','2026-41-01','2026-42-01','2026-43-01','2026-44-01']);
assert.match(html,/data-ai-verify="week-2026-41-01" aria-pressed="true"/);
assert.match(html,/data-ai-verify="week-2026-40-01" aria-pressed="false"/);
assert.deepEqual([...html.matchAll(/data-ai-verify="subweek-(\d{2})"/g)].map(m=>m[1]),['01','02','03','04']);
assert.match(html,/data-ai-verify="product-345" aria-pressed="true"/);
assert.match(html,/data-ai-verify="product-3199" aria-pressed="false"/);
assert.match(html,/🚚 출고분배 및 농장정보[\s\S]*🏬 출고분배 및 업체정보[\s\S]*📅 출고일 지정/);
assert.doesNotMatch(html,/aria-keyshortcuts="Control\+S"[^>]*data-ai-verify|data-ai-verify="[^"]*"[^>]*aria-keyshortcuts="Control\+S"/,'save button must not carry data-ai-verify');
console.log('Distribution real-page SSR: compact full names, original title, previous stock and responsive product panel passed');
module.exports={html};
