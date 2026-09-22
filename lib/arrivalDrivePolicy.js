// Pure, shared candidate/preview/write scope policy. Never infer a week from sheet order.
export const ARRIVAL_DRIVE_COUNTRIES = ['네덜란드', '콜롬비아', '에콰도르', '태국', '중국'];
export const ARRIVAL_DRIVE_DELAY_MS = 24 * 60 * 60 * 1000;
// A manual request names exactly one currently selected version; never accepts client file paths.
export function resolveArrivalDriveSelection(candidates, config, selection) {
  if (!config.enabled) throw new Error('자동반영 설정이 꺼져 있습니다');
  if (!selection || !['id', 'sha', 'year', 'week', 'country'].every(k => typeof selection[k] === 'string' && selection[k])) throw new Error('처리할 파일·연도·차수를 확인하세요');
  const source = candidates.find(c => ['id', 'sha', 'year', 'week', 'country'].every(k => c[k] === selection[k]));
  if (!source || source.year !== config.year || !config.countries.includes(source.country)) throw new Error('선택한 최신 파일 또는 설정이 변경되었습니다. 상태를 다시 불러오세요');
  if (source.reason) throw new Error(source.reason);
  if (!Number.isFinite(Date.parse(source.uploadedAt))) throw new Error('드라이브 등록시각 확인 필요');
  return source;
}
export function arrivalDriveTiming(source, state = {}, now = Date.now()) {
  if (state.status === 'complete' || state.status === 'review' || source.reason) return { ready: false, wakeAt: null };
  const uploaded = Date.parse(source.uploadedAt);
  if (!Number.isFinite(uploaded)) return { ready: false, wakeAt: null, reason: '드라이브 등록시각 확인 필요' };
  const eligible = uploaded + ARRIVAL_DRIVE_DELAY_MS;
  const failedAt = Date.parse(state.at);
  const wakeAt = Math.max(eligible, state.status === 'error' && Number.isFinite(failedAt) ? failedAt + 300000 : eligible);
  return { ready: now >= wakeAt, wakeAt, eligibleAt: new Date(eligible).toISOString(), waiting: now < eligible };
}
const countryRules = [
  ['네덜란드', /네덜란드|\bNL\b|netherlands|dutch/i],
  ['콜롬비아', /콜롬비아|colombia/i], ['에콰도르', /에콰도르|ecuador/i],
  ['태국', /태국|thailand|\bthai\b/i], ['중국', /중국|china/i],
];
export function normalizeArrivalDriveWeek(value) {
  const m = String(value || '').match(/^(\d{1,2})-0?([1-4])$/);
  return m && +m[1] >= 1 && +m[1] <= 53 ? `${+m[1]}-${+m[2]}` : '';
}
export function arrivalDriveCandidate(file, year) {
  const name = String(file.filename || '');
  if (file.deleted || !/\.xlsx?$/i.test(name) || !/원가|arrival.?cost/i.test(name)) return null;
  const countries = countryRules.filter(([, re]) => re.test(name)).map(([country]) => country);
  const weekMatch = name.match(/(?:^|[^\d])(\d{1,2})\s*[-_]\s*0?([1-4])(?:차|[^\d]|$)/);
  const week = weekMatch ? normalizeArrivalDriveWeek(`${weekMatch[1]}-${weekMatch[2]}`) : '';
  const rawTime = file.mtime;
  const modified = /^\d{10,13}(?:\.\d+)?$/.test(String(rawTime || ''))
    ? Number(rawTime) * (Number(rawTime) < 1e12 ? 1000 : 1) : Date.parse(rawTime);
  const explicitYear = name.match(/(?:^|[^\d])(20\d{2})(?:년|[^\d]|$)/)?.[1];
  const sourceYear = explicitYear || (Number.isFinite(modified) ? String(new Date(modified).getUTCFullYear()) : '');
  const reason = !week ? '파일명 세부차수 확인 필요' : countries.length !== 1 ? '파일명 국가 확인 필요'
    : sourceYear !== String(year) ? '선택 연도와 원본 연도 불일치' : !Number.isFinite(modified) ? '원본 수정시각 확인 필요'
      : countries[0] === '네덜란드' && String(year) !== '2026' ? 'NL 파서 연도 계약 확인 필요' : '';
  const family = name.replace(/\s*\(\d+\)(?=\.xlsx?$)/i, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return { id: file.id, sha: file.sha, filename: name, uploadedAt: file.uploadedAt, year: String(year), week, country: countries[0] || '', modified, family, reason };
}
export function selectArrivalDriveCandidates(files, { year, countries }) {
  const candidates = files.map(f => arrivalDriveCandidate(f, year)).filter(Boolean);
  const result = [];
  for (const country of countries) {
    const valid = candidates.filter(c => !c.reason && c.country === country);
    const rank = c => +c.week.split('-')[0] * 10 + +c.week.split('-')[1];
    if (!valid.length) continue;
    const latest = Math.max(...valid.map(rank));
    const sameWeek = valid.filter(c => rank(c) === latest).sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id));
    const chosen = sameWeek[0];
    const families = new Set(sameWeek.map(c => c.family));
    if (families.size > 1) chosen.reason = '같은 국가·차수에 서로 다른 원가 파일군이 있습니다. 분할 범위 확인 필요';
    if (sameWeek.some(c => c.modified === chosen.modified && c.sha !== chosen.sha)) chosen.reason = '같은 수정시각의 다른 원본이 있습니다';
    result.push(chosen);
  }
  return result;
}
export function scopeArrivalDriveRows(parsed, source) {
  if (source.reason) throw new Error(source.reason);
  const rows = parsed.rows.filter(r => normalizeArrivalDriveWeek(r.orderWeek) === source.week)
    .map(r => ({ ...r, orderWeek: source.week }));
  if (!rows.length) {
    const detected = [...new Set(parsed.rows.map(r => normalizeArrivalDriveWeek(r.orderWeek)).filter(Boolean))];
    throw new Error(`파일명 차수와 일치하는 도착원가 행이 없습니다 (파일명 ${source.week} / 시트 인식 ${detected.join(', ') || '차수 미인식'})`);
  }
  if (rows.some(r => String(r.orderYear) !== source.year || r.countryName !== source.country)) throw new Error('원본 시트의 연도·국가가 파일명과 다릅니다');
  if (rows.some(r => !(r.quantity > 0) || !(r.sourceArrivalCostKRW > 0))) throw new Error('수량·도착원가가 없는 행이 있습니다');
  if ((parsed.rejectedRows || []).some(r => normalizeArrivalDriveWeek(r.orderWeek) === source.week)) throw new Error('해당 차수에 원가를 계산할 수 없는 품목이 있습니다');
  return { ...parsed, rows, rowCount: rows.length, matchedCount: rows.filter(r => r.matchStatus === 'MATCHED').length,
    unmatchedCount: rows.filter(r => r.matchStatus !== 'MATCHED').length,
    sheetStats: parsed.sheetStats.filter(s => normalizeArrivalDriveWeek(s.orderWeek) === source.week) };
}
