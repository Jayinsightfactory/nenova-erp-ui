import { createHash } from 'node:crypto';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { readInvoiceCosts, verifyInvoiceReceiptLive } from './invoiceReceiptCost.js';

export const INVOICE_STAGE_NAMES = Object.freeze(['draft', 'validation', 'receipt', 'receiptVerify', 'cost', 'costSave', 'costVerify']);
export const INVOICE_STAGE_STATUSES = Object.freeze(['running', 'blocked', 'failed', 'unknown', 'passed']);
export const INVOICE_STAGE_CODES = Object.freeze(['VALIDATION_BLOCKED', 'SOURCE_MISMATCH', 'DOCUMENT_STALE', 'RECEIPT_FAILED', 'RECEIPT_UNKNOWN', 'RECEIPT_MISMATCH', 'COST_INPUT_REQUIRED', 'COST_CALCULATION_FAILED', 'COST_SAVE_FAILED', 'COST_UNKNOWN', 'COST_MISMATCH', 'NETWORK_ERROR', 'REQUEST_FAILED', 'USER_CANCELLED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const fail = (code, message, statusCode = 409) => { throw Object.assign(new Error(message), { code, statusCode }); };
const param = (type, value) => ({ type, value });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateInvoiceStageInput(input, documentId, actor) {
  if (typeof documentId !== 'string' || !UUID.test(documentId)) fail('STAGE_INPUT_INVALID', '문서 ID를 확인하세요.', 400);
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 200) fail('STAGE_ACTOR_REQUIRED', '로그인 사용자를 확인하세요.', 403);
  const allowed = ['documentRevision', 'sourceHash', 'stage', 'status', 'attemptId', 'eventId', 'code'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))
    || !Number.isSafeInteger(input.documentRevision) || input.documentRevision < 1 || input.documentRevision > 2147483647
    || typeof input.sourceHash !== 'string' || !HASH.test(input.sourceHash)
    || !INVOICE_STAGE_NAMES.includes(input.stage) || !INVOICE_STAGE_STATUSES.includes(input.status)
    || typeof input.attemptId !== 'string' || !UUID.test(input.attemptId)
    || typeof input.eventId !== 'string' || !UUID.test(input.eventId)
    || (input.code !== undefined && !INVOICE_STAGE_CODES.includes(input.code))) fail('STAGE_INPUT_INVALID', '단계 로그 입력을 확인하세요.', 400);
  return { documentRevision: input.documentRevision, sourceHash: input.sourceHash.toLowerCase(), stage: input.stage,
    status: input.status, attemptId: input.attemptId.toLowerCase(), eventId: input.eventId.toLowerCase(), code: input.code ?? null };
}

export function verifyReceiptDocument(document) {
  const operations = (document.operations || []).filter(op => op.status === 'COMMITTED' && op.documentRevision === document.revision);
  if (operations.length !== 1) fail('STAGE_RECEIPT_UNVERIFIED', '현재 버전의 확정 입고를 확인할 수 없습니다.');
  const operation = operations[0], result = operation.result;
  const header = result?.receiptSnapshot?.header;
  if (operation.documentId !== document.documentId || !Number.isInteger(operation.warehouseKey) || operation.warehouseKey <= 0
    || result?.documentId !== document.documentId || result?.revision !== document.revision
    || result?.operationId !== operation.operationId || result?.warehouseKey !== operation.warehouseKey
    || String(header?.OrderYear ?? header?.orderYear) !== String(document.orderYear)
    || (header?.OrderWeek ?? header?.orderWeek) !== document.orderWeek
    || (header?.InvoiceNo ?? header?.invoiceNo) !== document.invoiceNo
    || !Array.isArray(result?.lineMappings) || !document.lines?.length || result.lineMappings.length !== document.lines.length)
    fail('STAGE_RECEIPT_UNVERIFIED', '확정 입고의 문서·상세 범위가 일치하지 않습니다.');
  return operation;
}

