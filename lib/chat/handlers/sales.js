// lib/chat/handlers/sales.js — 매출 조회
import { query, sql } from '../../db';
import { extractWeek, extractPeriod } from '../router';
import { findCustomer } from '../entities';

export async function handleSalesLookup(text, user) {
  const cust = await findCustomer(text);
  const week = extractWeek(text);
  const period = extractPeriod(text);

  // TOP 거래처
  if (/TOP|탑|순위|상위/i.test(text)) {
    const n = (text.match(/\d+/) || [])[0] || 10;
    const rows = await query(
      `SELECT TOP ${parseInt(n)} c.CustName,
              SUM(ISNULL(sd.Amount,0)) AS totalAmount
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
         JOIN Customer c ON c.CustKey = sm.CustKey
        WHERE ISNULL(sm.isDeleted,0) = 0
          AND sd.ShipmentDtm >= DATEADD(month, -1, GETDATE())
     GROUP BY c.CustName
     ORDER BY SUM(ISNULL(sd.Amount,0)) DESC`,
      {}
    );
    return {
      messages: [
        { type: 'text', content: `🏆 최근 1개월 거래처 매출 TOP ${n}` },
        {
          type: 'card',
          card: {
            title: `거래처 매출 상위 ${n}`,
            rows: rows.recordset.map((r, i) => ({
              label: `${i + 1}. ${r.CustName}`,
              value: `${(r.totalAmount || 0).toLocaleString()}원`,
            })),
          },
        },
      ],
    };
  }

  // 기간 조건 생성
  let where = '';
  const params = {};
  let periodLabel = '';
  if (period === 'today') { where = 'AND CONVERT(date, sd.ShipmentDtm) = CONVERT(date, GETDATE())'; periodLabel = '오늘'; }
  else if (period === 'thisWeek') { where = 'AND sd.ShipmentDtm >= DATEADD(day, -7, GETDATE())'; periodLabel = '최근 7일'; }
  else if (period === 'thisMonth') { where = "AND FORMAT(sd.ShipmentDtm,'yyyy-MM')=FORMAT(GETDATE(),'yyyy-MM')"; periodLabel = '이번 달'; }
  else if (period === 'lastMonth') { where = "AND FORMAT(sd.ShipmentDtm,'yyyy-MM')=FORMAT(DATEADD(month,-1,GETDATE()),'yyyy-MM')"; periodLabel = '지난 달'; }
  else if (period === 'lastYear') { where = "AND YEAR(sd.ShipmentDtm)=YEAR(DATEADD(year,-1,GETDATE()))"; periodLabel = '작년'; }
  else if (week) { where = 'AND sm.OrderWeek = @wk'; params.wk = { type: sql.NVarChar, value: week }; periodLabel = `${week}차`; }
  else { where = "AND FORMAT(sd.ShipmentDtm,'yyyy-MM')=FORMAT(GETDATE(),'yyyy-MM')"; periodLabel = '이번 달'; }

  // 거래처 조건
  let custWhere = '';
  if (cust) {
    custWhere = 'AND sm.CustKey = @ck';
    params.ck = { type: sql.Int, value: cust.CustKey };
  }

  const r = await query(
    `SELECT SUM(ISNULL(sd.Amount,0)) AS totalAmount,
            SUM(ISNULL(sd.Vat,0))    AS totalVat,
            COUNT(DISTINCT sm.CustKey) AS custCount,
            COUNT(*)                   AS itemCount
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      WHERE ISNULL(sm.isDeleted,0) = 0 ${where} ${custWhere}`,
    params
  );
  const row = r.recordset[0] || {};
  return {
    messages: [
      {
        type: 'card',
        card: {
          title: `💰 ${cust ? cust.CustName + ' · ' : ''}${periodLabel} 매출`,
          rows: [
            { label: '공급가액', value: `${(row.totalAmount || 0).toLocaleString()}원` },
            { label: '부가세',   value: `${(row.totalVat    || 0).toLocaleString()}원` },
            { label: '합계',     value: `${((row.totalAmount||0) + (row.totalVat||0)).toLocaleString()}원` },
            { label: '거래처 수', value: `${row.custCount || 0}곳` },
            { label: '출고 건수', value: `${row.itemCount || 0}건` },
          ],
        },
      },
    ],
  };
}
