import {isDefectDeductionRow} from './estimateInvariants.js';
export const PRINT_HEADER_KEY='@document-header';
// Shared printable-row identity. A changed cost/type/date is a different annotation.
export function weekdayPrintRowKey(row) {
  if(!Number.isSafeInteger(Number(row?.ProdKey)) || Number(row.ProdKey)<=0 || !Number.isFinite(Number(row.Cost))) return null;
  return JSON.stringify([Number(row.ProdKey),Number(row.Cost),String(row.EstimateType||'정상출고'),Number(row.EstimateKey)||0]);
}
export function weekdayPrintNoteEntries(requests,results) {
  return results.flatMap((result,index)=>result.items.map(row=>{
    const rowKey=weekdayPrintRowKey(row);if(!rowKey)return null;
    const note=result.printNotes?.[rowKey];
    return {id:`${index}|${rowKey}`,rowKey,scope:requests[index],name:row.ProdName,
      text:note?.note ?? (isDefectDeductionRow(row)?'':row.Descr ?? ''),revision:note?.revision ?? 0};
  }).filter(Boolean).concat(result.items.length?[{
    id:`${index}|${PRINT_HEADER_KEY}`,rowKey:PRINT_HEADER_KEY,scope:requests[index],name:'차수 표시',
    text:result.printNotes?.[PRINT_HEADER_KEY]?.note ?? `${Number(requests[index].majorWeek)}차`,
    revision:result.printNotes?.[PRINT_HEADER_KEY]?.revision ?? 0,
  }]:[]));
}
