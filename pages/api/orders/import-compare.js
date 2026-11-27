import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderUnit, requireOrderYear } from '../../../lib/orderUtils';
import { roundQty, pickDefaultOrderWeek } from '../../../lib/orderImportCompareLogic';
import {
  ensureOrderImportSnapshotTable,
} from '../../../lib/orderImportSnapshotStore';

function parseNumericHistoryValue(val) {
  if (val == null) return null;
  const cleaned = String(val).replace(/[,\s]+/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function kstDateKey(timestampStr) {
  const s = String(timestampStr || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseOrderWeeksScope(rawOrderWeeks, rawOrderWeek, rawOrderYear) {
  const rawList = [];
  const pushTokens = (v) => {
    if (Array.isArray(v)) {
      v.forEach(pushTokens);
    } else if (v != null && String(v).trim()) {
      for (const part of String(v).split(',')) {
        const t = part.trim();
        if (t) rawList.push(t);
      }
    }
  };
  pushTokens(rawOrderWeeks);
  if (rawList.length === 0) pushTokens(rawOrderWeek);

  if (rawList.length === 0) {
    const err = new Error('orderWeek 또는 orderWeeks가 필요합니다.');
    err.statusCode = 400;
    throw err;
  }

  let resolvedYear = rawOrderYear ? String(rawOrderYear).trim() : '';
  const weekSet = new Set();
  for (const tok of rawList) {
    const sc = requireOrderYear(tok, resolvedYear);
    if (!/^\d{2}-\d{2}$/.test(sc.orderWeek)) {
      const err = new Error(`유효하지 않은 세부차수 형식입니다: ${tok}`);
      err.statusCode = 400;
      throw err;
    }
    if (resolvedYear && sc.orderYear !== resolvedYear) {
      const err = new Error('모든 세부차수의 연도가 일치해야 합니다.');
      err.statusCode = 400;
      throw err;
    }
    resolvedYear = sc.orderYear;
    weekSet.add(sc.orderWeek);
  }

  const orderWeeks = [...weekSet].sort((a, b) => a.localeCompare(b));
  if (orderWeeks.length > 12) {
    const err = new Error('최대 12개의 세부차수까지만 합산 조회할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  return { orderYear: resolvedYear, orderWeeks };
}

function buildWeekInClause(orderWeeks, prefix = 'wk') {
  const params = {};
  const placeholders = orderWeeks.map((wk, idx) => {
    const key = `${prefix}${idx}`;
    params[key] = { type: sql.NVarChar, value: wk };
    return `@${key}`;
  });
  return { inClause: placeholders.join(','), params };
}

function chunkArray(list, size = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

async function handleOptions(req, res) {
  await ensureOrderImportSnapshotTable(null);

  const ywRes = await query(
    `WITH OrderWeeks AS (
       SELECT TRY_CONVERT(INT, om.OrderYear) AS OrderYear,
              om.OrderWeek
         FROM OrderMaster om
         INNER JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         INNER JOIN Product p ON p.ProdKey = od.ProdKey
        WHERE ISNULL(om.isDeleted, 0) = 0
          AND ISNULL(od.isDeleted, 0) = 0
          AND om.OrderWeek LIKE '__-__'
          AND TRY_CONVERT(INT, om.OrderYear) BETWEEN 2020 AND 2100
          AND TRY_CONVERT(INT, LEFT(om.OrderWeek, 2)) BETWEEN 1 AND 53
          AND TRY_CONVERT(INT, RIGHT(om.OrderWeek, 2)) BETWEEN 1 AND 9
          AND (
            (CASE p.OutUnit
               WHEN N'단' THEN ISNULL(od.BunchQuantity, 0)
               WHEN N'송이' THEN ISNULL(od.SteamQuantity, 0)
               ELSE ISNULL(od.BoxQuantity, 0)
             END) > 0
            OR ISNULL(od.OutQuantity, 0) > 0
          )
        GROUP BY TRY_CONVERT(INT, om.OrderYear), om.OrderWeek
     ),
     ShipWeeks AS (
       SELECT TRY_CONVERT(INT, sm.OrderYear) AS OrderYear,
              sm.OrderWeek,
              COUNT(DISTINCT CASE
                WHEN ISNULL(sd.OutQuantity, 0) <> 0
                THEN COALESCE(NULLIF(sd.CustKey, 0), sm.CustKey)
              END) AS ShipmentCustomerCount
         FROM ShipmentMaster sm
         INNER JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        WHERE ISNULL(sm.isDeleted, 0) = 0
          AND sm.OrderWeek LIKE '__-__'
          AND TRY_CONVERT(INT, sm.OrderYear) BETWEEN 2020 AND 2100
          AND TRY_CONVERT(INT, LEFT(sm.OrderWeek, 2)) BETWEEN 1 AND 53
          AND TRY_CONVERT(INT, RIGHT(sm.OrderWeek, 2)) BETWEEN 1 AND 9
        GROUP BY TRY_CONVERT(INT, sm.OrderYear), sm.OrderWeek
       HAVING SUM(CASE WHEN ISNULL(sd.OutQuantity, 0) <> 0 THEN 1 ELSE 0 END) > 0
     ),
     SnapWeeks AS (
       SELECT DISTINCT
              OrderYear,
              OrderWeek
         FROM dbo.WebOrderImportSnapshot
        WHERE IsDeleted = 0
          AND ItemCount > 0
          AND OrderWeek LIKE '__-__'
          AND OrderYear BETWEEN 2020 AND 2100
          AND TRY_CONVERT(INT, LEFT(OrderWeek, 2)) BETWEEN 1 AND 53
          AND TRY_CONVERT(INT, RIGHT(OrderWeek, 2)) BETWEEN 1 AND 9
     ),
     AllWeeks AS (
       SELECT OrderYear, OrderWeek FROM OrderWeeks
       UNION
       SELECT OrderYear, OrderWeek FROM ShipWeeks
       UNION
       SELECT OrderYear, OrderWeek FROM SnapWeeks
     )
     SELECT aw.OrderYear,
            aw.OrderWeek,
            CASE WHEN ow.OrderWeek IS NOT NULL THEN 1 ELSE 0 END AS HasOrder,
            CASE WHEN sw.OrderWeek IS NOT NULL THEN 1 ELSE 0 END AS HasShipment,
            CASE WHEN snw.OrderWeek IS NOT NULL THEN 1 ELSE 0 END AS HasUploadSnapshot,
            ISNULL(sw.ShipmentCustomerCount, 0) AS ShipmentCustomerCount
       FROM AllWeeks aw
       LEFT JOIN OrderWeeks ow ON ow.OrderYear = aw.OrderYear AND ow.OrderWeek = aw.OrderWeek
       LEFT JOIN ShipWeeks sw ON sw.OrderYear = aw.OrderYear AND sw.OrderWeek = aw.OrderWeek
       LEFT JOIN SnapWeeks snw ON snw.OrderYear = aw.OrderYear AND snw.OrderWeek = aw.OrderWeek
      ORDER BY aw.OrderYear DESC,
               TRY_CONVERT(INT, LEFT(aw.OrderWeek, 2)) DESC,
               TRY_CONVERT(INT, RIGHT(aw.OrderWeek, 2)) DESC`,
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
      orderYear: Number(r.OrderYear),
      parentWeek: String(r.OrderWeek).slice(0, 2),
      orderWeek: r.OrderWeek,
      subWeek: r.OrderWeek,
      hasOrder: Number(r.HasOrder) === 1,
      hasShipment: Number(r.HasShipment) === 1,
      hasUploadSnapshot: Number(r.HasUploadSnapshot) === 1,
      shipmentCustomerCount: Number(r.ShipmentCustomerCount) || 0,
    }));

  const defaultOrderWeek = pickDefaultOrderWeek(weeks);
  const defaultParentWeek = defaultOrderWeek ? defaultOrderWeek.slice(0, 2) : '';

  let customers = [];
  let selectedOrderWeeks = [];
  const hasWeekInput =
    Boolean(String(req.query.orderWeeks || '').trim()) ||
    Boolean(String(req.query.orderWeek || '').trim());
  if (hasWeekInput) {
    let scope;
    try {
      scope = parseOrderWeeksScope(req.query.orderWeeks, req.query.orderWeek, String(selectedYear));
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    }
    selectedOrderWeeks = scope.orderWeeks;
    const { inClause, params: wkParams } = buildWeekInClause(selectedOrderWeeks, 'wk');

    const custRes = await query(
      `WITH UploadCust AS (
         SELECT DISTINCT CustKey
           FROM dbo.WebOrderImportSnapshot
          WHERE OrderYear = @yrInt AND OrderWeek IN (${inClause}) AND IsDeleted = 0
       ),
       OrderCust AS (
         SELECT DISTINCT om.CustKey
           FROM OrderMaster om
           INNER JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
           INNER JOIN Product p ON p.ProdKey = od.ProdKey
          WHERE om.OrderYear = @yrStr
            AND om.OrderWeek IN (${inClause})
            AND ISNULL(om.isDeleted, 0) = 0
            AND ISNULL(od.isDeleted, 0) = 0
            AND (
              (CASE p.OutUnit
                 WHEN N'단' THEN ISNULL(od.BunchQuantity, 0)
                 WHEN N'송이' THEN ISNULL(od.SteamQuantity, 0)
                 ELSE ISNULL(od.BoxQuantity, 0)
               END) > 0
              OR ISNULL(od.OutQuantity, 0) > 0
            )
       ),
       ShipCust AS (
         SELECT COALESCE(NULLIF(sd.CustKey, 0), sm.CustKey) AS CustKey
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
          WHERE sm.OrderYear = @yrStr AND sm.OrderWeek IN (${inClause}) AND ISNULL(sm.isDeleted, 0) = 0
          GROUP BY COALESCE(NULLIF(sd.CustKey, 0), sm.CustKey)
         HAVING SUM(ISNULL(sd.OutQuantity, 0)) <> 0
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
              LTRIM(RTRIM(ISNULL(c.Manager, N''))) AS manager,
              CASE WHEN uc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasUploadSnapshot,
              CASE WHEN oc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasOrder,
              CASE WHEN sc.CustKey IS NOT NULL THEN 1 ELSE 0 END AS hasShipment
         FROM AllCust ac
         JOIN Customer c ON c.CustKey = ac.CustKey
         LEFT JOIN UploadCust uc ON uc.CustKey = ac.CustKey
         LEFT JOIN OrderCust oc ON oc.CustKey = ac.CustKey
         LEFT JOIN ShipCust sc ON sc.CustKey = ac.CustKey
        ORDER BY hasShipment DESC, hasUploadSnapshot DESC, c.CustName ASC`,
      {
        yrInt: { type: sql.Int, value: Number(scope.orderYear) },
        yrStr: { type: sql.NVarChar, value: String(scope.orderYear) },
        ...wkParams,
      },
    );

    customers = (custRes.recordset || []).map((r) => ({
      custKey: Number(r.custKey),
      custName: r.custName || '',
      custArea: r.custArea || '',
      manager: String(r.manager || '').trim(),
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
    defaultOrderWeek,
    defaultParentWeek,
    selectedOrderWeeks,
    customers,
  });
}

async function handleCompare(req, res) {
  let scope;
  try {
    scope = parseOrderWeeksScope(req.query.orderWeeks, req.query.orderWeek, req.query.orderYear);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }

  const custKey = parseInt(req.query.custKey, 10);
  if (!Number.isInteger(custKey) || custKey <= 0) {
    return res.status(400).json({ success: false, error: '유효한 custKey가 필요합니다.' });
  }

  const yrNum = Number(scope.orderYear);
  const yrStr = String(scope.orderYear);
  const orderWeeks = scope.orderWeeks;
  const { inClause: wkInClause, params: wkParams } = buildWeekInClause(orderWeeks, 'wk');

  await ensureOrderImportSnapshotTable(null);

  const [snapshotRes, orderRowsRes, shipmentRes, customerRes] = await Promise.all([
    query(
      `SELECT SnapshotId, OrderYear, OrderWeek, CustKey, CustName, SnapshotKind,
              FileName, SheetName, SourceType, ItemCount, TotalQty,
              ItemsJson, SheetPreviewJson, CreatedBy,
              CONVERT(NVARCHAR(19), CreatedAt, 126) AS CreatedAt
         FROM dbo.WebOrderImportSnapshot
        WHERE OrderYear = @yrInt
          AND OrderWeek IN (${wkInClause})
          AND CustKey = @ck
          AND IsDeleted = 0
        ORDER BY CreatedAt ASC, SnapshotId ASC`,
      {
        yrInt: { type: sql.Int, value: yrNum },
        ck: { type: sql.Int, value: custKey },
        ...wkParams,
      },
    ),
    query(
      `SELECT od.OrderDetailKey,
              od.OrderMasterKey,
              om.OrderWeek,
              od.ProdKey,
              p.ProdName,
              ISNULL(p.DisplayName, p.ProdName) AS DisplayName,
              p.FlowerName,
              p.CounName,
              p.OutUnit,
              ISNULL(p.BunchOf1Box, 0) AS BunchOf1Box,
              ISNULL(p.SteamOf1Box, 0) AS SteamOf1Box,
              ISNULL(od.isDeleted, 0) AS DetailDeleted,
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
          AND om.OrderWeek IN (${wkInClause})
          AND om.CustKey = @ck
          AND ISNULL(om.isDeleted, 0) = 0
        ORDER BY om.OrderWeek ASC, od.OrderDetailKey ASC`,
      {
        yr: { type: sql.NVarChar, value: yrStr },
        ck: { type: sql.Int, value: custKey },
        ...wkParams,
      },
    ),
    query(
      `SELECT
              sm.ShipmentKey,
              sm.OrderWeek,
              sd.SdetailKey,
              sd.ProdKey,
              p.ProdName,
              ISNULL(p.DisplayName, p.ProdName) AS DisplayName,
              p.FlowerName,
              p.CounName,
              p.OutUnit,
              ISNULL(sd.OutQuantity, 0) AS OutQuantity,
              ISNULL(sd.EstQuantity, 0) AS EstQuantity,
              ISNULL(sd.Cost, 0) AS Cost,
              ISNULL(sd.Amount, 0) AS Amount,
              CAST(ISNULL(sd.isFix, 0) AS INT) AS isFix,
              CONVERT(NVARCHAR(19), sd.ShipmentDtm, 126) AS DetailShipmentDtm
         FROM ShipmentMaster sm
         INNER JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         INNER JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sm.OrderYear = @yr
          AND sm.OrderWeek IN (${wkInClause})
          AND (sm.CustKey = @ck OR sd.CustKey = @ck)
          AND ISNULL(sm.isDeleted, 0) = 0
        ORDER BY p.ProdName ASC, sm.OrderWeek ASC, sm.ShipmentKey ASC, sd.SdetailKey ASC`,
      {
        yr: { type: sql.NVarChar, value: yrStr },
        ck: { type: sql.Int, value: custKey },
        ...wkParams,
      },
    ),
    query(
      `SELECT CustKey, CustName, CustArea, LTRIM(RTRIM(ISNULL(Manager, N''))) AS Manager
         FROM Customer
        WHERE CustKey = @ck`,
      { ck: { type: sql.Int, value: custKey } },
    ),
  ]);

  const snapshots = (snapshotRes.recordset || []).map((row) => ({
    snapshotId: Number(row.SnapshotId),
    orderYear: Number(row.OrderYear),
    orderWeek: row.OrderWeek,
    custKey: Number(row.CustKey),
    custName: row.CustName || '',
    snapshotKind: row.SnapshotKind || 'UPLOAD_REGISTER',
    fileName: row.FileName || '',
    sheetName: row.SheetName || '',
    sourceType: row.SourceType || '',
    itemCount: Number(row.ItemCount || 0),
    totalQty: Number(row.TotalQty || 0),
    items: safeJsonParse(row.ItemsJson, []),
    sheetPreview: safeJsonParse(row.SheetPreviewJson, null),
    createdBy: row.CreatedBy || '',
    createdAt: row.CreatedAt || '',
  }));

  // Enrich snapshot items missing CounName / FlowerName via Product lookup (1 batch query)
  const missingMetaProdKeys = [
    ...new Set(
      snapshots
        .flatMap((s) => (Array.isArray(s.items) ? s.items : []))
        .filter((it) => {
          const pk = Number(it?.prodKey);
          return Number.isInteger(pk) && pk > 0 && (!it.counName || !it.flowerName);
        })
        .map((it) => Number(it.prodKey)),
    ),
  ];

  const productMetaMap = new Map();
  if (missingMetaProdKeys.length > 0) {
    const prodChunks = chunkArray(missingMetaProdKeys, 500);
    const prodChunkResults = await Promise.all(
      prodChunks.map((chunk) => {
        const pkParams = {};
        const placeholders = chunk.map((pk, idx) => {
          const key = `pk${idx}`;
          pkParams[key] = { type: sql.Int, value: pk };
          return `@${key}`;
        });
        return query(
          `SELECT ProdKey, CounName, FlowerName, OutUnit
             FROM Product
            WHERE ProdKey IN (${placeholders.join(',')})`,
          pkParams,
        );
      }),
    );
    for (const r of prodChunkResults) {
      for (const row of r.recordset || []) {
        productMetaMap.set(Number(row.ProdKey), {
          counName: row.CounName || '',
          flowerName: row.FlowerName || '',
          outUnit: row.OutUnit || '',
        });
      }
    }
  }

  const orderRows = orderRowsRes.recordset || [];
  const detailKeys = orderRows.map((r) => Number(r.OrderDetailKey)).filter((k) => k > 0);
  const shipmentDetailRows = shipmentRes.recordset || [];
  const sdetailKeys = [
    ...new Set(shipmentDetailRows.map((r) => Number(r.SdetailKey)).filter((k) => k > 0)),
  ];

  // Fetch OrderHistory and ShipmentDate in parallel
  const historyByDetailKey = new Map();
  const shipDatesBySdetailKey = new Map();

  await Promise.all([
    (async () => {
      if (detailKeys.length === 0) return;
      const chunks = chunkArray(detailKeys, 500);
      const resList = await Promise.all(
        chunks.map((chunk) => {
          const dkParams = {};
          const placeholders = chunk.map((dk, idx) => {
            const key = `dk${idx}`;
            dkParams[key] = { type: sql.Int, value: dk };
            return `@${key}`;
          });
          return query(
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
        }),
      );
      for (const histRes of resList) {
        for (const h of histRes.recordset || []) {
          const dk = Number(h.OrderDetailKey);
          if (!historyByDetailKey.has(dk)) {
            historyByDetailKey.set(dk, h);
          }
        }
      }
    })(),
    (async () => {
      if (sdetailKeys.length === 0) return;
      const chunks = chunkArray(sdetailKeys, 500);
      const resList = await Promise.all(
        chunks.map((chunk) => {
          const sdkParams = {};
          const placeholders = chunk.map((sdk, idx) => {
            const key = `sdk${idx}`;
            sdkParams[key] = { type: sql.Int, value: sdk };
            return `@${key}`;
          });
          return query(
            `SELECT SdateKey,
                    SdetailKey,
                    CONVERT(NVARCHAR(19), ShipmentDtm, 126) AS ShipmentDtm,
                    ISNULL(ShipmentQuantity, 0) AS ShipmentQuantity,
                    ISNULL(EstQuantity, 0) AS EstQuantity,
                    ISNULL(Cost, 0) AS Cost,
                    ISNULL(Amount, 0) AS Amount
               FROM ShipmentDate
              WHERE SdetailKey IN (${placeholders.join(',')})
              ORDER BY ShipmentDtm ASC, SdateKey ASC`,
            sdkParams,
          );
        }),
      );
      for (const sdateRes of resList) {
        for (const sdRow of sdateRes.recordset || []) {
          const sdk = Number(sdRow.SdetailKey);
          if (!shipDatesBySdetailKey.has(sdk)) {
            shipDatesBySdetailKey.set(sdk, []);
          }
          shipDatesBySdetailKey.get(sdk).push(sdRow);
        }
      }
    })(),
  ]);

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
    const wkTag = String(row.OrderWeek || '').trim();
    const groupKey = `${wkTag}:${dateKey}`;
    if (!orderDateGroups.has(groupKey)) {
      orderDateGroups.set(groupKey, {
        id: `order-date:${groupKey}`,
        sourceKind: 'ORDER_DATE',
        orderWeek: wkTag,
        dateKey,
        timestamp: regDtm || `${dateKey}T00:00:00`,
        label: '직접 주문등록',
        sheetPreview: null,
        items: [],
      });
    }

    const group = orderDateGroups.get(groupKey);
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
      unitPrice: null,
      note: '',
      rawCells: null,
    });
  }

  const uploadCandidates = snapshots.map((s) => ({
    id: `upload:${s.snapshotId}`,
    sourceKind: 'UPLOAD',
    orderWeek: s.orderWeek || '',
    snapshotId: s.snapshotId,
    dateKey: kstDateKey(s.createdAt),
    timestamp: s.createdAt,
    label: s.fileName ? `엑셀 업로드 · ${s.fileName}` : '엑셀 업로드',
    fileName: s.fileName,
    sheetName: s.sheetName,
    createdBy: s.createdBy,
    sheetPreview: s.sheetPreview || null,
    items: (Array.isArray(s.items) ? s.items : []).map((it) => {
      const pk = Number(it?.prodKey);
      const meta = Number.isInteger(pk) && pk > 0 ? productMetaMap.get(pk) : null;
      if (!meta) return it;
      return {
        ...it,
        counName: it.counName || meta.counName || '',
        flowerName: it.flowerName || meta.flowerName || '',
        outUnit: it.outUnit || (meta.outUnit ? normalizeOrderUnit(meta.outUnit, '박스') : ''),
      };
    }),
  }));

  const candidates = [...uploadCandidates, ...orderDateGroups.values()].sort((a, b) =>
    String(a.timestamp || a.dateKey).localeCompare(String(b.timestamp || b.dateKey)),
  );

  const shipmentGroups = new Map();
  for (const row of shipmentDetailRows) {
    const pk = Number(row.ProdKey);
    if (!Number.isInteger(pk) || pk <= 0) continue;
    if (!shipmentGroups.has(pk)) {
      shipmentGroups.set(pk, {
        prodKey: pk,
        prodName: row.ProdName || '',
        displayName: row.DisplayName || row.ProdName || '',
        flowerName: row.FlowerName || '',
        counName: row.CounName || '',
        outUnit: normalizeOrderUnit(row.OutUnit || '박스', '박스'),
        shipQty: 0,
        shipAmount: 0,
        shipCostWeightedSum: 0,
        details: [],
        shipDateMap: new Map(),
      });
    }
    const group = shipmentGroups.get(pk);
    const outQty = roundQty(Number(row.OutQuantity) || 0);
    const estQty = roundQty(Number(row.EstQuantity) || 0);
    const cost = Number(row.Cost) || 0;
    const amount = Number(row.Amount) || 0;
    const isFix = Number(row.isFix) === 1 ? 1 : 0;
    const sdetailKey = Number(row.SdetailKey);
    const detailFallbackDate = kstDateKey(row.DetailShipmentDtm);

    group.shipQty = roundQty(group.shipQty + outQty);
    group.shipAmount += amount;
    group.details.push({
      shipmentKey: Number(row.ShipmentKey),
      orderWeek: row.OrderWeek || '',
      sdetailKey,
      outQty,
      estQty,
      cost,
      amount,
      isFix,
    });

    const sdateRows = shipDatesBySdetailKey.get(sdetailKey) || [];
    const nonZeroSdates = sdateRows.filter((sd) => Number(sd.ShipmentQuantity || 0) !== 0);
    if (nonZeroSdates.length > 0) {
      for (const sdRow of nonZeroSdates) {
        const dk = kstDateKey(sdRow.ShipmentDtm) || detailFallbackDate;
        if (!dk) continue;
        const sdQty = roundQty(Number(sdRow.ShipmentQuantity) || 0);
        const sdAmt = Number(sdRow.Amount) || 0;
        const prevDate = group.shipDateMap.get(dk);
        if (prevDate) {
          prevDate.qty = roundQty(prevDate.qty + sdQty);
          prevDate.amount += sdAmt;
        } else {
          group.shipDateMap.set(dk, { dateKey: dk, qty: sdQty, amount: sdAmt });
        }
      }
    } else if (outQty !== 0 && detailFallbackDate) {
      const prevDate = group.shipDateMap.get(detailFallbackDate);
      if (prevDate) {
        prevDate.qty = roundQty(prevDate.qty + outQty);
        prevDate.amount += amount;
      } else {
        group.shipDateMap.set(detailFallbackDate, {
          dateKey: detailFallbackDate,
          qty: outQty,
          amount,
        });
      }
    }
  }

  const shipmentItems = [];
  for (const group of shipmentGroups.values()) {
    if (group.shipQty === 0) continue;
    const hasFixed = group.details.some((d) => d.isFix === 1);
    const distinctCosts = [
      ...new Set(group.details.map((d) => Math.round(Number(d.cost || 0) * 100) / 100)),
    ];
    const hasMixedShipCost = distinctCosts.length > 1;
    const shipCost =
      distinctCosts.length === 1
        ? distinctCosts[0]
        : (group.details.find((d) => Number(d.cost || 0) !== 0)?.cost ?? 0);
    const shipDates = [...group.shipDateMap.values()]
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .map((d) => ({
        dateKey: d.dateKey,
        qty: roundQty(d.qty),
        amount: Math.round(d.amount * 100) / 100,
      }));

    shipmentItems.push({
      prodKey: group.prodKey,
      prodName: group.prodName,
      displayName: group.displayName,
      flowerName: group.flowerName,
      counName: group.counName,
      outUnit: group.outUnit,
      shipQty: group.shipQty,
      shipAmount: Math.round(group.shipAmount * 100) / 100,
      hasFixed,
      distinctCosts,
      hasMixedShipCost,
      shipCost,
      shipmentDetails: group.details,
      shipDates,
    });
  }

  const custRow = customerRes.recordset?.[0] || null;
  const customer = custRow
    ? {
        custKey: Number(custRow.CustKey),
        custName: custRow.CustName || '',
        custArea: custRow.CustArea || '',
        manager: String(custRow.Manager || '').trim(),
      }
    : { custKey, custName: '', custArea: '', manager: '' };

  return res.status(200).json({
    success: true,
    orderYear: yrNum,
    orderWeek: orderWeeks[0],
    orderWeeks,
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
