// 채권 원천(읽기 전용). pages/api/sales/ar.js getList 와 같은 원천·같은 계산을 복제했다(ar.js 는 수정하지 않음).
//  청구 = ShipmentMaster⋈ShipmentDetail(isFix=1) 의 Amount+Vat, 입금 = ReceivableLedger LedgerType=N'입금'.
//  잔액 = 청구합 - 입금합. 거래처 집합 = 청구가 있는 거래처(ar.js 와 동일).
import { query, sql } from '../db.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from './boundary.js';

async function readOnly(q, params) {
  assertMgmtSqlReadOnlyOutsideSchema(q);
  return query(q, params);
}

const SALES_FROM = `
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
  JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
  JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
  WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix, 0) = 1`;

async function loadPaidMap() {
  const r = await readOnly(
    `IF OBJECT_ID(N'dbo.ReceivableLedger', N'U') IS NULL
       SELECT CAST(NULL AS INT) AS CustKey, CAST(NULL AS DECIMAL(18,2)) AS totalPaid WHERE 1 = 0
     ELSE
       SELECT CustKey, SUM(Amount) AS totalPaid FROM ReceivableLedger WHERE LedgerType = N'입금' AND isDeleted = 0 GROUP BY CustKey`,
  );
  const map = {};
  for (const x of r?.recordset || []) map[x.CustKey] = Number(x.totalPaid) || 0;
  return map;
}

// 거래처별 잔액(ar.js customers 와 같은 집합·같은 값)
export async function getArBalances({ custKey } = {}) {
  const params = {};
  let custWhere = '';
  if (custKey) { custWhere = ' AND c.CustKey = @custKey'; params.custKey = { type: sql.Int, value: Number(custKey) }; }
  const sales = await readOnly(
    `SELECT c.CustKey, c.CustName, c.CustArea, c.Manager,
            SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS totalSales
     ${SALES_FROM}${custWhere}
     GROUP BY c.CustKey, c.CustName, c.CustArea, c.Manager`,
    params,
  );
  const paidMap = await loadPaidMap();
  return (sales?.recordset || []).map((r) => {
    const totalSales = Number(r.totalSales) || 0;
    const totalPaid = paidMap[r.CustKey] || 0;
    return { custKey: r.CustKey, custName: r.CustName, area: r.CustArea || '', manager: r.Manager || '', totalSales, totalPaid, balance: totalSales - totalPaid };
  });
}

// aging 입력: 거래처별 청구(출고 건 단위, 발생일=ShipmentDtm 최대일) + 입금 합계
export async function getArAgingInputs() {
  const ch = await readOnly(
    `SELECT sm.CustKey, c.CustName, c.CustArea, c.Manager, sm.ShipmentKey,
            MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS shipDate,
            SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS amount
     ${SALES_FROM}
     GROUP BY sm.CustKey, c.CustName, c.CustArea, c.Manager, sm.ShipmentKey`,
  );
  const paidMap = await loadPaidMap();
  const byCust = new Map();
  for (const r of ch?.recordset || []) {
    let e = byCust.get(r.CustKey);
    if (!e) {
      e = { custKey: r.CustKey, custName: r.CustName, area: r.CustArea || '', manager: r.Manager || '', charges: [], totalPaid: paidMap[r.CustKey] || 0 };
      byCust.set(r.CustKey, e);
    }
    e.charges.push({ date: r.shipDate || '', amount: Number(r.amount) || 0 });
  }
  return [...byCust.values()];
}
