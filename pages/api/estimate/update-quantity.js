import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { refreshShipmentDatesAfterDetailChange } from '../../../lib/syncShipmentDateEst.js';

function normalizeUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (['단', 'bunch'].includes(u)) return '단';
  if (['송이', 'steam', 'stem'].includes(u)) return '송이';
  return '박스';
}

function positiveNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getUnitsPerBox(product) {
  const rowBox = positiveNumber(product.BoxQuantity);
  const rowBunch = positiveNumber(product.BunchQuantity);
  const rowSteam = positiveNumber(product.SteamQuantity);
  const rowBunchPerBox = rowBox > 0 && rowBunch > 0 ? rowBunch / rowBox : 0;
  const rowSteamPerBox = rowBox > 0 && rowSteam > 0 ? rowSteam / rowBox : 0;

  return {
    bunchPerBox: rowBunchPerBox || positiveNumber(product.BunchOf1Box) || 10,
    steamPerBox: rowSteamPerBox || positiveNumber(product.SteamOf1Box) || 0,
  };
}

function toAllUnits(quantity, unit, product) {
  const q = Number(quantity) || 0;
  const { bunchPerBox: b1b, steamPerBox: s1b } = getUnitsPerBox(product);
  const outUnit = normalizeUnit(product.OutUnit);
  let box = 0;
  let bunch = 0;
  let steam = 0;

  if (unit === '단') {
    bunch = q;
    box = b1b > 0 ? q / b1b : 0;
    steam = b1b > 0 && s1b > 0 ? box * s1b : 0;
  } else if (unit === '송이') {
    steam = q;
    box = s1b > 0 ? q / s1b : 0;
    bunch = s1b > 0 && b1b > 0 ? box * b1b : 0;
  } else {
    box = q;
    bunch = b1b > 0 ? q * b1b : 0;
    steam = s1b > 0 ? q * s1b : 0;
  }

  const outQuantity = outUnit === '단' ? bunch : outUnit === '송이' ? steam : box;
  return { box, bunch, steam, outQuantity };
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sdetailKey = parseInt(req.body?.sdetailKey, 10);
  const estimateKey = parseInt(req.body?.estimateKey, 10);
  const shipmentKey = parseInt(req.body?.shipmentKey, 10);
  const quantity = parseFloat(req.body?.quantity);
  const unit = normalizeUnit(req.body?.unit);
  const expectedOldQuantity = req.body?.expectedOldQuantity != null
    ? parseFloat(req.body.expectedOldQuantity)
    : null;

  if ((!sdetailKey && !estimateKey) || Number.isNaN(quantity)) {
    return res.status(400).json({ success: false, error: 'sdetailKey 또는 estimateKey 와 수량이 필요합니다.' });
  }

  const uid = req.user?.userId || 'admin';

  try {
    const result = await withTransaction(async (tQ) => {
      if (estimateKey) {
        const cur = await tQ(
          `SELECT e.EstimateKey, e.ShipmentKey, e.ProdKey,
                  ISNULL(e.Quantity,0) AS Quantity,
                  ISNULL(e.Cost,0) AS Cost,
                  ISNULL(e.Amount,0) AS Amount,
                  ISNULL(e.Vat,0) AS Vat,
                  sm.OrderWeek
             FROM Estimate e WITH (UPDLOCK, HOLDLOCK)
             JOIN ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK) ON sm.ShipmentKey = e.ShipmentKey
            WHERE e.EstimateKey=@ek
              AND (@sk IS NULL OR e.ShipmentKey=@sk)
              AND ISNULL(sm.isDeleted,0)=0`,
          {
            ek: { type: sql.Int, value: estimateKey },
            sk: { type: sql.Int, value: shipmentKey || null },
          }
        );
        if (cur.recordset.length === 0) throw new Error(`EstimateKey=${estimateKey} 를 찾을 수 없습니다.`);
        const row = cur.recordset[0];
        const oldQuantity = Number(row.Quantity || 0);
        if (expectedOldQuantity != null && Math.abs(oldQuantity - expectedOldQuantity) > 0.001) {
          const err = new Error(`수량이 조회 이후 변경되었습니다. 조회시점=${expectedOldQuantity}, 현재=${oldQuantity}`);
          err.code = 'STALE_DATA';
          err.expected = expectedOldQuantity;
          err.actual = oldQuantity;
          throw err;
        }

        const nextQuantity = oldQuantity < 0 ? -Math.abs(quantity) : quantity;
        const amount = Math.round(nextQuantity * Number(row.Cost || 0) / 1.1);
        const vat = Math.round(nextQuantity * Number(row.Cost || 0) / 11);
        await tQ(
          `UPDATE Estimate
              SET Quantity=@qty, Amount=@amount, Vat=@vat,
                  Descr = ISNULL(Descr,'') + @descr
            WHERE EstimateKey=@ek`,
          {
            ek: { type: sql.Int, value: estimateKey },
            qty: { type: sql.Float, value: nextQuantity },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
            descr: { type: sql.NVarChar, value: `\n차감수량 ${oldQuantity}>${nextQuantity}` },
          }
        );

        return {
          estimateKey,
          shipmentKey: row.ShipmentKey,
          orderWeek: row.OrderWeek,
          oldQuantity,
          newQuantity: nextQuantity,
          oldOutQuantity: oldQuantity,
          newOutQuantity: nextQuantity,
          amount,
          vat,
        };
      }

      const cur = await tQ(
        `SELECT sd.SdetailKey, sd.ShipmentKey, sd.ProdKey, sd.ShipmentDtm,
                ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
                ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
                ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
                ISNULL(sd.OutQuantity,0) AS OutQuantity,
                ISNULL(sd.Cost,0) AS Cost,
                ISNULL(sd.Amount,0) AS Amount,
                ISNULL(sd.Vat,0) AS Vat,
                ISNULL(sd.isFix,0) AS detailIsFix,
                ISNULL(sm.isFix,0) AS isFix,
                sm.OrderWeek,
                p.OutUnit, p.BunchOf1Box, p.SteamOf1Box
           FROM ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK)
           JOIN ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK) ON sm.ShipmentKey = sd.ShipmentKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
          WHERE sd.SdetailKey = @sdk
            AND (@sk IS NULL OR sd.ShipmentKey = @sk)
            AND ISNULL(sm.isDeleted,0) = 0`,
        {
          sdk: { type: sql.Int, value: sdetailKey },
          sk: { type: sql.Int, value: shipmentKey || null },
        }
      );

      if (cur.recordset.length === 0) throw new Error(`SdetailKey=${sdetailKey} 행을 찾을 수 없습니다.`);
      const row = cur.recordset[0];
      const detailFixed = Number(row.detailIsFix || 0) === 1;
      if (detailFixed) {
        throw new Error(`[${row.OrderWeek}] 확정된 차수입니다. 먼저 확정취소 후 수량을 수정하세요.`);
      }

      const oldQuantity = unit === '단'
        ? Number(row.BunchQuantity || 0)
        : unit === '송이'
          ? Number(row.SteamQuantity || 0)
          : Number(row.BoxQuantity || 0);

      if (expectedOldQuantity != null && Math.abs(oldQuantity - expectedOldQuantity) > 0.001) {
        const err = new Error(`수량이 조회 이후 변경되었습니다. 조회시점=${expectedOldQuantity}, 현재=${oldQuantity}`);
        err.code = 'STALE_DATA';
        err.expected = expectedOldQuantity;
        err.actual = oldQuantity;
        throw err;
      }

      const next = toAllUnits(quantity, unit, row);
      const dateSummary = await tQ(
        `SELECT COUNT(*) AS dateCount,
                ISNULL(SUM(ShipmentQuantity),0) AS dateQty
           FROM ShipmentDate WITH (UPDLOCK, HOLDLOCK)
          WHERE SdetailKey=@sdk`,
        { sdk: { type: sql.Int, value: sdetailKey } }
      );
      const dateRow = dateSummary.recordset[0] || {};
      const dateCount = Number(dateRow.dateCount || 0);
      if (next.outQuantity > 0 && !row.ShipmentDtm) {
        throw new Error('출고일이 지정되지 않은 출고입니다. 출고분배 화면에서 출고일을 먼저 지정한 뒤 수량을 수정하세요.');
      }
      if (next.outQuantity > 0 && dateCount === 0) {
        throw new Error('ShipmentDate가 없는 출고입니다. 출고분배 화면에서 출고일을 먼저 동기화한 뒤 수량을 수정하세요.');
      }
      const amountBase = next.bunch > 0 ? next.bunch : next.steam > 0 ? next.steam : next.box;
      const amount = Math.round(amountBase * Number(row.Cost || 0) / 1.1);
      const vat = Math.round(amountBase * Number(row.Cost || 0) / 11);

      await tQ(
        `UPDATE ShipmentDetail
            SET BoxQuantity=@box,
                BunchQuantity=@bunch,
                SteamQuantity=@steam,
                OutQuantity=@outQuantity,
                EstQuantity=@estQuantity,
                Amount=@amount,
                Vat=@vat
          WHERE SdetailKey=@sdk`,
        {
          sdk: { type: sql.Int, value: sdetailKey },
          box: { type: sql.Float, value: next.box },
          bunch: { type: sql.Float, value: next.bunch },
          steam: { type: sql.Float, value: next.steam },
          outQuantity: { type: sql.Float, value: next.outQuantity },
          estQuantity: { type: sql.Float, value: amountBase },
          amount: { type: sql.Float, value: amount },
          vat: { type: sql.Float, value: vat },
        }
      );

      await refreshShipmentDatesAfterDetailChange(tQ, sdetailKey, sql, {
        shipDtm: next.outQuantity > 0 ? row.ShipmentDtm : undefined,
      });

      await tQ(
        `INSERT INTO ShipmentHistory
           (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
         VALUES (@sdk, @dt, N'수정', @before, @after, @descr, @uid, GETDATE())`,
        {
          sdk: { type: sql.Int, value: sdetailKey },
          dt: { type: sql.DateTime, value: row.ShipmentDtm },
          before: { type: sql.NVarChar, value: String(row.OutQuantity || 0) },
          after: { type: sql.NVarChar, value: String(next.outQuantity) },
          descr: { type: sql.NVarChar, value: `수량 ${oldQuantity}${unit}>${quantity}${unit}` },
          uid: { type: sql.NVarChar, value: uid },
        }
      );

      return {
        sdetailKey,
        shipmentKey: row.ShipmentKey,
        orderWeek: row.OrderWeek,
        oldQuantity,
        newQuantity: quantity,
        oldOutQuantity: Number(row.OutQuantity || 0),
        newOutQuantity: next.outQuantity,
        amount,
        vat,
      };
    });

    return res.status(200).json({ success: true, message: '수량 수정 완료', ...result });
  } catch (err) {
    return res.status(err.code === 'STALE_DATA' ? 409 : 500).json({
      success: false,
      code: err.code,
      error: err.message,
      expected: err.expected,
      actual: err.actual,
    });
  }
});
