export const DISTRIBUTION_CONFIRMATION_SUMMARY_SQL=`
 SELECT ISNULL(NULLIF(LTRIM(RTRIM(CountryFlower)),N''),N'미분류') category,
 COUNT(*) detailCount,SUM(CASE WHEN ISNULL(DetailFix,0)=1 THEN 1 ELSE 0 END) fixedCount
 FROM ViewShipment WHERE OrderYear=@year AND OrderWeek=@week
 GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(CountryFlower)),N''),N'미분류') ORDER BY category`;
export function confirmationRows(rows){return rows.map(r=>({...r,status:r.fixedCount===r.detailCount?'FIXED':r.fixedCount>0?'PARTIAL':'UNFIXED'}));}
