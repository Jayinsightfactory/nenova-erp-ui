// Browser-safe coordinator. Each callback is one existing API action; this module
// deliberately has no receipt commit/cost write callback or SQL dependency.
export const RECEIPT_WORKFLOW_STAGES = Object.freeze([
  { id: 'conversion', label: '국가별 변환' },
  { id: 'draft', label: '초안 저장' },
  { id: 'validation', label: '품목·수량 검증' },
  { id: 'receipt', label: '입고 등록' },
  { id: 'receiptVerify', label: '입고 재조회' },
  { id: 'cost', label: '원가 계산·검증' },
  { id: 'costSave', label: '원가 승인 저장' },
  { id: 'costVerify', label: '원가 재조회' },
]);
const COUNTRIES = new Set(['NL', 'CN', 'CO', 'EC', 'TH', 'AU', 'US', 'VN']);
const key = value => String(value ?? '').trim().toLowerCase();
const positiveInteger = value => value !== null && value !== undefined && value !== ''
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function workflowError(code, message) {
  return Object.assign(new Error(message), { code, workflowValidation: true });
}

export function assertReceiptScope(actual, expected, revision = expected?.revision) {
  if (!actual || !expected || !expected.documentId || !/^[a-f0-9]{64}$/i.test(expected.sourceHash || '')
    || !/^\d{4}$/.test(String(expected.orderYear || '')) || !/^\d{2}-\d{2}$/.test(String(expected.orderWeek || ''))
    || ['documentId', 'sourceHash', 'orderYear', 'orderWeek'].some(field => key(actual[field]) !== key(expected[field]))
    || !positiveInteger(actual.revision) || Number(actual.revision) !== Number(revision)) {
    throw workflowError('WORKFLOW_SCOPE_MISMATCH', '문서·원본·연도·세부차수·버전이 응답과 다릅니다. 현재 문서를 다시 조회하세요.');
  }
  return actual;
}

export function verifyReceiptDocument(document, expectedDocument = document) {
  assertReceiptScope(document, expectedDocument);
  const operations = (document.operations || []).filter(operation => operation.status === 'COMMITTED'
    && Number(operation.documentRevision ?? operation.revision) === Number(document.revision));
  if (document.receiptStatus !== 'COMMITTED' || operations.length !== 1) {
    throw workflowError('RECEIPT_READBACK_REQUIRED', '이 문서 버전의 입고 완료 작업을 재조회에서 확인하지 못했습니다. 입고를 다시 등록하지 마세요.');
  }
  const operation = operations[0];
  const result = operation.result;
  const warehouseKey = Number(result?.warehouseKey ?? operation.warehouseKey);
  if (!positiveInteger(warehouseKey) || !operation.operationId || !result
    || key(result.documentId) !== key(document.documentId)
    || (operation.documentId && key(operation.documentId) !== key(document.documentId))
    || Number(result.revision) !== Number(document.revision)
    || (expectedDocument.operationId && key(operation.operationId) !== key(expectedDocument.operationId))
    || (expectedDocument.warehouseKey != null && Number(expectedDocument.warehouseKey) !== warehouseKey)
    || (operation.warehouseKey != null && Number(operation.warehouseKey) !== warehouseKey)
    || (document.warehouseKey != null && Number(document.warehouseKey) !== warehouseKey)) {
    throw workflowError('RECEIPT_RESULT_MISMATCH', '입고 완료 작업의 문서·버전·원장번호를 확인하지 못했습니다. 재조회만 다시 진행하세요.');
  }
  return { document, operation, warehouseKey };
}

