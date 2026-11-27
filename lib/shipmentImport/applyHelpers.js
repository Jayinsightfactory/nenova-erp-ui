import { normalizeOrderUnit } from '../orderUtils.js';
import { changeEntry } from '../shipmentDescr.js';
import { amountVatFromCostEst } from '../distributeUnits.js';
import { chinaOrderUnits } from '../chinaOrderUnits.js';
import { alignShipmentDetailMoneyToDates } from '../shipmentEstimateGuard.js';
import { dutchError } from '../dutchVolumeDistribution.js';
import { isShipmentImportVerificationSuccessful } from '../shipmentImportQty.js';
import { sameQty } from './matchingEngine.js';

export function isPkCollision(e) {
  return e?.number === 2627 || e?.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e?.message || '');
}

export async function syncKeyNumbering(tQ, sql, category, table, keyCol) {
  const allowed = {
    OrderMasterKey: ['OrderMaster', 'OrderMasterKey'],
    OrderDetailKey: ['OrderDetail', 'OrderDetailKey'],
    ShipmentMasterKey: ['ShipmentMaster', 'ShipmentKey'],
    ShipmentDetailKey: ['ShipmentDetail', 'SdetailKey'],
  };
  const [safeTable, safeKeyCol] = allowed[category] || [];
  if (safeTable !== table || safeKeyCol !== keyCol) throw new Error('invalid key numbering sync target');

  await tQ(
    `IF EXISTS (SELECT 1 FROM KeyNumbering WHERE Category=@cat)
       UPDATE KeyNumbering
          SET LastKeyNo = CASE WHEN LastKeyNo < x.MaxKey THEN x.MaxKey ELSE LastKeyNo END
         FROM KeyNumbering
         CROSS JOIN (SELECT ISNULL(MAX(${keyCol}),0) AS MaxKey FROM ${table}) x
        WHERE Category=@cat
     ELSE
       INSERT INTO KeyNumbering (Category, LastKeyNo, Descr)
       SELECT @cat, ISNULL(MAX(${keyCol}),0), '' FROM ${table}`,
    { cat: { type: sql.NVarChar, value: category } }
  );
}

// 계산된 달력 날짜를 자정(UTC) 으로 고정한다.
export function toUtcMidnight(date) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0));
}

export function calcShipDate(weekStr, yearStr, baseDay) {
  const weekNum = parseInt(String(weekStr || '').split('-')[0], 10);
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  if (!weekNum) return null;
  const dateStart = new Date(year, 0, (weekNum - 1) * 7 + 1, 12, 0, 0, 0);
  const wednesday = new Date(dateStart);
  const daysBackToWednesday = (wednesday.getDay() - 3 + 7) % 7;
  wednesday.setDate(wednesday.getDate() - daysBackToWednesday);
  const offsets = [0, 4, 5, 6, 1, 3, 2];
  wednesday.setDate(wednesday.getDate() + (offsets[Number(baseDay)] ?? 0));
  return toUtcMidnight(wednesday);
}

export function orderQtyFromDetail(detail, product = {}) {
  const outUnit = normalizeOrderUnit(product.OutUnit, '박스');
  if (outUnit === '단') return Number(detail?.BunchQuantity || 0);
  if (outUnit === '송이') return Number(detail?.SteamQuantity || 0);
  return Number(detail?.BoxQuantity ?? detail?.OutQuantity ?? 0);
}

export function memoQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '').trim();
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))).replace(/\.?0+$/, '');
}

export function importMemo(userName, before = null, after = null) {
  if (before == null || after == null) return '';
  return changeEntry(userName, before, after);
}

