import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectChinaPdfInvoice} from '../lib/importChinaPdfInvoice.js';
import {genChina} from '../lib/importPacking.js';
import {createRequire} from 'node:module';
const XLSX=createRequire(import.meta.url)('xlsx');

function compactFixture() {
 const i=(str,x,y)=>({str:String(str),x,y,width:10});
 const row=(y,carton)=>[['尤加利',55],['测试',85],['Populus',115],['70cm',205],['10stem/bunch',225],['15',255],['100*40*20',290],[carton,320],['1',350],['15',380],['23',415],['300',440],['10',460],['345',490]].map(([v,x])=>i(v,x,y));
 const first=[...row(600,'1'),i('KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD',100,780),i('INVOICE NO. TEST',100,760),i('日期DATE: 10/10/2026',300,760),
 ...[['Category',55.92,629.74],['English item name',113.78,629.74],['Order',347.95,629.74],['Total of Flower',372.91,632.86],['Stems',435.58,629.74],['UNT (CNY)',485.02,620.38]].map(v=>i(...v))];
 const last=[...row(700,'2'),i('合计 Total',100,650),...[[2,350],[30,380],[600,440],[20,460],[690,490]].map(([v,x])=>i(v,x,650))];
 const labels=['BOXING AND PACKING/纸箱打包','Documents / 单证文件/Phytosanitary Certificate, Customs ，CO Declaration / 植物检疫证书，产地证，报关单','SEA FREIGHT CHARGE/海运+冷链运输/Logistics Fee / 物流费','代加工 PROCESS COST','检疫箱 Quarantine box','Temperature Data Logger /温度记录仪','Loading and Unloading Fee / 装卸费','花材金额'];
 labels.forEach((label,index)=>{const y=600-index*30,amount=index===7?690:1;last.push(i(index+1,64,y),i(label,90,y),i(1,160,y),i(amount,180,y),i(amount,205,y));});
 last.push(i('Total additional charges/附加费用合计',90,350),i(697,205,350));
 return {pages:[{items:first},{items:last}]};
}

test('public compact fixture keeps bunch billing and rejects malformed price and totals',()=>{
 const fixture=compactFixture();
 const parsed=inspectChinaPdfInvoice(fixture);
 assert.equal(parsed.reason,null);
 const invoice=parsed.result.invoices[0];
 assert.equal(invoice.total_bunches,30);assert.equal(invoice.item_subtotal,690);
 assert.equal(invoice.freight,7);assert.equal(invoice.products[0].bunch_st,10);
 assert.match(invoice.products[0].quantity_warning,/15단 기준/);
 assert.equal(genChina(XLSX,invoice,'42','1').totalMismatch,null);
 for(const [x,y] of [[415,600],[490,650],[205,350]]){
  const wrong=structuredClone(fixture);
  const cell=wrong.pages.flatMap(p=>p.items).find(v=>v.x===x&&v.y===y);cell.str=String(Number(cell.str)+1);
  assert.equal(inspectChinaPdfInvoice(wrong).result,null);
 }
});

test('private compact China source: exact columns, 15-bunch price and editable stem warning',async t=>{
 const path=process.env.CHINA_COMPACT_PDF;
 if(!path||!fs.existsSync(path)){t.skip('private source path not provided');return;}
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const pdf=await getDocument({data:new Uint8Array(fs.readFileSync(path)),useSystemFonts:true}).promise;
 const pages=[];
 for(let n=1;n<=pdf.numPages;n++){
  const text=await(await pdf.getPage(n)).getTextContent();
  pages.push({items:text.items.filter(i=>i.str?.trim()).map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],width:i.width}))});
 }
 const input={pages},before=JSON.stringify(input),parsed=inspectChinaPdfInvoice(input);
 assert.equal(parsed.reason,null);
 const invoice=parsed.result.invoices[0];
 assert.equal(invoice.products.length,64);assert.equal(invoice.total_bunches,2280);
 assert.equal(invoice.total_boxes,186);assert.equal(invoice.item_subtotal,57230);
 assert.equal(invoice.freight,37559.5);assert.equal(invoice.invoice_total,94789.5);
 assert.match(invoice.supplier,/HUBFRESH/);assert.equal(invoice.raw_date,'10/10/2026');
 const row=invoice.products.find(p=>/Populus.*berries/.test(p.source_description));
 assert.equal(row.total_bunch,15);assert.equal(row.bunch_st,10);assert.equal(row.total_stems,300);
 assert.equal(row.t_price,345);assert.match(row.quantity_warning,/15단 기준/);
 const generated=genChina(XLSX,invoice,'42','1');
 assert.equal(generated.totalMismatch,null);
 assert.equal(JSON.stringify(input),before);
 for(const [label,mutate] of [
  ['wrong quantity',v=>v.pages[0].items.find(i=>i.str==='20'&&i.x>370&&i.x<407).str='21'],
  ['wrong price',v=>v.pages[0].items.find(i=>i.str==='17.00'&&i.x>407&&i.x<434).str='18.00'],
  ['missing goods',v=>v.pages[0].items=v.pages[0].items.filter(i=>Math.abs(i.y-603.58)>11)],
  ['wrong currency',v=>v.pages[0].items.find(i=>i.str==='UNT (CNY)').str='UNT (USD)'],
 ]) {const value=structuredClone(input);mutate(value);assert.equal(inspectChinaPdfInvoice(value).result,null,label);}
 await pdf.destroy();
});
