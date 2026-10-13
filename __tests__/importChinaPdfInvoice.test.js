import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspectChinaPdfInvoice} from '../lib/importChinaPdfInvoice.js';
import {makeChinaPdfFixture} from './fixtures/chinaPdfFixture.js';

const copy=()=>structuredClone(makeChinaPdfFixture());
const item=(input,page,text)=>{
  const found=input.pages[page-1].items.find(value=>value.str===text);
  assert.ok(found,`synthetic item ${text}`);
  return found;
};
const reject=(input,label)=>{
  const parsed=inspectChinaPdfInvoice(input);
  assert.equal(parsed.result,null,label);
  assert.equal(typeof parsed.reason,'string',label);
  assert.ok(parsed.reason.length,label);
};

test('allowlisted positioned Hubfresh table preserves source quantities, identity, evidence, ambiguous date and dash price',()=>{
  const parsed=inspectChinaPdfInvoice(copy());
  assert.equal(parsed.reason,null);
  assert.equal(parsed.result.invoices.length,1);
  const invoice=parsed.result.invoices[0];
  assert.equal(invoice.source_format,'china_invoice_pdf');
  assert.equal(invoice.invoice,'SAMPLE-001');
  assert.equal(invoice.raw_date,'4/10/2026');
  assert.equal(invoice.date_order,null);
  assert.equal(invoice.currency,'CNY');
  assert.equal(invoice.products.length,3);
  assert.deepEqual(invoice.products.map(row=>[row.pcs,row.total_bunch,row.total_stems,row.gross_weight,row.u_price,row.t_price]),[
    [1,10,100,10,10,100],[2,20,200,20,10,200],[1,10,100,10,null,null],
  ]);
  assert.match(invoice.products[1].description,/\[family:ROSE\] \[length:65CM\]/);
  assert.equal(invoice.products[0].length.uncertain,true);
  assert.equal(invoice.products[2].source_description,'리모늄 (Sinensis white)');
  assert.equal(invoice.products[2].source_cells.u_price.quote,'-');
  assert.equal(invoice.products[2].source_cells.u_price.page,2);
  assert.equal(invoice.products[2].source_cells.u_price.bbox,null);
  assert.equal(invoice.products[0].source_cells.description.page,1);
  assert.match(invoice.products[0].source_cells.description.quote,/아미초/);
  assert.deepEqual([invoice.total_boxes,invoice.total_bunches,invoice.total_stems,invoice.gross_weight,invoice.item_subtotal,invoice.freight,invoice.invoice_total],[4,40,400,40,300,30,330]);
  assert.equal(invoice.vol_weight,null);
  assert.equal(invoice.additional_costs.length,2);
  assert.equal(invoice.additional_costs[0].amount,20);
  assert.equal(invoice.review_evidence.gross_weight.page,2);
  assert.equal(invoice.review_evidence.gross_weight.bbox,null);
  assert.equal(invoice.review_evidence.invoice_total.page,3);
  assert.match(invoice.metadata_evidence.date.quote,/日期DATE: 4\/10\/2026/);
  assert.equal(invoice.metadata_evidence.currency.quote,'(CNY)');
  assert.match(invoice.metadata_evidence.invoice_total.quote,/Total additional charges/);
});

test('dash price and explicit printed zero remain distinct',()=>{
  const value=copy();
  item(value,2,'-').str='0.00';
  value.pages[1].items.findLast(entry=>entry.str==='-').str='0.00';
  const result=inspectChinaPdfInvoice(value);
  assert.equal(result.reason,null);
  assert.equal(result.result.invoices[0].products[2].u_price,0);
  assert.equal(result.result.invoices[0].products[2].t_price,0);
  const mixed=copy();
  item(mixed,2,'-').str='0.00';
  reject(mixed,'only one of price/amount is missing');
});

test('unknown supplier, header, shifted columns and metadata are rejected',()=>{
  const cases=[
    value=>{item(value,1,'KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD').str='UNKNOWN SUPPLIER';},
    value=>{item(value,1,'English item name').str='Description';},
    value=>{item(value,1,'Order').x+=20;},
    value=>{value.pages[0].items.push({...item(value,1,'发票号INVOICE NO. SAMPLE-001')});},
    value=>{item(value,1,'日期DATE: 4/10/2026').str='日期DATE: 99/99/2026';},
  ];
  for(const [index,change] of cases.entries()){const value=copy();change(value);reject(value,`metadata/header case ${index}`);}
});