export function formatDateYmd(date) {
  if (!date || Number.isNaN(date.getTime?.())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function insertOrderHistory(tQ, sql, detailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO OrderHistory
         (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       VALUES (@dk, N'수정', N'수량', @before, @after, @descr, @uid, GETDATE())`,
      {
        dk: { type: sql.Int, value: detailKey },
        before: { type: sql.NVarChar, value: String(before) },
        after: { type: sql.NVarChar, value: String(after) },
        descr: { type: sql.NVarChar, value: descr || '' },
        uid: { type: sql.NVarChar, value: uid || 'admin' },
      }
    );
  } catch (e) {
    console.warn('[OrderHistory INSERT failed]', e.message);
  }
}

export async function insertShipmentHistory(tQ, sql, sdetailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO ShipmentHistory
         (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       SELECT @dk, ShipmentDtm, N'수정', @before, @after, @descr, @uid, GETDATE()
         FROM ShipmentDetail
        WHERE SdetailKey=@dk`,
      {
        dk: { type: sql.Int, value: sdetailKey },
        before: { type: sql.NVarChar, value: String(before) },
        after: { type: sql.NVarChar, value: String(after) },
        descr: { type: sql.NVarChar, value: descr || '' },
        uid: { type: sql.NVarChar, value: uid || 'admin' },
      }
    );
  } catch (e) {
    console.warn('[ShipmentHistory INSERT failed]', e.message);
  }
}

export function orderApplyAction(mutation = {}) {
  if (mutation.detailCreated) return mutation.orderCreated ? '주문신규' : '주문품목추가';
  if (mutation.detailUpdated) return '주문수정';
  if (mutation.orderCreated) return '주문마스터생성';
  return '주문유지';
}

export async function loadCurrentImportState(tQ, sql, row, week, product = {}, orderYear = String(new Date().getFullYear())) {
  const orderResult = await tQ(
    `SELECT TOP 1 od.OrderDetailKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity
       FROM OrderMaster om WITH (UPDLOCK, HOLDLOCK)
       JOIN OrderDetail od WITH (UPDLOCK, HOLDLOCK)
         ON od.OrderMasterKey=om.OrderMasterKey
        AND od.ProdKey=@pk
        AND ISNULL(od.isDeleted,0)=0
      WHERE om.CustKey=@ck
        AND om.OrderWeek=@week
        AND ISNULL(om.isDeleted,0)=0
        AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
      ORDER BY om.OrderMasterKey ASC, od.OrderDetailKey ASC`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
    }
  );
  const shipmentResult = await tQ(
    `SELECT
            ISNULL(SUM(ISNULL(sd.OutQuantity,0)),0) AS currentOutQty,
            ISNULL(SUM(CASE WHEN ISNULL(sd.OutQuantity,0) <> 0
                              AND (
                                sd.ShipmentDtm IS NULL
                                OR ISNULL(sdt.DateQty,0) <> ISNULL(sd.OutQuantity,0)
                                OR ISNULL(sdt.DateRowCount,0) = 0
                                OR ISNULL(sdt.NullDateCount,0) > 0
                                OR CONVERT(date, sd.ShipmentDtm) <> sdt.MinShipmentDate
                                OR CONVERT(date, sd.ShipmentDtm) <> sdt.MaxShipmentDate
                              )
                            THEN 1 ELSE 0 END),0) AS dateIssueCount
       FROM ShipmentMaster sm WITH (UPDLOCK, HOLDLOCK)
       JOIN ShipmentDetail sd WITH (UPDLOCK, HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
       OUTER APPLY (
         SELECT
                SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                COUNT(*) AS DateRowCount,
                SUM(CASE WHEN ShipmentDtm IS NULL THEN 1 ELSE 0 END) AS NullDateCount,
                MIN(CONVERT(date, ShipmentDtm)) AS MinShipmentDate,
                MAX(CONVERT(date, ShipmentDtm)) AS MaxShipmentDate
           FROM ShipmentDate
          WHERE SdetailKey=sd.SdetailKey
       ) sdt
      WHERE sm.CustKey=@ck
        AND sm.OrderWeek=@week
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @importYear) = @importYear
        AND sd.ProdKey=@pk`,
    {
      ck: { type: sql.Int, value: Number(row.custKey) },
      pk: { type: sql.Int, value: Number(row.prodKey) },
      week: { type: sql.NVarChar, value: week },
      importYear: { type: sql.NVarChar, value: String(orderYear) },
    }
  );
  const detail = orderResult.recordset[0];
  return {
    hasExistingOrder: !!detail,
    orderQty: detail ? orderQtyFromDetail(detail, product) : 0,
    currentOutQty: Number(shipmentResult.recordset[0]?.currentOutQty || 0),
    dateIssueCount: Number(shipmentResult.recordset[0]?.dateIssueCount || 0),
  };
}

export async function updateDutchDatePrices(tQ, sql, sdetailKey, cost) {
  const dates = await tQ(
    `SELECT SdateKey,EstQuantity FROM ShipmentDate WITH (UPDLOCK,HOLDLOCK)
      WHERE SdetailKey=@dk ORDER BY SdateKey`,
    { dk: { type: sql.Int, value: sdetailKey } }
  );
  for (const date of dates.recordset || []) {
    const { amount, vat } = amountVatFromCostEst(cost, Number(date.EstQuantity || 0));
    if (!Number.isFinite(amount) || !Number.isFinite(vat)) {
      throw dutchError('DUTCH_DATE_AMOUNT_INVALID', `출고일 ${date.SdateKey} 원화 금액 계산 결과가 유효하지 않습니다.`, 409);
    }
    await tQ(
      `UPDATE ShipmentDate SET Cost=@cost,Amount=@amount,Vat=@vat WHERE SdateKey=@dateKey`,
      {
        dateKey: { type: sql.Int, value: Number(date.SdateKey) },
        cost: { type: sql.Float, value: cost },
        amount: { type: sql.Float, value: amount },
        vat: { type: sql.Float, value: vat },
      }
    );
  }
  await alignShipmentDetailMoneyToDates(tQ, sql, sdetailKey);
}

