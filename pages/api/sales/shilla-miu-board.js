// 잔량분배 게시판 API
// 읽기: OrderMaster/OrderDetail(예상물량) + ShipmentMaster/ShipmentDetail(현재분배) — 선택 연도 + 대차수 prefix + CustKey + ProdKey
// 쓰기: 웹 전용 WebShillaMiuBoardGroup / WebShillaMiuBoardAllocation / WebShillaMiuBoardAllocationHistory 만
// ERP 원장(Order*/Shipment*/Stock*/Estimate/WebProfitReport)은 절대 쓰지 않는다.
// 계약: docs/contracts/shilla-miu-board.json, docs/RESIDUAL_FLOW_BOARD_SIDE_EFFECTS.md
import { withAuth } from "../../../lib/auth";
import { withActionLog } from "../../../lib/withActionLog";
import { query, withTransaction, sql } from "../../../lib/db";
import {
  buildGroupRows,
  buildMajorWeeks,
  buildOverviewSections,
  normalizeMajorWeek,
  roundQty,
} from "../../../lib/shillaMiuBoard";

const text = (v, fallback = "") => String(v ?? fallback).trim();
const isAdmin = (user) =>
  Number(user?.authority) <= 1 ||
  /admin|관리자|대표/i.test(String(user?.authority || "")) ||
  user?.deptName === "대표";

let schemaPromise;
let ledgerReadyPromise;

/** DDL 은 저장(POST) 경로에서만 실행한다. GET 조회 중에는 스키마를 만들지 않는다. */
function ensureSchema() {
  schemaPromise ||= query(`
    IF OBJECT_ID(N'dbo.WebShillaMiuBoardGroup', N'U') IS NULL BEGIN
      CREATE TABLE dbo.WebShillaMiuBoardGroup(GroupKey INT IDENTITY(1,1) PRIMARY KEY,GroupName NVARCHAR(100) NOT NULL,BaseCustKey INT NOT NULL,BaseCustName NVARCHAR(200) NOT NULL,ReceiverCustKey INT NOT NULL,ReceiverCustName NVARCHAR(200) NOT NULL,IsActive BIT NOT NULL DEFAULT 1,DisplayOrder INT NOT NULL DEFAULT 0,CreatedBy NVARCHAR(50),CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),UpdatedBy NVARCHAR(50),UpdatedAt DATETIME NOT NULL DEFAULT GETDATE());
      CREATE UNIQUE INDEX UX_WebShillaMiuBoardGroup_BaseActive ON dbo.WebShillaMiuBoardGroup(BaseCustKey) WHERE IsActive=1;
    END;
    IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation', N'U') IS NULL BEGIN
      CREATE TABLE dbo.WebShillaMiuBoardAllocation(BoardKey BIGINT IDENTITY(1,1) PRIMARY KEY,OrderYear NVARCHAR(4) NOT NULL,SupplyWeek NVARCHAR(4) NOT NULL,UseWeek NVARCHAR(4) NOT NULL,ProdKey INT NOT NULL,Destination NVARCHAR(10) NOT NULL,Qty DECIMAL(18,3) NOT NULL DEFAULT 0,Matched BIT NOT NULL DEFAULT 0,Memo NVARCHAR(500) NOT NULL DEFAULT N'',CreatedBy NVARCHAR(50),CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),UpdatedBy NVARCHAR(50),UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),isDeleted BIT NOT NULL DEFAULT 0);
    END;
    IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation','GroupKey') IS NULL ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD GroupKey INT NULL;
    /* 업체 최종분배(업무상 최종 수량, ERP isFix 와 무관)는 기존 Qty(이전 정의의 이동입력)를 덮어쓰지 않고 새 nullable 컬럼에 저장한다. */
    IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation','FinalQty') IS NULL ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD FinalQty DECIMAL(18,3) NULL;
    IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation','ExpectedQtyAtSave') IS NULL ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD ExpectedQtyAtSave DECIMAL(18,3) NULL;
    IF COL_LENGTH('dbo.WebShillaMiuBoardAllocation','CurrentQtyAtSave') IS NULL ALTER TABLE dbo.WebShillaMiuBoardAllocation ADD CurrentQtyAtSave DECIMAL(18,3) NULL;
    IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation') AND name=N'IX_WebShillaMiuBoardAllocation_GroupScope') CREATE INDEX IX_WebShillaMiuBoardAllocation_GroupScope ON dbo.WebShillaMiuBoardAllocation(OrderYear,GroupKey,UseWeek,ProdKey,isDeleted);
    IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocationHistory', N'U') IS NULL BEGIN
      CREATE TABLE dbo.WebShillaMiuBoardAllocationHistory(HistoryKey BIGINT IDENTITY(1,1) PRIMARY KEY,BoardKey BIGINT NULL,OrderYear NVARCHAR(4) NOT NULL,UseWeek NVARCHAR(4) NOT NULL,GroupKey INT NULL,ProdKey INT NOT NULL,ChangeType NVARCHAR(20) NOT NULL,BeforeFinalQty DECIMAL(18,3) NULL,AfterFinalQty DECIMAL(18,3) NULL,BeforeMatched BIT NULL,AfterMatched BIT NULL,LegacyMoveQty DECIMAL(18,3) NULL,ExpectedQty DECIMAL(18,3) NULL,CurrentQty DECIMAL(18,3) NULL,Memo NVARCHAR(500) NULL,ActedBy NVARCHAR(50) NULL,ActedAt DATETIME NOT NULL DEFAULT GETDATE());
      CREATE INDEX IX_WebShillaMiuBoardAllocationHistory_Scope ON dbo.WebShillaMiuBoardAllocationHistory(OrderYear,UseWeek,GroupKey,ProdKey,ActedAt);
    END;
    IF NOT EXISTS(SELECT 1 FROM dbo.WebShillaMiuBoardGroup)
       AND (SELECT COUNT(*) FROM Customer WHERE CustName=N'아이엠（미우）' AND ISNULL(isDeleted,0)=0)=1
    BEGIN
      DECLARE @receiver INT=(SELECT CustKey FROM Customer WHERE CustName=N'아이엠（미우）' AND ISNULL(isDeleted,0)=0);
      INSERT dbo.WebShillaMiuBoardGroup(GroupName,BaseCustKey,BaseCustName,ReceiverCustKey,ReceiverCustName,DisplayOrder,CreatedBy,UpdatedBy)
      SELECT seed.GroupName,c.CustKey,c.CustName,@receiver,N'아이엠（미우）',seed.DisplayOrder,N'system-bootstrap',N'system-bootstrap'
        FROM (VALUES(N'신라',N'신라상사',10),(N'라움',N'주식회사 트라움에스앤씨 (라움)',20),(N'초이문',N'초이문(센스앤센서빌러티)',30)) seed(GroupName,CustName,DisplayOrder)
        JOIN Customer c ON c.CustName=seed.CustName AND ISNULL(c.isDeleted,0)=0
       WHERE (SELECT COUNT(*) FROM Customer x WHERE x.CustName=seed.CustName AND ISNULL(x.isDeleted,0)=0)=1;
    END;
  `)
    .then((r) => {
      ledgerReadyPromise = null; // 새로 만든 스키마를 다음 조회가 즉시 인식한다.
      return r;
    })
    .catch((e) => {
      schemaPromise = null;
      throw e;
    });
  return schemaPromise;
}

