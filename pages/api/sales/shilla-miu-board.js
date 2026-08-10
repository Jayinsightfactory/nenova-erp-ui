import { withAuth } from "../../../lib/auth";
import { query, withTransaction, sql } from "../../../lib/db";
import {
  buildGroupRows,
  buildMajorWeeks,
  normalizeMajorWeek,
} from "../../../lib/shillaMiuBoard";

const text = (v, fallback = "") => String(v ?? fallback).trim();
const isAdmin = (user) =>
  Number(user?.authority) <= 1 ||
  /admin|관리자|대표/i.test(String(user?.authority || "")) ||
  user?.deptName === "대표";

let schemaPromise;
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
    IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation') AND name=N'IX_WebShillaMiuBoardAllocation_GroupScope') CREATE INDEX IX_WebShillaMiuBoardAllocation_GroupScope ON dbo.WebShillaMiuBoardAllocation(OrderYear,GroupKey,UseWeek,ProdKey,isDeleted);
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
  `).catch((e) => {
    schemaPromise = null;
    throw e;
  });
  return schemaPromise;
}

async function groups() {
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

async function loadBoard({ year, weeks, group }) {
  const params = {
    yr: { type: sql.NVarChar, value: year },
    base: { type: sql.Int, value: Number(group.baseCustKey) },
    receiver: { type: sql.Int, value: Number(group.receiverCustKey) },
    group: { type: sql.Int, value: Number(group.groupKey) },
  };
  const names = weeks.map((_, i) => `w${i}`);
  names.forEach((name, i) => {
    params[name] = { type: sql.NVarChar, value: weeks[i] };
  });
  const clause = names.map((n) => `@${n}`).join(",");
  const shipmentSql = `SELECT LEFT(sm.OrderWeek,2) week,sm.OrderWeek orderWeek,p.ProdKey prodKey,p.CounName country,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName,p.OutUnit unit,SUM(ISNULL(sd.OutQuantity,0)) qty FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0 WHERE sm.OrderYear=@yr AND LEFT(sm.OrderWeek,2) IN (${clause}) AND sm.CustKey=@cust AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0 GROUP BY LEFT(sm.OrderWeek,2),sm.OrderWeek,p.ProdKey,p.CounName,p.DisplayName,p.ProdName,p.OutUnit`;
  const [base, receiver, allocation] = await Promise.all([
    query(shipmentSql, {
      ...params,
      cust: { type: sql.Int, value: Number(group.baseCustKey) },
    }),
    query(shipmentSql, {
      ...params,
      cust: { type: sql.Int, value: Number(group.receiverCustKey) },
    }),
    query(
      `SELECT BoardKey boardKey,UseWeek useWeek,ProdKey prodKey,Qty qty,Matched matched,Memo memo FROM dbo.WebShillaMiuBoardAllocation WHERE OrderYear=@yr AND ISNULL(isDeleted,0)=0 AND ((GroupKey=@group) OR (GroupKey IS NULL AND @group=(SELECT TOP 1 GroupKey FROM dbo.WebShillaMiuBoardGroup WHERE IsActive=1 ORDER BY DisplayOrder,GroupKey) AND Destination IN (N'MIU',N'RAUM'))) AND UseWeek IN (${clause})`,
      params,
    ),
  ]);
  return {
    rows: buildGroupRows({
      weeks,
      baseShipments: base.recordset,
      receiverShipments: receiver.recordset,
      allocations: allocation.recordset,
    }),
  };
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
  return res.json({ success: true, groups: await groups() });
}

async function saveAllocations(req, res) {
  const b = req.body || {},
    year = text(b.year),
    groupKey = Number(b.groupKey),
    items = Array.isArray(b.allocations) ? b.allocations : [];
  if (!/^\d{4}$/.test(year) || !groupKey || !items.length)
    return res
      .status(400)
      .json({ success: false, error: "연도·업체그룹·저장할 행이 필요합니다." });
  const actor = text(req.user?.userId, "user").slice(0, 50);
  await withTransaction(async (tq) => {
    for (const x of items) {
      const pk = Number(x.prodKey),
        week = normalizeMajorWeek(x.useWeek),
        qty = Number(x.qty || 0);
      if (!Number.isInteger(pk) || pk <= 0 || !Number.isFinite(qty) || qty < 0)
        throw new Error("잔량이동 값이 올바르지 않습니다.");
      const p = {
        yr: { type: sql.NVarChar, value: year },
        g: { type: sql.Int, value: groupKey },
        w: { type: sql.NVarChar, value: week },
        pk: { type: sql.Int, value: pk },
        qty: { type: sql.Decimal(18, 3), value: qty },
        matched: { type: sql.Bit, value: !!x.matched },
        memo: { type: sql.NVarChar, value: text(x.memo).slice(0, 500) },
        actor: { type: sql.NVarChar, value: actor },
      };
      await tq(
        `IF EXISTS(SELECT 1 FROM dbo.WebShillaMiuBoardAllocation WITH(UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND GroupKey=@g AND UseWeek=@w AND ProdKey=@pk AND ISNULL(isDeleted,0)=0) UPDATE dbo.WebShillaMiuBoardAllocation SET Qty=@qty,Matched=@matched,Memo=@memo,UpdatedBy=@actor,UpdatedAt=GETDATE() WHERE OrderYear=@yr AND GroupKey=@g AND UseWeek=@w AND ProdKey=@pk AND ISNULL(isDeleted,0)=0 ELSE INSERT dbo.WebShillaMiuBoardAllocation(OrderYear,SupplyWeek,UseWeek,ProdKey,Destination,Qty,Matched,Memo,CreatedBy,UpdatedBy,GroupKey) VALUES(@yr,@w,@w,@pk,N'MIU',@qty,@matched,@memo,@actor,@actor,@g)`,
        p,
      );
    }
  });
  return res.json({ success: true, saved: items.length });
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === "POST" && req.body?.action === "save-group")
      return saveGroup(req, res);
    if (req.method === "POST") return saveAllocations(req, res);
    if (req.method !== "GET") return res.status(405).end();
    if (req.query.mode === "customers") {
      const q = `%${text(req.query.q).slice(0, 50)}%`;
      const r = await query(
        `SELECT TOP 50 CustKey custKey,CustName custName FROM Customer WHERE ISNULL(isDeleted,0)=0 AND CustName LIKE @q ORDER BY CustName`,
        { q: { type: sql.NVarChar, value: q } },
      );
      return res.json({ success: true, customers: r.recordset });
    }
    const all = await groups(),
      latest = await latestScope();
    const year = text(req.query.year, latest.year);
    const start = req.query.startWeek || latest.week,
      end = req.query.endWeek || start,
      weeks = buildMajorWeeks(start, end);
    const active = all.filter((g) => g.isActive);
    const requestedGroupKey = Number(req.query.groupKey || 0);
    const selected =
      active.find((g) => g.groupKey === requestedGroupKey) || null;
    const boards = selected
      ? []
      : await Promise.all(
          active.map(async (group) => ({
            group,
            ...(await loadBoard({ year, weeks, group })),
          })),
        );
    const data = selected
      ? await loadBoard({ year, weeks, group: selected })
      : { rows: [], boards };
    return res.json({
      success: true,
      year,
      weeks,
      latest,
      groups: all,
      selectedGroup: selected,
      isAdmin: isAdmin(req.user),
      ...data,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
