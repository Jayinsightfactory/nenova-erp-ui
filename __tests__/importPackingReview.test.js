const test=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx-js-style');
const ready=import('../lib/importPackingReview.js');
test('AI grand total is not freight-zero evidence; malformed currency stays unknown',async()=>{
 const {makePackingReviewRows,applyPackingReview}=await ready;
 const inv={freight_total:0,currency:{value:null,unit:'AUD$'},review_evidence:{freight_total:{value:0,quote:'TOTALL US$57.000'}}};
 const [row]=makePackingReviewRows([inv],'CO');
 assert.equal(row.values.freight,'');assert.equal(row.original.freight,null);assert.equal(row.currency,'통화 미확인');
 assert.equal(row.evidence.freight.quote,'TOTALL US$57.000');
 row.confirmed=true;row.values.freight='0';
 assert.throws(()=>applyPackingReview([inv],[row],'CO'),/이유/);
 row.reason='원본 운송비 무료 확인';assert.equal(applyPackingReview([inv],[row],'CO')[0].freight_total,0);
 const [explicit]=makePackingReviewRows([{review_evidence:{freight_total:{value:0,quote:'Freight USD 0'}}}],'CO');
 assert.equal(explicit.values.freight,'0');
});
const invoice=()=>({invoice:'2026-41',source_format:'china_invoice_xlsx',gross_weight:null,vol_weight:0,freight:20,invoice_total:120,
 products:[{description:'A',total_bunch:10}],additional_costs:[{description:'Freight',quantity:2,unit_price:10,amount:20}]});
test('zero, absent, units and invalid numbers remain distinct',async()=>{
 const {reviewNumber,makePackingReviewRows}=await ready;
 assert.equal(reviewNumber(''),null);assert.equal(reviewNumber('0'),0);assert.equal(reviewNumber('1,234.50'),1234.5);
 for(const x of ['1,2','NaN','Infinity','1e3',true])assert.throws(()=>reviewNumber(x));
 assert.throws(()=>reviewNumber(-1,{weight:true}));assert.equal(reviewNumber(-1),-1);
 const [row]=makePackingReviewRows([invoice()],'CN');assert.equal(row.values.gw,'');assert.equal(row.values.cw,'0');
 const [lbs]=makePackingReviewRows([{review_evidence:{gross_weight:{value:12,unit:'lb'}}}],'CN');assert.equal(lbs.values.gw,'');assert.equal(lbs.original.gw,12);
 const [missing]=makePackingReviewRows([{gross_weight:0,review_evidence:{gross_weight:{value:null}}}],'CN');assert.equal(missing.values.gw,'');
 assert.equal(makePackingReviewRows([{}],'CN')[0].currency,'통화 미확인');
 assert.equal(makePackingReviewRows([{}],'NL')[0].currency,'통화 미확인');
});
test('explicit review required; changes preserve source rows and invoice total, record delta once',async()=>{
 const {makePackingReviewRows,applyPackingReview}=await ready;const original=invoice(),before=JSON.stringify(original),rows=makePackingReviewRows([original],'CN');
 assert.throws(()=>applyPackingReview([original],rows,'CN'),/확인 체크/);rows[0].confirmed=true;rows[0].values.freight='15';
 assert.throws(()=>applyPackingReview([original],rows,'CN'),/이유/);rows[0].reason='원본 확인';rows[0].values.gw='12';
 const [out]=applyPackingReview([original],rows,'CN','2026-10-07T00:00:00Z');
 assert.equal(JSON.stringify(original),before);assert.equal(out.freight,15);assert.equal(out.additional_costs[0].amount,20);assert.equal(out.additional_costs[1].amount,-5);
 assert.equal(out.invoice_total,120);assert.deepEqual(out.products,original.products);assert.equal(out.packingReview.original.gw,null);
 const [again]=applyPackingReview([original],rows,'CN');assert.equal(again.additional_costs.length,2);
 assert.throws(()=>applyPackingReview([original],[],'CN'));
 rows[0].invoiceIndex=1;assert.throws(()=>applyPackingReview([original],rows,'CN'));
});
test('multi invoice/year changes cannot overwrite siblings; net weight not substituted for CW',async()=>{
 const {makePackingReviewRows,applyPackingReview}=await ready;
 const inv=[{invoice:'2025-41',freight:3,handling:2,net_weight:12},{invoice:'2026-41',freight:9}];
 const rows=makePackingReviewRows(inv,'NL').map(r=>({...r,confirmed:true}));rows[1].values.freight='0';rows[1].reason='무료';
 const out=applyPackingReview(inv,rows,'NL');assert.equal(out[0].freight,3);assert.equal(out[0].handling,2);assert.equal(out[0].vol_weight,null);assert.equal(out[0].net_weight,null);assert.equal(out[1].freight,0);
});
test('audit sheet retains original first-sheet numbers/formulas and strings never become formulas',async()=>{
 const {makePackingReviewRows,applyPackingReview,packingReviewWriter}=await ready;const inv=invoice(),rows=makePackingReviewRows([inv],'CN');rows[0].confirmed=true;rows[0].reason='=HYPERLINK("bad")';
 const [out]=applyPackingReview([inv],rows,'CN');const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([['품목',2,3]]);ws.D1={t:'n',f:'B1*C1',v:6};ws['!ref']='A1:D1';
 XLSX.utils.book_append_sheet(wb,ws,'CN');
 const result=XLSX.read(packingReviewWriter(XLSX,out,'41-1.xlsx').write(wb,{type:'array',bookType:'xlsx'}),{type:'array'});
 assert.deepEqual(result.SheetNames,['CN','인식값 확인']);assert.equal(result.Sheets.CN.D1.f,'B1*C1');assert.equal(result.Sheets.CN.B1.v,2);
 assert.equal(result.Sheets['인식값 확인'].B8.t,'s');assert.equal(result.Sheets['인식값 확인'].B8.f,undefined);
});

