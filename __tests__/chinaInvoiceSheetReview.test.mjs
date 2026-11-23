import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import {chinaInvoiceSheetList,reviewCloudChinaSheet,validateCloudMatchReview} from '../lib/chinaInvoiceSheetReview.js';
import {parseChinaInvoiceWorkbook} from '../lib/importChinaInvoice.js';

test('explicit CLOUD sheet review separates checked subtotal, zeros and absent quantity units',()=>{
  const sheet=XLSX.utils.aoa_to_sheet([
    ['Items','picture','specification','Quantity','unit price','packing fee','total(CNY)','Supplier'],
    ['Flower',null,'A',2,3,0,6,'Fixture'],
    ['Flower Cost',null,null,2,null,null,6],
    ['TOTAL',null,null,null,null,null,6],
  ]);
  sheet.G2.f='D2*E2+F2*D2';sheet.G3.f='SUM(G2:G2)';
  const book={SheetNames:['Sheet1','Sheet2','Sheet3'],Sheets:{Sheet1:sheet,Sheet2:{},Sheet3:{}},
    Workbook:{Sheets:[{Hidden:0},{Hidden:0},{Hidden:1}]}};
  assert.deepEqual(chinaInvoiceSheetList(book).map(row=>[row.name,row.hidden,row.empty]),
    [['Sheet1',false,false],['Sheet2',false,true],['Sheet3',true,true]]);
  const reviewed=reviewCloudChinaSheet(XLSX,book,'Sheet1');
  assert.deepEqual([reviewed.currency,reviewed.printedTotal,reviewed.summed,reviewed.difference],['CNY',6,6,0]);
  assert.equal(reviewed.rows[0].packing,0);
  assert.equal(reviewed.rows[1].subtotal,true);
  assert(validateCloudMatchReview(reviewed,{},'').issues.length>0);
  const review={2:{kind:'goods',quantityUnit:'단',priceUnit:'단'}};
  assert.deepEqual(validateCloudMatchReview(reviewed,review,'TEST_ONLY 근거').issues,[]);
  assert.equal(validateCloudMatchReview(reviewed,review,'TEST_ONLY 근거').goods[0].quantity,2);
  assert(validateCloudMatchReview(reviewed,{2:{...review[2],priceUnit:'송이'}},'TEST_ONLY 근거').issues.length>0);
});

test('a selected unrecognized sheet never falls back to another invoice sheet',()=>{
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Not an invoice']]),'Sheet1');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['INVOICE']]),'INVOICE');
  const base64=XLSX.write(book,{bookType:'xlsx',type:'base64'});
  assert.throws(()=>parseChinaInvoiceWorkbook(XLSX,base64,{sheetName:'Sheet1'}),/exactly one INVOICE/);
  assert.throws(()=>parseChinaInvoiceWorkbook(XLSX,base64,{sheetName:'Absent'}),/missing or hidden/);
});