/** 조회 경로는 DDL 없이 웹 전용 원장의 존재 여부만 확인한다. */
function ledgerState() {
  ledgerReadyPromise ||= query(
    `SELECT CAST(CASE WHEN OBJECT_ID(N'dbo.WebShillaMiuBoardGroup',N'U') IS NULL THEN 0 ELSE 1 END AS INT) hasGroup,
            CAST(CASE WHEN OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation',N'U') IS NULL THEN 0 ELSE 1 END AS INT) hasAllocation,
            CAST(CASE WHEN COL_LENGTH('dbo.WebShillaMiuBoardAllocation','FinalQty') IS NULL THEN 0 ELSE 1 END AS INT) hasFinalQty`,
  )
    .then((r) => ({
      hasGroup: !!r.recordset?.[0]?.hasGroup,
      hasAllocation: !!r.recordset?.[0]?.hasAllocation,
      hasFinalQty: !!r.recordset?.[0]?.hasFinalQty,
    }))
    .catch((e) => {
      ledgerReadyPromise = null;
      throw e;
    });
  return ledgerReadyPromise;
}

async function groups(state) {
  if (!state.hasGroup) return [];
  const r = await query(
    `SELECT g.GroupKey groupKey,g.GroupName groupName,g.BaseCustKey baseCustKey,g.BaseCustName baseCustName,g.ReceiverCustKey receiverCustKey,g.ReceiverCustName receiverCustName,g.IsActive isActive,g.DisplayOrder displayOrder FROM dbo.WebShillaMiuBoardGroup g ORDER BY g.IsActive DESC,g.DisplayOrder,g.GroupKey`,
  );
  return r.recordset || [];
}