export function buildApplyLog(row, applied) {
  const customer = row.custName || row.customerLabel || row.custKey;
  const product = row.displayName || row.prodName || row.productLabel || row.prodKey;
  const priceText = row.sourceType === 'dutch-volume' && row.unitPrice != null
    ? `, 원화단가/${row.estUnit || '견적단위'} ${row.currentCost == null ? '신규' : Number(row.currentCost)}→${Number(row.unitPrice)}`
    : '';
  return `${customer} / ${product}: ${applied.orderAction}, ${applied.shipmentAction} ` +
    `(주문 ${Number(row.orderQty || 0)}→${Number(applied.orderAfterQty ?? row.orderQty ?? 0)}, 분배 ${Number(applied.beforeQty || 0)}→${Number(applied.afterQty || 0)}${priceText})`;
}

export async function assertDutchNativeVisibility(tQ, sql, rows, orderYear, week) {
  const positive = rows.filter(row => Number(row.uploadQty) > 0);
  if (!positive.length) return;
  const values = positive.map(row => {
    const ck = Number(row.custKey), pk = Number(row.prodKey);
    if (!Number.isSafeInteger(ck) || ck <= 0 || !Number.isSafeInteger(pk) || pk <= 0) {
      throw dutchError('DUTCH_NATIVE_KEY_INVALID', '전산 표시 검증의 업체·품목 키가 유효하지 않습니다.', 409);
    }
    return `(${ck},${pk})`;
  }).join(',');
  const result = await tQ(
    `WITH requested(CustKey,ProdKey) AS (SELECT * FROM (VALUES ${values}) v(CustKey,ProdKey))
     SELECT r.CustKey,r.ProdKey,
            (SELECT COUNT_BIG(*) FROM ViewOrder vo
              WHERE CAST(vo.OrderYear AS NVARCHAR(4))=@year AND vo.OrderWeek=@week
                AND vo.CustKey=r.CustKey AND vo.ProdKey=r.ProdKey) AS OrderVisible,
            (SELECT COUNT_BIG(*) FROM ViewShipment vs
              WHERE CAST(vs.OrderYear AS NVARCHAR(4))=@year AND vs.OrderWeek=@week
                AND vs.CustKey=r.CustKey AND vs.ProdKey=r.ProdKey) AS ShipmentVisible,
            (SELECT COUNT_BIG(*) FROM ViewShipment vs
                JOIN ShipmentDate d ON d.SdetailKey=vs.SdetailKey
               WHERE CAST(vs.OrderYear AS NVARCHAR(4))=@year AND vs.OrderWeek=@week
                 AND vs.CustKey=r.CustKey AND vs.ProdKey=r.ProdKey
                 AND NOT EXISTS (
                   SELECT 1 FROM PeriodDay pd
                    WHERE pd.OrderYearWeek=@majorYearWeek
                      AND TRY_CONVERT(DATETIME,pd.BaseYmd)=d.ShipmentDtm
                 )) AS InvisibleDates
       FROM requested r`,
    {
      year: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: String(week) },
      majorYearWeek: { type: sql.NVarChar, value: String(orderYear) + String(week).split('-')[0] },
    }
  );
  const bad = (result.recordset || []).filter(row => Number(row.OrderVisible) !== 1 || Number(row.ShipmentVisible) !== 1 || Number(row.InvisibleDates) !== 0);
  if (bad.length) {
    throw dutchError('DUTCH_NATIVE_VISIBILITY_FAILED', `전산 ViewOrder/ViewShipment/PeriodDay 연결 검증에 실패했습니다(${bad.slice(0, 5).map(row => `${row.CustKey}/${row.ProdKey}: 주문${row.OrderVisible},분배${row.ShipmentVisible},달력누락${row.InvisibleDates}`).join('; ')}). 전체 롤백합니다.`, 409);
  }
}

