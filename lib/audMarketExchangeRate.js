const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validExchangeDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function selectAudMarketRate(chart, requestedDate) {
  if (!validExchangeDate(requestedDate)) throw new Error('환율 조회 날짜가 올바르지 않습니다.');
  const result = chart?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) {
    throw new Error('AUD/KRW 시장 환율 자료를 받지 못했습니다.');
  }
  const candidates = timestamps.map((stamp, index) => ({
    date: new Date(Number(stamp) * 1000).toISOString().slice(0, 10),
    rate: Number(closes[index]),
  })).filter(row => row.date <= requestedDate && Number.isFinite(row.rate) && row.rate >= 500 && row.rate <= 2000)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!candidates.length) throw new Error('기준일 이전 AUD/KRW 시장 환율을 찾지 못했습니다.');
  const selected = candidates[0];
  return {
    currency: 'AUD',
    rate: selected.rate,
    requestedDate,
    rateDate: selected.date,
    carriedForward: selected.date !== requestedDate,
    source: 'Yahoo Finance AUD/KRW 일일 시세',
    sourceUrl: 'https://finance.yahoo.com/quote/AUDKRW=X/history/',
  };
}

export async function fetchAudMarketRate(requestedDate, fetchImpl = fetch) {
  if (!validExchangeDate(requestedDate)) throw new Error('환율 조회 날짜가 올바르지 않습니다.');
  const target = new Date(`${requestedDate}T00:00:00.000Z`);
  const start = new Date(target.getTime() - 10 * 86400000);
  const end = new Date(target.getTime() + 86400000);
  const params = new URLSearchParams({
    period1: String(Math.floor(start.getTime() / 1000)),
    period2: String(Math.floor(end.getTime() / 1000)),
    interval: '1d',
    events: 'history',
  });
  const response = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/AUDKRW%3DX?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`AUD/KRW 시장 환율 조회에 실패했습니다 (HTTP ${response.status}).`);
  const payload = await response.json();
  if (payload?.chart?.error) throw new Error('AUD/KRW 시장 환율 제공처에서 오류를 반환했습니다.');
  return selectAudMarketRate(payload, requestedDate);
}
