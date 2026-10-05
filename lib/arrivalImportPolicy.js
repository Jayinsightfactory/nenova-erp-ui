// Arrival-cost-only policy. No ERP writes or runtime dependencies.
export function validateArrivalImportYear(parsed, selectedYear) {
  const year = String(selectedYear || parsed?.rows?.[0]?.orderYear || '');
  if (!/^20\d{2}$/.test(year)) throw new Error('도착원가 연도를 명시해 주세요');
  if ((parsed?.rows || []).some(r => r.yearEvidence?.status === 'conflict' || String(r.orderYear) !== year)
    || (parsed?.rejectedRows || []).some(r => r.yearEvidence?.status === 'conflict' || (r.orderYear && String(r.orderYear) !== year))) {
    throw new Error('선택 연도와 원본 파일·시트 연도 불일치: 저장하지 않았습니다');
  }
  return year;
}
export function normalizeArrivalWeek(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : raw;
}

export function arrivalWeekPredicate(column) {
  return `(TRY_CONVERT(int,PARSENAME(REPLACE(${column},N'-',N'.'),2))=TRY_CONVERT(int,PARSENAME(REPLACE(@week,N'-',N'.'),2)) AND TRY_CONVERT(int,PARSENAME(REPLACE(${column},N'-',N'.'),1))=TRY_CONVERT(int,PARSENAME(REPLACE(@week,N'-',N'.'),1)))`;
}

export function isArrivalExampleSheet(name) {
  return /예시|견본|(?:^|[\s()\[\]_-])(?:example|sample|template|plantilla)(?=$|[\s()\[\]_-])/i.test(String(name || ''));
}

export function arrivalUploadViewScope(rows = [], fileName = '') {
  const named = String(fileName).match(/(?:^|[^\d])(\d{1,2})[-_]0?(\d{1,2})(?=[^\d]|$)/);
  const preferred = named ? normalizeArrivalWeek(`${named[1]}-${named[2]}`) : '';
  const rank = row => Number(String(row.orderYear)) * 10000 + Number(normalizeArrivalWeek(row.orderWeek).split('-')[0]) * 100 + Number(normalizeArrivalWeek(row.orderWeek).split('-')[1]);
  const sorted = rows.filter(r => /^\d{4}$/.test(String(r.orderYear)) && /^\d{1,2}-\d{1,2}$/.test(normalizeArrivalWeek(r.orderWeek))).slice().sort((a,b) => rank(b)-rank(a));
  const selected = sorted.find(r => normalizeArrivalWeek(r.orderWeek) === preferred) || sorted[0];
  return selected ? { orderYear: String(selected.orderYear), orderWeek: normalizeArrivalWeek(selected.orderWeek), country: '', flower: '', product: '', farm: '', weekOrder: 'desc', allVarieties: '1' } : null;
}
