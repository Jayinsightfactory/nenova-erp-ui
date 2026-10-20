import { CATEGORIES, classifyCategory, isNonStockableItem, isNonValueWeightItem } from './profitReportClassification.js';

const columns = ['N', 'L', 'O', 'Q'];
const value = x => x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
const fixed = x => x === true || x === 1;

/** Independent raw-ledger reduction: never consumes the report's aggregates or calculation helpers. */
export function aggregateSqlLineage(data, scope, integrity = {}) {
  const products = new Map((data.products || []).map(p => [Number(p.ProdKey), p]));
  const codes = new Map();
  for (const c of data.financeCodes || []) {
    const matches = codes.get(c.DetailCode) || [];
    matches.push(c.Descr2); codes.set(c.DetailCode, matches);
  }
  const weeks = {};
  for (let n = 1; n <= Number(scope.major); n++) weeks[String(n).padStart(2, '0')] = {
    orderYear: String(scope.year), major: String(n).padStart(2, '0'), categories: {},
    excludedKeyCount: 0, excludedAmounts: { N: 0, L: 0, O: 0 }, problems: [],
    integrityStatus: integrity.status || 'UNVERIFIED',
  };
  const allowed = new Set([...CATEGORIES.filter(c => !c.manualOnly).map(c => c.key), '국내']);
  const category = p => {
    const override = data.categoryOverrides?.[String(p.ProdKey)]?.category;
    return allowed.has(override) ? override : classifyCategory(p.CounName, p.FlowerName, p.ProdName);
  };
  function add(r, kind) {
    if (String(r.OrderYear) !== String(scope.year)) return;
    const match = /^(\d{2})-\d{2}(?:[A-Z])?$/.exec(String(r.OrderWeek));
    if (!match || !weeks[match[1]]) return;
    const week = weeks[match[1]], p = products.get(Number(r.ProdKey)) || {};
    if (isNonValueWeightItem(p.ProdName) || (kind === 'purchase' && isNonStockableItem(p.ProdName))) return;
    if (kind !== 'purchase' && !fixed(r.MasterFix)) return;
    if (kind === 'sale' && (!fixed(r.DetailFix) || Number(r.ZeroQuantity) === 1)) return;
    const code = codes.get(r.EstimateType) || [];
    const col = kind === 'purchase' ? 'Q' : kind === 'sale'
      ? /운송료|현지상차\s*운임/.test(p.ProdName || '') ? 'O' : 'N'
      : code[0] === '불량차감' ? 'L' : 'O';
    const amount = value(r.Amount);
    if (amount === null) { week.problems.push('SQL 금액 값이 누락되어 0으로 대체하지 않았습니다.'); return; }
    if (kind !== 'purchase' && String(r.OrderYearWeek || '') !== `${scope.year}${match[1]}`) {
      week.excludedKeyCount += Number(r.SourceRows || 1); week.excludedAmounts[col] += amount; return;
    }
    if (kind === 'estimate' && code.length > 1) week.problems.push('EstimateType 코드가 중복되어 차감 분류와 SQL JOIN 증폭을 확인해야 합니다.');
    const c = category(p);
    if (!c) return;
    const sums = week.categories[c] ||= { N: 0, L: 0, O: 0, Q: 0 };
    sums[col] += amount;
  }
  for (const r of data.financeSales || []) add(r, 'sale');
  for (const r of data.financeEstimates || []) add(r, 'estimate');
  for (const r of data.financePurchases || []) add(r, 'purchase');
  for (const w of Object.values(weeks)) w.problems = [...new Set(w.problems)];
  return weeks;
}

