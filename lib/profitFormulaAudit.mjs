// Independent report arithmetic. Do not import the production calculator here.
// Original workbook row/totals ranges, plus the approved AC/AJ adjustments.
export const FORMULA_COLUMNS = ['N','L','O','Q','R','S','H','E','F','AC','AJ','C','P','T','G','I','J','K','M','D','U'];
const ratios = new Set(['K','M','D','U']);
const noEnding = new Set(['이스라엘','뉴질랜드','일본']);
const tail = new Set(['공제','국내']);
const zero = v => v == null ? 0 : Number(v);
const valid = v => v == null || (typeof v === 'number' && Number.isFinite(v));
const divide = (n,d) => n == null || d == null || d === 0 ? null : n / d;
const same = (a,b,k) => a == null || b == null ? a == null && b == null
  : valid(a) && valid(b) && Math.abs(a-b) <= (ratios.has(k) ? 1e-9 : Math.max(1e-6, Math.abs(b)*1e-12));
const evidenceStatuses = new Set(['APPROVED_ESTIMATE','VERIFIED','VERIFIED_ARRIVAL_COST','VERIFIED_FREIGHT_ARRIVAL_CALC',
  'VERIFIED_CARRIED_ACQUISITION','VERIFIED_MIXED','VERIFIED_CATEGORY_AVERAGE','VERIFIED_SAMPLE_AVERAGE',
  'VERIFIED_HISTORICAL_WORKBOOK','VERIFIED_WORKBOOK_CATALOG','VERIFIED_CATEGORY_AVERAGE_FALLBACK',
  'VERIFIED_CARRIED_UNIT_COST','VERIFIED_SALES_PRICE_AUTO','VERIFIED_FIFO_PURCHASE']);

