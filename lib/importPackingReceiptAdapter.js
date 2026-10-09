import { assertLegacyChinaReviewed } from './importChinaLegacyReview.js';
import { assertPackingSourceReviewed } from './importPackingSourceReview.js';

const COUNTRY_PRICE_UNIT = Object.freeze({
  CO: '송이', NL: '송이', CN: '단', EC: '송이', TH: '송이',
  AU: '단', US: '박스', VN: '송이',
});

const contract = value => Object.freeze(value);
export const PACKING_RECEIPT_SOURCE_CONTRACTS = Object.freeze({
  CN: contract({ boxFields: ['pcs'], bunchFields: ['total_bunch'], stemFields: ['total_stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'bunchQuantity', conversionQuantityField: 'bunchQuantity' }),
  NL: contract({ boxFields: [], bunchFields: [], stemFields: ['stems'], unitPriceFields: ['price'], lineAmountFields: ['t_price'],
    lineAmountDerivedFrom: ['stems', 'price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity' }),
  CO: contract({ boxFields: ['pcs'], bunchFields: ['total_bunch'], stemFields: ['total_stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity' }),
  EC: contract({ boxFields: [], bunchFields: ['total_bunch'], stemFields: ['total_stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity' }),
  TH: contract({ boxFields: [], bunchFields: ['total_bunch'], stemFields: ['total_stems'], stemDerivedFrom: ['total_bunch', 'bunch_st'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity' }),
  AU: contract({ boxFields: ['pcs'], bunchFields: ['total_bunch'], stemFields: ['total_stems'], stemDerivedFrom: ['total_bunch', 'bunch_st'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'bunchQuantity', conversionQuantityField: 'stemQuantity' }),
  US: contract({ boxFields: ['pcs'], bunchFields: ['total_bunch'], stemFields: ['total_stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'boxQuantity', conversionQuantityField: 'stemQuantity' }),
  VN: contract({ boxFields: [], bunchFields: ['total_bunch'], stemFields: ['total_stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity' }),
});

const text = value => String(value ?? '').normalize('NFC').trim();

export function nullableNumber(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function receiptPartIdForCommit(document, createId) {
  if (typeof createId !== 'function') throw new TypeError('createId is required');
  const committed = (document?.operations || []).filter(operation => operation.status === 'COMMITTED');
  if (!committed.length) return createId();
  const latest = committed.reduce((current, operation) => {
    if (!current || Number(operation.documentRevision) > Number(current.documentRevision)) return operation;
    if (Number(operation.documentRevision) === Number(current.documentRevision)
      && String(operation.createdAt || '') > String(current.createdAt || '')) return operation;
    return current;
  }, null);
  if (!latest?.receiptPartId) throw new Error('기존 입고 식별자가 없어 수정 입고를 시작할 수 없습니다. 문서를 다시 불러오세요.');
  return latest.receiptPartId;
}

export function buildReceiptCommitPending({ document, preview, reason, operationId, receiptPartId }) {
  const documentId = text(document?.documentId);
  const revision = Number(document?.revision);
  const baselineDigest = text(preview?.baselineDigest);
  const cleanReason = text(reason);
  if (!documentId || !Number.isSafeInteger(revision) || !baselineDigest || !cleanReason || !text(operationId) || !text(receiptPartId)) {
    throw new Error('입고 등록 요청 범위를 다시 확인하세요.');
  }
  return {
    documentId,
    operationId: text(operationId),
    receiptPartId: text(receiptPartId),
    requestBody: {
      revision,
      operationId: text(operationId),
      receiptPartId: text(receiptPartId),
      baselineDigest,
      reason: cleanReason,
      allowPendingCost: true,
    },
  };
}

export function isVerifiedReceiptCommitRejection(error) {
  return Number(error?.httpStatus) >= 400 && Number(error?.httpStatus) < 500 && error?.resultUnknown === false;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cryptoApi(override) {
  const api = override || globalThis.crypto;
  if (!api?.subtle) throw new Error('이 브라우저에서는 원본 파일 SHA-256을 계산할 수 없습니다.');
  return api;
}

export async function sha256File(file, cryptoOverride) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('원본 파일을 다시 선택하세요.');
  const digest = await cryptoApi(cryptoOverride).subtle.digest('SHA-256', await file.arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

export async function stableReceiptUuid(parts, cryptoOverride) {
  const seed = (parts || []).map(part => String(part ?? '')).join('\u001f');
  const input = new TextEncoder().encode(seed);
  const digest = new Uint8Array(await cryptoApi(cryptoOverride).subtle.digest('SHA-256', input));
  const bytes = digest.slice(0, 16);
  // UUIDv8 marks a deterministic application-defined UUID without pretending
  // this SHA-256 name hash is RFC v5 (SHA-1).
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseReceiptScopeProposal(fileName) {
  const base = text(fileName).replace(/\.[^.]+$/, '');
  const year = base.match(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/)?.[1] || '';
  const week = base.match(/(?:^|[^0-9])((?:0?[1-9]|[1-4]\d|5[0-3])[-_](?:0?[1-9]|[1-9]\d?))(?=[^0-9]|$)/)?.[1]
    ?.replace('_', '-')
    .split('-')
    .map((part, index) => index === 0 ? String(Number(part)).padStart(2, '0') : String(Number(part)).padStart(2, '0'))
    .join('-') || '';
  return { orderYear: year, orderWeek: week };
}

function sourceLines(invoice) {
  if (Array.isArray(invoice?.products)) return invoice.products;
  if (Array.isArray(invoice?.lines)) return invoice.lines;
  return [];
}

function sourceDescription(line) {
  return text(line?.source_description || line?.description || line?.name);
}

function matchingDescription(line) {
  return text(line?.description || line?.source_description || line?.name);
}

function generatedForSource(generatedProducts, line, index) {
  const identity = matchingDescription(line);
  const original = sourceDescription(line);
  const exact = (generatedProducts || []).filter(product => (
    text(product?.matchingDescription) === identity
    || (text(product?.sourceName) === original && !text(product?.matchingDescription))
  ));
  if (exact.length === 1) return exact[0];
  const exactTargets = new Set(exact.map(product => text(product?.matchedName || product?.name)).filter(Boolean));
  if (exact.length > 1 && exactTargets.size === 1) return exact[0];
  const sameOriginal = (generatedProducts || []).filter(product => text(product?.sourceName) === original);
  if (sameOriginal.length === 1) return sameOriginal[0];
  const sameOriginalTargets = new Set(sameOriginal.map(product => text(product?.matchedName || product?.name)).filter(Boolean));
  if (sameOriginal.length > 1 && sameOriginalTargets.size === 1) return sameOriginal[0];
  return null;
}

export function resolveUniqueProdKey(matchedName, products, country) {
  const name = text(matchedName);
  if (!name) return null;
  const matches = (products || []).filter(product => (
    text(product?.ProdName) === name
    && (!country || !product?.country || product.country === country)
  ));
  if (matches.length !== 1 || matches[0].selectable === false) return null;
  return nullableInteger(matches[0].ProdKey);
}

function sourceCurrency(invoice) {
  const value = text(invoice?.currency).toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

function explicitNumber(object, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object || {}, key)) return nullableNumber(object[key]);
  }
  return null;
}

const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

function explicitField(object, keys = []) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object || {}, key)) continue;
    const rawValue = object[key];
    if (rawValue == null || (typeof rawValue === 'string' && rawValue.trim() === '')) {
      return { field: key, value: null, status: 'BLANK', rawValue: rawValue ?? null };
    }
    const value = nullableNumber(rawValue);
    return value == null
      ? { field: key, value: null, status: 'INVALID', rawValue }
      : { field: key, value, status: 'VALID', rawValue };
  }
  return { field: keys[0] || null, value: null, status: 'ABSENT', rawValue: null };
}

function derivedProduct(line, fields, formula) {
  if (!fields?.length) return { value: null, evidence: null };
  const operands = Object.fromEntries(fields.map(field => [field, explicitNumber(line, field)]));
  if (Object.values(operands).some(value => value == null)) return { value: null, evidence: null };
  const value = Object.values(operands).reduce((product, operand) => product * operand, 1);
  if (!Number.isFinite(value)) return { value: null, evidence: null };
  return { value: round6(value), evidence: { formula, operands } };
}

function sourceLineValues(line, country) {
  const sourceContract = PACKING_RECEIPT_SOURCE_CONTRACTS[country] || contract({
    boxFields: ['pcs'], bunchFields: ['total_bunch'], stemFields: ['total_stems', 'stems'],
    unitPriceFields: ['u_price'], lineAmountFields: ['t_price'], displayQuantityField: 'stemQuantity', conversionQuantityField: 'stemQuantity',
  });
  const box = explicitField(line, sourceContract.boxFields);
  const bunch = explicitField(line, sourceContract.bunchFields);
  const stem = explicitField(line, sourceContract.stemFields);
  const unitPrice = explicitField(line, sourceContract.unitPriceFields);
  const lineAmount = explicitField(line, sourceContract.lineAmountFields);
  const derivedFields = {};
  if (['ABSENT', 'BLANK'].includes(stem.status) && sourceContract.stemDerivedFrom) {
    const derived = derivedProduct(line, sourceContract.stemDerivedFrom, sourceContract.stemDerivedFrom.join(' × '));
    stem.value = derived.value;
    if (derived.evidence) derivedFields.stemQuantity = {
      ...derived.evidence,
      trigger: { field: stem.field, status: stem.status },
    };
  }
  if (['ABSENT', 'BLANK'].includes(lineAmount.status) && sourceContract.lineAmountDerivedFrom) {
    const derived = derivedProduct(line, sourceContract.lineAmountDerivedFrom, sourceContract.lineAmountDerivedFrom.join(' × '));
    lineAmount.value = derived.value;
    if (derived.evidence) derivedFields.lineAmount = {
      ...derived.evidence,
      trigger: { field: lineAmount.field, status: lineAmount.status },
    };
  }
  const fields = { boxQuantity: box, bunchQuantity: bunch, stemQuantity: stem, unitPrice, lineAmount };
  return {
    sourceContract,
    boxQuantity: box.value,
    bunchQuantity: bunch.value,
    stemQuantity: stem.value,
    unitPrice: unitPrice.value,
    lineAmount: lineAmount.value,
    sourceFields: {
      boxQuantity: box.field, bunchQuantity: bunch.field, stemQuantity: stem.field,
      unitPrice: unitPrice.field, lineAmount: lineAmount.field,
    },
    sourceFieldStates: Object.fromEntries(Object.entries(fields).map(([targetField, field]) => [targetField, {
      field: field.field,
      status: field.status,
      rawValue: field.rawValue,
    }])),
    invalidFields: Object.entries(fields)
      .filter(([, field]) => field.status === 'INVALID')
      .map(([targetField, field]) => ({
        targetField,
        sourceField: field.field,
        status: 'INVALID_NUMBER',
        rawValue: field.rawValue,
      })),
    derivedFields,
  };
}

function invoiceDate(invoice) {
  const value = text(invoice?.date);
  if (!value) return null;
  const match = value.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!match) return value;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function packingInvoiceSourceIdentity(invoice, sourceInvoiceIndex) {
  return {
    version: 1,
    sourceInvoiceIndex: Number(sourceInvoiceIndex),
    invoiceNo: text(invoice?.invoice),
    supplier: text(invoice?.supplier),
    invoiceDate: invoiceDate(invoice),
    sourceFormat: text(invoice?.source_format) || null,
    lineCount: sourceLines(invoice).length,
  };
}

function sameSourceIdentity(actual, expected) {
  return Boolean(actual && expected
    && Number(actual.version) === expected.version
    && Number(actual.sourceInvoiceIndex) === expected.sourceInvoiceIndex
    && text(actual.invoiceNo) === expected.invoiceNo
    && text(actual.supplier) === expected.supplier
    && (actual.invoiceDate || null) === expected.invoiceDate
    && (actual.sourceFormat || null) === expected.sourceFormat
    && Number(actual.lineCount) === expected.lineCount);
}

function generatedInvoicesByIndex(excels, invoices) {
  const generated = Array.isArray(excels) ? excels : [];
  const source = Array.isArray(invoices) ? invoices : [];
  const hasDeclaredIdentity = generated.some(excel => excel?.sourceInvoiceIdentity != null);
  if (!hasDeclaredIdentity && generated.length <= 1 && source.length <= 1) return new Map([[0, generated[0] || { products: [] }]]);
  if (generated.length !== source.length) throw new Error('생성된 패킹리스트와 원본 인보이스 수가 다릅니다. 다시 생성하세요.');
  const byIndex = new Map();
  for (const excel of generated) {
    const identity = excel?.sourceInvoiceIdentity;
    const index = Number(identity?.sourceInvoiceIndex);
    if (!Number.isSafeInteger(index) || index < 0 || index >= source.length || byIndex.has(index)) {
      throw new Error('생성된 패킹리스트의 원본 인보이스 번호가 누락되었거나 중복되었습니다. 다시 생성하세요.');
    }
    const expected = packingInvoiceSourceIdentity(source[index], index);
    if (!sameSourceIdentity(identity, expected)) throw new Error('생성된 패킹리스트와 원본 인보이스 식별자가 다릅니다. 다시 생성하세요.');
    byIndex.set(index, excel);
  }
  return byIndex;
}

function sourceIdentityKey(line) {
  const matching = matchingDescription(line);
  const original = sourceDescription(line);
  return JSON.stringify([matching || original, original || matching]);
}

function generatedIdentityKey(product) {
  const matching = text(product?.matchingDescription);
  const original = text(product?.sourceName);
  return JSON.stringify([matching || original, original || matching]);
}

function sumKnown(values) {
  return values.length && values.every(value => value != null && Number.isFinite(value))
    ? round6(values.reduce((sum, value) => sum + value, 0)) : null;
}

function conversionValidationBySource(invoice, generatedProducts, country) {
  const sourceContract = PACKING_RECEIPT_SOURCE_CONTRACTS[country];
  if (!sourceContract) return new Map();
  const sourceGroups = new Map();
  for (const line of sourceLines(invoice)) {
    const key = sourceIdentityKey(line);
    const values = sourceLineValues(line, country);
    const group = sourceGroups.get(key) || [];
    group.push(values[sourceContract.conversionQuantityField]);
    sourceGroups.set(key, group);
  }
  const generatedGroups = new Map();
  for (const product of generatedProducts || []) {
    const key = generatedIdentityKey(product);
    const group = generatedGroups.get(key) || [];
    group.push(nullableNumber(product?.qty));
    generatedGroups.set(key, group);
  }
  return new Map([...sourceGroups].map(([key, values]) => {
    const sourceTotal = sumKnown(values);
    const generatedTotal = sumKnown(generatedGroups.get(key) || []);
    const comparable = sourceTotal != null && generatedTotal != null;
    const mismatch = comparable && Math.abs(sourceTotal - generatedTotal) > 0.000001;
    return [key, {
      quantityField: sourceContract.conversionQuantityField,
      sourceTotal,
      generatedTotal,
      status: !comparable ? 'NOT_COMPARABLE' : mismatch ? 'MISMATCH' : 'MATCH',
      differences: mismatch ? [{ field: sourceContract.conversionQuantityField, sourceValue: sourceTotal, generatedValue: generatedTotal }] : [],
    }];
  }));
}

function reviewedValue(invoice, field, fallbackKeys) {
  const reviewed = invoice?.packingReview?.values;
  if (reviewed && Object.prototype.hasOwnProperty.call(reviewed, field)) return nullableNumber(reviewed[field]);
  return explicitNumber(invoice, ...fallbackKeys);
}

function invoiceYearFromDate(value) {
  const year = text(value).match(/^(20\d{2})/)?.[1];
  return year || '';
}

function rawMetadata(invoice, invoiceIndex) {
  return {
    sourceFormat: text(invoice?.source_format) || null,
    sourceInvoiceIndex: invoiceIndex,
    supplier: text(invoice?.supplier) || null,
    awb: text(invoice?.awb) || null,
    invoiceDate: invoiceDate(invoice),
    currency: sourceCurrency(invoice),
    grossWeight: explicitNumber(invoice, 'gross_weight'),
    chargeableWeight: explicitNumber(invoice, 'vol_weight', 'chargeable_weight'),
    freight: explicitNumber(invoice, 'freight', 'freight_total'),
    handling: explicitNumber(invoice, 'handling'),
    invoiceTotal: explicitNumber(invoice, 'invoice_total', 'total_value'),
    reviewEvidence: invoice?.review_evidence || null,
    rawDate: invoice?.raw_date ?? null,
    dateKind: invoice?.date_kind ?? null,
    extractionIssues: invoice?.extractionIssues || [],
    metadataReview: invoice?.metadataReview || invoice?.packingReview?.metadata || null,
    legacyReview: invoice?.legacyReview || null,
    sourceReview: invoice?.packingReview?.sourceReview || null,
    additionalCosts: invoice?.additional_costs || invoice?.additional_charges || null,
  };
}

export async function adaptPackingReceipts({
  excels = [], invoices = [], country = '', fileName = '', products = [], sourceHash,
  reviewConfirmed = false, truncated = false, cryptoOverride,
} = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(sourceHash || ''))) throw new Error('원본 파일 SHA-256이 필요합니다.');
  for (const invoice of invoices) {
    if (invoice?.pdfReviewRequired || /\.pdf$/i.test(fileName)) {
      if (!reviewConfirmed) throw new Error('원본 PDF와 모든 품목·수량·금액을 확인한 뒤 진행하세요.');
      assertPackingSourceReviewed(invoice, country);
    }
    if (invoice?.source_format === 'china_legacy_invoice_reviewed') assertLegacyChinaReviewed(invoice);
    if (invoice?.source_format === 'china_legacy_invoice_xlsx') {
      throw new Error('중국 구형 인보이스의 수량 단위·통화 검토를 먼저 완료하세요.');
    }
    if (invoice?.extractionIssues?.length) {
      throw new Error('인보이스 날짜·통화·총액 확인을 먼저 완료하세요. 미해결 인식 오류가 있습니다.');
    }
  }
  const proposal = parseReceiptScopeProposal(fileName);
  const countryCode = text(country).toUpperCase();
  const generatedByIndex = generatedInvoicesByIndex(excels, invoices);
  return Promise.all((invoices || []).map(async (invoice, invoiceIndex) => {
    const generatedInvoice = generatedByIndex.get(invoiceIndex) || { products: [] };
    const generatedProducts = generatedInvoice.products || [];
    const sourceIdentity = packingInvoiceSourceIdentity(invoice, invoiceIndex);
    const conversionValidation = conversionValidationBySource(invoice, generatedProducts, countryCode);
    const documentId = await stableReceiptUuid(['invoice-receipt-document', sourceHash, invoiceIndex], cryptoOverride);
    const lines = await Promise.all(sourceLines(invoice).map(async (line, lineIndex) => {
      const generated = generatedForSource(generatedProducts, line, lineIndex);
      const matchName = generated?.unmatched ? '' : text(generated?.matchedName || generated?.name);
      const prodKey = resolveUniqueProdKey(matchName, products, countryCode);
      const sourceValues = sourceLineValues(line, countryCode);
      const conversion = conversionValidation.get(sourceIdentityKey(line)) || null;
      const originalName = sourceDescription(line);
      const sourceRow = nullableInteger(line?.source_row);
      const lineId = await stableReceiptUuid([
        'invoice-receipt-line', sourceHash, invoiceIndex, sourceRow || lineIndex + 1,
        matchingDescription(line), originalName,
      ], cryptoOverride);
      return {
        lineId,
        lineNo: lineIndex + 1,
        originalName,
        lengthText: text(line?.stem_length || line?.length?.raw) || null,
        prodKey,
        boxQuantity: sourceValues.boxQuantity,
        bunchQuantity: sourceValues.bunchQuantity,
        stemQuantity: sourceValues.stemQuantity,
        priceUnit: sourceValues.unitPrice == null ? null : (COUNTRY_PRICE_UNIT[countryCode] || null),
        unitPrice: sourceValues.unitPrice,
        currency: sourceCurrency(invoice),
        lineAmount: sourceValues.lineAmount,
        sourceEvidence: {
          sourceInvoiceIndex: invoiceIndex,
          sourceLineIndex: lineIndex,
          sourceRow,
          sourceFormat: text(line?.source_format || invoice?.source_format) || null,
          matchingDescription: matchingDescription(line),
          generatedMatchedName: matchName || null,
          sourceQuantityField: sourceValues.sourceContract.displayQuantityField,
          sourceFields: sourceValues.sourceFields,
          sourceFieldStates: sourceValues.sourceFieldStates,
          invalidFields: sourceValues.invalidFields,
          derivedFields: sourceValues.derivedFields,
          conversionValidation: conversion,
        },
        reviewed: { confirmed: Boolean(reviewConfirmed && prodKey
          && conversion?.status !== 'MISMATCH' && sourceValues.invalidFields.length === 0) },
      };
    }));
    const date = invoiceDate(invoice);
    const currency = sourceCurrency(invoice);
    const freight = reviewedValue(invoice, 'freight', country === 'CO' ? ['freight_total'] : ['freight']);
    const mixedCharges = ['CO', 'CN'].includes(countryCode)
      || invoice?.chargeScope === 'UNCLASSIFIED_ADDITIONAL_CHARGES';
    return {
      documentId,
      revision: null,
      sourceHash: String(sourceHash).toLowerCase(),
      originalFileName: text(fileName),
      orderYear: proposal.orderYear,
      orderWeek: proposal.orderWeek,
      farmKey: null,
      invoiceNo: text(invoice?.invoice) || '',
      invoiceYear: invoiceYearFromDate(date),
      rawMetadata: { ...rawMetadata(invoice, invoiceIndex), sourceInvoiceIdentity: sourceIdentity },
      reviewedMetadata: {
        inputDate: '', country: countryCode || '', transportMode: '',
        farmName: text(invoice?.supplier), awb: text(invoice?.awb),
        gw: reviewedValue(invoice, 'gw', ['gross_weight']),
        cw: reviewedValue(invoice, 'cw', ['vol_weight', 'chargeable_weight']),
        freightCurrency: currency || '', freightRate: null, docFee: null,
        // CN/CO totals include documents/packaging and other charges.
        // Preserve it for review; do not classify the aggregate as air freight.
        unclassifiedAdditionalCharges: mixedCharges && freight != null
          ? { currency, amount: freight, source: 'invoice', requiresAllocation: true } : null,
        costInputs: !mixedCharges && currency && freight != null
          ? { freight: { currency, amount: freight, source: 'invoice' } } : {},
        invoiceDate: date || '', receiptNotes: '',
      },
      lines,
      receiptStatus: 'DRAFT',
      costStatus: null,
      history: [],
      operations: [],
      sourceWarnings: [
        ...(truncated ? ['원본 분석 결과가 잘려 있어 저장·미리보기를 진행하면 안 됩니다.'] : []),
        ...(!reviewConfirmed ? ['GW·CW·운송비 검토가 아직 확인되지 않았습니다.'] : []),
      ],
    };
  }));
}

function nullableText(value) {
  const valueText = text(value);
  return valueText || null;
}

export function normalizeReceiptDocument(document = {}) {
  return {
    ...document,
    documentId: text(document.documentId),
    revision: Number.isSafeInteger(Number(document.revision)) ? Number(document.revision) : null,
    sourceHash: text(document.sourceHash).toLowerCase(),
    originalFileName: text(document.originalFileName),
    orderYear: text(document.orderYear),
    orderWeek: text(document.orderWeek),
    farmKey: nullableInteger(document.farmKey),
    invoiceNo: document.invoiceNo == null ? '' : String(document.invoiceNo),
    invoiceYear: document.invoiceYear == null ? '' : String(document.invoiceYear),
    rawMetadata: document.rawMetadata || {},
    reviewedMetadata: { ...(document.reviewedMetadata || {}) },
    lines: (document.lines || []).map((line, index) => ({
      ...line,
      lineNo: Number(line.lineNo) || index + 1,
      prodKey: nullableInteger(line.prodKey),
      boxQuantity: nullableNumber(line.boxQuantity),
      bunchQuantity: nullableNumber(line.bunchQuantity),
      stemQuantity: nullableNumber(line.stemQuantity),
      unitPrice: nullableNumber(line.unitPrice),
      lineAmount: nullableNumber(line.lineAmount),
    })),
    history: Array.isArray(document.history) ? document.history : [],
    operations: Array.isArray(document.operations) ? document.operations : [],
  };
}

export function toReceiptDraftPayload(document, reason = '인보이스 입고 초안 저장') {
  const normalized = normalizeReceiptDocument(document);
  const reviewedMetadata = normalized.reviewedMetadata || {};
  const freightCurrency = text(reviewedMetadata.freightCurrency).toUpperCase();
  const costInputs = Object.fromEntries(Object.entries(reviewedMetadata.costInputs || {}).map(([key, value]) => [key, {
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    currency: text(value?.currency || freightCurrency).toUpperCase() || null,
    amount: nullableNumber(value?.amount),
  }]));
  return {
    documentId: normalized.documentId,
    ...(normalized.revision == null ? {} : { expectedRevision: normalized.revision }),
    ...(normalized.rowVersion ? { expectedRowVersion: normalized.rowVersion } : {}),
    orderYear: nullableText(normalized.orderYear),
    orderWeek: nullableText(normalized.orderWeek),
    sourceHash: normalized.sourceHash,
    originalFileName: normalized.originalFileName,
    farmKey: normalized.farmKey,
    invoiceNo: nullableText(normalized.invoiceNo),
    invoiceYear: nullableText(normalized.invoiceYear),
    rawMetadata: normalized.rawMetadata,
    reviewedMetadata: {
      ...reviewedMetadata,
      freightCurrency,
      gw: nullableNumber(reviewedMetadata.gw),
      cw: nullableNumber(reviewedMetadata.cw),
      freightRate: freightCurrency === 'USD' ? nullableNumber(reviewedMetadata.freightRate) : null,
      docFee: freightCurrency === 'USD' ? nullableNumber(reviewedMetadata.docFee) : null,
      costInputs,
    },
    reason: text(reason) || '인보이스 입고 초안 저장',
    lines: normalized.lines.map(line => ({
      lineId: line.lineId,
      lineNo: line.lineNo,
      originalName: line.originalName,
      lengthText: nullableText(line.lengthText),
      prodKey: line.prodKey,
      boxQuantity: line.boxQuantity,
      bunchQuantity: line.bunchQuantity,
      stemQuantity: line.stemQuantity,
      priceUnit: nullableText(line.priceUnit),
      unitPrice: line.unitPrice,
      currency: nullableText(line.currency),
      lineAmount: line.lineAmount,
      sourceEvidence: line.sourceEvidence || {},
      reviewed: line.reviewed && typeof line.reviewed === 'object' && !Array.isArray(line.reviewed)
        ? line.reviewed : { confirmed: Boolean(line.reviewed) },
    })),
  };
}

export function receiptLineQuantity(line, country) {
  const field = PACKING_RECEIPT_SOURCE_CONTRACTS[text(country).toUpperCase()]?.displayQuantityField || 'stemQuantity';
  return nullableNumber(line?.[field]);
}
