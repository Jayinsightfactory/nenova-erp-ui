// GET — 카탈로그 작성용 마스터 + 도착원가
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { getArrivalCostsForWeekRange } from '../../../lib/pivotFreightArrival';
import { splitCatalogWeekForApi } from '../../../lib/catalogUtils';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { orderYear, weekStart, weekEnd, custKey } = req.query;

  try {
    let parsed = { orderYear: orderYear || String(new Date().getFullYear()), weekStart: '', weekEnd: '' };
    let weekParseError = null;

    if (weekStart) {
      try {
        const start = splitCatalogWeekForApi(weekStart, orderYear);
        const end = weekEnd
          ? splitCatalogWeekForApi(weekEnd, start.orderYear)
          : start;
        parsed = {
          orderYear: start.orderYear,
          weekStart: start.weekStart,
          weekEnd: end.weekStart || start.weekStart,
        };
      } catch (e) {
        weekParseError = e.message;
      }
    }

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
    let arrivalError = weekParseError || null;

    if (parsed.weekStart && !weekParseError) {
      try {
        arrivalMap = await getArrivalCostsForWeekRange({
          weekStart: parsed.weekStart,
          weekEnd: parsed.weekEnd,
          orderYear: parsed.orderYear,
        });
      } catch (e) {
        arrivalError = e.message;
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

    let withArrival = 0;
    const products = productsRes.recordset.map(p => {
      const arr = arrivalMap[p.ProdKey] || {};
      const arrivalCost = Number(arr.arrivalCost || 0);
      if (arrivalCost > 0) withArrival += 1;
      return {
        ...p,
        arrivalCost,
        arrivalUnit: arr.displayUnit || p.OutUnit || '단',
        arrivalSource: arr.source || null,
        customerCost: customerCosts[p.ProdKey] ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      orderYear: parsed.orderYear,
      weekStart: parsed.weekStart || null,
      weekEnd: parsed.weekEnd || null,
      weekInput: weekStart || null,
      arrivalStats: {
        total: products.length,
        withArrival,
        error: arrivalError,
      },
      products,
      customers: customersRes.recordset,
      flowers: flowersRes.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
