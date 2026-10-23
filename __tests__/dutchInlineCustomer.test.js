import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import { addDutchInlineCustomer, projectDutchInlineCustomers } from '../lib/dutchInlineCustomer.js';
import { buildDutchPreviewEntries, readDutchDraft, writeDutchDraft } from '../lib/dutchVolumeDraft.js';
import { normalizeDutchWorkSnapshot } from '../lib/dutchVolumeWorkStore.js';
import { buildDutchQuantitySummaryValues } from '../lib/dutchSheetQuantityEdit.js';

const sheetName='네덜란드';
const sheet=XLSX.utils.aoa_to_sheet([
  ['43-02','','','경부선','','지방','',''],
  ['','','','월','','화','',''],
  ['꽃','품목명','칼라','가게\nCL1','품목명','다른가게\nCL2','주문','입고'],
  ['백합','Long lily name','화이트',5,'Long lily name',3,8,10],
  ['백합','Pink lily','핑크',2,'Pink lily',0,2,4],
  ['합계','','',7,'',3,10,14],
]);
const workbook={SheetNames:[sheetName],Sheets:{[sheetName]:sheet}};
const entries=[{id:'original',sheetName,sourceRow:3,sourceColumn:3,cellAddress:'D4',product:'백합',color:'Long lily name',sourceFlower:'백합',sourceItem:'Long lily name',sourceCustomer:'가게\nCL1',customer:'가게',custKey:1,prodKey:50,quantity:5,layoutVersion:3},
 {id:'other',sheetName,sourceRow:3,sourceColumn:5,cellAddress:'F4',product:'백합',color:'Long lily name',sourceCustomer:'다른가게\nCL2',customer:'다른가게',custKey:2,quantity:3,layoutVersion:3}];
const baseline=JSON.stringify({workbook,entries});
const added=addDutchInlineCustomer(XLSX,workbook,entries,sheetName,{custKey:3,custName:'새업체',area:'경부선',orderCode:'CL3'});
assert.equal(added.entries.length,4);
assert.equal(added.entries[2].quantity,0);
assert.equal(added.entries[2].prodKey,50);
assert.equal(addDutchInlineCustomer(XLSX,workbook,added.entries,sheetName,{custKey:3,custName:'새업체'}).duplicate,true);
assert.throws(()=>addDutchInlineCustomer(XLSX,workbook,entries,sheetName,{custKey:0,custName:'무효'}));
const edited=added.entries.map(row=>row.id===added.focusId ? {...row,quantity:12} : row);
const projection=projectDutchInlineCustomers(XLSX,workbook,edited);
const target=projection.workbook.Sheets[sheetName];
assert.equal(target.E3.v,'새업체\nCL3');
assert.equal(target.G3.v,'다른가게\nCL2');
assert.equal(projection.originalAddress(sheetName,'G4'),'F4');
assert.equal(projection.originalAddress(sheetName,'E4'),null);
assert.equal(buildDutchQuantitySummaryValues(XLSX,target,sheetName,projection.entries).get('H4'),20);
assert.equal(JSON.stringify({workbook,entries}),baseline,'base workbook and source cells preserved');
const newRegion=addDutchInlineCustomer(XLSX,workbook,edited,sheetName,{custKey:4,custName:'호텔업체',area:'호텔'});
assert.equal(projectDutchInlineCustomers(XLSX,workbook,newRegion.entries).workbook.Sheets[sheetName].H3.v,'호텔업체');
for(const year of [2025,2026]) {
 const memory=new Map(),storage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)};
 writeDutchDraft(storage,`${year}:43-02`,edited,{});
 const restored=readDutchDraft(storage,`${year}:43-02`,entries,()=>({}));
 assert.equal(restored.entries.find(row=>row.id===added.focusId).quantity,12);
 assert.equal(readDutchDraft(storage,`${year+1}:43-02`,entries,()=>({})).entries.length,2);
 const saved=normalizeDutchWorkSnapshot({name:'시험',sourceMode:'LIVE',fileName:'test.xlsx',orderYear:year,orderWeek:'43-02',workbook,entries:restored.entries,prices:{},sourceIdentity:`${year}:43-02`});
 assert.equal(saved.entries[2].customerArea,'경부선');
 assert.equal(projectDutchInlineCustomers(XLSX,saved.workbook,saved.entries).workbook.Sheets[sheetName].E3.v,'새업체\nCL3');
 const payload=buildDutchPreviewEntries(saved.entries,{},()=> 'price');
 assert.equal(payload.find(row=>row.id===added.focusId).quantity,12);
 assert.equal(payload.find(row=>row.id===added.focusId).custKey,3);
}
console.log('dutchInlineCustomer: region projection, duplicate, source preservation, totals, saved/local roundtrip, cross-year and apply payload passed');