async function evidenceFor({ queryFn, types, document, input, verifyLiveFn, readCostsFn }) {
  const browser = { origin: 'CLIENT_OBSERVED', kind: input.stage === 'cost' && input.status === 'passed' ? 'BROWSER_CALCULATION_REPORT' : 'BROWSER_STAGE_REPORT', erpProof: false };
  if (input.status !== 'passed' || !['receipt', 'receiptVerify', 'costSave', 'costVerify'].includes(input.stage)) return browser;
  const operation = verifyReceiptDocument(document);
  const live = await verifyLiveFn({ queryFn, types, document, operation });
  if (live?.matches !== true) fail('STAGE_RECEIPT_UNVERIFIED', '현재 전산 입고 원장이 확정 근거와 다릅니다.');
  const scope = { origin: 'SERVER_VERIFIED', operationId: operation.operationId, warehouseKey: operation.warehouseKey,
    documentRevision: document.revision, orderYear: document.orderYear, orderWeek: document.orderWeek, lineCount: document.lines.length };
  if (['receipt', 'receiptVerify'].includes(input.stage)) return { ...scope, kind: 'RECEIPT_COMMITTED_VERIFIED', erpProof: true };
  const costs = await readCostsFn({ queryFn, types, warehouseKey: operation.warehouseKey });
  const actual = costs?.currentActual;
  if (costs?.status !== 'APPROVED' || costs.documentCostStatus !== 'APPROVED' || costs.documentId !== document.documentId
    || costs.documentRevision !== document.revision || costs.operationId !== operation.operationId || costs.warehouseKey !== operation.warehouseKey
    || actual?.basis !== 'ACTUAL' || actual.status !== 'APPROVED' || actual.liveReceiptStatus !== 'MATCH'
    || actual.documentId !== document.documentId || actual.documentRevision !== document.revision || actual.operationId !== operation.operationId
    || actual.warehouseKey !== operation.warehouseKey)
    fail('STAGE_COST_UNVERIFIED', '현재 입고에 승인된 실제 원가를 확인할 수 없습니다.');
  return { ...scope, kind: 'COST_APPROVED_VERIFIED', erpProof: true, costRevisionId: actual.costRevisionId };
}

// Only history is written. A logging failure is never a reason to retry receipt creation.
export async function appendInvoiceReceiptStageEvent({ withTransactionFn, types, documentId, actor, input,
  getDocumentFn = getInvoiceDocument, verifyLiveFn = verifyInvoiceReceiptLive, readCostsFn = readInvoiceCosts }) {
  const normalized = validateInvoiceStageInput(input, documentId, actor);
  const id = documentId.toLowerCase();
  const requestHash = digest({ documentId: id, actor, ...normalized });
  return withTransactionFn(async queryFn => {
    const params = { documentId: param(types.UniqueIdentifier, id), eventId: param(types.NVarChar, normalized.eventId) };
    const lock = await queryFn(`/* invoice-stage:lock-document */ SELECT DocumentId FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE DocumentId=@documentId`, params);
    if (lock.recordset?.length !== 1) fail('STAGE_DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.', 404);
    const document = await getDocumentFn({ queryFn, types, documentId: id });
    if (!document || document.revision !== normalized.documentRevision || document.sourceHash !== normalized.sourceHash)
      fail('STAGE_DOCUMENT_STALE', '문서 버전 또는 원본이 변경되었습니다. 이 로그 요청을 재시도하지 마세요.');
    const duplicate = await queryFn(`/* invoice-stage:find-event */ SELECT HistoryId,AfterJson,Actor,CreatedAt FROM dbo.WebInvoiceHistory WITH (UPDLOCK,HOLDLOCK)
      WHERE DocumentId=@documentId AND Action=N'WORKFLOW_STAGE' AND JSON_VALUE(AfterJson,'$.eventId')=@eventId`, params);
    const toEvent = row => ({ ...JSON.parse(row.AfterJson), historyId: String(row.HistoryId), actor: row.Actor, createdAt: row.CreatedAt });
    if (duplicate.recordset?.length) {
      const row = duplicate.recordset[0];
      if (JSON.parse(row.AfterJson).requestHash !== requestHash) fail('STAGE_EVENT_CONFLICT', '같은 이벤트 ID의 내용이 다릅니다.');
      return { event: toEvent(row), idempotent: true };
    }
    const evidence = await evidenceFor({ queryFn, types, document, input: normalized, verifyLiveFn, readCostsFn });
    const event = { schemaVersion: 1, ...normalized, orderYear: document.orderYear, orderWeek: document.orderWeek, evidence, requestHash };
    const inserted = await queryFn(`/* invoice-stage:append */ INSERT dbo.WebInvoiceHistory
      (DocumentId,Revision,OperationId,Action,BeforeJson,AfterJson,Reason,Actor,CreatedAt)
      OUTPUT inserted.HistoryId,inserted.AfterJson,inserted.Actor,inserted.CreatedAt
      VALUES (@documentId,@revision,NULL,N'WORKFLOW_STAGE',NULL,@after,NULL,@actor,SYSUTCDATETIME())`, {
      ...params, revision: param(types.Int, document.revision), after: param(types.NVarChar, JSON.stringify(event)), actor: param(types.NVarChar, actor),
    });
    return { event: toEvent(inserted.recordset[0]), idempotent: false };
  });
}
