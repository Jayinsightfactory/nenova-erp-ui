import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import JSZip from 'jszip';
import {invoiceCostExportFixture} from './invoiceReceiptCostExport.test.js';
import {createInvoiceCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
import {RESTORED_COST_LAYOUTS} from '../lib/invoiceCostOriginalRestoration.js';
import {findReferenceSale} from '../lib/invoiceCostSalesDefaults.js';
import coContent from '../lib/invoiceCostTemplates/colombia-42-1-content.json' with {type:'json'};
const X=createRequire(import.meta.url)('xlsx');
const layout=p=>RESTORED_COST_LAYOUTS[p.id]??(p.id==='AU_ORIGINAL_V1'?{first:13,unitCost:'M',recommend:'P',input:'O',sale:'N',profit:'Q',margin:'R',sales:'S',profits:'T',qty:'E',factor:'L'}:{first:15,unitCost:'O',recommend:'R',input:'Q',sale:'P',profit:'S',margin:'T',sales:'U',profits:'V',qty:'E',factor:'N'});
// Independent A1 dependency audit: zero multipliers do not remove dependencies.
function hasCycle(sheet){
 const edges=new Map();
 for(const [ref,cell] of Object.entries(sheet))if(cell?.f){
  const refs=new Set(),formula=cell.f.replace(/"(?:[^"]|"")*"/g,'');
  const singles=formula.replace(/\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/g,(_,a,b,c,d)=>{
   const range=X.utils.decode_range(`${a}${b}:${c}${d}`);
   for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++)refs.add(X.utils.encode_cell({r,c}));
   return '';
  });
  for(const m of singles.matchAll(/\$?([A-Z]{1,3})\$?(\d+)/g))refs.add(m[1]+m[2]);
  edges.set(ref,[...refs]);
 }
 const active=new Set(),done=new Set();
 function visit(ref){
  if(active.has(ref))return true;
  if(done.has(ref)||!edges.has(ref))return false;
  active.add(ref);
  if(edges.get(ref).some(visit))return true;
  active.delete(ref);done.add(ref);return false;
 }
 return [...edges.keys()].some(visit);
}
for(const profile of Object.values(INVOICE_COST_EXPORT_PROFILES))test(`${profile.id} automatic reference sales and complete profit totals, no source mutation`,async()=>{
 const f=invoiceCostExportFixture(4,profile.formulaId);f.document.orderYear='2025';
 if(profile.id==='CN_SEA_ORIGINAL_V1')f.snapshot.input.lineInputs.forEach(l=>{l.boxCbm=.1;});
 const before=JSON.stringify(f),bytes=await createInvoiceCostWorkbook(f),b=X.read(bytes,{cellFormula:true}),s=b.Sheets['원본 양식 계산'],p=layout(profile),r=p.first,summary=(profile.headerRow??r-1)-1;
 assert.equal(JSON.stringify(f),before);assert.ok(b.SheetNames[0].startsWith('2025 '));
 for(let i=0;i<4;i++){
  const n=r+i,cost=s[p.unitCost+n].v,price=cost/(profile.id==='CN_SEA_ORIGINAL_V1'?.85:.77)*(profile.id==='CN_SEA_ORIGINAL_V1'?1.1:1);
  assert.ok(Math.abs(s[p.input+n].v-price)<1e-7);assert.equal(s[p.sale+n].v,price/1.1);
  assert.equal(s[p.profit+n].v,price/1.1-cost);
  assert.ok(Math.abs(s[p.sales+n].v-s[p.sale+n].v*s[p.qty+n].v/s[p.factor+n].v)<1e-7);
  assert.ok(s['AF'+n].v.includes(profile.sourceSheet));assert.match(s['AE'+n].v,/推薦|추천식/);
 }
 const sales=Array.from({length:4},(_,i)=>s[p.sales+(r+i)].v).reduce((a,b)=>a+b,0),profit=Array.from({length:4},(_,i)=>s[p.profits+(r+i)].v).reduce((a,b)=>a+b,0);
 assert.equal(s[p.sales+summary].v,sales);assert.equal(s[p.profits+summary].v,profit);assert.equal(s[p.margin+summary].v,profit/sales);
 const z=await JSZip.loadAsync(bytes),xml=await z.file('xl/worksheets/sheet3.xml').async('string');
 const cols=[...xml.matchAll(/<col\b[^>]*min="(\d+)"[^>]*max="(\d+)"[^>]*\/>/g)].map(m=>[+m[1],+m[2]]);
 for(let i=1;i<cols.length;i++)assert.ok(cols[i-1][1]<cols[i][0],'no overlapping column definitions');
 assert.match(xml,/NOT\(ISNUMBER/);assert.doesNotMatch(await z.file('xl/worksheets/sheet1.xml').async('string'),/<f\b/);
});
test('reference lookup is exact name and same quantity factor, retains zero, refuses collisions',()=>{
 const a={name:'Example White',price:0,factor:1,cell:'O19'};
 assert.equal(findReferenceSale([a],[' EXAMPLE  WHITE '],1),a);
 assert.equal(findReferenceSale([a],['Example Red'],1),null);
 assert.equal(findReferenceSale([a],['Example White'],5),null);
 assert.equal(findReferenceSale([a,{...a,price:100}],['Example White'],1),null);
});

test('CO sales diagnostic cannot overwrite any of the five weight allocation inputs',async()=>{
 const f=invoiceCostExportFixture(4,INVOICE_COST_EXPORT_PROFILES.CO_42_1_ORIGINAL_V1.formulaId);
 const s=X.read(await createInvoiceCostWorkbook(f),{cellFormula:true}).Sheets['원본 양식 계산'];
 assert.equal(s.AB12.v,coContent.defaults.AB12);
 assert.equal(s.AB12.f,undefined,'weight denominator must not depend on sales');
 assert.equal(s.AL14.f,'COUNT(Q15:Q18)');
 assert.equal(s.AK14.v,'기준판매가 적용 행수');
 assert.equal(s.AL15.v,'자동 기준가 · 실판매 아님');
 for(let r=8;r<=12;r++)for(const col of ['AB','AC','AG','AH']){
  assert.equal(s[col+r]?.f,undefined,`${col+r} allocation input stays independent of downstream prices`);
 }
 assert.match(s.AD9.f,/SUMPRODUCT\(\$AB\$8:\$AB\$12,\$AC\$8:\$AC\$12\)/);
 assert.equal(hasCycle(s),false,'generated cost and sales dependencies must be acyclic');
 s.AB12={...s.AB12,f:'COUNT(Q15:Q18)'};
 assert.equal(hasCycle(s),true,'regression detector rejects the old circular sales counter even with zero fifth-group boxes');
});
test('AU verified named reference price overrides recommendation only in same unit',async()=>{
 const f=invoiceCostExportFixture(1,'AU_CNF_BUNCH_V1');f.document.lines[0].originalName='Banker Bush';
 const s=X.read(await createInvoiceCostWorkbook(f),{cellFormula:true}).Sheets['원본 양식 계산'];
 assert.equal(s.O13.v,19500);assert.equal(s.O13.f,undefined);assert.equal(s.N13.v,19500/1.1);assert.match(s.AE13.v,/품목판매가/);assert.match(s.AF13.v,/38-1.*W5/);
});
test('missing sea allocation does not invent a sales/profit total',async()=>{
 const f=invoiceCostExportFixture(2,'CN_SEA_ACTUAL_V1'),s=X.read(await createInvoiceCostWorkbook(f)).Sheets['원본 양식 계산'];
 assert.equal(s.R44.v,'');assert.equal(s.V42.v,'입력 필요');assert.equal(s.W42.v,'입력 필요');
});

test('Thai sales headings wrap in desktop Excel while original fonts and widths remain intact',async()=>{
 const bytes=await createInvoiceCostWorkbook(invoiceCostExportFixture(3,INVOICE_COST_EXPORT_PROFILES.TH_ORIGINAL_V1.formulaId));
 const z=await JSZip.loadAsync(bytes),sheet=await z.file('xl/worksheets/sheet3.xml').async('string'),styles=await z.file('xl/styles.xml').async('string');
 const xfs=[...styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]);
 for(const ref of ['R14','S14']){
  const cell=sheet.match(new RegExp(`<c\\b[^>]*r="${ref}"[^>]*>`))[0];
  assert.match(xfs[Number(cell.match(/s="(\d+)"/)[1])],/<alignment\b[^>]*wrapText="1"/);
 }
 assert.match(sheet,/<row\b[^>]*r="14"[^>]*ht="64"/);
});

test('China sea source CBM completes file-only sales calculations without editing approved inputs',async()=>{
 const f=invoiceCostExportFixture(1,'CN_SEA_ACTUAL_V1');
 f.document.lines[0].originalName='Ammi CHINA 아미초';
 f.snapshot.input.lineInputs[0].bunchesPerBox=10;
 const before=JSON.stringify(f),b=X.read(await createInvoiceCostWorkbook(f),{cellFormula:true});
 const s=b.Sheets['원본 양식 계산'];
 assert.equal(typeof s.R44.v,'number');assert.equal(typeof s.V42.v,'number');
 const comparison=Object.values(b.Sheets).find(s=>s.W12?.v==='박스 CBM 입력');
 assert.equal(comparison.W13.v,.04704);assert.match(comparison.AD13.v,/참고 기본값/);
 assert.equal(JSON.stringify(f),before);
});
