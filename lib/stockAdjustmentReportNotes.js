// Weekly profit note policy. No DB connection or report calculation dependency.
export const STOCK_ADJUSTMENT_NOTES_SQL = `
SELECT sh.StockHistoryKey AS historyKey, sh.OrderYear AS orderYear,
       sh.OrderWeek AS orderWeek, sh.ProdKey AS prodKey,
       sh.BeforeValue AS beforeValue, sh.AfterValue AS afterValue,
       sh.ChangeType AS changeType, sh.Descr AS reason,
       CONVERT(nvarchar(23), sh.ChangeDtm, 121) AS changedAt,
       p.ProdName AS productName, p.DisplayName AS displayName,
       p.CounName AS country, p.FlowerName AS flower, p.OutUnit AS unit
FROM StockHistory sh
LEFT JOIN Product p ON p.ProdKey = sh.ProdKey
WHERE sh.OrderYear = @year
  AND (sh.OrderWeek = @major OR sh.OrderWeek LIKE @prefix)
  AND EXISTS (
    SELECT 1 FROM CodeInfo ci
    WHERE ci.Category = N'StockType' AND ci.Descr = sh.ChangeType
  )
ORDER BY sh.OrderWeek, sh.ProdKey, sh.StockHistoryKey`;

export function parseStockAdjustmentScope(year, week) {
  if (typeof year !== 'string' || !/^\d{4}$/.test(year) || Number(year) === 0) return null;
  if (typeof week !== 'string') return null;
  const match = week.trim().match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!match) return null;
  const majorNum = Number(match[1]);
  const subNum = match[2] == null ? null : Number(match[2]);
  if (majorNum < 1 || majorNum > 53 || (subNum != null && (subNum < 1 || subNum > 99))) return null;
  const major = String(majorNum).padStart(2, '0');
  return { orderYear: year, major, prefix: `${major}-%` };
}

function scopedWeek(rawWeek, major) {
  if (typeof rawWeek !== 'string') return false;
  const match = rawWeek.trim().match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  return Boolean(match && Number(match[1]) === Number(major) &&
    (match[2] == null || (Number(match[2]) >= 1 && Number(match[2]) <= 99)));
}

function quantity(raw) {
  if (raw == null || String(raw).trim() === '' || typeof raw === 'boolean') return null;
  const value = String(raw).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOr(raw, fallback) {
  const value = raw == null ? '' : String(raw).trim();
  return value || fallback;
}

export function buildStockAdjustmentNotes(rawRows, scope) {
  if (!scope?.orderYear || !scope?.major) throw new Error('유효한 연도와 차수가 필요합니다.');
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const groups = new Map();
  const events = [];
  for (const row of rows) {
    if (String(row?.orderYear ?? '') !== scope.orderYear || !scopedWeek(row?.orderWeek, scope.major)) continue;
    const before = quantity(row.beforeValue);
    const after = quantity(row.afterValue);
    const delta = before == null || after == null ? null : after - before;
    const prodKey = row.prodKey == null ? null : String(row.prodKey);
    const unit = textOr(row.unit, '단위 미확인');
    const productName = textOr(row.displayName, textOr(row.productName, prodKey == null ? '품목번호 미확인' : `품목번호 ${prodKey} · 품목정보 미확인`));
    const reason = textOr(row.reason, '사유 미기재');
    const changeType = textOr(row.changeType, '유형 미확인');
    const event = {
      historyKey: row.historyKey == null ? null : String(row.historyKey),
      orderWeek: String(row.orderWeek).trim(), prodKey, productName,
      country: textOr(row.country, '국가 미확인'), flower: textOr(row.flower, '품종 미확인'),
      unit, before, after, delta, changeType, reason,
      changedAt: row.changedAt == null ? null : String(row.changedAt),
    };
    events.push(event);
    const key = JSON.stringify([prodKey ?? `missing:${event.historyKey ?? events.length}`, unit]);
    if (!groups.has(key)) groups.set(key, {
      groupKey: key, prodKey, productName, country: event.country, flower: event.flower, unit,
      count: 0, increase: 0, decrease: 0, invalidCount: 0, zeroCount: 0,
      reasons: [], changeTypes: [], weeks: [],
    });
    const group = groups.get(key);
    group.count += 1;
    if (delta == null) group.invalidCount += 1;
    else if (delta > 0) group.increase += delta;
    else if (delta < 0) group.decrease += delta;
    else group.zeroCount += 1;
    if (!group.reasons.includes(reason)) group.reasons.push(reason);
    if (!group.changeTypes.includes(changeType)) group.changeTypes.push(changeType);
    if (!group.weeks.includes(event.orderWeek)) group.weeks.push(event.orderWeek);
  }
  const items = [...groups.values()].map((group) => {
    const sum = group.increase + group.decrease;
    return { ...group, net: group.invalidCount ? null : Math.abs(sum) < 1e-9 ? 0 : sum };
  });
  return { orderYear: scope.orderYear, major: scope.major, count: events.length, items, events };
}
