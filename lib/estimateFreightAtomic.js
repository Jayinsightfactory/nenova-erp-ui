import crypto from 'node:crypto';
import { isFreightProductName } from './estimateFreightApply.js';
import { distributeUnits, amountVatFromCostEst } from './distributeUnits.js';
import { safeNextKey, syncKeyNumbering } from './safeNextKey.js';
import { assertDirectionalGateCapability, lockDirectionalGate, assertNativeResult } from './estimateDirectionalQuantity.js';
import { assertErpEditGuard, advanceErpEditGuard } from './erpEditPresence.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { const e = new Error(message); e.code = 'FREIGHT_VALIDATION'; e.statusCode = 409; throw e; };
const fixed = value => value === true || value === 1;
const day = value => value ? new Date(value).toISOString().slice(0,10) : '';
const equal = (a,b) => Math.abs(Number(a)-Number(b)) < 0.000001;
const finite = value => value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value));

export function normalizeFreightRequest(body = {}) {
  const year = String(body.year ?? '');
  const parentWeek = String(body.parentWeek ?? '').padStart(2,'0');
  const custKey = Number(body.custKey);
  if (!/^\d{4}$/.test(year) || Number(year)<=2025 || !/^\d{2}$/.test(parentWeek) || Number(parentWeek)<1 || Number(parentWeek)>53 || !Number.isInteger(custKey) || custKey<=0) fail('운임 연도·차수·업체를 확인하세요.');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length>40) fail('운임은 1~40건씩 등록하세요.');
  const seen = new Set();
  const rows = body.rows.map(r=>{
    const week = String(r.weekShort ?? '');
    const prodKey = Number(r.prodKey), qty = Number(r.qty), cost = Number(r.cost);
    if (!new RegExp(`^${parentWeek}-0[1-3]$`).test(week) || !Number.isInteger(prodKey) || prodKey<=0) fail('운임 저장 범위가 선택 견적과 다릅니다.');
    if (!finite(r.qty) || !finite(r.cost) || qty<=0 || cost<=0 || qty>1000000 || cost>100000000 || !equal(qty,Math.round(qty*1000)/1000)) fail('운임 수량·단가를 확인하세요. 수량은 소수 셋째 자리까지 지원합니다.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.shipmentDate))) fail('운임 출고일을 확인하세요.');
    if (r.combined !== undefined && typeof r.combined !== 'boolean') fail('합산 선택값을 확인하세요.');
    if (r.combined && week!==`${parentWeek}-01`) fail('합산 운임은 01차를 대상으로 확인하세요.');
    const key = `${week}|${prodKey}`;
    if (seen.has(key)) fail('같은 차수·운임이 중복되었습니다.');
    seen.add(key);
    return {week,prodKey,qty,cost,shipmentDate:r.shipmentDate,combined:r.combined===true};
  });
  if(rows.some(r=>r.combined && rows.some(other=>other!==r && other.prodKey===r.prodKey))) fail('합산 운임과 같은 품목의 분리 운임을 함께 등록할 수 없습니다.');
  return {year,parentWeek,custKey,rows};
}

export function freightOperationId(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) fail('운임 작업번호를 확인하세요.');
  return String(value);
}

function params(sql, input, row = {}) {
  return {yr:{type:sql.NVarChar,value:input.year}, parent:{type:sql.NVarChar,value:input.parentWeek},
    ck:{type:sql.Int,value:input.custKey},wk:{type:sql.NVarChar,value:row.week || ''},pk:{type:sql.Int,value:row.prodKey || 0}};
}

export async function readFreightReceipt(tQ,sql,input,userId,operationId) {
  freightOperationId(operationId);
  const r=await tQ(`SELECT Payload FROM SystemActionLog WHERE ActionType=N'ESTIMATE_FREIGHT_FINAL' AND SessionId=@op AND Actor=@uid AND Result=N'SUCCESS'`,{
    op:{type:sql.NVarChar,value:operationId},uid:{type:sql.NVarChar,value:userId}});
  if (!r.recordset.length) return null;
  if (r.recordset.length!==1) fail('운임 작업 이력이 중복되어 확인이 필요합니다.');
  const saved=JSON.parse(r.recordset[0].Payload);
  if (input && saved.requestHash!==digest(input)) fail('동일 작업번호로 다른 운임을 등록할 수 없습니다.');
  return saved.result;
}

