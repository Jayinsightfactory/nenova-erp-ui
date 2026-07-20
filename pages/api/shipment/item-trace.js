// pages/api/shipment/item-trace.js — 주문 vs 분배 대조 (읽기 전용)
//  특정 차수에서 업체/품목 키워드로 OrderDetail(주문) 과 ShipmentDetail(분배)/ShipmentDate 상태를
//  나란히 보여준다. "주문은 있는데 분배가 안 보임"의 실제 원인(분배 미생성/출고일 누락 등) 진단용.
//  GET ?week=23-01&q=문라이트
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const week = normalizeOrderWeek(req.query.week || '');
  const year = resolveActiveOrderYear(week, req.query.year || '');
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
              sdSum.ShipDateQty, sdSum.ShipDateCnt, sdSum.ShipDateDistinctDtm,
              sfSum.ShipFarmQty, sfSum.ShipFarmCnt,
              -- ViewOrder(전산 분배 grid 원천) INNER JOIN 적격성: 하나라도 실패하면 거래처가 분배 grid에서 사라짐
              om.Manager, p.CounName,
              ISNULL(c.isDeleted,0)                            AS CustDel,
              ISNULL(p.isDeleted,0)                            AS ProdDel,
              CASE WHEN ct.CounName IS NULL THEN 0 ELSE 1 END  AS CountryOK,
              CASE WHEN ui.UserID   IS NULL THEN 0 ELSE 1 END  AS ManagerOK
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
         JOIN Customer c ON c.CustKey=om.CustKey
         JOIN Product  p ON p.ProdKey=od.ProdKey
         LEFT JOIN Country  ct ON p.CounName = ct.CounName
         LEFT JOIN UserInfo ui ON om.Manager = ui.UserID
         OUTER APPLY (
            SELECT TOP 1 sm.ShipmentKey, sm.CustKey, sm.isDeleted, sm.isFix
              FROM ShipmentMaster sm
             WHERE sm.CustKey=om.CustKey AND sm.OrderYear=@yr AND sm.OrderWeek=om.OrderWeek AND ISNULL(sm.isDeleted,0)=0
             ORDER BY ISNULL(sm.isFix,0) DESC, sm.ShipmentKey ASC
         ) sm
         OUTER APPLY (
            SELECT TOP 1 sd.SdetailKey, sd.OutQuantity, sd.CustKey, sd.ShipmentDtm
              FROM ShipmentDetail sd
             WHERE sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=od.ProdKey
             ORDER BY sd.SdetailKey ASC
         ) sd
         OUTER APPLY (
            SELECT SUM(sdt.ShipmentQuantity) AS ShipDateQty, COUNT(*) AS ShipDateCnt,
                   COUNT(DISTINCT CONVERT(date, sdt.ShipmentDtm)) AS ShipDateDistinctDtm
              FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey
         ) sdSum
         OUTER APPLY (
            SELECT SUM(sf.ShipmentQuantity) AS ShipFarmQty, COUNT(*) AS ShipFarmCnt
              FROM ShipmentFarm sf WHERE sf.SdetailKey=sd.SdetailKey
         ) sfSum
        WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
          AND ( c.CustName LIKE @q
                OR p.ProdName LIKE @q
                OR ISNULL(p.DisplayName,'') LIKE @q )
        ORDER BY c.CustName, p.ProdName`,
      {
        wk: { type: sql.NVarChar, value: week },
        yr: { type: sql.NVarChar, value: year },
        q:  { type: sql.NVarChar, value: `%${q}%` },
      }
    );

    const rows = (r.recordset || []).map(x => {
      const orderQty = Number(x.OrderQty || 0);
      const shipQty = x.ShipQty == null ? null : Number(x.ShipQty);
      const shipDateQty = x.ShipDateQty == null ? null : Number(x.ShipDateQty);
      const shipFarmQty = x.ShipFarmQty == null ? null : Number(x.ShipFarmQty);
      const shipFarmCnt = Number(x.ShipFarmCnt || 0);
      const shipDateCnt = Number(x.ShipDateCnt || 0);

      // ViewOrder 적격성 — 전산 분배 grid 는 ViewOrder 기반이라, 이게 실패하면 거래처가 grid 에서 사라짐(분배 입력 불가)
      const voReasons = [];
      if (Number(x.CustDel) === 1) voReasons.push('업체삭제(isDeleted=1)');
      if (Number(x.ProdDel) === 1) voReasons.push('품목삭제(isDeleted=1)');
      if (Number(x.CountryOK) === 0) voReasons.push(`품목 CounName '${x.CounName || '(빈값)'}' 가 Country 테이블에 없음`);
      if (Number(x.ManagerOK) === 0) voReasons.push(`Manager '${x.Manager || '(빈값)'}' 가 UserInfo.UserID 에 없음`);
      const viewOrderVisible = voReasons.length === 0;

      let status, reason;
      if (!viewOrderVisible) { status = '전산주문숨김'; reason = `ViewOrder 탈락 → 분배 grid 에 거래처 안 뜸: ${voReasons.join(' / ')}`; }
      else if (shipQty == null) { status = '분배없음'; reason = '주문은 있으나 ShipmentDetail 미생성 → 분배 필요'; }
      else if (shipQty === 0) { status = '분배0'; reason = '분배수량 0 (빈 출고라인)'; }
      else if (!x.ShipDtm) { status = '출고일없음'; reason = 'ShipmentDtm 비어있음'; }
      else if (shipDateCnt === 0) { status = 'ShipmentDate없음'; reason = 'ShipmentDate 행 없음'; }
      else if (shipDateQty == null || Math.abs((shipDateQty || 0) - shipQty) > 0.001) { status = 'ShipmentDate불일치'; reason = `ShipmentDate합계(${shipDateQty ?? '없음'})≠분배수량(${shipQty})`; }
      else if (shipFarmCnt === 0) { status = '농장미배정'; reason = 'ShipmentFarm 행 없음(웹 미작성) — 농장별 배정만 비고 거래처/수량은 표시됨'; }
      else if (Number(x.ShipCustKey || 0) !== Number(x.MasterCustKey || 0)) { status = 'CustKey불일치'; reason = `상세CustKey(${x.ShipCustKey})≠마스터(${x.MasterCustKey})`; }
      else status = '정상';
      return {
        custName: x.CustName, custKey: x.CustKey,
        prodName: x.DisplayName || x.ProdName, prodKey: x.ProdKey,
        orderQty, shipQty, shipDateQty, shipFarmQty, shipFarmCnt, shipDateCnt,
        shipDtm: x.ShipDtm || null,
        shipCustKey: x.ShipCustKey ?? null,
        masterCustKey: x.MasterCustKey ?? null,
        sdetailKey: x.SdetailKey ?? null,
        masterFix: Number(x.MasterFix || 0),
        manager: x.Manager ?? null, counName: x.CounName ?? null,
        viewOrderVisible,
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
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS SdDtm,
              c.CustName, ISNULL(c.isDeleted,0) AS CustDel,
              p.ProdName, p.DisplayName, ISNULL(p.isDeleted,0) AS ProdDel
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         LEFT JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
          AND ( c.CustName LIKE @q OR p.ProdName LIKE @q OR ISNULL(p.DisplayName,'') LIKE @q )
        ORDER BY c.CustName, p.ProdName, sm.ShipmentKey`,
      {
        wk: { type: sql.NVarChar, value: week },
        yr: { type: sql.NVarChar, value: year },
        q: { type: sql.NVarChar, value: `%${q}%` },
      }
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
        smDel: Number(x.SmDel), prodDel: Number(x.ProdDel), custDel: Number(x.CustDel),
        smFix: Number(x.SmFix), webCreated: Number(x.WebCreated),
        smCust: x.SmCust, sdCust: x.SdCust, shipDtm: x.SdDtm || null, smWeek: x.SmWeek,
        visibleInErp: visible,
        ghost: !visible && Number(x.OutQuantity || 0) !== 0, // 안 보이는데 수량 있음 = 취소 차단 고스트
        hiddenReason: hidden.join('+') || '',
      };
    });

    // 3) 마스터 단위 고스트 — nenova.exe 취소 게이트와 동일 단위.
    //    FormOrderAdd 는 SELECT COUNT(*) FROM ShipmentMaster WHERE OrderYear+OrderWeek+CustKey (isDeleted 무시!)
    //    로 분배 존재를 판단해 취소를 막는다. 반면 ViewShipment 는 sm.isDeleted=0 + 표시가능 detail 이 있어야 보인다.
    //    → 표시 안 되는데(=VisibleDetail 0 / 마스터·업체 삭제) 게이트엔 잡히는 마스터 = 취소 차단 고스트.
    const gm = await query(
      `SELECT sm.ShipmentKey, sm.CustKey, c.CustName,
              ISNULL(sm.isDeleted,0) AS SmDel, ISNULL(sm.isFix,0) AS SmFix,
              ISNULL(sm.WebCreated,0) AS WebCreated, ISNULL(c.isDeleted,0) AS CustDel,
              (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey) AS DetailCnt,
              (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)<>0) AS NzCnt,
              (SELECT COUNT(*) FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
                 WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)<>0 AND ISNULL(p.isDeleted,0)=0) AS VisCnt
         FROM ShipmentMaster sm
         JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk
          AND ( c.CustName LIKE @q
                OR EXISTS ( SELECT 1 FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
                             WHERE sd.ShipmentKey=sm.ShipmentKey
                               AND (p.ProdName LIKE @q OR ISNULL(p.DisplayName,'') LIKE @q) ) )
        ORDER BY c.CustName, sm.ShipmentKey`,
      {
        wk: { type: sql.NVarChar, value: week },
        yr: { type: sql.NVarChar, value: year },
        q: { type: sql.NVarChar, value: `%${q}%` },
      }
    );

    const ghostMasters = (gm.recordset || []).map(x => {
      const smDel = Number(x.SmDel), custDel = Number(x.CustDel), visCnt = Number(x.VisCnt);
      const visibleInErp = smDel === 0 && custDel === 0 && visCnt > 0;
      const reasons = [];
      if (smDel === 1) reasons.push('마스터삭제');
      if (custDel === 1) reasons.push('업체삭제');
      if (visCnt === 0) reasons.push('표시가능분배0');
      return {
        shipmentKey: x.ShipmentKey, custKey: x.CustKey, custName: x.CustName,
        smDel, smFix: Number(x.SmFix), webCreated: Number(x.WebCreated), custDel,
        detailCnt: Number(x.DetailCnt), nzCnt: Number(x.NzCnt), visCnt,
        visibleInErp,
        // 취소 게이트(COUNT ShipmentMaster, isDeleted 무시)엔 잡히지만 ViewShipment 엔 안 보임 = 고스트
        blocksCancelButHidden: !visibleInErp,
        // 안전 정리 후보: 확정(isFix) 아니고, 표시가능 분배 0(실제 분배 없음)
        safeToClean: Number(x.SmFix) === 0 && visCnt === 0,
        reason: reasons.join('+') || '정상표시',
      };
    });

    return res.status(200).json({
      success: true, year, week, q,
      count: rows.length, rows,
      rawCount: rawRows.length, raw: rawRows,
      ghostCount: rawRows.filter(r => r.ghost).length,
      ghostMasters,
      ghostMasterCount: ghostMasters.filter(g => g.blocksCancelButHidden).length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
