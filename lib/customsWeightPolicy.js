// Read-only report input selection. Never persist derived weights over source rows.
const positive = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
export const isHistoricalWeightScope = (year, major) => String(year) === '2026' && Number(major) >= 22 && Number(major) <= 27;

export function weightPairState(row) {
  if (!positive(row?.GW) || !positive(row?.CW)) return 'missing';
  return Number(row.GW) > Number(row.CW) + 0.01 ? 'invalid' : 'valid';
}

export function hasColombiaInbound(boxQty, inbound, recordedWeeks = [], orderWeek) {
  return Object.values(boxQty || {}).some(positive) || positive(inbound?.GW) || positive(inbound?.CW)
    || recordedWeeks.includes(orderWeek);
}

export function resolveColombiaWeight(row, inbound, { preserveSaved = false } = {}) {
  const inboundPresent = positive(inbound?.GW) || positive(inbound?.CW);
  const sourceStates = (inbound?.sources || []).map((source) => weightPairState({ GW: source.awbGw ?? source.gw, CW: source.awbCw ?? source.cw }));
  const inboundState = sourceStates.includes('invalid') ? 'invalid' : sourceStates.includes('missing') ? 'missing' : weightPairState(inbound);
  const savedPresent = positive(row?.GW) || positive(row?.CW);
  const useInbound = (!preserveSaved || !savedPresent) && inboundState === 'valid';
  const selected = useInbound ? inbound : row;
  const state = !preserveSaved && inboundPresent && inboundState !== 'valid' ? inboundState : weightPairState(selected);
  return {
    row: { ...(row || {}), GW: selected?.GW ?? null, CW: selected?.CW ?? null },
    source: useInbound ? 'erp_inbound' : positive(row?.GW) || positive(row?.CW) ? 'manual' : 'missing',
    state,
    basis: state === 'valid' ? (Math.abs(Number(selected.GW) - Number(selected.CW)) < 0.01 ? 'GW' : 'CBM') : null,
    saved: { GW: row?.GW ?? null, CW: row?.CW ?? null },
  };
}

// Saved input may be a stale UI payload. Reject rather than report a successful
// manual weight edit that the authoritative inbound calculation would ignore.
export function assertInboundWeightUnchanged(input, effectiveRow, sources) {
  for (const [field, source] of Object.entries(sources || {})) {
    if (source !== 'erp_inbound' || !Object.prototype.hasOwnProperty.call(input || {}, field)) continue;
    if (input[field] === '' || input[field] == null || !Number.isFinite(Number(input[field])) || Number(input[field]) !== Number(effectiveRow[field])) {
      const error = new Error(`${field}는 해당 차수 입고 중량을 사용합니다. 입고관리의 GW/CW를 확인하고 다시 조회하세요.`);
      error.statusCode = 409; error.code = 'INBOUND_WEIGHT_AUTHORITATIVE'; throw error;
    }
  }
}

export function resolveCountryWeight(row, inbound, { preserveSaved = false } = {}) {
  const out = { ...(row || {}) }, source = {};
  for (const key of ['GW1', 'GW2']) {
    const explicitZero = row?.[key] != null && row[key] !== '' && Number(row[key]) === 0;
    if (!preserveSaved && !explicitZero && positive(inbound?.[key])) {
      out[key] = Number(inbound[key]); source[key] = 'erp_inbound';
    } else if (row?.[key] != null && row[key] !== '') source[key] = 'manual';
    else if (positive(inbound?.[key])) { out[key] = Number(inbound[key]); source[key] = 'erp_inbound'; }
    else source[key] = 'missing';
  }
  return { row: out, source };
}
