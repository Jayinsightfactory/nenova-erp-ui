// Local source-PDF row review. This module never calls a server or converts units.

const COUNTRY_SCHEMAS = Object.freeze({
  NL: {
    rowsKey: 'lines', fields: ['stems', 'price'], optionalFields: ['t_price', 'amount'],
    semantics: { stems: 'stems (printed)', price: 'source unit price per stem', t_price: 'printed line amount', amount: 'printed line amount' },
  },
  CN: {
    rowsKey: 'products',
    semantics: { pcs: 'boxes (printed)', total_bunch: 'bunches (printed)', total_stems: 'stems (printed)',
      raw_qty: 'raw quantity; inspect source_unit_spec', bunch_st: 'stems per bunch (printed)',
      u_price: 'source unit price; no conversion', unitPrice: 'source unit price; no conversion',
      t_price: 'printed line amount', amount: 'printed line amount' },
  },
  CO: {
    rowsKey: 'products', fields: ['pcs', 'total_bunch', 'total_stems', 'u_price', 't_price'], optionalFields: ['bunch_st'],
    semantics: { pcs: 'boxes', total_bunch: 'bunches', total_stems: 'stems', bunch_st: 'stems per bunch (printed)', u_price: 'source unit price per stem', t_price: 'printed line amount' },
  },
  EC: {
    rowsKey: 'products', fields: ['total_stems', 'u_price', 't_price'], optionalFields: ['pcs', 'total_bunch', 'bunch_st'],
    semantics: { pcs: 'boxes', total_bunch: 'bunches', total_stems: 'stems', bunch_st: 'stems per bunch (printed)', u_price: 'source unit price per stem', t_price: 'printed line amount' },
  },
  TH: {
    rowsKey: 'products', fields: ['bunch_st', 'total_bunch', 'total_stems', 'u_price', 't_price'], optionalFields: ['pcs'],
    semantics: { pcs: 'boxes (if printed)', bunch_st: 'native source quantity/unit; no conversion', total_bunch: 'native source quantity/unit; no conversion', total_stems: 'native source quantity/unit; no conversion', u_price: 'source unit price in the native printed unit; no conversion', t_price: 'printed line amount' },
  },
  AU: {
    rowsKey: 'products', fields: ['pcs', 'bunch_st', 'total_bunch', 'total_stems', 'u_price', 't_price'],
    semantics: { pcs: 'boxes', bunch_st: 'stems per bunch (printed)', total_bunch: 'bunches', total_stems: 'stems (only if present)', u_price: 'source unit price per bunch', t_price: 'printed line amount' },
  },
  US: {
    rowsKey: 'products', fields: ['pcs', 'total_stems', 'u_price', 't_price'], optionalFields: ['total_bunch', 'bunch_st'],
    semantics: { pcs: 'boxes', total_bunch: 'bunches (if printed)', bunch_st: 'stems per bunch (if printed)', total_stems: 'stems', u_price: 'source unit price per box', t_price: 'printed line amount' },
  },
  VN: {
    rowsKey: 'products', fields: ['total_stems', 'u_price', 't_price'], optionalFields: ['total_bunch', 'pcs'],
    semantics: { pcs: 'boxes (if printed)', total_bunch: 'bunches (if printed)', total_stems: 'stems', u_price: 'source unit price per stem', t_price: 'printed line amount' },
  },
});

const OPTIONAL_NUMERIC_FIELDS = new Set(['pcs', 'total_bunch', 'total_stems', 'stems', 'raw_qty', 'bunch_st', 'u_price', 'unitPrice', 'price', 't_price', 'amount']);

