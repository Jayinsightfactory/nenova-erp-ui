import { withTransaction, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import { requireErpWriteScope } from '../../../lib/erpWriteScope.js';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';
import { tryInsertWithRetry, syncKeyNumbering } from '../../../lib/safeNextKey.js';
import { refreshShipmentDatesAfterDetailChange } from '../../../lib/syncShipmentDateEst.js';
import { distributeUnits, amountVatFromCostEst } from '../../../lib/distributeUnits.js';
import { FREIGHT_ROUNDING } from '../../../lib/estimateFreightPolicy.js';
import { buildFreightApplyPlan, freightApplyAmounts } from '../../../lib/estimateFreightApply.js';

function fail(code, message, statusCode = 409, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function normalizeWeeks(value, parentWeek) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const weeks = [...new Set(raw.map((v) => String(v || '').trim()).filter(Boolean))];
  if (!weeks.length) weeks.push(`${String(parentWeek).padStart(2, '0')}-01`);
  if (weeks.some((week) => !/^\d{2}-\d{2}$/.test(week) || week.split('-')[0] !== String(parentWeek).padStart(2, '0'))) {
    throw fail('FREIGHT_SCOPE_INVALID', '운임 적용 범위에 다른 대차수가 포함되어 있습니다.', 400);
  }
  return weeks;
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = req.body || {};
  let scope;
  try {
    scope = requireErpWriteScope(body, '운임 적용');
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }
  const parentWeek = String(body.parentWeek || body.week || '').split('-')[0].trim();
  if (!/^\d{2}$/.test(parentWeek)) return res.status(400).json({ success: false, code: 'WEEK_REQUIRED', error: '운임 적용 차수가 없습니다.' });
  if (body.aggregate === true) return res.status(400).json({ success: false, code: 'FREIGHT_AGGREGATE_REQUIRES_SPLIT', error: '운임 원장 적용은 세부차수별 분리만 지원합니다. 합산은 미리보기에서 확인하세요.' });
  const rounding = Object.values(FREIGHT_ROUNDING).includes(body.rounding) ? body.rounding : FREIGHT_ROUNDING.CEIL;
  const loadingUnitPrice = Number(body.loadingUnitPrice);
  const transportUnitPrice = Number(body.transportUnitPrice);
  if (!Number.isFinite(loadingUnitPrice) || loadingUnitPrice < 0 || !Number.isFinite(transportUnitPrice) || transportUnitPrice < 0) {
    return res.status(400).json({ success: false, code: 'FREIGHT_PRICE_INVALID', error: '상차운임·운송료 단가는 0 이상이어야 합니다.' });
  }
  let weeks;
  try { weeks = normalizeWeeks(body.weeks, parentWeek); } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }

  try {
    const result = await withTransaction(async (tQ) => {
      await assertErpEditGuard(tQ, { orderYear: scope.orderYear, orderWeek: parentWeek, custKey: scope.custKey }, req.user, body);
      const params = {
        yr: { type: sql.NVarChar, value: scope.orderYear },
        ck: { type: sql.Int, value: scope.custKey },
        wk0: { type: sql.NVarChar, value: weeks[0] },
      };
      const weekParams = {};
      weeks.forEach((week, i) => { weekParams[`w${i}`] = { type: sql.NVarChar, value: week }; });
      const inSql = weeks.map((_, i) => `@w${i}`).join(',');
      const masters = await tQ(
        `SELECT ShipmentKey, OrderWeek, CustKey, ISNULL(isFix,0) AS isFix, ISNULL(isDeleted,0) AS isDeleted
           FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderYear=@yr AND CustKey=@ck AND OrderWeek IN (${inSql}) AND ISNULL(isDeleted,0)=0`,
        { ...params, ...weekParams },
      );
      const masterByWeek = new Map((masters.recordset || []).map((row) => [String(row.OrderWeek), row]));
      const missingMaster = weeks.filter((week) => !masterByWeek.has(week));
      if (missingMaster.length) throw fail('FREIGHT_MASTER_REQUIRED', `운임을 추가할 활성 출고 원장이 없습니다: ${missingMaster.join(', ')}`);
      const existing = await tQ(
        `SELECT sm.OrderWeek, sm.ShipmentKey, ISNULL(sm.isFix,0) AS MasterFix,
                sd.SdetailKey, sd.ProdKey, ISNULL(sd.OutQuantity,0) AS OutQuantity,
                p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
                p.OutUnit, ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                ISNULL(sd.isFix,0) AS DetailFix
           FROM ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK)
           JOIN ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
           JOIN Product p ON p.ProdKey=sd.ProdKey
          WHERE sm.OrderYear=@yr AND sm.CustKey=@ck AND sm.OrderWeek IN (${inSql})
            AND ISNULL(sm.isDeleted,0)=0`,
        { ...params, ...weekParams },
      );
      const source = await tQ(
        `SELECT sm.OrderWeek, sm.ShipmentKey, sd.ShipmentDtm, sd.SdetailKey, sd.ProdKey,
                ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.BoxQuantity,0) AS BoxQuantity,
                ISNULL(sd.BunchQuantity,0) AS BunchQuantity, ISNULL(sd.SteamQuantity,0) AS SteamQuantity,
                p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box, p.FlowerName, p.CounName, p.CountryFlower
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
           JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
          WHERE sm.OrderYear=@yr AND sm.CustKey=@ck AND sm.OrderWeek IN (${inSql})
            AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0`,
        { ...params, ...weekParams },
      );
      const products = await tQ(
        `SELECT ProdKey, ProdName, OutUnit, ISNULL(BunchOf1Box,0) AS BunchOf1Box,
                ISNULL(SteamOf1Box,0) AS SteamOf1Box, ISNULL(SteamOf1Bunch,0) AS SteamOf1Bunch,
                FlowerName, CounName, CountryFlower, EstUnit
           FROM Product
          WHERE ISNULL(isDeleted,0)=0
            AND (ProdName LIKE N'%운송료%' OR ProdName LIKE N'%운송비%' OR ProdName LIKE N'%현지상차운임%'
                 OR LOWER(ProdName) LIKE '%freight%' OR LOWER(ProdName) LIKE '%shipping%')`,
        {},
      );
      const plan = buildFreightApplyPlan({
        sourceRows: source.recordset || [],
        existingRows: existing.recordset || [],
        products: products.recordset || [],
        rounding,
        loadingUnitPrice,
        transportUnitPrice,
      });
      const dateByWeek = new Map();
      for (const row of source.recordset || []) {
        if (!dateByWeek.has(String(row.OrderWeek)) && row.ShipmentDtm) dateByWeek.set(String(row.OrderWeek), row.ShipmentDtm);
      }
      if (plan.unresolved.length) {
        const labels = plan.unresolved.map((row) => row.kind === 'LOADING' ? `${row.week} 현지상차운임` : `${row.week} ${row.category?.label || '품종'}`).join(', ');
        throw fail('FREIGHT_PRODUCT_UNRESOLVED', `운임 품목을 하나로 확정할 수 없습니다: ${labels}`);
      }
      const inserts = [];
      for (const row of plan.inserts) {
        const master = masterByWeek.get(row.week);
        if (!dateByWeek.get(row.week)) throw fail('FREIGHT_DATE_REQUIRED', `${row.week}차 기존 출고일을 확인할 수 없어 운임을 저장하지 않았습니다.`);
        if (Number(master.isFix) === 1) throw fail('FREIGHT_FIXED_SCOPE', `${row.week}차 출고가 확정되어 운임을 추가할 수 없습니다. 확정 해제 후 다시 시도하세요.`);
        const product = row.product;
        if (String(product.OutUnit || '') !== '박스') throw fail('FREIGHT_UNIT_UNSUPPORTED', `${product.ProdName}의 출고 단위가 박스가 아니어서 운임을 안전하게 저장할 수 없습니다.`);
        const duplicate = (existing.recordset || []).find((item) => String(item.OrderWeek) === row.week && Number(item.ProdKey) === Number(product.ProdKey));
        if (duplicate) continue;
        const calc = freightApplyAmounts(row, product, distributeUnits, amountVatFromCostEst);
        const sdetailKey = await tryInsertWithRetry(tQ, 'ShipmentDetail', 'SdetailKey', async (newKey) => {
          await tQ(
            `INSERT INTO ShipmentDetail
              (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
               BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
             VALUES (@dk,@sk,@ck,@pk,@dt,@out,@est,@box,@bunch,@steam,@cost,@amount,@vat,0,@descr)`,
            {
              dk: { type: sql.Int, value: newKey }, sk: { type: sql.Int, value: master.ShipmentKey },
              ck: { type: sql.Int, value: scope.custKey }, pk: { type: sql.Int, value: Number(product.ProdKey) },
              dt: { type: sql.DateTime, value: dateByWeek.get(row.week) || null }, out: { type: sql.Float, value: calc.outQty },
              est: { type: sql.Float, value: calc.estQty }, box: { type: sql.Float, value: calc.box },
              bunch: { type: sql.Float, value: calc.bunch }, steam: { type: sql.Float, value: calc.steam },
              cost: { type: sql.Float, value: row.unitPrice }, amount: { type: sql.Float, value: calc.amount },
              vat: { type: sql.Float, value: calc.vat }, descr: { type: sql.NVarChar, value: `웹 운임비 적용 · ${row.kind === 'LOADING' ? '현지상차운임' : '운송료'} · ${row.week}` },
            },
          );
        });
        await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
        await refreshShipmentDatesAfterDetailChange(tQ, sdetailKey, sql, { shipDtm: dateByWeek.get(row.week) || null });
        const verify = await tQ(
          `SELECT sd.SdetailKey, sd.OutQuantity, COUNT(sdd.SdateKey) AS DateCount,
                  ISNULL(SUM(sdd.ShipmentQuantity),0) AS DateQuantity
             FROM ShipmentDetail sd LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
            WHERE sd.SdetailKey=@dk GROUP BY sd.SdetailKey, sd.OutQuantity`,
          { dk: { type: sql.Int, value: sdetailKey } },
        );
        const verified = verify.recordset?.[0];
        if (!verified || Number(verified.DateCount) !== 1 || Math.abs(Number(verified.OutQuantity) - Number(verified.DateQuantity)) > 0.001) {
          throw fail('FREIGHT_VERIFY_FAILED', `${row.week}차 ${product.ProdName}의 ShipmentDate 검증에 실패했습니다.`);
        }
        inserts.push({ week: row.week, kind: row.kind, prodKey: Number(product.ProdKey), prodName: product.ProdName, boxes: row.boxes, sdetailKey });
      }
      await advanceErpEditGuard(tQ, { orderYear: scope.orderYear, orderWeek: parentWeek, custKey: scope.custKey }, req.user, body);
      return { inserted: inserts, skipped: plan.skipped.map((row) => ({ week: row.week, kind: row.kind, prodKey: Number(row.product.ProdKey), prodName: row.product.ProdName, boxes: row.boxes })) };
    });
    return res.status(200).json({ success: true, appliedCount: result.inserted.length, skippedCount: result.skipped.length, inserted: result.inserted, skipped: result.skipped, message: result.inserted.length ? '운임비 원장 적용 및 검증 완료' : '이미 적용된 운임비만 있어 변경하지 않았습니다.' });
  } catch (error) {
    const status = error.statusCode || (['ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID'].includes(error.code) ? 409 : 500);
    return res.status(status).json({ success: false, code: error.code, error: error.message, lease: error.lease || null });
  }
}, { actionType: 'ESTIMATE_FREIGHT_APPLY', affectedTable: 'ShipmentDetail/ShipmentDate', riskLevel: 'HIGH' }));
