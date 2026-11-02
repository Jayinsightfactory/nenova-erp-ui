const CURRENCIES = new Set(['USD','EUR','CNY','AUD','NZD','THB']);
// Quote-time pricing is separate from historical approved cost snapshots.
export function liveInvoiceRate(chart, currency, now = new Date()) {
  if (!CURRENCIES.has(currency)) throw new Error('지원하지 않는 원가 통화입니다.');
  const quote = chart?.chart?.result?.[0]?.meta;
  const raw = quote?.regularMarketPrice, timestamp = quote?.regularMarketTime;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || !Number.isFinite(timestamp)) throw new Error('현재 환율 시세가 없습니다.');
  const quoteAt = new Date(timestamp * 1000);
  if (!Number.isFinite(quoteAt.getTime()) || quoteAt > new Date(now.getTime()+300000) || now-quoteAt > 7*86400000) throw new Error('환율 시세가 오래되었거나 시각이 올바르지 않습니다.');
  return {currency, marketRate:raw, adjustmentKRW:15, rate:Math.round((raw+15)*1e6)/1e6,
    quoteAt:quoteAt.toISOString(), requestedAt:now.toISOString(), rateType:'LIVE_MARKET_PLUS_15',
    source:'Yahoo Finance 시장 시세', sourceUrl:`https://finance.yahoo.com/quote/${currency}KRW=X/`};
}
export async function fetchLiveInvoiceRate(currency, fetchImpl=fetch, now=new Date()) {
  if (!CURRENCIES.has(currency)) throw new Error('지원하지 않는 원가 통화입니다.');
  const response=await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${currency}KRW%3DX?interval=1d&range=5d`,{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error(`현재 환율 조회 실패 (HTTP ${response.status})`);
  return liveInvoiceRate(await response.json(),currency,now);
}
