// Printed dates are source references, not the ERP InputDate chosen in receipt management.
const REFERENCE_DATE_CODES = new Set([
  'DATE_SOURCE_UNAVAILABLE','DATE_ORDER_AMBIGUOUS','DATE_YEAR_AMBIGUOUS','DATE_YEAR_CONFLICT',
  'DATE_ORDER_CONFLICT','DATE_INVALID_CALENDAR','DATE_FORMAT_UNSUPPORTED','DATE_CONFLICT',
  'DATE_KIND_UNAVAILABLE','DATE_KIND_CONTRACT_MISMATCH',
]);
export function isPackingReferenceDateIssue(issue) { return REFERENCE_DATE_CODES.has(issue?.code); }
export function blockingPackingIssues(issues = []) { return issues.filter(issue => !isPackingReferenceDateIssue(issue)); }
export function receiptSourceDate(invoice) {
  if ((invoice?.extractionIssues || []).some(isPackingReferenceDateIssue)) return '';
  const value=String(invoice?.date??'').replaceAll('/','-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?value:'';
}
