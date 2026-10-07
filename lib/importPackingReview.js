// Browser/file-only review. No ERP, network, inferred currency or unit conversion.
const FIELDS = ['gw', 'cw', 'freight'];
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
function sourceValue(invoice, field, country) {
  const key = sourceField(field, country);
  const proof = invoice.review_evidence?.[key];
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
      original, values, evidence, currency: String(invoice.currency || '통화 미확인'),
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
    const next = { ...invoice, gross_weight: values.gw, vol_weight: values.cw, [sourceField('freight', country)]: values.freight };
    // Explicit unknown CW must not fall back to net weight in the legacy NL writer.
    if (country === 'NL') next.net_weight = null;
    if (country === 'CN' && invoice.source_format === 'china_invoice_xlsx') {
      const costs = (invoice.additional_costs || []).filter(cost => !cost.reviewAdjustment).map(cost => ({ ...cost }));
      const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
      if (values.freight === null) throw new Error('중국 Excel의 부대비 합계는 확인 후 숫자를 입력하세요.');
      const difference = Math.round((values.freight - total) * 1e8) / 1e8;
      if (difference) costs.push({ description: '확인창 부대비 조정', quantity: 1, unit_price: difference, amount: difference, reviewAdjustment: true });
      next.additional_costs = costs;
    }
    next.packingReview = { original: source.original, values, reason, confirmedAt: now,
      currency: source.currency, label: source.freightLabel, evidence: source.evidence };
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