/** Shared preview/apply authority. No writes and no simulated production save. */
export async function prepareFreight(tQ,sql,input) {
  const base=params(sql,input);
  const customer=(await tQ(`SELECT CustName,Manager,OrderCode FROM Customer WITH (UPDLOCK,HOLDLOCK) WHERE CustKey=@ck AND isDeleted=0`,base)).recordset;
  if (customer.length!==1) fail('활성 업체를 확인하지 못했습니다.');
  const source=(await tQ(`SELECT sm.ShipmentKey,sm.OrderWeek,sm.isFix AS MasterFix,sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.Cost,sd.isFix,
      d.SdateKey,d.ShipmentDtm,d.ShipmentQuantity,d.EstQuantity,d.Cost AS DateCost
    FROM ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) JOIN ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
    LEFT JOIN ShipmentDate d WITH (UPDLOCK,HOLDLOCK) ON d.SdetailKey=sd.SdetailKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @parent+N'-%' AND sm.CustKey=@ck AND sm.isDeleted=0
    ORDER BY sm.ShipmentKey,sd.SdetailKey,d.SdateKey`,base)).recordset;
  const plan=[];
  for (const row of input.rows) {
    const p=params(sql,input,row);
    const products=(await tQ(`SELECT ProdKey,ProdName,CountryFlower,OutUnit,EstUnit,BunchOf1Box,SteamOf1Box,SteamOf1Bunch,Stock
      FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0`,p)).recordset;
    const product=products[0];
    if (products.length!==1 || !isFreightProductName(product.ProdName) || product.OutUnit!=='박스' || product.EstUnit!=='박스') fail('박스 출고·견적 단위의 활성 운임 품목만 등록할 수 있습니다.');
    if(row.combined && product.ProdName.trim()!=='카네이션 운송료') fail('1·2차 합산은 카네이션 운송료만 지원합니다.');
    const masters=(await tQ(`SELECT ShipmentKey,isFix FROM ShipmentMaster WITH (UPDLOCK,HOLDLOCK)
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND isDeleted=0 AND OrderYearWeek=@yr+@parent`,p)).recordset;
    if(masters.length!==1 || !fixed(masters[0].isFix)) fail(`${row.week} ${product.ProdName}: 기존 업체 출고마스터가 없거나 미확정·중복 상태입니다.`);
    const matches=source.filter(s=>s.OrderWeek===row.week && s.ProdKey===row.prodKey);
    if(matches.length>1) fail(`${row.week} ${product.ProdName}: 기존 운임에 여러 출고행/출고일이 있습니다. 견적서에서 날짜별로 확인하세요.`);
    const existing=matches[0];
    if(existing && (!existing.SdateKey || !fixed(existing.isFix) || !equal(existing.OutQuantity,existing.ShipmentQuantity) || !(existing.OutQuantity>0))) fail(`${product.ProdName}: 기존 운임 수량·날짜·확정 상태가 불완전합니다.`);
    if(row.combined && source.some(s=>s.OrderWeek===`${input.parentWeek}-02` && s.ProdKey===row.prodKey)) fail(`${product.ProdName}: 02차에 기존 운임이 있어 자동 합산하면 중복 청구됩니다. 합산을 해제하고 기존 운임을 확인하세요.`);
    const shipmentDate=existing?day(existing.ShipmentDtm):row.shipmentDate;
    if(!existing && !source.some(s=>s.OrderWeek===row.week && day(s.ShipmentDtm)===shipmentDate)) fail(`${row.week} ${product.ProdName}: 선택 출고일에 기존 업체 출고가 없습니다.`);
    const dates=(await tQ(`SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yr+@parent AND CONVERT(varchar(10),BaseYmd,23)=@dt`,{...p,dt:{type:sql.NVarChar,value:shipmentDate}})).recordset;
    if(dates.length!==1 || (existing && new Date(dates[0].BaseYmd).getTime()!==new Date(existing.ShipmentDtm).getTime())) fail(`${product.ProdName}: 전산 출고일 달력과 일치하지 않습니다.`);
    const orders=(await tQ(`SELECT om.OrderMasterKey,od.OrderDetailKey,od.OutQuantity FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
      LEFT JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND od.isDeleted=0
      WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND om.isDeleted=0 ORDER BY om.OrderMasterKey`,p)).recordset;
    const active=orders.filter(o=>o.OrderDetailKey);
    if(active.length>1 || active.some(o=>!(Number(o.OutQuantity)>0))) fail(`${product.ProdName}: 기존 주문이 중복 또는 0수량입니다. 원장을 확인하세요.`);
    if(!active.length && (await tQ(`SELECT UserID FROM UserInfo WHERE UserID=@manager`,{manager:{type:sql.NVarChar,value:customer[0].Manager}})).recordset.length!==1) fail('업체 담당자의 전산 계정이 없어 주문을 생성할 수 없습니다.');
    if(existing && (await tQ(`SELECT FarmKey FROM ShipmentFarm WHERE SdetailKey=@sdk`,{sdk:{type:sql.Int,value:existing.SdetailKey}})).recordset.length) fail(`${product.ProdName}: 농장 분배가 있는 운임은 자동 변경하지 않습니다.`);
    plan.push({...row,product,shipmentDate,shipmentDtm:dates[0].BaseYmd,master:masters[0],existing,
      orderMasterKey:orders[0]?.OrderMasterKey,needsOrder:!active.length,oldQty:Number(existing?.OutQuantity??0),oldCost:Number(existing?.DateCost??0)});
  }
  return {plan,customer:customer[0],planHash:digest({input,source,plan,customer})};
}

