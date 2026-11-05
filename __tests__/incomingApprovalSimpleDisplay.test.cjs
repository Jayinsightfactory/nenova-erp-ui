const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const source=fs.readFileSync('components/IncomingApproval.js','utf8');
const compiled=swc.transformSync(source.replace(/^import .*;\r?$/gm,''),{filename:'IncomingApproval.js',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}}).code;
const moduleExports={};new Function('React','exports',compiled)(React,moduleExports);
const render=(summary,farmOnly)=>renderToStaticMarkup(React.createElement(moduleExports.IncomingApprovalFinancialSummary,{summary,farmOnly}));
test('farm-only no-problem review shows one plain summary and keeps unchanged amounts in collapsed details',()=>{
 const html=render({costs:{invoices:[{beforeTotal:28000,afterTotal:28000}]}},true);
 assert.match(html,/농장만 변경하며 수량·분배·재고·금액은 유지됩니다/);
 assert.doesNotMatch(html.split('<details>')[0].replace(/<[^>]*>/g,''),/28,000|시험|검산|저장 경로/);
 assert.match(html,/<details><summary>원가·손익 상세/);assert.doesNotMatch(html,/<details open/);
 assert.match(source,/preview\.groups\.length>0&&<div/);
});
test('only real cost/profit changes appear in the main summary; all before/after values remain inspectable',()=>{
 const html=render({costs:{invoices:[{beforeTotal:28000,afterTotal:24000}],freight:[{beforeTotal:10000,afterTotal:10000}]},profitBefore:[{totals:{N:60000,J:40000}}],profitAfter:[{orderYear:'2026',major:'41',totals:{N:60000,J:41000}}]},false);
 const visible=html.split('<details>')[0];assert.match(visible,/28,000원 → 24,000원/);assert.match(visible,/40,000원 → 41,000원/);assert.doesNotMatch(visible,/60,000|10,000|순수매출/);
 assert.match(html,/순수매출/);assert.match(html,/60,000/);
});
