// scripts/probe-pivot-arrival.js
// 차수 24-02 샘플 품목 3건에 대해 freight 탭 displayArrivalKRW vs pivot arrivalCost 를 병렬 조회해
// 수치 일치(±0.01 원) 여부를 확인한다. Read-only. DB 쓰기 없음.
//
// 실행: node scripts/probe-pivot-arrival.js

const fs   = require('fs');
const path = require('path');

// .env.local 로드
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const sql = require('mssql');
const cfg = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true,
               connectTimeout: 30000, requestTimeout: 60000 },
};

// 차수 설정
const PROBE_YEAR  = '2024';
const PROBE_WEEK  = '24-02';
const PROBE_YWS   = '202402'; // OrderYear + REPLACE(OrderWeek,'-','')

(async () => {
  const pool = await sql.connect(cfg);
  console.log('# DB:', process.env.DB_NAME);
  console.log(`# Probe: 차수 ${PROBE_YEAR}-${PROBE_WEEK} (yws=${PROBE_YWS})\n`);

  // ── Step 1: 해당 차수의 WarehouseMaster 찾기 ─────────────────────────────
  const wmRes = await pool.request().query(`
    SELECT TOP 20
      WarehouseKey, OrderNo, OrderYear, OrderWeek, FarmName,
      GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
    FROM WarehouseMaster
    WHERE (OrderYear + REPLACE(OrderWeek,'-','')) = '${PROBE_YWS}'
      AND isDeleted = 0
    ORDER BY WarehouseKey
  `);
  console.log(`[WarehouseMaster] 차수 ${PROBE_WEEK} 에 해당하는 WK ${wmRes.recordset.length}건:`);
  wmRes.recordset.forEach(r =>
    console.log(`  WK=${r.WarehouseKey} Farm=${r.FarmName} AWB=${r.OrderNo} GW=${r.GrossWeight} CW=${r.ChargeableWeight} Rate=${r.FreightRateUSD}`)
  );

  if (wmRes.recordset.length === 0) {
    console.log('\n  해당 차수 입고 데이터 없음. PROBE_YEAR/PROBE_WEEK 값을 실제 차수로 변경하세요.');
    await pool.close();
    return;
  }

  const allWkIds = wmRes.recordset.map(r => r.WarehouseKey);
  const wkCSV = allWkIds.join(',');

  // ── Step 2: 입고 품목 상위 3건 선택 ─────────────────────────────────────
  const detRes = await pool.request().query(`
    SELECT TOP 3
      wd.ProdKey, p.ProdName, p.OutUnit, p.FlowerName,
      SUM(ISNULL(wd.OutQuantity,0)) AS inQty
    FROM WarehouseDetail wd
    JOIN Product p ON wd.ProdKey = p.ProdKey AND p.isDeleted = 0
    WHERE wd.WarehouseKey IN (${wkCSV})
      AND p.ProdKey NOT IN (3100, 3101, 2182)  -- 특수행 제외
    GROUP BY wd.ProdKey, p.ProdName, p.OutUnit, p.FlowerName
    HAVING SUM(ISNULL(wd.OutQuantity,0)) > 0
    ORDER BY SUM(ISNULL(wd.OutQuantity,0)) DESC
  `);
  const sampleProds = detRes.recordset;
  console.log(`\n[샘플 품목] ${sampleProds.length}건:`);
  sampleProds.forEach(r =>
    console.log(`  ProdKey=${r.ProdKey} | ${r.ProdName} | Unit=${r.OutUnit} | Flower=${r.FlowerName} | inQty=${r.inQty}`)
  );

  if (sampleProds.length === 0) {
    console.log('\n  입고 품목 없음. PROBE_YEAR/PROBE_WEEK 를 변경하세요.');
    await pool.close();
    return;
  }

  const pkList = sampleProds.map(r => r.ProdKey);

  // ── Step 3: FreightCost 스냅샷 확인 ─────────────────────────────────────
  const fcRes = await pool.request().query(`
    SELECT TOP 1
      fc.FreightKey, fc.WarehouseKey, fc.ExchangeRate,
      fc.GrossWeight, fc.ChargeableWeight, fc.FreightRateUSD,
      fc.BakSangRate, fc.HandlingFee, fc.QuarantinePerItem, fc.DomesticFreight, fc.DeductFee
    FROM FreightCost fc
    WHERE fc.WarehouseKey IN (${wkCSV}) AND fc.isDeleted = 0
    ORDER BY fc.FreightKey DESC
  `);
  const snap = fcRes.recordset[0] || null;
  console.log(`\n[FreightCost 스냅샷] ${snap ? `FreightKey=${snap.FreightKey} ExRate=${snap.ExchangeRate}` : '없음 (live 계산 필요)'}`);

  // ── Step 4: FreightCostDetail 스냅샷 값 (있으면) ─────────────────────────
  let snapByPk = {};
  if (snap && pkList.length > 0) {
    const fdRes = await pool.request().query(`
      SELECT ProdKey, ArrivalPerStem, ArrivalPerBunch
      FROM FreightCostDetail
      WHERE FreightKey = ${snap.FreightKey}
        AND ProdKey IN (${pkList.join(',')})
    `);
    for (const r of fdRes.recordset) {
      snapByPk[r.ProdKey] = r;
    }
    console.log(`\n[FreightCostDetail 스냅샷] ProdKey 매칭 ${Object.keys(snapByPk).length}건`);
  }

  // ── Step 5: pivotFreightArrival.js 를 ESM dynamic import で呼び出し ─────
  // (CommonJS 스크립트에서 ESM import)
  let arrivalMap = {};
  try {
    const { getArrivalCostsForWeekRange } = await import('../lib/pivotFreightArrival.js');
    arrivalMap = await getArrivalCostsForWeekRange({
      weekStart: PROBE_WEEK,
      weekEnd: PROBE_WEEK,
      orderYear: PROBE_YEAR,
    });
  } catch (e) {
    console.error('\n  getArrivalCostsForWeekRange 오류:', e.message);
  }

  // ── Step 6: 비교 출력 ───────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(110));
  console.log(
    `${'ProdKey'.padEnd(10)}${'ProdName'.padEnd(30)}${'OutUnit'.padEnd(8)}` +
    `${'snap ArrPerStem'.padEnd(18)}${'snap ArrPerBunch'.padEnd(18)}` +
    `${'pivot arrivalCost'.padEnd(20)}${'displayUnit'.padEnd(12)}${'source'.padEnd(10)}${'parity'}`
  );
  console.log('─'.repeat(110));

  const fmt = (v) => v == null ? '      N/A' : String(Math.round(v)).padStart(9);

  for (const prod of sampleProds) {
    const pk  = prod.ProdKey;
    const sd  = snapByPk[pk];
    const ar  = arrivalMap[pk];

    const snapStem  = sd ? sd.ArrivalPerStem  : null;
    const snapBunch = sd ? sd.ArrivalPerBunch : null;
    const pivotCost = ar ? ar.arrivalCost     : null;
    const dispUnit  = ar ? ar.displayUnit     : prod.OutUnit || '-';
    const src       = ar ? ar.source          : '-';

    // 패리티 체크 — 스냅샷이 있으면 display 단위에 따라 비교
    let parityLabel = '-';
    if (ar && sd) {
      const ref = (dispUnit === '송이') ? snapStem : snapBunch;
      if (ref != null && pivotCost != null) {
        const diff = Math.abs(pivotCost - ref);
        parityLabel = diff < 1 ? `OK (diff=${diff.toFixed(2)})` : `MISMATCH (diff=${diff.toFixed(0)})`;
      }
    } else if (ar && !sd) {
      parityLabel = `live 계산 (snap 없음)`;
    }

    console.log(
      `${String(pk).padEnd(10)}${(prod.ProdName || '').slice(0, 28).padEnd(30)}${(prod.OutUnit || '').padEnd(8)}` +
      `${fmt(snapStem).padEnd(18)}${fmt(snapBunch).padEnd(18)}` +
      `${fmt(pivotCost).padEnd(20)}${dispUnit.padEnd(12)}${src.padEnd(10)}${parityLabel}`
    );
  }
  console.log('─'.repeat(110));
  console.log('\n[참고] 수치 일치 기준: ±1원 이내 (운송원가탭 표시값과 동일해야 함)');
  console.log('[참고] 스냅샷 없는 경우 live 계산이므로 freight 탭과 항상 동일.\n');

  await pool.close();
})().catch(e => { console.error('PROBE ERROR:', e.message, e.stack); process.exit(1); });
