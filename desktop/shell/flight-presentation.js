/* Shared presentation only: no status inference, network calls or ledger writes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NenovaFlightPresentation = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  function issueRows(rows) {
    const unique = new Map();
    for (const row of rows || []) {
      const text = normalize(row.text);
      if (!text) continue;
      const identity = row.key || row.viewId || row.label || '';
      const key = JSON.stringify([identity, text]);
      const prior = unique.get(key);
      if (!prior || row.level === 'red') unique.set(key, { ...row, text });
    }
    return [...unique.values()].sort((a, b) => Number(b.level === 'red') - Number(a.level === 'red'));
  }
  function shortIssue(text) {
    return normalize(text)
      .replace('스케줄 변경 공지가 선율방에 없음', '선율방 변경 공지 미확인')
      .replace('공항 예정 시각이 공지와 다름:', '도착 시각 불일치:')
      .replace('변경 공지가 일부 방에만 올라옴', '변경 공지 공유 누락')
      .replace('서류 전달 표시 없음', '서류 전달 미확인');
  }
  return { issueRows, shortIssue };
});
