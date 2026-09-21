// Web-only, read-only arrival-cost reference for hotel P&L detail.
// Scope: exact OrderYear + ProdKey. Prefer the requested major week and otherwise
// use only the latest earlier major week in that same year.
import { query, sql } from './db.js';
import { convertArrivalUnitCost } from './catalogUnitMatch.js';

export const RAUM_PNL_ARRIVAL_REFERENCE_SQL = `
SELECT l.OrderWeek, l.ProdKey, l.Unit AS ArrivalUnit, l.SelectedArrivalCostKRW,
       l.ExchangeRate, l.CustomsPerUnitKRW, l.OtherPerUnitKRW,
       l.SourceFileName, l.SheetName, l.SourceRow, l.FarmNameRaw,
       p.ProdName, p.OutUnit, p.EstUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch
  FROM dbo.WebArrivalCostLine AS l
  JOIN dbo.Product AS p ON p.ProdKey=l.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE l.OrderYear=@yr
   AND TRY_CONVERT(INT, LEFT(l.OrderWeek, CHARINDEX(N'-', l.OrderWeek + N'-') - 1))<=@major
   AND ISNULL(l.IsCurrent,0)=1
   AND l.ProdKey IN (__PROD_KEYS__)
   AND ISNULL(l.SelectedArrivalCostKRW,0)>0
 ORDER BY TRY_CONVERT(INT, PARSENAME(REPLACE(l.OrderWeek,N'-',N'.'),1)), l.OrderWeek, l.ArrivalLineKey`;

const positiveInt = value => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const weekMajor = value => positiveInt(String(value ?? '').trim().split('-')[0]);
const canonicalUnit = value => /^(대|st|stem|stems|스팀)$/i.test(String(value).trim()) ? '송이' : String(value).trim();

export function buildRaumPnlArrivalReferences(items = [], rows = [], requestedMajor) {
  const targetMajor = positiveInt(requestedMajor);
  if (!targetMajor) return {};
  const wanted = new Map();
  for (const item of items) {
    const prodKey = positiveInt(item?.prodKey ?? item?.ProdKey);
    if (!prodKey) continue;
    const unit = String(item?.unit ?? item?.Unit ?? '').trim();
    const itemKey = positiveInt(item?.itemKey ?? item?.ItemKey);
    if (itemKey) wanted.set(itemKey, { prodKey, unit });
  }
  const byProd = new Map();
  for (const row of rows) {
    const prodKey = positiveInt(row?.ProdKey ?? row?.prodKey);
    const rawCost = Number(row?.SelectedArrivalCostKRW ?? row?.selectedArrivalCostKRW);
    if (!prodKey || !(rawCost > 0)) continue;
    if (!byProd.has(prodKey)) byProd.set(prodKey, []);
    byProd.get(prodKey).push(row);
  }
  const result = {};
  for (const [itemKey, target] of wanted) {
    const eligibleRows = (byProd.get(target.prodKey) || []).filter(row => {
      const major = weekMajor(row?.OrderWeek ?? row?.orderWeek);
      return major && major <= targetMajor;
    });
    const exactRows = eligibleRows.filter(row => weekMajor(row?.OrderWeek ?? row?.orderWeek) === targetMajor);
    const selectedMajor = exactRows.length
      ? targetMajor
      : eligibleRows.reduce((latest, row) => Math.max(latest, weekMajor(row?.OrderWeek ?? row?.orderWeek) || 0), 0);
    const selectedRows = selectedMajor
      ? eligibleRows.filter(row => weekMajor(row?.OrderWeek ?? row?.orderWeek) === selectedMajor)
      : [];
    const perWeek = new Map();
    for (const row of selectedRows) {
      const week = String(row?.OrderWeek ?? row?.orderWeek ?? '').trim();
      const rawUnit = String(row?.ArrivalUnit ?? row?.arrivalUnit ?? '').trim();
      const rawCost = Number(row?.SelectedArrivalCostKRW ?? row?.selectedArrivalCostKRW);
      const product = row;
      const converted = target.unit
        ? (rawUnit ? convertArrivalUnitCost(rawCost, canonicalUnit(rawUnit), canonicalUnit(target.unit), product) : null)
        : rawCost;
      if (!week) continue;
      const candidate = {
        week,
        cost: converted,
        unit: target.unit || rawUnit || '',
        rawCost,
        rawUnit,
        isFallback: selectedMajor < targetMajor,
        requestedMajor: targetMajor,
        sourceMajor: selectedMajor,
        conversionError: !(converted > 0) ? `단위 환산 확인 필요: ${rawUnit || '원본 단위 없음'} → ${target.unit}` : '',
        exchangeRate: Number(row.ExchangeRate) || null,
        customsPerUnitKRW: row.CustomsPerUnitKRW == null ? null : Number(row.CustomsPerUnitKRW),
        otherPerUnitKRW: row.OtherPerUnitKRW == null ? null : Number(row.OtherPerUnitKRW),
        sourceFile: String(row.SourceFileName || ''),
        sourceSheet: String(row.SheetName || ''),
        sourceRow: row.SourceRow || null,
        farm: String(row.FarmNameRaw || ''),
      };
      const previous = perWeek.get(week);
      if (!previous || candidate.cost > previous.cost) perWeek.set(week, candidate);
    }
    result[itemKey] = [...perWeek.values()].sort((a, b) => {
      const sub = value => Number(String(value.week).split('-')[1]) || 0;
      return sub(a) - sub(b) || a.week.localeCompare(b.week);
    });
  }
  return result;
}

