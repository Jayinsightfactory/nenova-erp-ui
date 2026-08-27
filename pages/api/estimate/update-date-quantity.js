import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import {
  distributeUnits,
  amountVatFromCostEst,
  shipmentUnitsFromUserInput,
} from '../../../lib/distributeUnits.js';
import { exeRoundedEstimateQuantity } from '../../../lib/estimateDateQuantity.js';
import { assertErpWriteScope, requireErpWriteScope } from '../../../lib/erpWriteScope.js';
import { isActiveShipmentOutQty, purgeZeroOutShipmentDetail } from '../../../lib/shipmentDetailWriteGuard.js';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';
import { normalizeShipmentQty } from '../../../lib/shipmentAvailability.js';
import {
  assertDirectionalGateCapability,
  assertDirectionalDateSnapshot,
  assertDirectionalPlanYears,
  assertNativeResult,
  buildDirectionalQuantityPlan,
  directionalQuantityError,
  evaluateDirectionalAvailability,
  fixedDirectionalChanges,
  lockDirectionalGate,
  positiveIncreaseByProduct,
} from '../../../lib/estimateDirectionalQuantity.js';

// 견적서관리의 출고일별 수량 변경은 단순 ShipmentDate.EstQuantity 수정이 아니다.
// nenova.exe FormShipmentDistribution의 날짜 탭과 동일하게 해당 날짜의
// ShipmentQuantity를 바꾸고, ShipmentDetail 총량/환산/금액을 함께 갱신한다.
function strictNumber(value, label, { integer = false, optional = false } = {}) {
  if (value == null && optional) return null;
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${label}이(가) 올바르지 않습니다.`);
  }
  const number = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    throw new Error(`${label}이(가) 올바르지 않습니다.`);
  }
  return number;
}

function parseItems(body) {
  const source = Array.isArray(body?.items) ? body.items : [body || {}];
  const seen = new Set();
  return source.map((item) => {
    const sdateKey = strictNumber(item?.sdateKey, 'sdateKey', { integer: true });
    const quantity = strictNumber(item?.quantity, `SdateKey=${sdateKey}의 견적 수량`);
    const expectedOldQuantity = strictNumber(item?.expectedOldQuantity, `SdateKey=${sdateKey}의 조회시점 수량`, { optional: true });
    const hasDescr = Object.prototype.hasOwnProperty.call(item || {}, 'descr');
    const descr = hasDescr ? String(item.descr ?? '') : null;
    const expectedOldDescr = item?.expectedOldDescr == null
      ? null
      : String(item.expectedOldDescr);
    const expectedOldCost = strictNumber(item?.expectedOldCost, `SdateKey=${sdateKey}의 조회시점 단가`, { optional: true });
    if (!Number.isInteger(sdateKey) || sdateKey <= 0) {
      throw new Error('sdateKey가 필요합니다. 출고일 행은 ShipmentDate.SdateKey로 저장해야 합니다.');
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`SdateKey=${sdateKey}의 견적 수량이 올바르지 않습니다.`);
    }
    if (seen.has(sdateKey)) throw new Error(`SdateKey=${sdateKey}가 중복되었습니다.`);
    seen.add(sdateKey);
    return {
      sdateKey,
      quantity,
      unit: typeof item?.unit === 'string' ? item.unit : '',
      expectedOldQuantity,
      descr,
      expectedOldDescr,
      expectedOldCost,
    };
  });
}

function roundOutQuantity(value) {
  return normalizeShipmentQty(value);
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let items;
  try {
    items = parseItems(req.body);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  if (!items.length) return res.status(400).json({ success: false, error: '수정할 출고일 행이 없습니다.' });
  let writeScope;
  try { writeScope = requireErpWriteScope(req.body, '출고일 수량 저장'); }
  catch (error) { return res.status(400).json({ success: false, code: error.code, error: error.message }); }

  try {
    const result = await withTransaction(async (tQ) => {
      // V2 is a deployment capability, not an inferred table shape.  Take the
      // singleton row before any business locks and retain it for this physical
      // transaction; this code never writes/clears another owner's gate state.
      await assertDirectionalGateCapability(tQ);
      await lockDirectionalGate(tQ);
      const params = Object.fromEntries(items.map((item, index) => [
        `dk${index}`,
        { type: sql.Int, value: item.sdateKey },
      ]));
      const keySql = items.map((_, index) => `@dk${index}`).join(',');

      // SdateKey로 행을 잠그고 Detail/상품을 함께 읽는다.
      // 업무 의미는 FormShipmentDistribution 날짜 탭의 1 Detail + N ShipmentDate다.
      const selected = await tQ(
        `SELECT
           sdd.SdateKey,
           sdd.SdetailKey,
           sdd.ShipmentDtm,
           ISNULL(sdd.ShipmentQuantity, 0) AS DateShipmentQuantity,
           ISNULL(sdd.EstQuantity, 0) AS DateEstQuantity,
           ISNULL(sdd.Cost, 0) AS DateCost,
           ISNULL(sdd.Descr, N'') AS DateDescr,
           sd.ShipmentKey,
           ISNULL(sd.OutQuantity, 0) AS DetailOutQuantity,
           ISNULL(sd.BoxQuantity, 0) AS DetailBoxQuantity,
           ISNULL(sd.BunchQuantity, 0) AS DetailBunchQuantity,
           ISNULL(sd.SteamQuantity, 0) AS DetailSteamQuantity,
           ISNULL(sd.EstQuantity, 0) AS DetailEstQuantity,
           ISNULL(sd.Cost, 0) AS DetailCost,
           ISNULL(sd.Amount, 0) AS DetailAmount,
            ISNULL(sd.Vat, 0) AS DetailVat,
            sd.isFix AS DetailIsFix,
            sm.isFix AS MasterIsFix,
           sm.OrderYear,
           sm.OrderWeek,
           sm.CustKey,
           p.ProdKey,
           p.ProdName,
           ISNULL(p.CountryFlower, N'') AS CountryFlower,
           p.OutUnit,
           p.EstUnit,
           ISNULL(p.BunchOf1Box, 0) AS BunchOf1Box,
           ISNULL(p.SteamOf1Bunch, 0) AS SteamOf1Bunch,
           ISNULL(p.SteamOf1Box, 0) AS SteamOf1Box
         FROM ShipmentDate sdd WITH (UPDLOCK, HOLDLOCK)
         JOIN ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK)
           ON sd.SdetailKey = sdd.SdetailKey
         JOIN ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK)
           ON sm.ShipmentKey = sd.ShipmentKey
          AND ISNULL(sm.isDeleted, 0) = 0
          JOIN Product p WITH (UPDLOCK, HOLDLOCK)
            ON p.ProdKey = sd.ProdKey
           AND ISNULL(p.isDeleted, 0) = 0
        WHERE sdd.SdateKey IN (${keySql})`,
        params
      );
      const selectedRows = selected.recordset || [];
      const rowByKey = new Map(selectedRows.map((row) => [Number(row.SdateKey), row]));
      if (rowByKey.size !== items.length) {
        const missing = items.filter((item) => !rowByKey.has(item.sdateKey)).map((item) => item.sdateKey);
        throw new Error(`수정할 출고일 행을 찾을 수 없습니다. SdateKey=${missing.join(',')}`);
      }

      for (const item of items) {
        const row = rowByKey.get(item.sdateKey);
        assertErpWriteScope(row, writeScope, `SdateKey=${item.sdateKey}`);
        assertDirectionalDateSnapshot(row, item);
      }

      const guardedParents = [...new Set(selectedRows.map((row) => String(row.OrderWeek || '').split('-')[0]))];
      if (guardedParents.length !== 1) {
        const error = new Error('한 번의 출고일 저장은 하나의 부모차수만 수정할 수 있습니다.');
        error.code = 'ERP_SCOPE_MISMATCH';
        throw error;
      }
      // 32-01·32-02처럼 견적서가 같은 부모차수의 여러 세부차수를 함께 저장하는 것은 정상이다.
      await assertErpEditGuard(tQ, { ...writeScope, orderWeek: selectedRows[0].OrderWeek }, req.user, req.body);

      const groups = new Map();
      for (const item of items) {
        const row = rowByKey.get(item.sdateKey);
        const product = {
          OutUnit: row.OutUnit,
          EstUnit: row.EstUnit,
          BunchOf1Box: row.BunchOf1Box,
          SteamOf1Bunch: row.SteamOf1Bunch,
          SteamOf1Box: row.SteamOf1Box,
        };
        const inputUnit = item.unit || row.EstUnit || row.OutUnit;
        const dateUnits = shipmentUnitsFromUserInput(item.quantity, inputUnit, product);
        const newDateOutQuantity = roundOutQuantity(dateUnits.outQuantity);
        const newDateEstQuantity = Number(dateUnits.estQty) || 0;
        if (Math.abs(newDateEstQuantity - exeRoundedEstimateQuantity(item.quantity)) > 0.001) {
          throw new Error(
            `SdateKey=${item.sdateKey}의 입력값을 ${row.OutUnit}/${row.EstUnit} 단위로 정확히 환산할 수 없습니다.`
          );
        }
        const key = Number(row.SdetailKey);
        if (!groups.has(key)) groups.set(key, { row, product, changes: [] });
        groups.get(key).changes.push({
          item,
          row,
          newDateOutQuantity,
          newDateEstQuantity,
        });
      }

      const detailKeys = [...groups.keys()];
      const baselineParams = Object.fromEntries(detailKeys.map((sdetailKey, index) => [
        `sdk${index}`, { type: sql.Int, value: sdetailKey },
      ]));
      const lockedBaselines = await tQ(
        `SELECT sd.SdetailKey,COUNT(sdd.SdateKey) AS DateCount,ISNULL(SUM(sdd.ShipmentQuantity),0) AS DateOutTotal
           FROM ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK)
           LEFT JOIN ShipmentDate sdd WITH (UPDLOCK,HOLDLOCK) ON sdd.SdetailKey=sd.SdetailKey
          WHERE sd.SdetailKey IN (${detailKeys.map((_, index) => `@sdk${index}`).join(',')})
          GROUP BY sd.SdetailKey`,
        baselineParams,
      );
      const plan = buildDirectionalQuantityPlan({
        changes: [...groups.values()].flatMap((group) => group.changes),
        lockedBaselines: lockedBaselines.recordset || [],
      });
      const physicalChanges = plan.filter((group) => Math.abs(group.confirmedDelta) > 0.0000001);
      const fixedChanges = fixedDirectionalChanges(physicalChanges);
      const directionKinds = new Set(physicalChanges.map((group) => (group.actualIncrease ? 'increase' : 'decrease')));
      const direction = directionKinds.size === 0 ? 'noop' : (directionKinds.size === 1 ? [...directionKinds][0] : 'mixed');
      const stockMode = fixedChanges.length ? 'fixed-direct' : 'unfixed-no-stock';
      const stockValidation = { availability: [], postNative: [] };
      assertDirectionalPlanYears(physicalChanges);
      if (fixedChanges.length && !req.body?.editGuard) {
        throw directionalQuantityError('ERP_EDIT_GUARD_REQUIRED', '확정 출고 수량 변경에는 현재 편집 보호 정보가 필요합니다. 다시 조회한 뒤 저장하세요.');
      }
      // Every positive physical delta is accumulated by its own product/year/week.
      // A selected decrease never offsets an increase in this shortage check.
      for (const increaseScope of positiveIncreaseByProduct(plan).values()) {
        const remainQ = await tQ(
          `SELECT ISNULL(prev.prevStock,0) AS prevStock,
                  ISNULL((SELECT SUM(vw.OutQuantity) FROM ViewWarehouse vw WHERE vw.ProdKey=@pk AND vw.OrderYear=@yr AND vw.OrderWeek=@wk),0) AS currentIn,
                  ISNULL((SELECT SUM(sh.AfterValue-sh.BeforeValue) FROM StockHistory sh JOIN CodeInfo ci ON ci.Category=N'StockType' AND ci.Descr=sh.ChangeType WHERE sh.ProdKey=@pk AND sh.OrderYear=@yr AND sh.OrderWeek=@wk),0) AS adjustQty,
                  ISNULL((SELECT SUM(vs.OutQuantity) FROM ViewShipment vs WHERE vs.ProdKey=@pk AND vs.OrderYear=@yr AND vs.OrderWeek=@wk),0) AS totalOut
             FROM (VALUES(1)) seed(n)
             OUTER APPLY (SELECT TOP 1 stm.StockKey FROM StockMaster stm WHERE stm.OrderYearWeek<@ywk ORDER BY stm.OrderYearWeek DESC,stm.OrderWeek DESC) beforeStock
             OUTER APPLY (SELECT ps.Stock AS prevStock FROM ProductStock ps WHERE ps.StockKey=beforeStock.StockKey AND ps.ProdKey=@pk) prev`,
          { pk: { type: sql.Int, value: increaseScope.prodKey }, yr: { type: sql.NVarChar, value: increaseScope.orderYear }, wk: { type: sql.NVarChar, value: increaseScope.orderWeek }, ywk: { type: sql.NVarChar, value: `${increaseScope.orderYear}${increaseScope.orderWeek.replace('-', '')}` } },
        );
        const availabilityResult = evaluateDirectionalAvailability({
          facts: remainQ.recordset?.[0] || {},
          increase: increaseScope.increase,
          scope: increaseScope,
        });
        stockValidation.availability.push(availabilityResult);
      }
      if (fixedChanges.length) {
        const codeInfo = await tQ(`SELECT TOP 1 Descr FROM CodeInfo WITH (UPDLOCK,HOLDLOCK) WHERE Category=N'StockType' AND Descr=N'출고'`);
        if (codeInfo.recordset?.length) throw directionalQuantityError('STOCK_HISTORY_TYPE_CONFLICT', 'StockType에 출고가 등록되어 있어 직접 확정수량 저장을 중단했습니다.');
        for (const group of fixedChanges) {
          const future = await tQ(`SELECT TOP 1 stm.StockKey FROM StockMaster stm WITH (UPDLOCK,HOLDLOCK) WHERE TRY_CONVERT(int,stm.OrderYear)>TRY_CONVERT(int,@yr)`, { yr: { type: sql.NVarChar, value: group.row.OrderYear } });
          if (future.recordset?.length) throw directionalQuantityError('FUTURE_STOCK_SNAPSHOT_EXISTS', '후속 연도 재고 스냅샷이 있어 확정 출고를 안전하게 수정할 수 없습니다.');
        }
      }
      const uid = req.user?.userId || 'admin';
      for (const group of fixedChanges) {
        const productStock = await tQ(`SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`, { pk: { type: sql.Int, value: group.row.ProdKey } });
        const before = Number(productStock.recordset?.[0]?.Stock);
        if (!Number.isFinite(before)) throw directionalQuantityError('PRODUCT_STOCK_INVALID', '현재고를 잠그지 못해 저장하지 않았습니다.', 500);
        const after = normalizeShipmentQty(before - group.confirmedDelta);
        await tQ(`INSERT INTO StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey) VALUES (GETDATE(),@yr,@wk,@uid,N'출고',N'수량',@before,@after,N'견적서 출고수량 직접수정',@pk); UPDATE Product SET Stock=@after WHERE ProdKey=@pk`, {
          yr: { type: sql.NVarChar, value: group.row.OrderYear }, wk: { type: sql.NVarChar, value: group.row.OrderWeek }, uid: { type: sql.NVarChar, value: uid }, before: { type: sql.Float, value: before }, after: { type: sql.Float, value: after }, pk: { type: sql.Int, value: group.row.ProdKey },
        });
      }

      const saved = [];
      for (const group of plan) {
        const { row, changes } = group;
        const product = { OutUnit: row.OutUnit, EstUnit: row.EstUnit, BunchOf1Box: row.BunchOf1Box, SteamOf1Bunch: row.SteamOf1Bunch, SteamOf1Box: row.SteamOf1Box };
        const newDetailOutQuantity = group.newDetailOutQuantity;
        if (!isActiveShipmentOutQty(newDetailOutQuantity)) {
          const uid = req.user?.userId || 'admin';
          await tQ(
            `INSERT INTO ShipmentHistory
               (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
             VALUES (@sdk, @dt, N'수정', @before, @after, @descr, @uid, GETDATE())`,
            {
              sdk: { type: sql.Int, value: row.SdetailKey },
              dt: { type: sql.DateTime, value: changes[0]?.row?.ShipmentDtm || null },
              before: { type: sql.NVarChar, value: String(row.DetailOutQuantity || 0) },
              after: { type: sql.NVarChar, value: '0' },
              descr: { type: sql.NVarChar, value: `견적 수량 0 — 출고분배 정리` },
              uid: { type: sql.NVarChar, value: uid },
            },
          );
          await purgeZeroOutShipmentDetail(tQ, row.SdetailKey, sql);
          for (const change of changes) {
            saved.push({
              sdateKey: change.item.sdateKey,
              sdetailKey: row.SdetailKey,
              shipmentKey: row.ShipmentKey,
              orderWeek: row.OrderWeek,
              oldDateQuantity: Number(change.row.DateEstQuantity) || 0,
              newDateQuantity: 0,
              oldDetailQuantity: Number(row.DetailEstQuantity) || 0,
              newDetailQuantity: 0,
              oldDetailOutQuantity: Number(row.DetailOutQuantity) || 0,
              newDetailOutQuantity: 0,
              amount: 0,
              vat: 0,
              purged: true,
              dateDeleted: true,
              dateCostAfter: null,
              detailCostAfter: null,
            });
          }
          continue;
        }

        const detailUnits = shipmentUnitsFromUserInput(newDetailOutQuantity, row.OutUnit, product);
        const detailDistribution = distributeUnits(detailUnits.outQuantity, product);
        const detailEstQuantity = detailDistribution.estQty;
        const detailMoney = amountVatFromCostEst(row.DetailCost, detailEstQuantity);

        // 수량이 바뀐 경우에만 EXE의 분배 저장 범위인 ShipmentDetail 총량을 갱신한다.
        // 비고만 바꾸는 경우 ShipmentDetail/물리 출고 수량은 보존한다.
        const physicalQuantityChanged = changes.some((change) =>
          Math.abs(change.newDateOutQuantity - Number(change.row.DateShipmentQuantity || 0)) > 0.0001
          || Math.abs(change.newDateEstQuantity - Number(change.row.DateEstQuantity || 0)) > 0.001
        );
        if (physicalQuantityChanged) {
          await tQ(
            `UPDATE ShipmentDetail
                SET OutQuantity=@outQty,
                    BoxQuantity=@boxQty,
                    BunchQuantity=@bunchQty,
                    SteamQuantity=@steamQty,
                    EstQuantity=@estQty,
                    Amount=@amount,
                    Vat=@vat
              WHERE SdetailKey=@sdk`,
            {
              sdk: { type: sql.Int, value: row.SdetailKey },
              outQty: { type: sql.Float, value: detailUnits.outQuantity },
              boxQty: { type: sql.Float, value: detailUnits.box },
              bunchQty: { type: sql.Float, value: detailUnits.bunch },
              steamQty: { type: sql.Float, value: detailUnits.steam },
              estQty: { type: sql.Float, value: detailEstQuantity },
              amount: { type: sql.Float, value: detailMoney.amount },
              vat: { type: sql.Float, value: detailMoney.vat },
            }
          );
        }

        for (const change of changes) {
          const { item, newDateOutQuantity, newDateEstQuantity } = change;
          const dateMoney = amountVatFromCostEst(row.DetailCost, newDateEstQuantity);
          if (group.fixed && Math.abs(newDateOutQuantity - Number(change.row.DateShipmentQuantity || 0)) > 0.0000001) {
            await tQ(
              `INSERT INTO ShipmentHistory
                 (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
               VALUES (@sdk, @dt, N'수정', @before, @after, N'견적서 출고일 수량 직접수정', @uid, GETDATE())`,
              {
                sdk: { type: sql.Int, value: row.SdetailKey },
                dt: { type: sql.DateTime, value: change.row.ShipmentDtm },
                before: { type: sql.NVarChar, value: String(change.row.DateShipmentQuantity || 0) },
                after: { type: sql.NVarChar, value: String(newDateOutQuantity) },
                uid: { type: sql.NVarChar, value: uid },
              },
            );
          }
          if (newDateOutQuantity <= 0.0001) {
            await tQ(
              `DELETE FROM ShipmentDate WHERE SdateKey=@sdateKey`,
              { sdateKey: { type: sql.Int, value: item.sdateKey } }
            );
          } else {
            await tQ(
              `UPDATE ShipmentDate
                  SET ShipmentQuantity=@shipQty,
                      EstQuantity=@estQty,
                      Cost=@cost,
                      Amount=@amount,
                      Vat=@vat,
                      Descr=CASE WHEN @hasDescr=1 THEN @descr ELSE Descr END
                WHERE SdateKey=@sdateKey`,
              {
                sdateKey: { type: sql.Int, value: item.sdateKey },
                shipQty: { type: sql.Float, value: newDateOutQuantity },
                estQty: { type: sql.Float, value: newDateEstQuantity },
                cost: { type: sql.Float, value: row.DetailCost },
                amount: { type: sql.Float, value: dateMoney.amount },
                vat: { type: sql.Float, value: dateMoney.vat },
                hasDescr: { type: sql.Bit, value: item.descr != null ? 1 : 0 },
                descr: { type: sql.NVarChar, value: item.descr ?? '' },
              }
            );
          }
          saved.push({
            sdateKey: item.sdateKey,
            sdetailKey: row.SdetailKey,
            shipmentKey: row.ShipmentKey,
            orderWeek: row.OrderWeek,
            oldDateQuantity: Number(change.row.DateEstQuantity) || 0,
            newDateQuantity: newDateEstQuantity,
            oldDetailQuantity: Number(row.DetailEstQuantity) || 0,
            newDetailQuantity: detailEstQuantity,
            oldDetailOutQuantity: Number(row.DetailOutQuantity) || 0,
            newDetailOutQuantity: detailUnits.outQuantity,
            dateDeleted: newDateOutQuantity <= 0.0001,
            dateCostAfter: newDateOutQuantity <= 0.0001 ? null : Number(row.DetailCost || 0),
            detailCostAfter: Number(row.DetailCost || 0),
            amount: dateMoney.amount,
            vat: dateMoney.vat,
          });
        }

        const totals = await tQ(
          `SELECT ISNULL(SUM(ShipmentQuantity),0) AS ShipTotal,
                  ISNULL(SUM(EstQuantity),0) AS EstTotal
             FROM ShipmentDate
            WHERE SdetailKey=@sdk`,
          { sdk: { type: sql.Int, value: row.SdetailKey } }
        );
        const totalRow = totals.recordset[0] || {};
        if (Math.abs(Number(totalRow.ShipTotal || 0) - Number(detailUnits.outQuantity || 0)) > 0.01
          || Math.abs(exeRoundedEstimateQuantity(totalRow.EstTotal) - exeRoundedEstimateQuantity(detailEstQuantity)) > 0.001) {
          throw directionalQuantityError('DATE_TOTAL_MISMATCH', `SdetailKey=${row.SdetailKey}의 출고일별 합계와 ShipmentDetail 총량이 맞지 않습니다.`);
        }
      }
      const positiveFixedKeys = new Set(fixedChanges
        .filter((group) => group.actualIncrease)
        .map((group) => `${group.row.OrderYear}|${group.row.ProdKey}`));
      const calcScopes = new Map();
      for (const group of fixedChanges) {
        const key = `${group.row.OrderYear}|${group.row.ProdKey}`;
        const previous = calcScopes.get(key);
        if (!previous || String(group.row.OrderWeek) < String(previous.OrderWeek)) calcScopes.set(key, group.row);
      }
      for (const row of calcScopes.values()) {
        const calc = await tQ(
          `DECLARE @r int,@m nvarchar(max),@returnCode int;
           EXEC @returnCode=dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
           SELECT @returnCode AS returnCode,@r AS result,@m AS message,XACT_STATE() AS TransactionState;`,
          { yr: { type: sql.NVarChar, value: row.OrderYear }, wk: { type: sql.NVarChar, value: row.OrderWeek }, pk: { type: sql.Int, value: row.ProdKey }, uid: { type: sql.NVarChar, value: uid } },
        );
        assertNativeResult(calc);
        if (!positiveFixedKeys.has(`${row.OrderYear}|${row.ProdKey}`)) continue;
        const negative = await tQ(
          `SELECT TOP 1 stm.OrderYear,stm.OrderWeek,ps.Stock
             FROM ProductStock ps JOIN StockMaster stm ON stm.StockKey=ps.StockKey
            WHERE ps.ProdKey=@pk
              AND stm.OrderYear=@yr
              AND RIGHT('0000'+CAST(stm.OrderYear AS nvarchar(4)),4)+REPLACE(stm.OrderWeek,'-','')>=@ywk
              AND ROUND(ps.Stock,3)<0`,
          { pk: { type: sql.Int, value: row.ProdKey }, yr: { type: sql.NVarChar, value: row.OrderYear }, ywk: { type: sql.NVarChar, value: `${row.OrderYear}${String(row.OrderWeek).replace('-', '')}` } },
        );
        if (negative.recordset?.length) throw directionalQuantityError('FUTURE_STOCK_SHORTAGE', '재계산 뒤 현재 또는 후속 차수 재고가 음수입니다. 전체 변경을 저장하지 않았습니다.');
        stockValidation.postNative.push({ prodKey: Number(row.ProdKey), orderYear: String(row.OrderYear), fromOrderWeek: String(row.OrderWeek), negative: false });
      }
      const editGuardAfter = await advanceErpEditGuard(tQ, { ...writeScope, orderWeek: selectedRows[0].OrderWeek }, req.user, req.body);
      return { items: saved, updatedCount: saved.length, direction, stockMode, stockValidation, editDigestAfter: editGuardAfter.editDigestAfter, revision: editGuardAfter.revision };
    });

    return res.status(200).json({ success: true, message: '출고분배 및 출고일별 견적수량 저장 완료', ...result });
  } catch (error) {
    const status = Number(error.statusCode)
      || (['STALE_DATA', 'ERP_SCOPE_MISMATCH', 'ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID', 'DIRECTIONAL_YEAR_INVALID', 'STOCK_SHORTAGE', 'FUTURE_STOCK_SNAPSHOT_EXISTS', 'FUTURE_STOCK_SHORTAGE', 'FIX_STATUS_INVALID', 'FIXED_BASELINE_INVALID', 'STOCK_GATE_BUSY'].includes(error.code) ? 409 : 500);
    return res.status(status).json({
      success: false,
      code: error.code,
      error: error.message,
      fixedWeeks: error.fixedWeeks || [],
      fixedCategories: error.fixedCategories || [],
      expected: error.expected,
      actual: error.actual,
      lease: error.lease || null,
      stockValidation: error.stockValidation || null,
      ...( ['STOCK_CALC_FAILED', 'STOCK_CALC_TRANSACTION_ABORTED', 'FUTURE_STOCK_SHORTAGE', 'DATE_TOTAL_MISMATCH'].includes(error.code) ? { rolledBack: true } : {} ),
    });
  }
});
