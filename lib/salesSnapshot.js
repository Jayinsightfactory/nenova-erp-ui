// 판매등록 히스토리 — 차수별 분배(매출) 스냅샷.
//
// 목적: 화요일 17:00(최종 분배 적용)·수요일 16:00(점검) 기준값을 불변으로 고정하고,
// 그 이후 값이 바뀌면(웹/AI/전산 누가 바꿨든 DB 레벨에서) CHANGE 스냅샷으로 남겨
// "언제부터 무엇이 달라졌는지"를 찾아낸다.
//
// 불변성: 이 모듈과 API 에는 스냅샷 UPDATE/DELETE 경로가 아예 없다 — INSERT 전용.
// 웹 전용 테이블(WeekProdCost 전례) — 전산(exe)은 이 테이블을 모른다.
import { query, withTransaction, sql } from './db';

const LOCKED_TYPES = ['TUE_FINAL', 'WED_CHECK'];

// ── 테이블 보장 (idempotent)
let _ensured = null;
export async function ensureSnapshotTables() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebSalesSnapshot')
       BEGIN
         CREATE TABLE WebSalesSnapshot (
           SnapshotKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL,
           OrderWeek NVARCHAR(10) NOT NULL,
           SnapshotType NVARCHAR(12) NOT NULL,
           TakenAt DATETIME NOT NULL DEFAULT GETDATE(),
           Actor NVARCHAR(50),
           Note NVARCHAR(400),
           RowCnt INT NOT NULL DEFAULT 0,
           TotalAmount FLOAT NOT NULL DEFAULT 0,
           TotalVat FLOAT NOT NULL DEFAULT 0
         );
         CREATE INDEX IX_WebSalesSnapshot_Week ON WebSalesSnapshot(OrderYear, OrderWeek, SnapshotType);
         CREATE UNIQUE INDEX UX_WebSalesSnapshot_Fixed
           ON WebSalesSnapshot(OrderYear, OrderWeek, SnapshotType)
           WHERE SnapshotType IN (N'TUE_FINAL', N'WED_CHECK');
       END`,
      {}
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebSalesSnapshotRow')
       BEGIN
         CREATE TABLE WebSalesSnapshotRow (
           RowKey INT IDENTITY(1,1) PRIMARY KEY,
           SnapshotKey INT NOT NULL,
           RowType NVARCHAR(4) NOT NULL,      -- 'SD'(정상출고) | 'EST'(차감)
           RefKey INT NOT NULL,               -- SdetailKey | EstimateKey
           CustKey INT, CustName NVARCHAR(100),
           ProdKey INT, ProdName NVARCHAR(200),
           FlowerName NVARCHAR(100), CounName NVARCHAR(60), CountryFlower NVARCHAR(120),
           EstUnit NVARCHAR(10), EstimateType NVARCHAR(60),
           OutQuantity FLOAT NOT NULL DEFAULT 0,
           EstQuantity FLOAT NOT NULL DEFAULT 0,
           Cost FLOAT NOT NULL DEFAULT 0,
           Amount FLOAT NOT NULL DEFAULT 0,
           Vat FLOAT NOT NULL DEFAULT 0
         );
         CREATE INDEX IX_WebSalesSnapshotRow_Snap ON WebSalesSnapshotRow(SnapshotKey);
       END`,
      {}
    );
  })();
  return _ensured;
}

