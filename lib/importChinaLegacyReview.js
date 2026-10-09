import { normalizePackingMetadata } from './importPackingMetadata.js';

export const CHINA_LEGACY_REVIEWED_SOURCE_FORMAT = 'china_legacy_invoice_reviewed';

const LEGACY_SOURCE_FORMAT = 'china_legacy_invoice_xlsx';
const REVIEWED_STATUS = 'LEGACY_CN_REVIEWED';
const ROW_KEYS = [
  'source_sheet', 'source_row', 'raw_qty', 'u_price', 't_price', 'source_unit_spec',
  'raw_unit', 'pcs', 'total_stems', 'reason', 'confirmed',
];
const RESOLUTION_KEYS = ['currency', 'rows', 'invoiceConfirmed', 'comparisonConfirmed'];
const CURRENCY_KEYS = ['code', 'reason', 'confirmed'];
const close = (a, b) => Math.abs(a - b) <= 0.01;
const text = value => typeof value === 'string' ? value.trim() : '';
const fail = (code, message) => { throw new Error(`${code}: ${message}`); };

function record(value, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} is required`);
  return value;
}

function exactKeys(value, allowed, code, label) {
  const actual = Object.keys(record(value, code, label)).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, `${label} fields must be exactly ${allowed.join(', ')}`);
  }
}

function finite(value, { positive = false, integer = false } = {}) {
  return typeof value === 'number' && Number.isFinite(value)
    && (!positive || value > 0) && (!integer || Number.isSafeInteger(value));
}

function copy(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function rowKey(sheet, row) {
  return `${sheet}\u0000${row}`;
}

function sourceIdentity(source) {
  const invoice = text(source.invoice);
  const sourceSheet = text(source.source_sheet);
  const date = text(source.date);
  const supplier = text(source.supplier);
  if (!invoice || !sourceSheet || !date || !supplier) {
    fail('LEGACY_SOURCE_INVOICE_INVALID', 'source invoice identity is incomplete');
  }
  return {
    invoice,
    source_sheet: sourceSheet,
    date,
    raw_date: source.raw_date == null ? null : String(source.raw_date),
    supplier,
    source_format: LEGACY_SOURCE_FORMAT,
  };
}

function verifySourceArithmetic(source) {
  if (source.arithmetic_verified !== true) {
    fail('LEGACY_ARITHMETIC_UNVERIFIED', 'source arithmetic_verified must be true');
  }
  if (!Array.isArray(source.products) || !source.products.length) {
    fail('LEGACY_SOURCE_INVALID', 'source products are required');
  }
  let productTotal = 0;
  for (const product of source.products) {
    if (!product || product.source_format !== LEGACY_SOURCE_FORMAT
      || !finite(product.raw_qty, { positive: true })
      || !finite(product.unitPrice) || product.unitPrice < 0
      || !finite(product.t_price) || product.t_price < 0
      || product.amount_matches !== true
      || !close(product.raw_qty * product.unitPrice, product.t_price)) {
      fail('LEGACY_LINE_AMOUNT_MISMATCH', 'source product arithmetic is incomplete or inconsistent');
    }
    productTotal += product.t_price;
  }

  const additionalCosts = Array.isArray(source.additional_costs) ? source.additional_costs : [];
  let feeTotal = 0;
  for (const cost of additionalCosts) {
    const quantity = cost?.quantity ?? cost?.raw_qty;
    const unitPrice = cost?.unit_price ?? cost?.unitPrice;
    if (!cost || !finite(quantity) || quantity < 0 || !finite(unitPrice) || !finite(cost.amount)
      || cost.amount_matches !== true || !close(quantity * unitPrice, cost.amount)) {
      fail('LEGACY_ARITHMETIC_UNVERIFIED', 'additional cost quantity, price, or amount is invalid');
    }
    feeTotal += cost.amount;
  }
  const grandTotal = productTotal + feeTotal;
  if (!finite(source.item_subtotal) || !close(source.item_subtotal, productTotal)
    || !finite(source.freight) || !close(source.freight, feeTotal)
    || !finite(source.invoice_total) || !close(source.invoice_total, grandTotal)
    || !finite(source.total_value) || !close(source.total_value, grandTotal)) {
    fail('LEGACY_ARITHMETIC_UNVERIFIED', 'source subtotals or grand total are inconsistent');
  }
  return { productTotal, feeTotal, grandTotal };
}

function verifyCurrency(source, resolution) {
  exactKeys(resolution, CURRENCY_KEYS, 'LEGACY_CURRENCY_REQUIRED', 'currency confirmation');
  if (resolution.confirmed !== true) {
    fail('LEGACY_CURRENCY_REQUIRED', 'currency must be explicitly confirmed');
  }
  const code = text(resolution.code).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) fail('LEGACY_CURRENCY_REQUIRED', 'currency must be an ISO three-letter code');
  const reason = text(resolution.reason);
  if (!reason) fail('LEGACY_CURRENCY_REASON_REQUIRED', 'currency confirmation reason is required');
  const sourceCurrency = text(source.currency).toUpperCase();
  if (sourceCurrency && sourceCurrency !== code) {
    fail('LEGACY_CURRENCY_CONFLICT', 'confirmed currency conflicts with the explicit source currency');
  }
  return { code, reason, confirmed: true };
}

function verifyResolutionRows(source, resolutionRows) {
  if (!Array.isArray(resolutionRows)) fail('LEGACY_ROW_CONFIRMATION_MISSING', 'row confirmations are required');
  const confirmedByKey = new Map();
  for (const candidate of resolutionRows) {
    exactKeys(candidate, ROW_KEYS, 'LEGACY_ROW_STALE', 'row confirmation');
    const sheet = text(candidate.source_sheet);
    const row = candidate.source_row;
    if (!sheet || !Number.isSafeInteger(row) || row <= 0) {
      fail('LEGACY_ROW_STALE', 'row confirmation identity is invalid');
    }
    const key = rowKey(sheet, row);
    if (confirmedByKey.has(key)) fail('LEGACY_ROW_CONFIRMATION_DUPLICATE', 'duplicate row confirmation');
    confirmedByKey.set(key, candidate);
  }
  if (confirmedByKey.size !== source.products.length) {
    const code = confirmedByKey.size < source.products.length
      ? 'LEGACY_ROW_CONFIRMATION_MISSING'
      : 'LEGACY_ROW_STALE';
    fail(code, 'every source product requires exactly one current confirmation');
  }

  const output = [];
  const sourceKeys = new Set();
  for (const product of source.products) {
    const sheet = text(product.source_sheet);
    const row = product.source_row;
    if (!sheet || !Number.isSafeInteger(row) || row <= 0 || sheet !== text(source.source_sheet)) {
      fail('LEGACY_SOURCE_INVALID', 'source product identity is invalid');
    }
    const key = rowKey(sheet, row);
    if (sourceKeys.has(key)) fail('LEGACY_SOURCE_INVALID', `duplicate source product identity ${sheet}!${row}`);
    sourceKeys.add(key);
    const candidate = confirmedByKey.get(key);
    if (!candidate) fail('LEGACY_ROW_STALE', `row confirmation does not match ${sheet}!${row}`);
    if (candidate.raw_qty !== product.raw_qty
      || candidate.u_price !== product.unitPrice
      || candidate.t_price !== product.t_price
      || candidate.source_unit_spec !== product.source_unit_spec) {
      fail('LEGACY_ROW_STALE', `source snapshot changed for ${sheet}!${row}`);
    }
    if (candidate.confirmed !== true) {
      fail('LEGACY_ROW_CONFIRMATION_REQUIRED', `row ${sheet}!${row} is not explicitly confirmed`);
    }
    if (candidate.raw_unit !== '단') {
      fail('LEGACY_RAW_UNIT_UNSUPPORTED', `row ${sheet}!${row} supports only explicitly confirmed 단`);
    }
    const reason = text(candidate.reason);
    if (!reason) fail('LEGACY_ROW_REASON_REQUIRED', `row ${sheet}!${row} requires a confirmation reason`);
    if (!finite(candidate.pcs, { positive: true, integer: true })
      || !finite(candidate.total_stems, { positive: true, integer: true })
      || !finite(product.raw_qty, { positive: true, integer: true })) {
      fail('LEGACY_NATIVE_QUANTITY_INVALID', `row ${sheet}!${row} native quantities must be positive integers`);
    }
    if (!close(candidate.raw_qty * candidate.u_price, candidate.t_price)) {
      fail('LEGACY_LINE_AMOUNT_MISMATCH', `row ${sheet}!${row} amount no longer matches the source snapshot`);
    }
    const totalBunch = candidate.raw_qty;
    const bunchSt = candidate.total_stems / totalBunch;
    const steamBox = candidate.total_stems / candidate.pcs;
    if (!Number.isFinite(bunchSt) || bunchSt <= 0 || !Number.isFinite(steamBox) || steamBox <= 0) {
      fail('LEGACY_NATIVE_QUANTITY_INVALID', `row ${sheet}!${row} derived ratios must be positive`);
    }
    output.push({
      product,
      confirmation: {
        source_sheet: sheet,
        source_row: row,
        raw_qty: candidate.raw_qty,
        u_price: candidate.u_price,
        t_price: candidate.t_price,
        source_unit_spec: candidate.source_unit_spec,
        raw_unit: '단',
        pcs: candidate.pcs,
        total_stems: candidate.total_stems,
        reason,
        confirmed: true,
      },
      derived: { total_bunch: totalBunch, bunch_st: bunchSt, steam_box: steamBox },
    });
    confirmedByKey.delete(key);
  }
  if (confirmedByKey.size) fail('LEGACY_ROW_STALE', 'row confirmation does not belong to this source invoice');
  return output;
}

function issuesForMetadataRevalidation(source) {
  return (Array.isArray(source.extractionIssues) ? source.extractionIssues : [])
    .filter(issue => {
      const code = String(issue?.code || '');
      const field = issue?.field;
      const currencyIssue = code.startsWith('CURRENCY_') || field === 'currency';
      const dateIssue = code.startsWith('DATE_')
        || ['date', 'raw_date', 'date_kind', 'date_order'].includes(field);
      return !currencyIssue && !dateIssue;
    })
    .map(issue => ({ ...issue }));
}

function assertResolvedMetadata(reviewed) {
  const issues = Array.isArray(reviewed.extractionIssues) ? reviewed.extractionIssues : [];
  const dateIssue = issues.find(issue => String(issue?.code || '').startsWith('DATE_')
    || ['date', 'raw_date', 'date_kind', 'date_order'].includes(issue?.field));
  if (dateIssue) fail('LEGACY_DATE_INVALID', 'existing invoice date metadata did not revalidate');
  const currencyIssue = issues.find(issue => String(issue?.code || '').startsWith('CURRENCY_')
    || issue?.field === 'currency');
  if (currencyIssue) fail('LEGACY_CURRENCY_REQUIRED', 'confirmed currency did not revalidate');
  if (issues.length) fail('LEGACY_METADATA_UNRESOLVED', 'unresolved source metadata issues remain');
}

function gate(condition, message, code = 'LEGACY_REVIEW_GATE_INVALID') {
  if (!condition) fail(code, message);
}

function gateObject(value, label) {
  gate(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  return value;
}

function gateIdentity(product) {
  const sheet = text(product?.source_sheet);
  const row = product?.source_row;
  gate(sheet && Number.isSafeInteger(row) && row > 0, 'reviewed product source identity is invalid');
  return rowKey(sheet, row);
}

function gateComparisonSnapshot(invoice, review) {
  const comparison = gateObject(review.comparison, 'legacyReview comparison');
  gate(comparison.authority === 'INVOICE', 'Invoice must remain authoritative over CL comparison sheets');
  gate(invoice.packing_comparison_status === 'INVOICE_AUTHORITY_CONFIRMED', 'CL comparison acknowledgement is unresolved');
  const current = Array.isArray(invoice.packing_comparisons) ? invoice.packing_comparisons : [];
  const audited = Array.isArray(comparison.sheets) ? comparison.sheets : [];
  gate(current.length === audited.length, 'CL comparison sheet snapshot is stale', 'LEGACY_REVIEW_GATE_STALE');
  for (let index = 0; index < current.length; index++) {
    for (const field of ['sheet_name', 'authority', 'range']) {
      gate((current[index]?.[field] ?? null) === (audited[index]?.[field] ?? null),
        'CL comparison sheet snapshot is stale', 'LEGACY_REVIEW_GATE_STALE');
    }
  }
}

function gateSourceIdentity(invoice, review) {
  const identity = gateObject(review.sourceInvoice, 'legacyReview sourceInvoice');
  gate(identity.source_format === LEGACY_SOURCE_FORMAT, 'legacyReview source format is invalid');
  for (const field of ['invoice', 'source_sheet', 'date', 'raw_date', 'supplier']) {
    gate((identity[field] ?? null) === (invoice[field] ?? null),
      `sourceInvoice ${field} snapshot is stale`, 'LEGACY_REVIEW_GATE_STALE');
  }
}

function gateReviewedArithmetic(invoice, productTotal) {
  const costs = Array.isArray(invoice.additional_costs) ? invoice.additional_costs : [];
  let feeTotal = 0;
  for (const cost of costs) {
    gate(finite(cost?.amount) && finite(cost?.raw_qty) && cost.raw_qty >= 0
      && finite(cost?.quantity) && cost.quantity >= 0
      && finite(cost?.unitPrice) && finite(cost?.unit_price)
      && cost.unit_price === cost.unitPrice && cost.amount_matches === true
      && close(cost.quantity * cost.unit_price, cost.amount),
    'reviewed additional cost price or amount is invalid');
    feeTotal += cost.amount;
  }
  const grandTotal = productTotal + feeTotal;
  gate(invoice.arithmetic_verified === true, 'reviewed arithmetic is not verified');
  gate(finite(invoice.item_subtotal) && close(invoice.item_subtotal, productTotal), 'reviewed product subtotal is stale', 'LEGACY_REVIEW_GATE_STALE');
  gate(finite(invoice.freight) && close(invoice.freight, feeTotal), 'reviewed additional-cost subtotal is stale', 'LEGACY_REVIEW_GATE_STALE');
  gate(finite(invoice.invoice_total) && close(invoice.invoice_total, grandTotal), 'reviewed invoice total is stale', 'LEGACY_REVIEW_GATE_STALE');
  gate(finite(invoice.total_value) && close(invoice.total_value, grandTotal), 'reviewed total value is stale', 'LEGACY_REVIEW_GATE_STALE');
  const audited = gateObject(invoice.legacyReview.sourceArithmetic, 'legacyReview sourceArithmetic');
  gate(audited.arithmetic_verified === true
    && finite(audited.product_subtotal) && close(audited.product_subtotal, productTotal)
    && finite(audited.additional_costs_total) && close(audited.additional_costs_total, feeTotal)
    && finite(audited.invoice_total) && close(audited.invoice_total, grandTotal),
  'legacyReview arithmetic snapshot is stale', 'LEGACY_REVIEW_GATE_STALE');
}

/**
 * Shared generation/adapter gate for a manually reviewed legacy China invoice.
 * Returns true or throws. It independently checks the audit snapshot and never
 * reconstructs a source payload or calls resolveLegacyChinaInvoice recursively.
 */
export function assertLegacyChinaReviewed(invoice) {
  gateObject(invoice, 'reviewed legacy China invoice');
  gate(invoice.source_format === CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
    `source_format must be ${CHINA_LEGACY_REVIEWED_SOURCE_FORMAT}`);
  const review = gateObject(invoice.legacyReview, 'legacyReview');
  gate(review.version === 1, 'legacyReview version must be 1');
  gate(review.invoiceConfirmed === true, 'Invoice authority is not confirmed');
  gate(review.comparisonConfirmed === true, 'CL comparison acknowledgement is not confirmed');
  const currency = gateObject(review.currency, 'legacyReview currency');
  const currencyCode = text(currency.code);
  gate(currency.confirmed === true && /^[A-Z]{3}$/.test(currencyCode)
    && text(currency.reason), 'currency confirmation is incomplete');
  gate(text(invoice.currency) === currencyCode,
    'confirmed currency snapshot is stale', 'LEGACY_REVIEW_GATE_STALE');
  gateSourceIdentity(invoice, review);
  gateComparisonSnapshot(invoice, review);

  gate(invoice.review_required === false, 'legacy review_required flag is unresolved');
  gate(invoice.unit_review_required === false, 'legacy unit_review_required flag is unresolved');
  gate(invoice.review_status === REVIEWED_STATUS, 'legacy review status is unresolved');
  gate(Array.isArray(invoice.review_states) && invoice.review_states.length === 0,
    'legacy review states are unresolved');
  gate(Array.isArray(invoice.extractionIssues) && invoice.extractionIssues.length === 0,
    'legacy extraction issues are unresolved');

  const products = invoice.products;
  const auditRows = review.rows;
  gate(Array.isArray(products) && products.length > 0, 'reviewed products are required');
  gate(Array.isArray(auditRows) && auditRows.length === products.length,
    'legacyReview row count is stale', 'LEGACY_REVIEW_GATE_STALE');
  const auditByKey = new Map();
  for (const auditRow of auditRows) {
    const key = gateIdentity(auditRow);
    gate(!auditByKey.has(key), 'legacyReview contains duplicate row identities');
    auditByKey.set(key, auditRow);
  }

  let boxes = 0;
  let bunches = 0;
  let stems = 0;
  let productTotal = 0;
  const productKeys = new Set();
  for (const product of products) {
    gate(product?.source_format === CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
      'every reviewed product must use the reviewed legacy source format');
    const key = gateIdentity(product);
    gate(!productKeys.has(key), 'reviewed products contain duplicate row identities');
    productKeys.add(key);
    const auditRow = auditByKey.get(key);
    gate(auditRow, 'reviewed product has no matching legacyReview row', 'LEGACY_REVIEW_GATE_STALE');
    const snapshot = gateObject(auditRow.source_snapshot, 'legacyReview source snapshot');
    const derived = gateObject(auditRow.derived, 'legacyReview derived quantities');

    gate(auditRow.confirmed === true && auditRow.raw_unit === '단' && text(auditRow.reason),
      'legacyReview row confirmation is incomplete');
    gate(snapshot.source_sheet === product.source_sheet && snapshot.source_row === product.source_row
      && snapshot.raw_qty === product.raw_qty && snapshot.unitPrice === product.unitPrice
      && snapshot.t_price === product.t_price && snapshot.source_unit_spec === product.source_unit_spec,
    'reviewed product raw snapshot is stale', 'LEGACY_REVIEW_GATE_STALE');
    gate(auditRow.source_sheet === snapshot.source_sheet && auditRow.source_row === snapshot.source_row
      && auditRow.raw_qty === snapshot.raw_qty && auditRow.u_price === snapshot.unitPrice
      && auditRow.t_price === snapshot.t_price && auditRow.source_unit_spec === snapshot.source_unit_spec,
    'legacyReview row and source snapshot disagree', 'LEGACY_REVIEW_GATE_STALE');
    gate(product.amount_matches === true
      && finite(product.raw_qty, { positive: true, integer: true })
      && finite(product.unitPrice) && product.unitPrice >= 0
      && finite(product.t_price) && product.t_price >= 0
      && close(product.raw_qty * product.unitPrice, product.t_price),
    'reviewed product source arithmetic is invalid');
    gate(finite(auditRow.pcs, { positive: true, integer: true })
      && finite(auditRow.total_stems, { positive: true, integer: true }),
    'legacyReview native quantities are invalid');
    const expectedBunches = auditRow.raw_qty;
    const expectedBunchSt = auditRow.total_stems / expectedBunches;
    const expectedSteamBox = auditRow.total_stems / auditRow.pcs;
    gate(derived.total_bunch === expectedBunches
      && close(derived.bunch_st, expectedBunchSt)
      && close(derived.steam_box, expectedSteamBox),
    'legacyReview derived quantities are stale', 'LEGACY_REVIEW_GATE_STALE');
    gate(product.pcs === auditRow.pcs && product.total_bunch === expectedBunches
      && product.total_stems === auditRow.total_stems
      && product.box_quantity === auditRow.pcs && product.bunch_quantity === expectedBunches
      && product.stem_quantity === auditRow.total_stems
      && close(product.bunch_st, expectedBunchSt) && close(product.steam_box, expectedSteamBox)
      && product.u_price === snapshot.unitPrice && product.t_price === snapshot.t_price,
    'reviewed product native quantities or prices are stale', 'LEGACY_REVIEW_GATE_STALE');
    const manual = gateObject(product.manualReview, 'reviewed product manualReview');
    gate(manual.confirmed === true && manual.raw_unit === '단' && manual.reason === auditRow.reason
      && manual.pcs === auditRow.pcs && manual.total_bunch === expectedBunches
      && manual.total_stems === auditRow.total_stems
      && close(manual.bunch_st, expectedBunchSt) && close(manual.steam_box, expectedSteamBox)
      && product.reviewed === true && product.unit_review_required === false,
    'reviewed product manual confirmation is stale', 'LEGACY_REVIEW_GATE_STALE');
    boxes += product.pcs;
    bunches += product.total_bunch;
    stems += product.total_stems;
    productTotal += product.t_price;
    auditByKey.delete(key);
  }
  gate(auditByKey.size === 0, 'legacyReview contains stale rows', 'LEGACY_REVIEW_GATE_STALE');
  gate(invoice.total_boxes === boxes && invoice.total_bunches === bunches && invoice.total_stems === stems,
    'reviewed invoice quantity totals are stale', 'LEGACY_REVIEW_GATE_STALE');
  gateReviewedArithmetic(invoice, productTotal);

  const revalidated = normalizePackingMetadata({ ...invoice, extractionIssues: [] }, 'CN');
  assertResolvedMetadata(revalidated);
  return true;
}

/**
 * Purely validates an explicitly reviewed legacy China invoice and returns a
 * new reviewed shape. It never mutates source/resolution or performs I/O.
 */
export function resolveLegacyChinaInvoice(source, resolution) {
  record(source, 'LEGACY_SOURCE_INVALID', 'legacy source invoice');
  if (source.source_format !== LEGACY_SOURCE_FORMAT) {
    fail('LEGACY_SOURCE_INVALID', `source_format must be ${LEGACY_SOURCE_FORMAT}`);
  }
  exactKeys(resolution, RESOLUTION_KEYS, 'LEGACY_RESOLUTION_INVALID', 'legacy resolution');
  if (resolution.invoiceConfirmed !== true) {
    fail('LEGACY_INVOICE_CONFIRMATION_REQUIRED', 'Invoice authority must be explicitly confirmed');
  }
  if (resolution.comparisonConfirmed !== true) {
    fail('LEGACY_COMPARISON_CONFIRMATION_REQUIRED', 'Invoice authority over CL comparisons must be explicitly confirmed');
  }

  const identity = sourceIdentity(source);
  const arithmetic = verifySourceArithmetic(source);
  const currency = verifyCurrency(source, resolution.currency);
  const reviewedRows = verifyResolutionRows(source, resolution.rows);

  const products = reviewedRows.map(({ product, confirmation, derived }) => ({
    ...copy(product),
    source_format: CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
    pcs: confirmation.pcs,
    total_bunch: derived.total_bunch,
    total_stems: confirmation.total_stems,
    box_quantity: confirmation.pcs,
    bunch_quantity: derived.total_bunch,
    stem_quantity: confirmation.total_stems,
    bunch_st: derived.bunch_st,
    steam_box: derived.steam_box,
    u_price: product.unitPrice,
    t_price: product.t_price,
    unit_review_required: false,
    reviewed: true,
    manualReview: {
      raw_unit: '단',
      reason: confirmation.reason,
      confirmed: true,
      pcs: confirmation.pcs,
      total_bunch: derived.total_bunch,
      total_stems: confirmation.total_stems,
      bunch_st: derived.bunch_st,
      steam_box: derived.steam_box,
    },
  }));
  const additionalCosts = (source.additional_costs || []).map(cost => {
    const quantity = cost.quantity ?? cost.raw_qty;
    const unitPrice = cost.unit_price ?? cost.unitPrice;
    if (!finite(quantity) || quantity < 0 || !finite(unitPrice)
      || !finite(cost.amount) || !close(quantity * unitPrice, cost.amount)) {
      fail('LEGACY_ARITHMETIC_UNVERIFIED', 'additional cost generation fields are invalid');
    }
    return { ...copy(cost), quantity, unit_price: unitPrice };
  });
  const totals = products.reduce((result, product) => ({
    boxes: result.boxes + product.pcs,
    bunches: result.bunches + product.total_bunch,
    stems: result.stems + product.total_stems,
  }), { boxes: 0, bunches: 0, stems: 0 });
  const sourceComparisonStatus = source.packing_comparison_status ?? null;
  const legacyReview = {
    version: 1,
    sourceInvoice: identity,
    sourceReviewStatus: source.review_status ?? null,
    sourceReviewStates: copy(source.review_states || []),
    sourceArithmetic: {
      arithmetic_verified: true,
      product_subtotal: arithmetic.productTotal,
      additional_costs_total: arithmetic.feeTotal,
      invoice_total: arithmetic.grandTotal,
      independent_totals: copy(source.independent_totals ?? null),
    },
    invoiceConfirmed: true,
    comparisonConfirmed: true,
    comparison: {
      authority: 'INVOICE',
      source_status: sourceComparisonStatus,
      sheets: (source.packing_comparisons || []).map(sheet => ({
        sheet_name: sheet?.sheet_name ?? null,
        authority: sheet?.authority ?? null,
        range: sheet?.range ?? null,
      })),
    },
    currency,
    rows: reviewedRows.map(({ confirmation, derived, product }) => ({
      ...copy(confirmation),
      source_snapshot: {
        source_sheet: product.source_sheet,
        source_row: product.source_row,
        raw_qty: product.raw_qty,
        unitPrice: product.unitPrice,
        t_price: product.t_price,
        source_unit_spec: product.source_unit_spec,
      },
      derived: copy(derived),
    })),
  };

  const reviewed = normalizePackingMetadata({
    ...copy(source),
    source_format: CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
    currency: currency.code,
    products,
    additional_costs: additionalCosts,
    total_boxes: totals.boxes,
    total_bunches: totals.bunches,
    total_stems: totals.stems,
    review_required: false,
    review_status: REVIEWED_STATUS,
    review_states: [],
    unit_review_required: false,
    packing_comparison_status: 'INVOICE_AUTHORITY_CONFIRMED',
    extractionIssues: issuesForMetadataRevalidation(source),
    legacyReview,
  }, 'CN');
  assertResolvedMetadata(reviewed);
  assertLegacyChinaReviewed(reviewed);
  return reviewed;
}
