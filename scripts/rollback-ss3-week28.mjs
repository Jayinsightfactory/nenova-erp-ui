#!/usr/bin/env node
/**
 * 28-01 nenovaSS3 오등록(2026-07-02 UTC = 7/3 새벽 KST '일괄 등록+분배') 롤백
 *   - OrderDetail(주문) + ShipmentDetail(분배) 양쪽을 SS3 delta 만큼 되돌린다.
 *   - 이후 다른 계정(nenovaSS2 등) 수정은 delta 차감 방식으로 보존.
 *   - 결과 <= 0 이면 행 삭제(주문: isDeleted=1 / 분배: 물리삭제+ShipmentDate 삭제).
 *   - 롤백 이력을 OrderHistory / ShipmentHistory 에 ChangeID='rollback-ss3' 로 기록.
 *
 * 사용법:
 *   node scripts/rollback-ss3-week28.mjs           # dry-run (변경 없음)
 *   node scripts/rollback-ss3-week28.mjs --apply   # 실제 적용 (트랜잭션)
 *   옵션: --raum-white-full  → 라움 White 는 SS2 추가분(+17)까지 전부 제거(=0)
 */
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const APPLY = process.argv.includes('--apply');
const RAUM_WHITE_FULL = process.argv.includes('--raum-white-full');
const ID = 'rollback-ss3';
const DESCR = '28-01 SS3 오등록 롤백(7/2)';

const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

console.log(`모드: ${APPLY ? '★ APPLY (실제 적용) ★' : 'DRY-RUN'}  라움White전체제거: ${RAUM_WHITE_FULL}\n`);

// ── 1) 주문(OrderDetail) 대상 ──────────────────────────────
const oh = await pool.request().query(`
  SELECT oh.OrderDetailKey, oh.BeforeValue, oh.AfterValue,
         od.OrderMasterKey, od.ProdKey, od.OutQuantity AS curOut, ISNULL(od.isDeleted,0) AS odDeleted,
         c.CustName, om.CustKey, p.ProdName
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE om.OrderWeek = '28-01' AND oh.ChangeID = 'nenovaSS3'
     AND CAST(oh.ChangeDtm AS DATE) = '2026-07-02'
   ORDER BY c.CustName`);

const orderPlan = new Map();
for (const r of oh.recordset) {
  const delta = Number(r.AfterValue) - Number(r.BeforeValue);
  if (!orderPlan.has(r.OrderDetailKey)) {
    orderPlan.set(r.OrderDetailKey, {
      OrderDetailKey: r.OrderDetailKey, OrderMasterKey: r.OrderMasterKey, ProdKey: r.ProdKey,
      CustName: r.CustName, ProdName: r.ProdName, curOut: Number(r.curOut), odDeleted: r.odDeleted, delta: 0,
    });
  }
  orderPlan.get(r.OrderDetailKey).delta += delta;
}

console.log(`=== [주문] OrderDetail ${orderPlan.size}건 ===`);
console.log('업체 | 품목 | 현재 | SS3delta | → 롤백후 | 처리');
console.log('-'.repeat(96));
const orders = [];
for (const e of orderPlan.values()) {
  let newOut = e.curOut - e.delta;
  const isRaumWhite = e.CustName.includes('라움') && (e.ProdName || '').includes('White');
  if (isRaumWhite && RAUM_WHITE_FULL) newOut = 0;
  const action = e.odDeleted ? '이미삭제' : (newOut <= 0.0001 ? 'DELETE' : 'UPDATE');
  orders.push({ ...e, newOut, action });
  console.log(`${(e.CustName || '').slice(0, 16).padEnd(17)} | ${(e.ProdName || '').slice(0, 22).padEnd(23)} | ${String(e.curOut).padStart(5)} | ${String(e.delta).padStart(6)} | ${String(newOut).padStart(6)} | ${action}${isRaumWhite ? ' ◀SS2+17' : ''}`);
}

// ── 2) 분배(ShipmentDetail) 대상 ──────────────────────────
const custKeys = [...new Set(oh.recordset.map(r => r.CustKey))].join(',');
const sh = await pool.request().query(`
  SELECT sh.SdetailKey, sh.BeforeValue, sh.AfterValue,
         sd.ShipmentKey, sd.ProdKey, ISNULL(sd.OutQuantity,0) AS curOut,
         c.CustName, p.ProdName
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Customer c ON sm.CustKey = c.CustKey
    LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
   WHERE sm.OrderWeek = '28-01' AND ISNULL(sm.isDeleted,0)=0
     AND sm.CustKey IN (${custKeys})
     AND sh.ChangeID = 'nenovaSS3' AND CAST(sh.ChangeDtm AS DATE) = '2026-07-02'
   ORDER BY c.CustName`);

const shipPlan = new Map();
for (const r of sh.recordset) {
  const delta = Number(r.AfterValue) - Number(r.BeforeValue);
  if (!shipPlan.has(r.SdetailKey)) {
    shipPlan.set(r.SdetailKey, {
      SdetailKey: r.SdetailKey, ShipmentKey: r.ShipmentKey, ProdKey: r.ProdKey,
      CustName: r.CustName, ProdName: r.ProdName, curOut: Number(r.curOut), delta: 0,
    });
  }
  shipPlan.get(r.SdetailKey).delta += delta;
}