async function latestScope() {
  const r = await query(
    `SELECT TOP 1 CAST(sm.OrderYear AS NVARCHAR(4)) year,LEFT(sm.OrderWeek,2) week FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey WHERE ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0 AND sm.OrderYear IS NOT NULL AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) BETWEEN 1 AND 52 ORDER BY TRY_CONVERT(INT,sm.OrderYear) DESC,TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) DESC`,
  );
  return (
    r.recordset?.[0] || { year: String(new Date().getFullYear()), week: "01" }
  );
}

// 예상물량(주문등록량). OutQuantity 가 없는 레거시 행만 OutUnit CASE 로 환산한다(합산 금지).
const ORDER_SQL = `SELECT LEFT(om.OrderWeek,2) week,om.OrderWeek orderWeek,p.ProdKey prodKey,p.CounName country,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName,p.OutUnit unit,
  SUM(ISNULL(od.OutQuantity,CASE WHEN p.OutUnit IN (N'박스',N'BOX') THEN od.BoxQuantity WHEN p.OutUnit IN (N'단',N'BUNCH') THEN od.BunchQuantity WHEN p.OutUnit IN (N'송이',N'STEAM',N'STEM') THEN od.SteamQuantity ELSE od.BoxQuantity END)) qty
  FROM OrderMaster om
  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
  JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE om.OrderYear=@yr AND LEFT(om.OrderWeek,2) IN (%WEEKS%) AND om.CustKey=@cust AND ISNULL(om.isDeleted,0)=0
 GROUP BY LEFT(om.OrderWeek,2),om.OrderWeek,p.ProdKey,p.CounName,p.DisplayName,p.ProdName,p.OutUnit`;

// 현재분배량. 활성 마스터의 양수 출고만 합산한다.
const SHIPMENT_SQL = `SELECT LEFT(sm.OrderWeek,2) week,sm.OrderWeek orderWeek,p.ProdKey prodKey,p.CounName country,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName,p.OutUnit unit,SUM(ISNULL(sd.OutQuantity,0)) qty
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE sm.OrderYear=@yr AND LEFT(sm.OrderWeek,2) IN (%WEEKS%) AND sm.CustKey=@cust AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
 GROUP BY LEFT(sm.OrderWeek,2),sm.OrderWeek,p.ProdKey,p.CounName,p.DisplayName,p.ProdName,p.OutUnit`;

function weekParams(year, weeks) {
  const params = { yr: { type: sql.NVarChar, value: year } };
  const names = weeks.map((_, i) => `w${i}`);
  names.forEach((name, i) => {
    params[name] = { type: sql.NVarChar, value: weeks[i] };
  });
  return { params, clause: names.map((name) => `@${name}`).join(",") };
}

const custScope = (base, cust) => ({
  ...base,
  cust: { type: sql.Int, value: Number(cust) },
});

async function readErpQuantities({ year, weeks, custKey }) {
  const { params, clause } = weekParams(year, weeks);
  const scope = custScope(params, custKey);
  const [orders, shipments] = await Promise.all([
    query(ORDER_SQL.replace("%WEEKS%", clause), scope),
    query(SHIPMENT_SQL.replace("%WEEKS%", clause), scope),
  ]);
  return { orders: orders.recordset || [], shipments: shipments.recordset || [] };
}

async function readAllocations({ year, weeks, groupKey, state }) {
  if (!state.hasAllocation) return [];
  const { params, clause } = weekParams(year, weeks);
  const finalCol = state.hasFinalQty ? "FinalQty" : "CAST(NULL AS DECIMAL(18,3))";
  const r = await query(
    `SELECT BoardKey boardKey,UseWeek useWeek,ProdKey prodKey,Qty qty,${finalCol} finalQty,Matched matched,Memo memo
       FROM dbo.WebShillaMiuBoardAllocation
      WHERE OrderYear=@yr AND ISNULL(isDeleted,0)=0
        AND ((GroupKey=@group) OR (GroupKey IS NULL AND @group=(SELECT TOP 1 GroupKey FROM dbo.WebShillaMiuBoardGroup WHERE IsActive=1 ORDER BY DisplayOrder,GroupKey) AND Destination IN (N'MIU',N'RAUM')))
        AND UseWeek IN (${clause})`,
    { ...params, group: { type: sql.Int, value: Number(groupKey) } },
  );
  return r.recordset || [];
}

