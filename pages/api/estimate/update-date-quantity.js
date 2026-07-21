import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import {
  distributeUnits,
  amountVatFromCostEst,
  shipmentUnitsFromUserInput,
} from '../../../lib/distributeUnits.js';
import { exeRoundedEstimateQuantity } from '../../../lib/estimateDateQuantity.js';

// 견적서관리의 출고일별 수량 변경은 단순 ShipmentDate.EstQuantity 수정이 아니다.
// nenova.exe FormShipmentDistribution의 날짜 탭과 동일하게 해당 날짜의
// ShipmentQuantity를 바꾸고, ShipmentDetail 총량/환산/금액을 함께 갱신한다.
function parseItems(body) {
  const source = Array.isArray(body?.items) ? body.items : [body || {}];
  const seen = new Set();
  return source.map((item) => {
    const sdateKey = parseInt(item?.sdateKey, 10);
    const quantity = parseFloat(item?.quantity);
    const expectedOldQuantity = item?.expectedOldQuantity == null
      ? null
      : parseFloat(item.expectedOldQuantity);
    if (!Number.isInteger(sdateKey) || sdateKey <= 0) {
      throw new Error('sdateKey가 필요합니다. 출고일 행은 ShipmentDate.SdateKey로 저장해야 합니다.');
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`SdateKey=${sdateKey}의 견적 수량이 올바르지 않습니다.`);
    }
    if (expectedOldQuantity != null && !Number.isFinite(expectedOldQuantity)) {
      throw new Error(`SdateKey=${sdateKey}의 조회시점 수량이 올바르지 않습니다.`);
    }
    if (seen.has(sdateKey)) throw new Error(`SdateKey=${sdateKey}가 중복되었습니다.`);
    seen.add(sdateKey);
    return {
      sdateKey,
      quantity,
      unit: typeof item?.unit === 'string' ? item.unit : '',
      expectedOldQuantity,
    };
  });
}

function fixedWeekError(row) {
  const error = new Error(
    `[${row.OrderWeek}] 확정된 차수입니다. 먼저 확정취소 후 출고일별 분배를 수정하세요.`
  );
  error.code = 'FIXED_WEEK';
  error.fixedWeeks = [row.OrderWeek].filter(Boolean);
  error.fixedCategories = [row.CountryFlower].filter(Boolean);
  return error;
}

function roundOutQuantity(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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

  try {
    const result = await withTransaction(async (tQ) => {
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
           ISNULL(sd.isFix, 0) AS DetailIsFix,
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
         JOIN Product p ON p.ProdKey = sd.ProdKey
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
        if (Number(row.DetailIsFix) === 1) throw fixedWeekError(row);
        if (item.expectedOldQuantity != null
          && Math.abs(exeRoundedEstimateQuantity(row.DateEstQuantity) - exeRoundedEstimateQuantity(item.expectedOldQuantity)) > 0.001) {
          const error = new Error(
            `출고일 견적수량이 조회 이후 변경되었습니다. SdateKey=${item.sdateKey}, `
            + `조회시점=${item.expectedOldQuantity}, 현재=${row.DateEstQuantity}`
          );
          error.code = 'STALE_DATA';
          error.expected = item.expectedOldQuantity;
          error.actual = row.DateEstQuantity;
          throw error;
        }
      }

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

      const saved = [];
      for (const group of groups.values()) {
        const { row, product, changes } = group;
        const dateDelta = changes.reduce(
          (sum, change) => sum + change.newDateOutQuantity - Number(change.row.DateShipmentQuantity || 0),
          0
        );
        const newDetailOutQuantity = roundOutQuantity(Number(row.DetailOutQuantity || 0) + dateDelta);
        if (newDetailOutQuantity < -0.0001) {
          throw new Error(`SdetailKey=${row.SdetailKey}의 출고일 수량이 전체 출고수량을 초과합니다.`);
        }
        if (newDetailOutQuantity <= 0.0001) {
          throw new Error('전체 출고수량을 0으로 만들 때는 차수피벗/출고분배의 취소 기능을 사용하세요.');
        }

        const detailUnits = shipmentUnitsFromUserInput(newDetailOutQuantity, row.OutUnit, product);
        const detailDistribution = distributeUnits(detailUnits.outQuantity, product);
        const detailEstQuantity = detailDistribution.estQty;
        const detailMoney = amountVatFromCostEst(row.DetailCost, detailEstQuantity);

        // FormShipmentDistribution 날짜 탭과 같은 핵심 저장: Detail 총량 + 날짜별 ShipmentQuantity.
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

        for (const change of changes) {
          const { item, newDateOutQuantity, newDateEstQuantity } = change;
          const dateMoney = amountVatFromCostEst(row.DetailCost, newDateEstQuantity);
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
                      Vat=@vat
                WHERE SdateKey=@sdateKey`,
              {
                sdateKey: { type: sql.Int, value: item.sdateKey },
                shipQty: { type: sql.Float, value: newDateOutQuantity },
                estQty: { type: sql.Float, value: newDateEstQuantity },
                cost: { type: sql.Float, value: row.DetailCost },
                amount: { type: sql.Float, value: dateMoney.amount },
                vat: { type: sql.Float, value: dateMoney.vat },
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
          throw new Error(`SdetailKey=${row.SdetailKey}의 출고일별 합계와 ShipmentDetail 총량이 맞지 않습니다.`);
        }
      }
      return { items: saved, updatedCount: saved.length };
    });

    return res.status(200).json({ success: true, message: '출고분배 및 출고일별 견적수량 저장 완료', ...result });
  } catch (error) {
    const status = error.code === 'STALE_DATA' ? 409
      : error.code === 'FIXED_WEEK' ? 409
        : 500;
    return res.status(status).json({
      success: false,
      code: error.code,
      error: error.message,
      fixedWeeks: error.fixedWeeks || [],
      fixedCategories: error.fixedCategories || [],
      expected: error.expected,
      actual: error.actual,
    });
  }
});