console.log(`\n=== [분배] ShipmentDetail ${shipPlan.size}건 ===`);
console.log('업체 | 품목 | 현재 | SS3delta | → 롤백후 | 처리');
console.log('-'.repeat(96));
const ships = [];
for (const e of shipPlan.values()) {
  const newOut = e.curOut - e.delta;
  const action = newOut <= 0.0001 ? 'DELETE(물리)' : 'UPDATE';
  ships.push({ ...e, newOut, action });
  console.log(`${(e.CustName || '').slice(0, 16).padEnd(17)} | ${(e.ProdName || '').slice(0, 22).padEnd(23)} | ${String(e.curOut).padStart(5)} | ${String(e.delta).padStart(6)} | ${String(newOut).padStart(6)} | ${action}`);
}

const orderMasterKeys = [...new Set(orders.map(o => o.OrderMasterKey))];
const shipmentKeys = [...new Set(ships.map(s => s.ShipmentKey))];
console.log(`\n=== 요약 ===`);
console.log(`주문 OrderDetail: ${orders.length} (UPDATE ${orders.filter(o=>o.action==='UPDATE').length}, DELETE ${orders.filter(o=>o.action==='DELETE').length})`);
console.log(`분배 ShipmentDetail: ${ships.length} (UPDATE ${ships.filter(s=>s.action==='UPDATE').length}, DELETE ${ships.filter(s=>s.action.startsWith('DELETE')).length})`);
console.log(`영향 OrderMaster ${orderMasterKeys.length} / ShipmentMaster ${shipmentKeys.length}`);

if (!APPLY) {
  console.log('\nDRY-RUN 종료. 실제 적용: --apply');
  await pool.close();
  process.exit(0);
}

// ── APPLY ──────────────────────────────────────────────
const tx = new sql.Transaction(pool);
await tx.begin();
try {
  const R = () => new sql.Request(tx);
  // 주문
  for (const p of orders) {
    if (p.action === '이미삭제') continue;
    if (p.action === 'DELETE') {
      await R().input('dk', sql.Int, p.OrderDetailKey).query(
        `UPDATE OrderDetail SET BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,OutQuantity=0,EstQuantity=0,NoneOutQuantity=0,
           isDeleted=1, LastUpdateID='${ID}', LastUpdateDtm=GETDATE() WHERE OrderDetailKey=@dk`);
    } else {
      await R().input('dk', sql.Int, p.OrderDetailKey).input('oq', sql.Float, p.newOut).query(
        `UPDATE OrderDetail SET OutQuantity=@oq, EstQuantity=@oq, LastUpdateID='${ID}', LastUpdateDtm=GETDATE() WHERE OrderDetailKey=@dk`);
    }
    await R().input('dk', sql.Int, p.OrderDetailKey).input('b', sql.NVarChar, String(p.curOut)).input('a', sql.NVarChar, String(p.newOut))
      .input('descr', sql.NVarChar, DESCR).input('uid', sql.NVarChar, ID).query(
        `INSERT INTO OrderHistory (OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
         VALUES (@dk,N'수정',N'수량',@b,@a,@descr,@uid,GETDATE())`);
  }
  // 분배 (이력 먼저 기록 후 삭제)
  for (const p of ships) {
    await R().input('dk', sql.Int, p.SdetailKey).input('b', sql.NVarChar, String(p.curOut)).input('a', sql.NVarChar, String(p.newOut))
      .input('descr', sql.NVarChar, DESCR).input('uid', sql.NVarChar, ID).query(
        `INSERT INTO ShipmentHistory (SdetailKey,ShipmentDtm,ChangeType,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
         SELECT @dk,ShipmentDtm,N'수정',@b,@a,@descr,@uid,GETDATE() FROM ShipmentDetail WHERE SdetailKey=@dk`);
    if (p.action.startsWith('DELETE')) {
      await R().input('dk', sql.Int, p.SdetailKey).query(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`);
      await R().input('dk', sql.Int, p.SdetailKey).query(`DELETE FROM ShipmentDetail WHERE SdetailKey=@dk`);
    } else {
      await R().input('dk', sql.Int, p.SdetailKey).input('oq', sql.Float, p.newOut).query(
        `UPDATE ShipmentDetail SET OutQuantity=@oq, LastUpdateID='${ID}', LastUpdateDtm=GETDATE() WHERE SdetailKey=@dk`);
    }
  }
  // 빈 마스터 정리
  for (const mk of orderMasterKeys) {
    await R().input('mk', sql.Int, mk).query(
      `UPDATE OrderMaster SET isDeleted=1, LastUpdateID='${ID}', LastUpdateDtm=GETDATE()
        WHERE OrderMasterKey=@mk AND ISNULL(isDeleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM OrderDetail WHERE OrderMasterKey=@mk AND ISNULL(isDeleted,0)=0)`);
  }
  for (const sk of shipmentKeys) {
    await R().input('sk', sql.Int, sk).query(
      `UPDATE ShipmentMaster SET isDeleted=1, LastUpdateID='${ID}', LastUpdateDtm=GETDATE()
        WHERE ShipmentKey=@sk AND ISNULL(isDeleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM ShipmentDetail WHERE ShipmentKey=@sk)`);
  }
  await tx.commit();
  console.log('\n✅ 커밋 완료 — 주문+분배 롤백 적용.');
} catch (e) {
  await tx.rollback();
  console.error('\n❌ 오류로 트랜잭션 취소:', e.message);
  process.exitCode = 1;
}
await pool.close();
