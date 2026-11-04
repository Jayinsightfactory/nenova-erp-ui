import { normalizeParentWeek, normalizeYear } from './salesDefectDeductionCore.js';

export function defectCostScope(year, week) {
  const y = normalizeYear(year), w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('단가 조회 연도·차수를 확인하세요.');
  return { year: y, minWeek: Math.max(1, w - 5), maxWeek: w - 1 };
}

// Shared by automatic choice and visible references. Never change product identity here.
export function defectRecentCostSql(limit = 1) {
  if (![1, 5].includes(limit)) throw new Error('Invalid cost candidate limit');
  return `SELECT TOP ${limit}
            COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) AS Cost,
            CASE WHEN NULLIF(sdd.Cost,0) IS NOT NULL THEN N'ShipmentDate.Cost'
                 WHEN NULLIF(sd.Cost,0) IS NOT NULL THEN N'ShipmentDetail.Cost'
                 ELSE N'' END AS CostSource,
            sm.OrderYear AS SourceOrderYear,
            sm.OrderWeek AS SourceOrderWeek, sm.ShipmentKey AS SourceShipmentKey, sm.CustKey AS SourceCustKey,
            c.CustName AS SourceCustName, sd.SdetailKey, ISNULL(sdd.SdateKey,0) AS SdateKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=@pk
       LEFT JOIN Customer c ON c.CustKey=sm.CustKey
       LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
      WHERE ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sd.OutQuantity,0)>0
        AND sm.OrderYear=@scopeYear
        AND TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1)) BETWEEN @minWeek AND @scopeWeek
        AND COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) > 0
      ORDER BY
        CASE WHEN sm.CustKey=@ck THEN 0 ELSE 1 END,
        sm.OrderYear DESC,
        TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1)) DESC,
        CASE WHEN NULLIF(sdd.Cost,0) IS NULL THEN 1 ELSE 0 END,
        ISNULL(sdd.SdateKey,0) DESC, sd.SdetailKey DESC`;
}

export function costLookupKeyword(name) {
  const value = String(name || '').trim();
  const korean = value.match(/(?:\/\s*)?([가-힣]+)\s*\(/);
  if (korean) return korean[1];
  return value.replace(/^(?:SPRAY\s+)?ROSE(?:\s+CHINA)?\s*\/\s*/i, '').replace(/\s+\d+(?:-\d+)?\s*cm.*$/i, '').trim();
}

export function costProductMatchesSearch(product, keyword) {
  const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const tokens = String(keyword || '').trim().split(/\s+/).map(normalized).filter(Boolean);
  const names = normalized([product.ProdName, product.DisplayName, product.SuggestedDisplayName].filter(Boolean).join(' '));
  return tokens.length > 0 && tokens.every(token => names.includes(token));
}
