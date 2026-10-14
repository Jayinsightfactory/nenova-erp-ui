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
];
let source = fs.readFileSync('pages/shipment/distribute.js','utf8');
const values = {products:fixtures,selectedProd:fixtures[0],prodGroup:'콜롬비아::카네이션',prodGroups:[{key:'콜롬비아::카네이션',country:'콜롬비아',flower:'카네이션'}],inQty:1};
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
const display = load(fs.readFileSync('lib/distributeProductDisplay.js','utf8'),require);
const Page = load(source, name=>{
  if(name.endsWith('/useApi')) return {apiGet:()=>{throw Error('Display fixture must not query ERP');}};
  if(name.endsWith('/useWeekInput')) return {useWeekInput:()=>({value:'2026-41-01'}),getCurrentWeek:()=> '2026-41-01',WeekInput:()=>null};
  if(name.endsWith('/i18n')) return {useLang:()=>({t:key=>key})};
  if(name.endsWith('/distributeProductDisplay')) return display;
  if(name.endsWith('/shipmentDistributionWorkspace.js')) return load(fs.readFileSync('lib/shipmentDistributionWorkspace.js','utf8'),require);
  if(name.endsWith('/DistributionPicker')) return load(fs.readFileSync('components/shipment/DistributionPicker.js','utf8'),require);
  return require(name);
}).default;
const html=renderToStaticMarkup(React.createElement(Page));
assert.match(html,/data-product-select="true"[^>]*title="CARNATION Pastel Crimea"[^>]*>Pastel Crimea<\/button>/);
assert.match(html,/전차수 잔량 2.00 박스/);
assert.match(html,/Mix Box D \(Mariposa. Yukari cherry, Cherrio\)/);
assert.match(html,/min-width:180px;max-width:240px;white-space:normal/);
console.log('Distribution real-page SSR: compact full names, original title, previous stock and responsive product panel passed');
module.exports={html};