async function loadBoard({ year, weeks, group, state, receiverCache }) {
  const receiverKey = Number(group.receiverCustKey);
  receiverCache[receiverKey] ||= readErpQuantities({
    year,
    weeks,
    custKey: receiverKey,
  });
  const [base, receiver, allocations] = await Promise.all([
    readErpQuantities({ year, weeks, custKey: Number(group.baseCustKey) }),
    receiverCache[receiverKey],
    readAllocations({ year, weeks, groupKey: group.groupKey, state }),
  ]);
  return {
    rows: buildGroupRows({
      weeks,
      baseOrders: base.orders,
      baseShipments: base.shipments,
      receiverOrders: receiver.orders,
      receiverShipments: receiver.shipments,
      allocations,
    }),
  };
}

/** 전체 탭의 '미우 자체수량' — 원천업체 행이 없어도 보이도록 수령업체 품목 전체를 모은다. */
function receiverSelfRows({ receiverCustKey, week, orders, shipments }) {
  const target = normalizeMajorWeek(week);
  const map = new Map();
  const touch = (s) => {
    if (!s.prodKey || normalizeMajorWeek(s.week) !== target) return null;
    const key = `${Number(s.prodKey)}|${s.unit || ""}`;
    if (!map.has(key))
      map.set(key, {
        receiverCustKey,
        prodKey: Number(s.prodKey),
        prodName: s.prodName || "",
        unit: s.unit || "",
        country: s.country || "",
        qty: 0,
        expectedQty: 0,
      });
    return map.get(key);
  };
  for (const s of shipments) {
    const row = touch(s);
    if (row) row.qty = roundQty(row.qty + Number(s.qty || 0));
  }
  for (const s of orders) {
    const row = touch(s);
    if (row) row.expectedQty = roundQty(row.expectedQty + Number(s.qty || 0));
  }
  return [...map.values()].filter((x) => x.qty > 0 || x.expectedQty > 0);
}

async function saveGroup(req, res) {
  if (!isAdmin(req.user))
    return res.status(403).json({
      success: false,
      error: "관리자만 업체 구성을 저장할 수 있습니다.",
    });
  const b = req.body || {},
    groupKey = Number(b.groupKey || 0),
    base = Number(b.baseCustKey),
    receiver = Number(b.receiverCustKey),
    order = Number(b.displayOrder || 0),
    actor = text(req.user?.userId, "user").slice(0, 50);
  if (
    !Number.isInteger(base) ||
    base <= 0 ||
    !Number.isInteger(receiver) ||
    receiver <= 0 ||
    base === receiver
  )
    return res.status(400).json({
      success: false,
      error: "기준/수령 업체를 서로 다른 CustKey로 선택하세요.",
    });
  const c = await query(
    `SELECT CustKey,CustName FROM Customer WHERE CustKey IN (@base,@receiver) AND ISNULL(isDeleted,0)=0`,
    {
      base: { type: sql.Int, value: base },
      receiver: { type: sql.Int, value: receiver },
    },
  );
  if (c.recordset.length !== 2)
    return res
      .status(400)
      .json({ success: false, error: "유효한 전산 Customer를 선택하세요." });
  const bn = c.recordset.find((x) => x.CustKey === base).CustName,
    rn = c.recordset.find((x) => x.CustKey === receiver).CustName,
    name = text(b.groupName, bn).slice(0, 100),
    active = b.isActive === false ? 0 : 1;
  const p = {
    key: { type: sql.Int, value: groupKey },
    name: { type: sql.NVarChar, value: name },
    base: { type: sql.Int, value: base },
    bn: { type: sql.NVarChar, value: bn },
    receiver: { type: sql.Int, value: receiver },
    rn: { type: sql.NVarChar, value: rn },
    active: { type: sql.Bit, value: active },
    ord: { type: sql.Int, value: order },
    actor: { type: sql.NVarChar, value: actor },
  };
  if (groupKey)
    await query(
      `UPDATE dbo.WebShillaMiuBoardGroup SET GroupName=@name,BaseCustKey=@base,BaseCustName=@bn,ReceiverCustKey=@receiver,ReceiverCustName=@rn,IsActive=@active,DisplayOrder=@ord,UpdatedBy=@actor,UpdatedAt=GETDATE() WHERE GroupKey=@key`,
      p,
    );
  else
    await query(
      `INSERT dbo.WebShillaMiuBoardGroup(GroupName,BaseCustKey,BaseCustName,ReceiverCustKey,ReceiverCustName,IsActive,DisplayOrder,CreatedBy,UpdatedBy) VALUES(@name,@base,@bn,@receiver,@rn,@active,@ord,@actor,@actor)`,
      p,
    );
  return res.json({ success: true, groups: await groups(await ledgerState()) });
}

