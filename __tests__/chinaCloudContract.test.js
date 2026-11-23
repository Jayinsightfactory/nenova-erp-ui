import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import {parseChinaInvoiceWorkbook} from '../lib/importChinaInvoice.js';
import {adaptPackingReceipts} from '../lib/importPackingReceiptAdapter.js';
import {validateInvoiceReceiptLines} from '../lib/invoiceReceiptValidation.js';
const rows=()=>[['Contract'],['Customer'],['NENOVA CO.LTD'],['Supplier'],['Yunnan Yunyan Flower Industry Development Company Limited'],['产品明细Products'],
 ['Items','picture','specification','Quantity','unit price','packing fee','total(CNY)','Supplier'],
 ['Asparagus Burgundy',null,'Packing:5pcs/bunch\nLength:55cm',25,20,2,550,'YY'],
 ['Phalaenopsis Orchid',null,'Packing:1pcs\nLength:60cm',90,23,0,2070,'LY'],
 ['Eucalyptus',null,'Packing:500g/bunch',2,10,2,24,null],
 ['Flower Cost',null,null,117,null,null,2644],
 ['Document Fee',null,null,1,900,900,900],['Shipping Cost (warehouse to Airport)',null,null,1,300,300,300],
 ['International shipping cost',null,null,70,9,630,630],['TOTAL',null,null,null,null,null,4474]];
function parse(data=rows(),extra=false){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(data),'Sheet1');if(extra)XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(data),'Other');const b=XLSX.write(w,{type:'base64',bookType:'xlsx'});return JSON.parse(parseChinaInvoiceWorkbook(XLSX,b).content[0].text);}
test('exact eight-column Contract preserves base plus packing and separate costs, no invented invoice/weights/boxes',()=>{
 const p=parse(),i=p.invoices[0];assert.equal(p.receiptOnly,true);assert.equal(i.source_format,'china_cloud_contract_xlsx');
 assert.equal(i.invoice,'');assert.equal(i.date,'');assert.equal(i.awb,'');assert.equal(i.gross_weight,undefined);assert.equal(i.vol_weight,undefined);
 assert.equal(i.products.length,3);assert.equal(i.item_subtotal,2644);assert.equal(i.freight,1830);assert.equal(i.invoice_total,4474);
 assert.deepEqual(i.additional_costs.map(c=>c.amount),[900,300,630]);assert(i.products.every(p=>p.pcs===null));
 assert.equal(i.products[0].u_price,22);assert.equal(i.products[0].source_base_price,20);assert.equal(i.products[0].source_packing_fee,2);
 assert.equal(i.products[1].total_bunch,null);assert.equal(i.products[1].total_stems,90);assert.equal(i.products[1].price_unit,'송이');
 assert.equal(i.products[2].total_bunch,2);assert.equal(i.products[2].total_stems,null);
});
test('near-miss header, money, unit, supplier, subtotal, total, duplicate sheet and cost fail closed',()=>{
 const changes=[r=>r[6][5]='price',r=>r[7][6]=500,r=>r[7][2]='Packing:5pcs',r=>r[4][0]='Other supplier',r=>r[10][3]=100,r=>r[14][6]=4475,
 r=>r[12][0]='Document Fee',r=>r[7][3]=-25];
 for(const mutate of changes){const r=rows();mutate(r);assert.throws(()=>parse(r),/Contract/);}
 assert.throws(()=>parse(rows(),true),/Contract/);
});
test('receipt adapter keeps Contract units, raw price components, nullable boxes and explicit reference guard',async()=>{
 const i=parse().invoices[0];i.pdfSourceHash='a'.repeat(64);
 const [d]=await adaptPackingReceipts({country:'CN',fileName:'2026 47-2B CLOUD CI.xlsx',sourceHash:'a'.repeat(64),invoices:[i],excels:[],reviewConfirmed:true,invoiceUploadDate:'2026-11-23'});
 assert.equal(d.lines[0].priceUnit,'단');assert.equal(d.lines[1].priceUnit,'송이');assert.equal(d.lines[1].bunchQuantity,null);
 assert(d.lines.every(l=>l.boxQuantity===null));assert.equal(d.lines[2].stemQuantity,null);assert.equal(d.reviewedMetadata.inputDate,'2026-11-23');
 assert.equal(d.rawMetadata.sourceContract.referenceRequired,true);assert.equal(d.rawMetadata.additionalCosts.length,3);
 const products=d.lines.map((l,n)=>({ProdKey:n+1,ProdName:l.originalName,isDeleted:0,OutUnit:l.priceUnit,EstUnit:l.priceUnit,SteamOf1Box:100,SteamOf1Bunch:n===1?1:10,BunchOf1Box:10}));
 d.lines=d.lines.map((l,n)=>({...l,prodKey:n+1,reviewed:{...l.reviewed,confirmed:true,erpMatchConfirmed:true}}));
 d.farmKey=1;d.orderYear='2026';d.orderWeek='47-02';d.invoiceNo='47-2B CLOUD';d.invoiceYear='2026';d.reviewedMetadata.transportMode='AIR';
 let v=validateInvoiceReceiptLines(d,products);assert(v.issues.some(x=>x.code==='CONTRACT_REFERENCE_REQUIRED'));
 d.reviewedMetadata.contractReferenceConfirmation={confirmed:true,kind:'ACTUAL_INVOICE',reference:d.invoiceNo};v=validateInvoiceReceiptLines(d,products);
 assert(!v.issues.some(x=>x.code==='CONTRACT_REFERENCE_REQUIRED'));assert(v.lines.every(l=>l.boxQuantity===null));
 assert.equal(v.lines[1].bunchQuantity,null);assert.equal(v.lines[1].outQuantity,90);assert.equal(v.lines[2].stemQuantity,null);assert.equal(v.lines[2].outQuantity,2);
 d.invoiceNo='changed';assert(validateInvoiceReceiptLines(d,products).issues.some(x=>x.code==='CONTRACT_REFERENCE_REQUIRED'));
 d.orderYear='2025';assert(validateInvoiceReceiptLines(d,products).issues.some(x=>x.code==='SOURCE_YEAR_CONFLICT'));
});
