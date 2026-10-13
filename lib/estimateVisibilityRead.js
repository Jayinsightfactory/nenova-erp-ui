// Read-only diagnostic decomposition. Native joins/count multiplicity stay in SQL.
export async function readEstimateVisibility(query, sql, { year, weeks, q }) {
  const params={yr:{type:sql.NVarChar,value:year},q:{type:sql.NVarChar,value:`%${q}%`}};
  weeks.forEach((week,index)=>{params[`w${index}`]={type:sql.NVarChar,value:week};});
  const wkIn=weeks.map((_,index)=>`@w${index}`).join(',');
  const base=await query(`SELECT TOP 400
              c.CustName, p.ProdName, p.CounName, p.FlowerName,
              sm.CustKey, sd.ProdKey, sm.OrderWeek,
              ISNULL(sm.isFix,0) AS SmFix, sd.OutQuantity, sd.EstQuantity, sd.SdetailKey,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipDtm,
              -- 주문 라인 원본 존재(뷰 필터 무시) → '주문 자체 없음' vs '주문은 있는데 뷰에서 탈락' 구분
              (SELECT COUNT(*) FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
                 WHERE om.OrderYear=sm.OrderYear AND om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND od.ProdKey=sd.ProdKey
                   AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0) AS OrderDetailRaw,
              (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON pd.BaseYmd=sdt.ShipmentDtm WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodExactCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON CONVERT(date,pd.BaseYmd)=CONVERT(date,sdt.ShipmentDtm) WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodDateCnt,
              (SELECT TOP 1 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateRaw,
              ISNULL(sm.WebCreated,0) AS WebCreated, sm.OrderYearWeek AS SmYW, sm.OrderYear AS SmYear,
              -- 전산 구조 위반: 같은 출고+거래처+품목에 ShipmentDetail 이 2건 이상(웹 splitDateDetails 잔재)
              (SELECT COUNT(*)
                 FROM ShipmentDetail z
                WHERE z.ShipmentKey = sm.ShipmentKey
                  AND z.CustKey = sm.CustKey
                  AND z.ProdKey = sd.ProdKey) AS DetailSplitCnt
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
          AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q
                OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )
        ORDER BY p.ProdName, sm.OrderWeek, c.CustName`,params);
  const rows=base.recordset || [];
  if(!rows.length)return {recordset:rows};
  const scoped={};
  const keys=[...new Set(rows.map(row=>Number(row.SdetailKey)))];
  if(keys.length>400 || keys.some(key=>!Number.isInteger(key)||key<=0)) throw new Error('견적 진단 상세키 범위가 올바르지 않습니다.');
  keys.forEach((key,index)=>{scoped[`sdk${index}`]={type:sql.Int,value:key};});
  const sdkIn=keys.map((_,index)=>`@sdk${index}`).join(',');
  const byKey=new Map(rows.map(row=>[Number(row.SdetailKey),row]));
  const merge=async statement=>{
    const result=await query(statement,scoped);
    for(const row of result.recordset || []) {
      const target=byKey.get(Number(row.SdetailKey));
      if(target) { const { SdetailKey, ...diagnostics }=row; Object.assign(target,diagnostics); }
    }
  };
  await merge(`SELECT sd.SdetailKey,COUNT(vs.SdetailKey) AS InViewShipment
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    LEFT JOIN ViewShipment vs ON vs.OrderYear=sm.OrderYear AND vs.CustKey=sm.CustKey
      AND vs.ProdKey=sd.ProdKey AND vs.OrderWeek=sm.OrderWeek
    WHERE sd.SdetailKey IN (${sdkIn}) GROUP BY sd.SdetailKey`);
  await merge(`SELECT sd.SdetailKey,COUNT(vo.ProdKey) AS InViewOrder
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    LEFT JOIN ViewOrder vo ON vo.OrderYear=sm.OrderYear AND vo.CustKey=sm.CustKey
      AND vo.ProdKey=sd.ProdKey AND vo.OrderWeek=sm.OrderWeek
    WHERE sd.SdetailKey IN (${sdkIn}) GROUP BY sd.SdetailKey`);
  await merge(`SELECT sd.SdetailKey,
    (SELECT TOP 1 vs.OrderYearWeek2 FROM ViewShipment vs WHERE vs.OrderYear=sm.OrderYear AND vs.SdetailKey=sd.SdetailKey) AS VS_YW2
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sd.SdetailKey IN (${sdkIn})`);
  // Preserve the native broad join and the separate strict customer/product
  // diagnostic as distinct SQL COUNTs. No deduplication or inferred visibility.
  for(const [field,strict] of [['InGetDetail',false],['InGetDetailByCustProd',true]]) {
    for(const row of rows)row[field]=0;
    await merge(`SELECT vs.SdetailKey,COUNT(*) AS ${field}
      FROM ViewShipment vs JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2
        ${strict ? 'AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey' : ''}
      JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
      JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
      WHERE vs.SdetailKey IN (${sdkIn}) AND vs.DetailFix=1 GROUP BY vs.SdetailKey`);
  }
  return {recordset:rows};
}
