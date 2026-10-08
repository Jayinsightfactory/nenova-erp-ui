import { createHash, randomUUID } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YEAR_RE = /^\d{4}$/;
const WEEK_RE = /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
const HASH_RE = /^[0-9a-f]{64}$/i;
const ROW_VERSION_RE = /^(?:0x)?[0-9a-f]{16}$/i;
const MAX_LINES = 1000;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

export class InvoiceReceiptDocumentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'InvoiceReceiptDocumentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function invalid(message, code = 'INVOICE_DRAFT_INVALID') {
  throw new InvoiceReceiptDocumentError(code, message, 400);
}

function text(value, name, max, { required = false, nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (required) invalid(`${name} is required`);
    return nullable ? null : '';
  }
  if (typeof value !== 'string') invalid(`${name} must be a string`);
  const result = value.normalize('NFC').trim();
  if (!result) {
    if (required) invalid(`${name} is required`);
    return nullable ? null : '';
  }
  if (result.length > max) invalid(`${name} is too long`);
  return result;
}

function positiveInteger(value, name, { nullable = false, max = 2147483647 } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    invalid(`${name} is required`);
  }
  const result = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result <= 0 || result > max) invalid(`${name} must be a positive integer`);
  return result;
}

function nullableYear(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const result = String(value).trim();
  if (!YEAR_RE.test(result)) invalid(`${name} must contain four digits`);
  return result;
}

function uuid(value, name, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    invalid(`${name} is required`);
  }
  const result = String(value).trim().toLowerCase();
  if (!UUID_RE.test(result)) invalid(`${name} must be a UUID`);
  return result;
}

function numberAsPlainDecimal(value) {
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const dot = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const decimalIndex = (dot === -1 ? unsigned.length : dot) + exponent;
  let expanded;
  if (decimalIndex <= 0) expanded = `0.${'0'.repeat(-decimalIndex)}${digits}`;
  else if (decimalIndex >= digits.length) expanded = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  else expanded = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return negative ? `-${expanded}` : expanded;
}

function decimal(value, name, { nullable = true, nonNegative = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    invalid(`${name} is required`);
  }
  let candidate;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${name} must fit decimal(18,6)`);
    candidate = numberAsPlainDecimal(value);
    const represented = /^-?\d+(?:\.(\d+))?$/.exec(candidate);
    if ((represented?.[1]?.length || 0) > 6) {
      const quantized = value.toFixed(6);
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
      if (Math.abs(value - Number(quantized)) > tolerance) invalid(`${name} must fit decimal(18,6)`);
      candidate = quantized;
    }
  } else if (typeof value === 'string') {
    candidate = value.trim();
  } else {
    invalid(`${name} must be a number or decimal string`);
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(candidate);
  if (!match) invalid(`${name} must fit decimal(18,6)`);
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] || '').replace(/0+$/, '');
  if (integer.length > 12 || fraction.length > 6) invalid(`${name} must fit decimal(18,6)`);
  const result = `${match[1]}${integer}${fraction ? `.${fraction}` : ''}`;
  if (nonNegative && result.startsWith('-') && Number(result) !== 0) invalid(`${name} cannot be negative`);
  return result === '-0' ? '0' : result;
}

function jsonObject(value, name, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return { value: null, json: null };
    invalid(`${name} is required`);
  }
  if (typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`);
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    invalid(`${name} must be JSON serializable`);
  }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) invalid(`${name} is too large`);
  const parsed = JSON.parse(json);
  return { value: parsed, json };
}

function expectedRowVersion(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Buffer.isBuffer(value)) {
    if (value.length !== 8) invalid('expectedRowVersion must contain 8 bytes');
    return Buffer.from(value);
  }
  const result = String(value).trim();
  if (!ROW_VERSION_RE.test(result)) invalid('expectedRowVersion must be a 16 digit hex value');
  return Buffer.from(result.replace(/^0x/i, ''), 'hex');
}