export async function writeFreightRows(tQ,sql,input,prepared,userId) {
  const uid={type:sql.NVarChar,value:userId};
  const column=(await tQ(`SELECT COLUMNPROPERTY(OBJECT_ID(N'OrderMaster'),N'OrderYearWeek','IsComputed') AS computed`)).recordset[0];
  const writeYearWeek=column?.computed===0;
  for(const row of prepared.plan) {
    const p={...params(sql,input,row),uid,dt:{type:sql.DateTime,value:row.shipmentDtm}};
    const units=distributeUnits(row.qty,row.product),money=amountVatFromCostEst(row.cost,units.estQty);
    const values={...p,q:{type:sql.Float,value:row.qty},box:{type:sql.Float,value:units.box},bunch:{type:sql.Float,value:units.bunch},steam:{type:sql.Float,value:units.steam},est:{type:sql.Float,value:units.estQty},cost:{type:sql.Float,value:row.cost},amount:{type:sql.Float,value:money.amount},vat:{type:sql.Float,value:money.vat}};
    if(row.needsOrder) {
      let mk=row.orderMasterKey;
      if(!mk) {
        mk=await safeNextKey(tQ,'OrderMaster','OrderMasterKey');
        await tQ(`INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,${writeYearWeek?'OrderYearWeek,':''}Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
          VALUES (@mk,GETDATE(),@yr,@wk,${writeYearWeek?'@yr+@parent,':''}@manager,@ck,@code,N'',0,@uid,GETDATE(),@uid,GETDATE())`,{...values,mk:{type:sql.Int,value:mk},manager:{type:sql.NVarChar,value:prepared.customer.Manager},code:{type:sql.NVarChar,value:prepared.customer.OrderCode||''}});
        await syncKeyNumbering(tQ,'OrderMasterKey','OrderMaster','OrderMasterKey');
      }
      const dk=await safeNextKey(tQ,'OrderDetail','OrderDetailKey');
      await tQ(`INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
        VALUES (@dk,@mk,@pk,@box,@bunch,@steam,@q,@est,0,N'견적 운임 등록',0,@uid,GETDATE(),@uid,GETDATE())`,{...values,dk:{type:sql.Int,value:dk},mk:{type:sql.Int,value:mk}});
      await syncKeyNumbering(tQ,'OrderDetailKey','OrderDetail','OrderDetailKey');
      await tQ(`INSERT INTO OrderHistory (OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
        VALUES (@dk,N'신규',N'수량',N'0',@after,N'견적 운임 등록',@uid,GETDATE())`,{...values,dk:{type:sql.Int,value:dk},after:{type:sql.NVarChar,value:String(row.qty)}});
    }
    let sdk=row.existing?.SdetailKey;
    if(sdk) {
      await tQ(`UPDATE sd SET OutQuantity=@q,BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,EstQuantity=@est,Cost=@cost,Amount=@amount,Vat=@vat
        FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sm.isDeleted=0 AND sd.ProdKey=@pk AND sd.SdetailKey=@sdk;
        UPDATE ShipmentDate SET ShipmentQuantity=@q,EstQuantity=@est,Cost=@cost,Amount=@amount,Vat=@vat WHERE SdetailKey=@sdk AND SdateKey=@dateKey`,{...values,sdk:{type:sql.Int,value:sdk},dateKey:{type:sql.Int,value:row.existing.SdateKey}});
    } else {
      sdk=await safeNextKey(tQ,'ShipmentDetail','SdetailKey');
      await tQ(`INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
        VALUES (@sdk,@sk,@ck,@pk,@dt,@q,@box,@bunch,@steam,@est,@cost,@amount,@vat,1,N'',N'');
        INSERT INTO ShipmentDate (SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        VALUES (@sdk,@dt,@q,@est,@cost,@amount,@vat,N'')`,{...values,sdk:{type:sql.Int,value:sdk},sk:{type:sql.Int,value:row.master.ShipmentKey}});
      await syncKeyNumbering(tQ,'ShipmentDetailKey','ShipmentDetail','SdetailKey');
    }
    row.savedKey=sdk;
    if(!equal(row.oldQty,row.qty)) {
      await tQ(`INSERT INTO StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
        SELECT GETDATE(),@yr,@wk,@uid,N'출고',N'수량',Stock,Stock-@delta,N'견적 운임 최종수량',ProdKey FROM Product WHERE ProdKey=@pk;
        UPDATE Product SET Stock=Stock-@delta WHERE ProdKey=@pk`,{...values,delta:{type:sql.Float,value:row.qty-row.oldQty}});
      await tQ(`INSERT INTO ShipmentHistory (ChangeDtm,ChangeID,ChangeType,ShipmentDtm,BeforeValue,AfterValue,Descr,SdetailKey)
        VALUES (GETDATE(),@uid,@kind,@dt,@before,@q,N'견적 운임 최종수량',@sdk)`,{...values,kind:{type:sql.NVarChar,value:row.existing?'수정':'신규'},before:{type:sql.Float,value:row.oldQty},sdk:{type:sql.Int,value:sdk}});
    }
  }
}

