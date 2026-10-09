// Browser/file-only review. No ERP, network, inferred currency or unit conversion.
import {
  normalizeCurrency,
  normalizeDateKind,
  normalizePackingDate,
  normalizePackingMetadata,
  PACKING_DATE_KIND_CONTRACT,
} from './importPackingMetadata.js';

const FIELDS = ['gw', 'cw', 'freight'];
const METADATA_FIELDS = ['date', 'date_kind', 'currency', 'invoice_total'];
const METADATA_LABELS = { date: '인보이스 날짜', date_kind: '날짜 의미', currency: 'ISO 통화', invoice_total: '인보이스 총액' };
export function reviewNumber(value, { weight = false } = {}) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('숫자를 입력하세요.');
  const text = String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(text)) throw new Error('숫자 형식을 확인하세요.');
  const number = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(number) || Math.abs(number) > 1e12 || (weight && number < 0)) throw new Error('수치 범위를 확인하세요. 중량은 음수일 수 없습니다.');
  return number;
}
const sourceField = (field, country) => field === 'gw' ? 'gross_weight' : field === 'cw' ? 'vol_weight' : country === 'CO' ? 'freight_total' : 'freight';
const metadataIssueField = item => {
  const code = String(item?.code || '').toUpperCase();
  const field = String(item?.field || '').toLowerCase();
  if (code.startsWith('DATE_KIND_') || field === 'date_kind') return 'date_kind';
  if (code.startsWith('DATE_') || ['date', 'raw_date', 'date_order'].includes(field)) return 'date';
  if (code.startsWith('CURRENCY_') || field === 'currency') return 'currency';
  if (code.startsWith('INVOICE_TOTAL_') || code.startsWith('AMOUNT_COMPONENTS_')
    || code.startsWith('INVOICE_EXTRAS_') || ['invoice_total', 'total_value', 'freight_total'].includes(field)) return 'invoice_total';
  return null;
};

function metadataValue(invoice, field) {
  if (field === 'date') return invoice.date == null ? '' : String(invoice.date);
  if (field === 'date_kind') return normalizeDateKind(invoice.date_kind) || (invoice.date_kind == null ? '' : String(invoice.date_kind));
  if (field === 'currency') {
    const raw = invoice.currency;
    return normalizeCurrency(raw) || (typeof raw === 'string' ? raw : String(raw?.code ?? ''));
  }
  const raw = Object.prototype.hasOwnProperty.call(invoice, 'invoice_total') ? invoice.invoice_total : invoice.total_value;
  return raw == null ? '' : String(raw);
}

function dateInputValue(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(raw)) return raw;
  const normalized = normalizePackingDate(raw, { dateOrder: 'YMD' });
  return normalized ? normalized.replaceAll('/', '-') : raw;
}

function manualMetadataValue(field, value) {
  const raw = String(value ?? '').trim();
  if (field === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('날짜는 연도까지 포함한 YYYY-MM-DD 형식으로 입력하세요.');
    const normalized = normalizePackingDate(raw, { dateOrder: 'YMD' });
    if (!normalized) throw new Error('실제로 존재하는 날짜를 입력하세요.');
    return normalized;
  }
  if (field === 'date_kind') {
    const normalized = normalizeDateKind(raw);
    if (!normalized || !['invoice', 'arrival', 'shipment'].includes(normalized)) throw new Error('날짜 의미를 인보이스·도착·출고 중에서 선택하세요.');
    return normalized;
  }
  if (field === 'currency') {
    const normalized = normalizeCurrency(raw);
    if (!normalized) throw new Error('원문에서 확인한 ISO 4217 3문자 통화를 입력하세요.');
    return normalized;
  }
  const amount = reviewNumber(raw);
  if (amount === null) throw new Error('원문에서 확인한 인보이스 총액을 입력하세요.');
  return amount;
}

function sameMetadataValue(field, left, right) {
  if (field === 'date') {
    try { return manualMetadataValue(field, left) === manualMetadataValue(field, right); } catch { return String(left ?? '').trim() === String(right ?? '').trim(); }
  }
  if (field === 'date_kind') return (normalizeDateKind(left) || String(left ?? '').trim()) === (normalizeDateKind(right) || String(right ?? '').trim());
  if (field === 'currency') return (normalizeCurrency(left) || String(left ?? '').trim()) === (normalizeCurrency(right) || String(right ?? '').trim());
  try { return reviewNumber(left) === reviewNumber(right); } catch { return String(left ?? '').trim() === String(right ?? '').trim(); }
}

