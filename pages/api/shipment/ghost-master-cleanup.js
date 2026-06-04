// pages/api/shipment/ghost-master-cleanup.js
//  취소 차단 고스트 ShipmentMaster 정리 (특정 ShipmentKey 만 타겟).
//
//  배경(dnSpy 확인): nenova.exe FormOrderAdd 는
//    SELECT COUNT(*) FROM ShipmentMaster WHERE OrderYear AND OrderWeek AND CustKey (isDeleted 무시)
//  로 분배 존재를 판단해 주문 취소를 막는다. 그런데 ViewShipment 는 sm.isDeleted=0 + 표시가능
//  detail 이 있어야 표시 → 빈/숨겨진 마스터는 "취소는 막는데 화면엔 안 보이는" 고스트가 된다.
//
//  안전장치(서버 재검증, 클라 신뢰 안 함):
//   - isFix=1(확정) 마스터 거부.
//   - 비삭제 품목에 OutQuantity<>0 인 detail 이 하나라도 있으면 거부(=실제 분배, 고스트 아님).
//   - 위 통과 시에만 해당 ShipmentKey 의 ShipmentDate/ShipmentDetail/ShipmentMaster 를 하드 삭제.
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  const shipmentKey = parseInt(req.body?.shipmentKey, 10);
  if (!Number.isFinite(shipmentKey) || shipmentKey <= 0) {
    return res.status(400).json({ success: false, error: 'shipmentKey 필요' });
  }

  try {
    // 사전 검증 (트랜잭션 밖, 빠른 거부)
    const chk = await query(
      `SELECT sm.ShipmentKey, ISNULL(sm.isFix,0) AS SmFix, ISNULL(sm.isDeleted,0) AS SmDel,
              sm.CustKey, sm.OrderYear, sm.OrderWeek,
              (SELECT COUNT(*) FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
                 WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)<>0 AND ISNULL(p.isDeleted,0)=0) AS VisCnt,
              (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey) AS DetailCnt
         FROM ShipmentMaster sm WHERE sm.ShipmentKey=@sk`,
      { sk: { type: sql.Int, value: shipmentKey } }
    );
    const m = chk.recordset[0];
    if (!m) return res.status(404).json({ success: false, error: '해당 ShipmentMaster 없음(이미 정리됨?)' });
    if (Number(m.SmFix) === 1) {
      return res.status(409).json({ success: false, error: '확정(isFix=1)된 마스터는 정리할 수 없습니다. 전산에서 확정취소 후 진행하세요.' });
    }
    if (Number(m.VisCnt) > 0) {
      return res.status(409).json({ success: false, error: `실제 분배(표시가능 ${m.VisCnt}건)가 있는 마스터입니다 — 고스트 아님. 삭제하지 않습니다.` });
    }

    const result = await withTransaction(async (tQ) => {
      // 재검증 (락 하에서)
      const re = await tQ(
        `SELECT ISNULL(sm.isFix,0) AS SmFix,
                (SELECT COUNT(*) FROM ShipmentDetail sd JOIN Product p ON p.ProdKey=sd.ProdKey
                   WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)<>0 AND ISNULL(p.isDeleted,0)=0) AS VisCnt
           FROM ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK) WHERE sm.ShipmentKey=@sk`,
        { sk: { type: sql.Int, value: shipmentKey } }
      );
      const r = re.recordset[0];
      if (!r) throw new Error('마스터가 사라졌습니다(동시 정리?)');
      if (Number(r.SmFix) === 1) throw new Error('확정 마스터 — 정리 불가');
      if (Number(r.VisCnt) > 0) throw new Error('실제 분배 존재 — 정리 불가');

      const dDate = await tQ(
        `DELETE sdt FROM ShipmentDate sdt
           JOIN ShipmentDetail sd ON sd.SdetailKey=sdt.SdetailKey
          WHERE sd.ShipmentKey=@sk`,
        { sk: { type: sql.Int, value: shipmentKey } }
      );
      const dDetail = await tQ(
        `DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk`,
        { sk: { type: sql.Int, value: shipmentKey } }
      );
      const dMaster = await tQ(
        `DELETE FROM ShipmentMaster WHERE ShipmentKey=@sk`,
        { sk: { type: sql.Int, value: shipmentKey } }
      );
      return {
        shipmentDateDeleted: dDate.rowsAffected?.[0] || 0,
        shipmentDetailDeleted: dDetail.rowsAffected?.[0] || 0,
        shipmentMasterDeleted: dMaster.rowsAffected?.[0] || 0,
      };
    });

    return res.status(200).json({
      success: true,
      shipmentKey,
      custKey: m.CustKey, orderWeek: m.OrderWeek,
      message: `고스트 마스터 정리 완료 (ShipmentKey ${shipmentKey}) — 마스터 ${result.shipmentMasterDeleted} / 상세 ${result.shipmentDetailDeleted} / 출고일 ${result.shipmentDateDeleted} 삭제. 이제 주문 취소가 가능합니다.`,
      ...result,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'GHOST_MASTER_CLEANUP', affectedTable: 'ShipmentMaster/Detail/Date', riskLevel: 'HIGH' }));
