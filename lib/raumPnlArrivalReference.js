// Web-only, read-only arrival-cost reference for hotel P&L detail.
// Scope: exact OrderYear + ProdKey. Prefer the requested major week and otherwise
// use only the latest earlier major week in that same year.
import { query, sql } from './db.js';
import { convertArrivalUnitCost } from './catalogUnitMatch.js';

export const RAUM_PNL_ARRIVAL_REFERENCE_SQL = `
SELECT l.OrderWeek, l.ProdKey, l.Unit AS ArrivalUnit, l.SelectedArrivalCostKRW,
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
        ? convertArrivalUnitCost(rawCost, rawUnit || target.unit, target.unit, product)
        : rawCost;
      if (!(converted > 0) || !week) continue;
      const candidate = {
        week,
        cost: converted,
        unit: target.unit || rawUnit || '',
        rawCost,
        rawUnit,
        isFallback: selectedMajor < targetMajor,
        requestedMajor: targetMajor,
        sourceMajor: selectedMajor,
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

export async function loadRaumPnlArrivalReferences({ orderYear, major, items }, tQuery = query) {
  const year = String(orderYear ?? '').trim();
  const majorNumber = positiveInt(major);
  if (!/^\d{4}$/.test(year) || !majorNumber) return {};
  const prodKeys = [...new Set((items || []).map(item => positiveInt(item?.prodKey ?? item?.ProdKey)).filter(Boolean))];
  if (!prodKeys.length) return {};
  const params = {
    yr: { type: sql.NVarChar, value: year },
    major: { type: sql.Int, value: majorNumber },
  };
  const placeholders = prodKeys.map((prodKey, index) => {
    params[`pk${index}`] = { type: sql.Int, value: prodKey };
    return `@pk${index}`;
  });
  const response = await tQuery(RAUM_PNL_ARRIVAL_REFERENCE_SQL.replace('__PROD_KEYS__', placeholders.join(',')), params);
  return buildRaumPnlArrivalReferences(items, response.recordset || [], majorNumber);
}
