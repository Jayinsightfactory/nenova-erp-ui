// 판매등록 히스토리 — 차수별 분배(매출) 스냅샷.
//
// 목적: 화요일 17:00(최종 분배 적용)·수요일 16:00(점검) 기준값을 불변으로 고정하고,
// 그 이후 값이 바뀌면(웹/AI/전산 누가 바꿨든 DB 레벨에서) CHANGE 스냅샷으로 남겨
// "언제부터 무엇이 달라졌는지"를 찾아낸다.
//
// 차수 판매등록의 확정(마감)은 차수 시작이 아니라 "다음주 화요일"이다:
// 차수 N 은 기준수요일부터 출고되고, 판매등록은 다음주 화요일까지 수정 가능 — 그다음 수요일부터 수정금지.
// 마감도 기존 스케줄과 같은 시각을 쓴다(사장님 지정: 화 17시, 수 16시):
//   차주 화 17:00 TUE_CLOSE(판매등록 마감 확정본) / 차주 수 16:00 CLOSE_CHECK(마감 점검 — 수정금지 위반 확인 기준).
// 예: 28차(기준수요일 07-08) → 마감 07-14(화) 17:00, 마감점검 07-15(수) 16:00.
//
// 불변성: 이 모듈과 API 에는 스냅샷 UPDATE/DELETE 경로가 아예 없다 — INSERT 전용.
// 웹 전용 테이블(WeekProdCost 전례) — 전산(exe)은 이 테이블을 모른다.
import { query, withTransaction, sql } from './db';

const LOCKED_TYPES = ['TUE_FINAL', 'WED_CHECK', 'TUE_CLOSE', 'CLOSE_CHECK'];

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
           WHERE SnapshotType IN (N'TUE_FINAL', N'WED_CHECK', N'TUE_CLOSE', N'CLOSE_CHECK');
         -- 기존 운영 DB 인덱스는 2타입 필터지만 고정타입 중복은 takeSnapshot 의 앱레벨 검사로도 막힌다
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

  // ── 업체별 그룹 (기준→현재 금액 + 품목별 기존 vs 변경). 화면 "업체+금액" 묶음/새창 상세용.
  const byCust = buildCustGroups(baseRows, currRows);

  return { changed, added, removed, amtDelta, byCust, hasDiff: changed.length + added.length + removed.length > 0 };
}

// 업체별로 기준(base)·현재(curr) 행을 묶어, 변경이 있는 업체만 품목 before/after 를 만든다.
// 금액=Amount+Vat, 단가=Amount/EstQuantity(환산 기준수량). 품목 매칭 키=RowType|RefKey(같은 상세레코드).
export function buildCustGroups(baseRows, currRows) {
  const num = v => Number(v || 0);
  const rowKey = r => `${r.RowType}|${r.RefKey}`;
  const custKeyOf = r => (r.CustKey != null ? `K${r.CustKey}` : `N${r.CustName || ''}`);
  const unitPrice = r => { const q = num(r.EstQuantity); return q ? Math.round(num(r.Amount) / q) : num(r.Amount); };
  const side = r => r == null ? null : {
    prodName: r.ProdName || '', estType: r.EstimateType || '', unit: r.EstUnit || '',
    outQty: num(r.OutQuantity), estQty: num(r.EstQuantity), unitPrice: unitPrice(r),
    amount: num(r.Amount), vat: num(r.Vat), total: num(r.Amount) + num(r.Vat),
  };

  const map = new Map(); // custKey → { custName, custKey, baseTotal, currTotal, items:Map(rowKey→{base,curr}) }
  const ensure = (r) => {
    const k = custKeyOf(r);
    if (!map.has(k)) map.set(k, { custKey: r.CustKey ?? null, custName: r.CustName || '(미지정)', baseTotal: 0, currTotal: 0, items: new Map() });
    return map.get(k);
  };
  for (const r of (baseRows || [])) { const g = ensure(r); g.baseTotal += num(r.Amount) + num(r.Vat); const it = g.items.get(rowKey(r)) || {}; it.base = r; g.items.set(rowKey(r), it); }
  for (const r of (currRows || [])) { const g = ensure(r); g.currTotal += num(r.Amount) + num(r.Vat); const it = g.items.get(rowKey(r)) || {}; it.curr = r; g.items.set(rowKey(r), it); }

  const groups = [];
  for (const g of map.values()) {
    const items = [];
    let changedCnt = 0, addedCnt = 0, removedCnt = 0;
    for (const { base, curr } of g.items.values()) {
      let kind = 'same';
      if (base && !curr) { kind = 'removed'; removedCnt += 1; }
      else if (!base && curr) { kind = 'added'; addedCnt += 1; }
      else {
        const changed = ['OutQuantity', 'EstQuantity', 'Amount', 'Vat', 'Cost'].some(f => Math.abs(num(base[f]) - num(curr[f])) > 0.001);
        if (changed) { kind = 'changed'; changedCnt += 1; }
      }
      items.push({ kind, prodName: (curr || base).ProdName || '', before: side(base), after: side(curr) });
    }
    if (changedCnt + addedCnt + removedCnt === 0) continue; // 변경 없는 업체는 제외
    // 변경 품목 먼저, 그다음 품목명
    const order = { changed: 0, added: 1, removed: 2, same: 3 };
    items.sort((a, b) => (order[a.kind] - order[b.kind]) || String(a.prodName).localeCompare(String(b.prodName), 'ko'));
    groups.push({
      custKey: g.custKey, custName: g.custName,
      baseTotal: Math.round(g.baseTotal), currTotal: Math.round(g.currTotal), delta: Math.round(g.currTotal - g.baseTotal),
      changedCnt, addedCnt, removedCnt, items,
    });
  }
  groups.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (b.currTotal - a.currTotal));
  return groups;
}

