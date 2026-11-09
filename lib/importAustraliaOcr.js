import {parsePrintedDate} from './importAwbFields.js';
const numeric=s=>/^\$?[\d,]+(?:\.\d+)?$/.test(s)?Number(s.replace(/[$,]/g,'')):null;
export function inspectAustraliaOcr(source){
 const fail=reason=>({result:null,reason});
 if(!Array.isArray(source?.pages)||!source.pages.length)return fail('호주 OCR 원본 페이지가 없습니다.');
 const all=source.pages.flatMap(p=>p.items.map(x=>({...x,page:p.page})));
 const text=all.map(x=>x.str).join(' ');
 if(!/Premium Greens/i.test(text)||!/AUD\s*\$|AUD\$/i.test(text))return fail('검증된 Premium Greens AUD 서식이 아닙니다.');
 function valueAt(label){
  const matches=all.filter(x=>label.test(x.str));if(matches.length!==1)return null;
  const item=matches[0];return all.filter(x=>x.page===item.page&&x.x>item.x+item.width-2&&Math.abs(x.y-item.y)<5).sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ').trim();
 }
 const invoice=valueAt(/^Tax Invoice No$/i),rawDate=valueAt(/^Invoice Date$/i),date=parsePrintedDate(rawDate),awb=valueAt(/^Consignment No:?$/i);
 if(!invoice||!/^\d+$/.test(invoice)||!date||!awb||!/^\d{3}-?\d{4}-?\d{4}$/.test(awb))return fail('호주 송장번호·발행일·AWB를 원본에서 확인해야 합니다.');
 const page=source.pages[0],products=[];
 for(const anchor of page.items.filter(x=>x.str.trim().toLowerCase()==='bunch')){
  const cells=page.items.filter(x=>Math.abs(x.y-anchor.y)<5&&numeric(x.str)!==null).sort((a,b)=>a.x-b.x);
  if(cells.length!==4)return fail('호주 상품행 박스·단수·단가·금액 열을 확인해야 합니다.');
  const [pcs,total_bunch,u_price,t_price]=cells.map(x=>numeric(x.str));
  const names=page.items.filter(x=>x.x<cells[0].x-8&&Math.abs(x.y-anchor.y)<5).sort((a,b)=>a.x-b.x);
  const description=names.map(x=>x.str).join(' ').trim(),bunch_st=Number(description.match(/\((\d+)\s*stems\/bunch\)/i)?.[1]);
  if(!description||!bunch_st||!Number.isInteger(pcs)||pcs<0||Math.abs(total_bunch*u_price-t_price)>.011)return fail('호주 원문 수량×단가 또는 단당 송이수를 확인해야 합니다.');
  const following=page.items.filter(x=>x.x<cells[0].x&&x.y<anchor.y-4&&x.y>anchor.y-20).sort((a,b)=>b.y-a.y);
  const extra=following.map(x=>x.str).join(' ');
  products.push({description,source_description:description,source_additional_description:extra,pcs,total_bunch,bunch_st,u_price,t_price,source_page:1,source_row:products.length+1,review_evidence:{description:{page:1,quote:description,bbox:[names[0].x/page.width,1-(names[0].y+names[0].height)/page.height,names[0].width/page.width,names[0].height/page.height]},t_price:{page:1,quote:String(t_price),bbox:null}}});
 }
 if(!products.length)return fail('호주 상품행이 없습니다.');
 const totals=[];
 for(const label of all.filter(x=>/^Invoice (?:Sub )?Total(?: in AUD\$)?$/i.test(x.str))){
  const amounts=all.filter(x=>x.page===label.page&&x.x>label.x+label.width-2&&Math.abs(x.y-label.y)<5&&numeric(x.str)!==null);
  if(amounts.length===1)totals.push(numeric(amounts[0].str));
 }
 const invoice_total=totals[0],sum=products.reduce((n,p)=>n+p.t_price,0),boxText=valueAt(/^Number of Boxes$/i);
 const boxTotal=Number(boxText?.match(/^\d+\b/)?.[0]);
 if(!Number.isFinite(invoice_total)||totals.some(x=>Math.abs(x-invoice_total)>.011)||Math.abs(sum-invoice_total)>.011||boxTotal!==products.reduce((n,p)=>n+p.pcs,0))return fail('호주 원문 총금액 또는 박스 합계와 OCR 상품행이 다릅니다.');
 return {result:{invoices:[{invoice,supplier:'Premium Greens',currency:'AUD',awb,date:date.replace(/-/g,'/'),raw_date:rawDate,date_kind:'invoice',date_order:'DMY',invoice_total,freight_total:0,products,pdfSourceHash:source.sourceHash,pdfReviewRequired:true,metadata_evidence:{date:{page:1,quote:'Invoice Date '+rawDate,bbox:null},currency:{page:1,quote:'Total in AUD$',bbox:null},invoice_total:{page:source.pages.length,quote:'Invoice Total in AUD$ '+invoice_total,bbox:null}}}]}};
}
