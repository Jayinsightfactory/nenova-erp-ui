const MAX_AUDIT_REPORTS = 20;
const MAX_ENTRIES = 5;
const MAX_CANDIDATE_EVENTS = 3;

function sourceIdentityOf(value) { return value && typeof value.sourceIdentity === 'string' && value.sourceIdentity.length > 0 ? value.sourceIdentity : null; }
function pairKey(value) { const sourceIdentity = sourceIdentityOf(value); return sourceIdentity && typeof value?.id === 'string' && value.id.length > 0 ? `${sourceIdentity}\u001f${value.id}` : null; }
function candidateEvents(finding) { return Array.isArray(finding?.evidence?.candidateEvents) ? finding.evidence.candidateEvents : []; }
function publicCandidate(event) { return { before: event?.before ?? null, after: event?.after ?? null, unit: typeof event?.unit === 'string' ? event.unit : null, changeAt: typeof event?.changeAt === 'string' ? event.changeAt : null, week: typeof event?.week === 'string' ? event.week : null, shipmentDate: typeof event?.shipmentDate === 'string' ? event.shipmentDate : null }; }

function auditSummaryFor(report, sourceIdentity) {
  const requests = Array.isArray(report.report?.requests) ? report.report.requests.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const findings = Array.isArray(report.report?.findings) ? report.report.findings.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const unresolved = Array.isArray(report.report?.unresolved) ? report.report.unresolved.filter(row => sourceIdentityOf(row) === sourceIdentity) : [];
  const findingsByPair = new Map();
  for (const finding of findings) { const key = pairKey(finding); if (!key) continue; const rows = findingsByPair.get(key) || []; rows.push(finding); findingsByPair.set(key, rows); }
  const requestPairCounts = new Map();
  for (const request of requests) { const key = pairKey(request); requestPairCounts.set(key, (requestPairCounts.get(key) || 0) + 1); }
  const hasDuplicateRequestPair = [...requestPairCounts.values()].some(count => count > 1);
  const hasExtraFinding = findings.some(finding => { const key = pairKey(finding); return !key || !requestPairCounts.has(key); });
  const entries = requests.slice(0, MAX_ENTRIES).map(request => {
    const matches = findingsByPair.get(pairKey(request)) || [];
    const finding = matches.length === 1 ? matches[0] : null;
    const events = candidateEvents(finding);
    return { requestId: typeof request.id === 'string' ? request.id : null, sourceIdentity, quote: typeof request.quote === 'string' ? request.quote : null, customerText: typeof request.customerText === 'string' ? request.customerText : null, productText: typeof request.productText === 'string' ? request.productText : null, inputQty: Number.isFinite(request.inputQty) ? request.inputQty : Number.isFinite(request.qty) ? request.qty : null, inputUnit: typeof request.inputUnit === 'string' ? request.inputUnit : typeof request.unit === 'string' ? request.unit : null, status: finding?.status || 'NEEDS_REVIEW', reasonKorean: typeof finding?.reasonKorean === 'string' ? finding.reasonKorean : matches.length > 1 ? '같은 원문 요청에 비교 결과가 여러 개여서 하나로 연결하지 않습니다.' : '이 원문 요청과 정확히 연결된 비교 결과가 없습니다.', candidateEvents: events.slice(0, MAX_CANDIDATE_EVENTS).map(publicCandidate), candidateEventsTruncated: events.length > MAX_CANDIDATE_EVENTS || finding?.evidenceTruncated === true };
  });
  const matchedCount = requests.reduce((count, request) => { const key = pairKey(request); const matches = findingsByPair.get(key) || []; return count + (requestPairCounts.get(key) === 1 && matches.length === 1 && matches[0].status === 'MATCHING_HISTORY' ? 1 : 0); }, 0);
  const partialCount = requests.reduce((count, request) => { const key = pairKey(request); const matches = findingsByPair.get(key) || []; return count + (requestPairCounts.get(key) === 1 && matches.length === 1 && matches[0].status === 'PARTIAL_HISTORY' ? 1 : 0); }, 0);
  return { sourceIdentity, auditId: report.id, archiveCreatedAt: report.createdAt, asOf: typeof report.report?.asOf === 'string' ? report.report.asOf : null, requestCount: requests.length, findingCount: findings.length, unresolvedCount: unresolved.length, matchedRequestCount: matchedCount, partialRequestCount: partialCount, allMatchingHistory: requests.length > 0 && !hasDuplicateRequestPair && !hasExtraFinding && matchedCount === requests.length && unresolved.length === 0, entries, entriesTruncated: requests.length > MAX_ENTRIES, unresolved: unresolved.slice(0, MAX_ENTRIES).map(row => ({ quote: typeof row?.quote === 'string' ? row.quote : null, reason: typeof row?.reason === 'string' ? row.reason : null })), unresolvedTruncated: unresolved.length > MAX_ENTRIES, advisoryOnly: true, erpAction: 'NONE' };
}

function summarizeAuditReports(reports) {
  const latest = new Map();
  const bounded = Array.isArray(reports) ? reports.slice(0, MAX_AUDIT_REPORTS) : [];
  for (const report of bounded) {
    if (!report || report.advisoryOnly !== true || report.erpAction !== 'NONE' || !report.report || typeof report.id !== 'string') continue;
    const identities = new Set();
    for (const row of [...(report.report.requests || []), ...(report.report.findings || []), ...(report.report.unresolved || [])]) { const sourceIdentity = sourceIdentityOf(row); if (sourceIdentity) identities.add(sourceIdentity); }
    for (const sourceIdentity of identities) if (!latest.has(sourceIdentity)) latest.set(sourceIdentity, auditSummaryFor(report, sourceIdentity));
  }
  return [...latest.values()].sort((left, right) => left.sourceIdentity.localeCompare(right.sourceIdentity));
}

module.exports = { MAX_AUDIT_REPORTS, MAX_ENTRIES, MAX_CANDIDATE_EVENTS, summarizeAuditReports };
