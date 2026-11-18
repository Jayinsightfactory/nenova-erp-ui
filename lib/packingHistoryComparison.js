import {PACKING_RECEIPT_SOURCE_CONTRACTS,nullableNumber} from './importPackingReceiptAdapter.js';

// Read-only stored extraction comparison. Never call this an ERP save readback.
export function packingHistoryComparison(snapshot) {
  const country=snapshot?.country, contract=PACKING_RECEIPT_SOURCE_CONTRACTS[country];
  if(!contract)throw Error('이 국가의 수량 대조 기준을 확인할 수 없습니다.');
  const extraction=snapshot?.lastExtraction;
  const source=extraction?.sourceInvoices, current=extraction?.result?.invoices;
  if(!Array.isArray(source)||!Array.isArray(current))throw Error('보관된 원본·분석 결과가 없습니다.');
  const first=(row,fields)=>{for(const field of fields||[]){const value=nullableNumber(row?.[field]);if(value!==null)return value;}return null;};
  const summarize=invoices=>invoices.map(invoice=>{
    const products=country==='NL'?invoice.lines:invoice.products;
    if(!Array.isArray(products))throw Error('보관 품목 목록을 확인할 수 없습니다.');
    const rows=products.map((row,index)=>{
      const unitPrice=first(row,contract.unitPriceFields);
      let amount=first(row,contract.lineAmountFields);
      if(amount===null&&contract.lineAmountDerivedFrom){const factors=contract.lineAmountDerivedFrom.map(field=>nullableNumber(row[field]));if(factors.every(value=>value!==null))amount=factors.reduce((a,b)=>a*b,1);}
      return {line:index+1,name:String(row.description??row.variety??row.name??row.matchedName??'—'),matchedName:String(row.matchedName??''),
        boxes:first(row,contract.boxFields),bunches:first(row,contract.bunchFields),stems:first(row,contract.stemFields),unitPrice,amount};
    });
    const total=field=>rows.every(row=>row[field]!==null)?rows.reduce((sum,row)=>sum+row[field],0):null;
    return {invoiceNo:String(invoice.invoice_no??invoice.invoice_number??invoice.invoice??'—'),currency:String(invoice.currency?.code??invoice.currency??'미확인'),
      rows,totals:{items:rows.length,boxes:total('boxes'),bunches:total('bunches'),stems:total('stems'),amount:total('amount')},
      declaredTotal:nullableNumber(invoice.invoice_total??invoice.total_value)};
  });
  return {source:summarize(source),current:summarize(current)};
}
