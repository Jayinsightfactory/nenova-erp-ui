import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exactNzVarietyProduct} from '../lib/packingOriginEvidence.js';
import {resolveInvoiceHeader,isNzBloomSupplierMatch} from '../lib/invoiceReceiptAutoFill.js';
import {applyNzCommonUnits,fillConfirmedNzReceiptLine,nzConfirmedBunchQuantity,nzReceiptLineReview} from '../lib/nzReceiptUnits.js';

test('NZ common evidence applies only to selected compatible lines and does not overwrite overrides',()=>{
  const rows=[[240,7.57,1816.8],[200,4.7,940],[300,4.99,1497]].map(([units,unitPrice,lineAmount],i)=>({
    lineId:String(i),lineNo:i+1,currency:'NZD',unitPrice,lineAmount,
    sourceEvidence:{nzPrintedUnits:units,sourceFieldStates:{unitPrice:{rawValue:unitPrice},lineAmount:{rawValue:lineAmount}}},
  }));
  const settings={unit:'송이',reason:'TEST_ONLY verified packing',ratio:'5'};
  const result=applyNzCommonUnits(rows,['0','1','2'],settings);
  assert.equal(result.applied,3);
  assert.deepEqual(result.lines.map(line=>[line.stemQuantity,line.bunchQuantity]),[[240,48],[200,40],[300,60]]);
  assert.deepEqual(result.lines.map(line=>line.lineAmount),[1816.8,940,1497]);
  const override={...rows[1],priceUnit:'단',reviewed:{nzUnitReason:'manual exception'}};
  const scoped=applyNzCommonUnits([rows[0],override,rows[2]],['0','1'],settings);
  assert.deepEqual(scoped.skipped,[2]);
  assert.equal(scoped.lines[1],override);
  assert.equal(scoped.lines[2],rows[2]);
  assert.equal(applyNzCommonUnits(rows,['0'],{...settings,ratio:'7'}).applied,0);
  assert.equal(applyNzCommonUnits(rows,['0'],{...settings,reason:''}).applied,0);
});
import {toReceiptDraftPayload} from '../lib/importPackingReceiptAdapter.js';

test('NZ automatic match requires a unique active country, exact variety, grade and both sizes',()=>{
  const row={variety:'Red Charm',description:'Peony AAA Hy.Red 50cm (45mm bud)'};
  const exact={ProdKey:2658,country:'NZ',selectable:true,ProdName:'Peony / New Zealand. Red Charm AAA (50cm/4.5cm)'};
  const wrong={...exact,ProdKey:2622,ProdName:exact.ProdName.replace('50cm','40cm')};
  assert.equal(exactNzVarietyProduct(row,[wrong,exact]),exact);
  assert.equal(exactNzVarietyProduct(row,[wrong]),null);
  assert.equal(exactNzVarietyProduct(row,[{...exact,isDeleted:1}]),null);
  assert.equal(exactNzVarietyProduct(row,[{...exact,CounName:'호주'}]),null);
  assert.equal(exactNzVarietyProduct(row,[{...exact,selectable:false}]),null);
  assert.equal(exactNzVarietyProduct(row,[exact,{...exact,ProdKey:9}]),null);
  assert.equal(exactNzVarietyProduct({...row,variety:'Madame Claude Tain'},[exact]),null);
});

test('NZ applies printed quantity only with an explicit unit decision and intact NZD facts; preserves manual and zero',()=>{
  const line={prodKey:1,priceUnit:'송이',currency:'NZD',unitPrice:7.57,lineAmount:1816.8,boxQuantity:3,
    sourceEvidence:{nzPrintedUnits:240,sourceFieldStates:{unitPrice:{rawValue:'7.57'},lineAmount:{rawValue:'1,816.80'}}},
    reviewed:{nzUnitReason:'confirmed packing document',nzStemsPerBunch:'5'}};
  const filled=fillConfirmedNzReceiptLine(line);
  assert.deepEqual([filled.boxQuantity,filled.bunchQuantity,filled.stemQuantity,filled.priceUnit],[3,48,240,'송이']);
  assert.deepEqual(nzReceiptLineReview(filled),{product:'',units:'',conversion:''});
  for(const edited of [{...line,stemQuantity:0},{...line,stemQuantity:239},{...line,lineAmount:1800},
    {...line,reviewed:{nzStemsPerBunch:'5'}},{...line,currency:'AUD'}]) assert.equal(fillConfirmedNzReceiptLine(edited),edited);
  assert.equal(fillConfirmedNzReceiptLine({...line,bunchQuantity:49}).bunchQuantity,49);
  assert.ok(nzReceiptLineReview({...filled,bunchQuantity:49}).conversion);
});

test('verified NZ alias needs origin; invoice date is not the actual receipt date',()=>{
  const doc={orderYear:'2026',rawMetadata:{supplier:'New Zealand Bloom Ltd',invoiceDate:'2026-11-20'},reviewedMetadata:{country:'NZ'}};
  const farm={FarmKey:11,FarmName:'NZ Bloom',CounName:'뉴질랜드'};
  assert(isNzBloomSupplierMatch(doc.rawMetadata.supplier,farm.FarmName));
  assert(isNzBloomSupplierMatch(doc.rawMetadata.supplier,'NZ Blooms'));
  assert(!isNzBloomSupplierMatch(doc.rawMetadata.supplier,'NZ Bloom Trading'));
  assert.equal(resolveInvoiceHeader(doc,[farm]).farm.farmKey,11);
  assert.equal(resolveInvoiceHeader(doc,[farm]).inputDate,'');
  assert.equal(resolveInvoiceHeader(doc,[{...farm,CounName:'호주'}]).farm,null);
  assert.equal(resolveInvoiceHeader(doc,[farm,{...farm,FarmKey:12}]).farm,null);
});

test('3 boxes / 240 stems / 5 stems per bunch produces 48 in draft without altering source price',()=>{
  const line={lineId:'1',lineNo:1,stemQuantity:'240',boxQuantity:'3',priceUnit:'송이',currency:'NZD',unitPrice:7.57,lineAmount:1816.8,
    sourceEvidence:{nzPrintedUnits:240}, reviewed:{nzStemsPerBunch:'5',nzUnitReason:'TEST_ONLY confirmed packing evidence'}};
  assert.equal(nzConfirmedBunchQuantity(line).quantity,48);
  const [saved]=toReceiptDraftPayload({reviewedMetadata:{country:'NZ'},lines:[line]}).lines;
  assert.deepEqual([saved.boxQuantity,saved.bunchQuantity,saved.stemQuantity,saved.priceUnit,saved.unitPrice,saved.lineAmount],[3,48,240,'송이',7.57,1816.8]);
  assert.equal(nzConfirmedBunchQuantity({...line,priceUnit:'단'}).quantity,null);
  assert.equal(nzConfirmedBunchQuantity({...line,reviewed:{...line.reviewed,nzStemsPerBunch:'7'}}).quantity,null);
});

test('receipt confirmation never opens a placeholder; only verified receipt has explicit link',()=>{
  const ui=readFileSync(new URL('../components/import-tools/InvoiceReceiptWorkbench.js',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/window\.open\(['"]about:blank/);
  assert.match(ui,/currentRevisionCommitted && Number\(documentValue\.warehouseKey\)>0 && <a[^\n]+입고관리에서 확인/);
});