export async function finishFreight(tQ,sql,input,prepared,userId) {
  const calc=new Map();
  for(const r of prepared.plan.filter(r=>!equal(r.oldQty,r.qty))) if(!calc.has(r.prodKey)||calc.get(r.prodKey).week>r.week) calc.set(r.prodKey,r);
  for(const r of calc.values()) {
    const p={...params(sql,input,r),uid:{type:sql.NVarChar,value:userId},ywk:{type:sql.NVarChar,value:input.year+r.week.replace('-','')}};
    assertNativeResult(await tQ(`DECLARE @r int,@m nvarchar(max),@rc int;
      EXEC @rc=dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
      SELECT @rc AS returnCode,@r AS result,@m AS message,XACT_STATE() AS TransactionState`,p));
    if(prepared.plan.some(item=>item.prodKey===r.prodKey && item.qty>item.oldQty)) {
      const negatives=(await tQ(`SELECT TOP 1 sm.OrderYear,sm.OrderWeek,ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
        WHERE ps.ProdKey=@pk AND sm.OrderYearWeek>=@ywk AND ROUND(ps.Stock,3)<0 ORDER BY sm.OrderYearWeek`,p)).recordset;
      if(negatives.length) fail(`${r.product.ProdName}: ${negatives[0].OrderYear} ${negatives[0].OrderWeek} 재고 ${negatives[0].Stock}. 전체 운임을 저장하지 않았습니다.`);
    }
  }
  for(const r of prepared.plan) {
    const v=(await tQ(`SELECT vs.OutQuantity,vs.EstQuantity AS DetailEst,vs.BoxQuantity,vs.BunchQuantity,vs.SteamQuantity,vs.DetailFix,vs.Cost,vs.Amount,vs.Vat,d.ShipmentDtm,d.ShipmentQuantity,d.EstQuantity,d.Cost AS DateCost,d.Amount AS DateAmount,d.Vat AS DateVat,
      (SELECT COUNT(*) FROM ViewOrder vo WHERE vo.OrderYear=@yr AND vo.OrderWeek=@wk AND vo.CustKey=@ck AND vo.ProdKey=@pk) AS OrderCount
      FROM ViewShipment vs JOIN ShipmentDate d ON d.SdetailKey=vs.SdetailKey JOIN PeriodDay pd ON d.ShipmentDtm=pd.BaseYmd
      WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.OrderYearWeek=@yr+@parent AND vs.CustKey=@ck AND vs.ProdKey=@pk AND vs.SdetailKey=@sdk`,{...params(sql,input,r),sdk:{type:sql.Int,value:r.savedKey}})).recordset;
    const expected=amountVatFromCostEst(r.cost,distributeUnits(r.qty,r.product).estQty);
    const units=distributeUnits(r.qty,r.product);
    if(v.length!==1 || !fixed(v[0].DetailFix) || Number(v[0].OrderCount)!==1 || !equal(v[0].OutQuantity,r.qty) || !equal(v[0].ShipmentQuantity,r.qty) || !equal(v[0].Cost,r.cost) || !equal(v[0].DateCost,r.cost)
      || !equal(v[0].Amount,expected.amount) || !equal(v[0].Vat,expected.vat) || !equal(v[0].DateAmount,expected.amount) || !equal(v[0].DateVat,expected.vat)
      || !equal(v[0].DetailEst,units.estQty) || !equal(v[0].EstQuantity,units.estQty) || !equal(v[0].BoxQuantity,units.box) || !equal(v[0].BunchQuantity,units.bunch) || !equal(v[0].SteamQuantity,units.steam) || day(v[0].ShipmentDtm)!==r.shipmentDate) fail(`${r.product.ProdName}: 전산 주문·분배·견적 대조가 일치하지 않아 전체 롤백합니다.`);
  }
}