function normalizeLine(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) invalid(`lines[${index}] must be an object`);
  const sourceEvidence = jsonObject(line.sourceEvidence, `lines[${index}].sourceEvidence`, { nullable: true });
  const reviewed = jsonObject(line.reviewed, `lines[${index}].reviewed`, { nullable: true });
  const currencyValue = text(line.currency, `lines[${index}].currency`, 3);
  const currency = currencyValue?.toUpperCase() ?? null;
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) invalid(`lines[${index}].currency must be three ASCII letters`);
  return {
    lineId: uuid(line.lineId, `lines[${index}].lineId`),
    lineNo: positiveInteger(line.lineNo, `lines[${index}].lineNo`),
    originalName: text(line.originalName, `lines[${index}].originalName`, 500, { required: true }),
    lengthText: text(line.lengthText, `lines[${index}].lengthText`, 100),
    prodKey: positiveInteger(line.prodKey, `lines[${index}].prodKey`, { nullable: true }),
    boxQuantity: decimal(line.boxQuantity, `lines[${index}].boxQuantity`, { nonNegative: true }),
    bunchQuantity: decimal(line.bunchQuantity, `lines[${index}].bunchQuantity`, { nonNegative: true }),
    stemQuantity: decimal(line.stemQuantity, `lines[${index}].stemQuantity`, { nonNegative: true }),
    priceUnit: text(line.priceUnit, `lines[${index}].priceUnit`, 40),
    unitPrice: decimal(line.unitPrice, `lines[${index}].unitPrice`),
    currency,
    lineAmount: decimal(line.lineAmount, `lines[${index}].lineAmount`),
    sourceEvidence: sourceEvidence.value,
    sourceEvidenceJson: sourceEvidence.json,
    reviewed: reviewed.value,
    reviewedJson: reviewed.json,
  };
}

export function normalizeInvoiceDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('draft body must be an object');
  try {
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_DRAFT_BYTES) invalid('draft body is too large');
  } catch (error) {
    if (error instanceof InvoiceReceiptDocumentError) throw error;
    invalid('draft body must be JSON serializable');
  }
  if (typeof input.orderYear !== 'string' || typeof input.orderWeek !== 'string') invalid('orderYear and orderWeek must be strings');
  const orderYear = input.orderYear.trim();
  const orderWeek = input.orderWeek.trim();
  if (!YEAR_RE.test(orderYear)) invalid('orderYear must contain four digits');
  if (!WEEK_RE.test(orderWeek)) invalid('orderWeek must be MM-NN with major week 01-53 and detail 01-99');
  const sourceHash = String(input.sourceHash ?? '').trim().toLowerCase();
  if (!HASH_RE.test(sourceHash)) invalid('sourceHash must be a SHA-256 hex value');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_LINES) {
    invalid(`lines must contain between 1 and ${MAX_LINES} entries`);
  }
  const lines = input.lines.map(normalizeLine);
  if (new Set(lines.map(line => line.lineId)).size !== lines.length) invalid('lineId values must be unique');
  if (new Set(lines.map(line => line.lineNo)).size !== lines.length) invalid('lineNo values must be unique');
  const rawMetadata = jsonObject(input.rawMetadata, 'rawMetadata');
  const reviewedMetadata = jsonObject(input.reviewedMetadata, 'reviewedMetadata');
  const revisionValue = input.expectedRevision;
  // The current UI adapter represents a new document's null revision as 0.
  // Treat that sentinel as omitted; edits still fail closed because the locked
  // existing document requires a positive expectedRevision in saveInvoiceDraft.
  const expectedRevision = revisionValue === null || revisionValue === undefined || revisionValue === ''
    || revisionValue === 0 || revisionValue === '0'
    ? null : positiveInteger(revisionValue, 'expectedRevision');
  return {
    documentId: uuid(input.documentId, 'documentId', true),
    expectedRevision,
    expectedRowVersion: expectedRowVersion(input.expectedRowVersion ?? input.rowVersion),
    orderYear,
    orderWeek,
    sourceHash,
    sourceHashBuffer: Buffer.from(sourceHash, 'hex'),
    originalFileName: text(input.originalFileName, 'originalFileName', 520, { required: true }),
    farmKey: positiveInteger(input.farmKey, 'farmKey', { nullable: true }),
    invoiceNo: text(input.invoiceNo, 'invoiceNo', 100),
    invoiceYear: nullableYear(input.invoiceYear, 'invoiceYear'),
    rawMetadata: rawMetadata.value,
    rawMetadataJson: rawMetadata.json,
    reviewedMetadata: reviewedMetadata.value,
    reviewedMetadataJson: reviewedMetadata.json,
    reason: text(input.reason, 'reason', 1000),
    lines,
  };
}

function type(types, name, ...args) {
  const candidate = types?.[name];
  if (!candidate) throw new TypeError(`SQL type ${name} is required`);
  return typeof candidate === 'function' ? candidate(...args) : candidate;
}

