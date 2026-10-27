// Pure, read-only comparison. A saved report is evidence, never a target to overwrite.
import { TOTALS_EXCLUDED_CATEGORIES, WORKBOOK_TAIL_CATEGORIES } from './profitReportCalc.js';
const columns = ['N', 'L', 'O'];
const totalExcluded = [...TOTALS_EXCLUDED_CATEGORIES, ...WORKBOOK_TAIL_CATEGORIES];
const known = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const equal = (a, b) => known(a) && known(b) && Math.abs(Number(a) - Number(b)) <= 0.01;
function sum(rows) { return rows.every(r => known(r.amount)) ? rows.reduce((n, r) => n + Number(r.amount), 0) : null; }

export function buildMarginReconciliation({ periods, asOf, classification = null }) {
  const entries = [], summaries = [];
  for (const { side, scope, rows, stored } of periods) {
    const categories = [...new Set([...stored.rows.map(r => r.category), ...rows.map(r => r.category)])];
    const comparisons = [];
    for (const category of categories) for (const column of columns) {
      const report = stored.rows.find(r => r.category === category);
      const selected = rows.filter(r => r.category === category && r.kind === column);
      const baseRows = rows.filter(r => (r.baseCategory ?? r.category) === category && r.kind === column);
      const sqlValue = sum(selected), baseSqlValue = sum(baseRows);
      const reported = known(report?.calc?.[column]) ? Number(report.calc[column]) : null;
      const delta = known(sqlValue) && reported !== null ? sqlValue - reported : null;
      const classificationDelta = known(sqlValue) && known(baseSqlValue) ? sqlValue - baseSqlValue : null;
      const status = delta === null ? 'incomplete' : equal(sqlValue, reported) ? 'match' : 'different';
      const reason = !report ? 'STORED_CATEGORY_MISSING' : reported === null ? 'STORED_AMOUNT_MISSING'
        : sqlValue === null ? 'SQL_AMOUNT_MISSING' : status === 'match' ? 'MATCH'
        : !equal(classificationDelta, 0) && equal(baseSqlValue, reported) ? 'CURRENT_CLASSIFICATION_EXPLAINS_DELTA' : 'SOURCE_COMPARISON_REQUIRED';
      const entry = { side, year: scope.year, major: scope.major, category, column, sqlValue, baseSqlValue,
        reported, delta, classificationDelta, rowCount: selected.length, status, reason };
      comparisons.push(entry); entries.push(entry);
    }
    const totals = columns.map(column => {
      // The existing workbook N/L/O total intentionally excludes audit/tail rows.
      // Keep both universes visible; do not invent a difference by comparing unlike scopes.
      const columnRows = rows.filter(r => r.kind === column);
      const sqlValue = sum(columnRows.filter(r => !totalExcluded.includes(r.category)));
      const allSqlValue = sum(columnRows), excludedSqlValue = sum(columnRows.filter(r => totalExcluded.includes(r.category)));
      const reported = known(stored.totals?.[column]) ? Number(stored.totals[column]) : null;
      const categoryEntries = comparisons.filter(r => r.column === column);
      return { column, sqlValue, allSqlValue, excludedSqlValue, excludedCategories:totalExcluded,
        reported, delta: known(sqlValue) && reported !== null ? sqlValue - reported : null,
        differingCategories: categoryEntries.filter(r => r.status === 'different').length,
        incompleteCategories: categoryEntries.filter(r => r.status === 'incomplete').length };
    });
    const observed = new Map(), effects = new Map();
    for (const row of rows) {
      const identity = { year: row.sourceYear ?? scope.year, week: row.sourceWeek ?? null,
        rawYearWeek: row.sourceYearWeek ?? null, table: row.sourceTable ?? null };
      const identityKey = JSON.stringify(identity);
      observed.set(identityKey, { ...identity, rowCount: (observed.get(identityKey)?.rowCount || 0) + 1 });
      if (!row.baseCategory || row.baseCategory === row.category) continue;
      const key = JSON.stringify([row.baseCategory, row.category, row.kind]);
      const effect = effects.get(key) || { baseCategory: row.baseCategory, category: row.category, column: row.kind,
        amount: 0, amountComplete: true, rowCount: 0, keys: new Set() };
      effect.rowCount++; effect.keys.add(row.prodKey);
      if (known(row.amount)) effect.amount += Number(row.amount); else effect.amountComplete = false;
      effects.set(key, effect);
    }
    const different = comparisons.filter(r => r.status === 'different').length;
    const incomplete = comparisons.filter(r => r.status === 'incomplete').length;
    const totalDifferent = totals.some(r => r.delta !== null && !equal(r.delta, 0));
    const totalIncomplete = totals.some(r => r.delta === null);
    summaries.push({ side, scope, source: stored.source, storedAt: stored.asOf, provenance: stored.provenance ?? null,
      status: different || totalDifferent ? 'different' : incomplete || totalIncomplete ? 'incomplete' : 'match',
      different, incomplete, totals, observedScopes: [...observed.values()], scopeCoverage: rows.scopeCoverage ?? {},
      classificationEffects: [...effects.values()].map(({ keys, ...effect }) => ({ ...effect,
        amount: effect.amountComplete ? effect.amount : null, productCount: keys.size,
        sampleProdKeys: [...keys].sort((a,b) => a-b).slice(0, 10), omittedProductCount: Math.max(0, keys.size - 10) })),
      interpretation: different && !totalDifferent && !totalIncomplete && !incomplete ? 'CATEGORY_REDISTRIBUTION_CANDIDATE'
        : different || totalDifferent ? 'TOTAL_OR_SOURCE_SCOPE_DIFFERENCE' : incomplete || totalIncomplete ? 'INCOMPLETE_EVIDENCE' : 'MATCH',
    });
  }
  return { entries, summaries, asOf, atomicSnapshot: false, classification,
    note: '저장본을 현재 SQL에 맞춰 수정하지 않았습니다. 분류 이동과 조회시점 차이는 원천 변경 이력이 없으면 과거 발생 원인으로 단정할 수 없습니다.' };
}