// 업체별 3기준(화요일 TUE_FINAL / 수요일 WED_CHECK / 현재 live) 금액 비교 + 품목별 + 변경자.
// changerByRefKey: Map(SdetailKey → [변경자ID...]) — TUE 기준 이후 ShipmentHistory.
export function buildBaselineCompare({ tueRows, wedRows, currRows, changerByRefKey }) {
  const num = v => Number(v || 0);
  const amt = r => num(r.Amount) + num(r.Vat);
  const rowKey = r => `${r.RowType}|${r.RefKey}`;
  const custKeyOf = r => (r.CustKey != null ? `K${r.CustKey}` : `N${r.CustName || ''}`);
  const changers = changerByRefKey || new Map();

  const map = new Map(); // custKey → { custName, custKey, items:Map }
  const ensure = r => {
    const k = custKeyOf(r);
    if (!map.has(k)) map.set(k, { custKey: r.CustKey ?? null, custName: r.CustName || '(미지정)', items: new Map() });
    return map.get(k);
  };
  const put = (rows, field) => {
    for (const r of (rows || [])) {
      const g = ensure(r); const ik = rowKey(r);
      if (!g.items.has(ik)) g.items.set(ik, { rowType: r.RowType, refKey: Number(r.RefKey), prodName: r.ProdName || '', unit: r.EstUnit || '', estType: r.EstimateType || '', tue: null, wed: null, curr: null });
      const it = g.items.get(ik);
      it[field] = amt(r);
      if (!it.prodName && r.ProdName) it.prodName = r.ProdName;
    }
  };
  put(tueRows, 'tue'); put(wedRows, 'wed'); put(currRows, 'curr');

  const hasWedAny = (wedRows || []).length > 0;
  const groups = [];
  for (const g of map.values()) {
    let tue = 0, wed = 0, curr = 0;
    const items = [];
    for (const it of g.items.values()) {
      const t = num(it.tue), c = num(it.curr);
      tue += t; curr += c; if (it.wed != null) wed += num(it.wed);
      const cs = it.rowType === 'SD' ? (changers.get(it.refKey) || []) : [];
      items.push({ prodName: it.prodName, unit: it.unit, estType: it.estType, rowType: it.rowType,
        tue: Math.round(t), wed: it.wed == null ? null : Math.round(it.wed), curr: Math.round(c), delta: Math.round(c - t), changers: cs });
    }
    const delta = curr - tue;
    items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || String(a.prodName).localeCompare(String(b.prodName), 'ko'));
    groups.push({ custKey: g.custKey, custName: g.custName,
      tue: Math.round(tue), wed: hasWedAny ? Math.round(wed) : null, curr: Math.round(curr), delta: Math.round(delta),
      changed: Math.abs(delta) > 0.5, items });
  }
  groups.sort((a, b) => b.curr - a.curr);
  return groups;
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
//
// 대상 차수 계산: 화요일 17:00에 확정하는 것은 "다음날 수요일부터 출고되는 차수".
// 차수 N 의 기준수요일 = 시작일((N-1)*7+1)과 같거나 바로 앞의 수요일 (CLAUDE.md 규칙3).
// 예: 2026-07-07(화) 확정 → 기준수요일 07-08 → 28차 (달력주차 27이 아님!)
function dayOfYearUTC(d) {
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}
function majorWeekForBaseWednesday(wed) {
  const year = wed.getUTCFullYear();
  const doy = dayOfYearUTC(wed);
  for (let n = Math.min(Math.ceil(doy / 7) + 1, 53); n >= 1; n -= 1) {
    const s = (n - 1) * 7 + 1;
    const sd = new Date(Date.UTC(year, 0, 1) + (s - 1) * 86400000);
    const wedDoy = s - ((sd.getUTCDay() - 3 + 7) % 7);
    if (wedDoy === doy) return String(n).padStart(2, '0');
  }
  return null;
}
/** 현재 사이클의 앵커: 직전 화요일 17:00 이 확정한 기준수요일과 대상 차수.
 * 화 17:00 전·일·월요일은 null (이전 사이클 스냅샷은 그때 이미 생성됨).
 * prevYear/prevMajor = 직전 사이클(어제 화요일에 판매등록 마감된 전차수) — TUE_CLOSE 대상. */
