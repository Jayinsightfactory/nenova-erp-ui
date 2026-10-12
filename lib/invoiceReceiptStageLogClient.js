// Browser-only audit transport. Never receives ERP write callbacks or free-form details.
const STAGES = new Set(['draft', 'validation', 'receipt', 'receiptVerify', 'cost', 'costSave', 'costVerify']);
const STATUSES = new Set(['running', 'blocked', 'failed', 'unknown', 'passed']);
const CODES = new Set(['VALIDATION_BLOCKED', 'SOURCE_MISMATCH', 'DOCUMENT_STALE', 'RECEIPT_FAILED', 'RECEIPT_UNKNOWN', 'RECEIPT_MISMATCH', 'COST_INPUT_REQUIRED', 'COST_CALCULATION_FAILED', 'COST_SAVE_FAILED', 'COST_UNKNOWN', 'COST_MISMATCH', 'NETWORK_ERROR', 'REQUEST_FAILED', 'USER_CANCELLED']);
const scopeOf = document => `${document?.documentId}:${document?.revision}:${document?.sourceHash}`;

export function createInvoiceReceiptStageLogClient({ fetchFn = (...args) => fetch(...args), uuid = () => globalThis.crypto.randomUUID(), onChange = () => {} } = {}) {
  const queue = [], last = new Map(), attempts = new Map(), acknowledged = [];
  let active = null;
  const pausedScopes = new Set();
  const snapshot = () => ({ pending: queue.map(item => ({ ...item, payload: { ...item.payload } })), acknowledged: [...acknowledged], busy: Boolean(active) });
  const notify = () => { try { onChange(snapshot()); } catch { /* Observer cannot affect audit delivery. */ } };
  async function drain() {
    if (active) return active;
    if (!queue.some(item => !item.terminal && !pausedScopes.has(item.scope))) return;
    active = (async () => {
      while (queue.some(item => !item.terminal && !pausedScopes.has(item.scope))) {
        const item = queue.find(item => !item.terminal && !pausedScopes.has(item.scope));
        try {
          const response = await fetchFn(`/api/import/receipts/${encodeURIComponent(item.documentId)}/stage-events`, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.payload),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.success !== true) throw Object.assign(new Error(data?.error || '단계 로그 저장을 확인하지 못했습니다.'), { status: response.status, code: data?.code });
          acknowledged.push({ ...item, serverEntry: data.historyEntry || data.event || null, saved: true });
          queue.splice(queue.indexOf(item), 1);
        } catch (error) {
          item.error = error.message || '단계 로그 저장 실패';
          item.terminal = [400, 404, 409, 410].includes(error.status);
          if (!item.terminal) pausedScopes.add(item.scope);
        }
        notify();
      }
    })();
    notify();
    try { await active; } finally { active = null; notify(); }
  }
  function enqueue(document, event) {
    if (!document?.documentId || !Number.isSafeInteger(Number(document.revision)) || Number(document.revision) <= 0
      || !/^[a-f0-9]{64}$/i.test(document.sourceHash || '') || !STAGES.has(event?.id) || !STATUSES.has(event?.status)
      || (event.documentId && event.documentId !== document.documentId)
      || (event.revision != null && Number(event.revision) !== Number(document.revision))) return null;
    const scope = scopeOf(document), key = `${scope}:${event.id}`;
    if (last.get(key) === event.status) return null;
    if (!attempts.has(key) || event.status === 'running') attempts.set(key, uuid());
    const payload = { documentRevision: Number(document.revision), sourceHash: document.sourceHash,
      stage: event.id, status: event.status, attemptId: attempts.get(key), eventId: uuid() };
    if (CODES.has(event.code)) payload.code = event.code;
    last.set(key, event.status);
    queue.push({ scope, documentId: document.documentId, payload, observedAt: new Date().toISOString(), error: '' });
    notify(); void drain();
    return payload.eventId;
  }
  return { enqueue, snapshot, flush: drain, retry: async scope => {
    if (scope) pausedScopes.delete(scope);
    else pausedScopes.clear();
    await drain();
  } };
}

export function invoiceCostExportEligibility(document, actual) {
  if (!actual || actual.status !== 'APPROVED' || actual.basis !== 'ACTUAL' || actual.liveReceiptStatus !== 'MATCH'
    || actual.storedStatus && actual.storedStatus !== 'APPROVED'
    || !actual.documentId || !actual.costRevisionId || !(Number(actual.warehouseKey) > 0)
    || document && (String(document.documentId).toLowerCase() !== String(actual.documentId).toLowerCase()
      || Number(document.revision) !== Number(actual.documentRevision) || document.costStatus === 'STALE')) {
    return { allowed: false, message: '현재 문서의 승인 실제 원가를 재조회한 뒤 다운로드할 수 있습니다.' };
  }
  if (actual.formulaId !== 'CN_AIR_WEIGHT_CBM_V1') return { allowed: false, message: '양식 준비 중 · 원가 승인은 유효합니다.' };
  return { allowed: true, message: '' };
}

