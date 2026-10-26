// Source-derived suggestions only. Never copy quantities from a past receipt.
const text = value => String(value ?? '').normalize('NFKC').trim();
const blank = value => value == null || value === '';
// Source evidence can be present even when legacy CO fields are absent.
export function packingWeight(invoice, field) {
  const key = field === 'gw' ? 'gross_weight' : 'vol_weight';
  const review = invoice?.packingReview?.values;
  const proof = invoice?.review_evidence?.[key];
  let value;
  if (review && Object.hasOwn(review, field)) value = review[field];
  else if (proof && Object.hasOwn(proof, 'value')) {
    if (!/^(kg|kgs|kilograms?|킬로그램)$/i.test(text(proof.unit))) return null;
    value = proof.value;
  } else value = invoice?.[key] ?? (field === 'cw' ? invoice?.chargeable_weight : null);
  if (blank(value) || !['number','string'].includes(typeof value)) return null;
  const raw = text(value);
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(raw)) return null;
  const number = Number(raw.replaceAll(',', ''));
  return Number.isFinite(number) && number >= 0 && number <= 1e12 ? number : null;
}

export function fillMissingReceiptWeights(record, source) {
  const document = record.document;
  if (!source || document.documentId !== source.documentId || document.sourceHash !== source.sourceHash
    || document.orderYear !== source.orderYear || document.orderWeek !== source.orderWeek
    || record.pendingOperation || record.recoveryRequired || document.warehouseKey || document.receiptStatus === 'COMMITTED'
    || (document.operations || []).some(op => op.status === 'COMMITTED')) return record;
  const meta = document.reviewedMetadata || {}, incoming = source.reviewedMetadata || {}, patch = {};
  for (const field of ['gw','cw']) {
    if (blank(meta[field]) && !meta.weightManual?.[field] && typeof incoming[field] === 'number'
      && Number.isFinite(incoming[field]) && incoming[field] >= 0) patch[field] = incoming[field];
  }
  if (!Object.keys(patch).length) return record;
  return {...record,dirty:true,preview:null,stageProgress:{},document:{...document,
    reviewedMetadata:{...meta,...patch,weightSourceEvidence:{...meta.weightSourceEvidence,
      ...Object.fromEntries(Object.keys(patch).map(field=>[field,incoming.weightSourceEvidence?.[field] || {source:'INVOICE_SOURCE'}]))}}}};
}
export function invoiceSupplierKey(value) {
  return text(value).toUpperCase().replace(/\bC\.?\s*I\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/g, ' ')
    .replace(/\b(SAS|SA|LTD|LIMITED|INC|CO|CORPORATION|FLORES|FLOWERS)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export function invoiceCalendarDate(value) {
  let source = text(value).toUpperCase();
  const named = source.match(/^(\d{1,2})[\s-]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s-]*(\d{4})$/);
  if (named) source = `${named[3]}-${String(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[2])+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;
  source = source.replaceAll('/', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return '';
  const date = new Date(`${source}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === source ? source : '';
}
export function sameInvoiceSupplier(name, document, canonicalFarmName) {
  const candidate = invoiceSupplierKey(name);
  return Boolean(candidate && [canonicalFarmName, document?.rawMetadata?.supplier, document?.reviewedMetadata?.farmName]
    .some(value => invoiceSupplierKey(value) === candidate));
}
export function resolveInvoiceHeader(document, farms = []) {
  const meta = document?.reviewedMetadata || {}, raw = document?.rawMetadata || {};
  const supplier = text(raw.supplier || meta.farmName);
  const active = farms.filter(farm => !farm.isDeleted && Number(farm.FarmKey) > 0);
  const exact = active.filter(farm => text(farm.FarmName).toUpperCase() === supplier.toUpperCase());
  const supplierKey = invoiceSupplierKey(supplier);
  const candidates = exact.length ? exact : supplierKey ? active.filter(farm => invoiceSupplierKey(farm.FarmName) === supplierKey) : [];
  const dates = [...new Set([raw.invoiceDate, raw.rawDate].map(invoiceCalendarDate).filter(Boolean))];
  const proposedDate = dates.length === 1 && dates[0].slice(0,4) === text(document?.orderYear) ? dates[0] : '';
  const awb = text(meta.awb || raw.awb).replace(/[\s-]/g, '');
  const verifiedAirWaybill = /^\d{11}$/.test(awb) && Number(awb.slice(3,10)) % 7 === Number(awb[10]);
  return {
    farm: candidates.length === 1 ? { farmKey: Number(candidates[0].FarmKey), farmName: candidates[0].FarmName } : null,
    inputDate: proposedDate,
    transportMode: verifiedAirWaybill ? 'AIR' : '',
    issues: [
      ...(!document?.farmKey && candidates.length !== 1 ? [{code:'FARM_MATCH_REQUIRED',message:candidates.length ? '공급농장 후보가 여러 개입니다. 농장만 선택해 주세요.' : '등록된 공급농장을 찾지 못했습니다. 농장만 선택해 주세요.'}] : []),
      ...(!meta.inputDate && !proposedDate ? [{code:'INPUT_DATE_REVIEW_REQUIRED',message:'원문 날짜가 없거나 서로 다릅니다. 입고일만 확인해 주세요.'}] : []),
    ],
    source: {supplier, rawDate: text(raw.rawDate), invoiceDate: text(raw.invoiceDate)},
  };
}
export function applyInvoiceHeader(record, resolution) {
  const document = record.document;
  if (record.pendingOperation || document.receiptStatus === 'COMMITTED' || document.warehouseKey
    || (document.operations || []).some(operation => operation.status === 'COMMITTED')) return record;
  const meta = document.reviewedMetadata || {};
  const farm = !document.farmKey && resolution.farm;
  const date = !meta.inputDate && resolution.inputDate;
  const transport = !meta.transportMode && resolution.transportMode;
  if (!farm && !date && !transport) return record;
  return {...record,dirty:true,preview:null,stageProgress:{},document:{...document,
    ...(farm ? {farmKey:farm.farmKey} : {}),
    reviewedMetadata:{...meta,...(farm ? {farmName:farm.farmName} : {}),...(date ? {inputDate:date} : {}),...(transport ? {transportMode:transport} : {}),
      autoHeaderEvidence:{source:'INVOICE_SOURCE',...resolution.source,fields:[...(farm?['farmKey']:[]),...(date?['inputDate']:[]),...(transport?['transportMode']:[])]}},
  }};
}