export async function runReceiptPreparation({ record, saveDraft, previewDraft, readDocument,
  onStage = () => {}, isCurrent = () => true }) {
  let document = record?.document;
  let stage = 'conversion';
  let draftSaveAttempted = false;
  const emit = (id, status, message) => {
    stage = id;
    if (isCurrent()) onStage({ id, status, message, at: new Date().toISOString(),
      documentId: document?.documentId, revision: document?.revision });
  };
  const ensureCurrent = () => {
    if (!isCurrent()) throw workflowError('WORKFLOW_CANCELLED', '문서가 변경되어 자동 진행을 중단했습니다.');
  };
  const stop = (status, message, id = stage) => {
    emit(id, status === 'UNKNOWN' ? 'unknown' : 'blocked', message);
    return { status, document, stage: id, error: message };
  };
  try {
    ensureCurrent();
    if (!document?.documentId) return stop('BLOCKED', '처리할 인보이스 문서가 없습니다.');
    if (record.pendingOperation) return stop('UNKNOWN', '입고 작업 결과를 먼저 확인하세요. 새 등록 요청은 보내지 않습니다.', 'receipt');
    const country = String(document.reviewedMetadata?.country || '').trim().toUpperCase();
    if (!COUNTRIES.has(country)) return stop('BLOCKED', '국가별 변환 경로를 확인하세요. 지원하지 않는 국가를 다른 국가로 대체하지 않습니다.');
    if (document.sourceWarnings?.length) return stop('BLOCKED', document.sourceWarnings.map(w => typeof w === 'string' ? w : w.message || w.code).join(' · '));
    if (!Array.isArray(document.lines) || document.lines.length === 0) return stop('BLOCKED', '변환된 품목 행이 없습니다.');
    emit('conversion', 'passed', `${country} 변환 결과 · ${document.lines.length}행. 전산 검증은 다음 단계에서 별도 수행합니다.`);
    if (!record.dirty && document.receiptStatus === 'COMMITTED') {
      emit('draft', 'passed', `저장 버전 ${document.revision}`);
      emit('receipt', 'passed', '이미 등록된 문서입니다. 재등록하지 않습니다.');
      emit('receiptVerify', 'running', '같은 문서·버전의 입고 결과를 다시 조회합니다.');
      const loaded = await readDocument(document.documentId);
      ensureCurrent();
      verifyReceiptDocument(loaded, document);
      document = loaded;
      emit('receiptVerify', 'passed', '문서·버전·원장번호 일치를 확인했습니다.');
      return { status: 'RECEIPT_VERIFIED', document, stage: 'receiptVerify' };
    }
    if (record.dirty || !positiveInteger(document.revision)) {
      emit('draft', 'running', '초안을 별도 저장합니다. ERP 입고는 아직 실행하지 않습니다.');
      draftSaveAttempted = true;
      const saved = await saveDraft(document);
      ensureCurrent();
      assertReceiptScope(saved, document, positiveInteger(document.revision) ? Number(document.revision) + 1 : 1);
      document = saved;
    }
    emit('draft', 'passed', `저장 버전 ${document.revision}`);
    emit('validation', 'running', '저장된 버전으로 품목·수량·확정·원장을 검증합니다.');
    const preview = await previewDraft(document);
    ensureCurrent();
    if (!preview || Number(preview.documentRevision) !== Number(document.revision)) {
      throw workflowError('PREVIEW_SCOPE_MISMATCH', '검증 응답의 문서 버전이 다릅니다.');
    }
    if (preview.document) assertReceiptScope(preview.document, document);
    if (preview.canCommit !== true || !Array.isArray(preview.issues) || preview.issues.length
      || !/^[a-f0-9]{64}$/i.test(preview.baselineDigest || '')) {
      emit('validation', 'blocked', '서버 검증에서 확인할 이슈가 있습니다. 수정 후 이 단계부터 다시 진행하세요.');
      return { status: 'BLOCKED', document, preview, stage: 'validation' };
    }
    emit('validation', 'passed', '서버 사전검증 통과. 실제 저장 시 같은 조건을 다시 검사합니다.');
    emit('receipt', 'waiting', '담당자가 사유와 범위를 확인하면 입고를 등록합니다.');
    return { status: 'WAITING_CONFIRMATION', document, preview, stage: 'receipt' };
  } catch (error) {
    if (error.code === 'WORKFLOW_CANCELLED' || !isCurrent()) return { status: 'CANCELLED', document, stage };
    // A failed save response is not proof of rollback. Do not automatically
    // create a new revision on retry; caller must reload the same document.
    const unknown = stage === 'draft' && draftSaveAttempted
      && !(error.httpStatus >= 400 && error.httpStatus < 500);
    emit(stage, unknown ? 'unknown' : 'failed', unknown
      ? '초안 저장 응답이 불명확합니다. 저장 문서를 먼저 조회하고 새 저장은 중단합니다.' : error.message);
    return { status: unknown ? 'UNKNOWN' : 'FAILED', document, stage, error: error.message };
  }
}
