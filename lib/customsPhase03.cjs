// Pure web cost policy. Never changes native receipts or historical phase 01/02.
const FIELDS = ['duty', 'serviceNet', 'serviceVat', 'disinfectionNet', 'disinfectionVat', 'importVat'];
const present = value => value !== null && value !== undefined && value !== '';
const LEGACY = Object.freeze({
  '2026|40-03|78469386914|중국': '01',
  '2026|41-03|99992374236|중국': '01',
  '2026|43-03|11290068602|중국': '01',
});
const identity = row => `${row.year}|${row.orderWeek}|${row.awb}|${row.category}`;
const legacyPhase = row => LEGACY[identity(row)] || null;
function fail(message) { throw Object.assign(Error(message), { statusCode: 422, code: 'CUSTOMS_PHASE03_INVALID' }); }
function validateEntry(row, year, major) {
  if (!row || row.year !== String(year) || row.orderWeek !== `${String(major).padStart(2, '0')}-03`
    || !/^20\d{2}$/.test(row.year) || !/^\d{11}$/.test(row.awb || '')
    || typeof row.category !== 'string' || !row.category.trim() || row.category.includes('|')
    || !row.costs || typeof row.costs !== 'object' || Array.isArray(row.costs)) fail('03차 연도·세부차수·AWB·국가를 확인하세요.');
  if (Object.keys(row.costs).some(f => !FIELDS.includes(f))) fail('허용되지 않은 03차 비용 항목입니다.');
  for (const value of Object.values(row.costs)) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('금액은 0 이상의 정수 또는 미입력이어야 합니다.');
  for (const stem of ['service', 'disinfection']) if (present(row.costs[`${stem}Net`]) !== present(row.costs[`${stem}Vat`])) fail('수수료·방역비는 공급가와 VAT를 함께 입력하세요. 면세는 VAT 0을 입력하세요.');
  return row;
}
function validateManual(entries, year, major) {
  if (entries === undefined) return;
  if (!Array.isArray(entries) || entries.length > 200) fail('03차 입력 원천 형식을 확인하세요.');
  const seen = new Set();
  for (const entry of entries) {
    validateEntry(entry, year, major);
    const key = identity(entry);
    if (seen.has(key) || legacyPhase(entry)) fail('중복 또는 기존 1차 반영 대상입니다.');
    seen.add(key);
  }
}
function documentCosts(documents) {
  const result = {};
  const add = (field, value) => { result[field] = (result[field] ?? 0) + value; };
  for (const doc of documents) for (const c of doc.charges) {
    if (c.code === 'DUTY') add('duty', c.total);
    else if (c.code === 'IMPORT_VAT') add('importVat', c.total);
    else if (['HANDLING', 'QUARANTINE_AGENCY'].includes(c.code)) { add('serviceNet', c.net); add('serviceVat', c.vat); }
    else if (c.code === 'DISINFECTION') { add('disinfectionNet', c.net); add('disinfectionVat', c.vat); }
  }
  return result;
}
function phase03Rows(ledger, category) {
  const groups = new Map();
  for (const doc of ledger.documents || []) {
    const [kind, cat, phase] = String(doc.targetKey).split('|');
    if (kind !== 'country' || phase !== '03' || category && cat !== category) continue;
    const row = { year: ledger.year, orderWeek: `${ledger.major}-03`, awb: String(doc.matchedAwb || doc.awb).replace(/[\s-]/g, ''), category: cat };
    const key = identity(row), group = groups.get(key) || { ...row, documents: [], manual: null };
    group.documents.push(doc); groups.set(key, group);
  }
  for (const manual of ledger.manualPhase03 || []) {
    if (category && manual.category !== category) continue;
    const key = identity(manual), group = groups.get(key) || { ...manual, documents: [] };
    group.manual = manual; groups.set(key, group);
  }
  return [...groups.values()].map(row => {
    const receipt = documentCosts(row.documents), costs = { ...receipt }, sources = {}, conflicts = [];
    for (const field of FIELDS) {
      if (present(row.manual?.costs[field])) {
        if (present(receipt[field]) && receipt[field] !== row.manual.costs[field]) conflicts.push(field);
        costs[field] = row.manual.costs[field]; sources[field] = 'manual';
      } else if (present(receipt[field])) sources[field] = 'settlement';
    }
    const costFields = ['duty', 'serviceNet', 'disinfectionNet', ...(row.category === '베트남' ? ['serviceVat'] : [])];
    return { ...row, costs, sources, conflicts, legacyPhase: legacyPhase(row),
      total: legacyPhase(row) ? 0 : costFields.some(field => present(costs[field])) ? costFields.reduce((sum, field) => sum + (costs[field] ?? 0), 0) : null };
  });
}
function phase03Totals(rows) {
  const costs = {};
  for (const row of rows || []) if (!row.legacyPhase) for (const field of FIELDS) if (present(row.costs[field])) costs[field] = (costs[field] ?? 0) + row.costs[field];
  return { costs, total: (rows || []).filter(row => !row.legacyPhase).reduce((sum,row)=>sum+(row.total ?? 0),0) };
}
function assertLegacyCovered(rows, saved) {
  for (const row of rows || []) if (row.legacyPhase && row.documents.length) {
    const read = stem => {
      const parts = [1, 2, 3].map(i => saved?.[`${stem}1_${i}`]);
      return parts.some(present) ? parts.reduce((sum, value) => sum + Number(value ?? 0), 0) : present(saved?.[`${stem}1`]) ? Number(saved[`${stem}1`]) : null;
    };
    const expectedFee = present(row.costs.serviceNet) ? row.costs.serviceNet + row.costs.serviceVat : null;
    if (present(row.costs.duty) && read('Customs') !== row.costs.duty || present(expectedFee) && read('SunYul') !== expectedFee
      || present(row.costs.disinfectionNet) && Number(saved?.Quarantine1) !== row.costs.disinfectionNet + row.costs.disinfectionVat) {
      throw Object.assign(Error('03차 정산서와 기존 1차 반영 금액이 달라 중복 여부 확인이 필요합니다.'), { statusCode: 409, code: 'CUSTOMS_PHASE03_LEGACY_CONFLICT' });
    }
  }
}
module.exports = { FIELDS, identity, legacyPhase, validateEntry, validateManual, phase03Rows, phase03Totals, assertLegacyCovered };
