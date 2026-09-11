'use strict';

// Keep this list aligned with the canonical live-history parser.  A stock
// heading must never swallow an explicit request merely because it also has a
// number on the next line.
const EXPLICIT_ACTION_RE = /(?:추가|증가|늘려|더\s*해|플러스|취소(?!선)|감소|빼|마이너스|차감|삭제)/;
const DELIVERY_ACTION_RE = /(?:분배|출고)\s*(?:요청|처리|진행|해\s*주세요|해주세요|해줘|부탁|바랍니다|할\s*게|할게)/;
const DIRECTIONAL_REQUEST_RE = /(?:변화|넣어\s*주세요|넣어줘|(?:^|[\s(])(?:\+\s*\d+|-\d+))/;
const STOCK_RE = /(?:잔량|재고)/;
const QUANTITY_RE = /\d+(?:\.\d+)?\s*(?:박스|box|단|bunch|송이|stem|stems)/i;

function hasRequestSignal(value) {
  const content=String(value||'').replace(/메시지가\s*삭제되었습니다\.?/g,'');
  return EXPLICIT_ACTION_RE.test(content) || DELIVERY_ACTION_RE.test(content) || DIRECTIONAL_REQUEST_RE.test(content);
}

function textOf(message) {
  if (typeof message === 'string') return message;
  return typeof message?.message === 'string' ? message.message : '';
}

function compactLine(value) {
  const line = String(value || '').replace(/\s+/g, ' ').trim();
  return line.length > 96 ? `${line.slice(0, 95)}…` : line;
}

function linesOf(message) {
  return textOf(message).split(/\r?\n/).map(compactLine).filter(Boolean);
}

function classifyMessage(message) {
  const text = textOf(message);
  if (!text.trim()) return 'REVIEW';
  // A real distribution verb wins even when a sender also mentions stock.
  if (hasRequestSignal(text)) return 'REQUEST';
  const lines = linesOf(message);
  const headerIndex = lines.findIndex((line, index) => index < 2 && STOCK_RE.test(line));
  const hasNumericList = headerIndex >= 0 && lines.slice(headerIndex + 1).some(line => /\d/.test(line));
  return hasNumericList ? 'STOCK' : 'REVIEW';
}

function summarizeMessage(message) {
  const lines = linesOf(message);
  if (!lines.length) return '내용 확인 필요';
  const actionIndexes = lines.map((line, index) => hasRequestSignal(line) ? index : -1).filter(index => index >= 0);
  if (!actionIndexes.length) return lines.slice(0, 2).join('\n');

  const actionIndex = actionIndexes[0];
  const preceding = lines[actionIndex - 1];
  const isGenericHeader = value => /(?:잔량|재고|변경\s*사항|분배\s*요청|주문\s*요청)/.test(value)
    || /^\d{1,4}\s*(?:[-/.]\s*\d{1,2}){1,2}(?:차)?(?:\s|$)/.test(value);
  const customer = preceding && !isGenericHeader(preceding) ? preceding : '';
  const actionLabel = value => (value.match(EXPLICIT_ACTION_RE) || value.match(DELIVERY_ACTION_RE) || value.match(DIRECTIONAL_REQUEST_RE) || [value])[0];
  const requests = [];
  let inheritedAction = null;
  for (const line of lines) {
    if (hasRequestSignal(line)) {
      inheritedAction = actionLabel(line);
      if (QUANTITY_RE.test(line)) requests.push(line);
      continue;
    }
    if (inheritedAction && QUANTITY_RE.test(line)) requests.push(`${line} ${inheritedAction}`);
  }
  if (!requests.length) return [customer, lines[actionIndex]].filter(Boolean).join(' · ');
  return `${[customer, requests[0]].filter(Boolean).join(' · ')}${requests.length > 1 ? ` 외 ${requests.length - 1}건` : ''}`;
}

function validIdentity(value) {
  return typeof value === 'string' && value.length > 0;
}

function requestId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function shipmentEvidence(request, item) {
  if (request?.status === 'ORDER_ONLY' || item?.status === 'ORDER_ONLY') return false;
  return request?.status === 'DISTRIBUTION_EVIDENCE' || request?.status === 'ORDER_AND_DISTRIBUTION';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function consistentEvidence(request) {
  const requested = finiteNumber(request?.requestedSignedDelta);
  const observed = finiteNumber(request?.observedSignedDelta);
  return request?.evidenceStatus === 'CONSISTENT' && requested !== null && observed !== null && Math.abs(requested - observed) <= 1e-6;
}

function comparisonRows(comparison, identity) {
  if (!Array.isArray(comparison?.products) || !validIdentity(identity)) return [];
  const rows = [];
  for (const product of comparison.products) {
    for (const request of product?.requests || []) {
      if (request?.sourceIdentity === identity) rows.push({ product, request });
    }
  }
  return rows;
}

function labelFor(status) {
  return status === 'MATCHED' ? '매칭' : status === 'PARTIAL' ? '일부 매칭' : '미확인';
}

function operationSummary(matches) {
  const operations = [];
  for (const { liveRequest, product, request } of matches) {
    const customer = compactLine(liveRequest?.customerText);
    const name = compactLine(liveRequest?.productText || product?.prodName);
    const observed = finiteNumber(request?.observedSignedDelta);
    const action = observed > 0 ? '분배 추가' : observed < 0 ? '분배 취소' : '분배 변동';
    const text = [customer, name, action].filter(Boolean).join(' · ');
    if (text && !operations.includes(text)) operations.push(text);
  }
  return operations.length ? operations.slice(0, 2).join(' / ') : '대응 작업 미확인';
}

function matchingSummary(comparison, identity, liveItem) {
  const empty = { status: 'UNCONFIRMED', label: '미확인', matchedCount: 0, totalCount: 0, operationSummary: '대응 작업 미확인' };
  if (!validIdentity(identity) || !liveItem || !validIdentity(liveItem.sourceIdentity) || liveItem.sourceIdentity !== identity) return empty;
  const liveRequests = Array.isArray(liveItem.requests) ? liveItem.requests : [];
  if (!liveRequests.length || liveItem.status === 'ORDER_ONLY') return empty;

  const rows = comparisonRows(comparison, identity);
  const liveIdCounts = new Map();
  const comparisonById = new Map();
  for (const request of liveRequests) {
    const id = requestId(request?.id);
    if (id) liveIdCounts.set(id, (liveIdCounts.get(id) || 0) + 1);
  }
  for (const row of rows) {
    const id = requestId(row.request?.requestId);
    if (!id) continue;
    const previous = comparisonById.get(id) || [];
    previous.push(row);
    comparisonById.set(id, previous);
  }

  const liveIds = liveRequests.map(request => requestId(request?.id));
  const comparisonIds = rows.map(row => requestId(row.request?.requestId));
  const liveIdsUnique = liveIds.every(Boolean) && new Set(liveIds).size === liveIds.length;
  const comparisonIdsUnique = comparisonIds.every(Boolean) && new Set(comparisonIds).size === comparisonIds.length;
  const exactCoverage = liveIdsUnique && comparisonIdsUnique && liveIds.length === comparisonIds.length
    && liveIds.every(id => comparisonById.has(id));
  const matches = [];
  let hasPartialHistory = false;
  for (const liveRequest of liveRequests) {
    const id = requestId(liveRequest?.id);
    if (!id || liveIdCounts.get(id) !== 1) continue;
    const candidates = comparisonById.get(id) || [];
    if (candidates.length !== 1) continue;
    if (candidates[0].request.evidenceStatus === 'PARTIAL') hasPartialHistory = true;
    if (!shipmentEvidence(liveRequest, liveItem)) continue;
    if (!consistentEvidence(candidates[0].request)) continue;
    matches.push({ liveRequest, ...candidates[0] });
  }
  const totalCount = liveRequests.length;
  const matchedCount = matches.length;
  const status = liveItem.status !== 'AMBIGUOUS' && exactCoverage && matchedCount === totalCount && totalCount > 0 ? 'MATCHED'
    : matchedCount > 0 || hasPartialHistory ? 'PARTIAL' : 'UNCONFIRMED';
  return { status, label: labelFor(status), matchedCount, totalCount, operationSummary: operationSummary(matches) };
}

module.exports = { classifyMessage, summarizeMessage, matchingSummary };
