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

export function nzReceiptLineReview(line) {
  const printed=line.sourceEvidence?.nzPrintedUnits;
  const field={단:'bunchQuantity',송이:'stemQuantity'}[line.priceUnit];
  const conversion=nzConfirmedBunchQuantity(line);
  return {
    product:line.prodKey?'':'같은 원산지·품종·등급·길이·꽃봉오리 규격의 활성 품목이 하나로 확인되지 않았습니다. 전산 품목을 선택하세요.',
    units:!field||line[field]!==printed||!line.reviewed?.nzUnitReason?.trim()
      ? '원본 Units에는 단·송이 구분이 없습니다. 원문 수량과 단가 기준을 확인하고 근거를 입력하세요.' : '',
    conversion:conversion.provided&&(conversion.quantity==null||line.bunchQuantity!=null&&line.bunchQuantity!==conversion.quantity)
      ? '입력한 총 단수와 확인 환산값이 일치하는지 확인하세요.' : '',
  };
}

// Only an existing explicit Units decision authorizes applying the printed
// quantity. The printed price/amount independently identify the same row.
export function fillConfirmedNzReceiptLine(line) {
  const {nzPrintedUnits:quantity,sourceFieldStates:printed}=line.sourceEvidence||{};
  const field={단:'bunchQuantity',송이:'stemQuantity'}[line.priceUnit];
  if(!field||!line.reviewed?.nzUnitReason?.trim()||!Number.isSafeInteger(quantity)||quantity<=0
    ||line.currency!=='NZD'||!['unitPrice','lineAmount'].every(key=>
      printed?.[key]?.rawValue!=null&&Number(String(printed[key].rawValue).replaceAll(',',''))===line[key])
    ||Math.abs(quantity*line.unitPrice-line.lineAmount)>0.02) return line;
  let next=line[field]==null?{...line,[field]:quantity}:line;
  if(next[field]!==quantity)return line;
  const {quantity:bunches}=nzConfirmedBunchQuantity(next);
  if(next.bunchQuantity==null&&bunches!=null)next={...next,bunchQuantity:bunches};
  return next;
}
