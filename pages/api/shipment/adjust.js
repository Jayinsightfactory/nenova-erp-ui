// pages/api/shipment/adjust.js
// 출고분배 ADD/CANCEL 단일 액션 + ShipmentAdjustment 이력 자동 기록
//
// POST  body: { custKey, prodKey, week, year, type: 'ADD'|'CANCEL', qty, unit, memo }
//   ADD    : OrderDetail += qty, ShipmentDetail += qty, Adjustment(ADD) INSERT
//   CANCEL : OrderDetail 변경없음, ShipmentDetail -= qty, Adjustment(CANCEL) INSERT
//
// GET   ?week=18-01&prodKey=456  → 해당 차수+품목의 Adjustment 시계열 (비고 렌더링용)

import { withTransaction, query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';

async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}

// 차수 정규화: 'YYYY-WW-SS' → 'WW-SS' / year 추출
function normWeek(week) {
  const m = String(week || '').match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (m) return { year: m[1], week: m[2] };
  return { year: String(new Date().getFullYear()), week: String(week || '') };
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET')  return await getAdjustments(req, res);
  if (req.method === 'POST') return await postAdjust(req, res);
  return res.status(405).json({ success: false, error: 'method not allowed' });
}, { actionType: 'SHIPMENT_ADJUST', affectedTable: 'ShipmentAdjustment', riskLevel: 'MEDIUM' }));

