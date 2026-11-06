const n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const week=v=>String(v||'').split('-').map(Number).join('-');
const unit=v=>({BUNCH:'단',STEM:'송이',BOX:'박스'}[v]||v);
// ACTUAL is the approval mode. The formula's tariff is not a tax-payment receipt.
export function approvedReceiptDutyCosts(costs,expected,{year,warehouseKey}={}){
 const a=costs?.currentActual;
 if(!a||String(year)!=='2026'||String(a.orderYear)!==String(year)||a.warehouseKey!==Number(warehouseKey)
   ||costs.status!=='APPROVED'||costs.documentCostStatus!=='APPROVED'||a.status!=='APPROVED'||a.storedStatus!=='APPROVED'
   ||a.liveReceiptStatus!=='MATCH'||a.basis!=='ACTUAL'||a.documentId!==costs.documentId||a.documentRevision!==costs.documentRevision
   ||a.operationId!==costs.operationId||a.currency!=='KRW'||a.editableInput?.input?.nativeCurrency!=='CNY'
   ||!(n(a.editableInput?.input?.exchangeRateKRW)>0)||a.editableInput?.input?.expenseBasis==='TEST_ONLY')return [];
 const out=[],ids=new Set();
 for(const l of a.lines||[]){
  const r=expected.find(x=>Number(x.warehouseDetailKey)===Number(l.wdetailKey)),c=l.componentAmounts;
  if(!r||ids.has(Number(l.wdetailKey))||String(r.orderYear)!==String(year)||week(r.orderWeek)!==week(a.orderWeek)
   ||Number(r.prodKey)!==Number(l.prodKey)||unit(l.unit)!==r.outUnit||!(n(l.quantity)>0)||n(r.outQuantity)!==n(l.quantity)
   ||!c||['goodsKRW','freightKRW','tariffKRW','otherKRW'].some(k=>n(c[k])==null||n(c[k])<0)
   ||n(l.totalCostKRW)==null||n(l.costPerUnitKRW)==null)return [];
  if(n(c.goodsNative)!=null&&n(r.goodsForeign)!=null&&Math.abs(Number(c.goodsNative)-Number(r.goodsForeign))>.0001)return [];
  const total=c.goodsKRW+c.freightKRW+c.tariffKRW+c.otherKRW+(n(c.customsKRW)??0);
  if(Math.abs(total-l.totalCostKRW)>.02||Math.abs(l.costPerUnitKRW*l.quantity-total)>.02)return [];
  ids.add(Number(l.wdetailKey));out.push({warehouseDetailKey:Number(l.wdetailKey),duty:Number(c.tariffKRW),other:Number(c.otherKRW)+(n(c.customsKRW)??0),
   evidence:{source:'approved_receipt_formula',costRevisionId:a.costRevisionId,warehouseKey:Number(warehouseKey),orderYear:String(year),orderWeek:a.orderWeek,unit:unit(l.unit),quantity:l.quantity,
    approvalMode:'ACTUAL',expenseBasis:a.editableInput?.input?.expenseBasis||null,costCurrency:'KRW',nativeCurrency:'CNY',actualPaymentCertified:false,liveReceiptStatus:'MATCH'}});
 }
 const active=expected.filter(r=>Number(r.warehouseKey)===Number(warehouseKey)&&r.active);
 return active.length===out.length&&active.every(r=>ids.has(Number(r.warehouseDetailKey)))?out:[];
}
