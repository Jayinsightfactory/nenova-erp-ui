const assert = require('node:assert/strict');
async function main() {
  const { applyConfirmedShillaSourceNames: apply, SHILLA_CONFIRMED_SOURCE_SHA256: hash, selectShillaImportBatches: select, shillaSettlementItem: adapt } = await import('../lib/shillaPnlImportPolicy.js');
  const source = () => ({ Sheets: {
    '35차': { A8: {v:' '}, B8:{v:'화이트'}, C8:{v:324}, D8:{v:11233} },
    '31차8월': { E9:{v:266400}, E10:{v:6568213}, H10:{v:2468949}, J10:{v:0}, K10:{v:0} },
    '30차': { I6:{v:4140}, I7:{v:46800}, I9:{v:1970778}, K9:{v:1566434.4}, L9:{v:404343.6} },
    '15차': { A4:{v:'호접'}, B4:{v:'염색'}, C4:{v:48}, E4:{v:0} },
    '33차': { A7:{v:''}, B7:{v:'태국샘플'}, C7:{v:1}, D7:{v:43000} },
  } });
  const untouched=source(); assert.deepEqual(apply(untouched,'other-file'),[]); assert.deepEqual(untouched,source());
  // Always exercise all five approved corrections, even when the personal file
  // is absent or has changed SHA. These are synthetic cell fixtures, not approval
  // of another real workbook; production still requires the exact source hash.
  const w=source(); assert.equal(apply(w,hash).length,5);
  assert.equal(w.Sheets['15차'].D4.v,0);
  assert.equal(w.Sheets['33차'].A7.v,'태국샘플');
  assert.equal(w.Sheets['33차'].B7.v,'');
  assert.equal(w.Sheets['33차'].D7.v,43000);
  assert.equal(w.Sheets['35차'].A8.v,'호접\n(8스팀)');
  assert.equal(w.Sheets['31차8월'].E10.v,6834613);
  assert.equal(w.Sheets['31차8월'].J10.v,1975159.2);
  assert.equal(w.Sheets['30차'].K6.v,3312); assert.equal(w.Sheets['30차'].L7.v,9360);
  assert.ok(Math.abs(w.Sheets['30차'].K9.v + w.Sheets['30차'].L9.v-1970778)<0.001);
  const free={Sheets:{'15차':{A4:{v:'호접'},B4:{v:'염색'},C4:{v:48},E4:{v:0}}}};
  assert.equal(apply(free,hash).length,1); assert.equal(free.Sheets['15차'].D4.v,0);
  const a=adapt({name:'장미',color:'쉬머',qty:40,buyPrice:10800,sellPrice:11970,sellAmount:478800});
  assert.equal(a.name,'장미 · 쉬머'); assert.equal(a.costPrice,10800); assert.equal(a.price,11970); assert.equal(a.supply,478800); assert.equal(a.byBranch.신라호텔,40);
  assert.equal(a.costSource,'shilla'); assert.ok(a.costSource.length<=10,'CostSource NVARCHAR(10) schema limit');
  assert.equal(adapt({name:'무료',qty:1,buyPrice:0,sellPrice:0,sellAmount:0}).costPrice,0);
  assert.equal(adapt({name:'누락',buyPrice:null}).costPrice,null);
  const good={major:'27',partnerCode:'shilla',verification:[{ok:true}]};
  assert.deepEqual(select([good],['27']),[good]);
  for(const values of [[],['27','27'],['28'],['xx']]) assert.throws(()=>select([good],values));
  assert.throws(()=>select([{...good,partnerCode:'raum'}],['27']));
  assert.throws(()=>select([{...good,verification:[]}],['27']));
  assert.throws(()=>select([{...good,verification:[{ok:false}]}],['27']));
  const { buildRaumPnlWorkbook }=await import('../lib/raumPnlExcel.js');
  const ExcelJS=require('exceljs');
  const records=[60,80,0].map((pct,i)=>({master:{PartnerCode:'shilla',OrderYear:String(2024+i),MajorWeek:'27',NenovaPct:pct},items:[{...a,unit:'단'}]}));
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await buildRaumPnlWorkbook(records));
  const summary=wb.getWorksheet('결산');
  assert.deepEqual(wb.worksheets.map(s=>s.name),['27차','2025-27차','2026-27차','결산']);
  assert.equal(summary.getCell('G3').result,46800*0.6); assert.equal(summary.getCell('G4').result,46800*0.8); assert.equal(summary.getCell('G5').result,0);
  // Immutable malformed-source regression: missing purchase cost must be blocked
  // before export; only the exact approved source policy may interpret it as 0.
  const XFixture=require('xlsx');
  const {parseShillaPnlWorkbookGroups:parseFixture}=await import('../lib/shillaPnlParse.js');
  const malformed=XFixture.utils.book_new();
  XFixture.utils.book_append_sheet(malformed,XFixture.utils.aoa_to_sheet([
    ['합성 신라 15차'],
    ['품명','칼라','입고수량','매입단가','매입액','매출단가','매출액','이익','이익율','네노바이익(60%)','미우이익(40%)'],
    ['합성장미','레드',1,100,100,200,200,100,null,60,40],
    ['호접','염색',48,null,0,10,480,480,null,288,192],
    ['합계',null,49,null,100,null,680,580,null,348,232],
  ]),'15차');
  assert.deepEqual(apply(malformed,'changed-workbook'),[]);
  const invalid=parseFixture(XFixture,malformed,{orderYear:2026});
  assert.equal(invalid.batches[0].items[1].buyPrice,null);
  assert.throws(()=>select(invalid.batches,['15']),/원본 확인/);
  assert.equal(apply(malformed,hash).length,1);
  const corrected=parseFixture(XFixture,malformed,{orderYear:2026});
  const selected=select(corrected.batches,['15']);
  assert.equal(selected[0].items[1].buyPrice,0);
  const correctedExport=new ExcelJS.Workbook();
  await correctedExport.xlsx.load(await buildRaumPnlWorkbook(selected.map(b=>({master:{PartnerCode:'shilla',OrderYear:'2026',MajorWeek:b.major,NenovaPct:b.nenovaPct},items:b.items.map(adapt)}))));
  for(const [col,total] of [[3,100],[4,680],[5,580],[7,348],[8,232]]) assert.equal(correctedExport.getWorksheet('결산').getCell(3,col).result,total);
  const fs=require('node:fs'); const path='C:/Users/USER/Desktop/2026 신라 상반기 입고 손익계산_이사님보고.xlsx';
  if(fs.existsSync(path)) {
    const X=require('xlsx'); const crypto=require('node:crypto');
    const {parseShillaPnlWorkbookGroups:parse}=await import('../lib/shillaPnlParse.js');
    const raw=fs.readFileSync(path); const original=X.read(raw,{type:'buffer'});
    const sourceHash=crypto.createHash('sha256').update(raw).digest('hex');
    const notes=apply(original,sourceHash);
    const parsed=parse(X,original,{orderYear:2026});
    // Export/storage requires verified batches. A changed personal workbook is
    // not entitled to the old five corrections (e.g. missing 15차 cost is NOT 0).
    const verified=parsed.batches.filter(b=>b.verification.length && b.verification.every(c=>c.ok));
    const blocked=parsed.batches.filter(b=>!verified.includes(b));
    for(const batch of blocked) assert.throws(()=>select(parsed.batches,[batch.major]), /원본 확인/);
    if(sourceHash===hash) {
      assert.equal(notes.length,5);
      assert.equal(blocked.length,0,'Approved source must remain fully verified');
    } else assert.deepEqual(notes,[],'Unapproved personal file must not inherit corrections');
    const all=verified.map(b=>({master:{PartnerCode:'shilla',OrderYear:'2026',MajorWeek:b.major,NenovaPct:b.nenovaPct},items:b.items.map(adapt)}));
    const exported=new ExcelJS.Workbook(); await exported.xlsx.load(await buildRaumPnlWorkbook(all));
    for(const [i,b] of verified.entries()) {
      const row=exported.getWorksheet('결산').getRow(i+3);
      for(const [label,col] of [['매입액 합계',3],['매출액 합계',4],['이익 합계',5],['네노바이익 합계',7],['미우이익 합계',8]]) {
        const check=b.verification.find(c=>c.label===label);
        if(check) assert.ok(Math.abs(row.getCell(col).result-check.parsedVal)<1,`${b.major} ${label} export mismatch`);
      }
    }
    console.log(`Actual file: ${verified.length} verified weeks parser→storage adapter→Excel totals reconciled; ${blocked.length} unverified weeks rejected by storage policy; approved snapshot ${sourceHash===hash ? 'verified' : 'NOT verified (SHA differs)'}`);
  }
  console.log('Shilla approved corrections, storage adapter, selection and export ratios passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
