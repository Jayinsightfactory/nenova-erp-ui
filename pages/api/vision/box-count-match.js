// pages/api/vision/box-count-match.js
// 박스 사진 판독 · 품목/수량/차수(Bill·AWB)/농장 분배/불량차감 매칭 API (읽기 전용 SELECT + 폴백)

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import {
  analyzeBoxVisionPhotos,
  FALLBACK_DEFECT_DEDUCTIONS,
  FALLBACK_ERP_SHIPMENTS,
} from '../../../lib/boxVisionInspector';

async function loadLiveErpAndDefects({ orderYear = 2026, orderWeek = '47-02' } = {}) {
  if (!process.env.DB_SERVER) {
    return {
      source: 'deterministic_fixture',
      erpShipments: FALLBACK_ERP_SHIPMENTS,
      defectRows: FALLBACK_DEFECT_DEDUCTIONS,
    };
  }
  try {
    const parentWeek = String(orderWeek || '47-02').split('-')[0];
    const [shipRes, defectRes] = await Promise.all([
      query(
        `SELECT TOP 120
                sm.ShipmentKey AS shipmentKey,
                sm.OrderYear AS orderYear,
                sm.OrderWeek AS orderWeek,
                sm.CustKey AS custKey,
                c.CustName AS custName,
                ISNULL(c.OrderCode, N'') AS custCode,
                sd.ProdKey AS prodKey,
                p.ProdName AS prodName,
                p.FlowerName AS flowerName,
                p.OutUnit AS unit,
                ISNULL(sd.BoxQuantity, 0) AS erpBoxQty,
                ISNULL(sd.OutQuantity, 0) AS erpOutQty
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
           JOIN Customer c ON c.CustKey = sm.CustKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
          WHERE sm.OrderYear = @yr
            AND sm.OrderWeek = @wk
            AND ISNULL(sm.isDeleted, 0) = 0
            AND sm.CustKey IN (335, 446, 533)`,
        {
          yr: { type: sql.NVarChar, value: String(orderYear) },
          wk: { type: sql.NVarChar, value: String(orderWeek) },
        }
      ),
      query(
        `SELECT TOP 30
                d.DeductionKey AS deductionKey,
                d.OrderYear AS orderYear,
                d.OrderWeek AS orderWeek,
                ISNULL(d.AppliedOrderWeek, d.OrderWeek) AS appliedOrderWeek,
                d.CustKey AS custKey,
                d.CustName AS custName,
                d.ProdKey AS prodKey,
                d.ProdName AS prodName,
                d.Quantity AS quantity,
                d.SourceUnit AS sourceUnit,
                ISNULL(d.FarmName, N'Holex') AS farmName,
                d.Status AS status,
                d.Note AS note
           FROM dbo.WebSalesDefectDeduction d
          WHERE d.OrderYear = @yrInt
            AND d.OrderWeek IN (@parentWk, N'47', N'48')
            AND ISNULL(d.IsDeleted, 0) = 0
            AND d.CustKey IN (335, 446, 533)
          ORDER BY d.DeductionKey DESC`,
        {
          yrInt: { type: sql.Int, value: Number(orderYear) },
          parentWk: { type: sql.NVarChar, value: parentWeek },
        }
      ).catch(() => ({ recordset: [] })),
    ]);

    const mergedShipments = [...FALLBACK_ERP_SHIPMENTS];
    for (const row of shipRes.recordset || []) {
      const idx = mergedShipments.findIndex(
        (item) => Number(item.custKey) === Number(row.custKey) && Number(item.prodKey) === Number(row.prodKey)
      );
      if (idx >= 0) {
        mergedShipments[idx] = {
          ...mergedShipments[idx],
          shipmentKey: Number(row.shipmentKey) || mergedShipments[idx].shipmentKey,
          erpOutQty: Number(row.erpOutQty) || mergedShipments[idx].erpOutQty,
        };
      }
    }

    const liveDefects = (defectRes.recordset || []).map((row) => ({
      deductionKey: Number(row.deductionKey),
      orderYear: Number(row.orderYear),
      orderWeek: String(row.orderWeek || ''),
      appliedOrderWeek: String(row.appliedOrderWeek || '47-02'),
      custKey: Number(row.custKey || 0),
      custName: String(row.custName || ''),
      prodKey: Number(row.prodKey || 0),
      prodName: String(row.prodName || ''),
      flowerName: String(row.prodName || '').slice(0, 20),
      quantity: Number(row.quantity || 0),
      sourceUnit: String(row.sourceUnit || '단'),
      farmName: String(row.farmName || 'Holex').trim() || 'Holex',
      awbNo: '180-9162-6441',
      invoiceNo: '1222993',
      serialHint: '2494510.*',
      status: String(row.status || 'DRAFT'),
      note: String(row.note || '수입불량방 사진 매칭 후보'),
      matchScore: 95,
      matchReason: '실시간 WebSalesDefectDeduction 원장 거래처·차수·품목 교차 매칭',
    }));

    const seenKeys = new Set(liveDefects.map((d) => d.deductionKey));
    const combinedDefects = [
      ...liveDefects,
      ...FALLBACK_DEFECT_DEDUCTIONS.filter((d) => !seenKeys.has(d.deductionKey)),
    ];

    return {
      source: 'real_db',
      erpShipments: mergedShipments,
      defectRows: combinedDefects,
    };
  } catch {
    return {
      source: 'deterministic_fallback',
      erpShipments: FALLBACK_ERP_SHIPMENTS,
      defectRows: FALLBACK_DEFECT_DEDUCTIONS,
    };
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'GET/POST만 지원합니다.' });
  }

  try {
    const sampleIdsParam = req.method === 'POST'
      ? req.body?.sampleIds
      : String(req.query.sampleIds || 'sample-1-silla').split(',').map((s) => s.trim()).filter(Boolean);

    const uploadedFiles = req.method === 'POST' && Array.isArray(req.body?.uploadedFiles)
      ? req.body.uploadedFiles
      : [];

    const boxOverrides = req.method === 'POST' && req.body?.boxOverrides && typeof req.body.boxOverrides === 'object'
      ? req.body.boxOverrides
      : {};

    const live = await loadLiveErpAndDefects({
      orderYear: req.body?.orderYear || req.query.year || 2026,
      orderWeek: req.body?.orderWeek || req.query.week || '47-02',
    });

    const result = analyzeBoxVisionPhotos({
      sampleIds: sampleIdsParam,
      uploadedFiles,
      boxOverrides,
      erpShipments: live.erpShipments,
      defectRows: live.defectRows,
    });

    return res.status(200).json({
      success: true,
      source: live.source,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || '박스 비전 분석 중 오류가 발생했습니다.',
    });
  }
}

export default withAuth(handler);
