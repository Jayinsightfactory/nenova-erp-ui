import { COUNTRY_CURRENCY_MAP } from './countryClassification.js';

export const PIVOT_FX_CURRENCIES = ['USD', 'EUR', 'CNY', 'JPY', 'AUD'];
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const near = (a, b, tolerance = .01) => Math.abs(a - b) <= tolerance;

// Only validated source components cross the API boundary, never the raw workbook.
export function pivotArrivalFxBasis(row, convert) {
  const currency = COUNTRY_CURRENCY_MAP[String(row.CountryName || '').trim()] || null;
  const failed = reason => ({ currency, reason });
  if (!PIVOT_FX_CURRENCIES.includes(currency)) return failed('통화 근거 없음');
  if (row.AllocationBasis !== 'SOURCE') return failed('원본 외 배분 원가는 재계산 불가');
  let raw;
  try { raw = typeof row.RawJson === 'string' ? JSON.parse(row.RawJson) : row.RawJson; } catch { return failed('원본 비용 정보 없음'); }
  const rawCurrency = COUNTRY_CURRENCY_MAP[String(raw?.meta?.country || '').trim()];
  if (rawCurrency && rawCurrency !== currency) return failed('원본 국가·통화 불일치');
  const cells = Object.entries(raw?.cells || {}).map(([key, value]) => [key.replace(/\s/g, ''), number(value)]);
  const get = pattern => {
    const values = cells.filter(([key, value]) => pattern.test(key) && value != null).map(([,value]) => value);
    return values.length && values.every(value => near(value, values[0])) ? values[0] : null;
  };
  const fx = number(raw?.meta?.exchangeRate), storedFx = number(row.ExchangeRate);
  if (!(fx > 0) || storedFx == null || !near(fx, storedFx, .00001)) return failed('원본 환율 불일치 또는 누락');
  let foreign = get(/^CNF\(송이\)$/i), krw = get(/^CNF\(원화\)$/i), sourceCost = get(/^도착원가\(송이\)$/);
  let sourceUnit = '송이';
  if (foreign == null || krw == null || sourceCost == null) {
    // Chinese template: CNF(단) is KRW, FOB and 운송비(단) are foreign.
    const fob = get(/^FOB$/i), freight = get(/^운송비\(단\)$/);
    foreign = fob != null && freight != null ? fob + freight : null;
    krw = get(/^CNF\(단\)$/i); sourceCost = get(/^도착원가\(단\)$/); sourceUnit = '단';
  }
  if (foreign == null || krw == null || sourceCost == null || foreign < 0 || krw < 0 || sourceCost < krw || !near(foreign * fx, krw)) return failed('외화·원화 비용 대조 불가');
  const selected = number(row.SelectedArrivalCostKRW);
  // Convert raw source components to the ledger's unit first, then to Product.OutUnit.
  const count = get(/^단당(?:수량|송이수)$/);
  const ledgerUnit = String(row.ArrivalUnit || '').trim();
  const explicit = ledgerUnit.match(/^단\s*[-(]\s*([1-9]\d*)\s*(?:스팀|송이|대|stems?|st)\s*\)?$/i);
  let factor = 1;
  if (sourceUnit === '송이' && (ledgerUnit === '단' || explicit)) factor = explicit ? Number(explicit[1]) : count;
  else if (sourceUnit !== ledgerUnit && !(sourceUnit === '송이' && /^(대|st|stems?|스팀)$/i.test(ledgerUnit))) return failed('원본 비용 단위 불명');
  if (!(factor > 0) || selected == null || !near(sourceCost * factor, selected, .51)) return failed('원본 원가와 선택 원가 불일치');
  const multiplier = convert({ ...row, SelectedArrivalCostKRW: 1 });
  if (!(multiplier > 0)) return failed('출고단위 환산 불가');
  const foreignPerUnit = foreign * factor * multiplier;
  // Preserve explicit KRW costs and original ledger rounding, not a guessed foreign residual.
  const fixedKRW = ((sourceCost - krw) * factor + selected - sourceCost * factor) * multiplier;
  return { currency, originalRate: fx, foreignPerUnit, fixedKRW, reason: '' };
}

export function normalizePivotFxRates(draft = {}) {
  const result = {};
  for (const [currency, value] of Object.entries(draft)) {
    if (value == null || String(value).trim() === '') continue;
    if (!PIVOT_FX_CURRENCIES.includes(currency) || typeof value === 'boolean' || !(Number(value) > 0) || !Number.isFinite(Number(value))) throw new Error(`${currency} 환율은 0보다 큰 숫자로 입력하세요.`);
    result[currency] = Number(value);
  }
  return result;
}

export function applyPivotArrivalFx(rows, rates) {
  const active = Object.keys(rates).length > 0;
  if (!active) return rows;
  return rows.map(row => {
    if (row.ArrivalCost == null) return row;
    const sources = row.ArrivalFxSources || [];
    const affected = sources.some(source => !source.currency || Object.hasOwn(rates, source.currency));
    if (!sources.length || !affected) return { ...row, ArrivalFxStatus: sources.length ? '원본 환율' : '재계산 불가: 비용 근거 없음' , ...(!sources.length ? {ArrivalCost:null} : {}) };
    const costs = sources.map(source => {
      if (source.currency && !Object.hasOwn(rates, source.currency)) return source.originalCost;
      if (source.reason || !source.currency) return null;
      const cost = source.foreignPerUnit * rates[source.currency] + source.fixedKRW;
      return Number.isFinite(cost) && cost >= 0 ? cost : null;
    });
    const failed = costs.some(cost => cost == null);
    return { ...row, ArrivalCost: failed ? null : Math.max(...costs), ArrivalFxStatus: failed ? `재계산 불가: ${sources.find(source=>source.reason)?.reason || '비용 근거 없음'}` : '지정 환율 적용' };
  });
}
