// GET — 카탈로그 작성용 마스터 + 도착원가
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { getArrivalCostsForWeekRange } from '../../../lib/pivotFreightArrival';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { orderYear, weekStart, weekEnd, custKey } = req.query;
  const year = orderYear || new Date().getFullYear();
  const wEnd = weekEnd || weekStart;

  try {
    const [productsRes, customersRes, flowersRes] = await Promise.all([
      query(
        `SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName,
                Cost, OutUnit, EstUnit, Descr
         FROM Product WHERE isDeleted=0
         ORDER BY CounName, FlowerName, ProdName`,
      ),
      query(
        `SELECT CustKey, CustCode, CustName, CustArea, OrderCode
         FROM Customer WHERE isDeleted=0 ORDER BY CustName`,
      ),
      query(
        `SELECT FlowerKey, FlowerName, Sort FROM Flower WHERE isDeleted=0 ORDER BY Sort`,
      ),
    ]);

    let arrivalMap = {};
    if (weekStart) {
      try {
        arrivalMap = await getArrivalCostsForWeekRange({
          weekStart,
          weekEnd: wEnd,
          orderYear: year,
        });
      } catch (_) {
        arrivalMap = {};
      }
    }

    let customerCosts = {};
    if (custKey) {
      const ck = parseInt(custKey, 10);
      if (ck > 0) {
        const cpc = await query(
          `SELECT ProdKey, Cost FROM CustomerProdCost WHERE CustKey=@ck`,
          { ck: { type: sql.Int, value: ck } },
        );
        for (const r of cpc.recordset) {
          customerCosts[r.ProdKey] = Number(r.Cost || 0);
        }
      }
    }

    const products = productsRes.recordset.map(p => {
      const arr = arrivalMap[p.ProdKey] || {};
      return {
        ...p,
        arrivalCost: arr.arrivalCost || 0,
        arrivalUnit: arr.displayUnit || p.OutUnit || '단',
        arrivalSource: arr.source || null,
        customerCost: customerCosts[p.ProdKey] ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      orderYear: String(year),
      weekStart: weekStart || null,
      weekEnd: weekStart ? wEnd : null,
      products,
      customers: customersRes.recordset,
      flowers: flowersRes.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
