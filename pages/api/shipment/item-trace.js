// pages/api/shipment/item-trace.js — 주문 vs 분배 대조 (읽기 전용)
//  특정 차수에서 업체/품목 키워드로 OrderDetail(주문) 과 ShipmentDetail(분배)/ShipmentDate 상태를
//  나란히 보여준다. "주문은 있는데 분배가 안 보임"의 실제 원인(분배 미생성/출고일 누락 등) 진단용.
//  GET ?week=23-01&q=문라이트
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const week = normalizeOrderWeek(req.query.week || '');
  const q = String(req.query.q || '').trim();
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!q) return res.status(400).json({ success: false, error: '검색어(업체/품목) 필요' });

  try {
    const r = await query(
      `SELECT TOP 200
              c.CustName, om.CustKey,
              p.ProdName, p.DisplayName, od.ProdKey,
              od.OutQuantity                                   AS OrderQty,
              sd.OutQuantity                                   AS ShipQty,
              sd.CustKey                                       AS ShipCustKey,
              sm.CustKey                                       AS MasterCustKey,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)       AS ShipDtm,
              sd.SdetailKey,
              ISNULL(sm.isDeleted,0)                           AS MasterDeleted,
              ISNULL(sm.isFix,0)                               AS MasterFix,
              sdSum.ShipDateQty
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
         JOIN Customer c ON c.CustKey=om.CustKey
         JOIN Product  p ON p.ProdKey=od.ProdKey
         OUTER APPLY (
            SELECT TOP 1 sm.ShipmentKey, sm.CustKey, sm.isDeleted, sm.isFix
              FROM ShipmentMaster sm
             WHERE sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek AND ISNULL(sm.isDeleted,0)=0
             ORDER BY ISNULL(sm.isFix,0) DESC, sm.ShipmentKey ASC
         ) sm
         OUTER APPLY (
            SELECT TOP 1 sd.SdetailKey, sd.OutQuantity, sd.CustKey, sd.ShipmentDtm
              FROM ShipmentDetail sd
             WHERE sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=od.ProdKey
             ORDER BY sd.SdetailKey ASC
         ) sd
         OUTER APPLY (
            SELECT SUM(sdt.ShipmentQuantity) AS ShipDateQty
              FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey
         ) sdSum
        WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
          AND ( c.CustName LIKE @q
                OR p.ProdName LIKE @q
                OR ISNULL(p.DisplayName,'') LIKE @q )
        ORDER BY c.CustName, p.ProdName`,
      {
        wk: { type: sql.NVarChar, value: week },
        q:  { type: sql.NVarChar, value: `%${q}%` },
      }
    );

    const rows = (r.recordset || []).map(x => {
      const orderQty = Number(x.OrderQty || 0);
      const shipQty = x.ShipQty == null ? null : Number(x.ShipQty);
      const shipDateQty = x.ShipDateQty == null ? null : Number(x.ShipDateQty);
      let status, reason;
      if (shipQty == null) { status = '분배없음'; reason = '주문은 있으나 ShipmentDetail 미생성 → 분배 필요'; }
      else if (shipQty === 0) { status = '분배0'; reason = '분배수량 0 (빈 출고라인)'; }
      else if (!x.ShipDtm) { status = '출고일없음'; reason = 'ShipmentDtm 비어있음 → 전산 분배화면에서 안 보임'; }
      else if (shipDateQty == null || Math.abs((shipDateQty || 0) - shipQty) > 0.001) { status = 'ShipmentDate불일치'; reason = `ShipmentDate합계(${shipDateQty ?? '없음'})≠분배수량(${shipQty})`; }
      else if (Number(x.ShipCustKey || 0) !== Number(x.MasterCustKey || 0)) { status = 'CustKey불일치'; reason = `상세CustKey(${x.ShipCustKey})≠마스터(${x.MasterCustKey})`; }
      else status = '정상';
      return {
        custName: x.CustName, custKey: x.CustKey,
        prodName: x.DisplayName || x.ProdName, prodKey: x.ProdKey,
        orderQty, shipQty, shipDateQty,
        shipDtm: x.ShipDtm || null,
        shipCustKey: x.ShipCustKey ?? null,
        masterCustKey: x.MasterCustKey ?? null,
        sdetailKey: x.SdetailKey ?? null,
        masterFix: Number(x.MasterFix || 0),
        status, reason: reason || '',
      };
    });

    // 2) RAW 조회 — 모든 ShipmentDetail(삭제 플래그 무관) + 마스터/품목/업체 isDeleted.
    //    nenova.exe ViewShipment 는 sm.isDeleted=0 AND p.isDeleted=0 AND c.isDeleted=0 만 표시(sd.isDeleted 무시).
    //    → 마스터/품목/업체가 삭제 처리되면 분배가 DB엔 있어도 전산 화면엔 안 보이지만, 취소 차단은 됨(고스트).
    const raw = await query(
      `SELECT TOP 300
              sm.ShipmentKey, sm.OrderWeek AS SmWeek, ISNULL(sm.isDeleted,0) AS SmDel,
              ISNULL(sm.isFix,0) AS SmFix, sm.CustKey AS SmCust, ISNULL(sm.WebCreated,0) AS WebCreated,
              sd.SdetailKey, sd.OutQuantity, sd.CustKey AS SdCust,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS SdDtm, ISNULL(sd.isDeleted,0) AS SdDel,
              c.CustName, ISNULL(c.isDeleted,0) AS CustDel,
              p.ProdName, p.DisplayName, ISNULL(p.isDeleted,0) AS ProdDel
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         LEFT JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderWeek=@wk
          AND ( c.CustName LIKE @q OR p.ProdName LIKE @q OR ISNULL(p.DisplayName,'') LIKE @q )
        ORDER BY c.CustName, p.ProdName, sm.ShipmentKey`,
      { wk: { type: sql.NVarChar, value: week }, q: { type: sql.NVarChar, value: `%${q}%` } }
    );

    const rawRows = (raw.recordset || []).map(x => {
      const hidden = [];
      if (Number(x.SmDel) === 1) hidden.push('마스터삭제');
      if (Number(x.ProdDel) === 1) hidden.push('품목삭제');
      if (Number(x.CustDel) === 1) hidden.push('업체삭제');
      const visible = hidden.length === 0; // 전산 ViewShipment 표시 여부 (sd.isDeleted 는 무시됨)
      return {
        custName: x.CustName, prodName: x.DisplayName || x.ProdName,
        shipmentKey: x.ShipmentKey, sdetailKey: x.SdetailKey,
        outQty: Number(x.OutQuantity || 0),
        smDel: Number(x.SmDel), sdDel: Number(x.SdDel), prodDel: Number(x.ProdDel), custDel: Number(x.CustDel),
        smFix: Number(x.SmFix), webCreated: Number(x.WebCreated),
        smCust: x.SmCust, sdCust: x.SdCust, shipDtm: x.SdDtm || null, smWeek: x.SmWeek,
        visibleInErp: visible,
        ghost: !visible && Number(x.OutQuantity || 0) !== 0, // 안 보이는데 수량 있음 = 취소 차단 고스트
        hiddenReason: hidden.join('+') || '',
      };
    });

    return res.status(200).json({
      success: true, week, q,
      count: rows.length, rows,
      rawCount: rawRows.length, raw: rawRows,
      ghostCount: rawRows.filter(r => r.ghost).length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