function recomputeGrandTotal(invoice, country) {
  const rows = country === 'NL' ? invoice.lines : invoice.products;
  if (!Array.isArray(rows) || !rows.length) return null;
  let goods = 0;
  for (const row of rows) {
    let amount = reviewNumber(row?.t_price);
    if (amount === null && country === 'NL') {
      const stems = reviewNumber(row?.stems), price = reviewNumber(row?.price);
      if (stems !== null && price !== null) amount = stems * price;
    }
    if (amount === null) return null;
    goods += amount;
  }
  let extras = 0;
  if (country === 'CO') extras = reviewNumber(invoice.freight_total);
  else if (country === 'CN') extras = reviewNumber(invoice.freight);
  else if (country === 'NL') {
    const freight = reviewNumber(invoice.freight), handling = reviewNumber(invoice.handling);
    extras = freight === null || handling === null ? null : freight + handling;
  }
  if (extras === null) return null;
  return goods + extras;
}

function metadataState(invoice, country) {
  const enabled = Array.isArray(invoice.extractionIssues);
  const original = Object.fromEntries(METADATA_FIELDS.map(field => [field, metadataValue(invoice, field)]));
  const rawValues = {
    date: invoice.date ?? null,
    date_kind: invoice.date_kind ?? null,
    currency: invoice.currency ?? null,
    invoice_total: Object.prototype.hasOwnProperty.call(invoice, 'invoice_total') ? invoice.invoice_total : invoice.total_value ?? null,
  };
  const issues = enabled ? invoice.extractionIssues.map(item => ({ ...item })) : [];
  const evidence = invoice.metadata_evidence && typeof invoice.metadata_evidence === 'object'
    ? JSON.parse(JSON.stringify(invoice.metadata_evidence)) : {};
  const issueFields = issues.map(metadataIssueField).filter(Boolean);
  return {
    enabled,
    original,
    rawValues,
    values: { ...original, date: dateInputValue(original.date) },
    issues,
    issueFields: [...new Set(issueFields)],
    confirmed: Object.fromEntries(METADATA_FIELDS.map(field => [field, false])),
    reasons: Object.fromEntries(METADATA_FIELDS.map(field => [field, ''])),
    evidence,
    rawDate: invoice.raw_date ?? null,
    requiredDateKind: PACKING_DATE_KIND_CONTRACT[country] || null,
  };
}

