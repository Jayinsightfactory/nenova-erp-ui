// 견적서관리 기존 Estimate 행 편집 API
//
// nenova.exe ClassEstimate.Update와 동일하게 Estimate 한 행만 갱신한다.
// Order/Shipment/ShipmentDate/재고 원장은 이 경로에서 변경하지 않는다.
import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { assertErpWriteScope, requireErpWriteScope } from '../../../lib/erpWriteScope.js';
import { amountVatFromCostEst } from '../../../lib/distributeUnits.js';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const estimateKey = parseInt(body.estimateKey, 10);
  const shipmentKey = body.shipmentKey == null || body.shipmentKey === ''
    ? null
    : parseInt(body.shipmentKey, 10);
  const prodKey = parseInt(body.prodKey, 10);
  const quantity = Math.abs(Number(body.quantity));
  const cost = Number(body.cost);
  const expectedQuantity = body.expectedQuantity == null || body.expectedQuantity === ''
    ? null
    : Number(body.expectedQuantity);
  const expectedCost = body.expectedCost == null || body.expectedCost === ''
    ? null
    : Number(body.expectedCost);
  const expectedProdKey = body.expectedProdKey == null || body.expectedProdKey === ''
    ? null
    : Number(body.expectedProdKey);
  const expectedUnit = body.expectedUnit == null ? null : String(body.expectedUnit);
  const expectedDescr = body.expectedDescr == null ? null : String(body.expectedDescr);

  if (!Number.isInteger(estimateKey) || estimateKey <= 0) {
    return res.status(400).json({ success: false, error: 'estimateKey가 필요합니다.' });
  }
  if (!Number.isInteger(prodKey) || prodKey <= 0) {
    return res.status(400).json({ success: false, error: '품목을 선택하세요.' });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ success: false, error: '수량은 0보다 커야 합니다.' });
  }
  if (!Number.isFinite(cost) || cost < 0) {
    return res.status(400).json({ success: false, error: '단가는 0 이상이어야 합니다.' });
  }
  if (expectedQuantity != null && !Number.isFinite(expectedQuantity)) {
    return res.status(400).json({ success: false, error: '조회시점 수량이 올바르지 않습니다.' });
  }
  if (expectedCost != null && !Number.isFinite(expectedCost)) {
    return res.status(400).json({ success: false, error: '조회시점 단가가 올바르지 않습니다.' });
  }
  if (expectedProdKey != null && (!Number.isInteger(expectedProdKey) || expectedProdKey <= 0)) {
    return res.status(400).json({ success: false, error: '조회시점 품목이 올바르지 않습니다.' });
  }
  let writeScope;
  try { writeScope = requireErpWriteScope(body, '견적 행 저장'); }
  catch (error) { return res.status(400).json({ success: false, code: error.code, error: error.message }); }

  const inputDate = body.estimateDate == null || body.estimateDate === ''
    ? null
    : parseDate(body.estimateDate);
  if (body.estimateDate && !inputDate) {
    return res.status(400).json({ success: false, error: '견적일자는 YYYY-MM-DD 형식이어야 합니다.' });
  }

  try {
    const result = await withTransaction(async (tQ) => {
      const current = await tQ(
        `SELECT e.EstimateKey, e.ShipmentKey, e.EstimateType, e.ProdKey, e.Unit,
                ISNULL(e.Quantity,0) AS Quantity, ISNULL(e.Cost,0) AS Cost,
                ISNULL(e.Amount,0) AS Amount, ISNULL(e.Vat,0) AS Vat,
                ISNULL(e.Descr,N'') AS Descr, e.EstimateDtm,
                sm.OrderYear, sm.OrderWeek, sm.CustKey
           FROM Estimate e WITH (UPDLOCK, HOLDLOCK)
           JOIN ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK) ON sm.ShipmentKey=e.ShipmentKey
          WHERE e.EstimateKey=@ek
            AND (@sk IS NULL OR e.ShipmentKey=@sk)
            AND ISNULL(sm.isDeleted,0)=0`,
        {
          ek: { type: sql.Int, value: estimateKey },
          sk: { type: sql.Int, value: shipmentKey },
        },
      );
      const row = current.recordset?.[0];
      if (!row) throw new Error(`EstimateKey=${estimateKey} 견적 행을 찾을 수 없습니다.`);
      assertErpWriteScope(row, writeScope, `EstimateKey=${estimateKey}`);
      await assertErpEditGuard(tQ, { ...writeScope, orderWeek: row.OrderWeek }, req.user, body);

      const oldQuantity = Number(row.Quantity || 0);
      const oldCost = Number(row.Cost || 0);
      if (expectedQuantity != null && Math.abs(oldQuantity - expectedQuantity) > 0.001) {
        const error = new Error(`수량이 조회 이후 변경되었습니다. 조회시점=${expectedQuantity}, 현재=${oldQuantity}`);
        error.code = 'STALE_DATA';
        throw error;
      }
      if (expectedCost != null && Math.abs(oldCost - expectedCost) > 0.001) {
        const error = new Error(`단가가 조회 이후 변경되었습니다. 조회시점=${expectedCost}, 현재=${oldCost}`);
        error.code = 'STALE_DATA';
        throw error;
      }
      if (expectedProdKey != null && Number(row.ProdKey) !== expectedProdKey) {
        const error = new Error('품목이 조회 이후 변경되었습니다. 다시 조회하세요.');
        error.code = 'STALE_DATA';
        throw error;
      }
      if (expectedUnit != null && String(row.Unit || '') !== expectedUnit) {
        const error = new Error('단위가 조회 이후 변경되었습니다. 다시 조회하세요.');
        error.code = 'STALE_DATA';
        throw error;
      }
      if (expectedDescr != null && String(row.Descr || '') !== expectedDescr) {
        const error = new Error('적요가 조회 이후 변경되었습니다. 다시 조회하세요.');
        error.code = 'STALE_DATA';
        throw error;
      }

      const product = await tQ(
        `SELECT TOP 1 ProdKey, EstUnit, OutUnit
           FROM Product
          WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
        { pk: { type: sql.Int, value: prodKey } },
      );
      if (!product.recordset?.[0]) throw new Error(`ProdKey=${prodKey} 품목을 찾을 수 없습니다.`);

      // 불량차감은 음수, 판매요청은 양수라는 기존 부호를 보존한다.
      const signedQuantity = oldQuantity < 0 ? -quantity : quantity;
      const { amount, vat } = amountVatFromCostEst(cost, signedQuantity);
      const unit = String(body.unit || row.Unit || product.recordset[0].EstUnit || product.recordset[0].OutUnit || '').trim();
      const descr = Object.prototype.hasOwnProperty.call(body, 'descr')
        ? String(body.descr || '')
        : String(row.Descr || '');
      const dt = inputDate || row.EstimateDtm || new Date();

      // Estimate는 운영 트리거가 있을 수 있으므로 OUTPUT을 사용하지 않는다.
      await tQ(
        `UPDATE Estimate
            SET ProdKey=@pk, Unit=@unit, Quantity=@qty, Cost=@cost,
                Amount=@amount, Vat=@vat, Descr=@descr, EstimateDtm=@dt
          WHERE EstimateKey=@ek`,
        {
          ek: { type: sql.Int, value: estimateKey },
          pk: { type: sql.Int, value: prodKey },
          unit: { type: sql.NVarChar, value: unit },
          qty: { type: sql.Float, value: signedQuantity },
          cost: { type: sql.Float, value: cost },
          amount: { type: sql.Float, value: amount },
          vat: { type: sql.Float, value: vat },
          descr: { type: sql.NVarChar, value: descr },
          dt: { type: sql.DateTime, value: dt },
        },
      );

      const saved = await tQ(
        `SELECT TOP 1 EstimateKey, ShipmentKey, EstimateType, ProdKey, Unit,
                Quantity, Cost, Amount, Vat, Descr, EstimateDtm
           FROM Estimate
          WHERE EstimateKey=@ek`,
        { ek: { type: sql.Int, value: estimateKey } },
      );
      const editGuardAfter = await advanceErpEditGuard(tQ, { ...writeScope, orderWeek: row.OrderWeek }, req.user, req.body);
      return { before: row, after: saved.recordset?.[0] || null, editDigestAfter: editGuardAfter.editDigestAfter, revision: editGuardAfter.revision };
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(['STALE_DATA', 'ERP_SCOPE_MISMATCH', 'ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID'].includes(error.code) ? 409 : Number(error.statusCode || 500)).json({
      success: false,
      code: error.code,
      error: error.message,
      lease: error.lease || null,
    });
  }
});
