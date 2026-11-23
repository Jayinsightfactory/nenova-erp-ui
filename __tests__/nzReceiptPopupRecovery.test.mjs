import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exactNzVarietyProduct} from '../lib/packingOriginEvidence.js';
import {resolveInvoiceHeader,isNzBloomSupplierMatch} from '../lib/invoiceReceiptAutoFill.js';

test('NZ automatic match requires a unique active country, exact variety, grade and both sizes',()=>{
  const row={variety:'Red Charm',description:'Peony AAA Hy.Red 50cm (45mm bud)'};
  const exact={ProdKey:2658,country:'NZ',selectable:true,ProdName:'Peony / New Zealand. Red Charm AAA (50cm/4.5cm)'};
  const wrong={...exact,ProdKey:2622,ProdName:exact.ProdName.replace('50cm','40cm')};
  assert.equal(exactNzVarietyProduct(row,[wrong,exact]),exact);
  assert.equal(exactNzVarietyProduct(row,[wrong]),null);
  assert.equal(exactNzVarietyProduct(row,[{...exact,selectable:false}]),null);
  assert.equal(exactNzVarietyProduct(row,[exact,{...exact,ProdKey:9}]),null);
  assert.equal(exactNzVarietyProduct({...row,variety:'Madame Claude Tain'},[exact]),null);
});

test('verified NZ alias needs origin; invoice date is not the actual receipt date',()=>{
  const doc={orderYear:'2026',rawMetadata:{supplier:'New Zealand Bloom Ltd',invoiceDate:'2026-11-20'},reviewedMetadata:{country:'NZ'}};
  const farm={FarmKey:11,FarmName:'NZ Bloom',CounName:'뉴질랜드'};
  assert(isNzBloomSupplierMatch(doc.rawMetadata.supplier,farm.FarmName));
  assert(!isNzBloomSupplierMatch(doc.rawMetadata.supplier,'NZ Bloom Trading'));
  assert.equal(resolveInvoiceHeader(doc,[farm]).farm.farmKey,11);
  assert.equal(resolveInvoiceHeader(doc,[farm]).inputDate,'');
  assert.equal(resolveInvoiceHeader(doc,[{...farm,CounName:'호주'}]).farm,null);
  assert.equal(resolveInvoiceHeader(doc,[farm,{...farm,FarmKey:12}]).farm,null);
});

test('receipt confirmation never opens a placeholder; only verified receipt has explicit link',()=>{
  const ui=readFileSync(new URL('../components/import-tools/InvoiceReceiptWorkbench.js',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/window\.open\(['"]about:blank/);
  assert.match(ui,/currentRevisionCommitted && Number\(documentValue\.warehouseKey\)>0 && <a[^\n]+입고관리에서 확인/);
});