function validateMetadataDraft(invoice, draft, country) {
  if (!Array.isArray(invoice.extractionIssues)) return null;
  const source = metadataState(invoice, country);
  const values = draft?.metadata?.values || {};
  const confirmed = draft?.metadata?.confirmed || {};
  const reasons = draft?.metadata?.reasons || {};
  const confirmedFields = new Set();
  const candidate = { ...invoice };

  for (const field of METADATA_FIELDS) {
    const required = source.issueFields.includes(field)
      || !sameMetadataValue(field, values[field], source.values[field]);
    if (!required) continue;
    const normalized = manualMetadataValue(field, values[field]);
    if (confirmed[field] !== true) throw new Error(`${METADATA_LABELS[field]} 항목을 각각 확인 체크하세요.`);
    const reason = String(reasons[field] ?? '').trim();
    if (!reason) throw new Error(`${METADATA_LABELS[field]} 확인 사유를 입력하세요.`);
    if (reason.length > 1000) throw new Error(`${METADATA_LABELS[field]} 사유는 1,000자 이내로 입력하세요.`);
    confirmedFields.add(field);
    if (field === 'date') candidate.date = normalized;
    else if (field === 'date_kind') candidate.date_kind = normalized;
    else if (field === 'currency') candidate.currency = normalized;
    else candidate.invoice_total = normalized;
  }

  const recomputed = normalizePackingMetadata({ ...candidate, extractionIssues: [] }, country);
  const amountNeedsRecalculation = source.issueFields.includes('invoice_total') || confirmedFields.has('invoice_total');
  if (amountNeedsRecalculation) {
    const expected = recomputeGrandTotal(candidate, country);
    const total = reviewNumber(candidate.invoice_total);
    if (expected === null || total === null || Math.abs(expected - total) > 0.01) {
      throw new Error('상품 금액과 상품 외 비용을 모두 확인해 총액을 다시 검산해야 합니다.');
    }
  }
  const remaining = [];
  const seen = new Set();
  const recomputedKeys = new Set((recomputed.extractionIssues || []).map(item => `${item?.code ?? ''}|${item?.field ?? ''}`));
  const add = item => {
    const key = `${item?.code ?? ''}|${item?.field ?? ''}`;
    if (!seen.has(key)) { remaining.push({ ...item }); seen.add(key); }
  };
  for (const item of source.issues) {
    const field = metadataIssueField(item);
    const code = String(item?.code || '').toUpperCase();
    const knownFinancialIssue = ['INVOICE_EXTRAS_UNAVAILABLE', 'AMOUNT_COMPONENTS_UNAVAILABLE'].includes(code);
    if (knownFinancialIssue) {
      const key = `${item?.code ?? ''}|${item?.field ?? ''}`;
      if (recomputedKeys.has(key) || !confirmedFields.has('invoice_total')) add(item);
      continue;
    }
    if (field && confirmedFields.has(field)) continue;
    add(item);
  }
  for (const item of recomputed.extractionIssues || []) {
    const field = metadataIssueField(item);
    // A manually confirmed full date supersedes ambiguity/conflict in raw date
    // parsing, but the raw_date and metadata_evidence remain unchanged.
    if (field === 'date' && confirmedFields.has('date')) continue;
    add(item);
  }
  if (remaining.length) {
    const amountIssue = remaining.some(item => metadataIssueField(item) === 'invoice_total');
    throw new Error(amountIssue
      ? '상품 금액과 확인한 상품 외 비용을 다시 계산해도 총액 문제가 남습니다. 총액을 확인하거나 금액 원문을 다시 검토하세요.'
      : '미해결 원문 추출 문제가 있습니다. 해당 항목을 각각 확인한 뒤 다시 적용하세요.');
  }

  return {
    invoice: { ...candidate, extractionIssues: remaining },
    confirmedFields,
    audit: {
      original: source.original,
      rawValues: source.rawValues,
      values: Object.fromEntries(METADATA_FIELDS.map(field => [field, metadataValue(candidate, field)])),
      confirmations: Object.fromEntries(METADATA_FIELDS.map(field => [field, confirmedFields.has(field)])),
      reasons: Object.fromEntries([...confirmedFields].map(field => [field, String(reasons[field]).trim()])),
      issuesBefore: source.issues,
      evidence: source.evidence,
      rawDate: source.rawDate,
      issuesAfter: remaining,
    },
  };
}

