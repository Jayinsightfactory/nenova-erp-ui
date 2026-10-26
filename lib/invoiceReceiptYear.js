// Explicit source dates only. Never substitute the computer's current year.
export function invoiceDateYear(invoice) {
  if ((invoice?.extractionIssues || []).some(issue => ['DATE_YEAR_AMBIGUOUS', 'DATE_YEAR_CONFLICT', 'DATE_CONFLICT'].includes(issue?.code))) return '';
  const years = [...new Set(String(invoice?.date || '').match(/\b(?:19|20)\d{2}\b/g) || [])];
  return years.length === 1 ? years[0] : '';
}

export function receiptYearConflict(document) {
  const evidence = document?.reviewedMetadata?.orderYearEvidence;
  const selected = String(document?.orderYear || '').trim();
  return Boolean(evidence?.invoiceYear && selected && selected !== evidence.invoiceYear
    && evidence.confirmedYear !== selected);
}

export const RECEIPT_YEAR_CONFLICT_MESSAGE = '선택한 입고 연도와 인보이스 연도가 다릅니다. 입고 연도 아래에서 적용 연도를 확인하세요.';
