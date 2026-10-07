import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

const fail = message => { throw new Error(`엑셀 반영 불가: ${message}`); };
const sameBusiness = (a, b) => Number(a.year) === Number(b.year) && a.orderWeek === b.orderWeek
  && Number(a.custKey) === Number(b.custKey) && Number(a.prodKey) === Number(b.prodKey);
const dateKey = value => String(value ?? '').slice(0, 10);
const quantity = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === ''
    || !Number.isFinite(Number(value)) || Number(value) < 0) fail('수량을 확인하세요.');
  return Number(value);
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;

export function buildWeekdayWorkbookExportUpdates({ links, plans, compareRows, custKey, scopeKey, fileId }) {
  if (!Array.isArray(links) || !Array.isArray(plans) || !Array.isArray(compareRows) || !fileId
    || !/^\d+\|\d{4}\|\d{2}$/.test(scopeKey || '') || Number(scopeKey.split('|')[0]) !== Number(custKey)) fail('파일·조회 범위를 확인하세요.');
  const selected = links.filter(link => link.fileId === fileId && link.draftScope === scopeKey && Number(link.custKey) === Number(custKey));
  const cells = new Set(), identities = new Set();
  return selected.map(link => {
    if (!link.sheet || !/^[A-Z]+[1-9]\d*$/.test(link.sourceCell || '') || !validDate(link.date)
      || !Number.isInteger(Number(link.year)) || Number(link.year)<2000 || Number(link.year)>2200
      || !/^\d{2}-\d{2}$/.test(link.orderWeek || '') || !Number.isSafeInteger(Number(link.prodKey)) || Number(link.prodKey)<=0) fail('원본 셀 연결을 다시 확인하세요.');
    const cellKey = `${link.sheet}|${link.sourceCell}`, identity = `${link.year}|${link.orderWeek}|${link.custKey}|${link.prodKey}|${link.date}`;
    if (cells.has(cellKey) || identities.has(identity)) fail('복수 원본 셀 연결입니다. 중복 연결을 해제하세요.');
    cells.add(cellKey); identities.add(identity);
    const sourceUnit = normalizeWeekdayUnit(link.unit);
    const actual = compareRows.filter(row => sameBusiness(row, link));
    if (actual.length !== 1 || !sourceUnit || normalizeWeekdayUnit(actual[0].outUnit) !== sourceUnit) fail('전산 품목·단위 근거를 확인하세요.');
    const snapshot = actual[0];
    const knownAbsent = snapshot.state === 'NO_SHIPMENT' && snapshot.detailRows === 0
      && snapshot.shipmentOutQuantity === null && Array.isArray(snapshot.shipmentDates) && snapshot.shipmentDates.length === 0;
    const knownFound = ['FOUND_UNFIXED','FIXED_REVIEW_REQUIRED'].includes(snapshot.state)
      && snapshot.detailRows === 1 && Array.isArray(snapshot.shipmentDates);
    if (snapshot.customerLinkError || (!knownAbsent && !knownFound)) fail('확인된 전산 분배 근거가 없습니다.');
    const actualDates = new Set();
    for (const day of snapshot.shipmentDates) {
      const date = dateKey(day.date);
      if (!validDate(date) || actualDates.has(date)) fail('전산 날짜가 중복되거나 잘못되었습니다.');
      actualDates.add(date); quantity(day.shipmentQuantity);
    }
    const scoped = plans.filter(plan => plan.draftScope === scopeKey && Number(plan.custKey) === Number(custKey));
    if (scoped.some(plan => plan.sheet === link.sheet && plan.sourceCell === link.sourceCell
      && (!sameBusiness(plan, link) || plan.date !== link.date))) fail('날짜·차수가 이동되었습니다. 원본 셀을 다시 연결하세요.');
    const matching = scoped.filter(plan => sameBusiness(plan, link) && plan.date === link.date);
    if (matching.length > 1) fail('같은 업무키에 복수 입력이 있습니다.');
    let value;
    if (matching.length) {
      if (normalizeWeekdayUnit(matching[0].unit) !== sourceUnit) fail('입력 단위가 원본과 다릅니다.');
      value = quantity(matching[0].quantity);
    } else {
      const row = actual[0];
      if (!Array.isArray(row.shipmentDates)) fail('전산 날짜 근거가 없습니다.');
      if (knownAbsent) value = 0;
      else {
        if (row.detailRows !== 1 || !['FOUND_UNFIXED','FIXED_REVIEW_REQUIRED'].includes(row.state)) fail('확인된 전산 분배 근거가 없습니다.');
        const day = row.shipmentDates.find(day => dateKey(day.date) === link.date);
        value = day ? quantity(day.shipmentQuantity) : 0;
      }
    }
    return { sheetName: link.sheet, address: link.sourceCell, value };
  });
}
