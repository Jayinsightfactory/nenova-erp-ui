// Display only: never grants approval, changes source values, or writes ERP data.
export function packingReviewErrorSummary(errors = {}) {
  const lines = Object.entries(errors).flatMap(([key, fields]) =>
    Object.values(fields || {}).filter(Boolean).map(message => `인보이스 ${Number(key) + 1}: ${message}`));
  return lines.length ? `다음 단계로 진행할 수 없습니다. 확인할 항목 ${lines.length}건입니다.\n${lines.slice(0, 8).join('\n')}${lines.length > 8 ? '\n나머지 항목은 각 입력칸의 안내를 확인하세요.' : ''}\n입력한 날짜와 매칭은 유지됩니다.` : '';
}

export function notifyPackingBlocked(message) {
  if (typeof window !== 'undefined') window.alert(message);
}
