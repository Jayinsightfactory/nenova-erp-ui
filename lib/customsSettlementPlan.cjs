// Shared preview/apply policy. No SQL, filesystem, OCR, or monetary defaults.
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const present = value => value !== null && value !== undefined && value !== '';
function scopeOf(year, major) {
  const y = String(year ?? ''), m = String(major ?? '');
  if (!/^20\d{2}$/.test(y) || !/^\d{1,2}$/.test(m) || Number(m) < 1 || Number(m) > 53) {
    throw Object.assign(new Error('연도와 대차수를 확인하세요.'), { statusCode: 400 });
  }
  return { year: y, major: m.padStart(2, '0') };
}
function awbOf(value) {
  const raw = String(value ?? '').trim();
  const digits=/^[0-9\s-]+$/.test(raw)?raw.replace(/[\s-]/g,''):'';
  return /^\d{11}$/.test(digits)?digits:null;
}
function receiptKey(receipt) { return `${receipt.issuer}|${receipt.documentId}`; }
function receiptFingerprint(receipt) { return hash({ issuer: receipt.issuer, documentId: receipt.documentId, awb: awbOf(receipt.awb), date: receipt.date, total: receipt.total, charges: receipt.charges.map(({ code, net, vat, total }) => ({ code, net, vat, total })) }); }
function validateReceipt(receipt) {
  if (!receipt || receipt.issuer !== 'SUNYUL' || !/^[a-f0-9]{64}$/.test(receipt.sourceHash || '')
    || !/^[A-Za-z0-9-]{6,40}$/.test(receipt.documentId || '') || !awbOf(receipt.awb)
    || !/^20\d{2}-\d{2}-\d{2}$/.test(receipt.date || '')
    || !Array.isArray(receipt.charges) || !receipt.charges.length || receipt.charges.length > 30) {
    throw Object.assign(new Error('정산서 식별·AWB·일자·비용을 확인하지 못했습니다.'), { statusCode: 422 });
  }
  const date=new Date(`${receipt.date}T12:00:00Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==receipt.date)throw Object.assign(new Error('실제로 존재하는 입항 일자가 필요합니다.'),{statusCode:422});
  for (const row of receipt.charges) {
    if (!/^[A-Z_]{2,30}$/.test(row.code || '') || ![row.net, row.vat, row.total].every(n => Number.isSafeInteger(n) && n >= 0)
      || (['DUTY', 'IMPORT_VAT'].includes(row.code) ? row.net !== 0 || row.vat !== 0 : row.net + row.vat !== row.total)) throw Object.assign(new Error('정산 비용 공급가·부가세·합계가 일치하지 않습니다.'), { statusCode: 422 });
  }
  if (!Number.isSafeInteger(receipt.total) || receipt.charges.reduce((n, r) => n + r.total, 0) !== receipt.total) {
    throw Object.assign(new Error('정산서 총액 검산에 실패했습니다.'), { statusCode: 422 });
  }
  return receipt;
}
function buildSettlementPlan({ year, major, receipts, candidates, saved = {}, applied = [], mapping = {}, confirmed = false }) {
  const scope = scopeOf(year, major), issues = [], groups = new Map(), seen = new Map();
  if (!Array.isArray(receipts) || !receipts.length || receipts.length > 80) throw Object.assign(new Error('정산서가 없습니다.'), { statusCode: 400 });
  const history = new Map(applied.map(r => [receiptKey(r), r]));
  const documents = [];
  function addCharges(receipt, targetKey) {
    const values = {}, netValues = {};
    for (const charge of receipt.charges) {
      if (charge.code === 'IMPORT_VAT') continue; // Recoverable import VAT is not an H cost.
      const rule = (mapping[targetKey] || mapping[targetKey.split('|')[0]])?.[charge.code];
      if (!rule || !['net', 'total'].includes(rule.basis) || !/^[A-Za-z0-9_]+$/.test(rule.field)) { issues.push({ code: 'UNSUPPORTED_CHARGE', documentId: receipt.documentId, charge: charge.code }); continue; }
      values[rule.field] = (values[rule.field] ?? 0) + charge[rule.basis];
      netValues[rule.field] = (netValues[rule.field] ?? 0) + (rule.basis === 'total' && !['DUTY','IMPORT_VAT'].includes(charge.code) ? charge.net : charge[rule.basis]);
    }
    const group = groups.get(targetKey) || { targetKey, values: {}, netValues: {}, documents: [] };
    for (const [field, value] of Object.entries(values)) group.values[field] = (group.values[field] ?? 0) + value;
    for (const [field, value] of Object.entries(netValues)) group.netValues[field] = (group.netValues[field] ?? 0) + value;
    group.documents.push(receipt.documentId); groups.set(targetKey, group);
  }
  // A later split PDF must extend the original total, never replace it.
  for (const receipt of applied) { validateReceipt(receipt); addCharges(receipt, receipt.targetKey); }
  for (const receipt of receipts) {
    validateReceipt(receipt);
    const key = receiptKey(receipt), fingerprint = receiptFingerprint(receipt);
    const previous = seen.get(key) || history.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) issues.push({ code: 'DOCUMENT_CHANGED', documentId: receipt.documentId });
      else documents.push({ documentId: receipt.documentId, status: 'duplicate' });
      continue;
    }
    seen.set(key, { fingerprint });
    if (receipt.date.slice(0, 4) !== scope.year) { issues.push({ code: 'DOCUMENT_YEAR', documentId: receipt.documentId }); continue; }
    const matches = candidates.filter(r => String(r.year) === scope.year && String(r.orderWeek).split('-')[0] === scope.major && awbOf(r.awb) === awbOf(receipt.matchedAwb || receipt.awb) && (!receipt.matchedOrderWeek || r.orderWeek === receipt.matchedOrderWeek));
    const targets = [...new Set(matches.map(r => r.targetKey))];
    if (targets.length !== 1 || matches.some(r => !r.targetKey)) { issues.push({ code: targets.length ? 'AMBIGUOUS_AWB' : 'AWB_NOT_FOUND', awb: awbOf(receipt.awb) }); continue; }
    const targetKey = targets[0];
    addCharges(receipt, targetKey);
    documents.push({ ...receipt, fingerprint, targetKey, status: 'new' });
  }
  const patches = [];
  const activeTargets=new Set(documents.filter(d=>d.status==='new').map(d=>d.targetKey));
  for (const group of groups.values()) for (const [field, amount] of Object.entries(group.values)) {
    if(!activeTargets.has(group.targetKey))continue;
    let current = saved[group.targetKey]?.[field];
    const split = field.match(/^(Customs[12]|SunYul[12])_1$/);
    if (split) {
      const parts = [1, 2, 3].map(i => saved[group.targetKey]?.[`${split[1]}_${i}`]);
      if (parts.some(present)) current = parts.reduce((n, v) => n + Number(v ?? 0), 0);
      else if (present(saved[group.targetKey]?.[split[1]])) current = saved[group.targetKey][split[1]];
    }
    if (field === 'ActualQuarantineAgencyFee' && present(saved[group.targetKey]?.ItemCount)) issues.push({ code: 'ITEM_COUNT_CONFLICT', targetKey: group.targetKey, field });
    const status = present(current) ? Number(current) === amount ? 'covered' : Number(current) === group.netValues[field] ? 'basis_reconciled' : 'conflict' : 'link';
    patches.push({ targetKey: group.targetKey, field, amount, netAmount: group.netValues[field], basis: amount === group.netValues[field] ? 'net_or_tax' : 'gross', current: present(current) ? Number(current) : null, status, documents: group.documents });
    if (status === 'conflict') issues.push({ code: 'SAVED_VALUE_CONFLICT', targetKey: group.targetKey, field });
  }
  // Confirmed and historical report money is never changed by this plan.
  const baseline = hash({ scope, candidates, saved, applied, confirmed });
  const result = { ...scope, baseline, patches, documents, issues, confirmed: !!confirmed, canApply: !issues.length && documents.some(r => r.status === 'new'), erpWrites: 0, reportWrites: 0 };
  return { ...result, planDigest: hash(result) };
}
function mergeOverlay(saved, values) {
  const output = { ...(saved || {}) };
  for (const [field, value] of Object.entries(values || {})) if (!present(output[field])) output[field] = value;
  return output;
}
module.exports = { scopeOf, awbOf, hash, receiptKey, receiptFingerprint, validateReceipt, buildSettlementPlan, mergeOverlay };