test('missing, duplicated, reordered pages and rows fail closed',()=>{
  const cases=[
    value=>{value.pages.splice(1,1);},
    value=>{value.pages.splice(1,0,structuredClone(value.pages[0]));},
    value=>{[value.pages[0],value.pages[1]]=[value.pages[1],value.pages[0]];},
    value=>{value.pages.push({items:[{str:'unrecognized',x:50,y:500,width:40}],text:'unrecognized'});},
    value=>{value.pages[0].items=value.pages[0].items.filter(entry=>entry.y!==362);},
    value=>{item(value,2,'配花').str='unknown category';},
  ];
  for(const [index,change] of cases.entries()){const value=copy();change(value);reject(value,`page/row case ${index}`);}
});

test('malformed numbers and independent product totals cannot produce partial results',()=>{
  const cases=[
    value=>{item(value,1,'100.00').str='1O0.00';},
    value=>{item(value,1,'200.00').str='201.00';},
    value=>{item(value,2,'400').str='401';},
    value=>{item(value,2,'40.00').str='39.99';},
    value=>{item(value,2,'300.00').str='301.00';},
  ];
  for(const [index,change] of cases.entries()){const value=copy();change(value);reject(value,`number/total case ${index}`);}
});

test('charge sequence, line multiplication, flower repeat and invoice grand total are independently checked',()=>{
  const cases=[
    value=>{item(value,2,'SEA FREIGHT CHARGE/海运费').str='花材金额';},
    value=>{item(value,3,'花材金额').str='Freight';},
    value=>{item(value,3,'330.00').str='331.00';},
    value=>{item(value,2,'20.00').str='21.00';},
    value=>{item(value,3,'300.00').str='299.00';},
    value=>{item(value,2,'2').str='3';},
  ];
  for(const [index,change] of cases.entries()){const value=copy();change(value);reject(value,`charge case ${index}`);}
});

test('text-only scan and malformed positioned items require another path without throwing',()=>{
  reject({pages:[{text:'Hubfresh invoice'},{text:'fees'}]},'scan');
  const value=copy();value.pages[0].items[0].x=NaN;reject(value,'malformed coordinate');
  assert.equal(inspectChinaPdfInvoice(null).result,null);
});

test('unanchored product or fee money, foreign invoice metadata and empty continuation are not silently ignored',()=>{
  const cases=[
    value=>{value.pages[0].items.push({str:'999.00',x:633,y:333,width:25});},
    value=>{value.pages[0].items.push({str:'orphan flower',x:133,y:333,width:48});},
    value=>{value.pages[1].items.push({str:'999.00',x:255,y:100,width:25});},
    value=>{value.pages[2].items.push({str:'INVOICE NO. OTHER',x:553,y:400,width:80});},
    value=>{value.pages.splice(2,0,{items:[{str:'unrelated',x:50,y:500,width:40}],text:'unrelated'});},
  ];
  for(const [index,change] of cases.entries()){const value=copy();change(value);reject(value,`unanchored case ${index}`);}
});

test('optional private PDF.js fixture agrees with independent row/total audit',async t=>{
  const positionedPath=process.env.CHINA_PDF_POSITIONED_FIXTURE||path.resolve('outputs/china-pdf-local/actual-positioned.json');
  const reportPath=process.env.CHINA_PDF_INDEPENDENT_REPORT||path.resolve('outputs/china-pdf-local/independent-row-totals-report.json');
  let positioned,report;
  try{[positioned,report]=await Promise.all([fs.readFile(positionedPath,'utf8'),fs.readFile(reportPath,'utf8')]);}
  catch(error){if(error.code==='ENOENT'){t.skip('private positioned PDF fixture is not present');return;}throw error;}
  const parsed=inspectChinaPdfInvoice(JSON.parse(positioned));
  assert.equal(parsed.reason,null);
  const invoice=parsed.result.invoices[0],audit=JSON.parse(report);
  assert.equal(invoice.products.length,audit.rowCount);
  assert.equal(invoice.total_boxes,audit.totals.expected.boxes);
  assert.equal(invoice.total_bunches,audit.totals.expected.bunches);
  assert.equal(invoice.total_stems,audit.totals.expected.stems);
  assert.equal(invoice.gross_weight,audit.totals.expected.grossWeight);
  assert.equal(invoice.item_subtotal,audit.totals.expected.goods);
  assert.equal(invoice.invoice_total,audit.totals.expected.grandTotal);
  assert.deepEqual(invoice.products.map(row=>[row.pcs,row.total_bunch,row.total_stems,row.gross_weight,row.u_price,row.t_price]),
    audit.rows.map(row=>[row.values.boxes,row.values.bunches,row.values.stems,row.values.grossWeight,row.values.unitPrice,row.values.goodsAmount]));
  assert.equal(invoice.products.filter(row=>row.u_price===null&&row.t_price===null).length,audit.priceMissingRows.length);
});
