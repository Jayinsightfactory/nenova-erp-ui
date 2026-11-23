// Read-only parser for the evidenced eight-column Yunyan Contract worksheet.
// Unknown boxes, invoice number/date and shipment weights remain absent.
export const CLOUD_CONTRACT_FORMAT='china_cloud_contract_xlsx';
const text=v=>String(v??'').trim();
const key=v=>text(v).toLowerCase().replace(/[\s().:_-]/g,'');
const fail=m=>{throw Error(`CLOUD Contract 원문을 확인하세요: ${m}`);};
const close=(a,b)=>Math.abs(a-b)<0.01;
function number(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail(`${label} 숫자/음수`);return value;}
function quantity(spec,qty){
 const packing=text(spec).split(/\r?\n/).find(s=>/^Packing\s*:/i.test(s));
 let m=packing?.match(/^Packing\s*:\s*(\d+)\s*pcs\s*\/\s*bunch\s*$/i);
 if(m&&Number(m[1])>0)return {total_bunch:qty,total_stems:qty*Number(m[1]),bunch_st:Number(m[1]),price_unit:'단',source_unit:'BUNCH'};
 m=packing?.match(/^Packing\s*:\s*(\d+(?:\.\d+)?)\s*g\s*\/\s*bunch\s*$/i);
 if(m&&Number(m[1])>0)return {total_bunch:qty,total_stems:null,bunch_st:null,price_unit:'단',source_unit:'BUNCH',bunch_weight_g:Number(m[1])};
 if(/^Packing\s*:\s*1\s*pcs\s*$/i.test(packing??''))return {total_bunch:null,total_stems:qty,bunch_st:null,price_unit:'송이',source_unit:'STEM'};
 fail('Packing 단위가 지원하는 명시 단위(pcs/bunch, g/bunch, 1pcs)가 아닙니다.');
}
export function parseCloudContractWorkbook(XLSX,book){
 const candidates=book.SheetNames.filter(name=>key(book.Sheets[name]?.A1?.v)==='contract');
 if(!candidates.length)return null;
 if(candidates.length!==1)fail('Contract 시트를 한 개 선택하세요.');
 const name=candidates[0],sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
 if(range.e.r>10000||range.e.c!==7)fail('8열 원문 범위를 확인하세요.');
 if(key(sheet.A2?.v)!=='customer'||key(sheet.A3?.v)!=='nenovacoltd'
   ||key(sheet.A4?.v)!=='supplier'||key(sheet.A5?.v)!=='yunnanyunyanflowerindustrydevelopmentcompanylimited')fail('고객/공급자 원문 양식이 다릅니다.');
 const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,blankrows:true,range:0});
 const headers=['items','picture','specification','quantity','unitprice','packingfee','totalcny','supplier'];
 if(headers.some((v,i)=>key(rows[6]?.[i])!==v))fail('Items/picture/specification/Quantity/unit price/packing fee/total(CNY)/Supplier 열이 다릅니다.');
 const products=[],costs=[];let total=null,feeSection=false,totalRow=null,subtotalSeen=false;
 const feeNames=new Map([['documentfee','DOCUMENT'],['shippingcostwarehousetoairport','DOMESTIC'],['internationalshippingcost','INTERNATIONAL']]);
 const cell=(r,c)=>({address:XLSX.utils.encode_cell({r,c}),value:rows[r]?.[c]??null});
 for(let r=7;r<rows.length;r++){
  const row=rows[r];if(!row.some(v=>v!==null&&text(v)))continue;
  const label=text(row[0]);
  if(key(label)==='total'){if(total!==null)fail('TOTAL 중복');total=number(row[6],`G${r+1}`);totalRow=r+1;break;}
  if(key(label)==='flowercost'){
   if(subtotalSeen||!products.length||costs.length||!close(number(row[3],`D${r+1}`),products.reduce((s,p)=>s+p.raw_qty,0))||!close(number(row[6],`G${r+1}`),products.reduce((s,p)=>s+p.t_price,0)))fail('Flower Cost 상품 수량/금액 소계 불일치');
   subtotalSeen=true;continue;
  }
  if(!label)fail(`행 ${r+1} 품명 없음`);
  const qty=number(row[3],`D${r+1}`),base=number(row[4],`E${r+1}`),packing=number(row[5],`F${r+1}`),amount=number(row[6],`G${r+1}`);
  const fee=feeNames.get(key(label));
  if(fee){if(!subtotalSeen)fail('Flower Cost 소계 전 비용행');feeSection=true;if(costs.some(c=>c.cost_kind===fee)||!close(qty*base,amount)||!close(packing,amount))fail(`행 ${r+1} 비용 중복/산식 불일치`);
   costs.push({description:label,quantity:qty,unit_price:base,amount,cost_kind:fee,source_sheet:name,source_row:r+1,source_cells:{quantity:cell(r,3),unit_price:cell(r,4),amount:cell(r,6),display_repeat:cell(r,5)}});continue;}
  if(feeSection||subtotalSeen)fail('소계/비용 구간 뒤 상품/알 수 없는 금액행');
  if(!(qty>0)||!Number.isSafeInteger(qty)||!text(row[2])||!close(qty*(base+packing),amount))fail(`행 ${r+1} 상품 수량×(기본단가+포장비) 불일치`);
  const units=quantity(row[2],qty),length=text(row[2]).match(/Length\s*:\s*([^\r\n]+)/i)?.[1]??'';
  products.push({description:label,source_description:label,source_format:CLOUD_CONTRACT_FORMAT,source_sheet:name,source_row:r+1,
   specification:text(row[2]),stem_length:length,raw_qty:qty,...units,pcs:null,u_price:base+packing,t_price:amount,
   source_base_price:base,source_packing_fee:packing,source_supplier_code:text(row[7]),
   source_cells:{description:cell(r,0),specification:cell(r,2),raw_qty:cell(r,3),source_base_price:cell(r,4),source_packing_fee:cell(r,5),t_price:cell(r,6)}});
 }
 if(!products.length||!subtotalSeen||total===null||costs.length!==3)fail('상품 소계/3개 비용/TOTAL 누락');
 const itemSubtotal=products.reduce((s,p)=>s+p.t_price,0),fees=costs.reduce((s,c)=>s+c.amount,0);
 if(!close(itemSubtotal+fees,total))fail('상품+문서비+공항운송비+국제운임과 TOTAL 불일치');
 return {invoice:'',date:'',raw_date:'',supplier:text(sheet.A5.v),currency:'CNY',awb:'',source_format:CLOUD_CONTRACT_FORMAT,source_sheet:name,
  products,additional_costs:costs,item_subtotal:itemSubtotal,freight:fees,invoice_total:total,total_value:total,
  sourceInvoiceNumberMissing:true,invoiceReferenceRequired:true,sourceTotalCell:`${name}!G${totalRow}`,
  contractArithmetic:{method:'QUANTITY_TIMES_BASE_PLUS_PACKING',goods:itemSubtotal,fees,total,verified:true}};
}
