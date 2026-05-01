// scripts/diagnose-product-master.mjs
// Product 마스터 BoxWeight / SteamOf1Bunch / BoxCBM 누락 정밀 진단
//
// 목적: 운송원가 정확도의 데이터 입력 단계 보강. "Product 100% 매칭" 작업의 첫 단계.
//
// 출력:
//   1. 누락 ProdKey 카테고리/국가/농장별 집계
//   2. Flower 마스터에 값 있는 카테고리 (자동 백필 가능 후보)
//   3. 미지정 (FlowerName 빈/'기타') ProdKey
//   4. 최근 입고된 ProdKey 우선순위 (사용 빈도)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlImport from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}
const sql = sqlImport;

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  // 1. Flower 마스터 — 어떤 카테고리에 값 있는지
  const fRes = await pool.request().query(`
    SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff
    FROM Flower WHERE isDeleted=0 ORDER BY FlowerName
  `);
  console.log('# 1. Flower 마스터 (자동 백필 후보)\n');
  console.log('| FlowerName | BoxWeight | BoxCBM | StemsPerBox |');
  console.log('|---|---|---|---|');
  for (const f of fRes.recordset) {
    console.log(`| ${f.FlowerName} | ${f.BoxWeight ?? '-'} | ${f.BoxCBM ?? '-'} | ${f.StemsPerBox ?? '-'} |`);
  }

  const flowerHasBW = fRes.recordset.filter(f => f.BoxWeight && f.BoxWeight > 0);
  const flowerHasCBM = fRes.recordset.filter(f => f.BoxCBM && f.BoxCBM > 0);
  console.log(`\n→ BoxWeight 값 있는 카테고리: ${flowerHasBW.length}/${fRes.recordset.length}`);
  console.log(`→ BoxCBM 값 있는 카테고리: ${flowerHasCBM.length}/${fRes.recordset.length}`);

  // 2. Product 마스터 누락 현황 — 운송원가 사용 빈도순 (최근 90일 입고에 등장한 ProdKey)
  const pRes = await pool.request().query(`
    SELECT TOP 5000
      p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
      p.BoxWeight, p.BoxCBM, p.SteamOf1Bunch, p.BunchOf1Box, p.SteamOf1Box,
      ISNULL(usage.UseCount, 0) AS UseCount
    FROM Product p
    LEFT JOIN (
      SELECT wd.ProdKey, COUNT(*) AS UseCount
      FROM WarehouseDetail wd
      INNER JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
      WHERE wm.isDeleted=0
        AND wm.InputDate >= DATEADD(DAY, -90, GETDATE())
        AND wd.ProdKey IS NOT NULL
      GROUP BY wd.ProdKey
    ) usage ON p.ProdKey = usage.ProdKey
    WHERE p.isDeleted=0 AND usage.UseCount > 0
    ORDER BY usage.UseCount DESC
  `);

  const products = pRes.recordset;
  console.log(`\n# 2. 최근 90일 사용 ProdKey: ${products.length}건\n`);

  // 누락 분류
  const missingBW = products.filter(p => !p.BoxWeight || Number(p.BoxWeight) <= 0);
  const missingCBM = products.filter(p => !p.BoxCBM || Number(p.BoxCBM) <= 0);
  const missingSPB = products.filter(p => !p.SteamOf1Bunch || Number(p.SteamOf1Bunch) <= 0);
  const missingBPB = products.filter(p => !p.BunchOf1Box || Number(p.BunchOf1Box) <= 0);

  console.log(`| 필드 | 누락 / 전체 | % |`);
  console.log(`|---|---|---|`);
  console.log(`| BoxWeight | ${missingBW.length}/${products.length} | ${Math.round(missingBW.length/products.length*100)}% |`);
  console.log(`| BoxCBM | ${missingCBM.length}/${products.length} | ${Math.round(missingCBM.length/products.length*100)}% |`);
  console.log(`| SteamOf1Bunch | ${missingSPB.length}/${products.length} | ${Math.round(missingSPB.length/products.length*100)}% |`);
  console.log(`| BunchOf1Box | ${missingBPB.length}/${products.length} | ${Math.round(missingBPB.length/products.length*100)}% |`);

  // 3. 카테고리별 누락 분포
  const byFlower = new Map();
  for (const p of products) {
    const fn = (p.FlowerName || '__미지정__').trim() || '__미지정__';
    if (!byFlower.has(fn)) byFlower.set(fn, { total: 0, missingBW: 0, missingSPB: 0, missingCBM: 0, useCount: 0, samples: [] });
    const g = byFlower.get(fn);
    g.total++;
    g.useCount += p.UseCount;
    if (!p.BoxWeight || p.BoxWeight <= 0) g.missingBW++;
    if (!p.SteamOf1Bunch || p.SteamOf1Bunch <= 0) g.missingSPB++;
    if (!p.BoxCBM || p.BoxCBM <= 0) g.missingCBM++;
    if (g.samples.length < 3) g.samples.push(p);
  }

  console.log(`\n# 3. 카테고리별 누락 분포 (사용 빈도순)\n`);
  console.log('| FlowerName | 품목수 | 사용횟수 | BW누락 | SPB누락 | CBM누락 | Flower마스터 BW |');
  console.log('|---|---|---|---|---|---|---|');
  const flowerMap = new Map(fRes.recordset.map(f => [f.FlowerName, f]));
  const flowerSorted = [...byFlower.entries()].sort((a,b) => b[1].useCount - a[1].useCount);
  for (const [fn, g] of flowerSorted) {
    const fmaster = flowerMap.get(fn);
    const masterBW = fmaster?.BoxWeight ? `✓ ${fmaster.BoxWeight}` : '✗';
    console.log(`| ${fn} | ${g.total} | ${g.useCount} | ${g.missingBW} | ${g.missingSPB} | ${g.missingCBM} | ${masterBW} |`);
  }

  // 4. 미지정 카테고리 (FlowerName 빈/'기타') — AI/키워드 매칭 대상
  const unknownFlower = products.filter(p => {
    const fn = (p.FlowerName || '').trim();
    return !fn || fn === '기타' || fn === 'others' || fn === 'OTHERS';
  });
  console.log(`\n# 4. 미지정 카테고리 ProdKey: ${unknownFlower.length}건 (자동 분류 후보)\n`);
  console.log(`상위 20:`);
  for (const p of unknownFlower.slice(0, 20)) {
    console.log(`  ${p.ProdKey} | ${(p.ProdName||'').substring(0,50)} | "${p.FlowerName||''}" | ${p.CounName||''}`);
  }
  if (unknownFlower.length > 20) console.log(`  ... +${unknownFlower.length - 20}`);

  // 5. 자동 백필 후보 — Flower 마스터 BoxWeight 있는 카테고리 + Product BoxWeight 누락
  const autoFillBW = products.filter(p => {
    if (p.BoxWeight && p.BoxWeight > 0) return false;
    const f = flowerMap.get((p.FlowerName || '').trim());
    return f && f.BoxWeight && f.BoxWeight > 0;
  });
  console.log(`\n# 5. 자동 백필 가능 (Flower 마스터 BW → Product BW): ${autoFillBW.length}건\n`);
  // 카테고리별 카운트
  const autoFillByFlower = new Map();
  for (const p of autoFillBW) {
    const fn = p.FlowerName.trim();
    autoFillByFlower.set(fn, (autoFillByFlower.get(fn) || 0) + 1);
  }
  for (const [fn, count] of [...autoFillByFlower.entries()].sort((a,b) => b[1]-a[1])) {
    const f = flowerMap.get(fn);
    console.log(`  ${fn}: ${count}건 → ${f.BoxWeight}kg 적용`);
  }

  // 6. 자동 백필 불가 — Flower 마스터 값도 없음 (수동 입력 필요)
  const manualBW = products.filter(p => {
    if (p.BoxWeight && p.BoxWeight > 0) return false;
    const f = flowerMap.get((p.FlowerName || '').trim());
    return !f || !f.BoxWeight || f.BoxWeight <= 0;
  });
  console.log(`\n# 6. 수동 입력 필요 (Flower 마스터에도 값 없음): ${manualBW.length}건\n`);
  // 카테고리별 + 사용 빈도순 TOP 30
  const manualByFlower = new Map();
  for (const p of manualBW) {
    const fn = (p.FlowerName || '__미지정__').trim() || '__미지정__';
    if (!manualByFlower.has(fn)) manualByFlower.set(fn, []);
    manualByFlower.get(fn).push(p);
  }
  console.log(`카테고리별:`);
  for (const [fn, list] of [...manualByFlower.entries()].sort((a,b) => b[1].reduce((s,p)=>s+p.UseCount,0) - a[1].reduce((s,p)=>s+p.UseCount,0))) {
    const totalUse = list.reduce((s,p) => s+p.UseCount, 0);
    console.log(`  ${fn}: ${list.length}건 (사용 ${totalUse}회)`);
  }

  await pool.close();

  // 결과 JSON 저장 (자동 백필 스크립트가 사용)
  const outFile = path.join(__dirname, '..', 'data', 'product-master-diagnosis.json');
  fs.writeFileSync(outFile, JSON.stringify({
    summary: {
      totalProducts: products.length,
      missingBW: missingBW.length,
      missingCBM: missingCBM.length,
      missingSPB: missingSPB.length,
      missingBPB: missingBPB.length,
      autoFillBW: autoFillBW.length,
      manualBW: manualBW.length,
      unknownFlower: unknownFlower.length,
    },
    flowerMaster: fRes.recordset,
    byFlower: Object.fromEntries(byFlower),
    autoFillBW: autoFillBW.map(p => ({ ProdKey: p.ProdKey, ProdName: p.ProdName, FlowerName: p.FlowerName, suggestedBW: flowerMap.get(p.FlowerName.trim())?.BoxWeight, useCount: p.UseCount })),
    manualBW: manualBW.map(p => ({ ProdKey: p.ProdKey, ProdName: p.ProdName, FlowerName: p.FlowerName, CounName: p.CounName, useCount: p.UseCount })),
    unknownFlower: unknownFlower.map(p => ({ ProdKey: p.ProdKey, ProdName: p.ProdName, FlowerName: p.FlowerName, CounName: p.CounName, useCount: p.UseCount })),
  }, null, 2));
  console.log(`\n📄 진단 결과 저장: data/product-master-diagnosis.json`);
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
