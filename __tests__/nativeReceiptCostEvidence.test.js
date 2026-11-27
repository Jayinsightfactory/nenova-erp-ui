import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {nativeCostSourceFingerprint,resolveNativeCostEvidence} from '../lib/nativeReceiptCostEvidence.js';
import {readNativeCostSource,nativeCostDocument,calculateNativeCost} from '../lib/nativeReceiptCost.js';
import {createNativeCostWorkbook} from '../lib/invoiceReceiptCostExport.js';
import {CLOUD_COST_FORMULA,CLOUD_CUSTOMS_DEFAULTS} from '../lib/chinaCloudCost.js';

function fixture(){
 const h={WarehouseKey:99001,OrderYear:'2026',OrderWeek:'46-02',FarmName:'Cloudland',InvoiceNo:'TEST_ONLY',FileName:'TEST_ONLY.xlsx',InputDate:'2026-11-13',GrossWeight:null,ChargeableWeight:null};
 const row=(key,code,name,q,p,extra={})=>({...h,WdetailKey:key,ProdKey:key,OrderCode:code,ProdName:name,OutUnit:'단',CounName:'중국',FlowerName:'기타',BoxQuantity:1,BunchQuantity:q,SteamQuantity:q,SteamOf1Box:1,SteamOf1Bunch:1,OutQuantity:q,UPrice:p,TPrice:q*p,ProductDeleted:false,...extra});
 const rows=[row(1,'1','PETAL CHINA',40,7.5),row(2,'2','POPULUS GRAIN',15,18),row(3,'3','운송료',1,24087,{CounName:'국내',OutUnit:'박스'}),...['4','5'].map((code,i)=>row(4+i,code,null,1,0,{ProdKey:null,OutUnit:null,OutQuantity:null,SteamQuantity:2543}))];
 const e={id:'TEST_ONLY',scope:{warehouseKey:99001,orderYear:'2026',orderWeek:'46-02',farmName:'Cloudland',invoiceNo:'TEST_ONLY',fileName:'TEST_ONLY.xlsx'},source:{sha256:'a'.repeat(64),sheet:'CN-CLD'},rowCount:5,nativeDigest:nativeCostSourceFingerprint(rows),weights:[{key:4,orderCode:'4',kind:'GW',kg:2543,name:'Gross weigth',cells:'B52:J52'},{key:5,orderCode:'5',kind:'CW',kg:2543,name:'Chargeable weigth',cells:'B53:J53'}],freight:{key:3,amount:24087,currency:'CNY'},categories:[{key:1,code:6},{key:2,code:21}]};
 e.exchangeRate={value:210,currency:'CNY',sourceHash:'b'.repeat(64),sheet:'46-2 CLOUD cbm ',cell:'C7'};
 return {rows,e};
}

test('exact reviewed source separates weight pair only in cost source, preserving native prices and source rows',async()=>{
 const {rows,e}=fixture(),before=JSON.stringify(rows),types={Int:1,NVarChar:n=>n};
 const queryFn=async(sql,params)=>{assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);if(sql.includes('invoice-expenses:committed-scope'))return{recordset:[]};assert.equal(params.orderYear.value,'2026');return{recordset:rows};};
 const source=await readNativeCostSource({queryFn,types,input:{warehouseKey:99001,orderYear:'2026',orderWeek:'46-02'},evidenceResolver:r=>resolveNativeCostEvidence(r,[e])});
 assert.equal(source.lines.length,2);assert.equal(source.excluded.length,3);assert.equal(source.gw,2543);assert.equal(source.cw,2543);assert.match(source.excluded[1].name,/CN-CLD!B52:J52/);
 const document=nativeCostDocument(source,{currency:'CNY',transportMode:'AIR'}),defaults=document.reviewedMetadata.invoiceCostInput;
 assert.equal(defaults.freightAmount,24087);assert.deepEqual(defaults.lineInputs.map(l=>l.categoryCode),[6,21]);
 assert.equal(defaults.exchangeRateKRW,210);assert.equal(defaults.exchangeRateType,'WORKBOOK_REFERENCE');
 const input={...CLOUD_COST_FORMULA,...CLOUD_CUSTOMS_DEFAULTS,...defaults,formulaApplicabilityConfirmed:true,cloudCustomsMode:'FORMULA',exchangeRateKRW:210,exchangeRateType:'TEST_ONLY',costSourceId:'TEST_ONLY'};
 const result=calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:{currency:'CNY',transportMode:'AIR'},input});
 assert.equal(result.preview.status,'APPROVED',JSON.stringify(result.preview.issues));
 const book=XLSX.read(await createNativeCostWorkbook(result));assert.deepEqual(book.SheetNames,['46-2']);const s=book.Sheets['46-2'];assert.equal(s.C4.v,2543);assert.match(s.A15.v,/SHA256.*CN-CLD!B52:J52,B53:J53/);assert.match(s.A15.v,/C7=210/);
 assert.equal(s.C8.v,result.preview.totals.totalCostKRW);assert.equal(JSON.stringify(rows),before);
 const edited={...input,exchangeRateKRW:211,exchangeRateType:'WORKBOOK_REFERENCE'};
 const changed=calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:{currency:'CNY',transportMode:'AIR'},input:edited});
 assert.equal(changed.input.exchangeRateType,'USER_INPUT');assert.equal(edited.exchangeRateType,'WORKBOOK_REFERENCE');
});

