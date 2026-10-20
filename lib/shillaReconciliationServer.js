import { query, sql } from './db';
import { analysisPeriod } from './shillaReconciliation';
// Deliberately do not use loadRaumPnlDetail: its ensure-tables path can execute DDL.
export async function loadShillaAnalysisRows(year) {
  if (!/^20\d{2}$/.test(String(year))) throw new Error('결산 연도가 필요합니다.');
  const result = await query(`SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.QuoteDate,
    i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount, i.CostPrice, i.Remark
    FROM WebRaumPnl m LEFT JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey
    WHERE m.OrderYear=@year AND m.PartnerCode=N'shilla' AND m.isDeleted=0
    ORDER BY m.MajorWeek,i.Seq,i.ItemKey`, {year:{type:sql.NVarChar,value:String(year)}});
  return (result.recordset || []).filter(r=>r.ItemKey!=null).map(r=>({
    year:String(r.OrderYear),period:analysisPeriod(String(r.MajorWeek)),
    name:r.ItemName,unit:r.Unit || '',qty:r.Qty,price:r.SalePrice,amount:r.SaleAmount,costPrice:r.CostPrice,
    source:`DB ${r.PnlKey}/${r.ItemKey}`, remark:r.Remark || '',
  }));
}
