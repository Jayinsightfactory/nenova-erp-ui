#!/usr/bin/env node
// 자동 주문 실행기 시험 러너 (여분코드 전용). 사장님 승인 범위: CustKey 1, 2026 41-01, 시험 4~10, 넣은 주문 즉시 취소.
//   node scripts/order-exec-trial.mjs            → dry (계획만 출력, DB 쓰기 없음)
//   node scripts/order-exec-trial.mjs --live     → 실행(로컬 서버 ORDER_EXEC_BASE_URL 의 POST /api/orders 경유)
// 절차: verify:week snapshot → 시험별 실행 → 대조 → 즉시 취소 → verify:week --diff/불변식, ProductStock·고스트 비교.
// 예상과 다르면 즉시 중단하고, 그때까지 적용된 실행분은 cancelPlan 으로 되돌린다.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import jwt from 'jsonwebtoken';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
process.chdir(root);
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2];
}
const LIVE = process.argv.includes('--live');
const CUST = 1, YEAR = '2026', WEEK = '41-01', MAJOR = '41';
const BASE_URL = process.env.ORDER_EXEC_BASE_URL || 'http://localhost:3917';
const RUN = `trial-${Date.now().toString(36)}`;

const { query, sql, getPool } = await import('../lib/db.js');
const ex = await import('../lib/orderExecutor.js');
const { assertWebSchemaContract } = await import('../lib/webSchemaContract.js');

const token = jwt.sign({ userId: 'admin', userName: '관리자', authority: 0 }, process.env.JWT_SECRET || 'nenova-dev-only-secret-change-me', { expiresIn: '30m' });
const deps = {
  query, sql,
  allowedScope: { custKey: CUST, year: YEAR },
  postOrder: ex.httpPostOrder({ baseUrl: BASE_URL, token }),
  assertLedgerSchema: () => assertWebSchemaContract('order-executor', [{ table: ex.LEDGER_TABLE, columns: ex.LEDGER_COLUMNS }]),
};

