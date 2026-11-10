// Browser-safe display/write boundary for a receipt-covered country split group.
export function settlementCoversCountryField(row,field){
  const stem=String(field).match(/^(Customs[12]|SunYul[12])(?:_[123])?$/)?.[1];
  return !!stem&&Object.keys(row?.settlement?.values||{}).some(key=>key===stem||key.startsWith(`${stem}_`));
}
export function preserveSettlementCountryField(row,field,hasManualEdit,out){
  // Covered groups are read-only; even stale edits must not migrate source values to DB.
  if(!settlementCoversCountryField(row,field))return false;
  if(row.saved?.[field]!=null)out[field]=row.saved[field];
  return true;
}