const param = (sqlType, value) => ({ type: sqlType, value });

function paramsForDocument(types, draft, extras) {
  return {
    documentId: param(type(types, 'UniqueIdentifier'), extras.documentId),
    orderYear: param(type(types, 'Char', 4), draft.orderYear),
    orderWeek: param(type(types, 'Char', 5), draft.orderWeek),
    revision: param(type(types, 'Int'), extras.revision),
    farmKey: param(type(types, 'Int'), draft.farmKey),
    invoiceNo: param(type(types, 'NVarChar', 100), draft.invoiceNo),
    invoiceYear: param(type(types, 'Char', 4), draft.invoiceYear),
    sourceHash: param(type(types, 'Binary', 32), extras.sourceHashBuffer),
    originalFileName: param(type(types, 'NVarChar', 520), extras.originalFileName),
    businessKeyHash: param(type(types, 'Binary', 32), extras.businessKeyHash),
    receiptStatus: param(type(types, 'NVarChar', 20), extras.receiptStatus),
    costStatus: param(type(types, 'NVarChar', 20), extras.costStatus),
    rawMetadataJson: param(type(types, 'NVarChar', types.MAX), extras.rawMetadataJson),
    reviewedMetadataJson: param(type(types, 'NVarChar', types.MAX), draft.reviewedMetadataJson),
    actor: param(type(types, 'NVarChar', 200), extras.actor),
    now: param(type(types, 'DateTime2', 3), extras.now),
  };
}

function businessKeyHash(draft) {
  if (draft.farmKey === null || draft.invoiceNo === null || draft.invoiceYear === null) return null;
  return createHash('sha256').update(`${draft.farmKey}\n${draft.invoiceNo.normalize('NFC').trim()}\n${draft.invoiceYear}`, 'utf8').digest();
}

function mapJson(value, name) {
  if (value === null || value === undefined || value === '') return null;
  try { return JSON.parse(value); } catch { throw new InvoiceReceiptDocumentError('INVOICE_DOCUMENT_DATA_INVALID', `${name} contains invalid JSON`, 500); }
}

function hex(value) {
  if (value === null || value === undefined) return null;
  return Buffer.from(value).toString('hex');
}

function mapDocument(row) {
  return {
    documentId: String(row.DocumentId).toLowerCase(), orderYear: row.OrderYear, orderWeek: row.OrderWeek,
    revision: Number(row.Revision), farmKey: row.FarmKey ?? null, invoiceNo: row.InvoiceNo ?? null,
    invoiceYear: row.InvoiceYear ?? null, sourceHash: hex(row.SourceHash), originalFileName: row.OriginalFileName,
    receiptStatus: row.ReceiptStatus, costStatus: row.CostStatus,
    rawMetadata: mapJson(row.RawMetadataJson, 'RawMetadataJson'), reviewedMetadata: mapJson(row.ReviewedMetadataJson, 'ReviewedMetadataJson'),
    createdBy: row.CreatedBy, createdAt: row.CreatedAt, updatedBy: row.UpdatedBy, updatedAt: row.UpdatedAt,
    rowVersion: hex(row.RowVersion),
  };
}

function mapLine(row) {
  return {
    lineId: String(row.LineId).toLowerCase(), lineNo: Number(row.LineNo), originalName: row.OriginalName,
    lengthText: row.LengthText ?? null, prodKey: row.ProdKey ?? null,
    boxQuantity: row.BoxQuantity ?? null, bunchQuantity: row.BunchQuantity ?? null, stemQuantity: row.StemQuantity ?? null,
    priceUnit: row.PriceUnit ?? null, unitPrice: row.UnitPrice ?? null, currency: row.Currency ?? null,
    lineAmount: row.LineAmount ?? null, sourceEvidence: mapJson(row.SourceEvidenceJson, 'SourceEvidenceJson'),
    reviewed: mapJson(row.ReviewedJson, 'ReviewedJson'),
  };
}

function mapHistory(row) {
  return { historyId: String(row.HistoryId), revision: Number(row.Revision), operationId: row.OperationId ? String(row.OperationId).toLowerCase() : null,
    action: row.Action, before: mapJson(row.BeforeJson, 'BeforeJson'), after: mapJson(row.AfterJson, 'AfterJson'),
    reason: row.Reason ?? null, actor: row.Actor, createdAt: row.CreatedAt };
}

