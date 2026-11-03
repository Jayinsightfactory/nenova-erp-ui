// Only literal supplier headers in the same PDF invoice can correct an AI guess.
export function reconcileInvoiceSupplier(invoice, country, source) {
 if(country!=='CN'||!invoice?.invoice||!Array.isArray(source?.pages))return invoice;
 const id=String(invoice.invoice).toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(id.length<6)return invoice;
 const invoicePattern=new RegExp('(?:^|[^A-Z0-9])'+id.split('').join('[\\s-]*')+'(?:$|[^A-Z0-9])','i');
 const candidates=source.pages.map((page,index)=>({page:index+1,text:String(page.text||'')}))
  .filter(p=>invoicePattern.test(p.text));
 const proof=candidates.filter(p=>/KUN\s*MING\s+HUBFRESH\s+SUPPLY\s+CHAIN\s+MANAGEMENT/i.test(p.text));
 if(proof.length!==1)return invoice;
 const p=proof[0],quote=p.text.match(/KUN\s*MING\s+HUBFRESH\s+SUPPLY\s+CHAIN\s+MANAGEMENT[^\n]{0,15}?LTD/i)?.[0]
  ||'KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT';
 // Do not silently choose between multiple supplier headers on one page.
 if(/YUNNAN\s+MELODY|YUNYAN\s+FLOWER\s+INDUSTRY|CLOUDLAND/i.test(p.text))return invoice;
 return reconcileHubfreshHeader({...invoice,supplier:'HUBFRESH',metadata_evidence:{...invoice.metadata_evidence,
  supplier:{page:p.page,quote,bbox:null,source:'PDF_TEXT_EXACT_HEADER',previousValue:invoice.supplier}}},source,p.page);
}

// Header-only fallback for text PDFs whose product table needs AI. Do not
// attach another invoice's totals or replace a user's reviewed inputs.
function reconcileHubfreshHeader(invoice,source,headerPage){
 const pages=source.pages;
 const invoiceIds=new Set(pages.flatMap(p=>[...String(p.text||'').matchAll(/INVOICE\s*NO\.?\s*[:：]?\s*([A-Z0-9][A-Z0-9-]*)/gi)].map(m=>m[1].toUpperCase())));
 if(invoiceIds.size!==1||!invoiceIds.has(String(invoice.invoice).toUpperCase()))return invoice;
 let result=invoice;
 const header=pages[headerPage-1];
 const dates=[...String(header.text||'').matchAll(/日期\s*DATE\s*[:：]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/gi)];
 if(dates.length===1&&!invoice.metadataReview&&!invoice.packingReview){
  const [quote,day,month,year]=dates[0];
  const date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  const parsed=new Date(`${date}T00:00:00Z`);
  if(Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date&&String(invoice.invoice).includes(`-${year}-`)){
   const resolved=new Set(['DATE_SOURCE_UNAVAILABLE','DATE_ORDER_AMBIGUOUS','DATE_ORDER_CONFLICT','DATE_CONFLICT','DATE_KIND_UNAVAILABLE']);
   result={...result,date:date.replaceAll('-','/'),raw_date:`${day}/${month}/${year}`,date_order:'DMY',date_kind:'invoice',
    extractionIssues:(invoice.extractionIssues||[]).filter(issue=>!resolved.has(issue.code)),
    metadata_evidence:{...result.metadata_evidence,date:{page:headerPage,quote,bbox:null,source:'HUBFRESH_PRINTED_DMY',previousValue:invoice.date}}};
  }
 }
 const columns=(header.items||[]).filter(i=>/^A\.G\.W\.T\.$/i.test(String(i.str).trim()));
 if(columns.length!==1||Object.hasOwn(invoice.packingReview?.values||{},'gw'))return result;
 const column=columns[0],totals=[];
 for(const [index,page]of pages.entries()){
  for(const label of (page.items||[]).filter(i=>/^TOTAL$/i.test(String(i.str).trim()))){
   const values=(page.items||[]).filter(i=>Math.abs(i.y-label.y)<=2&&Math.abs(i.x-column.x)<=4&&/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(String(i.str).trim()));
   if(values.length===1)totals.push({item:values[0],page:index+1});
  }
 }
 if(totals.length!==1)return result;
 const total=totals[0],value=Number(String(total.item.str).replaceAll(',',''));
 if(!Number.isFinite(value)||value<=0||value>1e7)return result;
 return {...result,gross_weight:value,review_evidence:{...result.review_evidence,
  gross_weight:{value,unit:'kg',page:total.page,quote:`A.G.W.T. / TOTAL ${total.item.str}`,bbox:null,source:'HUBFRESH_POSITIONED_TOTAL'}}};
}
