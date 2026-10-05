// Web-only, read-only arrival-cost reference for hotel P&L detail.
// Scope: exact OrderYear + ProdKey. Show requested-major references plus the
// hotel's next-major first subweek. Only if both are absent use latest prior.
import { query, sql } from './db.js';
import { convertArrivalUnitCost } from './catalogUnitMatch.js';
import { pnlPeriodBaseMajor } from './raumPnlPeriod.js';

export const RAUM_PNL_ARRIVAL_REFERENCE_SQL = `
SELECT l.ArrivalLineKey, l.OrderYear, l.OrderWeek, l.ProdKey, l.Unit AS ArrivalUnit, l.SelectedArrivalCostKRW,
       l.ExchangeRate, l.CustomsPerUnitKRW, l.OtherPerUnitKRW,
       l.SourceFileName, l.SheetName, l.SourceRow, l.FarmNameRaw,
       sourceUnit.SourceStemsPerBunch,
       l.AllocationBasis,
       TRY_CONVERT(float,JSON_VALUE(CASE WHEN ISJSON(l.RawJson)=1 THEN l.RawJson ELSE N'{}' END, N'$.cells."도착원가(송이)"')) AS SourceCostPerStem,
       p.ProdName, p.OutUnit, p.EstUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch
  FROM dbo.WebArrivalCostLine AS l
  JOIN dbo.Product AS p ON p.ProdKey=l.ProdKey AND ISNULL(p.isDeleted,0)=0
  OUTER APPLY (
    SELECT MIN(TRY_CONVERT(float,j.[value])) AS SourceStemsPerBunch
      FROM OPENJSON(CASE WHEN ISJSON(l.RawJson)=1 THEN l.RawJson ELSE N'{}' END, '$.cells') AS j
     WHERE REPLACE(REPLACE(REPLACE(j.[key],N' ',N''),CHAR(13),N''),CHAR(10),N'') IN (N'단당수량',N'단당송이수')
       AND TRY_CONVERT(float,j.[value])>0
    HAVING MIN(TRY_CONVERT(float,j.[value]))=MAX(TRY_CONVERT(float,j.[value]))
  ) AS sourceUnit
 WHERE l.OrderYear=@yr
   AND (TRY_CONVERT(INT, LEFT(l.OrderWeek, CHARINDEX(N'-', l.OrderWeek + N'-') - 1))<=@major
     OR (TRY_CONVERT(INT, LEFT(l.OrderWeek, CHARINDEX(N'-', l.OrderWeek + N'-') - 1))=@major+1
       AND CHARINDEX(N'-',l.OrderWeek)>0
       AND TRY_CONVERT(INT,SUBSTRING(l.OrderWeek,CHARINDEX(N'-',l.OrderWeek)+1,20))=1))
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

function explicitBundleStems(unit) {
  const match = String(unit || '').trim().match(/^단\s*[-(]\s*([1-9]\d*)\s*(?:스팀|송이|대|stems?|st)\s*\)?$/i);
  return match ? Number(match[1]) : null;
}

function referenceCost(rawCost, rawUnit, targetUnit, sourceCount, product) {
  const targetCount = explicitBundleStems(targetUnit);
  const sourceExplicit = explicitBundleStems(rawUnit);
  const count = sourceExplicit || (canonicalUnit(rawUnit) === '단' && sourceCount > 0 ? sourceCount : null);
  const stemCost = count ? rawCost / count : null;
  if (targetCount) {
    const stem = stemCost ?? convertArrivalUnitCost(rawCost, canonicalUnit(rawUnit), '송이', product);
    return stem > 0 ? stem * targetCount : null;
  }
  if (!targetUnit) return rawCost;
  if (!rawUnit) return null;
  if (stemCost != null && canonicalUnit(targetUnit) !== '단') {
    return convertArrivalUnitCost(stemCost, '송이', canonicalUnit(targetUnit), product);
  }
  return convertArrivalUnitCost(rawCost, canonicalUnit(rawUnit), canonicalUnit(targetUnit), product);
}

export function buildRaumPnlArrivalReferences(items = [], rows = [], requestedMajor, orderYear = null) {
  let targetMajor;
  try { targetMajor = positiveInt(pnlPeriodBaseMajor(requestedMajor)); } catch { return {}; }
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
    // SQL always returns the requested year; also protect callers with mixed rows.
    const sourceYear = row?.OrderYear ?? row?.orderYear;
    if (orderYear != null && sourceYear != null && String(sourceYear) !== String(orderYear)) continue;
    const prodKey = positiveInt(row?.ProdKey ?? row?.prodKey);
    const rawCost = Number(row?.SelectedArrivalCostKRW ?? row?.selectedArrivalCostKRW);
    if (!prodKey || !(rawCost > 0)) continue;
    if (!byProd.has(prodKey)) byProd.set(prodKey, []);
    byProd.get(prodKey).push(row);
  }
  const result = {};
  for (const [itemKey, target] of wanted) {
    const productRows = byProd.get(target.prodKey) || [];
    const eligibleRows = productRows.filter(row => {
      const major = weekMajor(row?.OrderWeek ?? row?.orderWeek);
      return major && major <= targetMajor;
    });
    const exactRows = eligibleRows.filter(row => weekMajor(row?.OrderWeek ?? row?.orderWeek) === targetMajor);
    const nextFirstRows = productRows.filter(row => {
      const parts = String(row?.OrderWeek ?? row?.orderWeek ?? '').trim().match(/^(\d+)-(\d+)$/);
      return parts && Number(parts[1]) === targetMajor + 1 && Number(parts[2]) === 1;
    });
    const previousMajor = eligibleRows.reduce((latest, row) => Math.max(latest, weekMajor(row?.OrderWeek ?? row?.orderWeek) || 0), 0);
    const selectedRows = exactRows.length || nextFirstRows.length
      ? [...exactRows, ...nextFirstRows]
      : eligibleRows.filter(row => weekMajor(row?.OrderWeek ?? row?.orderWeek) === previousMajor);
    const distinctSources = new Map();
    for (const row of selectedRows) {
      const sourceWeek = String(row?.OrderWeek ?? row?.orderWeek ?? '').trim();
      const parts = sourceWeek.match(/^(\d+)-(\d+)$/);
      const week = parts ? `${Number(parts[1])}-${Number(parts[2])}` : sourceWeek;
      const rawUnit = String(row?.ArrivalUnit ?? row?.arrivalUnit ?? '').trim();
      const rawCost = Number(row?.SelectedArrivalCostKRW ?? row?.selectedArrivalCostKRW);
      const product = row;
      const sourceCount = Number(row.SourceStemsPerBunch);
      // SOURCE imports carry customs/other from the per-stem workbook columns.
      // Only scale these when the original per-stem and per-bunch values reconcile.
      const originalStem = Number(row.SourceCostPerStem);
      const fxExpenseFactor = row.AllocationBasis && row.AllocationBasis !== 'SOURCE' ? 1
        : canonicalUnit(rawUnit) === '송이' ? 1
          : canonicalUnit(rawUnit) === '단' && sourceCount > 0 && originalStem > 0 && Math.abs(originalStem * sourceCount - rawCost) <= Math.max(1, sourceCount)
            ? sourceCount : null;
      const converted = referenceCost(rawCost, rawUnit, target.unit, sourceCount, product);
      if (!week) continue;
      const candidate = {
        arrivalLineKey: positiveInt(row.ArrivalLineKey),
        week,
        sourceWeek,
        cost: converted,
        unit: target.unit || rawUnit || '',
        rawCost,
        rawUnit,
        isFallback: weekMajor(sourceWeek) < targetMajor,
        isNextHotelWeek: weekMajor(sourceWeek) === targetMajor + 1,
        requestedMajor: targetMajor,
        sourceMajor: weekMajor(sourceWeek),
        conversionError: !(converted > 0) ? `단위 환산 확인 필요: ${rawUnit || '원본 단위 없음'} → ${target.unit}` : '',
        exchangeRate: Number(row.ExchangeRate) || null,
        customsPerUnitKRW: row.CustomsPerUnitKRW == null ? null : Number(row.CustomsPerUnitKRW),
        otherPerUnitKRW: row.OtherPerUnitKRW == null ? null : Number(row.OtherPerUnitKRW),
        sourceFile: String(row.SourceFileName || ''),
        sourceSheet: String(row.SheetName || ''),
        sourceRow: row.SourceRow || null,
        farm: String(row.FarmNameRaw || ''),
        sourceStemsPerBunch: sourceCount > 0 ? sourceCount : null,
        fxExpenseFactor,
      };
      // We cannot identify which farm supplied the hotel. Preserve every source
      // price, including different sheets for the same farm; never choose a max.
      const hasSourceLocation = !!(candidate.sourceFile || candidate.sourceSheet || candidate.sourceRow);
      const sourceIdentity = JSON.stringify([
        String(row.OrderYear ?? orderYear ?? ''), target.prodKey, week, candidate.farm,
        candidate.sourceFile, candidate.sourceSheet, candidate.sourceRow,
        rawUnit, rawCost, candidate.exchangeRate, candidate.customsPerUnitKRW,
        candidate.otherPerUnitKRW, candidate.sourceStemsPerBunch, candidate.fxExpenseFactor,
        // Without provenance, separate DB lines cannot be assumed duplicates.
        hasSourceLocation ? null : candidate.arrivalLineKey,
      ]);
      candidate.referenceKey = candidate.arrivalLineKey
        ? `arrival:${candidate.arrivalLineKey}` : `source:${sourceIdentity}`;
      const previous = distinctSources.get(sourceIdentity);
      // Padded/unpadded representations of the same source count once. Prefer a
      // real and stable DB key (lowest if duplicate copies have different keys).
      if (!previous || (candidate.arrivalLineKey && (!previous.arrivalLineKey || candidate.arrivalLineKey < previous.arrivalLineKey))) {
        distinctSources.set(sourceIdentity, candidate);
      }
    }
    result[itemKey] = [...distinctSources.values()].sort((a, b) => {
      const sub = value => Number(String(value.week).split('-')[1]) || 0;
      return a.sourceMajor - b.sourceMajor || sub(a) - sub(b)
        || a.farm.localeCompare(b.farm, 'ko') || a.sourceFile.localeCompare(b.sourceFile, 'ko')
        || a.sourceSheet.localeCompare(b.sourceSheet, 'ko') || Number(a.sourceRow) - Number(b.sourceRow)
        || a.rawUnit.localeCompare(b.rawUnit, 'ko') || a.rawCost - b.rawCost
        || a.referenceKey.localeCompare(b.referenceKey);
    });
  }
  return result;
}

async function loadReferenceRows({ orderYear, major, items }, tQuery = query) {
  const year = String(orderYear ?? '').trim();
  let majorNumber;
  try { majorNumber = positiveInt(pnlPeriodBaseMajor(major)); } catch { return []; }
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
  return buildRaumPnlArrivalReferences(scope.items, await loadReferenceRows(scope, tQuery), scope.major, scope.orderYear);
}

export async function withHotelArrivalReferences(rows, orderYear, tQuery = query) {
  if (!rows.length) return rows;
  try {
    const major = Math.max(...rows.map(row => {
      try { return Number(pnlPeriodBaseMajor(row.major)); } catch { return 0; }
    }));
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
    for (const [target, items] of byMajor) Object.assign(refs, buildRaumPnlArrivalReferences(items, sources, target, orderYear));
    return rows.map(row => ({ ...row, arrivalReferences: refs[row.itemKey] || [] }));
  } catch {
    return rows.map(row => ({ ...row, arrivalReferenceError: '도착원가 조회 실패 — 새로고침 후 다시 확인하세요.' }));
  }
}