function mapOperation(row) {
  return { operationId: String(row.OperationId).toLowerCase(), documentId: String(row.DocumentId).toLowerCase(),
    documentRevision: Number(row.DocumentRevision),
    receiptPartId: String(row.ReceiptPartId).toLowerCase(), requestHash: hex(row.RequestHash), action: row.Action,
    status: row.Status, warehouseKey: row.WarehouseKey ?? null, result: mapJson(row.ResultJson, 'ResultJson'),
    errorCode: row.ErrorCode ?? null, actor: row.Actor, createdAt: row.CreatedAt, completedAt: row.CompletedAt ?? null };
}

async function readDocument(queryFn, types, documentId) {
  const idParam = { documentId: param(type(types, 'UniqueIdentifier'), documentId) };
  const documentResult = await queryFn(`/* invoice-receipt:get-document */
    SELECT DocumentId,OrderYear,OrderWeek,Revision,FarmKey,InvoiceNo,InvoiceYear,SourceHash,OriginalFileName,
      ReceiptStatus,CostStatus,RawMetadataJson,ReviewedMetadataJson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,RowVersion
    FROM dbo.WebInvoiceDocument WHERE DocumentId=@documentId`, idParam);
  const row = documentResult?.recordset?.[0];
  if (!row) return null;
  const common = { ...idParam, revision: param(type(types, 'Int'), Number(row.Revision)) };
  // Keep these sequential: saveInvoiceDraft reuses the transaction-bound query
  // function, and node-mssql does not allow concurrent requests on one transaction.
  const linesResult = await queryFn(`/* invoice-receipt:get-lines */ SELECT LineId,[LineNo],OriginalName,LengthText,ProdKey,BoxQuantity,BunchQuantity,StemQuantity,PriceUnit,UnitPrice,Currency,LineAmount,SourceEvidenceJson,ReviewedJson FROM dbo.WebInvoiceLine WHERE DocumentId=@documentId AND Revision=@revision ORDER BY [LineNo],LineId`, common);
  const historyResult = await queryFn(`/* invoice-receipt:get-history */ SELECT HistoryId,Revision,OperationId,Action,BeforeJson,AfterJson,Reason,Actor,CreatedAt FROM dbo.WebInvoiceHistory WHERE DocumentId=@documentId ORDER BY Revision,CreatedAt,HistoryId`, idParam);
  const operationResult = await queryFn(`/* invoice-receipt:get-operations */ SELECT OperationId,DocumentId,DocumentRevision,ReceiptPartId,RequestHash,Action,Status,WarehouseKey,ResultJson,ErrorCode,Actor,CreatedAt,CompletedAt FROM dbo.WebInvoiceOperation WHERE DocumentId=@documentId ORDER BY CreatedAt,OperationId`, idParam);
  return { ...mapDocument(row), lines: (linesResult.recordset || []).map(mapLine), history: (historyResult.recordset || []).map(mapHistory), operations: (operationResult.recordset || []).map(mapOperation) };
}

export async function getInvoiceDocument({ queryFn, types, documentId }) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn is required');
  return readDocument(queryFn, types, uuid(documentId, 'documentId'));
}

export async function listInvoiceDocuments({ queryFn, types, orderYear, orderWeek }) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn is required');
  if (typeof orderYear !== 'string' || typeof orderWeek !== 'string') invalid('orderYear and orderWeek must be strings');
  const year = orderYear.trim();
  const week = orderWeek.trim();
  if (!YEAR_RE.test(year)) invalid('orderYear must contain four digits');
  if (!WEEK_RE.test(week)) invalid('orderWeek must be MM-NN with major week 01-53 and detail 01-99');
  const result = await queryFn(`/* invoice-receipt:list-documents */
    SELECT d.DocumentId,d.OrderYear,d.OrderWeek,d.Revision,d.FarmKey,d.InvoiceNo,d.InvoiceYear,d.OriginalFileName,
      d.ReceiptStatus,d.CostStatus,d.UpdatedBy,d.UpdatedAt,d.RowVersion,
      (SELECT COUNT_BIG(1) FROM dbo.WebInvoiceLine l WHERE l.DocumentId=d.DocumentId AND l.Revision=d.Revision) AS LineCount
    FROM dbo.WebInvoiceDocument d WHERE d.OrderYear=@orderYear AND d.OrderWeek=@orderWeek
    ORDER BY d.UpdatedAt DESC,d.DocumentId`, {
    orderYear: param(type(types, 'Char', 4), year), orderWeek: param(type(types, 'Char', 5), week),
  });
  return (result.recordset || []).map(row => ({ documentId: String(row.DocumentId).toLowerCase(), orderYear: row.OrderYear,
    orderWeek: row.OrderWeek, revision: Number(row.Revision), farmKey: row.FarmKey ?? null, invoiceNo: row.InvoiceNo ?? null,
    invoiceYear: row.InvoiceYear ?? null, originalFileName: row.OriginalFileName, receiptStatus: row.ReceiptStatus,
    costStatus: row.CostStatus, updatedBy: row.UpdatedBy, updatedAt: row.UpdatedAt, rowVersion: hex(row.RowVersion), lineCount: Number(row.LineCount) }));
}

