export function incomingRoundLabel(value) {
  const raw = String(value ?? '');
  const suffix = /^(\d{2}-\d{2})\.?([ab])$/i.exec(raw);
  return suffix ? `${suffix[1]}.${suffix[2].toUpperCase()}` : raw;
}

export function normalizeRoundSearch(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\s/gu, '').replace(/\p{Dash_Punctuation}/gu, '-').replace(/차$/u, '')
    .replace(/^(\d{2}-\d{2})\.([ab])$/, '$1$2');
}

export function matchesRound(value, query) {
  const round = normalizeRoundSearch(value);
  if (!query.includes('-')) return round.split('-', 1)[0] === query;
  return round === query || query.endsWith('-') && round.startsWith(query)
    || /^\d{2}-\d{2}$/.test(query) && round.slice(0,-1)===query && /[ab]$/.test(round);
}

export function splitIncomingRound(value) {
  const match = /^(\d{2}-\d{2})(?:\.?([AB]))?$/i.exec(String(value ?? '').trim());
  return match ? {orderWeek:match[1],suffix:match[2]?.toUpperCase()??''} : null;
}

export function receiptRoundLabel(row) {
  return row.RoundSuffix ? incomingRoundLabel(row.OrderWeek+row.RoundSuffix) : incomingRoundLabel(row.OrderWeek);
}