test('each financial/identity/shape near-miss stays unresolved even if a candidate digest is refreshed',()=>{
 for(const mutate of [r=>r[3].TPrice=1,r=>r[3].UPrice=1,r=>r[3].ProdKey=3100,r=>r[3].ProdName='unknown goods',r=>r[3].OutUnit='단',r=>r[3].OutQuantity=1,r=>r[3].BoxQuantity=2,r=>r[3].SteamOf1Bunch=2,r=>r[3].SteamOf1Box=2,r=>r[3].BunchQuantity=2,r=>r[3].SteamQuantity=2542,r=>r[3].OrderCode='other',r=>r[0].GrossWeight=2500,r=>r[0].ChargeableWeight=2500,r=>r[2].TPrice=1]){
  const {rows,e}=fixture();mutate(rows);e.nativeDigest=nativeCostSourceFingerprint(rows);assert.equal(resolveNativeCostEvidence(rows,[e]),null);
 }
});

test('wrong year/week/receipt/original/hash, changed goods price and incomplete/ambiguous pair never inherit evidence',()=>{
 for(const mutate of [r=>r.forEach(x=>x.OrderYear='2025'),r=>r.forEach(x=>x.OrderWeek='47-02'),r=>r.forEach(x=>x.WarehouseKey=99002),r=>r.forEach(x=>x.FileName='OTHER.xlsx'),r=>r.forEach(x=>x.InvoiceNo='OTHER'),r=>r[0].TPrice+=1,r=>r.pop()]){
  const {rows,e}=fixture();mutate(rows);assert.equal(resolveNativeCostEvidence(rows,[e]),null);
 }
 for(const mutate of [e=>e.weights.pop(),e=>e.weights[1].key=e.weights[0].key,e=>e.weights[1].kind='GW',e=>e.source.sha256='invalid']){const {rows,e}=fixture();mutate(e);assert.equal(resolveNativeCostEvidence(rows,[e]),null);}
 const {rows,e}=fixture();assert.equal(resolveNativeCostEvidence(rows,[e,e]),null);
});

test('only an attested one-stem-per-bunch row changes calculation unit; native source is preserved',async()=>{
 const {rows,e}=fixture();rows[0].OutUnit='송이';e.unitConversions=[{key:1,from:'송이',to:'BUNCH',cells:'G41:J41'}];e.nativeDigest=nativeCostSourceFingerprint(rows);
 const found=resolveNativeCostEvidence(rows,[e]);assert(found);const source={country:'CN',warehouseKey:99001,lines:[{wdetailKey:1,outUnit:'송이',outQuantity:40,bunchQuantity:40}],workbookEvidence:found};
 const doc=nativeCostDocument(source,{currency:'CNY',transportMode:'AIR'});assert.equal(doc.lines[0].outUnit,'BUNCH');assert.equal(doc.lines[0].nativeOutUnit,'송이');assert.equal(source.lines[0].outUnit,'송이');
 for(const mutate of [r=>r[0].SteamOf1Bunch=2,r=>r[0].SteamQuantity=80,r=>r[0].OutQuantity=80,r=>r[0].OutUnit='박스',r=>r[0].TPrice=1]){const copy=structuredClone(rows);mutate(copy);const evidence=structuredClone(e);evidence.nativeDigest=nativeCostSourceFingerprint(copy);assert.equal(resolveNativeCostEvidence(copy,[evidence]),null);}
});
