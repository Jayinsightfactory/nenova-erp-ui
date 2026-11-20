const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const XLSX=require('xlsx'),ExcelJS=require('exceljs'),JSZip=require('jszip');
const load=require('./helpers/shipmentImportLoader.cjs').createImportLoader();
const mode=load('shipmentImportMode'),api=load('shipmentImport'),farms=load('shipmentFarmImport'),files=load('shipmentImportWorkbook'),sign=load('shipmentReplacementPlan'),writer=load('shipmentFarmWorkbook');
const product={ProdKey:53,ProdName:'CARNATION Apple Tea',DisplayName:'애플티',FlowerName:'카네이션',CounName:'콜롬비아',CountryFlower:'콜롬비아카네이션',OutUnit:'박스',EstUnit:'박스',BunchOf1Box:10,SteamOf1Box:100};
const customer={CustKey:1,CustName:'시험업체',OrderCode:'FIXTURE',BaseOutDay:0};
const input=qty=>({custKey:1,prodKey:53,customerLabel:'시험업체',productLabel:'Apple Tea',rawProductLabel:'Apple Tea',productFamily:'carnation',productHeadings:['콜롬비아카네이션'],sheetName:'카네이션',rowNo:4,colNo:2,outUnit:'박스',uploadQty:qty});
async function preview({kind='ADD',qty=3,year='2026',rows,base=10,fix=false}={}){
  const queryFn=async(text,params={})=>{
    assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if(/FROM Product\s+WHERE/.test(text))return{recordset:[product]};
    if(/FROM Customer\s+WHERE/.test(text))return{recordset:[customer,{...customer,CustKey:2,CustName:'다른업체'}]};
    if(params.weekKey)return{recordset:fix?[{CountryFlower:product.CountryFlower,isFix:1,fixCount:1,detailCount:1}]:[]};
    assert.equal(params.importYear.value,year);assert.equal(params.week.value,'46-01');
    if(/AS yr, COUNT/.test(text))return{recordset:[{yr:year==='2026'?'2025':'2026',detailCount:1}]};
    if(/NOT EXISTS/.test(text))return{recordset:[]};
    return{recordset:[{CustKey:1,ProdKey:53,orderQty:10,currentOutQty:base},{CustKey:2,ProdKey:53,orderQty:99,currentOutQty:99}]};
  };
  return api.buildImportPreview({parsedRows:rows||[input(qty)],rawWeek:'46-01',rawYear:year,fileBasedScope:true,distributionMode:kind,queryFn});
}
test('ADD groups source cells first, adds selected-year baseline once, and never creates missing cancellations',async()=>{
  for(const year of ['2025','2026']){
    const base=year==='2025'?90:10;
    const a=await preview({year,base});assert.equal(a.unmatched.length,0);assert.equal(a.rows.length,1);assert.equal(a.rows[0].uploadQty,base+3);assert.equal(a.rows[0].inputQty,3);assert.equal(a.rows[0].orderDiffQty,0);assert.equal(a.rows[0].shipmentDiffQty,3);
    const repeat=await preview({year,base});assert.equal(repeat.rows[0].uploadQty,base+3);
    const duplicate=await preview({year,base,rows:[input(3),{...input(2),colNo:3}]});assert.equal(duplicate.rows.length,1);assert.equal(duplicate.rows[0].uploadQty,base+5);assert.equal(duplicate.rows[0].inputQty,5);
    const zero=await preview({year,base,qty:0});assert.equal(zero.rows[0].uploadQty,base);assert.equal(zero.rows[0].needsShipmentApply,false);assert.equal(zero.applyRows.length,0);
    const old=await preview({year,base,kind:'REPLACE'});assert.equal(old.rows.find(r=>r.custKey===1).uploadQty,3);assert.equal(old.rows.find(r=>r.custKey===2).uploadQty,0);
    const final=await preview({year,base,kind:'FINAL',qty:13});assert.equal(final.rows.length,1);assert.equal(final.rows[0].uploadQty,13);
  }
});
test('strict ADD stale rejects another job even at the same target; signed modes and baselines cannot change',()=>{
  const row={custKey:1,prodKey:53,currentOutQty:10,inputQty:3,uploadQty:13,distributionMode:'ADD'};
  assert.equal(mode.verifiedImportTarget(row,3,'ADD'),13);assert.doesNotThrow(()=>mode.assertAdditionBaseline(row,10));
  assert.throws(()=>mode.assertAdditionBaseline(row,13),/既存|기존 분배/);assert.throws(()=>mode.assertAdditionBaseline(row,11),/기존 분배/);
  assert.throws(()=>mode.verifiedImportTarget({...row,currentOutQty:11},3,'ADD'),/다시 검증/);
  assert.throws(()=>mode.projectImportQuantity({mode:'ADD',currentOutQty:10,inputQty:-1}),/음수/);
  const p={success:true,rows:[row],unmatched:[],orderYear:'2026',week:'46-01',distributionMode:'ADD',replacementProductKeys:[53]};
  const secret='fixture-only',token=sign.createReplacementPlan(p,'fixture',{secret,now:100});
  const body={year:'2026',week:'46-01',rows:[row],distributionMode:'ADD',fullCategoryReplacement:false,replacementProductKeys:[53],replacementPlan:token};
  assert.doesNotThrow(()=>sign.assertReplacementPlan(body,'fixture',{secret,now:101}));
  assert.throws(()=>sign.assertReplacementPlan({...body,distributionMode:'REPLACE',fullCategoryReplacement:true},'fixture',{secret,now:101}));
  assert.throws(()=>sign.assertReplacementPlan({...body,rows:[{...row,uploadQty:16}]},'fixture',{secret,now:101}));
});
test('unit conversion for deltas uses source units rather than proximity to a total',()=>{
  const rose={...product,FlowerName:'장미',CountryFlower:'콜롬비아장미'};
  const r={excelQty:3,productFamily:'rose',sheetName:'콜롬비아장미',currentOutQty:3,orderQty:3};
  assert.equal(mode.normalizeImportInput(r,rose,'ADD'),0.3);assert.equal(mode.normalizeImportInput({...r,excelQty:0},rose,'ADD'),0);
  assert.equal(mode.normalizeImportInput({excelQty:2,productFamily:'alstroemeria'},product,'ADD'),32);
  assert.equal(mode.normalizeImportInput({excelQty:2,productFamily:'alstroemeria',alstroErpQuantity:true},product,'ADD'),2);
});
function farmQuery(){return async(text)=>{
  if(text.includes('LEFT JOIN ShipmentFarm'))return{recordset:[{CustKey:1,ProdKey:53,SdetailKey:5,FarmKey:1,FarmName:'Ayura',ShipmentQuantity:5}]};
  if(text.includes('FROM ViewWarehouse'))return{recordset:[{FarmKey:1,FarmName:'Ayura',FarmCode:'Ayu'},{FarmKey:2,FarmName:'Matina',FarmCode:'Mat'}]};
  if(text.includes('FROM Product'))return{recordset:[product]};throw Error(text);
};}
const emptyBook=()=>({SheetNames:['카네이션'],Sheets:{카네이션:XLSX.utils.aoa_to_sheet([['품목']])}});
test('ADD preserves partial old farms, adds only explicit increments, exposes unassigned and blocks stale/overallocation',async()=>{
  const p=await preview();await farms.buildFarmImportPreview({XLSX,workbook:emptyBook(),preview:p,text:'-시험업체\n애플티 3박스(아유라)',queryFn:farmQuery(),overrides:{targets:{'line-2':'1|53'}}});
  assert.deepEqual(p.farmImport.errors,[]);assert.equal(p.rows[0].farmAssignments[0].shipmentQuantity,8);assert.equal(p.rows[0].unassignedQty,5);assert.equal(p.rows[0].farmAddedAssignments[0].shipmentQuantity,3);
  const noFarm=await preview();await farms.buildFarmImportPreview({XLSX,workbook:emptyBook(),preview:noFarm,queryFn:farmQuery()});assert.equal(noFarm.rows[0].unassignedQty,8);assert.equal(noFarm.rows[0].farmAssignments,undefined);
  const old=await preview({kind:'REPLACE',qty:13});await farms.buildFarmImportPreview({XLSX,workbook:emptyBook(),preview:old,queryFn:farmQuery()});assert.ok(old.farmImport.errors.length);
  await assert.rejects(farms.validateImportFarmRow(farmQuery(),p.rows[0],{shipmentFarmRows:[{FarmKey:1,ShipmentQuantity:8}]},13),/변경/);
  assert.throws(()=>mode.additiveFarmTotal([{shipmentQuantity:14}],13),/초과/);
});
async function sourceWorkbook(){const w=new ExcelJS.Workbook(),s=w.addWorksheet('카네이션');s.columns=[{width:25},{width:20},{width:20},{width:20}];s.addRows([['시험'],['품목','시험업체','시험업체','주문'],[],['Apple Tea',3,2,{formula:'SUM(B4:C4)',result:5}]]);s.getRow(1).height=141;s.pageSetup={paperSize:8,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:1};return Buffer.from(await w.xlsx.writeBuffer());}
test('FINAL/ADDITIONAL downloads retain geometry, add baseline once, refresh formula caches and roundtrip kind',async()=>{
  const buffer=await sourceWorkbook(),book=XLSX.read(buffer,{type:'buffer'}),p=await preview({rows:[input(3),{...input(2),colNo:3}]});
  for(const kind of ['FINAL','ADDITIONAL']){
    const plan=files.allocationWorkbookPlan(p,book,kind),out=await files.exportAllocationWorkbook(buffer,plan),opened=XLSX.read(out,{type:'buffer'});
    assert.equal(opened.Sheets['카네이션'].B4.v,kind==='FINAL'?13:3);assert.equal(opened.Sheets['카네이션'].C4.v,2);assert.equal(opened.Sheets['카네이션'].D4.v,kind==='FINAL'?15:5);
    const metadata=mode.readImportFileMetadata(opened);assert.equal(metadata.kind,kind);
    assert.equal(mode.resolveImportMode({metadata,year:'2026',week:'46-01',earlyImportMode:'ALREADY_EXCLUDED',addToExisting:kind==='ADDITIONAL'}),kind==='FINAL'?'FINAL':'ADD');
    assert.throws(()=>mode.resolveImportMode({metadata,year:'2026',week:'46-01',earlyImportMode:'ALREADY_EXCLUDED',addToExisting:kind==='FINAL'}),/체크|해제/);
    assert.throws(()=>mode.resolveImportMode({metadata,year:'2025',week:'46-01',earlyImportMode:'ALREADY_EXCLUDED'}),/연도/);
    const a=await JSZip.loadAsync(buffer),b=await JSZip.loadAsync(out),old=await a.file('xl/worksheets/sheet1.xml').async('string'),changed=await b.file('xl/worksheets/sheet1.xml').async('string');
    for(const tag of ['dimension','pageSetup','pageMargins','cols']){const re=new RegExp('<'+tag+'\\b[^>]*(?:/>|>[\\s\\S]*?</'+tag+'>)');assert.equal(old.match(re)?.[0],changed.match(re)?.[0],tag);}
  }
});
test('formula caches keep dependent arithmetic current and reject unknown functions rather than a stale total',()=>{
  const sheet={B4:{v:13},C4:{v:2},D4:{f:'SUM(B4:C4)',v:5},E4:{f:'D4-2',v:3},F4:{f:'UNKNOWN(B4)',v:999}};
  assert.equal(files.formulaCacheValue(sheet,'D4'),15);assert.equal(files.formulaCacheValue(sheet,'E4'),13);assert.equal(files.formulaCacheValue(sheet,'F4'),null);
});
test('reverse-converted fractional final quantities remain visible instead of using the original integer number format',async()=>{
  const w=new ExcelJS.Workbook(),sheet=w.addWorksheet('카네이션');sheet.getColumn(2).width=20;sheet.getCell('B4').value=3;sheet.getCell('B4').numFmt='#,##0';
  sheet.getCell('D4').value={formula:'B4+0',result:3};sheet.getCell('D4').numFmt='#,##0';
  const buffer=Buffer.from(await w.xlsx.writeBuffer()),book=XLSX.read(buffer,{type:'buffer'});
  const p={distributionMode:'ADD',orderYear:'2026',week:'46-01',rows:[{cells:['카네이션!R4C2'],sourceQuantityFactor:16,excelQty:3,inputQty:48,currentOutQty:13,uploadQty:61}]};
  const out=await files.exportAllocationWorkbook(buffer,files.allocationWorkbookPlan(p,book,'FINAL'));
  const opened=XLSX.read(out,{type:'buffer',cellNF:true});assert.equal(opened.Sheets['카네이션'].B4.v,3.8125);assert.match(opened.Sheets['카네이션'].B4.w,/3\.8125/);assert.equal(opened.Sheets['카네이션'].D4.v,3.8125);assert.match(opened.Sheets['카네이션'].D4.w,/3\.8125/);
});
