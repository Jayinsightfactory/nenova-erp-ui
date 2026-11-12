import {createHash} from 'node:crypto';
import {query,sql,withTransaction} from './db';
import core from './shipmentStatement.cjs';
import store from './shipmentStatementStore.cjs';
import changes from './shipmentStatementChanges.cjs';

// One scope for list, editor and save revalidation. No detail-CustKey condition.
export const STATEMENT_SOURCE_SQL=`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.SdetailKey,sd.ProdKey,
 sd.OutQuantity,sd.Cost,p.ProdName,p.DisplayName,p.CounName,p.FlowerName,p.OutUnit
 FROM ShipmentMaster sm WITH(HOLDLOCK) JOIN ShipmentDetail sd WITH(HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c WITH(HOLDLOCK) ON c.CustKey=sm.CustKey AND c.isDeleted=0
 JOIN Product p WITH(HOLDLOCK) ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 WHERE sm.OrderYear=@year AND sm.OrderWeek LIKE @prefix AND sm.CustKey=@custKey
 AND sm.isDeleted=0 AND sd.OutQuantity>0 ORDER BY sm.OrderWeek,sd.SdetailKey`;
const params=s=>({year:{type:sql.NVarChar(4),value:s.year},prefix:{type:sql.NVarChar(10),value:String(s.week).padStart(2,'0')+'-%'},custKey:{type:sql.Int,value:s.custKey}});
export const sourceHash=source=>createHash('sha256').update(JSON.stringify(source)).digest('hex');
export async function loadStatementSource(input,q=query){
 const s=core.scope(input);if(!s.custKey)throw core.fail('업체를 선택하세요.');
 const p=params(s);
 const customer=(await q(`SELECT CustKey,CustName,Manager,BaseOutDay FROM Customer WITH(HOLDLOCK) WHERE CustKey=@custKey AND isDeleted=0`,{custKey:p.custKey})).recordset[0];
 if(!customer)throw core.fail('활성 업체를 찾지 못했습니다.',404);
 const dates=(await q(`SELECT WeekDay,CONVERT(varchar(10),CONVERT(datetime,BaseYmd,121),120) Date FROM PeriodDay WITH(HOLDLOCK) WHERE OrderYearWeek=@ywk ORDER BY BaseYmd`,{ywk:{type:sql.NVarChar(10),value:s.year+String(s.week).padStart(2,'0')}})).recordset;
 const rows=core.sourceRows((await q(STATEMENT_SOURCE_SQL,p)).recordset,s);
 return {scope:s,customer:{custKey:customer.CustKey,name:customer.CustName,manager:customer.Manager||'',baseDay:core.BASE_DAYS[customer.BaseOutDay]??'일'},calendar:core.calendar(dates),rows};
}
export async function listStatementCustomers(input,q=query){
 const s=core.scope(input),p=params(s);
 const r=await q(`SELECT c.CustKey,c.CustName,ISNULL(c.Manager,'') Manager,COUNT(*) DetailCount
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN Customer c ON c.CustKey=sm.CustKey AND c.isDeleted=0 JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
 WHERE sm.OrderYear=@year AND sm.OrderWeek LIKE @prefix AND sm.isDeleted=0 AND sd.OutQuantity>0
 GROUP BY c.CustKey,c.CustName,c.Manager ORDER BY c.CustName`,{year:p.year,prefix:p.prefix});return r.recordset;
}
export async function openStatement(input){
 const s=core.scope(input),source=await withTransaction(q=>loadStatementSource(s,q),{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
 const saved=await store.read(s),pref=saved?.draft??await store.latestPreferences(s.custKey)??{defaultDay:source.customer.baseDay,groups:[]};
 const hash=sourceHash(source);
 // 원본이 바뀌었으면 바뀐 내용 목록을 만들고, 바뀌지 않은 품목의 요일 배분은 그대로 이어 붙인다(수량 어긋남 방지).
 const changed=!!saved&&saved.sourceHash!==hash,merged=changed?changes.reconcile(saved,source):null;
 return {source,sourceHash:hash,version:saved?.version??0,saved,stale:false,changes:merged?.changes??[],draft:merged?.draft??saved?.draft??{...pref,entries:{}}};
}
export async function saveStatement(input,body,user){
 const s=core.scope(input);
 if(typeof body.sourceHash!=='string'||!Number.isSafeInteger(body.expectedVersion))throw core.fail('조회한 원본과 저장 버전이 필요합니다.');
 return withTransaction(async q=>{
  const source=await loadStatementSource(s,q),hash=sourceHash(source);
  if(hash!==body.sourceHash)throw core.fail('차수피벗 분배수량·단가·기본정보가 변경됐습니다. 다시 불러온 뒤 변경분을 검토하세요.',409);
  if(!source.rows.length)throw core.fail('저장할 분배 품목이 없습니다.');
  const draft=core.validatePlan(source.rows,body.draft);
  return store.save(s,{source,sourceHash:hash,draft},body.expectedVersion,user.userId);
 },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE,retries:0});
}