// ── 현재 DB의 차수 판매행 캡처 (읽기 전용)
export async function captureCurrentRows(week) {
  const r = await query(
    `SELECT 'SD' AS RowType, sd.SdetailKey AS RefKey,
            sm.CustKey, c.CustName, sd.ProdKey, p.ProdName,
            ISNULL(p.FlowerName,'') AS FlowerName, ISNULL(p.CounName,'') AS CounName,
            ISNULL(p.CountryFlower, ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
            ISNULL(p.EstUnit,'') AS EstUnit, N'정상출고' AS EstimateType,
            ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.EstQuantity,0) AS EstQuantity,
            ISNULL(sd.Cost,0) AS Cost, ISNULL(sd.Amount,0) AS Amount, ISNULL(sd.Vat,0) AS Vat
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
      WHERE sm.OrderWeek = @week AND ISNULL(sm.isDeleted,0) = 0 AND ISNULL(sd.OutQuantity,0) <> 0
     UNION ALL
     SELECT 'EST' AS RowType, e.EstimateKey AS RefKey,
            sm.CustKey, c.CustName, e.ProdKey, p.ProdName,
            ISNULL(p.FlowerName,'') AS FlowerName, ISNULL(p.CounName,'') AS CounName,
            ISNULL(p.CountryFlower, ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
            ISNULL(e.Unit,'') AS EstUnit, ISNULL(e.EstimateType,'') AS EstimateType,
            0 AS OutQuantity, ISNULL(e.Quantity,0) AS EstQuantity,
            ISNULL(e.Cost,0) AS Cost, ISNULL(e.Amount,0) AS Amount, ISNULL(e.Vat,0) AS Vat
       FROM Estimate e
       JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       LEFT JOIN Product p ON e.ProdKey = p.ProdKey
      WHERE sm.OrderWeek = @week AND ISNULL(sm.isDeleted,0) = 0`,
    { week: { type: sql.NVarChar, value: week } }
  );
  return r.recordset;
}

// ── 스냅샷 생성 (INSERT 전용 — 고정 타입은 이미 있으면 절대 덮어쓰지 않음)
export async function takeSnapshot({ week, orderYear, type, actor = 'system', note = '' }) {
  await ensureSnapshotTables();
  if (LOCKED_TYPES.includes(type)) {
    const dup = await query(
      `SELECT TOP 1 SnapshotKey FROM WebSalesSnapshot
        WHERE OrderYear=@yr AND OrderWeek=@week AND SnapshotType=@type`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, week: { type: sql.NVarChar, value: week }, type: { type: sql.NVarChar, value: type } }
    );
    if (dup.recordset.length) return { skipped: true, reason: 'exists', snapshotKey: dup.recordset[0].SnapshotKey };
  }
  const rows = await captureCurrentRows(week);
  if (!rows.length && type !== 'MANUAL') return { skipped: true, reason: 'no-rows' };

  const totalAmount = rows.reduce((s, r) => s + Number(r.Amount || 0), 0);
  const totalVat = rows.reduce((s, r) => s + Number(r.Vat || 0), 0);

  return await withTransaction(async (tQ) => {
    const ins = await tQ(
      `INSERT INTO WebSalesSnapshot (OrderYear, OrderWeek, SnapshotType, Actor, Note, RowCnt, TotalAmount, TotalVat)
       OUTPUT INSERTED.SnapshotKey
       VALUES (@yr, @week, @type, @actor, @note, @cnt, @amt, @vat)`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        week: { type: sql.NVarChar, value: week },
        type: { type: sql.NVarChar, value: type },
        actor: { type: sql.NVarChar, value: actor },
        note: { type: sql.NVarChar, value: note },
        cnt: { type: sql.Int, value: rows.length },
        amt: { type: sql.Float, value: totalAmount },
        vat: { type: sql.Float, value: totalVat },
      }
    );
    const snapshotKey = ins.recordset[0].SnapshotKey;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const values = [];
      const params = { sk: { type: sql.Int, value: snapshotKey } };
      chunk.forEach((r, j) => {
        values.push(`(@sk, @t${j}, @rk${j}, @ck${j}, @cn${j}, @pk${j}, @pn${j}, @fn${j}, @co${j}, @cf${j}, @eu${j}, @et${j}, @oq${j}, @eq${j}, @c${j}, @a${j}, @v${j})`);
        params[`t${j}`] = { type: sql.NVarChar, value: r.RowType };
        params[`rk${j}`] = { type: sql.Int, value: Number(r.RefKey) };
        params[`ck${j}`] = { type: sql.Int, value: r.CustKey == null ? null : Number(r.CustKey) };
        params[`cn${j}`] = { type: sql.NVarChar, value: r.CustName || '' };
        params[`pk${j}`] = { type: sql.Int, value: r.ProdKey == null ? null : Number(r.ProdKey) };
        params[`pn${j}`] = { type: sql.NVarChar, value: r.ProdName || '' };
        params[`fn${j}`] = { type: sql.NVarChar, value: r.FlowerName || '' };
        params[`co${j}`] = { type: sql.NVarChar, value: r.CounName || '' };
        params[`cf${j}`] = { type: sql.NVarChar, value: r.CountryFlower || '' };
        params[`eu${j}`] = { type: sql.NVarChar, value: r.EstUnit || '' };
        params[`et${j}`] = { type: sql.NVarChar, value: r.EstimateType || '' };
        params[`oq${j}`] = { type: sql.Float, value: Number(r.OutQuantity || 0) };
        params[`eq${j}`] = { type: sql.Float, value: Number(r.EstQuantity || 0) };
        params[`c${j}`] = { type: sql.Float, value: Number(r.Cost || 0) };
        params[`a${j}`] = { type: sql.Float, value: Number(r.Amount || 0) };
        params[`v${j}`] = { type: sql.Float, value: Number(r.Vat || 0) };
      });
      await tQ(
        `INSERT INTO WebSalesSnapshotRow
           (SnapshotKey, RowType, RefKey, CustKey, CustName, ProdKey, ProdName, FlowerName, CounName, CountryFlower, EstUnit, EstimateType, OutQuantity, EstQuantity, Cost, Amount, Vat)
         VALUES ${values.join(',')}`,
        params
      );
    }
    return { snapshotKey, rowCnt: rows.length, totalAmount, totalVat };
  });
}