// ─────────────────────────────────────────────────────────────────────────
// GET — 시계열 조회 (비고 렌더링용)
// ─────────────────────────────────────────────────────────────────────────
async function getAdjustments(req, res) {
  const { week, year, prodKey, custKey } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  const { week: orderWeek, year: orderYear } = normWeek(week);

  let where = `OrderWeek=@wk AND OrderYear=@yr`;
  const params = {
    wk: { type: sql.NVarChar, value: orderWeek },
    yr: { type: sql.NVarChar, value: year || orderYear },
  };
  if (prodKey) { where += ' AND ProdKey=@pk'; params.pk = { type: sql.Int, value: parseInt(prodKey) }; }
  if (custKey) { where += ' AND CustKey=@ck'; params.ck = { type: sql.Int, value: parseInt(custKey) }; }

  try {
    const r = await query(
      `SELECT a.AdjKey, a.OrderYear, a.OrderWeek, a.ProdKey, a.CustKey, a.AdjType,
              a.QtyDelta, a.QtyBefore, a.QtyAfter,
              a.OrderQtyBefore, a.OrderQtyAfter, a.RemainBefore, a.RemainAfter,
              a.Memo, a.CreateID, a.CreateDtm,
              c.CustName, c.CustArea, p.ProdName, p.DisplayName, p.FlowerName, p.OutUnit
       FROM ShipmentAdjustment a
       LEFT JOIN Customer c ON a.CustKey = c.CustKey
       LEFT JOIN Product  p ON a.ProdKey = p.ProdKey
       WHERE ${where}
       ORDER BY a.ProdKey, a.CreateDtm`,
      params
    );
    return res.status(200).json({ success: true, adjustments: r.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST — ADD/CANCEL 한 건
// ─────────────────────────────────────────────────────────────────────────
async function postAdjust(req, res) {
  const { custKey, prodKey, week, year, type, qty, unit, memo } = req.body;

  if (!custKey || !prodKey || !week || !type) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week, type 필요' });
  }
  if (type !== 'ADD' && type !== 'CANCEL') {
    return res.status(400).json({ success: false, error: 'type은 ADD 또는 CANCEL' });
  }
  const delta = parseFloat(qty);
  if (!(delta > 0)) {
    return res.status(400).json({ success: false, error: 'qty는 양수여야 함' });
  }

  const { week: orderWeek, year: orderYear } = normWeek(week);
  const ywk = (year || orderYear) + orderWeek.replace('-', '');
  const ck = parseInt(custKey);
  const pk = parseInt(prodKey);
  const uid = req.user?.userId || 'system';
  const userName = req.user?.userName || uid;

  try {
    const result = await withTransaction(async (tQ) => {
      // 1) 품목 정보 (환산용)
      const pInfo = await tQ(
        `SELECT ProdName, OutUnit, ISNULL(BunchOf1Box,0) AS B1B, ISNULL(SteamOf1Box,0) AS S1B
           FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: pk } }
      );
      if (!pInfo.recordset[0]) throw new Error('품목 없음 ProdKey=' + pk);
      const prod = pInfo.recordset[0];
      const outUnit = unit || prod.OutUnit || '박스';
      const B1B = prod.B1B || 0;
      const S1B = prod.S1B || 0;

      // 2) OrderMaster 확보 (UPDLOCK)
      const om = await tQ(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
          ORDER BY OrderMasterKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      let mk;
      if (om.recordset.length === 0) {
        if (type === 'CANCEL') throw new Error('취소 대상 OrderMaster 없음');
        mk = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        await tQ(
          `INSERT INTO OrderMaster
             (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
           VALUES (@mk,GETDATE(),@yr,@wk,@mgr,@ck,'','',0,@uid,GETDATE(),@uid,GETDATE())`,
          {
            mk:  { type: sql.Int,      value: mk },
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            mgr: { type: sql.NVarChar, value: '관리자' },
            ck:  { type: sql.Int,      value: ck },
            uid: { type: sql.NVarChar, value: 'admin' },
          }
        );
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // 3) OrderDetail 현재값 (canonical qty by OutUnit)
      const odCur = await tQ(
        `SELECT OrderDetailKey,
                CASE WHEN @ou=N'단'   THEN ISNULL(BunchQuantity,0)
                     WHEN @ou=N'송이' THEN ISNULL(SteamQuantity,0)
                     ELSE ISNULL(BoxQuantity,0) END AS curQty
           FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk },
          ou: { type: sql.NVarChar, value: outUnit } }
      );
      const orderQtyBefore = odCur.recordset[0]?.curQty || 0;
      const orderQtyAfter  = type === 'ADD' ? orderQtyBefore + delta : orderQtyBefore;

      // ADD 일 때만 OrderDetail INSERT/UPDATE
      if (type === 'ADD') {
        const finalQty = orderQtyAfter;
        const boxQty   = outUnit === '박스' ? finalQty : 0;
        const bunchQty = outUnit === '단'   ? finalQty : (outUnit === '박스' && B1B > 0 ? finalQty * B1B : 0);
        const steamQty = outUnit === '송이' ? finalQty : (outUnit === '박스' && S1B > 0 ? finalQty * S1B : 0);

        if (odCur.recordset.length > 0) {
          await tQ(
            `UPDATE OrderDetail SET
               BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
               LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            { bq: { type: sql.Float, value: boxQty }, bnq: { type: sql.Float, value: bunchQty },
              sq: { type: sql.Float, value: steamQty },
              uid: { type: sql.NVarChar, value: uid },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
        } else {
          const odk = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
          await tQ(
            `INSERT INTO OrderDetail
               (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,
                OutQuantity,NoneOutQuantity,isDeleted,CreateID,CreateDtm)
             VALUES (@nk,@mk,@pk,@bq,@bnq,@sq,0,0,0,@uid,GETDATE())`,
            { nk: { type: sql.Int, value: odk }, mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk },
              bq: { type: sql.Float, value: boxQty }, bnq: { type: sql.Float, value: bunchQty },
              sq: { type: sql.Float, value: steamQty },
              uid: { type: sql.NVarChar, value: 'admin' } }
          );
        }
      }

      // 4) ShipmentMaster 확보 + isFix 보호
      const sm = await tQ(
        `SELECT TOP 1 ShipmentKey, ISNULL(isFix,0) AS isFix FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
          ORDER BY WebCreated DESC, ShipmentKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      let sk;
      if (sm.recordset.length === 0) {
        if (type === 'CANCEL') throw new Error('취소 대상 ShipmentMaster 없음');
        sk = await safeNextKey(tQ, 'ShipmentMaster', 'ShipmentKey');
        await tQ(
          `INSERT INTO ShipmentMaster
             (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
           VALUES (@sk,@yr,@wk,@ywk,@ck,0,0,1,@uid,GETDATE())`,
          {
            sk:  { type: sql.Int,      value: sk },
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            ywk: { type: sql.NVarChar, value: ywk },
            ck:  { type: sql.Int,      value: ck },
            uid: { type: sql.NVarChar, value: uid },
          }
        );
      } else {
        sk = sm.recordset[0].ShipmentKey;
        // 확정차수 백엔드 보호 — 프론트가 우회되어도 DB가 막음
        if (sm.recordset[0].isFix === 1) {
          throw new Error('확정된 차수는 수정할 수 없습니다 (먼저 차수 확정을 해제하세요)');
        }
      }

      // 5) ShipmentDetail 현재값
      const sdCur = await tQ(
        `SELECT SdetailKey, ISNULL(OutQuantity,0) AS curQty
           FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
          WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk } }
      );
      const qtyBefore = sdCur.recordset[0]?.curQty || 0;
      const qtyAfter  = type === 'ADD' ? qtyBefore + delta : qtyBefore - delta;
      if (qtyAfter < 0) throw new Error(`취소량(${delta})이 현재 출고(${qtyBefore})보다 큼`);

      const finalBox   = qtyAfter;
      const finalBunch = B1B > 0 ? qtyAfter * B1B : 0;
      const finalSteam = S1B > 0 ? qtyAfter * S1B : 0;

      if (sdCur.recordset.length > 0) {
        await tQ(
          `UPDATE ShipmentDetail SET
             OutQuantity=@oq, EstQuantity=@oq,
             BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq
           WHERE SdetailKey=@dk`,
          { dk: { type: sql.Int, value: sdCur.recordset[0].SdetailKey },
            oq: { type: sql.Float, value: qtyAfter },
            bq: { type: sql.Float, value: finalBox },
            bnq:{ type: sql.Float, value: finalBunch },
            sq: { type: sql.Float, value: finalSteam } }
        );
      } else if (type === 'ADD') {
        const sdk = await safeNextKey(tQ, 'ShipmentDetail', 'SdetailKey');
        await tQ(
          `INSERT INTO ShipmentDetail
             (SdetailKey,ShipmentKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
              BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
           VALUES (@dk,@sk,@pk,GETDATE(),@oq,@oq,@bq,@bnq,@sq,0,0,0,0,'')`,
          { dk: { type: sql.Int, value: sdk }, sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk },
            oq: { type: sql.Float, value: qtyAfter },
            bq: { type: sql.Float, value: finalBox },
            bnq:{ type: sql.Float, value: finalBunch },
            sq: { type: sql.Float, value: finalSteam } }
        );
      }

      // 6) 입고 초과 ADD 경고 (음수 잔량 방지) — totalIn < 새로운 totalOut 이면 경고
      // 단, totalIn=0 (입고 미등록 차수)인 경우는 허용 (선분배 패턴)
      // 잔량 계산: 입고합 − Σ(ShipmentDetail.OutQuantity by ProdKey,Week)
      const remainQ = await tQ(
        `SELECT
           ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
                   JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
                   WHERE wd.ProdKey=@pk AND wm.OrderWeek=@wk AND wm.isDeleted=0),0) AS totalIn,
           ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
                   JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
                   WHERE sd.ProdKey=@pk AND sm.OrderWeek=@wk AND sm.isDeleted=0),0) AS totalOut`,
        { pk: { type: sql.Int, value: pk }, wk: { type: sql.NVarChar, value: orderWeek } }
      );
      const totalIn  = remainQ.recordset[0].totalIn  || 0;
      const totalOut = remainQ.recordset[0].totalOut || 0;
      // remainBefore: 이 행 변경 직전 시점
      const remainBefore = totalIn - (totalOut - qtyAfter + qtyBefore);
      const remainAfter  = totalIn - totalOut;

      // 입고검증 — 견적서/확정 단계 오류 예방
      // (a) 입고 0 인데 출고 ADD: "선분배" 패턴. 견적서에서 입고없는 출고로 보임 → 기본 차단, force=true 시만 허용
      // (b) 입고 < 출고 (remainAfter < 0): 잔량 음수, 차수 확정 시 fix.js validate 에서 거부됨 → 차단
      if (type === 'ADD' && !req.body.force) {
        if (totalIn === 0) {
          throw new Error(`입고 미등록 차수입니다. WarehouseDetail 입고 등록 후 분배하세요.\n선분배가 의도라면 force=true 로 강제 진행 (견적서 입고없는출고로 보일 수 있음)`);
        }
        if (totalIn > 0 && remainAfter < 0) {
          throw new Error(`입고(${totalIn}) 초과 분배: 총 ${totalOut} 분배 → 잔량 ${remainAfter}\n강제 진행하려면 force=true (관리자만)`);
        }
      }

      // 7) ShipmentAdjustment INSERT
      await tQ(
        `INSERT INTO ShipmentAdjustment
           (OrderYear, OrderWeek, ProdKey, CustKey, AdjType, QtyDelta,
            QtyBefore, QtyAfter, OrderQtyBefore, OrderQtyAfter,
            RemainBefore, RemainAfter, Memo, CreateID, CreateDtm)
         VALUES (@yr,@wk,@pk,@ck,@ty,@qd,@qb,@qa,@oqb,@oqa,@rb,@ra,@m,@uid,GETDATE())`,
        {
          yr:  { type: sql.NVarChar,  value: orderYear },
          wk:  { type: sql.NVarChar,  value: orderWeek },
          pk:  { type: sql.Int,       value: pk },
          ck:  { type: sql.Int,       value: ck },
          ty:  { type: sql.NVarChar,  value: type },
          qd:  { type: sql.Decimal(14,3), value: delta },
          qb:  { type: sql.Decimal(14,3), value: qtyBefore },
          qa:  { type: sql.Decimal(14,3), value: qtyAfter },
          oqb: { type: sql.Decimal(14,3), value: orderQtyBefore },
          oqa: { type: sql.Decimal(14,3), value: orderQtyAfter },
          rb:  { type: sql.Decimal(14,3), value: remainBefore },
          ra:  { type: sql.Decimal(14,3), value: remainAfter },
          m:   { type: sql.NVarChar,  value: memo || '' },
          uid: { type: sql.NVarChar,  value: uid },
        }
      );

      return { qtyBefore, qtyAfter, orderQtyBefore, orderQtyAfter, remainBefore, remainAfter, totalIn, totalOut };
    });

    return res.status(200).json({
      success: true,
      type,
      delta,
      ...result,
      message: `${type === 'ADD' ? '추가' : '취소'} 완료 — ${result.qtyBefore} → ${result.qtyAfter}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
