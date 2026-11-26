import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderUnit, requireOrderYear } from '../../../lib/orderUtils';
import { roundQty } from '../../../lib/orderImportCompareLogic';
import {
  ensureOrderImportSnapshotTable,
  listOrderImportSnapshots,
} from '../../../lib/orderImportSnapshotStore';

function parseNumericHistoryValue(val) {
  if (val == null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function kstDateKey(timestampStr) {
  const s = String(timestampStr || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

async function handleOptions(req, res) {
  await ensureOrderImportSnapshotTable(null);

  const ywRes = await query(
    `SELECT OrderYear, OrderWeek
       FROM (
         SELECT TRY_CONVERT(INT, OrderYear) AS OrderYear, OrderWeek
           FROM OrderMaster
          WHERE ISNULL(isDeleted, 0) = 0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT TRY_CONVERT(INT, OrderYear) AS OrderYear, OrderWeek
           FROM ShipmentMaster
          WHERE ISNULL(isDeleted, 0) = 0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderYear, OrderWeek
           FROM dbo.WebOrderImportSnapshot
          WHERE IsDeleted = 0 AND OrderWeek LIKE '__-__'
       ) t
      WHERE OrderYear BETWEEN 2020 AND 2100
        AND TRY_CONVERT(INT, LEFT(OrderWeek, 2)) BETWEEN 1 AND 53
        AND TRY_CONVERT(INT, RIGHT(OrderWeek, 2)) BETWEEN 1 AND 9
      ORDER BY OrderYear DESC,
               TRY_CONVERT(INT, LEFT(OrderWeek, 2)) DESC,
               TRY_CONVERT(INT, RIGHT(OrderWeek, 2)) DESC`,
  );

  const rows = ywRes.recordset || [];
  const years = [...new Set(rows.map((r) => Number(r.OrderYear)))].sort((a, b) => b - a);
  const reqYear = parseInt(req.query.orderYear, 10);
  const selectedYear = Number.isInteger(reqYear) && reqYear >= 2020 && reqYear <= 2100
    ? reqYear
    : years[0] || new Date().getFullYear();

  const weeks = rows
    .filter((r) => Number(r.OrderYear) === selectedYear)
    .map((r) => ({
      orderWeek: r.OrderWeek,
      parentWeek: String(r.OrderWeek).slice(0, 2),
      subWeek: r.OrderWeek,
    }));

  let customers = [];
  const rawWeek = String(req.query.orderWeek || '').trim();
  if (rawWeek) {
    let scope;
    try {
      scope = requireOrderYear(rawWeek, String(selectedYear));
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    }

    const custRes = await query(
      `WITH UploadCust AS (
         SELECT DISTINCT CustKey
           FROM dbo.WebOrderImportSnapshot
          WHERE OrderYear = @yr AND OrderWeek = @wk AND IsDeleted = 0
       ),
       OrderCust AS (
         SELECT DISTINCT CustKey
           FROM OrderMaster
          WHERE OrderYear = @yr AND OrderWeek = @wk AND ISNULL(isDeleted, 0) = 0
       ),
       ShipCust AS (
         SELECT DISTINCT COALESCE(NULLIF(sd.CustKey, 0), sm.CustKey) AS CustKey
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
          WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND ISNULL(sm.isDeleted, 0) = 0
       ),
       AllCust AS (
         SELECT CustKey FROM UploadCust
         UNION
         SELECT CustKey FROM OrderCust
         UNION
         SELECT CustKey FROM ShipCust
       )
       SELECT ac.CustKey AS custKey,
              c.CustName AS custName,
              c.CustArea AS custArea,
              c.Manager AS manager,
              CASE WHEN uc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasUploadSnapshot,
              CASE WHEN oc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasOrder,
              CASE WHEN sc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasShipment
         FROM AllCust ac
         JOIN Customer c ON c.CustKey = ac.CustKey
         LEFT JOIN UploadCust uc ON uc.CustKey = ac.CustKey
         LEFT JOIN OrderCust oc ON oc.CustKey = ac.CustKey
         LEFT JOIN ShipCust sc ON sc.CustKey = ac.CustKey
        ORDER BY hasUploadSnapshot DESC, hasShipment DESC, c.CustName ASC`,
      {
        yr: { type: sql.Int, value: Number(scope.orderYear) },
        wk: { type: sql.NVarChar, value: scope.orderWeek },
      },
    );

    customers = (custRes.recordset || []).map((r) => ({
      custKey: Number(r.custKey),
      custName: r.custName || '',
      custArea: r.custArea || '',
      manager: r.manager || '',
      hasUploadSnapshot: Number(r.hasUploadSnapshot) === 1,
      hasOrder: Number(r.hasOrder) === 1,
      hasShipment: Number(r.hasShipment) === 1,
    }));
  }

  return res.status(200).json({
    success: true,
    orderYear: selectedYear,
    years,
    weeks,
    customers,
  });
}

async function handleCompare(req, res) {
  let scope;
  try {
    scope = requireOrderYear(req.query.orderWeek, req.query.orderYear);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }

  const custKey = parseInt(req.query.custKey, 10);
  if (!Number.isInteger(custKey) || custKey <= 0) {
    return res.status(400).json({ success: false, error: '유효한 custKey가 필요합니다.' });
  }

  const yrNum = Number(scope.orderYear);
  const wk = scope.orderWeek;

  await ensureOrderImportSnapshotTable(null);

  const [snapshots, orderRowsRes, shipmentRes, customerRes] = await Promise.all([
    listOrderImportSnapshots(null, { orderYear: yrNum, orderWeek: wk, custKey }),
    query(
      `SELECT od.OrderDetailKey,
              od.OrderMasterKey,
              od.ProdKey,
              p.ProdName,
              ISNULL(p.DisplayName, p.ProdName) AS DisplayName,
              p.FlowerName,
              p.CounName,
              p.OutUnit,
              ISNULL(p.BunchOf1Box, 0) AS BunchOf1Box,
              ISNULL(p.SteamOf1Box, 0) AS SteamOf1Box,
              ISNULL(od.isDeleted, 0) AS DetailDeleted,
              ISNULL(od.UnitPrice, 0) AS UnitPrice,
              CASE p.OutUnit
                WHEN N'단' THEN ISNULL(od.BunchQuantity, 0)
                WHEN N'송이' THEN ISNULL(od.SteamQuantity, 0)
                ELSE ISNULL(od.BoxQuantity, 0)
              END AS UnitColQty,
              ISNULL(od.OutQuantity, 0) AS RawOutQuantity,
              CONVERT(NVARCHAR(19), ISNULL(od.CreateDtm, ISNULL(om.CreateDtm, om.OrderDtm)), 126) AS RegDtm
         FROM OrderMaster om
         INNER JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         INNER JOIN Product p ON p.ProdKey = od.ProdKey
        WHERE om.OrderYear = @yr
          AND om.OrderWeek = @wk
          AND om.CustKey = @ck
          AND ISNULL(om.isDeleted, 0) = 0
        ORDER BY od.OrderDetailKey ASC`,
      {
        yr: { type: sql.Int, value: yrNum },
        wk: { type: sql.NVarChar, value: wk },
        ck: { type: sql.Int, value: custKey },
      },
    ),
    query(
      `SELECT sd.ProdKey,
              p.ProdName,
              ISNULL(p.DisplayName, p.ProdName) AS DisplayName,
              p.FlowerName,
              p.CounName,
              p.OutUnit,
              SUM(ISNULL(sd.OutQuantity, 0)) AS ShipQty
         FROM ShipmentMaster sm
         INNER JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         INNER JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sm.OrderYear = @yr
          AND sm.OrderWeek = @wk
          AND (sm.CustKey = @ck OR sd.CustKey = @ck)
          AND ISNULL(sm.isDeleted, 0) = 0
        GROUP BY sd.ProdKey, p.ProdName, ISNULL(p.DisplayName, p.ProdName), p.FlowerName, p.CounName, p.OutUnit
       HAVING SUM(ISNULL(sd.OutQuantity, 0)) <> 0
        ORDER BY MIN(sd.SdetailKey) ASC`,
      {
        yr: { type: sql.Int, value: yrNum },
        wk: { type: sql.NVarChar, value: wk },
        ck: { type: sql.Int, value: custKey },
      },
    ),
    query(
      `SELECT CustKey, CustName, CustArea, Manager
         FROM Customer
        WHERE CustKey = @ck`,
      { ck: { type: sql.Int, value: custKey } },
    ),
  ]);

  const orderRows = orderRowsRes.recordset || [];
  const detailKeys = orderRows.map((r) => Number(r.OrderDetailKey)).filter((k) => k > 0);
  const historyByDetailKey = new Map();

  if (detailKeys.length > 0) {
    const dkParams = {};
    const placeholders = detailKeys.map((dk, idx) => {
      const key = `dk${idx}`;
      dkParams[key] = { type: sql.Int, value: dk };
      return `@${key}`;
    });
    const histRes = await query(
      `SELECT oh.OrderDetailKey,
              oh.OrderHistoryKey,
              oh.BeforeValue,
              oh.AfterValue,
              CONVERT(NVARCHAR(19), oh.ChangeDtm, 126) AS ChangeDtm
         FROM OrderHistory oh
        WHERE oh.OrderDetailKey IN (${placeholders.join(',')})
          AND oh.ColumName IN (N'수량', N'주문수량')
        ORDER BY oh.ChangeDtm ASC, oh.OrderHistoryKey ASC`,
      dkParams,
    );
    for (const h of histRes.recordset || []) {
      const dk = Number(h.OrderDetailKey);
      if (!historyByDetailKey.has(dk)) {
        historyByDetailKey.set(dk, h);
      }
    }
  }

  const orderDateGroups = new Map();
  let activeOrderCount = 0;
  let activeOrderTotalQty = 0;

  for (const row of orderRows) {
    const dk = Number(row.OrderDetailKey);
    const unitColQty = Number(row.UnitColQty) || 0;
    const rawOutQty = Number(row.RawOutQuantity) || 0;
    const currentQty = unitColQty > 0 ? unitColQty : rawOutQty > 0 ? rawOutQty : 0;

    if (Number(row.DetailDeleted) === 0 && currentQty > 0) {
      activeOrderCount += 1;
      activeOrderTotalQty = roundQty(activeOrderTotalQty + currentQty);
    }

    const firstHist = historyByDetailKey.get(dk);
    let initialQty = 0;
    if (firstHist) {
      const beforeVal = parseNumericHistoryValue(firstHist.BeforeValue);
      const afterVal = parseNumericHistoryValue(firstHist.AfterValue);
      if (beforeVal === 0 && afterVal != null && afterVal > 0) {
        initialQty = afterVal;
      } else if (beforeVal != null && beforeVal > 0) {
        initialQty = beforeVal;
      }
    } else if (Number(row.DetailDeleted) === 0) {
      initialQty = currentQty;
    }

    if (!(initialQty > 0)) continue;

    const regDtm = String(row.RegDtm || '');
    const dateKey = kstDateKey(regDtm) || 'unknown';
    if (!orderDateGroups.has(dateKey)) {
      orderDateGroups.set(dateKey, {
        id: `order-date:${dateKey}`,
        sourceKind: 'ORDER_DATE',
        dateKey,
        timestamp: regDtm || `${dateKey}T00:00:00`,
        label: '직접 주문등록',
        sheetPreview: null,
        items: [],
      });
    }

    const group = orderDateGroups.get(dateKey);
    const outUnit = normalizeOrderUnit(row.OutUnit || '박스', '박스');
    group.items.push({
      rowNo: group.items.length + 1,
      orderDetailKey: dk,
      prodKey: Number(row.ProdKey),
      prodName: row.ProdName || '',
      displayName: row.DisplayName || row.ProdName || '',
      flowerName: row.FlowerName || '',
      counName: row.CounName || '',
      inputName: row.DisplayName || row.ProdName || '',
      colorOrDetail: '',
      matchName: '',
      qty: roundQty(initialQty),
      outQty: roundQty(initialQty),
      unit: outUnit,
      rawUnit: outUnit,
      outUnit,
      bunchOf1Box: Number(row.BunchOf1Box) || 0,
      steamOf1Box: Number(row.SteamOf1Box) || 0,
      unitPrice: Number(row.UnitPrice) || 0,
      note: '',
      rawCells: null,
    });
  }

  const uploadCandidates = snapshots.map((s) => ({
    id: `upload:${s.snapshotId}`,
    sourceKind: 'UPLOAD',
    snapshotId: s.snapshotId,
    dateKey: kstDateKey(s.createdAt),
    timestamp: s.createdAt,
    label: s.fileName ? `엑셀 업로드 · ${s.fileName}` : '엑셀 업로드',
    fileName: s.fileName,
    sheetName: s.sheetName,
    createdBy: s.createdBy,
    sheetPreview: s.sheetPreview || null,
    items: s.items || [],
  }));

  const candidates = [...uploadCandidates, ...orderDateGroups.values()].sort((a, b) =>
    String(a.timestamp || a.dateKey).localeCompare(String(b.timestamp || b.dateKey)),
  );

  const shipmentItems = (shipmentRes.recordset || []).map((row) => ({
    prodKey: Number(row.ProdKey),
    prodName: row.ProdName || '',
    displayName: row.DisplayName || row.ProdName || '',
    flowerName: row.FlowerName || '',
    counName: row.CounName || '',
    outUnit: normalizeOrderUnit(row.OutUnit || '박스', '박스'),
    shipQty: roundQty(Number(row.ShipQty) || 0),
  }));

  const custRow = customerRes.recordset?.[0] || null;
  const customer = custRow
    ? {
        custKey: Number(custRow.CustKey),
        custName: custRow.CustName || '',
        custArea: custRow.CustArea || '',
        manager: custRow.Manager || '',
      }
    : { custKey, custName: '', custArea: '', manager: '' };

  return res.status(200).json({
    success: true,
    orderYear: yrNum,
    orderWeek: wk,
    customer,
    candidates,
    shipmentItems,
    currentOrderSummary: {
      itemCount: activeOrderCount,
      totalQty: activeOrderTotalQty,
    },
  });
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (req.query.action === 'options') {
    return handleOptions(req, res);
  }
  return handleCompare(req, res);
}

export default withAuth(handler);
