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
 return {...invoice,supplier:'HUBFRESH',metadata_evidence:{...invoice.metadata_evidence,
  supplier:{page:p.page,quote,bbox:null,source:'PDF_TEXT_EXACT_HEADER',previousValue:invoice.supplier}}};
}
