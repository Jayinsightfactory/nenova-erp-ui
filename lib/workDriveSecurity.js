// Presentation only: never removes audit records or changes ingestion/access controls.
export function isKakaoInbound(row) {
  return row.kind === 'copy' && (row.destKind === 'kakao-in'
    || (row.destKind === 'kakao' && /(?:^|[\\/])(?:카카오톡 받은 파일|받은 파일|KakaoTalk Downloads)(?:[\\/]|$)/i.test(String(row.dest || ''))));
}

export function securityEvent(row) {
  if (isKakaoInbound(row)) return { group: 'reference', label: '카카오톡 수신', direction: '외부 → 이 PC', note: '수신 저장 · 유출 아님', color: '#047857' };
  if (row.kind === 'download') return { group: 'reference', label: '드라이브 내려받기', direction: '업무 드라이브 → PC', note: '내려받기 기록 · 유출로 단정하지 않음', color: '#64748b' };
  if (row.kind === 'upload') return { group: 'reference', label: '드라이브 기록', direction: '업무 드라이브', note: '업로드·분류 교정 기록', color: '#64748b' };
  const info = {
    copy: ['외부 위치 복사', 'PC → 기록된 목적지', '#9a3412'],
    print: ['인쇄', 'PC → 프린터·파일', '#9a3412'],
    email: ['이메일 첨부', 'PC → 이메일', '#1d4ed8'],
    webupload: ['웹 업로드', 'PC → 웹사이트', '#6d28d9'],
    kakao: ['카카오톡 전송', 'PC → 카카오톡', '#a16207'],
  }[row.kind] || ['기타 활동', '방향 확인 필요', '#64748b'];
  return { group: 'review', label: info[0], direction: info[1], note: '업무 목적 확인 · 유출 확정 아님', color: info[2] };
}

export function securityRows(rows, scope = 'review', kind = '') {
  return rows.filter(row => (scope === 'all' || securityEvent(row).group === scope)
    && (!kind || (kind === 'inbound' ? isKakaoInbound(row) : row.kind === kind && !isKakaoInbound(row))));
}

export function securityCounts(rows) {
  return { all: rows.length, review: rows.filter(r => securityEvent(r).group === 'review').length,
    reference: rows.filter(r => securityEvent(r).group === 'reference').length,
    inbound: rows.filter(isKakaoInbound).length };
}