export function auditProfitFormulas(report, displayedRows, displayedTotals, edits = {}) {
  const issues = [], inputWarnings = [];
  let checked = 0;
  const compare = (category, column, actual, expected, formula) => {
    checked++;
    if (!valid(actual) || !valid(expected) || !same(actual, expected, column)) issues.push({
      category, column, actual: actual ?? null, expected: expected ?? null, formula,
      reason: actual === undefined ? '표시/저장 항목 누락' : '설계식으로 독립 계산한 값과 다름',
    });
  };
  if (!Array.isArray(report?.rows) || !report.rows.length || !Array.isArray(displayedRows) || !displayedTotals) {
    return { status: 'UNVERIFIED', checked: 0, issues: [], inputWarnings: [], reason: '비교할 보고서 행 또는 합계가 없습니다.' };
  }
  const expectedRows = report.rows.map(row => {
    const frozen = Boolean(report.confirmed || row.confirmed);
    const auto = row.auto || {}, manual = row.manual || {}, changes = edits[row.category] || {};
    const pick = k => changes[k] !== undefined ? (changes[k] === '' ? auto[k] ?? null : Number(changes[k]))
      : manual[k] != null ? Number(manual[k]) : auto[k] ?? null;
    const c = Object.fromEntries(['N','L','O','Q','E','F'].map(k => [k, auto[k] ?? null]));
    for (const k of ['R','H','S']) c[k] = pick(k);
    for (const k of ['AC','AJ']) c[k] = frozen ? row.calc?.[k] ?? null
      : changes[k] !== undefined ? (changes[k] === '' ? null : Number(changes[k])) : manual[k] == null ? null : Number(manual[k]);
    if (!frozen && row.stock?.snapshotConfirmed === true) {
      if (zero(row.stock.endQty) === 0) c.F = 0;
      else if (evidenceStatuses.has(row.stock.priceEvidenceStatus) && row.stock.evidenceValue != null) c.F = Number(row.stock.evidenceValue);
    }
    const missing = ['N','L','O','Q','E','F'].filter(k => c[k] === null);
    if ((zero(c.Q) !== 0 || zero(c.S) !== 0) && c.R === null) missing.push('R');
    const missingActualH = row.source?.H === 'actual_cost_missing' && c.H == null;
    if (missingActualH) missing.push('H');
    if (missing.length) inputWarnings.push({ category: row.category, columns: missing, reason: '원천 입력 누락. 해당 원가·이익 계산은 보류하며, 과거 확정본의 저장값은 변경하지 않습니다.' });
    if (frozen && ['AC','AJ'].some(k => !Object.hasOwn(row.calc || {}, k))) inputWarnings.push({
      category: row.category, columns: ['AC','AJ'], reason: '과거 확정본에 조정값이 보존되지 않았습니다. 현재 수기값으로 과거 조정을 추정하지 않습니다.',
    });
    c.C = zero(c.N)+zero(c.L)+zero(c.O)+zero(c.AC);
    c.P = zero(c.Q)*zero(c.R); c.T = zero(c.S)*zero(c.R); c.G = c.P+c.T;
    const special = noEnding.has(row.category);
    c.I = zero(c.E)+c.G+zero(c.H)-(special ? 0 : zero(c.F));
    c.J = c.C-c.I+(special ? zero(c.F) : 0)+zero(c.AJ);
    c.K = divide(c.J,c.C+(special ? zero(c.F) : 0)); c.M = divide(-zero(c.L),c.C);
    if (!frozen) {
      if (!(Number.isFinite(c.R) && c.R > 0)) {
        if (zero(c.Q) !== 0) c.P = null;
        if (zero(c.S) !== 0) c.T = null;
      }
      c.G = c.P == null || c.T == null ? null : c.P + c.T;
      if (missingActualH || c.G == null || c.E == null || (!special && c.F == null)) c.I = null;
      if (c.I == null || (special && c.F == null)) c.J = null;
      c.K = divide(c.J, c.C + (special ? zero(c.F) : 0));
    }
    return { category: row.category, calc: c };
  });
  const included = expectedRows.filter(r=>r.category !== '기타(미분류)');
  const component = included.filter(r=>!tail.has(r.category));
  const sum = (k, rows) => rows.reduce((n,r)=>n+zero(r.calc[k]),0);
  const totals = {};
  for (const k of ['C','E','F','J','AC','AJ']) totals[k] = sum(k,included);
  for (const k of ['G','H','I','L','N','O','P','Q','S','T']) totals[k] = sum(k,component);
  if (!report.confirmed) for (const k of ['E','F','J','G','I','P','T']) {
    if ((['E','F','J'].includes(k) ? included : component).some(r => r.calc[k] == null)) totals[k] = null;
  }
  if (!report.confirmed && report.rows.some(r => r.source?.H === 'actual_cost_missing'
    && expectedRows.find(e => e.category === r.category)?.calc.H == null)) totals.H = null;
  totals.K=divide(totals.J,totals.C+totals.F); totals.M=divide(-totals.L,totals.C);
  totals.D=divide(totals.C,totals.C);
  totals.U=divide(sum('P',component.filter(r=>r.category !== '베트남')),totals.P);
  const names = new Set();
  for (const row of expectedRows) {
    if (names.has(row.category)) issues.push({category:row.category,column:'category',reason:'중복 행으로 합계가 증폭될 수 있습니다.'});
    names.add(row.category);
    row.calc.D=divide(row.calc.C,totals.C); row.calc.U=divide(row.calc.P,totals.P);
    const actual=displayedRows.find(r=>r.category===row.category)?.calc || {};
    for (const k of FORMULA_COLUMNS) compare(row.category,k,actual[k],row.calc[k],
      k==='K' ? (noEnding.has(row.category)?'J/(C+F)':'J/C') : k==='D'?'C/총C':k==='U'?'P/총P':'원본 항목식 + 승인된 조정값');
  }
  for (const row of displayedRows) if (!names.has(row.category)) issues.push({category:row.category,column:'category',reason:'입력에 없는 표시 행'});
  for (const [k,v] of Object.entries(totals)) compare('전체 합계',k,displayedTotals[k],v,
    k==='K'?'총J/(총C+총F)':k==='U'?'베트남·공제·국내 제외 P/총P':'원본 열별 합산 범위');
  return { status: issues.length ? 'MISMATCH' : 'MATCH', checked, issues, inputWarnings,
    rowCount: expectedRows.length, note: '19개 본표 항목과 조정 2개·합계를 독립 대조합니다. 원가 원천·실사 및 과거 승인 정책의 정확성 인증은 아닙니다.' };
}
