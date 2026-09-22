// Arrival-cost-only policy. No ERP writes or runtime dependencies.
export function normalizeArrivalWeek(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : raw;
}

export function arrivalWeekPredicate(column) {
  return `(TRY_CONVERT(int,PARSENAME(REPLACE(${column},N'-',N'.'),2))=TRY_CONVERT(int,PARSENAME(REPLACE(@week,N'-',N'.'),2)) AND TRY_CONVERT(int,PARSENAME(REPLACE(${column},N'-',N'.'),1))=TRY_CONVERT(int,PARSENAME(REPLACE(@week,N'-',N'.'),1)))`;
}

export function isArrivalExampleSheet(name) {
  return /예시|견본|(?:^|[\s()\[\]_-])(?:example|sample|template)(?=$|[\s()\[\]_-])/i.test(String(name || ''));
}

export function arrivalUploadViewScope(rows = [], fileName = '') {
  const named = String(fileName).match(/(?:^|[^\d])(\d{1,2})[-_]0?(\d{1,2})(?=[^\d]|$)/);
  const preferred = named ? normalizeArrivalWeek(`${named[1]}-${named[2]}`) : '';
  const rank = row => Number(String(row.orderYear)) * 10000 + Number(normalizeArrivalWeek(row.orderWeek).split('-')[0]) * 100 + Number(normalizeArrivalWeek(row.orderWeek).split('-')[1]);
  const sorted = rows.filter(r => /^\d{4}$/.test(String(r.orderYear)) && /^\d{1,2}-\d{1,2}$/.test(normalizeArrivalWeek(r.orderWeek))).slice().sort((a,b) => rank(b)-rank(a));
  const selected = sorted.find(r => normalizeArrivalWeek(r.orderWeek) === preferred) || sorted[0];
  return selected ? { orderYear: String(selected.orderYear), orderWeek: normalizeArrivalWeek(selected.orderWeek), country: '', flower: '', product: '', farm: '', weekOrder: 'desc', allVarieties: '1' } : null;
}
