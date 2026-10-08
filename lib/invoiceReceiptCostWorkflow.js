export function invoiceCostStageEvent(document, id, status, message, at = new Date().toISOString()) {
  return {
    documentId: String(document?.documentId || ''),
    revision: Number(document?.revision),
    id,
    status,
    message,
    at,
  };
}

export function invoiceCostApprovalInvalidationEvents(document) {
  return [
    invoiceCostStageEvent(document, 'costSave', 'waiting', '원가 입력이 변경되어 다시 승인해야 합니다.'),
    invoiceCostStageEvent(document, 'costVerify', 'waiting', '원가 입력이 변경되어 새 저장 후 재조회해야 합니다.'),
  ];
}

export function shouldShowInvoiceCostPreviewNotice({ pending, saveStatus, verifyStatus }) {
  return !pending && saveStatus === 'waiting' && verifyStatus === 'waiting';
}

function emitStage(emit, document, id, status, message) {
  try { emit?.(invoiceCostStageEvent(document, id, status, message)); } catch { /* Progress reporting must not alter the cost transaction. */ }
}

export function acquireInvoiceCostWorkflowLock(lockSet, identity) {
  if (!(lockSet instanceof Set) || lockSet.has(identity)) return false;
  lockSet.add(identity);
  return true;
}

export function isInvoiceCostGenerationCurrent({ mounted, currentIdentity, currentGeneration, expectedIdentity, expectedGeneration }) {
  return mounted === true && currentIdentity === expectedIdentity && currentGeneration === expectedGeneration;
}

export function classifyInvoiceCostPostResponse(responseOk, data) {
  if (!responseOk) return { ...data, success: false };
  const malformed = !data || typeof data !== 'object' || !Object.hasOwn(data, 'success')
    || (data.success === true && (!data.cost || typeof data.cost !== 'object' || invoiceCostRevisionIds(data.cost).length === 0));
  if (malformed) return { outcomeUnknown: true, error: '원가 저장 응답 형식이 불완전하여 저장 여부를 확인할 수 없습니다.' };
  return data;
}

export function invoiceCostRevisionIds(cost) {
  const plural = Array.isArray(cost?.savedCostRevisionIds) ? cost.savedCostRevisionIds : [];
  const singular = typeof cost?.savedCostRevisionId === 'string' && cost.savedCostRevisionId.trim()
    ? [cost.savedCostRevisionId] : [];
  return [...new Set([...plural, ...singular].filter(id => typeof id === 'string' && id.trim()).map(id => id.toLowerCase()))];
}

export async function runInvoiceCostStageRunner({
  document, calculate, approvalRequested = false, reason = '', request, warehouseKey,
  post, readback, emit, onSaved, onPostSuccess,
}) {
  emitStage(emit, document, 'cost', 'running', '현재 문서의 실제 입고 행과 입력값을 계산합니다.');
  let preview;
  try { preview = await calculate(); }
  catch (error) {
    const message = error?.message || '원가 계산에 실패했습니다.';
    emitStage(emit, document, 'cost', 'failed', message);
    return { ok: false, blocked: true, saved: approvalRequested ? false : undefined, message, error };
  }
  if (preview?.status !== 'APPROVED') {
    emitStage(emit, document, 'cost', 'blocked', '필수 입력 또는 적용 가능성 검증이 완료되지 않아 원가 저장을 차단했습니다.');
    return { ok: false, blocked: true, saved: approvalRequested ? false : undefined, preview,
      message: '필수 원가 입력 또는 공식 적용 확인이 완료되지 않아 저장하지 않았습니다.' };
  }
  emitStage(emit, document, 'cost', 'passed', '검증된 원가 미리보기가 계산되었습니다.');
  if (!approvalRequested) return { ok: true, preview, saved: false };
  if (!String(reason || '').trim()) return { ok: false, blocked: true, saved: false, preview, message: '승인 사유가 필요합니다.' };
  const saved = await runInvoiceCostSaveWorkflow({ document, request, warehouseKey, post, readback, emit, onSaved, onPostSuccess });
  return { ...saved, preview };
}

