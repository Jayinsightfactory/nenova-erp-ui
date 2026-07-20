// 운송기준원가 BILL/AWB 그룹의 화면 검색만 담당한다.
// 검색은 이미 로드된 그룹 배열에만 적용하며 WarehouseMaster/FreightCost를 변경하지 않는다.

export function normalizeFreightSearchTerm(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s-]+/g, '');
}

export function freightGroupSearchText(group = {}) {
  return [
    group.GroupKey,
    group.AWB,
    group.OrderWeek,
    group.FarmName,
    group.InvoiceNo,
    group.InputDate,
  ]
    .map(normalizeFreightSearchTerm)
    .filter(Boolean)
    .join(' ');
}

export function filterFreightGroups(groups = [], rawQuery = '', selectedGroupKey = '') {
  const source = Array.isArray(groups) ? groups : [];
  const terms = String(rawQuery ?? '')
    .trim()
    .split(/\s+/)
    .map(normalizeFreightSearchTerm)
    .filter(Boolean);

  if (terms.length === 0) return source;

  const matches = source.filter((group) => {
    const searchText = freightGroupSearchText(group);
    return terms.every((term) => searchText.includes(term));
  });

  // 검색어를 바꿔도 현재 선택된 그룹은 select의 value가 유효하도록 유지한다.
  const selected = source.find((group) => String(group.GroupKey) === String(selectedGroupKey));
  if (selected && !matches.some((group) => String(group.GroupKey) === String(selectedGroupKey))) {
    return [selected, ...matches];
  }
  return matches;
}
