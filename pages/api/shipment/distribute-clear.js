// pages/api/shipment/distribute-clear.js
// 출고분배 개별 초기화 — nenova.exe FormShipmentDistribution "개별 초기화" 버튼과 동일.
// 전산 SP usp_DistributeClear(@OrderYear,@OrderWeek,@ProdKey,@iUserID,@oResult out) 를 직접 호출한다.
// distribute-sp.js 의 shape 추론을 쓰지 않고 파라미터를 전부 명시 → 5입력 SP 미스매치 이슈 회피.
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { withTransaction, sql } from '../../../lib/db';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const uid = req.user?.userId || 'admin';
  const week = normalizeOrderWeek(req.body?.week || '');
  const orderYear = resolveActiveOrderYear(req.body?.week, req.body?.year);
  const prodKey = Number(req.body?.prodKey || 0);
  if (!week) return res.status(400).json({ success: false, error: '차수(week) 필요' });
  if (!prodKey) return res.status(400).json({ success: false, error: '초기화할 품목(prodKey) 필요' });

  try {
    const result = await withTransaction(async (tQ) => {
      // 확정(isFix=1)된 분배는 초기화 금지 — 먼저 확정취소 필요
      const fixed = await tQ(
        `SELECT TOP 5 c.CustName, p.ProdName
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
           LEFT JOIN Customer c ON c.CustKey=sm.CustKey
           LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
          WHERE sm.OrderWeek=@wk AND sm.OrderYear=@yr AND sd.ProdKey=@pk
            AND ISNULL(sm.isDeleted,0)=0 AND (sm.isFix=1 OR sd.isFix=1)`,
        { wk: { type: sql.NVarChar, value: week }, yr: { type: sql.NVarChar, value: orderYear }, pk: { type: sql.Int, value: prodKey } }
      );
      if ((fixed.recordset || []).length) {
        const names = fixed.recordset.map(r => `${r.CustName || ''} ${r.ProdName || ''}`.trim()).join(', ');
        throw new Error(`확정된 출고분배는 초기화할 수 없습니다. 먼저 확정취소하세요: ${names}`);
      }

      const before = await tQ(
        `SELECT COUNT(sd.SdetailKey) AS rows, ISNULL(SUM(sd.OutQuantity),0) AS outQty
           FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
          WHERE sm.OrderWeek=@wk AND sm.OrderYear=@yr AND sd.ProdKey=@pk AND ISNULL(sm.isDeleted,0)=0`,
        { wk: { type: sql.NVarChar, value: week }, yr: { type: sql.NVarChar, value: orderYear }, pk: { type: sql.Int, value: prodKey } }
      );

      // 전산 SP 직접 호출 — 모든 파라미터 명시
      const exec = await tQ(
        `DECLARE @rc INT, @oResult INT;
         EXEC @rc = dbo.usp_DistributeClear
              @OrderYear=@yr, @OrderWeek=@wk, @ProdKey=@pk, @iUserID=@uid, @oResult=@oResult OUTPUT;
         SELECT @rc AS ReturnCode, @oResult AS oResult;`,
        {
          yr: { type: sql.NVarChar, value: orderYear },
          wk: { type: sql.NVarChar, value: week },
          pk: { type: sql.Int, value: prodKey },
          uid: { type: sql.NVarChar, value: uid },
        }
      );
      const row = (exec.recordset || [])[0] || {};
      if (Number(row.ReturnCode) !== 0 || Number(row.oResult) !== 0) {
        throw new Error(`usp_DistributeClear 실패 (ReturnCode=${row.ReturnCode}, oResult=${row.oResult})`);
      }

      const after = await tQ(
        `SELECT COUNT(sd.SdetailKey) AS rows, ISNULL(SUM(sd.OutQuantity),0) AS outQty
           FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
          WHERE sm.OrderWeek=@wk AND sm.OrderYear=@yr AND sd.ProdKey=@pk AND ISNULL(sm.isDeleted,0)=0`,
        { wk: { type: sql.NVarChar, value: week }, yr: { type: sql.NVarChar, value: orderYear }, pk: { type: sql.Int, value: prodKey } }
      );
      return { before: before.recordset[0], after: after.recordset[0] };
    }, { retries: 3, baseDelay: 250 });

    return res.status(200).json({
      success: true, week, orderYear, prodKey,
      logs: [
        `${week}차 품목 ${prodKey} 개별 초기화 완료 (dbo.usp_DistributeClear)`,
        `초기화 전: ${result.before.rows}행/${result.before.outQty} → 후: ${result.after.rows}행/${result.after.outQty}`,
      ],
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_DISTRIBUTE_CLEAR',
  affectedTable: 'dbo.usp_DistributeClear',
  riskLevel: 'HIGH',
}));