/**
 * 저장 요청 정규화.
 * 빈 값/null = '최종분배 미입력'으로 되돌림, 0 = 실제로 0을 최종분배로 확정.
 * 음수는 거부하고, 예상물량 초과는 업무상 가능하므로 허용한 뒤 화면에서 초과로 표시한다.
 */
function normalizeItems(items) {
  return items.map((x) => {
    const prodKey = Number(x.prodKey);
    const useWeek = normalizeMajorWeek(x.useWeek);
    const raw = x.finalQty;
    const cleared =
      raw === null || raw === undefined || String(raw).trim() === "";
    const finalQty = cleared ? null : roundQty(raw);
    if (!Number.isInteger(prodKey) || prodKey <= 0)
      throw new Error("품목 키가 올바르지 않습니다.");
    if (!cleared && (!Number.isFinite(Number(raw)) || finalQty < 0))
      throw new Error("업체 최종분배는 0 이상의 수량만 저장할 수 있습니다.");
    return {
      prodKey,
      useWeek,
      finalQty,
      matched: !!x.matched,
      memo: text(x.memo).slice(0, 500),
    };
  });
}

/** 업체 최종분배 저장 — 웹 전용 원장과 감사 이력만 변경한다. */
async function saveAllocations(req, res) {
  const b = req.body || {},
    year = text(b.year),
    groupKey = Number(b.groupKey),
    items = Array.isArray(b.allocations) ? b.allocations : [];
  if (!/^\d{4}$/.test(year) || !groupKey || !items.length)
    return res
      .status(400)
      .json({ success: false, error: "연도·업체그룹·저장할 행이 필요합니다." });

  const g = await query(
    `SELECT GroupKey groupKey,BaseCustKey baseCustKey FROM dbo.WebShillaMiuBoardGroup WHERE GroupKey=@g`,
    { g: { type: sql.Int, value: groupKey } },
  );
  const group = g.recordset?.[0];
  if (!group)
    return res
      .status(400)
      .json({ success: false, error: "존재하지 않는 업체그룹입니다." });

  let normalized;
  try {
    normalized = normalizeItems(items);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  // 저장 시점의 ERP 예상물량/현재분배 스냅샷 (감사용, 화면 계산에는 사용하지 않음)
  const weeks = [...new Set(normalized.map((x) => x.useWeek))];
  const erp = await readErpQuantities({
    year,
    weeks,
    custKey: Number(group.baseCustKey),
  });
  const snapshot = new Map();
  const addSnapshot = (list, field) => {
    for (const s of list) {
      const key = `${normalizeMajorWeek(s.week)}|${Number(s.prodKey)}`;
      const cur = snapshot.get(key) || { expectedQty: 0, currentQty: 0 };
      cur[field] = roundQty(cur[field] + Number(s.qty || 0));
      snapshot.set(key, cur);
    }
  };
  addSnapshot(erp.orders, "expectedQty");
  addSnapshot(erp.shipments, "currentQty");

  const actor = text(req.user?.userId, "user").slice(0, 50);
  await withTransaction(async (tq) => {
    for (const x of normalized) {
      const snap = snapshot.get(`${x.useWeek}|${x.prodKey}`) || {
        expectedQty: 0,
        currentQty: 0,
      };
      const p = {
        yr: { type: sql.NVarChar, value: year },
        g: { type: sql.Int, value: groupKey },
        w: { type: sql.NVarChar, value: x.useWeek },
        pk: { type: sql.Int, value: x.prodKey },
        finalQty:
          x.finalQty === null
            ? { type: sql.Decimal(18, 3), value: null }
            : { type: sql.Decimal(18, 3), value: x.finalQty },
        expected: { type: sql.Decimal(18, 3), value: snap.expectedQty },
        current: { type: sql.Decimal(18, 3), value: snap.currentQty },
        matched: { type: sql.Bit, value: x.matched },
        memo: { type: sql.NVarChar, value: x.memo },
        actor: { type: sql.NVarChar, value: actor },
      };
      await tq(
        `DECLARE @boardKey BIGINT,@beforeFinal DECIMAL(18,3),@beforeMatched BIT,@legacy DECIMAL(18,3);
         SELECT TOP 1 @boardKey=BoardKey,@beforeFinal=FinalQty,@beforeMatched=Matched,@legacy=Qty
           FROM dbo.WebShillaMiuBoardAllocation WITH(UPDLOCK,HOLDLOCK)
          WHERE OrderYear=@yr AND GroupKey=@g AND UseWeek=@w AND ProdKey=@pk AND ISNULL(isDeleted,0)=0;
         IF @boardKey IS NULL
         BEGIN
           INSERT dbo.WebShillaMiuBoardAllocation(OrderYear,SupplyWeek,UseWeek,ProdKey,Destination,Qty,FinalQty,ExpectedQtyAtSave,CurrentQtyAtSave,Matched,Memo,CreatedBy,UpdatedBy,GroupKey)
           VALUES(@yr,@w,@w,@pk,N'MIU',0,@finalQty,@expected,@current,@matched,@memo,@actor,@actor,@g);
           SET @boardKey=SCOPE_IDENTITY();
         END
         ELSE
           UPDATE dbo.WebShillaMiuBoardAllocation
              SET FinalQty=@finalQty,ExpectedQtyAtSave=@expected,CurrentQtyAtSave=@current,Matched=@matched,Memo=@memo,UpdatedBy=@actor,UpdatedAt=GETDATE()
            WHERE BoardKey=@boardKey;
         INSERT dbo.WebShillaMiuBoardAllocationHistory(BoardKey,OrderYear,UseWeek,GroupKey,ProdKey,ChangeType,BeforeFinalQty,AfterFinalQty,BeforeMatched,AfterMatched,LegacyMoveQty,ExpectedQty,CurrentQty,Memo,ActedBy)
         VALUES(@boardKey,@yr,@w,@g,@pk,N'FINAL_ALLOCATION',@beforeFinal,@finalQty,@beforeMatched,@matched,@legacy,@expected,@current,@memo,@actor);`,
        p,
      );
    }
  });
  return res.json({ success: true, saved: normalized.length });
}

async function handler(req, res) {
  try {
    if (req.method === "POST") {
      await ensureSchema();
      if (req.body?.action === "save-group") return saveGroup(req, res);
      return saveAllocations(req, res);
    }
    if (req.method !== "GET") return res.status(405).end();

    if (req.query.mode === "customers") {
      const q = `%${text(req.query.q).slice(0, 50)}%`;
      const r = await query(
        `SELECT TOP 50 CustKey custKey,CustName custName FROM Customer WHERE ISNULL(isDeleted,0)=0 AND CustName LIKE @q ORDER BY CustName`,
        { q: { type: sql.NVarChar, value: q } },
      );
      return res.json({ success: true, customers: r.recordset });
    }

    const state = await ledgerState();
    const all = await groups(state);
    const latest = await latestScope();
    const year = text(req.query.year, latest.year);
    const start = req.query.startWeek || latest.week,
      end = req.query.endWeek || start,
      weeks = buildMajorWeeks(start, end);
    const active = all.filter((g) => g.isActive);
    const requestedGroupKey = Number(req.query.groupKey || 0);
    const selected =
      active.find((g) => g.groupKey === requestedGroupKey) || null;

    const receiverCache = {};
    // 전체 탭과 업체 탭은 같은 조회 로직을 사용한다.
    const boards = await Promise.all(
      (selected ? [selected] : active).map(async (group) => ({
        group,
        ...(await loadBoard({ year, weeks, group, state, receiverCache })),
      })),
    );
    const overview = selected
      ? []
      : buildOverviewSections({
          week: weeks[0],
          boards,
          receiverSelf: (
            await Promise.all(
              Object.entries(receiverCache).map(async ([key, promise]) => {
                const erp = await promise;
                return receiverSelfRows({
                  receiverCustKey: Number(key),
                  week: weeks[0],
                  orders: erp.orders,
                  shipments: erp.shipments,
                });
              }),
            )
          ).flat(),
        });

    return res.json({
      success: true,
      year,
      weeks,
      latest,
      groups: all,
      selectedGroup: selected,
      isAdmin: isAdmin(req.user),
      rows: selected ? boards[0]?.rows || [] : [],
      boards: selected ? [] : boards,
      overview,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(
  withActionLog(handler, {
    actionType: "WEB_BOARD_WRITE",
    affectedTable: "WebShillaMiuBoardAllocation+Group",
    riskLevel: "LOW",
  }),
);
