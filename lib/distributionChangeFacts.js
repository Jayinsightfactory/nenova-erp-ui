// SELECT-only source adapter. Missing native history never proves an omitted operation.
const SCOPE_RE=/^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
function validateAuditScope({year,week,combined=false,from,to}) {
 if(!/^20\d{2}$/.test(String(year))||!SCOPE_RE.test(String(week)))throw Error('비교할 연도와 세부차수를 선택하세요.');
 const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 if(!valid(from)||!valid(to)||Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>6*86400000)throw Error('비교 기간은 최대 7일로 선택하세요.');
 if(combined!==false&&combined!==true)throw Error('합산 조회 설정을 확인하세요.');
 if(combined&&!week.endsWith('-02'))throw Error('01·02 합산은 02차를 선택하세요.');
 return {year:String(year),weeks:combined?[`${week.slice(0,2)}-01`,week]:[week],from,to};
}
async function loadDistributionChangeFacts(query,sql,scope) {
 const params={year:{type:sql.NVarChar,value:scope.year},w1:{type:sql.NVarChar,value:scope.weeks[0]},w2:{type:sql.NVarChar,value:scope.weeks[1]||scope.weeks[0]},from:{type:sql.NVarChar,value:scope.from},to:{type:sql.NVarChar,value:scope.to}};
 const [customers,products,history,current,orphans]=await Promise.all([
  query('SELECT CustKey,CustName FROM Customer WHERE ISNULL(isDeleted,0)=0'),
  query('SELECT ProdKey,ProdName,DisplayName,OutUnit,BunchOf1Box,SteamOf1Box FROM Product WHERE ISNULL(isDeleted,0)=0'),
  query(`SELECT TOP 10001 h.ShipHistoryKey AS eventId,m.OrderYear AS year,m.OrderWeek AS week,m.CustKey AS custKey,d.ProdKey AS prodKey,
    CONVERT(varchar(23),h.ChangeDtm,126) AS changeLocal,CONVERT(varchar(10),h.ShipmentDtm,23) AS shipmentDate,
    h.BeforeValue AS before,h.AfterValue AS after,h.ChangeType AS changeType,h.Descr AS descr,p.OutUnit AS unit,
    (SELECT COUNT(*) FROM ShipmentDate dates WHERE dates.SdetailKey=d.SdetailKey) AS dateCount
    FROM ShipmentHistory h JOIN ShipmentDetail d ON d.SdetailKey=h.SdetailKey JOIN ShipmentMaster m ON m.ShipmentKey=d.ShipmentKey JOIN Product p ON p.ProdKey=d.ProdKey
    WHERE m.OrderYear=@year AND m.OrderWeek IN (@w1,@w2) AND h.ChangeDtm>=CONVERT(datetime,@from,126) AND h.ChangeDtm<DATEADD(day,1,CONVERT(datetime,@to,126))
    ORDER BY h.ChangeDtm,h.ShipHistoryKey`,params),
  query(`SELECT TOP 10001 v.OrderYear AS year,v.OrderWeek AS week,v.CustKey AS custKey,v.ProdKey AS prodKey,v.SdetailKey,
    d.SdateKey,CONVERT(varchar(10),d.ShipmentDtm,23) AS shipmentDate,d.ShipmentQuantity AS qty,p.OutUnit AS unit
    FROM ViewShipment v JOIN Product p ON p.ProdKey=v.ProdKey LEFT JOIN ShipmentDate d ON d.SdetailKey=v.SdetailKey
    WHERE v.OrderYear=@year AND v.OrderWeek IN (@w1,@w2) ORDER BY v.SdetailKey,d.SdateKey`,params),
  query(`SELECT COUNT_BIG(*) AS count FROM ShipmentHistory h LEFT JOIN ShipmentDetail d ON d.SdetailKey=h.SdetailKey
    WHERE d.SdetailKey IS NULL AND h.ChangeDtm>=CONVERT(datetime,@from,126) AND h.ChangeDtm<DATEADD(day,1,CONVERT(datetime,@to,126))`,params)
 ]);
 return {customers:customers.recordset,products:products.recordset,
  history:history.recordset.slice(0,10000).map(h=>({...h,eventId:String(h.eventId),changeAt:`${h.changeLocal}+09:00`,unit:h.descr&&Number(h.dateCount)>1?null:h.unit})),
  currentRows:current.recordset.slice(0,10000),historyComplete:false,
  unscopedOrphanHistoryCount:Number(orphans.recordset[0]?.count||0),
  warnings:['이력은 확정 시 기록되거나 원본 출고행 삭제로 연결이 끊길 수 있습니다. 대응 이력이 없다는 이유만으로 미처리라고 단정하지 않습니다.',...(Number(orphans.recordset[0]?.count)>0?[`이 기간 전체 전산에 원본 출고행이 없는 이력 ${Number(orphans.recordset[0].count)}건이 있습니다. 연도·차수·업체를 특정할 수 없어 이번 요청의 미처리 근거로 사용하지 않습니다.`]:[]),...(history.recordset.length>10000||current.recordset.length>10000?['조회량이 많아 일부 자료만 표시했습니다. 기간을 좁혀 다시 비교하세요.']:[])]};
}
module.exports={validateAuditScope,loadDistributionChangeFacts};
