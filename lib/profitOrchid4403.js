import { calcPurchaseRatio, displayedProfitRate } from './profitReportCalc.js';

export const ORCHID_4403 = Object.freeze({ year:'2026', major:'44', week:'44-03', warehouse:7870, detail:47389, product:3529, awb:'99997130176', quantity:600, originalPrice:230, approvedPrice:23, originalAmount:138000, approvedAmount:13800 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const close = (a,b) => finite(a) && finite(b) && Math.abs(a-b)<.01;
export const orchid4403Scope = (year,major) => String(year)==='2026' && Number(major)===44;

export function orchid4403Identity(row) {
  const a=ORCHID_4403;
  return String(row?.OrderYear)===a.year && row.OrderWeek===a.week
    && Number(row.WarehouseKey)===a.warehouse && Number(row.WdetailKey ?? row.WarehouseDetailKey)===a.detail
    && Number(row.ProdKey)===a.product && String(row.OrderNo).replace(/\D/g,'')===a.awb
    && String(row.FarmName).trim().toLowerCase()==='cloudland'
    && row.OutUnit==='송이' && row.CounName==='중국'
    && Number(row.OutQuantity)===a.quantity && Number(row.SteamQuantity)===a.quantity;
}
export function orchid4403Amount(row) {
  if (!orchid4403Identity(row)) return row.TPrice;
  return close(Number(row.TPrice),ORCHID_4403.originalAmount) && close(Number(row.UPrice),ORCHID_4403.originalPrice) ? ORCHID_4403.approvedAmount : row.TPrice;
}

export function applyOrchid4403View(payload,evidence,{orderYear,major}) {
  if (!orchid4403Scope(orderYear,major) || payload?.orchid4403View) return payload;
  const out=structuredClone(payload);
  const fail=reason=>{
    out.orchid4403View={version:1,changed:false,reason,label:'44-03 호접란 승인단가 대조 필요 · 원본 보존'};
    out.audit={...out.audit,issues:[...(out.audit?.issues||[]),{severity:'warning',category:'중국',code:'ORCHID_4403_REVIEW',columns:['Q','P','F'],message:'승인된 호접란23 CNY/송이의 원천 또는 저장금액 대조가 맞지 않아 자동 보완하지 않았습니다.'}]};
    out.audit.errorCount=out.audit.issues.filter(issue=>issue.severity==='error').length;
    out.audit.warningCount=out.audit.issues.filter(issue=>issue.severity==='warning').length;
    out.audit.status=out.audit.errorCount?'needs_input':'needs_review';
    return out;
  };
  if (String(payload.orderYear)!==String(orderYear)||Number(payload.major)!==Number(major)) return fail('payload_scope_mismatch');
  const source=evidence?.line;
  if (!orchid4403Identity(source) || evidence.count!==1) return fail('source_identity_mismatch');
  const sourceOld=close(Number(source.TPrice),138000)&&close(Number(source.UPrice),230);
  const sourceNew=close(Number(source.TPrice),13800)&&close(Number(source.UPrice),23);
  if (!sourceOld&&!sourceNew || !finite(evidence.purchaseTotal)) return fail('source_amount_mismatch');
  const rawTotal=evidence.purchaseTotal+(sourceNew?124200:0), correctedTotal=rawTotal-124200;
  const row=out.rows?.find(row=>row.category==='중국'), c=row?.calc;
  if(!c)return fail('category_missing');
  if(close(c.Q,correctedTotal)) {
    out.orchid4403View={version:1,changed:false,reason:'already_applied',label:'44-03 호접란 승인단가 반영값 · 중복 차감 없음'};
    return out;
  }
  if(!close(c.Q,rawTotal)||!close(row.auto?.Q,c.Q)||!(c.R>0)
    ||!close(c.P,c.Q*c.R)||!close(c.G,c.P+c.T)
    ||['Q','P','G','F'].some(key=>row.manual?.[key]!=null))return fail('purchase_basis_mismatch');
  const end=row.inventoryValuation?.end;
  let deltaF=0;
  if (end?.method==='no_stock'&&close(c.F,0)) deltaF=0;
  else {
    const avg=end?.average;
    if(end?.method!=='category_average'||end.year!=='2026'||Number(end.major)!==44||end.unit!=='단'
      ||!(avg?.purchaseQty>0)||!finite(end.quantity)||end.quantity<0
      ||!close(end.value,c.F)||!close(avg.purchaseForeign,c.Q)||!close(avg.totalCost,c.G+c.H)
      ||!close(avg.unitCost*end.quantity,c.F)||!close(avg.totalCost/avg.purchaseQty,avg.unitCost)) return fail('ending_average_mismatch');
    deltaF=-124200*c.R/avg.purchaseQty*end.quantity;
  }
  const before={...c},deltaQ=-124200,deltaP=deltaQ*c.R,deltaI=deltaP-deltaF;
  Object.assign(c,{Q:c.Q+deltaQ,P:c.P+deltaP,G:c.G+deltaP,F:c.F+deltaF,
    I:c.I==null?null:c.I+deltaI,J:c.J==null?null:c.J-deltaI});
  c.K=displayedProfitRate(c);
  row.auto={...row.auto,Q:c.Q,F:c.F};
  if(deltaF!==0){
    row.stock={...row.stock,evidenceValue:c.F};end.value=c.F;
    end.average={...end.average,purchaseForeign:c.Q,totalCost:end.average.totalCost+deltaP,unitCost:end.average.unitCost+deltaP/end.average.purchaseQty};
    end.sources=[...(end.sources||[]),'owner-approved:2026:44-03:warehouse7870:detail47389:23CNY-per-stem:display-only'];
  }
  row.orchid4403View={originalCalc:before,deltaQ,deltaP,deltaF,deltaI,source:'owner_approved_exact_invoice_unit_price'};
  for(const totalsKey of ['totals','effectiveViewTotals','confirmedTotals']) {
    const totals=out[totalsKey];if(!totals)continue;
    for(const [key,delta]of Object.entries({Q:deltaQ,P:deltaP,G:deltaP,F:deltaF,I:deltaI,J:-deltaI}))if(finite(totals[key]))totals[key]+=delta;
    totals.K=displayedProfitRate(totals);
  }
  const totals=out.confirmedTotals||out.effectiveViewTotals||out.totals;
  if(totals)for(const item of out.rows)item.calc.U=calcPurchaseRatio(item.calc,totals);
  out.orchid4403View={version:1,changed:true,identity:'2026/44-03/7870/47389/3529/99997130176',quantity:600,unit:'송이',approvedPrice:23,originalAmount:138000,approvedAmount:13800,deltaQ,deltaP,deltaF,deltaI,label:'44-03 호접란23 CNY/송이 표시 보완 · DB·저장 원본 보존'};
  out.financialReadPolicy={...out.financialReadPolicy,label:out.orchid4403View.label};
  out.audit={...out.audit,issues:[...(out.audit?.issues||[]),{severity:'info',category:'중국',code:'ORCHID_4403_APPROVED_VIEW',columns:['Q','P','F','I','J','K'],message:'44-03 호접란600송이의 승인단가23 CNY를 웹 표시에서만 적용했습니다(138,000→13,800 CNY). 검증된 기말 평균원가도 연동했으며 DB·저장 원본 및 다른 차수는 보존합니다.'}]};
  return out;
}
