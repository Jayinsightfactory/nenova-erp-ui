// Stored receipt boxes only. No master-data unit conversion or ERP writes.
export const WAREHOUSE_BOX_SQL = `SELECT wm.OrderYear, wm.OrderWeek,
 COALESCE(NULLIF(LTRIM(RTRIM(p.CounName)),N''),N'미분류') AS country,
 COALESCE(NULLIF(LTRIM(RTRIM(p.FlowerName)),N''),N'미분류') AS flower,
 SUM(CAST(wd.BoxQuantity AS DECIMAL(28,6))) AS boxes,
 SUM(CASE WHEN wd.BoxQuantity IS NULL THEN 1 ELSE 0 END) AS missingBoxes,
 COUNT(*) AS lineCount, COUNT(DISTINCT wm.WarehouseKey) AS receiptCount
 FROM WarehouseMaster wm
 JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
 LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
 WHERE wm.isDeleted=0 AND wm.OrderYear=@year
 GROUP BY wm.OrderYear, wm.OrderWeek, p.CounName, p.FlowerName`;

export function boxSummaryYear(value) {
  if (typeof value !== 'string' || !/^20\d{2}$/.test(value)) throw new Error('조회 연도는 2000~2099로 입력하세요.');
  return value;
}
export function filterBoxSummary(rows, { year, week = '', country = '', flower = '' }) {
  boxSummaryYear(String(year));
  return rows.filter(row => String(row.OrderYear) === String(year)
    && (!week || row.OrderWeek === week) && (!country || row.country === country)
    && (!flower || row.flower === flower)).sort((a,b) => String(a.OrderWeek).localeCompare(String(b.OrderWeek), undefined, { numeric:true })
      || a.country.localeCompare(b.country,'ko') || a.flower.localeCompare(b.flower,'ko'));
}
export function boxSummaryTotals(rows) {
  return rows.reduce((sum,row) => ({ boxes: Math.round((sum.boxes + Number(row.boxes ?? 0))*1e6)/1e6,
    missingBoxes: sum.missingBoxes + Number(row.missingBoxes || 0), lineCount:sum.lineCount+Number(row.lineCount||0) }),
  { boxes:0, missingBoxes:0, lineCount:0 });
}
