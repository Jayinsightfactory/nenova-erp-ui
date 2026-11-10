const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function invoiceAmountReview(document) {
  const raw=document?.rawMetadata||{}, lines=document?.lines||[];
  const currency=String(raw.currency||lines[0]?.currency||'').trim().toUpperCase();
  const goods=lines.length&&lines.every(l=>finite(l.lineAmount)&&l.currency===currency)
    ? lines.reduce((sum,l)=>sum+l.lineAmount,0) : null;
  const country=document?.reviewedMetadata?.country;
  const inputs=document?.reviewedMetadata?.costInputs||{};
  const costValue=(kind,fallback)=>Object.hasOwn(inputs,kind)
    ? inputs[kind]?.currency===currency && finite(inputs[kind]?.amount) ? inputs[kind].amount : NaN
    : fallback;
  const costs=['CN','CO'].includes(country)?[raw.freight]:country==='NL'
    ?[costValue('freight',raw.freight),costValue('docFee',raw.handling)]:[];
  const extras=costs.every(n=>n==null||finite(n))?costs.reduce((sum,n)=>sum+(n??0),0):null;
  const total=goods!=null&&extras!=null?Math.round((goods+extras)*100)/100:null;
  const printed=finite(raw.invoiceTotal)?raw.invoiceTotal:null;
  const difference=total!=null&&printed!=null?Math.round((total-printed)*100)/100:null;
  const matches=/^[A-Z]{3}$/.test(currency)&&difference!==null&&Math.abs(difference)<=0.01;
  const basis=JSON.stringify({sourceHash:document?.sourceHash,documentId:document?.documentId,orderYear:document?.orderYear,orderWeek:document?.orderWeek,invoiceNo:document?.invoiceNo,farmKey:document?.farmKey,farmName:document?.reviewedMetadata?.farmName,currency,printed,total,
    lines:lines.map(l=>[l.lineId,l.prodKey,l.lineAmount,l.currency]),extras});
  return {currency,goods,extras,total,printed,difference,matches,basis,
    message:printed==null?'원본 인보이스 총액을 확인·입력하세요.':goods==null?'품목별 금액과 통화를 확인하세요.':!matches?'인보이스 총액과 등록 상품금액·부대비 합계가 다릅니다.':'총금액 일치'};
}
export function invoiceAmountConfirmed(document) {
 const review=invoiceAmountReview(document), confirmation=document?.reviewedMetadata?.amountConfirmation;
 return review.matches&&confirmation?.basis===review.basis&&confirmation?.sourceSeen===true;
}