test('generated native packing first sheet preserves every value, formula, merge and style after audit append',async()=>{
 const {genChina}=await import('../lib/importPacking.js');
 const {makePackingReviewRows,applyPackingReview,packingReviewWriter}=await ready;
 const inv={invoice:'REVIEW-2026',date:'2026/10/04',freight:10,invoice_total:110,
  products:[{description:'ROSE RED',pcs:1,total_bunch:10,total_stems:100,u_price:1,t_price:100,bunch_st:10,steam_box:100}]};
 const drafts=makePackingReviewRows([inv],'CN').map(r=>({...r,confirmed:true}));
 const [out]=applyPackingReview([inv],drafts,'CN');
 const generated=genChina(XLSX,out,'41','1',{});
 const withReview=genChina(packingReviewWriter(XLSX,out,'source.pdf'),out,'41','1',{});
 const before=XLSX.read(generated.buf,{type:'array',cellStyles:true,cellFormula:true});
 const after=XLSX.read(withReview.buf,{type:'array',cellStyles:true,cellFormula:true});
 assert.equal(after.SheetNames[0],before.SheetNames[0]);
 const a=before.Sheets[before.SheetNames[0]],b=after.Sheets[after.SheetNames[0]];
 assert.deepEqual(b['!merges'],a['!merges']);assert.equal(b['!ref'],a['!ref']);
 for(const [key,cell] of Object.entries(a)){if(key.startsWith('!'))continue;
  for(const field of ['v','t','f','z','s'])assert.deepEqual(b[key]?.[field],cell[field],`${key}.${field}`);
 }
 const JSZip=require('jszip'),za=await JSZip.loadAsync(generated.buf),zb=await JSZip.loadAsync(withReview.buf);
 const xa=await za.file('xl/worksheets/sheet1.xml').async('string'),xb=await zb.file('xl/worksheets/sheet1.xml').async('string');
 const difference=[...xa].findIndex((c,i)=>c!==xb[i]);
 assert.ok(xa===xb,`sheet1 mismatch ${difference}: ${xa.slice(difference-30,difference+90)} VS ${xb.slice(difference-30,difference+90)}`);
 const styleA=await za.file('xl/styles.xml').async('string'),styleB=await zb.file('xl/styles.xml').async('string');
 for(const section of ['fonts','borders','fills']){
  const re=new RegExp(`<${section}[^>]*>[\\s\\S]*?<\\/${section}>`);
  assert.equal(styleB.match(re)?.[0],styleA.match(re)?.[0],section);
 }
});
