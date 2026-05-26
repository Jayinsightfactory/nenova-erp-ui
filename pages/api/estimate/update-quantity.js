import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function normalizeUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (['단', 'bunch'].includes(u)) return '단';
  if (['송이', 'steam', 'stem'].includes(u)) return '송이';
  return '박스';
}

function toAllUnits(quantity, unit, product) {
  const q = Number(quantity) || 0;
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
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
  const shipmentKey = parseInt(req.body?.shipmentKey, 10);
  const quantity = parseFloat(req.body?.quantity);
  const unit = normalizeUnit(req.body?.unit);
  const expectedOldQuantity = req.body?.expectedOldQuantity != null
    ? parseFloat(req.body.expectedOldQuantity)
    : null;

  if (!sdetailKey || Number.isNaN(quantity) || quantity < 0) {
    return res.status(400).json({ success: false, error: 'sdetailKey와 0 이상 수량이 필요합니다.' });
  }

  const uid = req.user?.userId || 'admin';
  const userName = req.user?.userName || uid;

  try {
    const result = await withTransaction(async (tQ) => {
      const cur = await tQ(
        `SELECT sd.SdetailKey, sd.ShipmentKey, sd.ProdKey, sd.ShipmentDtm,
                ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
                ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
                ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
                ISNULL(sd.OutQuantity,0) AS OutQuantity,
                ISNULL(sd.Cost,0) AS Cost,
                ISNULL(sd.Amount,0) AS Amount,
                ISNULL(sd.Vat,0) AS Vat,
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
      if (Number(row.isFix || 0) === 1) {
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
      if (next.outQuantity > 0 && dateCount > 1) {
        throw new Error('출고일별 분배가 여러 건인 출고입니다. 견적서관리에서 수량을 단일 출고일로 덮어쓰지 않도록 출고분배 화면에서 수정하세요.');
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
                EstQuantity=@outQuantity,
                Amount=@amount,
                Vat=@vat
          WHERE SdetailKey=@sdk`,
        {
          sdk: { type: sql.Int, value: sdetailKey },
          box: { type: sql.Float, value: next.box },
          bunch: { type: sql.Float, value: next.bunch },
          steam: { type: sql.Float, value: next.steam },
          outQuantity: { type: sql.Float, value: next.outQuantity },
          amount: { type: sql.Float, value: amount },
          vat: { type: sql.Float, value: vat },
        }
      );

      await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@sdk`, {
        sdk: { type: sql.Int, value: sdetailKey },
      });
      if (next.outQuantity > 0) {
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity)
           VALUES (@sdk, @dt, @qty)`,
          {
            sdk: { type: sql.Int, value: sdetailKey },
            dt: { type: sql.DateTime, value: row.ShipmentDtm },
            qty: { type: sql.Float, value: next.outQuantity },
          }
        );
      }

      const now = new Date();
      const ts = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await tQ(
        `INSERT INTO ShipmentHistory
           (SdetailKey, ShipmentDtm, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
         VALUES (@sdk, @dt, N'수정', N'OutQuantity', @before, @after, @descr, @uid, GETDATE())`,
        {
          sdk: { type: sql.Int, value: sdetailKey },
          dt: { type: sql.DateTime, value: row.ShipmentDtm },
          before: { type: sql.NVarChar, value: String(row.OutQuantity || 0) },
          after: { type: sql.NVarChar, value: String(next.outQuantity) },
          descr: { type: sql.NVarChar, value: `[${ts} ${userName}] 견적서관리 수량수정 ${oldQuantity}${unit} → ${quantity}${unit}` },
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
