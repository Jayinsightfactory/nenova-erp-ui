import { INVOICE_COST_FORMULAS, previewInvoiceCost } from './invoiceReceiptCost.js';

// Only for calculation/download workspaces. Never use this to approve/save costs.
export function readOnlyInvoiceCostValidation(document, receiptLines, rawInput) {
  const input = { ...rawInput, formulaApplicabilityConfirmed: true };
  const formula = INVOICE_COST_FORMULAS[input.formulaId];
  const country = String(document.reviewedMetadata?.country || '').trim().toUpperCase();
  const transport = String(document.reviewedMetadata?.transportMode || '').trim().toUpperCase();
  if(!formula || formula.country!==country || formula.transportMode!==transport)
    return {input,preview:{status:'REVIEW_REQUIRED',lines:[],issues:[{code:'FORMULA_SCOPE_MISMATCH',severity:'error',message:'입고 국가·운송과 원가 공식이 일치하지 않습니다.'}]}};
  const lines = receiptLines.map(line => ({ ...line,
    priceUnit: formula?.priceBasis || (formula?.country === 'NL' ? 'STEM' : 'BUNCH') }));
  return { input, preview: previewInvoiceCost({ ...document, lines, receiptLines: lines, costInput: input }, lines) };
}
