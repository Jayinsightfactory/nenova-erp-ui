import { chinaSearchCandidates } from '../lib/chinaSearchCandidates.js';
import assert from 'node:assert/strict';
import { applyChinaInvoiceCells, chinaDistributionEntries, chinaEditableCustomers, chinaProductDifferences, remapChinaProduct } from '../lib/chinaVolumeEditing.js';
const customers = [{custKey:1,custName:'A',area:'서울'},{custKey:2,custName:'B',area:'부산'}];
const products = [{prodKey:11,prodName:'P',unit:'박스',country:'중국',ordersByCustKey:{1:10,2:5}}, {prodKey:12,prodName:'Q',unit:'박스',country:'중국',ordersByCustKey:{}}];
const cells={'1:11':{quantity:'3'},'2:11':{quantity:''}};
assert.deepEqual(chinaDistributionEntries(cells,products,customers).map(e=>e.quantity),[3,0]);
assert.throws(()=>chinaDistributionEntries({'1:11':{quantity:'abc'}},products,customers));
assert.throws(()=>chinaDistributionEntries({'1:11':{quantity:-1}},products,customers));
assert.throws(()=>chinaDistributionEntries({'9:11':{quantity:1}},products,customers));
assert.throws(()=>chinaDistributionEntries({},products,customers));
const moved=remapChinaProduct({cells,oldProduct:products[0],newProduct:products[1],customers});
assert.equal(moved['1:11'].quantity,0);assert.equal(moved['1:12'].quantity,3);
assert.equal(products[0].ordersByCustKey[1],10,'source order never changes');
assert.throws(()=>remapChinaProduct({cells,oldProduct:products[0],newProduct:{...products[1],unit:'송이'},customers}));
const invoice=[{sourceRow:1,quantity:8,cellKey:'1:11',mappingStatus:'MATCHED',allocations:[],distributions:[{cellKey:'1:11',quantity:3},{cellKey:'2:12',quantity:5}]}];
const diffs=chinaProductDifferences(products,customers,invoice);
assert.deepEqual(diffs.map(d=>d.difference),[-12,5]);
const fresh=applyChinaInvoiceCells({'1:11':{quantity:8,packingQuantity:8,sourceRows:[1]},'2:11':{quantity:0,quantityEdited:true}},invoice,{rows:products,customers});
assert.equal(fresh['1:11'].quantity,3);assert.equal(fresh['2:12'].quantity,5);assert.equal(fresh['2:11'].quantity,0);
const rematched=applyChinaInvoiceCells(fresh,[{...invoice[0],distributions:[{cellKey:'2:12',quantity:8}]}],{rows:products,customers});
assert.equal(rematched['1:11'].quantity,0);assert.equal(rematched['2:12'].quantity,8);
assert.equal(chinaEditableCustomers(customers,new Set(['1','2']),{1:'강원'})[0].area,'강원');
console.log('PASS China draft blank→0, rematch old zero/new value, immutable order, split reconciliation, stale invoice cells, region');

const catalog = [
  {value:11,label:'CHINA / 퀵 샌드 (Quick Sand) 70cm · 단'},
  {value:12,label:'CHINA / 퀵샌드 50cm · 단'},
  {value:13,label:'CHINA / Diana 50cm · 단'},
  {value:14,label:'주광농원 · 경부선 · YCL2'},
];
assert.deepEqual(chinaSearchCandidates(catalog,'퀵샌드').map(x=>x.value),[11,12]);
assert.deepEqual(chinaSearchCandidates(catalog,'quick 70').map(x=>x.value),[11]);
assert.deepEqual(chinaSearchCandidates(catalog,'ＹＣＬ２').map(x=>x.value),[14]);
assert.deepEqual(chinaSearchCandidates(catalog,'주광 경부').map(x=>x.value),[14]);
assert.deepEqual(chinaSearchCandidates(catalog,'없는품목'),[]);
assert.deepEqual(chinaSearchCandidates(catalog,' '),catalog);
assert.equal(catalog.length,4,'candidate lookup never mutates DB catalog');
console.log('PASS China live search: whitespace, multiple words, CL/case/fullwidth, no match and immutable catalog');
