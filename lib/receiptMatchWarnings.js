// Only this derived warning belongs to product matching. Preserve every other
// source warning, including original quantity/weight/truncation review blockers.
export const RECEIPT_MATCH_WARNING = '유사·기본 별칭으로 연결된 전산 품목은 수동 매칭을 확인해야 합니다.';

export function receiptMatchWarnings(document) {
  const warnings = (document?.sourceWarnings || []).filter(warning => warning !== RECEIPT_MATCH_WARNING);
  return (document?.lines || []).some(line => line.prodKey && line.reviewed?.erpMatchConfirmed !== true)
    ? [...warnings, RECEIPT_MATCH_WARNING] : warnings;
}
