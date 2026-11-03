import { normalizeDefectUnit } from './salesDefectDeductionCore.js';
export function defectBatchDuplicates(rows = [], excludedKeys = new Set()) {
 const seen=[]; const warnings=new Map();
 for(const row of rows) {
  if(excludedKeys.has(Number(row.deductionKey)) || row.error || !row.after) continue;
  const a=row.after, quantity=Math.abs(Number(row.editQuantity ?? row.quantity));
  if(!(quantity>0))continue;
  const prior=seen.find(p=>Number(p.after.ShipmentKey)===Number(a.ShipmentKey)&&Number(p.after.ProdKey)===Number(a.ProdKey)&&Number(p.after.AppliedOrderYear)===Number(a.AppliedOrderYear)&&String(p.after.AppliedOrderWeek)===String(a.AppliedOrderWeek)&&normalizeDefectUnit(p.after.Unit)===normalizeDefectUnit(a.Unit)&&Math.abs(Math.abs(Number(p.editQuantity??p.quantity))-quantity)<0.0001);
  if(prior) warnings.set(Number(row.deductionKey), `${row.customerName} / ${a.ProdName || row.productName} / ${quantity}${a.Unit}: 선택한 원장 #${prior.deductionKey}과 동일한 차감입니다. 앞선 행이 등록되면 이 행은 중복 제외하고 나머지를 계속 등록합니다.`);
  else seen.push(row);
 }
 return warnings;
}
