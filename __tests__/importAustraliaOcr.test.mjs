import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAustraliaOcr} from '../lib/importAustraliaOcr.js';
function fixture(){
 const items=[],add=(str,x,y,width=50)=>items.push({str,x,y,width,height:8,confidence:1});
 add('Premium Greens',20,790);add('Tax Invoice No',300,750,70);add('41002',400,750);
 add('Invoice Date',300,735,70);add('26-Oct-2026',400,735);add('Total in AUD$',480,700);
 [['Barker bush (5 stems/bunch)',20,500,14.5,7250],['Woolly bush (5 stems/bunch)',6,180,8.5,1530],['Woolly bush (5 stems/bunch)',4,120,8.5,1020]].forEach(([name,box,qty,price,money],i)=>{
  const y=650-i*35;add(name,20,y,240);add(String(box),300,y,10);add(String(qty),350,y,20);add(String(price),410,y,30);add('bunch',450,y,20);add(String(money),500,y,40);if(i>0)add(i===1?'Adenanthos - Green':'Adenanthos - Red Tip',20,y-12,230);
 });
 add('Number of Boxes',150,500,70);add('30',300,500,15);add('Invoice Sub Total',370,500,90);add('9800',500,500,40);
 const second=[{str:'Consignment No:',x:20,y:750,width:80,height:8},{str:'081-6368-8774',x:130,y:750,width:90,height:8},{str:'Invoice Total in AUD$',x:300,y:710,width:100,height:8},{str:'9800',x:500,y:710,width:40,height:8}];
 return {sourceHash:'a'.repeat(64),pages:[{page:1,width:612,height:842,items},{page:2,width:612,height:842,items:second}]};
}
test('AU boxes/bunches/prices and independent total reconcile; both Woolly rows retained',()=>{
 const r=inspectAustraliaOcr(fixture());assert.ok(r.result,r.reason);const i=r.result.invoices[0];assert.equal(i.products.length,3);assert.equal(i.products[1].pcs,6);assert.equal(i.products[1].total_bunch,180);assert.equal(i.products[1].bunch_st,5);assert.match(i.products[1].source_additional_description,/Green/);assert.match(i.products[2].source_additional_description,/Red Tip/);assert.equal(i.invoice_total,9800);
});
test('high-confidence numeric error cannot pass',()=>{const x=fixture();x.pages[0].items.find(i=>i.str==='500').str='501';assert.equal(inspectAustraliaOcr(x).result,null);});
test('second-page total contradiction cannot pass',()=>{const x=fixture();x.pages[1].items.find(i=>i.str==='9800').str='9900';assert.equal(inspectAustraliaOcr(x).result,null);});
test('missing printed stems-per-bunch not defaulted',()=>{const x=fixture();x.pages[0].items.find(i=>i.str.startsWith('Barker')).str='Barker bush';assert.equal(inspectAustraliaOcr(x).result,null);});