function schemaFor(invoice, country) {
  const normalizedCountry = String(country || '').toUpperCase();
  const schema = COUNTRY_SCHEMAS[normalizedCountry];
  if (!schema) throw new Error(`상품 원문 검토에서 지원하지 않는 국가입니다: ${country || '미확인'}`);
  const fields = schema.fields ? [...schema.fields] : invoice.source_format === 'china_legacy_invoice_reviewed'
    ? ['raw_qty', 'unitPrice', 't_price']
    : ['pcs', 'total_bunch', 'total_stems', 'bunch_st', 'u_price', 't_price'];
  for (const field of schema.optionalFields || []) {
    if ((invoice[schema.rowsKey] || []).some(row => Object.prototype.hasOwnProperty.call(row || {}, field))) fields.push(field);
  }
  if (normalizedCountry === 'CN' && invoice.source_format !== 'china_legacy_invoice_reviewed') {
    for (const field of ['raw_qty', 'unitPrice', 'amount']) {
      if ((invoice.products || []).some(row => Object.prototype.hasOwnProperty.call(row || {}, field))) fields.push(field);
    }
  }
  return { ...schema, fields: [...new Set(fields)] };
}

function canonical(value) {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function canonicalString(value) {
  return JSON.stringify(canonical(value));
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function snapshotFor(invoice, schema, country) {
  return {
    country: String(country || '').toUpperCase(),
    rowsKey: schema.rowsKey,
    invoice: invoice.invoice ?? null,
    invoiceYear: invoice.invoice_year ?? invoice.year ?? null,
    rawDate: invoice.raw_date ?? null,
    sourceFormat: invoice.source_format ?? null,
    sourceSheet: invoice.source_sheet ?? null,
    rows: invoice[schema.rowsKey],
  };
}

function sourceMetadata(invoice) {
  return {
    date: invoice.date ?? null,
    date_kind: invoice.date_kind ?? null,
    currency: invoice.currency ?? null,
    invoice_total: Object.prototype.hasOwnProperty.call(invoice, 'invoice_total') ? invoice.invoice_total : invoice.total_value ?? null,
  };
}

function sourceRows(invoice, schema) {
  const rows = invoice[schema.rowsKey];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('원문에서 대조할 상품행이 없습니다. PDF 상품행 검토를 완료할 수 없습니다.');
  return rows;
}

function rowEvidence(line) {
  return line.source_cells ?? line.review_evidence ?? line.evidence ?? {};
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function numericValue(value, field) {
  if (isBlank(value)) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${field} 숫자 형식을 확인하세요.`);
  const text = String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(text)) throw new Error(`${field} 숫자 형식을 확인하세요.`);
  const number = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw new Error(`${field} 숫자 범위를 확인하세요.`);
  if (['pcs', 'total_bunch', 'total_stems', 'stems', 'raw_qty', 'bunch_st'].includes(field) && number < 0) {
    throw new Error(`${field} 수량은 음수일 수 없습니다.`);
  }
  return number;
}

function fieldValue(line, field) {
  if (Object.prototype.hasOwnProperty.call(line, field)) return line[field];
  return '';
}

function lineSnapshotId(lineIndex, line) {
  return canonicalString({ lineIndex, line });
}

function sourceReviewError(message) {
  throw new Error(`상품 원문 검토: ${message}`);
}

/** Build an editable, source-native PDF row review draft. Preserve raw null/blank/zero distinctions. */
export function makePackingSourceReview(invoice, country) {
  const schema = schemaFor(invoice || {}, country);
  const lines = sourceRows(invoice || {}, schema);
  const snapshot = snapshotFor(invoice, schema, country);
  const numericFields = schema.fields.filter(field => OPTIONAL_NUMERIC_FIELDS.has(field));
  const rows = lines.map((line, lineIndex) => {
    const values = { description: fieldValue(line, 'description') };
    const originalValues = { description: fieldValue(line, 'description') };
    for (const field of schema.fields) {
      values[field] = fieldValue(line, field);
      if (Object.prototype.hasOwnProperty.call(line, field)) originalValues[field] = line[field];
    }
    const unitSemantics = Object.fromEntries(schema.fields.map(field => [field,
      field === 'raw_qty' && line.source_unit_spec ? `원문 수량 (${line.source_unit_spec})` : schema.semantics?.[field] || '원문 숫자·단위 그대로 (환산하지 않음)',
    ]));
    return {
      lineIndex,
      description: values.description,
      values,
      originalValues,
      evidence: rowEvidence(line),
      unitSemantics,
      numericFields,
      confirmed: false,
      reason: '',
      sourceSnapshotId: lineSnapshotId(lineIndex, line),
    };
  });
  return {
    required: true,
    country: String(country || '').toUpperCase(),
    rowsKey: schema.rowsKey,
    sourceFormat: invoice.source_format ?? null,
    sourceMetadata: cloneValue(sourceMetadata(invoice)),
    sourceSnapshot: cloneValue(snapshot),
    sourceSnapshotId: canonicalString(snapshot),
    rows,
    pdf: { rendered: false, page: null },
  };
}

function comparableValue(field, value) {
  if (field === 'description') return String(value ?? '');
  if (isBlank(value)) return '';
  try { return numericValue(value, field); } catch { return `invalid:${String(value)}`; }
}

function validateDraft(invoice, draft, country, schema, base) {
  if (!draft || draft.required !== true) sourceReviewError('필수 PDF 검토 초안이 없습니다.');
  if (draft.country !== String(country || '').toUpperCase() || draft.rowsKey !== schema.rowsKey
    || draft.sourceSnapshotId !== base.sourceSnapshotId) sourceReviewError('원문 인보이스/상품행 스냅샷이 변경되었습니다. 다시 검토하세요.');
  if (!Array.isArray(draft.rows) || draft.rows.length !== base.rows.length) sourceReviewError('상품행 목록이 변경되었습니다. 다시 검토하세요.');
  if (draft.pdf?.rendered !== true || !Number.isInteger(draft.pdf?.page) || draft.pdf.page < 1) {
    sourceReviewError('원본 PDF 페이지 렌더가 성공하고 확인된 뒤 적용할 수 있습니다.');
  }
  const numericFields = schema.fields.filter(field => OPTIONAL_NUMERIC_FIELDS.has(field));
  const updates = [];
  for (let index = 0; index < base.rows.length; index++) {
    const original = base.rows[index];
    const row = draft.rows[index];
    if (row?.lineIndex !== index || row.sourceSnapshotId !== original.sourceSnapshotId) sourceReviewError(`상품행 ${index + 1}의 순서 또는 원문 스냅샷이 달라졌습니다.`);
    if (row.confirmed !== true) sourceReviewError(`상품행 ${index + 1}을 개별 확인해야 합니다.`);
    const values = row.values && typeof row.values === 'object' ? row.values : {};
    const editableKeys = ['description', ...schema.fields];
    if (Object.keys(values).some(key => !editableKeys.includes(key))) sourceReviewError(`상품행 ${index + 1}에 지원하지 않는 필드가 있습니다.`);
    const finalValues = {};
    let changed = false;
    for (const field of editableKeys) {
      const value = field === 'description' && row.description !== original.description
        ? row.description
        : Object.prototype.hasOwnProperty.call(values, field) ? values[field] : original.values[field];
      if (field === 'description') {
        if (typeof value !== 'string' || !value.trim() || value.length > 2000) sourceReviewError(`상품행 ${index + 1}의 품목 설명을 확인하세요.`);
      } else if (numericFields.includes(field)) {
        finalValues[field] = numericValue(value, field);
      }
      const before = comparableValue(field, original.values[field]);
      const after = comparableValue(field, value);
      if (before !== after) changed = true;
      finalValues[field] = value;
    }
    const reason = String(row.reason ?? '').trim();
    if (changed && !reason) sourceReviewError(`수정한 상품행 ${index + 1}의 사유를 입력하세요.`);
    if (reason.length > 1000) sourceReviewError(`상품행 ${index + 1} 사유는 1,000자 이내로 입력하세요.`);
    updates.push({ row, original, finalValues, reason, changed });
  }
  return updates;
}

/** Apply a confirmed source-PDF row draft and attach a snapshot-bound audit. */
export function applyPackingSourceReview(invoice, draft, country, now = new Date().toISOString()) {
  const sourceInvoice = invoice && typeof invoice === 'object' ? invoice : {};
  const schema = schemaFor(sourceInvoice, country);
  const lines = sourceRows(sourceInvoice, schema);
  const base = makePackingSourceReview(sourceInvoice, country);
  const updates = validateDraft(sourceInvoice, draft, country, schema, base);
  const numericFields = schema.fields.filter(field => OPTIONAL_NUMERIC_FIELDS.has(field));
  const correctedRows = lines.map((line, index) => {
    const update = updates[index];
    const next = { ...line };
    for (const field of ['description', ...schema.fields]) {
      const finalValue = update.finalValues[field];
      if (comparableValue(field, line[field]) === comparableValue(field, finalValue)) continue;
      if (field === 'description') next.description = finalValue;
      else if (numericFields.includes(field)) next[field] = finalValue === '' ? '' : numericValue(finalValue, field);
    }
    return next;
  });
  const corrected = { ...sourceInvoice, [schema.rowsKey]: correctedRows };
  const appliedSnapshot = snapshotFor(corrected, schema, country);
  const audit = {
    required: true,
    country: base.country,
    rowsKey: schema.rowsKey,
    sourceFormat: base.sourceFormat,
    sourceMetadata: base.sourceMetadata,
    confirmedAt: now,
    pdf: { rendered: true, page: draft.pdf.page },
    sourceSnapshotId: base.sourceSnapshotId,
    sourceSnapshot: base.sourceSnapshot,
    appliedSnapshotId: canonicalString(appliedSnapshot),
    rows: updates.map(({ row, original, finalValues, reason }) => ({
      lineIndex: row.lineIndex,
      sourceSnapshotId: original.sourceSnapshotId,
      appliedSnapshotId: lineSnapshotId(row.lineIndex, correctedRows[row.lineIndex]),
      originalValues: original.originalValues,
      values: finalValues,
      evidence: cloneValue(original.evidence),
      unitSemantics: original.unitSemantics,
      confirmed: true,
      reason,
    })),
  };
  corrected.packingReview = {
    ...(sourceInvoice.packingReview || {}),
    sourceReview: audit,
  };
  return corrected;
}

/** Block downstream generation if PDF render, row confirmations, or current-row snapshot drifted. */
export function assertPackingSourceReviewed(invoice, country) {
  if (Array.isArray(invoice?.extractionIssues) && invoice.extractionIssues.length) {
    sourceReviewError('날짜·통화·총액 확인 등 미해결 추출 문제를 먼저 해결해야 합니다.');
  }
  const schema = schemaFor(invoice || {}, country);
  const lines = sourceRows(invoice || {}, schema);
  const audit = invoice?.packingReview?.sourceReview;
  if (!audit || audit.required !== true || audit.country !== String(country || '').toUpperCase()
    || audit.rowsKey !== schema.rowsKey || !audit.sourceSnapshotId || !audit.confirmedAt) {
    sourceReviewError('확인 기록이 없거나 국가/인보이스 검토 정보가 일치하지 않습니다.');
  }
  if (audit.pdf?.rendered !== true || !Number.isInteger(audit.pdf?.page) || audit.pdf.page < 1) {
    sourceReviewError('PDF 렌더 성공 기록이 없습니다.');
  }
  if (!Array.isArray(audit.rows) || audit.rows.length !== lines.length || lines.length === 0) {
    sourceReviewError('확인된 원문 상품행 수와 현재 상품행 수가 다릅니다.');
  }
  const currentSnapshot = snapshotFor(invoice, schema, country);
  if (audit.appliedSnapshotId !== canonicalString(currentSnapshot)) sourceReviewError('확인 이후 상품행/인보이스 스냅샷이 변경되었습니다. 다시 검토하세요.');
  for (let index = 0; index < lines.length; index++) {
    const row = audit.rows[index];
    if (row.lineIndex !== index || row.confirmed !== true
      || row.appliedSnapshotId !== lineSnapshotId(index, lines[index])) {
      sourceReviewError(`상품행 ${index + 1} 확인 기록이 현재 원문 행과 일치하지 않습니다.`);
    }
  }
  return true;
}
