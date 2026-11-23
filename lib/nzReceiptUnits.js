export function nzConfirmedBunchQuantity(line) {
  const ratio=line?.reviewed?.nzStemsPerBunch;
  const stems=line?.stemQuantity;
  if(ratio==null||ratio==='')return {provided:false,quantity:null};
  if(line.priceUnit!=='송이'||typeof line.reviewed?.nzUnitReason!=='string'||!line.reviewed.nzUnitReason.trim()
    ||!Number.isSafeInteger(Number(ratio))||Number(ratio)<=0
    ||!Number.isSafeInteger(Number(stems))||Number(stems)<=0
    ||Number(stems)!==line.sourceEvidence?.nzPrintedUnits
    ||Number(stems)%Number(ratio)!==0)return {provided:true,quantity:null};
  return {provided:true,quantity:Number(stems)/Number(ratio)};
}
