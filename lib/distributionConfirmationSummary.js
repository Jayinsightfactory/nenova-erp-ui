export const DISTRIBUTION_CONFIRMATION_SUMMARY_SQL=`
 SELECT ISNULL(NULLIF(LTRIM(RTRIM(CountryFlower)),N''),N'미분류') category,
 COUNT(*) detailCount,SUM(CASE WHEN ISNULL(DetailFix,0)=1 THEN 1 ELSE 0 END) fixedCount
 FROM ViewShipment WHERE OrderYear=@year AND OrderWeek=@week
 GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(CountryFlower)),N''),N'미분류') ORDER BY category`;
export function confirmationRows(rows){return rows.map(r=>({...r,status:r.fixedCount===r.detailCount?'FIXED':r.fixedCount>0?'PARTIAL':'UNFIXED'}));}

// Resolve UI country/family/product selection to native categories, never concatenate labels.
export async function loadDistributionConfirmationScope(q,sql,scope,selection,lock=false){
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||typeof selection.prodGroup!=='string')throw Error('확정 처리 선택 범위를 다시 조회하세요.');
 const params={year:{type:sql.NVarChar,value:scope.orderYear},week:{type:sql.NVarChar,value:scope.orderWeek}};
 let where='';
 if(selection.prodKey!==null&&selection.prodKey!==undefined){
  if(!Number.isSafeInteger(Number(selection.prodKey))||Number(selection.prodKey)<=0)throw Error('선택 품목이 올바르지 않습니다.');
  where='AND p.ProdKey=@prodKey';params.prodKey={type:sql.Int,value:Number(selection.prodKey)};
 }else if(selection.prodGroup){
  const parts=selection.prodGroup.split('::');
  if(parts.length===2&&parts[0]){where='AND p.CounName=@country';params.country={type:sql.NVarChar,value:parts[0]};if(parts[1]){where+=' AND p.FlowerName=@flower';params.flower={type:sql.NVarChar,value:parts[1]};}}
  else if(parts.length===1){where='AND p.CountryFlower=@category';params.category={type:sql.NVarChar,value:parts[0]};}
  else throw Error('선택 품종이 올바르지 않습니다.');
 }
 const r=await q(`SELECT DISTINCT LTRIM(RTRIM(p.CountryFlower)) category FROM Product p ${lock?'WITH (UPDLOCK,HOLDLOCK)':''}
 WHERE ISNULL(p.isDeleted,0)=0 AND NULLIF(LTRIM(RTRIM(p.CountryFlower)),N'') IS NOT NULL ${where}
 AND EXISTS(SELECT 1 FROM ViewShipment vs WHERE vs.OrderYear=@year AND vs.OrderWeek=@week AND vs.CountryFlower=p.CountryFlower)
 ORDER BY category`,params);
 return r.recordset.map(r=>String(r.category));
}
