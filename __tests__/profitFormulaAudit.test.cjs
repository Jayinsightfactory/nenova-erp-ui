const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const {auditProfitFormulas,FORMULA_COLUMNS}=await import('../lib/profitFormulaAudit.mjs');
  const {computeProfitRow,computeProfitTotals,calcRevenueRatio,calcPurchaseRatio}=await import('../lib/profitReportCalc.js');
  const {buildConfirmDetailRows}=await import('../lib/profitReportConfirm.js');
  const cats=['콜롬비아 장미','이스라엘','뉴질랜드','일본','베트남','국내','공제','기타(미분류)'];
  const rows=cats.map((category,i)=>({category,variant:['이스라엘','뉴질랜드','일본'].includes(category)?'noEnding':'normal',auto:{N:1000+i,L:-20,O:15,Q:2,R:100,S:0,H:20,E:50,F:25},manual:{AC:10,AJ:-7},stock:{}}));
  const build=(input,edits={})=>{const display=input.map(r=>({...r,calc:computeProfitRow(r,edits)}));const totals=computeProfitTotals(display);for(const r of display)Object.assign(r.calc,{D:calcRevenueRatio(r.calc,totals),U:calcPurchaseRatio(r.calc,totals)});return {display,totals};};
  let {display,totals}=build(rows);
  assert.equal(auditProfitFormulas({rows},display,totals).status,'MATCH');
  assert.equal(display[0].calc.S,0,'explicit zero forwarding survives');
  for(const col of FORMULA_COLUMNS){const broken=structuredClone(display);broken[0].calc[col]=Number(broken[0].calc[col]||0)+1;assert(auditProfitFormulas({rows},broken,totals).issues.some(i=>i.column===col),col);}
  for(const col of Object.keys(totals)){assert(auditProfitFormulas({rows},display,{...totals,[col]:Number(totals[col]||0)+1}).issues.some(i=>i.category==='전체 합계'&&i.column===col),col);}
  const edits={[cats[0]]:{AC:0,AJ:'',R:0,S:0}};const edited=build(rows,edits);
  assert.equal(auditProfitFormulas({rows},edited.display,edited.totals,edits).status,'MATCH');
  const details=buildConfirmDetailRows(display,totals);
  for(const k of ['AC','AJ']){
    assert.equal(details.find(d=>d.category===cats[0]&&d.colType==='SOURCE'&&d.colKey===k).value,display[0].calc[k]);
    assert.equal(details.find(d=>d.category==='_total'&&d.colKey===k).value,totals[k]);
  }
  const frozen=display.map(r=>{const saved=Object.fromEntries(details.filter(d=>d.category===r.category&&d.colType==='CALC').map(d=>[d.colKey,d.value]));return {...r,confirmed:true,calc:saved,auto:saved,manual:{AC:999,AJ:999},stock:{}};});
  assert.equal(auditProfitFormulas({rows:frozen,confirmed:true},frozen,totals).status,'MATCH','stored adjustment roundtrip ignores live manual');
  const old=structuredClone(frozen);delete old[0].calc.AC;
  assert(auditProfitFormulas({rows:old,confirmed:true},old,totals).inputWarnings.some(w=>w.category===cats[0]));
  const missing=structuredClone(rows);missing[0].auto.E=null;const missingDisplay=build(missing);
  assert(auditProfitFormulas({rows:missing},missingDisplay.display,missingDisplay.totals).inputWarnings.length);
  assert.equal(auditProfitFormulas({rows:[]},[],{}).status,'UNVERIFIED');
  const previous=structuredClone(rows);previous[0].manual.AC=500;const prev=build(previous);
  assert.equal(auditProfitFormulas({orderYear:'2025',rows:previous},prev.display,prev.totals).status,'MATCH');
  assert.equal(auditProfitFormulas({orderYear:'2026',rows},display,totals).status,'MATCH');
  assert.equal(auditProfitFormulas({rows},prev.display,prev.totals).status,'MISMATCH');
  // Execute the actual page's formatter and all three total-row bindings (detail,
  // weekly and annual): a zero denominator must not be rendered as 100%.
  const vm=require('node:vm');
  const page=fs.readFileSync('pages/sales/profit-report.js','utf8');
  const formatter=page.match(/function readonlyValue\(key, obj, ctx\) \{[\s\S]*?\n\}/)[0];
  const formatConstants=['fmt','pct'].map(name=>page.match(new RegExp('const '+name+' = [^\\n]+'))[0]).join('\n');
  const contexts=[...page.matchAll(/readonlyValue\(cd\.key, (wTotals|totals|w\.totals), (\{ D: [^}]+\})\)/g)];
  assert.equal(contexts.length,3);
  for(const [, ,expression] of contexts)for(const value of [null,0,0.25,1]){
    const t={D:value,U:value};
    const result=vm.runInNewContext(`${formatConstants}\n${formatter}\n['D','U'].map(k=>readonlyValue(k,totals,${expression}))`,{totals:t,wTotals:t,w:{totals:t}});
    assert.deepEqual(Array.from(result),[value==null?'':`${(value*100).toFixed(1)}%`,value==null?'':`${(value*100).toFixed(1)}%`]);
  }
  const {buildProfitReportXlsx}=await import('../lib/profitReportExcel.js');
  const zeroRows=[{category:'콜롬비아 수국',auto:{N:0,L:0,O:0,Q:0,R:100,S:0,H:0,E:0,F:0},manual:{},stock:{}}];
  const wb=buildProfitReportXlsx({major:'41',rows:zeroRows,visibleCols:['D','Q','S','U'],returnWorkbook:true});
  const sheet=wb.Sheets['주차별 매출이익 보고서'];
  assert.equal(sheet.Q8.v,0); assert.equal(sheet.Q24.v,0); assert.equal(sheet.S24.v,0);
  assert.equal(sheet.D24?.v??null,null); assert.equal(sheet.U24?.v??null,null);
  const source=fs.readFileSync('lib/profitFormulaAudit.mjs','utf8');
  assert(!/import .*profitReportCalc/.test(source),'independent arithmetic');
  assert(!/\b(fetch|query|withTransaction)\s*\(/.test(source),'no IO');
  assert(fs.readFileSync('pages/sales/profit-validation.js','utf8').includes('<ProfitFormulaAudit report={report} />'));
  console.log('profitFormulaAudit: all fields, totals, zero/null, adjustments, snapshot roundtrip, cross-year passed');
})().catch(e=>{console.error(e);process.exitCode=1});
