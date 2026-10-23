import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import { parseDutchPivotWorkbook } from '../lib/dutchVolumePrice.js';
import { prepareDutchVolumeWorkbook, importDutchVolumeWorkbook } from '../lib/dutchVolumeWorkbook.js';
import { projectDutchInlineCustomers } from '../lib/dutchInlineCustomer.js';
import { addDutchMatrixProduct } from '../lib/dutchMatrixProduct.js';

const name='네덜란드';
const sheet=XLSX.utils.aoa_to_sheet([
 ['43-02','','','경부선','지방','지방'],['','','','월','화','화'],
 ['꽃','품목명','칼라','업체 A','업체 B','업체 C','주문','입고'],
 ['클라이언트 번호','','','CL1','CL2','CL3'],
 ['수국','Blue','블루',2,3,4,9,12],['수국','White','화이트','','','',0,7],
 ['합계','','',2,3,4,9,19],
]);
const workbook={SheetNames:[name],Sheets:{[name]:sheet}};
const parsed=parseDutchPivotWorkbook(XLSX,workbook);
assert.equal(parsed.entries.length,3);
assert.equal(parsed.entries[0].sourceRow,4);
assert.equal(parsed.entries[0].sourceCustomer,'업체 A\nCL1');
const entries=parsed.entries.map((e,i)=>({...e,custKey:i+1,prodKey:101,unit:'송이',...(i===1?{customerArea:'경부선'}:{})}));
// Moving C into the first area must move its values and metadata, never swap customers.
entries[2].customerArea='경부선';entries[0].customerArea='지방';
const projection=projectDutchInlineCustomers(XLSX,workbook,entries);
assert.equal(projection.workbook.Sheets[name].D3.v,'업체 B');
assert.equal(projection.originalAddress(name,'D5'),'E5');
for(const year of [2025,2026]) {
 const prepared=prepareDutchVolumeWorkbook(XLSX,workbook,entries,{},undefined,{year,week:'43-02'});
 const restored=importDutchVolumeWorkbook(XLSX,XLSX.read(XLSX.write(prepared.workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),{year,week:'43-02'});
 assert.deepEqual(restored.entries.map(e=>[e.custKey,e.quantity]),[[2,3],[3,4],[1,2]]);
 assert.equal(prepared.workbook.Sheets[name].H6.v,7,'arrival-only quantity preserved');
 assert.equal(prepared.workbook.Sheets[name].D4.v,'CL2','CL is a separate real cell');
 assert.throws(()=>importDutchVolumeWorkbook(XLSX,prepared.workbook,{year:year+1,week:'43-02'}),/차수/);
}
const added=addDutchMatrixProduct(XLSX,workbook,entries,name,{ProdKey:102,ProdName:'Pink',CounName:'네덜란드',FlowerName:'수국',OutUnit:'송이'});
assert.equal(added.workbook.Sheets[name].B7.v,'Pink');
assert.equal(added.workbook.Sheets[name].A8.v,'합계');
assert.equal(added.entries.filter(e=>e.prodKey===102).length,3);
assert.ok(added.entries.filter(e=>e.prodKey===102).every(e=>e.quantity===0));
const addedPrepared=prepareDutchVolumeWorkbook(XLSX,added.workbook,added.entries.map(e=>e.prodKey===102?{...e,quantity:5}:e),{},undefined,{year:2026,week:'43-02'});
const addedRestored=importDutchVolumeWorkbook(XLSX,addedPrepared.workbook,{year:2026,week:'43-02'});
assert.equal(addedRestored.entries.filter(e=>e.prodKey===102).reduce((sum,e)=>sum+e.quantity,0),15);
assert.equal(addDutchMatrixProduct(XLSX,added.workbook,added.entries,name,{ProdKey:102,ProdName:'Pink',CounName:'네덜란드'}).duplicate,true);
assert.equal(addDutchMatrixProduct(XLSX,workbook,entries,name,{ProdKey:103,ProdName:'White',CounName:'네덜란드'}).duplicate,true,'incoming-only row is not duplicated');
const incoming=structuredClone(workbook);
for(const address of ['D5','E5','F5'])delete incoming.Sheets[name][address];
assert.equal(parseDutchPivotWorkbook(XLSX,incoming,{allowEmpty:true}).entries.length,0);
assert.equal(incoming.Sheets[name].H6.v,7);
console.log('Dutch matrix separate CL, region identity, incoming-only, product addition, cross-year XLSX roundtrip passed');