export function validateInvoiceCostReadback(document, warehouseKey, payload, expectedCostRevisionIds = []) {
  const costs = payload?.costs;
  const actual = costs?.currentActual;
  const expectedDocumentId = String(document?.documentId || '').toLowerCase();
  const revision = Number(document?.revision);
  const key = Number(warehouseKey);
  if (!payload?.success || !costs || !actual) return { ok: false, message: '원가는 저장됐지만 승인된 실제 원가를 재조회하지 못했습니다.' };
  if (Number(costs.warehouseKey) !== key || String(costs.documentId || '').toLowerCase() !== expectedDocumentId
    || Number(costs.documentRevision) !== revision || String(costs.status) !== 'APPROVED'
    || String(costs.documentCostStatus) !== 'APPROVED') {
    return { ok: false, message: '원가는 저장됐지만 재조회 문서·revision·입고 범위가 현재 문서와 일치하지 않습니다.' };
  }
  if (String(actual.documentId || '').toLowerCase() !== expectedDocumentId || Number(actual.documentRevision) !== revision
    || Number(actual.warehouseKey) !== key || actual.basis !== 'ACTUAL' || actual.status !== 'APPROVED'
    || actual.storedStatus && actual.storedStatus !== 'APPROVED' || actual.liveReceiptStatus && actual.liveReceiptStatus !== 'MATCH') {
    return { ok: false, message: '원가는 저장됐지만 현재 revision의 승인 실제 원가로 확인되지 않았습니다.' };
  }
  if (expectedCostRevisionIds.length && !expectedCostRevisionIds.map(id => String(id).toLowerCase()).includes(String(actual.costRevisionId || '').toLowerCase())) {
    return { ok: false, message: '원가는 저장됐지만 재조회된 실제 원가가 이번 저장 요청과 일치하지 않습니다.' };
  }
  return { ok: true, costs, actual };
}

export async function verifyInvoiceCostReadback({ document, warehouseKey, readback, emit, onSaved, expectedCostRevisionIds = [] }) {
  emitStage(emit, document, 'costVerify', 'running', '저장된 원가를 현재 입고 기준으로 재조회합니다.');
  let verified;
  try {
    const payload = await readback(warehouseKey);
    verified = validateInvoiceCostReadback(document, warehouseKey, payload, expectedCostRevisionIds);
    if (!verified.ok) throw new Error(verified.message);
    emitStage(emit, document, 'costVerify', 'passed', '현재 문서·revision의 승인 실제 원가를 재조회했습니다.');
  } catch (error) {
    const message = `저장됨 · 재조회 확인 실패: ${error?.message || '원가 재조회가 실패했습니다.'}`;
    emitStage(emit, document, 'costVerify', 'failed', message);
    return { ok: false, saved: true, message, error };
  }
  try { await onSaved?.(verified.actual); } catch { /* Readback already verified; refresh callbacks are advisory. */ }
  return { ok: true, actual: verified.actual, costs: verified.costs };
}

export async function runInvoiceCostSaveWorkflow({ document, request, warehouseKey, post, readback, emit, onSaved, onPostSuccess }) {
  emitStage(emit, document, 'costSave', 'running', '승인 사유와 입력값을 포함해 원가 저장을 요청합니다.');
  let savedPayload;
  try {
    savedPayload = await post(request);
    if (savedPayload?.outcomeUnknown === true) {
      const message = savedPayload.error || '저장 결과를 알 수 없습니다. 동일한 승인 요청만 재시도할 수 있습니다.';
      emitStage(emit, document, 'costSave', 'unknown', message);
      return { ok: false, saved: 'unknown', message };
    }
    if (!savedPayload?.success || !savedPayload?.cost) {
      const detail = savedPayload?.error || '원가 저장에 실패했습니다.';
      emitStage(emit, document, 'costSave', 'failed', detail);
      return { ok: false, saved: false, message: detail };
    }
  } catch (error) {
    const unknown = error?.outcomeUnknown === true;
    const message = unknown
      ? '저장 결과를 알 수 없습니다. 동일한 승인 요청만 재시도할 수 있습니다.'
      : (error?.message || '원가 저장에 실패했습니다.');
    emitStage(emit, document, 'costSave', unknown ? 'unknown' : 'failed', message);
    return { ok: false, saved: unknown ? 'unknown' : false, message, error };
  }
  emitStage(emit, document, 'costSave', 'passed', '원가 저장 API가 성공했습니다. 별도 재조회 전에는 완료로 처리하지 않습니다.');
  const expectedCostRevisionIds = invoiceCostRevisionIds(savedPayload.cost);
  onPostSuccess?.(savedPayload, expectedCostRevisionIds);
  const result = await verifyInvoiceCostReadback({ document, warehouseKey, readback, emit, onSaved, expectedCostRevisionIds });
  return result.ok
    ? { ...result, saved: true, savedPayload, savedCostRevisionIds: expectedCostRevisionIds }
    : { ...result, savedPayload, savedCostRevisionIds: expectedCostRevisionIds };
}
