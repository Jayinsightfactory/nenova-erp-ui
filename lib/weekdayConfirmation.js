import { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from './weekdayCustomerLink.js';

// ERP confirmation is independent of the page's immutable first-allocation baseline.
export function normalizeWeekdayConfirmationScope(input = {}) {
  const yearText = String(input.year ?? '').trim();
  const weekText = String(input.majorWeek ?? '').trim();
  const year = Number(yearText), week = Number(weekText);
  if (!/^\d{4}$/.test(yearText) || year < 2000 || year > 2200) throw new Error('확정 현황의 연도를 지정하세요.');
  if (!/^\d{1,2}$/.test(weekText) || week < 1 || week > 53) throw new Error('확정 현황의 메인차수를 지정하세요.');
  return { year, majorWeek:String(week).padStart(2,'0'), allCustomers:true };
}

// All subcycles and customers in the selected major cycle; not just visible products.
// Positive shipment allocations are counted without dropping integrity warnings.
// UnknownCount below is the historical SQL diagnostic column, not an isFix flag.
export const WEEKDAY_CONFIRMATION_SQL = `SELECT sm.OrderYear,sm.OrderWeek,
  COALESCE(NULLIF(p.CountryFlower,N''),N'품종 미지정') AS CountryFlower,
  COUNT_BIG(*) AS TotalCount,
  SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) AS FixedCount,
  SUM(CASE WHEN p.ProdKey IS NULL OR ISNULL(p.isDeleted,0)<>0 OR NULLIF(p.CountryFlower,N'') IS NULL
    OR NOT ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL} OR c.CustKey IS NULL THEN 1 ELSE 0 END) AS UnknownCount
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
 LEFT JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
 WHERE sm.OrderYear=@year AND sm.OrderWeek LIKE @weekPrefix
   AND ISNULL(sm.isDeleted,0)=0 AND sd.OutQuantity>0
 GROUP BY sm.OrderYear,sm.OrderWeek,p.CountryFlower
 ORDER BY p.CountryFlower,sm.OrderWeek`;

const countValue = value => value == null || value === '' ? null : Number(value);
const stateOf = (fixed,total,unknown) => unknown ? 'UNKNOWN' : !total ? 'EMPTY'
  : fixed === total ? 'FIXED' : fixed > 0 ? 'PARTIAL' : 'UNFIXED';

export function buildWeekdayConfirmationSummary(input, rows = []) {
  const scope = normalizeWeekdayConfirmationScope(input);
  if (!Array.isArray(rows)) throw new Error('확정 현황 행을 확인할 수 없습니다.');
  const groups = new Map();
  for (const row of rows) {
    if (Number(row?.OrderYear) !== scope.year || !String(row?.OrderWeek ?? '').startsWith(`${scope.majorWeek}-`)) continue;
    // The SQL includes every matching subcycle. Never silently drop a malformed
    // matching row and report the remaining rows as fully confirmed.
    if (!/^\d{2}-\d{2}$/.test(String(row.OrderWeek))) throw new Error('확정 현황의 세부차수 형식을 확인할 수 없습니다.');
    const name = String(row.CountryFlower ?? '').trim() || '품종 미지정';
    const total = countValue(row.TotalCount), fixed = countValue(row.FixedCount), warning = countValue(row.UnknownCount);
    if (![total,fixed,warning].every(value => Number.isSafeInteger(value) && value >= 0)
      || fixed > total || warning > total) throw new Error('확정 현황 건수에 모순이 있습니다.');
    const group = groups.get(name) || { countryFlower:name, fixedCount:0,totalCount:0,unknownCount:0,warningCount:0,orderWeeks:[] };
    group.fixedCount += fixed; group.totalCount += total;
    // An identifiable category can have a stored fixed flag AND a link warning.
    // Only unidentifiable categories suppress the confirmation classification.
    const unidentified = name === '품종 미지정';
    group.unknownCount += unidentified ? total : 0;
    group.warningCount += unidentified ? Math.max(warning,total) : warning;
    group.orderWeeks = [...new Set([...group.orderWeeks,String(row.OrderWeek)])].sort();
    groups.set(name,group);
  }
  const categories = [...groups.values()].filter(group=>group.totalCount>0).sort((a,b)=>a.countryFlower.localeCompare(b.countryFlower,'ko'))
    .map(group=>({...group,state:stateOf(group.fixedCount,group.totalCount,group.unknownCount)}));
  const totalCount = categories.reduce((sum,group)=>sum+group.totalCount,0);
  const fixedCount = categories.reduce((sum,group)=>sum+group.fixedCount,0);
  const unknownCount = categories.reduce((sum,group)=>sum+group.unknownCount,0);
  const warningCount = categories.reduce((sum,group)=>sum+group.warningCount,0);
  return {...scope,totalCount,fixedCount,unknownCount,warningCount,state:stateOf(fixedCount,totalCount,unknownCount),categories};
}

export function validateWeekdayConfirmationResponse(input, result) {
  const scope = normalizeWeekdayConfirmationScope(input), summary = result?.summary;
  if (result?.success !== true || result.readOnly !== true || summary?.year !== scope.year
    || summary?.majorWeek !== scope.majorWeek || summary?.allCustomers !== true || !Array.isArray(summary.categories))
    throw new Error('확정 현황 응답의 연도·메인차수·전체 거래처 범위가 다릅니다.');
  const aggregate = {totalCount:0,fixedCount:0,unknownCount:0,warningCount:0};
  const names = new Set();
  for (const category of summary.categories) {
    if (!category.countryFlower || names.has(category.countryFlower)
      || !Array.isArray(category.orderWeeks) || !category.orderWeeks.length
      || category.orderWeeks.some(week=>!/^\d{2}-\d{2}$/.test(week) || week.slice(0,2)!==scope.majorWeek)
      || ![category.totalCount,category.fixedCount,category.unknownCount,category.warningCount].every(value=>Number.isSafeInteger(value)&&value>=0)
      || category.totalCount<=0 || category.fixedCount>category.totalCount || category.unknownCount>category.totalCount
      || category.warningCount>category.totalCount || category.unknownCount>category.warningCount
      || (category.countryFlower==='품종 미지정' ? category.unknownCount!==category.totalCount : category.unknownCount!==0)
      || category.state!==stateOf(category.fixedCount,category.totalCount,category.unknownCount)) throw new Error('품종별 확정 현황을 확인할 수 없습니다.');
    names.add(category.countryFlower);
    for(const key of Object.keys(aggregate)) aggregate[key]+=category[key];
  }
  if (Object.keys(aggregate).some(key=>aggregate[key]!==summary[key])
    || summary.state!==stateOf(aggregate.fixedCount,aggregate.totalCount,aggregate.unknownCount)) throw new Error('메인차수 확정 합계를 확인할 수 없습니다.');
  return summary;
}
