import { autoSourceStateFromRow } from './salesDefectAutoSource.js';

const clean = value => String(value ?? '').normalize('NFKC').trim();
const searchable = value => clean(value).replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
export function defectCompanyKey(row = {}) {
  const key = Number(row.custKey);
  return key > 0 ? `customer:${key}` : `name:${searchable(row.customerName)}`;
}
export function matchesDefectCompany(row, key) {
  return !key || defectCompanyKey(row) === key;
}
export function defectCompanyChoices(rows = [], query = '') {
  const groups = new Map();
  for (const row of rows) {
    const key = defectCompanyKey(row);
    if (!groups.has(key)) groups.set(key, { key, name: clean(row.customerName) || '업체 미입력', custKey: Number(row.custKey) || 0, count: 0, names: [] });
    const group = groups.get(key);
    group.count++;
    group.names.push(row.customerName, row.originalCustomerName, row.matchedCustomerName, row.customerAlias);
  }
  const term = searchable(query);
  return [...groups.values()].filter(group => !term || group.names.some(name => searchable(name).includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }) || a.key.localeCompare(b.key));
}
export function defectInputSource(row = {}) {
  if (row.manualSourceConfirmed || row.autoSourceEvidence === 'MANUAL_SOURCE_CONFIRMED') return { label: '직접입력', detail: '수기 입력으로 확인된 자료입니다.' };
  const auto = autoSourceStateFromRow(row);
  if (auto.excluded) return { label: '자동수집', detail: auto.evidence === 'HISTORY_SOURCE' ? '과거 입력 이력에 자동수집 출처가 있습니다.' : '자동수집 출처가 기록된 자료입니다.' };
  if (clean(row.sourceFileName)) return { label: '파일 업로드', detail: `입력 파일: ${clean(row.sourceFileName)}` };
  return { label: '직접입력', detail: '파일·자동수집 표식이 없는 입력입니다. 최초 입력자는 수정이력에서 확인하세요.' };
}