function anchorInfo() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const day = k.getUTCDay();
  const hour = k.getUTCHours();
  const min = k.getUTCMinutes();
  let wed = null;
  if (day === 2 && hour >= 17) wed = new Date(k.getTime() + 86400000);       // 화 17시 이후 → 내일(수)
  else if (day >= 3) wed = new Date(k.getTime() - (day - 3) * 86400000);     // 수~토 → 이번 사이클의 수요일
  if (!wed) return null;
  const major = majorWeekForBaseWednesday(wed);
  if (!major) return null;
  const prevWed = new Date(wed.getTime() - 7 * 86400000);
  const prevMajor = majorWeekForBaseWednesday(prevWed);
  return {
    year: String(wed.getUTCFullYear()),
    major,
    prevYear: String(prevWed.getUTCFullYear()),
    prevMajor,
    day, hour, min,
    wedDue: day > 3 || (day === 3 && hour >= 16),
  };
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
  const anchor = anchorInfo();
  if (!anchor) return; // 일·월·화(17시 전) — 이전 사이클 스냅샷은 그때 이미 생성됨
  const { year, major, prevYear, prevMajor, day, hour, min, wedDue } = anchor;
  const weeks = await weeksWithData(year, major);

  for (const w of weeks) {
    // 화 17:00 도달 시점부터 사이클 내내 TUE_FINAL 보장 — 서버가 꺼져 있었어도 재기동 시 지각 생성
    {
      const onTime = day === 2 && hour === 17 && min < 5;
      await takeSnapshot({
        week: w, orderYear: year, type: 'TUE_FINAL', actor: 'scheduler',
        note: onTime ? '화요일 17:00 최종 분배 적용 기준' : '지각 생성(예정시각에 서버 미가동 등)',
      });
    }
    if (wedDue) {
      const onTime = day === 3 && hour === 16 && min < 5;
      await takeSnapshot({
        week: w, orderYear: year, type: 'WED_CHECK', actor: 'scheduler',
        note: onTime ? '수요일 16:00 점검 기준' : '지각 생성(예정시각에 서버 미가동 등)',
      });
    }
    // 변경감지는 자동 폴링하지 않는다 — 화면의 [최신화] 버튼(checkNow)으로 사용자가 실행.
    // (고정 스냅샷 화17:00/수16:00 × 신규차수·전차수마감 만 자동)
  }

  // 전차수 판매등록 마감 — 차수 N 판매등록은 차주 화요일까지 수정 가능, 수요일부터 수정금지.
  // 마감 시각은 기존 스케줄과 동일(화 17시, 수 16시): 차주 화 17:00 TUE_CLOSE(확정본) / 차주 수 16:00 CLOSE_CHECK(마감 점검).
  // 앵커가 있으면(=화 17시 도달 이후) 사이클 내내 보장 — 지각 생성 포함.
  // 예: 28차(기준수요일 07-08) 마감 07-14(화) 17:00, 마감점검 07-15(수) 16:00.
  if (prevMajor) {
    const prevWeeks = await weeksWithData(prevYear, prevMajor);
    for (const w of prevWeeks) {
      {
        const onTime = day === 2 && hour === 17 && min < 5;
        await takeSnapshot({
          week: w, orderYear: prevYear, type: 'TUE_CLOSE', actor: 'scheduler',
          note: onTime
            ? '판매등록 마감 — 화요일 17:00 확정본(수요일부터 수정금지)'
            : '지각 생성(예정시각에 서버 미가동 등) — 화요일 17시 이후 상태일 수 있음',
        });
      }
      if (wedDue) {
        const onTime = day === 3 && hour === 16 && min < 5;
        await takeSnapshot({
          week: w, orderYear: prevYear, type: 'CLOSE_CHECK', actor: 'scheduler',
          note: onTime
            ? '마감 점검 — 수요일 16:00 (마감 확정본과 다르면 수정금지 위반)'
            : '지각 생성(예정시각에 서버 미가동 등)',
        });
      }
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
  console.log('[salesSnapshot] 스케줄러 시작 — 화17:00 TUE_FINAL·전차수 TUE_CLOSE(판매등록 마감) / 수16:00 WED_CHECK·전차수 CLOSE_CHECK(마감 점검)');
}
