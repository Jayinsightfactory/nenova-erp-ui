import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { jugwangUploadScope, checkJugwangExisting } from './jugwangWeekdayUpload.js';
import { shipmentUnitsFromUserInput } from './distributeUnits.js';
import { readActualScope, readWeekdayCalendar, executeWeekdayDistributionApply, weekdaySnapshotDigest, checkPositiveStock, assertWeekdayAuditSchema, assertExactProductConversion } from './weekdayDistributionApply.js';
import { prepareWeekdayAllocation } from './weekdayAllocation.js';
import { buildWeekdayChangePlan } from './weekdayDistributionPolicy.js';
import { acquireErpEditLease, advanceErpEditGuard, assertErpEditGuard, releaseErpEditLease } from './erpEditPresence.js';
import { assertDirectionalGateCapability, lockDirectionalGate } from './estimateDirectionalQuantity.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
export function signJugwang(value,userId,kind,secret=process.env.JWT_SECRET) {
  if(!secret) fail('검증 서명 설정을 확인하세요.');
  const body=Buffer.from(JSON.stringify({value,userId,kind,expires:Date.now()+20*60*1000})).toString('base64url');
  return `${body}.${createHmac('sha256',secret).update(`jugwang-upload:${body}`).digest('hex')}`;
}
export function verifyJugwang(token,userId,kind,secret=process.env.JWT_SECRET) {
  if(!secret || typeof token!=='string' || token.length>2_000_000) fail('원본을 다시 분석하세요.');
  const [body,sig,extra]=token.split('.');
  const expected=createHmac('sha256',secret).update(`jugwang-upload:${body}`).digest('hex');
  if(extra||!/^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) fail('원본 검증 정보가 변경됐습니다.');
  const record=JSON.parse(Buffer.from(body,'base64url').toString());
  if(record.userId!==userId || record.kind!==kind || record.expires<Date.now()) fail('검증이 만료되었거나 사용자·단계가 다릅니다.');
  return record.value;
}
export async function readJugwangOrders(q,sql,scope) {
  const headers=await q(`SELECT ShipmentKey,isDeleted FROM ShipmentMaster WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck`,{yr:{type:sql.NVarChar,value:scope.year},wk:{type:sql.NVarChar,value:scope.orderWeek},ck:{type:sql.Int,value:533}});
  if(headers.recordset.length>1 || headers.recordset.some(r=>r.isDeleted)) fail('삭제 또는 중복 출고 헤더를 먼저 확인하세요.');
  return (await q(`SELECT om.OrderMasterKey,om.Manager,od.OrderDetailKey,od.ProdKey,
    od.OutQuantity,od.BoxQuantity,od.BunchQuantity,od.SteamQuantity,od.EstQuantity,
    p.ProdName,p.DisplayName,p.FlowerName,p.CountryFlower,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box
    FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
    JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
    JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
    WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
    ORDER BY od.OrderDetailKey`,{yr:{type:sql.NVarChar,value:scope.year},wk:{type:sql.NVarChar,value:scope.orderWeek},ck:{type:sql.Int,value:533}})).recordset;
}
function prepareInputs(source,selections,orders) {
  if(!Array.isArray(selections)||!selections.length||selections.length>200) fail('반영할 원본 행을 선택하세요.');
  const seen=new Set(), grouped=new Map();
  for(const chosen of selections) {
    const row=source.rows.find(r=>r.id===chosen.id);
    if(!row||seen.has(chosen.id)) fail('원본 행이 없거나 중복입니다.');seen.add(chosen.id);
    const matches=orders.filter(o=>o.ProdKey===Number(chosen.prodKey)&&Number(o.OutQuantity)>0);
    if(matches.length!==1) fail(`${row.label}: 해당 연도·차수의 활성 주문을 하나로 지정하세요.`);
    const product=matches[0], unit=chosen.unit;
    if(!['박스','단','송이'].includes(unit)) fail(`${row.label}: 원본 단위를 선택하세요.`);
    if(!String(product.FlowerName||product.CountryFlower).includes(row.category)) fail(`${row.label}: 다른 품종으로 연결할 수 없습니다.`);
    const current=grouped.get(product.ProdKey)||{...source.scope,prodKey:product.ProdKey,unit:product.OutUnit,dates:[],label:row.label};
    for(const entry of row.dates) {
      const converted=shipmentUnitsFromUserInput(entry.quantity,unit,product);
      const represented=unit==='박스'?converted.box:unit==='단'?converted.bunch:converted.steam;
      if(!(converted.outQuantity>0)||Math.abs(represented-entry.quantity)>1e-6) fail(`${row.label}: 단위 환산을 확인하세요.`);
      const existing=current.dates.find(d=>d.date===entry.date);
      if(existing) existing.quantity+=converted.outQuantity;
      else current.dates.push({date:entry.date,quantity:converted.outQuantity});
    }
    grouped.set(product.ProdKey,current);
  }
  return [...grouped.values()].map(c=>({...c,dates:c.dates.sort((a,b)=>a.date.localeCompare(b.date))}));
}
export async function previewJugwang(q,sql,source,selections) {
  jugwangUploadScope(source.scope.year,source.scope.orderWeek);
  if(source.warnings.length) fail('원본 수식·합계·수량 경고를 먼저 해결하세요.');
  await assertDirectionalGateCapability(q);
  await assertWeekdayAuditSchema(q);
  const orders=await readJugwangOrders(q,sql,source.scope);
  const changes=prepareInputs(source,selections,orders), statuses=[],plans=[];
  for(const change of changes) {
    const actual=await readActualScope(q,sql,change,{mode:'ALLOCATION'});
    const order=orders.find(o=>o.ProdKey===change.prodKey);
    const status=checkJugwangExisting(change,actual,Number(order.OutQuantity));
    change.expected={detailRows:actual.detailRows,shipmentOutQuantity:actual.shipmentOutQuantity,shipmentDates:actual.shipmentDates,snapshotDigest:weekdaySnapshotDigest(change,actual)};
    const calendar=await readWeekdayCalendar(q,sql,change,actual);
    plans.push(buildWeekdayChangePlan(change,actual,calendar,{mode:'ALLOCATION'}));
    statuses.push({prodKey:change.prodKey,label:change.label,status,orderQuantity:Number(order.OutQuantity),total:change.dates.reduce((sum,d)=>sum+d.quantity,0),unit:change.unit,dates:change.dates});
  }
  await prepareWeekdayAllocation(q,sql,plans,'preview-unused-existing-order');
  for(const plan of plans) for(const day of plan.change.dates) assertExactProductConversion(plan,day.quantity);
  await checkPositiveStock(q,sql,plans);
  return {scope:source.scope,operationId:randomUUID(),changes,statuses,orderDigest:hash(orders),sourceHash:source.sourceHash};
}
export async function applyJugwang(q,sql,plan,user) {
  const newChanges=plan.changes.filter(c=>plan.statuses.find(s=>s.prodKey===c.prodKey)?.status==='NEW');
  let before;
  async function recheck() {
    before=await readJugwangOrders(q,sql,plan.scope);
    if(hash(before)!==plan.orderDigest) fail('검증 이후 주문 또는 품목 정보가 바뀌었습니다. 다시 검증하세요.');
    for(const change of plan.changes) {
      const actual=await readActualScope(q,sql,change,{mode:'ALLOCATION'});
      if(weekdaySnapshotDigest(change,actual)!==change.expected.snapshotDigest) fail('검증 이후 분배가 변경되었습니다. 다시 검증하세요.');
      checkJugwangExisting(change,actual,Number(before.find(o=>o.ProdKey===change.prodKey)?.OutQuantity));
    }
  }
  let result;
  if(!newChanges.length) {await recheck();result={success:true,appliedCount:0,changes:[]};}
  else result=await executeWeekdayDistributionApply(q,sql,{
    operationId:plan.operationId,custKey:533,mode:'ALLOCATION',reason:`주광 원본 요일 업로드 ${plan.sourceHash}`,changes:newChanges,
  },user,{
    // No automatic confirmation: existing allocations are identical no-ops only.
    assertGateCapability:assertDirectionalGateCapability,lockGate:lockDirectionalGate,
    acquireEditLease:acquireErpEditLease,assertEditGuard:assertErpEditGuard,
    advanceEditGuard:advanceErpEditGuard,releaseEditLease:releaseErpEditLease,
    beforePrepare:recheck,
  });
  const after=await readJugwangOrders(q,sql,plan.scope);
  if(hash(after)!==plan.orderDigest) fail('주문 보존 검증에 실패하여 전체 롤백합니다.');
  return {...result,orderPreserved:true,unchangedCount:plan.changes.length-newChanges.length};
}
