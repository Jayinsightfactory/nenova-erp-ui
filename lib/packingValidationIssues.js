// Display-only diagnostics. Never clears an issue or grants receipt approval.
import { blockingPackingIssues } from './packingReceiptDatePolicy.js';
import { packingSourceValueIssues } from './importPackingSourceReview.js';
export const PACKING_METADATA_LABELS = {date:'인쇄 날짜',date_kind:'날짜 의미',currency:'통화',invoice_total:'송장 총액',handling:'Handling 비용'};
export function packingIssueField(item) {
  const code=String(item?.code||'').toUpperCase(), field=String(item?.field||'').toLowerCase();
  if(code.startsWith('DATE_KIND_')||field==='date_kind')return 'date_kind';
  if(code.startsWith('DATE_')||['date','raw_date','date_order'].includes(field))return 'date';
  if(code.startsWith('CURRENCY_')||field==='currency')return 'currency';
  if(/^(INVOICE_TOTAL_|AMOUNT_COMPONENTS_|INVOICE_EXTRAS_)/.test(code)||['invoice_total','total_value','freight_total'].includes(field))return 'invoice_total';
  return null;
}
export function packingIssueText(item, invoice={}) {
  const field=packingIssueField(item);
  const value=item?.extractedValue ?? item?.rawValue ?? (field==='invoice_total' ? invoice.invoice_total ?? invoice.total_value : invoice[field]);
  const expected=item?.expected ?? item?.expectedValue ?? item?.normalizedRawValue;
  const show=value=>value===null||value===undefined||value===''?'미인식':String(value);
  return `${PACKING_METADATA_LABELS[field]||item?.field||'원문 검증'}: ${item?.message||item?.code||'확인 필요'} · 현재 ${show(value)}${expected===undefined?'':` · 기준 ${show(expected)}`}`;
}
export function packingValidationIssues(invoices=[],country) {
  return invoices.flatMap((invoice,invoiceIndex)=>[
    ...blockingPackingIssues(invoice.extractionIssues).map(issue=>({
    invoiceIndex,field:packingIssueField(issue),code:issue.code,
    invoiceLabel:invoice.invoice||`인보이스 ${invoiceIndex+1}`,text:packingIssueText(issue,invoice),
    })),
    ...(country && invoice.pdfReviewRequired ? (invoice[country==='NL'?'lines':'products']||[]).flatMap((row,lineIndex)=>packingSourceValueIssues(invoice,country,lineIndex).map(message=>({
      invoiceIndex,lineIndex,field:null,code:'SOURCE_ROW_INVALID',invoiceLabel:invoice.invoice||`인보이스 ${invoiceIndex+1}`,
      text:message.replaceAll('u_price','단가').replaceAll('t_price','금액').replaceAll('total_bunch','단수').replaceAll('total_stems','송이').replaceAll('pcs','박스'),
    }))) : []),
  ]);
}