// ── 두 행집합 diff (key = RowType|RefKey)
export function diffRowSets(baseRows, currRows) {
  const key = (r) => `${r.RowType}|${r.RefKey}`;
  const baseMap = new Map((baseRows || []).map(r => [key(r), r]));
  const currMap = new Map((currRows || []).map(r => [key(r), r]));
  const FIELDS = ['OutQuantity', 'EstQuantity', 'Cost', 'Amount', 'Vat'];
  const changed = [];
  const added = [];
  const removed = [];
  for (const [k, cur] of currMap) {
    const base = baseMap.get(k);
    if (!base) { added.push(cur); continue; }
    const diffs = {};
    let has = false;
    for (const f of FIELDS) {
      const a = Number(base[f] || 0);
      const b = Number(cur[f] || 0);
      if (Math.abs(a - b) > 0.001) { diffs[f] = { before: a, after: b }; has = true; }
    }
    if (has) changed.push({ ...cur, diffs, base });
  }
  for (const [k, base] of baseMap) {
    if (!currMap.has(k)) removed.push(base);
  }
  const amtDelta = (currRows || []).reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0)
    - (baseRows || []).reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0);
  return { changed, added, removed, amtDelta, hasDiff: changed.length + added.length + removed.length > 0 };
}

export async function getSnapshotRows(snapshotKey) {
  const r = await query(
    `SELECT * FROM WebSalesSnapshotRow WHERE SnapshotKey=@sk ORDER BY CustName, ProdName`,
    { sk: { type: sql.Int, value: Number(snapshotKey) } }
  );
  return r.recordset;
}