async function insertLines(queryFn, types, documentId, revision, lines) {
  for (const line of lines) {
    await queryFn(`/* invoice-receipt:insert-line */ INSERT INTO dbo.WebInvoiceLine
      (DocumentId,Revision,LineId,[LineNo],OriginalName,LengthText,ProdKey,BoxQuantity,BunchQuantity,StemQuantity,PriceUnit,UnitPrice,Currency,LineAmount,SourceEvidenceJson,ReviewedJson)
      VALUES (@documentId,@revision,@lineId,@lineNo,@originalName,@lengthText,@prodKey,@boxQuantity,@bunchQuantity,@stemQuantity,@priceUnit,@unitPrice,@currency,@lineAmount,@sourceEvidenceJson,@reviewedJson)`, {
      documentId: param(type(types, 'UniqueIdentifier'), documentId), revision: param(type(types, 'Int'), revision),
      lineId: param(type(types, 'UniqueIdentifier'), line.lineId), lineNo: param(type(types, 'Int'), line.lineNo),
      originalName: param(type(types, 'NVarChar', 500), line.originalName), lengthText: param(type(types, 'NVarChar', 100), line.lengthText),
      prodKey: param(type(types, 'Int'), line.prodKey), boxQuantity: param(type(types, 'Decimal', 18, 6), line.boxQuantity),
      bunchQuantity: param(type(types, 'Decimal', 18, 6), line.bunchQuantity), stemQuantity: param(type(types, 'Decimal', 18, 6), line.stemQuantity),
      priceUnit: param(type(types, 'NVarChar', 40), line.priceUnit), unitPrice: param(type(types, 'Decimal', 18, 6), line.unitPrice),
      currency: param(type(types, 'Char', 3), line.currency), lineAmount: param(type(types, 'Decimal', 18, 6), line.lineAmount),
      sourceEvidenceJson: param(type(types, 'NVarChar', types.MAX), line.sourceEvidenceJson), reviewedJson: param(type(types, 'NVarChar', types.MAX), line.reviewedJson),
    });
  }
}

function snapshot(draft, documentId, revision, receiptStatus, costStatus) {
  return { documentId, orderYear: draft.orderYear, orderWeek: draft.orderWeek, revision, farmKey: draft.farmKey,
    invoiceNo: draft.invoiceNo, invoiceYear: draft.invoiceYear, originalFileName: draft.originalFileName,
    receiptStatus, costStatus, reviewedMetadata: draft.reviewedMetadata, lineCount: draft.lines.length };
}

function duplicateError(error) {
  return Number(error?.number) === 2601 || Number(error?.number) === 2627;
}

function sameNullableValue(left, right) {
  return (left ?? null) === (right ?? null);
}

function assertCommittedScopeUnchanged(current, draft) {
  const unchanged = current.OrderYear === draft.orderYear
    && current.OrderWeek === draft.orderWeek
    && sameNullableValue(current.FarmKey, draft.farmKey)
    && sameNullableValue(current.InvoiceNo, draft.invoiceNo)
    && sameNullableValue(current.InvoiceYear, draft.invoiceYear);
  if (!unchanged) {
    throw new InvoiceReceiptDocumentError(
      'INVOICE_COMMITTED_SCOPE_CONFLICT',
      'Order year/week and farm/invoice identity cannot change after the first committed receipt',
      409,
    );
  }

  for (const field of ['inputDate', 'invoiceDate']) {
    const value = draft.reviewedMetadata?.[field];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) !== draft.orderYear) {
      throw new InvoiceReceiptDocumentError(
        'INVOICE_COMMITTED_METADATA_DATE_OUT_OF_SCOPE',
        `${field} must be an ISO date within the committed order year`,
        409,
      );
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new InvoiceReceiptDocumentError(
        'INVOICE_COMMITTED_METADATA_DATE_OUT_OF_SCOPE',
        `${field} must be a valid ISO date within the committed order year`,
        409,
      );
    }
  }
}