function sourceValue(invoice, field, country) {
  const key = sourceField(field, country);
  const proof = invoice.review_evidence?.[key];
  // A document grand total is not evidence of a freight charge (including zero).
  // Keep the original quote visible, but require manual input instead of guessing.
  if (field === 'freight' && proof && /(?:grand\s*total|totall?\s*(?:us\$|usd)|총액|총\s*금액)/i.test(String(proof.quote || ''))
    && !/(?:freight|shipping|transport|운송|운임)/i.test(String(proof.quote || ''))) return null;
  const raw = proof && Object.prototype.hasOwnProperty.call(proof, 'value') ? proof.value : invoice[key];
  try { return reviewNumber(raw, { weight: field !== 'freight' }); } catch { return null; }
}
export function makePackingReviewRows(invoices, country) {
  return invoices.map((invoice, invoiceIndex) => {
    const original = {}, values = {}, evidence = {};
    for (const field of FIELDS) {
      const key = sourceField(field, country), proof = invoice.review_evidence?.[key];
      original[field] = sourceValue(invoice, field, country);
      evidence[field] = proof && typeof proof === 'object' ? { ...proof } : {};
      const unit = String(evidence[field].unit || '').trim();
      const unsupportedWeight = field !== 'freight' && unit && !/^(kg|kgs|kilograms?|킬로그램)$/i.test(unit);
      values[field] = unsupportedWeight || original[field] === null ? '' : String(original[field]);
    }
    return { invoiceIndex, label: `${invoice.supplier || ''} · ${invoice.invoice || `인보이스 ${invoiceIndex + 1}`}`,
      original, values, evidence, currency: typeof invoice.currency === 'string' && invoice.currency.trim() ? invoice.currency.trim() : '통화 미확인',
      metadata: metadataState(invoice, country),
      freightLabel: country === 'CN' || country === 'CO' ? '운송·부대비 합계' : '운송비',
      explanation: country === 'CN' || country === 'CO' ? '기존 양식의 운송비 항목은 운송 외 부대비를 포함합니다. 원본 비용 내역을 함께 확인하세요.' : country === 'NL' ? 'Handling은 별도 원본값을 유지합니다.' : '기존 국가별 양식에서 지원하지 않는 항목은 별도 확인 시트에만 기록됩니다.',
      confirmed: false, reason: '',
    };
  });
}
export function applyPackingReview(invoices, drafts, country, now = new Date().toISOString()) {
  if (!Array.isArray(drafts) || drafts.length !== invoices.length) throw new Error('인보이스 목록이 변경되었습니다. 다시 확인하세요.');
  const sourceRows = makePackingReviewRows(invoices, country);
  return invoices.map((invoice, index) => {
    const draft = drafts[index], source = sourceRows[index];
    if (draft?.invoiceIndex !== index || draft.confirmed !== true) throw new Error('모든 인보이스의 인식값·미확인 항목을 확인 체크하세요.');
    const values = Object.fromEntries(FIELDS.map(field => [field, reviewNumber(draft.values?.[field], { weight: field !== 'freight' })]));
    const changed = FIELDS.some(field => values[field] !== source.original[field]);
    const reason = String(draft.reason || '').trim();
    if (changed && !reason) throw new Error('직접 입력·수정한 이유를 입력하세요.');
    if (reason.length > 1000) throw new Error('수정 사유는 1,000자 이내로 입력하세요.');
    let next = { ...invoice, gross_weight: values.gw, vol_weight: values.cw, [sourceField('freight', country)]: values.freight };
    // Explicit unknown CW must not fall back to net weight in the legacy NL writer.
    if (country === 'NL') next.net_weight = null;
    if (country === 'CN' && ['china_invoice_xlsx', 'china_legacy_invoice_reviewed'].includes(invoice.source_format)) {
      const costs = (invoice.additional_costs || []).filter(cost => !cost.reviewAdjustment).map(cost => ({ ...cost }));
      if (costs.some(cost => reviewNumber(cost.amount) === null)) throw new Error('중국 Excel의 원본 부대비 금액이 미확인입니다. 금액을 추정하거나 0으로 처리할 수 없습니다.');
      const total = costs.reduce((sum, cost) => sum + reviewNumber(cost.amount), 0);
      if (values.freight === null) throw new Error('중국 Excel의 부대비 합계는 확인 후 숫자를 입력하세요.');
      const difference = Math.round((values.freight - total) * 1e8) / 1e8;
      if (difference) costs.push({ description: '확인창 부대비 조정', quantity: 1, unit_price: difference, amount: difference, reviewAdjustment: true });
      next.additional_costs = costs;
    }
    const metadataReview = validateMetadataDraft(next, draft, country);
    if (metadataReview) next = metadataReview.invoice;
    next.packingReview = { original: source.original, values, reason, confirmedAt: now,
      currency: source.currency, label: source.freightLabel, evidence: source.evidence,
    };
    if (metadataReview) next.metadataReview = metadataReview.audit;
    return next;
  });
}
export function packingReviewWriter(XLSX, invoice, fileName) {
  const review = invoice.packingReview;
  if (!review) return XLSX;
  return { ...XLSX, write(workbook, options) {
  const rows = [['인식값 확인 · ERP DB 저장 아님'], ['파일', String(fileName || '')], ['인보이스', String(invoice.invoice || '')],
    ['항목', '원본 인식값', '최종 확인값', '확인 단위', '원문 페이지', '원문 근거', '원본 단위'],
    ...FIELDS.map(field => [field === 'gw' ? 'GW' : field === 'cw' ? 'CW' : review.label,
      review.original[field] ?? '미확인', review.values[field] ?? '미확인', field === 'freight' ? review.currency : 'kg',
      review.evidence[field]?.page ?? '', String(review.evidence[field]?.quote || ''), String(review.evidence[field]?.unit || '단위 미확인')]),
    ['수정 사유', review.reason], ['확인 시각', review.confirmedAt],
    ['주의', '기존 국가별 양식이 지원하지 않는 값은 이 확인 시트에만 기록됩니다. ERP 입고 자동 저장이 아닙니다.']];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 25 }, { wch: 26 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 65 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, sheet, '인식값 확인', true);
  return XLSX.write(workbook, options);
  } };
}
