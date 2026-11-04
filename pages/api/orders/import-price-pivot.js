// pages/api/orders/import-price-pivot.js
// 업로드 주문등록 「직접 수정」 탭 — 세부차수 × 업체 × 품목 분배단가 피벗 조회 (읽기 전용)
// GET ?orderYear=2026&orderWeek=44-01&counName=중국&manager=<UserID|__ALL__>
// 규칙 1: SELECT 만. 단가 저장은 /api/estimate/update-cost (isFix 보존, 재고 SP 미호출) 가 담당.
// ShipmentDetail 에는 isDeleted 컬럼이 없으므로 삭제 필터는 ShipmentMaster 에만 적용한다.

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const ALL = '__ALL__';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const orderYear = String(req.query.orderYear || '').trim();
  const orderWeek = String(req.query.orderWeek || '').trim();
  const counName = String(req.query.counName || '').trim();
  const manager = String(req.query.manager || ALL).trim() || ALL;

  if (!/^\d{4}$/.test(orderYear)) return res.status(400).json({ success: false, error: 'orderYear(4자리) 필요' });
  if (!/^\d{2}-\d{2}$/.test(orderWeek)) return res.status(400).json({ success: false, error: 'orderWeek(NN-NN) 필요' });

  try {
    // 담당자 목록: 활성 업체의 Customer.Manager (UserID 또는 UserName 으로 UserInfo 조인)
    const mgrRs = await query(
      `SELECT u.UserID, u.UserName, COUNT(*) AS custCount
         FROM Customer c
         JOIN UserInfo u ON ISNULL(u.isDeleted,0)=0
          AND (LTRIM(RTRIM(c.Manager))=u.UserID OR LTRIM(RTRIM(c.Manager))=u.UserName)
        WHERE ISNULL(c.isDeleted,0)=0 AND NULLIF(LTRIM(RTRIM(c.Manager)),'') IS NOT NULL
        GROUP BY u.UserID, u.UserName
        ORDER BY u.UserName`,
    );
    const managers = (mgrRs.recordset || []).map(r => ({ userId: r.UserID, userName: r.UserName, custCount: r.custCount }));

    // 이 세부차수에 분배가 있는 국가 목록
    const countryRs = await query(
      `SELECT DISTINCT p.CounName
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND NULLIF(LTRIM(RTRIM(p.CounName)),'') IS NOT NULL
        ORDER BY p.CounName`,
      { yr: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: orderWeek } },
    );
    const countries = (countryRs.recordset || []).map(r => r.CounName);

    const params = {
      yr: { type: sql.NVarChar, value: orderYear },
      wk: { type: sql.NVarChar, value: orderWeek },
    };
    let where = `sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(c.isDeleted,0)=0`;
    if (counName) { where += ` AND p.CounName=@coun`; params.coun = { type: sql.NVarChar, value: counName }; }
    if (manager !== ALL) {
      where += ` AND (LTRIM(RTRIM(c.Manager))=@mgr OR LTRIM(RTRIM(c.Manager)) IN (SELECT UserName FROM UserInfo WHERE UserID=@mgr AND ISNULL(isDeleted,0)=0))`;
      params.mgr = { type: sql.NVarChar, value: manager };
    }

    const rs = await query(
      `SELECT sm.CustKey, c.CustName, LTRIM(RTRIM(ISNULL(c.Manager,N''))) AS Manager,
              sd.SdetailKey, sd.ShipmentKey, sd.ProdKey,
              ISNULL(p.DisplayName, p.ProdName) AS DisplayName, p.OutUnit,
              ISNULL(sd.OutQuantity,0) AS OutQuantity, ISNULL(sd.Cost,0) AS Cost,
              ISNULL(sd.isFix,0) AS isFix, ISNULL(sm.isFix,0) AS masterFix
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Product p ON p.ProdKey = sd.ProdKey
         JOIN Customer c ON c.CustKey = sm.CustKey
        WHERE ${where}
        ORDER BY c.CustName, p.ProdName, sd.SdetailKey`,
      params,
    );

    const customers = new Map();
    const products = new Map();
    const cells = new Map();
    for (const r of rs.recordset || []) {
      if (!customers.has(r.CustKey)) customers.set(r.CustKey, { custKey: r.CustKey, custName: r.CustName, manager: r.Manager });
      if (!products.has(r.ProdKey)) products.set(r.ProdKey, { prodKey: r.ProdKey, displayName: r.DisplayName, outUnit: r.OutUnit });
      const k = `${r.CustKey}:${r.ProdKey}`;
      if (!cells.has(k)) cells.set(k, { custKey: r.CustKey, prodKey: r.ProdKey, cost: Number(r.Cost), outQty: 0, isFix: false, mixedCost: false, details: [] });
      const c = cells.get(k);
      if (c.details.length && Number(r.Cost) !== c.cost) c.mixedCost = true;
      c.outQty += Number(r.OutQuantity);
      if (Number(r.isFix) === 1 || Number(r.masterFix) === 1) c.isFix = true;
      c.details.push({ sdetailKey: r.SdetailKey, shipmentKey: r.ShipmentKey, cost: Number(r.Cost) });
    }

    return res.status(200).json({
      success: true, orderYear, orderWeek, counName, manager,
      customers: [...customers.values()],
      products: [...products.values()],
      cells: [...cells.values()],
      managers, countries,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