export async function saveInvoiceDraft({ withTransactionFn, types, input, actor, documentId }) {
  if (typeof withTransactionFn !== 'function') throw new TypeError('withTransactionFn is required');
  const draft = normalizeInvoiceDraft(input);
  const routeId = documentId === undefined ? null : uuid(documentId, 'documentId');
  if (routeId && draft.documentId && routeId !== draft.documentId) invalid('documentId does not match route');
  const targetId = routeId || draft.documentId || randomUUID();
  const actorName = text(actor, 'actor', 200, { required: true });
  const keyHash = businessKeyHash(draft);
  try {
    return await withTransactionFn(async queryFn => {
      const lockResult = await queryFn(`/* invoice-receipt:lock-document */
        SELECT d.DocumentId,d.OrderYear,d.OrderWeek,d.Revision,d.FarmKey,d.InvoiceNo,d.InvoiceYear,
          d.SourceHash,d.OriginalFileName,d.RawMetadataJson,d.ReviewedMetadataJson,d.ReceiptStatus,d.CostStatus,d.RowVersion,
          CASE WHEN EXISTS (SELECT 1 FROM dbo.WebInvoiceOperation o WHERE o.DocumentId=d.DocumentId AND o.Status=N'COMMITTED') THEN 1 ELSE 0 END AS HasCommittedOperation
        FROM dbo.WebInvoiceDocument d WITH (UPDLOCK,HOLDLOCK) WHERE d.DocumentId=@documentId`, {
        documentId: param(type(types, 'UniqueIdentifier'), targetId),
      });
      const current = lockResult.recordset?.[0] || null;
      if (routeId && !current) throw new InvoiceReceiptDocumentError('INVOICE_DOCUMENT_NOT_FOUND', 'Invoice document was not found', 404);
      if (!routeId && current) throw new InvoiceReceiptDocumentError('INVOICE_DOCUMENT_ALREADY_EXISTS', 'POST can only create a new invoice document', 409);
      if (!current && draft.expectedRevision !== null) throw new InvoiceReceiptDocumentError('INVOICE_REVISION_CONFLICT', 'A new draft cannot have expectedRevision', 409);
      if (current && draft.expectedRevision === null) throw new InvoiceReceiptDocumentError('INVOICE_REVISION_REQUIRED', 'expectedRevision is required when revising a document', 409);
      if (current && Number(current.Revision) !== draft.expectedRevision) throw new InvoiceReceiptDocumentError('INVOICE_REVISION_CONFLICT', 'Invoice document revision changed', 409);
      if (current && draft.expectedRowVersion && !Buffer.from(current.RowVersion).equals(draft.expectedRowVersion)) {
        throw new InvoiceReceiptDocumentError('INVOICE_ROW_VERSION_CONFLICT', 'Invoice document rowVersion changed', 409);
      }
      if (keyHash) {
        const duplicate = await queryFn(`/* invoice-receipt:check-business-key */
          SELECT TOP (1) DocumentId FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK)
          WHERE BusinessKeyHash=@businessKeyHash AND DocumentId<>@documentId`, {
          businessKeyHash: param(type(types, 'Binary', 32), keyHash), documentId: param(type(types, 'UniqueIdentifier'), targetId),
        });
        if (duplicate.recordset?.length) throw new InvoiceReceiptDocumentError('INVOICE_BUSINESS_KEY_CONFLICT', 'Farm/invoice/year already exists', 409);
      }
      const now = new Date();
      const revision = current ? Number(current.Revision) + 1 : 1;
      const linked = Boolean(current && (Number(current.HasCommittedOperation) || current.ReceiptStatus === 'COMMITTED'));
      if (linked) assertCommittedScopeUnchanged(current, draft);
      const receiptStatus = linked ? 'COMMITTED' : 'DRAFT';
      const costStatus = linked ? 'STALE' : 'PENDING';
      const sourceHashBuffer = current ? Buffer.from(current.SourceHash) : draft.sourceHashBuffer;
      const originalFileName = current ? current.OriginalFileName : draft.originalFileName;
      const rawMetadataJson = current ? current.RawMetadataJson : draft.rawMetadataJson;
      const documentParams = paramsForDocument(types, draft, { documentId: targetId, revision, sourceHashBuffer,
        originalFileName, businessKeyHash: keyHash, receiptStatus, costStatus, rawMetadataJson, actor: actorName, now });
      if (!current) {
        await queryFn(`/* invoice-receipt:insert-document */ INSERT INTO dbo.WebInvoiceDocument
          (DocumentId,OrderYear,OrderWeek,Revision,FarmKey,InvoiceNo,InvoiceYear,SourceHash,OriginalFileName,BusinessKeyHash,ReceiptStatus,CostStatus,RawMetadataJson,ReviewedMetadataJson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt)
          VALUES (@documentId,@orderYear,@orderWeek,@revision,@farmKey,@invoiceNo,@invoiceYear,@sourceHash,@originalFileName,@businessKeyHash,@receiptStatus,@costStatus,@rawMetadataJson,@reviewedMetadataJson,@actor,@now,@actor,@now)`, documentParams);
      } else {
        const updateResult = await queryFn(`/* invoice-receipt:update-document */ UPDATE dbo.WebInvoiceDocument SET
          OrderYear=@orderYear,OrderWeek=@orderWeek,Revision=@revision,FarmKey=@farmKey,InvoiceNo=@invoiceNo,InvoiceYear=@invoiceYear,
          BusinessKeyHash=@businessKeyHash,ReceiptStatus=@receiptStatus,CostStatus=@costStatus,
          ReviewedMetadataJson=@reviewedMetadataJson,UpdatedBy=@actor,UpdatedAt=@now
          WHERE DocumentId=@documentId AND Revision=@expectedRevision
            AND (@expectedRowVersion IS NULL OR RowVersion=@expectedRowVersion);
          SELECT @@ROWCOUNT AS Affected;`, { ...documentParams,
          expectedRevision: param(type(types, 'Int'), draft.expectedRevision),
          expectedRowVersion: param(type(types, 'Binary', 8), draft.expectedRowVersion),
        });
        if (Number(updateResult.recordset?.[0]?.Affected) !== 1) throw new InvoiceReceiptDocumentError('INVOICE_REVISION_CONFLICT', 'Invoice document changed while saving', 409);
      }
      await insertLines(queryFn, types, targetId, revision, draft.lines);
      const before = current ? JSON.stringify({ documentId: targetId, orderYear: current.OrderYear, orderWeek: current.OrderWeek,
        revision: Number(current.Revision), farmKey: current.FarmKey ?? null, invoiceNo: current.InvoiceNo ?? null,
        invoiceYear: current.InvoiceYear ?? null, originalFileName: current.OriginalFileName,
        receiptStatus: current.ReceiptStatus, costStatus: current.CostStatus,
        reviewedMetadata: mapJson(current.ReviewedMetadataJson, 'ReviewedMetadataJson') }) : null;
      const after = JSON.stringify(snapshot(draft, targetId, revision, receiptStatus, costStatus));
      await queryFn(`/* invoice-receipt:insert-history */ INSERT INTO dbo.WebInvoiceHistory
        (DocumentId,Revision,OperationId,Action,BeforeJson,AfterJson,Reason,Actor,CreatedAt)
        VALUES (@documentId,@revision,NULL,@action,@beforeJson,@afterJson,@reason,@actor,@now)`, {
        documentId: param(type(types, 'UniqueIdentifier'), targetId), revision: param(type(types, 'Int'), revision),
        action: param(type(types, 'NVarChar', 60), current ? (linked ? 'REVISE_COMMITTED_DOCUMENT' : 'REVISE_DRAFT') : 'CREATE_DRAFT'),
        beforeJson: param(type(types, 'NVarChar', types.MAX), before), afterJson: param(type(types, 'NVarChar', types.MAX), after),
        reason: param(type(types, 'NVarChar', 1000), draft.reason), actor: param(type(types, 'NVarChar', 200), actorName),
        now: param(type(types, 'DateTime2', 3), now),
      });
      return readDocument(queryFn, types, targetId);
    }, { retries: 0 });
  } catch (error) {
    if (duplicateError(error)) throw new InvoiceReceiptDocumentError('INVOICE_BUSINESS_KEY_CONFLICT', 'Farm/invoice/year already exists', 409);
    throw error;
  }
}