const results = [];
const outstanding = new Set(); // 실행됐지만 아직 취소 안 된 requestId
function check(cond, msg) { if (!cond) throw Object.assign(new Error(`예상과 다름: ${msg}`), { code: 'TRIAL_UNEXPECTED' }); }
const verifyWeek = (...a) => execFileSync(process.execPath, ['scripts/verify-week.mjs', `${YEAR}-${MAJOR}`, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function custState() {
  const r = await query(
    `SELECT om.OrderMasterKey, ISNULL(om.isDeleted,0) AS mDel, od.OrderDetailKey, od.ProdKey, ISNULL(od.isDeleted,0) AS dDel,
            od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
       FROM OrderMaster om LEFT JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      WHERE om.CustKey=@ck AND om.OrderYear=@y AND om.OrderWeek=@w ORDER BY od.OrderDetailKey`,
    { ck: { type: sql.Int, value: CUST }, y: { type: sql.NVarChar, value: YEAR }, w: { type: sql.NVarChar, value: WEEK } });
  const ship = await query(`SELECT COUNT(*) AS N FROM ShipmentMaster WHERE CustKey=@ck AND OrderYear=@y AND OrderWeek LIKE @w`,
    { ck: { type: sql.Int, value: CUST }, y: { type: sql.NVarChar, value: YEAR }, w: { type: sql.NVarChar, value: `${MAJOR}-%` } });
  const live = r.recordset.filter((x) => x.OrderDetailKey && !Number(x.dDel)).length;
  const masters = [...new Set(r.recordset.map((x) => x.OrderMasterKey))];
  const liveMasters = [...new Set(r.recordset.filter((x) => !Number(x.mDel)).map((x) => x.OrderMasterKey))];
  return { live, masters, liveMasters, shipmentMasters: Number(ship.recordset[0].N), rows: r.recordset.length };
}

async function stockSnapshot(prodKeys) {
  if (!prodKeys.length) return '';
  const r = await query(
    `SELECT sm.OrderWeek, ps.ProdKey, ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE sm.OrderYear=@y AND ps.ProdKey IN (${prodKeys.map(Number).join(',')}) ORDER BY sm.OrderWeek, ps.ProdKey`,
    { y: { type: sql.NVarChar, value: YEAR } });
  return JSON.stringify(r.recordset);
}

async function pickSourceOrders() {
  // 직원이 실제 입력한 최근 주문(같은 저장 묶음 = 마스터+입력자+분) 4건, 거래처 서로 다르게, 품목 2~6개, 정수 수량.
  const r = await query(`
    WITH b AS (
      SELECT om.OrderMasterKey, om.CustKey, om.OrderWeek, od.CreateID, CONVERT(char(16), od.CreateDtm, 120) AS Batch,
             COUNT(*) AS N, MAX(od.CreateDtm) AS LastDtm,
             SUM(CASE WHEN od.OutQuantity <> FLOOR(od.OutQuantity) THEN 1 ELSE 0 END) AS Frac
        FROM OrderDetail od JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey
       WHERE om.OrderYear=@y AND om.CustKey<>@ck AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
         AND od.OutQuantity>0 AND od.CreateDtm >= DATEADD(day,-14,GETDATE()) AND od.CreateID LIKE N'nenova%'
       GROUP BY om.OrderMasterKey, om.CustKey, om.OrderWeek, od.CreateID, CONVERT(char(16), od.CreateDtm, 120))
    SELECT TOP 40 * FROM b WHERE N BETWEEN 2 AND 6 AND Frac=0 ORDER BY LastDtm DESC`,
    { y: { type: sql.NVarChar, value: YEAR }, ck: { type: sql.Int, value: CUST } });
  const picks = [];
  for (const b of r.recordset) {
    if (picks.some((p) => p.CustKey === b.CustKey)) continue;
    const d = await query(
      `SELECT od.ProdKey, p.OutUnit, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
         FROM OrderDetail od JOIN Product p ON p.ProdKey=od.ProdKey
        WHERE od.OrderMasterKey=@mk AND ISNULL(od.isDeleted,0)=0 AND od.OutQuantity>0 AND od.CreateID=@cid
          AND CONVERT(char(16), od.CreateDtm, 120)=@b ORDER BY od.OrderDetailKey`,
      { mk: { type: sql.Int, value: b.OrderMasterKey }, cid: { type: sql.NVarChar, value: b.CreateID }, b: { type: sql.NVarChar, value: b.Batch } });
    const prods = new Set(d.recordset.map((x) => x.ProdKey));
    if (prods.size !== d.recordset.length) continue; // 같은 품목 중복행 묶음은 제외
    picks.push({ ...b, details: d.recordset });
    if (picks.length === 4) break;
  }
  return picks;
}

async function readRows(prodKeys) {
  const r = await query(
    `SELECT od.ProdKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
       FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      WHERE om.CustKey=@ck AND om.OrderYear=@y AND om.OrderWeek=@w AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
        AND od.ProdKey IN (${prodKeys.map(Number).join(',')})`,
    { ck: { type: sql.Int, value: CUST }, y: { type: sql.NVarChar, value: YEAR }, w: { type: sql.NVarChar, value: WEEK } });
  return new Map(r.recordset.map((x) => [x.ProdKey, x]));
}
const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-6;

async function exec(requestId, items) {
  const r = await ex.executePlan(deps, { custKey: CUST, year: YEAR, week: WEEK, requestId, items, mode: LIVE ? 'live' : 'dry' });
  if (LIVE && r.status === 'DONE') outstanding.add(requestId);
  return r;
}
async function cancel(requestId) {
  const r = await ex.cancelPlan(deps, requestId);
  check(['DONE', 'NOOP'].includes(r.status), `취소 상태 ${r.status}`);
  outstanding.delete(requestId);
  return r;
}

async function main() {
  console.log(`[trial] run=${RUN} mode=${LIVE ? 'LIVE' : 'DRY'} scope=CustKey ${CUST} ${YEAR} ${WEEK}`);
  const before = await custState();
  check(before.live === 0 && before.shipmentMasters === 0, `시작 상태가 비어있지 않음 ${JSON.stringify(before)}`);
  const sources = await pickSourceOrders();
  check(sources.length === 4, `원본 주문 4건 확보 실패(${sources.length})`);
  const allProds = [...new Set(sources.flatMap((s) => s.details.map((d) => d.ProdKey)))];
  const stockBefore = await stockSnapshot(allProds);
  if (LIVE) console.log(verifyWeek('--snapshot').split(/\r?\n/).filter(Boolean).slice(-2).join('\n'));

  // 시험 4~7: 원본 재현 → 대조 → 취소
  for (let i = 0; i < 4; i++) {
    const s = sources[i];
    const no = 4 + i;
    const items = s.details.map((d) => ({ prodKey: d.ProdKey, unit: d.OutUnit || '박스', qty: Number(d.OutQuantity) }));
    const rid = `${RUN}-t${no}`;
    const r = await exec(rid, items);
    if (!LIVE) { results.push({ no, src: `cust${s.CustKey} mk${s.OrderMasterKey} ${s.OrderWeek} ${s.CreateID}`, status: r.status, items: items.length }); continue; }
    check(r.status === 'DONE', `t${no} 상태 ${r.status}`);
    const rows = await readRows(items.map((x) => x.prodKey));
    const mism = [];
    for (const d of s.details) {
      const w = rows.get(d.ProdKey);
      for (const c of ['BoxQuantity', 'BunchQuantity', 'SteamQuantity', 'OutQuantity']) if (!w || !near(w[c], d[c])) mism.push(`${d.ProdKey}.${c} 원본${d[c]}≠재현${w?.[c]}`);
    }
    await cancel(rid);
    const after = await custState();
    check(after.live === 0, `t${no} 취소 후 잔여 ${after.live}`);
    check(mism.length === 0, `t${no} 원본 대조 불일치: ${mism.join(', ')}`);
    results.push({ no, src: `cust${s.CustKey} mk${s.OrderMasterKey} ${s.OrderWeek} ${s.CreateID}`, items: items.length, match: 'OK', cancel: 'OK' });
  }

  const probeProd = sources[0].details[0];
  const unit = probeProd.OutUnit || '박스';

  // 시험 8: 같은 requestId 2회
  {
    const rid = `${RUN}-t8`;
    const r1 = await exec(rid, [{ prodKey: probeProd.ProdKey, unit, qty: 2 }]);
    const r2 = await exec(rid, [{ prodKey: probeProd.ProdKey, unit, qty: 2 }]);
    if (LIVE) {
      const q = (await readRows([probeProd.ProdKey])).get(probeProd.ProdKey);
      check(r1.status === 'DONE' && r2.status === 'SKIPPED_DUPLICATE', `t8 ${r1.status}/${r2.status}`);
      check(near(q?.[unit === '단' ? 'BunchQuantity' : unit === '송이' ? 'SteamQuantity' : 'BoxQuantity'], 2), 't8 수량 2 아님(가산 의심)');
      await cancel(rid);
      check((await custState()).live === 0, 't8 취소 후 잔여');
    }
    results.push({ no: 8, first: r1.status, second: r2.status, cancel: LIVE ? 'OK' : '-' });
  }

  // 시험 9: 범위 위반 거부 + DB 무변화
  {
    const st0 = JSON.stringify(await custState());
    const codes = [];
    for (const bad of [{ custKey: 2, year: YEAR }, { custKey: CUST, year: '2025' }]) {
      try {
        await ex.executePlan(deps, { ...bad, week: WEEK, requestId: `${RUN}-t9-${bad.custKey}-${bad.year}`, items: [{ prodKey: probeProd.ProdKey, unit, qty: 1 }], mode: 'live' });
        codes.push('ACCEPTED');
      } catch (e) { codes.push(e.code); }
    }
    const st1 = JSON.stringify(await custState());
    const led = await query(`SELECT COUNT(*) AS N FROM ${ex.LEDGER_TABLE} WHERE RequestId LIKE @p`, { p: { type: sql.NVarChar, value: `${RUN}-t9%` } }).catch(() => ({ recordset: [{ N: 0 }] }));
    check(codes.every((c) => c === 'ERP_SCOPE_MISMATCH'), `t9 코드 ${codes}`);
    check(st0 === st1 && Number(led.recordset[0].N) === 0, 't9 DB 변화 발생');
    results.push({ no: 9, codes: codes.join('/'), dbChange: 'none' });
  }

  // 시험 10: 목표3 상태에서 목표3 재요청 → delta 0
  {
    const ridA = `${RUN}-t10a`, ridB = `${RUN}-t10b`;
    const rA = await exec(ridA, [{ prodKey: probeProd.ProdKey, unit, qty: 3 }]);
    if (LIVE) {
      const rB = await exec(ridB, [{ prodKey: probeProd.ProdKey, unit, qty: 3 }]);
      check(rA.status === 'DONE' && rB.status === 'NOOP' && rB.applied.every((a) => a.deltaQty === 0) && rB.attempts === 0, `t10 ${rA.status}/${rB.status}`);
      await cancel(ridA);
      check((await custState()).live === 0, 't10 취소 후 잔여');
      results.push({ no: 10, first: rA.status, second: `${rB.status} delta0 POST0`, cancel: 'OK' });
    } else results.push({ no: 10, first: rA.status });
  }

  // 최종 점검
  const after = await custState();
  const stockAfter = await stockSnapshot(allProds);
  check(after.live === 0 && after.shipmentMasters === 0 && after.liveMasters.length === 0, `최종 상태 ${JSON.stringify(after)}`);
  check(JSON.stringify(after.masters) === JSON.stringify(before.masters), `마스터 변화 ${before.masters}→${after.masters}`);
  check(stockBefore === stockAfter, 'ProductStock 변화');
  console.table(results);
  console.log(`[final] liveDetails=${after.live} masters=${after.masters} liveMasters=${after.liveMasters.length} shipmentMasters=${after.shipmentMasters} productStock=unchanged(${allProds.length} prods)`);
  if (LIVE) {
    let diff = '';
    try { diff = verifyWeek('--diff'); } catch (e) { diff = String(e.stdout || '') + String(e.stderr || ''); }
    console.log('[verify --diff]\n' + diff.split(/\r?\n/).filter(Boolean).slice(-15).join('\n'));
    let inv = '';
    try { inv = verifyWeek(); console.log('[verify invariants] exit 0'); } catch (e) { inv = String(e.stdout || ''); console.log('[verify invariants] exit 1'); }
    console.log(inv.split(/\r?\n/).filter((l) => /V\d+|위반|통과|OK/.test(l)).slice(0, 20).join('\n'));
  }
}

try {
  await main();
} catch (e) {
  console.error(`[STOP] ${e.code || ''} ${e.message}`);
  for (const rid of [...outstanding]) {
    try { await cancel(rid); console.error(`[rollback] ${rid} 취소 완료`); } catch (c) { console.error(`[rollback] ${rid} 취소 실패: ${c.message}`); }
  }
  console.table(results);
  process.exitCode = 1;
} finally {
  try { (await getPool()).close(); } catch {}
}
