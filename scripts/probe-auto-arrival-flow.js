/**
 * SQL → 도착원가 자동 파이프라인 검증 (Excel 업로드 없이)
 * node scripts/probe-auto-arrival-flow.js
 */
const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

(async () => {
  process.chdir(path.join(__dirname, '..'));
  const { getLatestWarehouseWeek, getArrivalCostsWithFallback } = await import('../lib/catalogArrival.js');
  const { query, sql } = await import('../lib/db.js');

  const year = '2026';
  const latest = await getLatestWarehouseWeek(year);
  console.log('최신 입고 차수:', latest);

  if (!latest) {
    console.log('FAIL: 입고 차수 없음');
    process.exit(1);
  }

  const fb = await getArrivalCostsWithFallback({
    orderYear: latest.orderYear,
    anchorWeek: latest.weekStart,
    maxWeeks: 12,
  });

  const keys = Object.keys(fb.map);
  console.log(`\n도착원가 자동 계산: ${keys.length}품목 (weeksScanned=${fb.weeksScanned}, fallback=${fb.fromFallback})`);

  const samples = keys.slice(0, 8).map(k => {
    const v = fb.map[k];
    return `  prodKey=${k} cost=${Math.round(v.arrivalCost)} unit=${v.displayUnit} src=${v.source} week=${v.arrivalWeek}`;
  });
  console.log(samples.join('\n'));

  // Cloudland / Holex / La Rosaleda 샘플
  const names = ['Mandala', 'Electric MO', 'Anthurium Graciosa', 'Banker Bush'];
  for (const term of names) {
    const r = await query(
      `SELECT TOP 1 p.ProdKey, p.ProdName FROM Product p WHERE p.isDeleted=0 AND p.ProdName LIKE @t`,
      { t: { type: sql.NVarChar, value: `%${term}%` } },
    );
    if (!r.recordset[0]) continue;
    const pk = r.recordset[0].ProdKey;
    const a = fb.map[pk];
    console.log(`\n${r.recordset[0].ProdName}:`);
    console.log(a ? `  도착원가=${Math.round(a.arrivalCost)} (${a.source}, ${a.arrivalWeek})` : '  도착원가=없음');
  }

  // 해당 차수 입고 품목 수 vs 도착원가 매칭
  const yws = latest.orderYear + latest.weekStart.replace(/-/g, '');
  const wh = await query(
    `SELECT COUNT(DISTINCT wd.ProdKey) AS cnt
     FROM WarehouseDetail wd
     JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
     JOIN Product p ON wd.ProdKey=p.ProdKey AND p.isDeleted=0
     WHERE wm.isDeleted=0
       AND (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) = @yws
       AND ISNULL(wd.OutQuantity,0) > 0
       AND p.ProdName NOT LIKE N'%운송%'
       AND p.ProdName NOT LIKE N'%weight%'`,
    { yws: { type: sql.NVarChar, value: yws } },
  );
  const inWeek = wh.recordset[0]?.cnt || 0;
  console.log(`\n최신차수 ${latest.weekStart} 입고품목(OutQty>0): ${inWeek}건`);
  console.log(`자동 도착원가 산출: ${keys.length}건`);
  console.log(inWeek > 0 && keys.length === 0 ? '\n⚠ 문제: 입고는 있는데 도착원가 0 — live 계산 실패 가능' : '\n✓ SQL 자동 파이프라인 동작');

  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