async function loadReferenceRows({ orderYear, major, items }, tQuery = query) {
  const year = String(orderYear ?? '').trim();
  const majorNumber = positiveInt(major);
  if (!/^\d{4}$/.test(year) || !majorNumber) return [];
  const prodKeys = [...new Set((items || []).map(item => positiveInt(item?.prodKey ?? item?.ProdKey)).filter(Boolean))];
  if (!prodKeys.length) return [];
  const params = {
    yr: { type: sql.NVarChar, value: year },
    major: { type: sql.Int, value: majorNumber },
  };
  const placeholders = prodKeys.map((prodKey, index) => {
    params[`pk${index}`] = { type: sql.Int, value: prodKey };
    return `@pk${index}`;
  });
  const response = await tQuery(RAUM_PNL_ARRIVAL_REFERENCE_SQL.replace('__PROD_KEYS__', placeholders.join(',')), params);
  return response.recordset || [];
}

export async function loadRaumPnlArrivalReferences(scope, tQuery = query) {
  return buildRaumPnlArrivalReferences(scope.items, await loadReferenceRows(scope, tQuery), scope.major);
}

export async function withHotelArrivalReferences(rows, orderYear, tQuery = query) {
  if (!rows.length) return rows;
  try {
    const major = Math.max(...rows.map(row => Number(row.major) || 0));
    const sources = [];
    const products = [...new Set(rows.map(row => positiveInt(row.prodKey)).filter(Boolean))];
    for (let index = 0; index < products.length; index += 500) {
      sources.push(...await loadReferenceRows({ orderYear, major, items: products.slice(index, index + 500).map(prodKey => ({ prodKey })) }, tQuery));
    }
    const byMajor = new Map();
    for (const row of rows) {
      if (!byMajor.has(row.major)) byMajor.set(row.major, []);
      byMajor.get(row.major).push(row);
    }
    const refs = {};
    for (const [target, items] of byMajor) Object.assign(refs, buildRaumPnlArrivalReferences(items, sources, target));
    return rows.map(row => ({ ...row, arrivalReferences: refs[row.itemKey] || [] }));
  } catch {
    return rows.map(row => ({ ...row, arrivalReferenceError: '도착원가 조회 실패 — 새로고침 후 다시 확인하세요.' }));
  }
}