export function auditReportSqlLineage(report, source) {
  const limitations = 'SQL 원행 대사 범위는 순수매출 N·불량차감 L·기타매출 O·외화매입 Q입니다. 기초/기말 평가금액 E/F, 통관비 H, 환율 R, 포워딩 S의 근거 완전성은 별도 확인 대상입니다.';
  if (!source) return { status: 'UNVERIFIED', checked: 0, differences: [], limitations };
  if (report.confirmed || report.snapshot?.servedFrom === 'snapshot') return { status: 'HISTORICAL', checked: 0, differences: [], limitations };
  const differences = [], seen = new Set(); let checked = 0;
  for (const row of report.rows || []) {
    seen.add(row.category);
    const raw = source.categories[row.category] || {};
    for (const col of columns) {
      checked++; const actual = value(row.auto?.[col]), expected = raw[col] ?? 0;
      if (actual === null || Math.abs(actual - expected) > 0.01) differences.push({ category: row.category, col, sql: expected, web: actual });
    }
  }
  for (const [category, raw] of Object.entries(source.categories)) {
    if (!seen.has(category)) for (const col of columns) if (Math.abs(raw[col] || 0) > 0.01) differences.push({ category, col, sql: raw[col], web: null });
  }
  const status = source.integrityStatus !== 'STABLE_OBSERVED' || source.problems.length ? 'UNVERIFIED'
    : differences.length ? 'MISMATCH' : checked ? 'MATCH' : 'UNVERIFIED';
  const inventoryIssues = [];
  for (const row of report.rows || []) for (const [side, field] of [['begin', 'beginStock'], ['end', 'stock']]) {
    for (const item of row[field]?.missingPriceItems || []) {
      const evidence = source.purchaseCoverage?.[side]?.[String(item.prodKey)];
      inventoryIssues.push({ category: row.category, side, name: item.displayName || item.prodName,
        reason: !evidence || evidence.status === 'OUTSIDE_SCOPE' ? '이 재고 시점의 매입 원행은 현재 연도 조회 범위 밖이므로 미검증입니다.'
          : evidence.status === 'AMBIGUOUS_PURCHASE_WEEK' ? '비표준 세부차수 매입이 있어 재고 시점과의 선후관계를 확정하지 않았습니다. 매입 연결을 확인해야 합니다.'
          : evidence.status === 'PURCHASE_PRESENT' ? `SQL에 ${evidence.week} 매입금액이 있습니다. 재고단가로 채택되지 않은 단위·환율·도착원가 연결을 확인해야 합니다. 매입 자체가 없다는 뜻이 아닙니다.`
            : '같은 연도에서 이 재고 시점까지 양수 상품매입 금액행을 찾지 못했습니다. 이전 연도 취득·재고조정·품목 연결을 확인해야 하며 미래 매입단가로 채우지 않습니다.' });
    }
  }
  return { status, checked, differences, inventoryIssues, excludedKeyCount: source.excludedKeyCount, excludedAmounts: source.excludedAmounts, problems: source.problems, limitations };
}

/** SQL purchase existence is not cost verification. Keep cutoff/year explicit. */
export function inventoryPurchaseCoverage(snapshot, purchases, scopeYear) {
  const out = {};
  for (const category of Object.values(snapshot?.categories || {})) for (const item of category.items || []) {
    if (snapshot.year !== String(scopeYear)) { out[item.prodKey] = {status:'OUTSIDE_SCOPE'}; continue; }
    const candidates = purchases.filter(r => String(r.OrderYear) === snapshot.year && Number(r.ProdKey) === item.prodKey && Number(r.Amount) > 0);
    const rows = candidates.filter(r => /^\d{2}-\d{2}$/.test(r.OrderWeek) && r.OrderWeek <= snapshot.week);
    rows.sort((a,b) => b.OrderWeek.localeCompare(a.OrderWeek));
    out[item.prodKey] = rows.length ? {status:'PURCHASE_PRESENT',week:rows[0].OrderWeek}
      : candidates.some(r => !/^\d{2}-\d{2}$/.test(r.OrderWeek) && String(r.OrderWeek).slice(0,2) <= snapshot.week.slice(0,2))
        ? {status:'AMBIGUOUS_PURCHASE_WEEK'} : {status:'NO_PURCHASE_AT_CUTOFF'};
  }
  return out;
}