export async function executeFreight(tQ,sql,body,user) {
  const input=normalizeFreightRequest(body),scope={orderYear:input.year,orderWeek:input.parentWeek,custKey:input.custKey};
  if(!['preview','apply'].includes(body.mode)) fail('운임 처리 모드를 확인하세요.');
  if(body.mode==='apply') {
    freightOperationId(body.operationId);
    const saved=await readFreightReceipt(tQ,sql,input,user.userId,body.operationId);
    if(saved) return {...saved,replayed:true};
    if(body.confirmed!==true || !body.planHash) fail('변경 전·후 운임을 먼저 확인하세요.');
  }
  await assertDirectionalGateCapability(tQ);
  await lockDirectionalGate(tQ);
  // A concurrent request may have committed while this request waited for the gate.
  if(body.mode==='apply') {
    const saved=await readFreightReceipt(tQ,sql,input,user.userId,body.operationId);
    if(saved) return {...saved,replayed:true};
  }
  await assertErpEditGuard(tQ,scope,user,body);
  const prepared=await prepareFreight(tQ,sql,input);
  const preview=prepared.plan.map(r=>({prodKey:r.prodKey,prodName:r.product.ProdName,week:r.week,shipmentDate:r.shipmentDate,oldQty:r.oldQty,qty:r.qty,oldCost:r.oldCost,cost:r.cost,action:r.existing?'최종값 수정':'신규 등록'}));
  if(body.mode==='apply' && prepared.planHash!==body.planHash) fail('미리보기 후 원장이 바뀌었습니다. 변경 전·후 내용을 다시 확인하세요.');
  const changed=prepared.plan.some(r=>!equal(r.oldQty,r.qty));
  if(changed) {
    if((await tQ(`SELECT TOP 1 StockKey FROM StockMaster WHERE TRY_CONVERT(int,OrderYear)>TRY_CONVERT(int,@yr)`,params(sql,input))).recordset.length) fail('다음 연도 재고가 있어 이 연도의 운임 수량 자동 변경을 중단했습니다.');
    if((await tQ(`SELECT Descr FROM CodeInfo WHERE Category=N'StockType' AND Descr=N'출고'`)).recordset.length) fail('재고 조정 유형에 출고가 포함돼 있어 안전한 순증감 계산을 할 수 없습니다.');
    const increases=new Map();
    for(const r of prepared.plan) increases.set(r.prodKey,(increases.get(r.prodKey)||0)+Math.max(0,r.qty-r.oldQty));
    for(const r of prepared.plan) if(!finite(r.product.Stock) || Number(r.product.Stock)<increases.get(r.prodKey)) fail(`${r.product.ProdName}: 현재 재고가 운임 증가분보다 부족합니다. 강제 등록하지 않았습니다.`);
  }
  if(body.mode==='preview') return {success:true,preview:true,planHash:prepared.planHash,rows:preview};
  await writeFreightRows(tQ,sql,input,prepared,user.userId);
  await finishFreight(tQ,sql,input,prepared,user.userId);
  await advanceErpEditGuard(tQ,scope,user,body);
  const result={success:true,verified:true,atomic:true,operationId:body.operationId,rows:preview,count:preview.length};
  await tQ(`INSERT INTO SystemActionLog (Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
    VALUES (@uid,@op,N'ESTIMATE_FREIGHT_FINAL',N'POST',N'/api/estimate/freight-register',N'OrderDetail/ShipmentDetail/ShipmentDate',@count,@payload,N'SUCCESS',N'운임 최종값 원자적 저장',N'HIGH')`,{
    uid:{type:sql.NVarChar,value:user.userId},op:{type:sql.NVarChar,value:body.operationId},count:{type:sql.Int,value:result.count},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({requestHash:digest(input),result})}});
  return result;
}