export async function downloadInvoiceCostExport(actual, { fetchFn = (...args) => fetch(...args), saveBlob = browserSaveBlob, isCurrent = () => true } = {}) {
  const eligibility = invoiceCostExportEligibility(null, actual);
  if (!eligibility.allowed) throw new Error(eligibility.message);
  const params = new URLSearchParams({ warehouseKey: String(actual.warehouseKey), costRevisionId: actual.costRevisionId });
  const response = await fetchFn(`/api/import/receipts/${encodeURIComponent(actual.documentId)}/cost-export?${params}`, { credentials: 'same-origin', cache: 'no-store' });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || /json/i.test(type)) {
    const data = await response.json().catch(() => null);
    throw Object.assign(new Error(data?.error || '도착원가 양식 다운로드에 실패했습니다. 원가 저장을 다시 실행하지 마세요.'), { httpStatus: response.status, code: data?.code });
  }
  if (!/spreadsheetml|octet-stream|ms-excel/i.test(type)) throw new Error('다운로드 파일 응답을 확인하지 못했습니다. 로그인을 확인하고 다시 조회하세요.');
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  let name = '도착원가.xlsx';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i), plain = disposition.match(/filename="([^"\r\n]+)"/i);
  try { name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : name; } catch { /* Safe fallback name. */ }
  if (isCurrent()) await saveBlob(blob, name.replace(/[\\/\r\n]/g, '_'));
}

function browserSaveBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function currentInvoiceStageHistory(document, acknowledged = []) {
  const entries = new Map();
  for (const entry of document?.history || []) {
    if (Number(entry.revision) !== Number(document.revision)) continue;
    const event = entry.stage ? entry : entry.after?.stageEvent || entry.after || {};
    if (event.sourceHash && event.sourceHash !== document.sourceHash) continue;
    entries.set(entry.historyId || event.eventId || JSON.stringify(entry), { ...entry, event, provenance: '서버 이력' });
  }
  for (const item of acknowledged) {
    if (item.scope !== scopeOf(document)) continue;
    const entry = item.serverEntry;
    if (entry?.historyId && entries.has(entry.historyId) || [...entries.values()].some(e => e.event?.eventId === item.payload.eventId)) continue;
    entries.set(item.payload.eventId, entry ? { ...entry, event: entry.stage ? entry : entry.after?.stageEvent || entry.after || item.payload, provenance: '서버 이력' }
      : { event: item.payload, createdAt: null, observedAt: item.observedAt, provenance: '브라우저 관찰 · 서버 수신 확인' });
  }
  return [...entries.values()].sort((a, b) => String(a.createdAt || a.observedAt || '').localeCompare(String(b.createdAt || b.observedAt || '')));
}

export function invoiceStageHistorySummary(entry) {
  const event = entry?.event || {};
  const titles = { draft: '초안 저장', validation: '품목·수량 검증', receipt: '입고 등록', receiptVerify: '입고 재조회', cost: '원가 계산', costSave: '원가 승인 저장', costVerify: '원가 재조회' };
  const actions = { APPROVE_INVOICE_COST: '원가 승인', CREATE: '초안 생성', CREATE_DRAFT: '초안 생성', REVISE_DRAFT: '초안 수정', REVISE_COMMITTED_DOCUMENT: '등록 문서 수정', UPDATE: '초안 수정', UPDATE_DRAFT: '초안 수정', COMMIT_RECEIPT: '입고 등록', COMMIT: '입고 등록', WORKFLOW_STAGE: '단계 처리', SAVE_DRAFT: '초안 저장', CREATE_INVOICE: '초안 생성', UPDATE_INVOICE: '초안 수정' };
  const verified = event.evidence?.origin === 'SERVER_VERIFIED' && event.evidence.erpProof === true;
  const observed = event.evidence?.origin === 'CLIENT_OBSERVED' || Boolean(event.stage && !verified);
  const value = entry.createdAt || entry.observedAt;
  const date = value ? new Date(value) : null;
  return { title: titles[event.stage] || actions[entry.action] || '문서 처리',
    status: event.status === 'passed' ? verified ? '완료 확인' : event.stage === 'cost' ? '계산 통과(화면 확인)' : '단계 통과(화면 확인)'
      : ({ running: '진행 중', blocked: '수동 확인 필요', failed: '실패', unknown: '결과 확인 필요' })[event.status] || '서버 기록',
    provenance: verified ? '서버 검증' : observed ? '화면 관찰' : '서버 이력',
    actor: entry.actor || '작성자 확인 필요', time: date && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '시각 확인 필요' };
}
