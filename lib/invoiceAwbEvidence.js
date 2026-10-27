const clean = value => String(value ?? '').normalize('NFKC').trim();

export function normalizeAirWaybill(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return '';
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function isValidAirWaybill(value) {
  const normalized = normalizeAirWaybill(value);
  if (!normalized) return false;
  const digits = normalized.replace('-', '');
  return Number(digits.slice(3, 10)) % 7 === Number(digits[10]);
}

function kgValue(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 100000 ? number : null;
}

export function reviewAirWaybill({ awbDocument, invoices = [], packageTotal = null, manualFields = [] }) {
  const issues = [];
  const awb = normalizeAirWaybill(awbDocument?.awb);
  const grossWeightKg = kgValue(awbDocument?.gross_weight_kg);
  const chargeableWeightKg = kgValue(awbDocument?.chargeable_weight_kg);
  const packages = positiveInteger(awbDocument?.packages);
  if (!isValidAirWaybill(awb)) issues.push('AWB 번호를 원문에서 확인해야 합니다.');
  if (grossWeightKg == null) issues.push('AWB Gross Weight(kg)가 확인되지 않았습니다.');
  if (chargeableWeightKg == null) issues.push('AWB Chargeable Weight(kg)가 확인되지 않았습니다.');
  if (packages == null) issues.push('AWB 포장 수량이 확인되지 않았습니다.');
  if (grossWeightKg != null && chargeableWeightKg != null && chargeableWeightKg < grossWeightKg) {
    issues.push('AWB CW가 GW보다 작습니다. 원본을 확인하세요.');
  }
  if (packageTotal != null && packages != null && Number(packageTotal) !== packages) {
    issues.push(`인보이스 박스 합계 ${packageTotal}와 AWB 포장 수 ${packages}가 다릅니다.`);
  }
  const awbEvidence = awbDocument?.evidence || {};
  for (const [field, label, value] of [
    ['awb', /awb|air\s*waybill|airway\s*bill/i, awb],
    ['packages', /package|pieces|boxes|cartons/i, packages],
    ['gross_weight_kg', /gross\s*weight/i, grossWeightKg],
    ['chargeable_weight_kg', /chargeable|charged\s*weight/i, chargeableWeightKg],
  ]) {
    const proof = awbEvidence[field];
    if (value != null && !manualFields.includes(field) && (!Number.isInteger(Number(proof?.page)) || Number(proof.page) < 1 || !clean(proof?.quote)
      || !label.test(proof.quote) || (field.includes('weight') && !/kg/i.test(proof.quote)))) {
      issues.push(`${field === 'gross_weight_kg' ? 'GW' : field === 'chargeable_weight_kg' ? 'CW' : field === 'packages' ? '포장 수' : 'AWB 번호'} 원문 위치 근거를 확인해야 합니다.`);
    }
  }
  const invoiceAwbs = invoices.map(invoice => normalizeAirWaybill(invoice?.awb)).filter(Boolean);
  if (invoiceAwbs.some(value => value !== awb)) issues.push('인보이스와 AWB 번호가 일치하지 않습니다.');
  if (awbDocument?.invoice_awb && normalizeAirWaybill(awbDocument.invoice_awb) !== awb) {
    issues.push('AWB에 적힌 인보이스 참조번호와 AWB 번호가 다릅니다. 담당자 확인이 필요합니다.');
  }
  if (invoices.length !== 1) issues.push('인보이스가 여러 장입니다. 단일 AWB 중량을 여러 농장에 중복 적용하지 않습니다.');
  return {
    awb, packages, grossWeightKg, chargeableWeightKg,
    invoiceAwb: invoiceAwbs[0] || normalizeAirWaybill(awbDocument?.invoice_awb) || '',
    currency: awbDocument?.currency === 'AUD' ? 'AUD' : '',
    evidence: awbEvidence,
    issues,
    ready: issues.length === 0,
  };
}

export function invoiceBoxTotal(invoices = []) {
  const values = (invoices || []).flatMap(invoice => invoice?.products || []).map(row => {
    const value = row?.pcs;
    if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
    return Number(value);
  });
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

export function buildAwbSourceMetadata(review, { fileName, sourceHash, uploadDate, confirmed = false }) {
  if (!review?.ready || !/^[a-f0-9]{64}$/i.test(String(sourceHash || ''))
    || typeof fileName !== 'string' || !fileName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(uploadDate || ''))) {
    throw new Error('AWB 파일·원문 근거·인보이스 업로드 날짜를 확인하세요.');
  }
  const common = { source: 'AWB_PDF', sourceHash: sourceHash.toLowerCase(), fileName: fileName.trim(), awb: review.awb };
  const weightSourceEvidence = {
    gw: { ...common, page: review.evidence.gross_weight_kg.page, quote: review.evidence.gross_weight_kg.quote, unit: 'kg' },
    cw: { ...common, page: review.evidence.chargeable_weight_kg.page, quote: review.evidence.chargeable_weight_kg.quote, unit: 'kg' },
  };
  return {
    awb: review.awb,
    gw: review.grossWeightKg,
    cw: review.chargeableWeightKg,
    awbReviewed: confirmed === true,
    awbAttachment: {
      ...common, invoiceAwb: review.invoiceAwb, packageCount: review.packages,
      uploadDate, reviewed: confirmed === true,
      evidence: review.evidence,
    },
    weightSourceEvidence,
  };
}