export async function listSnapshots(week, orderYear) {
  await ensureSnapshotTables();
  const r = await query(
    `SELECT SnapshotKey, OrderYear, OrderWeek, SnapshotType,
            CONVERT(varchar(19), TakenAt, 120) AS takenAt, Actor, Note, RowCnt, TotalAmount, TotalVat
       FROM WebSalesSnapshot
      WHERE OrderWeek=@week AND OrderYear=@yr
      ORDER BY SnapshotKey ASC`,
    { week: { type: sql.NVarChar, value: week }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return r.recordset;
}

// ── 변경 검사: 마지막 스냅샷 vs 현재 → 다르면 CHANGE 스냅샷 기록
export async function detectAndRecordChange(week, orderYear, actor = 'watchdog') {
  await ensureSnapshotTables();
  const snaps = await listSnapshots(week, orderYear);
  const baseline = snaps.find(s => s.SnapshotType === 'TUE_FINAL');
  if (!baseline) return { skipped: true, reason: 'no-baseline' };
  const last = snaps[snaps.length - 1];
  const [baseRows, currRows] = await Promise.all([getSnapshotRows(last.SnapshotKey), captureCurrentRows(week)]);
  const diff = diffRowSets(baseRows, currRows);
  if (!diff.hasDiff) return { changed: false };
  const note = `변경감지 vs #${last.SnapshotKey}(${last.SnapshotType}): 수정 ${diff.changed.length}·추가 ${diff.added.length}·삭제 ${diff.removed.length} (Δ합계 ${Math.round(diff.amtDelta).toLocaleString()}원)`;
  const saved = await takeSnapshot({ week, orderYear, type: 'CHANGE', actor, note });
  return { changed: true, note, ...saved };
}

// ── 스케줄러 (KST 화 17:00 TUE_FINAL / 수 16:00 WED_CHECK / 30분마다 변경검사)
function kstParts() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return { day: k.getUTCDay(), hour: k.getUTCHours(), min: k.getUTCMinutes(), date: k };
}
function currentMajorWeekKst() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const year = k.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((k.getTime() - start) / 86400000) + 1;
  const weekNum = Math.min(Math.ceil(dayOfYear / 7), 52);
  return { year: String(year), major: String(weekNum).padStart(2, '0') };
}
async function weeksWithData(year, major) {
  const r = await query(
    `SELECT DISTINCT OrderWeek FROM ShipmentMaster
      WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE @pfx AND ISNULL(OrderYearWeek,'') = @yw`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${year}${major}` } }
  );
  return r.recordset.map(x => x.OrderWeek);
}

async function schedulerTick(state) {
  const { day, hour, min } = kstParts();
  const { year, major } = currentMajorWeekKst();
  const weeks = await weeksWithData(year, major);
  if (!weeks.length) return;

  // 화 17:00 이후(그 주 내내) TUE_FINAL 보장 — 서버가 꺼져 있었어도 재기동 시 지각 생성
  const pastTue17 = day > 2 || (day === 2 && hour >= 17);
  // 수 16:00 이후 WED_CHECK 보장
  const pastWed16 = day > 3 || (day === 3 && hour >= 16);
  // 일(0)·월(1)은 "이번 주" 기준 화요일이 아직 안 왔으므로 제외
  const weekStarted = day >= 2;

  for (const w of weeks) {
    if (weekStarted && pastTue17) {
      const late = !(day === 2 && hour === 17 && min < 5);
      await takeSnapshot({
        week: w, orderYear: year, type: 'TUE_FINAL', actor: 'scheduler',
        note: late ? '지각 생성(예정시각에 서버 미가동 등)' : '화요일 17:00 최종 분배 적용 기준',
      });
    }
    if (weekStarted && pastWed16) {
      const late = !(day === 3 && hour === 16 && min < 5);
      await takeSnapshot({
        week: w, orderYear: year, type: 'WED_CHECK', actor: 'scheduler',
        note: late ? '지각 생성(예정시각에 서버 미가동 등)' : '수요일 16:00 점검 기준',
      });
    }
    // 기준(TUE_FINAL) 존재 시 30분 간격 변경감지
    if (state.tick % 30 === 0) {
      try { await detectAndRecordChange(w, year, 'watchdog'); } catch (e) { console.warn('[salesSnapshot] change-detect 실패:', w, e.message); }
    }
  }
}

export function startSalesSnapshotScheduler() {
  if (global._salesSnapTimer) return;
  if (!process.env.DB_SERVER) return;
  const state = { tick: 0 };
  global._salesSnapTimer = setInterval(async () => {
    state.tick += 1;
    try { await schedulerTick(state); } catch (e) { console.warn('[salesSnapshot] tick 실패:', e.message); }
  }, 60 * 1000);
  // 부팅 직후 1회 (지각 생성 캐치업)
  setTimeout(async () => {
    try { await schedulerTick({ tick: 0 }); } catch (e) { console.warn('[salesSnapshot] 초기 tick 실패:', e.message); }
  }, 15 * 1000);
  console.log('[salesSnapshot] 스케줄러 시작 — 화17:00 TUE_FINAL / 수16:00 WED_CHECK / 30분 변경감지');
}