export function verifyChinaPostWriteOrders(dutchPlan, afterScope, targetRows) {
  if (dutchPlan?.country !== '중국') return;
  const afterOrders = new Map(afterScope.snapshot.orders.map(row => [Number(row.OrderDetailKey), row]));
  for (const before of dutchPlan.existingOrders || []) {
    if (JSON.stringify(afterOrders.get(Number(before.OrderDetailKey))) !== JSON.stringify(before)) {
      throw dutchError('CHINA_ORDER_CHANGED', '기존 주문이 변경되어 전체 저장을 취소했습니다.', 409);
    }
  }
  const oldPairs = new Set((dutchPlan.existingOrders || []).map(row => `${row.OrderCustKey ?? row.CustKey}|${row.ProdKey}`));
  for (const row of targetRows) {
    if (Number(row.uploadQty) <= 0 || oldPairs.has(`${row.custKey}|${row.prodKey}`)) continue;
    const saved = afterScope.snapshot.orders.find(order => Number(order.OrderCustKey ?? order.CustKey) === Number(row.custKey) && Number(order.ProdKey) === Number(row.prodKey));
    const product = afterScope.snapshot.products.find(item => Number(item.ProdKey) === Number(row.prodKey));
    const expected = chinaOrderUnits(row.uploadQty, product);
    for (const [column, key] of [['BoxQuantity', 'box'], ['BunchQuantity', 'bunch'], ['SteamQuantity', 'steam'], ['OutQuantity', 'outQty'], ['EstQuantity', 'estQty']]) {
      if (!saved || saved[column] == null || !Number.isFinite(Number(saved[column])) || !sameQty(Number(saved[column]), expected[key])) {
        throw dutchError('CHINA_NEW_ORDER_UNITS_CHANGED', '신규 주문의 단위 환산 검증에 실패하여 전체 저장을 취소했습니다.', 409);
      }
    }
  }
}

export function buildApplyRowsResult({ week, rows, targetRows, result, appliedRows, verification, auditRows }) {
  const logs = [
    `${week}차 엑셀 검증 적용 완료: 적용 ${appliedRows.length}건, 이미 동일 ${result.skippedNoChangeCount || 0}건, 확정차단 ${result.skippedFixedCount || 0}건`,
    `주문 신규/추가 ${appliedRows.filter(r => r.orderCreated || r.detailCreated).length}건, 주문수정 ${appliedRows.filter(r => r.detailUpdated).length}건, 주문삭제 ${appliedRows.filter(r => r.detailDeleted).length}건`,
    `분배 신규 ${appliedRows.filter(r => r.shipmentAction === '분배신규').length}건, 분배수정 ${appliedRows.filter(r => r.shipmentAction === '분배수정').length}건, 분배삭제 ${appliedRows.filter(r => r.shipmentAction === '분배삭제').length}건`,
    ...((result.skippedFixedLogs || []).slice(0, 20)),
    ...(result.skippedFixedLogs?.length > 20 ? [`... 확정차단 외 ${result.skippedFixedLogs.length - 20}건`] : []),
    ...appliedRows.map(r => r.log),
    verification.error
      ? `⚠ 사후 검증 실패(반영 여부 미확인): ${verification.error}`
      : `사후 검증: 확인 ${verification.checked}건 중 정상 반영 ${verification.matched}건, 불일치 ${verification.mismatchCount}건`,
    ...(verification.mismatches || []).map(m =>
      `  ⚠ ${m.custName} / ${m.prodName}: 의도 ${m.intended} vs 실제 ${m.actual} (${m.reason})`),
  ];

  return {
    success: isShipmentImportVerificationSuccessful(verification),
    week,
    inputRowCount: rows.length,
    targetRowCount: targetRows.length,
    appliedCount: appliedRows.length,
    skippedNoChangeCount: result.skippedNoChangeCount || 0,
    skippedFixedCount: result.skippedFixedCount || 0,
    shipmentChangedCount: appliedRows.filter(r => r.shipmentChanged).length,
    orderChangedCount: appliedRows.filter(r => r.orderChanged).length,
    orderCreatedCount: appliedRows.filter(r => r.orderCreated || r.detailCreated).length,
    orderUpdatedCount: appliedRows.filter(r => r.detailUpdated).length,
    orderDeletedCount: appliedRows.filter(r => r.detailDeleted).length,
    shipmentCreatedCount: appliedRows.filter(r => r.shipmentAction === '분배신규').length,
    shipmentUpdatedCount: appliedRows.filter(r => r.shipmentAction === '분배수정').length,
    shipmentDeletedCount: appliedRows.filter(r => r.shipmentAction === '분배삭제' || r.shipmentAction === '유령삭제').length,
    logs,
    appliedRows,
    verification,
    auditRows,
  };
}
