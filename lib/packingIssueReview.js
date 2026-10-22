// Display-only queue. Hiding an advisory never clears server validation or grants approval.
const ADVISORY = {
  VERIFIED_BASELINE_UNAVAILABLE: '자동 검산 근거가 없어 원문 확인이 필요합니다.',
  POSITIONED_EVIDENCE_UNAVAILABLE: '원문 위치를 정확히 찾지 못했습니다.',
  SOURCE_ROW_CHANGED: '자동 검산 이후 인식값이 변경되었습니다.',
};
export function packingRowReviewState(entry, draft, matchedName, issues = []) {
  const row = entry.row || {};
  const blocking = issues.filter(issue => issue.invoiceIndex === entry.invoiceIndex && issue.lineIndex === row.lineIndex).map(issue => issue.text);
  if (!matchedName) blocking.push('DB 품목 미매칭: 품목을 선택하세요.');
  const advisory = [];
  if (row.quantityWarning) advisory.push(row.quantityWarning);
  for (const code of row.reviewReasons || []) {
    // Some invoices have no carton-number column at all. Missing optional numbering
    // proof alone is not a quantity issue; explicit carton/quantity warnings still block.
    if (code === 'CARTON_AUDIT_UNAVAILABLE') continue;
    if (ADVISORY[code]) advisory.push(ADVISORY[code]);
    else blocking.push(code === 'PRICE_OR_AMOUNT_MISSING' ? '단가 또는 금액을 확인하세요.'
      : code === 'CARTON_NUMBER_WARNING' ? '박스 번호와 수량을 확인하세요.' : `원문 확인 필요: ${code}`);
  }
  if (row.reviewRequired !== false && !(row.reviewReasons || []).length && !advisory.length && !blocking.length) advisory.push('원문과 인식값을 대조하세요.');
  const signature = JSON.stringify([row.sourceSnapshotId, draft?.values || row.values, blocking, advisory]);
  return { blocking, advisory, signature, canDismiss: blocking.length === 0 && advisory.length > 0,
    hasIssue: blocking.length > 0 || advisory.length > 0 };
}
