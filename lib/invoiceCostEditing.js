export function invoiceCostEditScope(document) {
  return JSON.stringify([document.documentId, document.sourceHash, document.invoiceNo, document.orderYear, document.orderWeek,
    document.reviewedMetadata?.country, document.reviewedMetadata?.transportMode]);
}
const lineIdentity = line => JSON.stringify([line.prodKey,line.boxQuantity,line.bunchQuantity,line.stemQuantity,line.lineAmount,line.unitPrice,line.currency,line.priceUnit]);
export function rememberInvoiceCostInput(document, input) {
  return {scope:invoiceCostEditScope(document), input, lines:new Map(document.lines.map(line=>[line.lineId,lineIdentity(line)]))};
}
export function restoreInvoiceCostInput(document, remembered) {
  if (!remembered || remembered.scope !== invoiceCostEditScope(document)) return document;
  const current=document.reviewedMetadata?.invoiceCostInput||{};
  const preserved=new Map((remembered.input.lineInputs||[]).filter(input=>{
    const line=document.lines.find(line=>line.lineId===input.lineId);
    return line&&remembered.lines.get(input.lineId)===lineIdentity(line);
  }).map(input=>[input.lineId,input]));
  return {...document,reviewedMetadata:{...document.reviewedMetadata,invoiceCostInput:{...current,...remembered.input,
    lineInputs:(current.lineInputs||[]).map(input=>{
      if(preserved.has(input.lineId)) return {...input,...preserved.get(input.lineId)};
      const line=document.lines.find(line=>line.lineId===input.lineId);
      return {lineId:input.lineId,
        stemsPerBunch:line?.bunchQuantity>0&&line?.stemQuantity!=null?line.stemQuantity/line.bunchQuantity:null,
        bunchesPerBox:line?.boxQuantity>0&&line?.bunchQuantity!=null?line.bunchQuantity/line.boxQuantity:null};
    }),
    formulaApplicabilityConfirmed:false,lossTreatmentConfirmed:false}}};
}
