import crypto from 'node:crypto';
import { normalizeShipmentQty as qty } from './shipmentAvailability.js';
import { shipmentUnitsFromUserInput } from './distributeUnits.js';
import { directionalQuantityError, formatDirectionalProductLabel } from './estimateDirectionalQuantity.js';
import { safeNextKey, syncKeyNumbering } from './safeNextKey.js';

const error = (message, code = 'OVERFLOW_NOT_READY') => directionalQuantityError(code, message);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = value => value === true || value === 1;
const scopeKey = row => `${row.OrderYear}|${row.OrderWeek}|${row.ProdKey}`;
const stamp = date => new Date(date).toISOString();
const number = (value, label) => {
  if (value == null || !Number.isFinite(Number(value))) throw error(`${label} 기준값이 없습니다.`);
  return Number(value);
};

export function nextEstimateSubweek(week) {
  const m = /^(\d{2})-(01|02)$/.exec(String(week));
  if (!m) throw error(`${week}차 다음 세부차수를 자동 결정할 수 없습니다. 같은 부모차수의 01→02, 02→03만 가능합니다.`);
  return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}`;
}

/** nextRemain already includes the original current-week carry, so consume it once. */
export function splitEstimateIncrease({ increase, currentRemain, nextRemain, outPerUnit = 1 }) {
  const add = number(increase, '증가수량');
  const current = qty(number(currentRemain, '현재 차수 잔량'));
  const ratio = number(outPerUnit, '단위 환산');
  if (add <= 0 || !Number.isInteger(add) || ratio <= 0) throw error('추가 견적수량은 양의 정수이며 단위 환산값이 필요합니다.');
  if (current < 0) throw error('현재 차수의 기존 잔량이 이미 음수입니다. 기존 재고부터 확인하세요.');
  const here = Math.min(add, Math.max(0, Math.floor((current + 1e-8) / ratio)));
  const there = add - here;
  if (there && qty(number(nextRemain, '다음 차수 잔량') - add * ratio) < 0) {
    throw error(`다음 차수에도 재고가 부족합니다. 추가 ${add}, 다음 차수까지 필요한 수량 ${qty(add * ratio)}, 가용 ${qty(nextRemain)}입니다.`, 'OVERFLOW_STOCK_SHORTAGE');
  }
  return { currentIncrease: here, nextIncrease: there, currentOut: qty(here * ratio), nextOut: qty(there * ratio) };
}

export function overflowRequestHash(body) {
  const items = Array.isArray(body.items) ? body.items : [{
    sdateKey:body.sdateKey, quantity:body.quantity, unit:body.unit,
    expectedOldQuantity:body.expectedOldQuantity, expectedOldCost:body.expectedOldCost,
    descr:body.descr, expectedOldDescr:body.expectedOldDescr,
  }];
  return hash({ orderYear:String(body.orderYear ?? body.year), custKey:Number(body.custKey), items,
    ...(body.combinedCosts !== undefined ? {combinedCosts:body.combinedCosts} : {}) });
}
export function validateOverflowOperationId(value) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''))) throw error('작업 식별자가 올바르지 않습니다.', 'OVERFLOW_OPERATION_INVALID');
  return String(value);
}
export async function readOverflowResult(tQ, sql, { operationId, userId, orderYear, custKey, requestHash, lock = false }) {
  validateOverflowOperationId(operationId);
  const r = await tQ(`SELECT Payload FROM SystemActionLog ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE ActionType=N'ESTIMATE_OVERFLOW_APPLY' AND SessionId=@op AND Actor=@uid AND Result=N'SUCCESS'`, {
    op:{type:sql.NVarChar,value:operationId}, uid:{type:sql.NVarChar,value:userId},
  });
  if (!r.recordset?.length) return null;
  if (r.recordset.length !== 1) throw error('작업 이력이 중복되어 결과를 판정할 수 없습니다.');
  const saved = JSON.parse(r.recordset[0].Payload);
  if (saved.orderYear !== String(orderYear) || saved.custKey !== Number(custKey)
    || (requestHash && saved.requestHash !== requestHash)) throw error('같은 작업번호로 다른 수량이나 업체를 저장할 수 없습니다.', 'OVERFLOW_OPERATION_CONFLICT');
  return saved.result;
}

async function readWeekFacts(tQ, sql, row) {
  const r = await tQ(`SELECT
      (SELECT COUNT(*) FROM StockMaster WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk) AS MasterCount,
      (SELECT ps.Stock FROM ProductStock ps WITH (UPDLOCK,HOLDLOCK) JOIN StockMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.StockKey=ps.StockKey WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ps.ProdKey=@pk) AS StoredStock,
      ISNULL((SELECT ps.Stock FROM ProductStock ps WITH (UPDLOCK,HOLDLOCK) WHERE ps.ProdKey=@pk AND ps.StockKey=(SELECT TOP 1 StockKey FROM StockMaster WITH (UPDLOCK,HOLDLOCK) WHERE OrderYearWeek<@ywk ORDER BY OrderYearWeek DESC,OrderWeek DESC)),0) AS PrevStock,
      ISNULL((SELECT ROUND(SUM(OutQuantity),2) FROM ViewWarehouse WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk AND ProdKey=@pk),0) AS Incoming,
      ISNULL((SELECT ROUND(SUM(OutQuantity),2) FROM ViewShipment WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk AND ProdKey=@pk AND DetailFix=1),0) AS ConfirmedOut,
      ISNULL((SELECT SUM(OutQuantity) FROM ViewShipment WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek>=SUBSTRING(@wk,1,2)+N'-01' AND OrderWeek<=@wk AND ProdKey=@pk AND ISNULL(DetailFix,0)=0),0) AS ReservedOut,
      ISNULL((SELECT ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) FROM StockHistory sh WITH (UPDLOCK,HOLDLOCK) JOIN CodeInfo ci WITH (UPDLOCK,HOLDLOCK) ON ci.Category=N'StockType' AND sh.ChangeType=ci.Descr WHERE sh.OrderYear=@yr AND sh.OrderWeek=@wk AND sh.ProdKey=@pk),0) AS AdjustQty`, {
    yr:{type:sql.NVarChar,value:row.OrderYear},wk:{type:sql.NVarChar,value:row.OrderWeek},pk:{type:sql.Int,value:row.ProdKey},ywk:{type:sql.NVarChar,value:`${row.OrderYear}${row.OrderWeek.replace('-','')}`},
  });
  const f = r.recordset?.[0];
  if (!f || Number(f.MasterCount) !== 1 || f.StoredStock == null) throw error(`${row.OrderYear}년 ${row.OrderWeek}차 품목 재고 스냅샷이 없어 다음 차수 배정을 중단했습니다.`);
  const nativeRemain = qty(Number(f.PrevStock) + Number(f.Incoming) - Number(f.ConfirmedOut) + Number(f.AdjustQty));
  if (Math.abs(qty(f.StoredStock) - nativeRemain) > 0.001) throw error(`${row.OrderWeek}차 저장 재고와 재계산 기준이 다릅니다. 재고를 먼저 확인하세요.`, 'OVERFLOW_STOCK_STALE');
  return { ...f, remain:qty(nativeRemain - Number(f.ReservedOut)), ...{orderYear:row.OrderYear,orderWeek:row.OrderWeek,prodKey:row.ProdKey} };
}

function finalizeGroup(group) {
  group.newDetailOutQuantity = qty(group.oldDetailOutQuantity + group.changes.reduce((sum,c) => sum + c.newDateOutQuantity - Number(c.row.DateShipmentQuantity),0));
  group.confirmedDelta = qty(group.newDetailOutQuantity - group.oldDetailOutQuantity);
  group.actualIncrease = group.confirmedDelta > 0;
  group.actualDecrease = group.confirmedDelta < 0;
  return group;
}

async function readTarget(tQ, sql, source, week, increment, existingPlan) {
  const params = {yr:{type:sql.NVarChar,value:source.OrderYear},wk:{type:sql.NVarChar,value:week},ck:{type:sql.Int,value:source.CustKey},pk:{type:sql.Int,value:source.ProdKey}};
  const masters = await tQ(`SELECT ShipmentKey,isFix FROM ShipmentMaster WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@yr AND OrderWeek=@wk AND OrderYearWeek=@yr+SUBSTRING(@wk,1,2) AND CustKey=@ck AND isDeleted=0`,params);
  if (masters.recordset?.length !== 1) throw error(`${week}차 업체 출고마스터가 없거나 여러 개입니다. 해당 차수의 업체를 먼저 등록·확인하세요.`);
  const master = masters.recordset[0];
  const dates = await tQ(`SELECT pd.BaseYmd,c.CustName,c.Manager,c.OrderCode
    FROM Customer c WITH (UPDLOCK,HOLDLOCK) JOIN PeriodDay pd WITH (UPDLOCK,HOLDLOCK)
      ON pd.OrderYearWeek=@yr+SUBSTRING(@wk,1,2) AND pd.WeekDay=ISNULL(NULLIF(c.BaseOutDay,0),4)
    WHERE c.CustKey=@ck AND c.isDeleted=0`,params);
  if (dates.recordset?.length !== 1 || !dates.recordset[0].BaseYmd) throw error(`${week}차 업체 기본 출고일이 없거나 중복됩니다. 출고일 달력과 업체 기본 요일을 확인하세요.`);
  const customer = dates.recordset[0];
  const details = await tQ(`SELECT sd.SdetailKey,sd.OutQuantity AS DetailOutQuantity,sd.EstQuantity AS DetailEstQuantity,
      sd.BoxQuantity AS DetailBoxQuantity,sd.BunchQuantity AS DetailBunchQuantity,sd.SteamQuantity AS DetailSteamQuantity,
      sd.Cost AS DetailCost,sd.Amount AS DetailAmount,sd.Vat AS DetailVat,sd.isFix AS DetailIsFix
    FROM ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK) JOIN ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.ShipmentKey=sd.ShipmentKey
    WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sm.isDeleted=0 AND sd.ProdKey=@pk`,params);
  if (details.recordset.length > 1) throw error(`${week}차 동일 품목 출고행이 여러 개여서 자동 배정을 중단했습니다.`);
  const detail = details.recordset[0];
  if ((detail && !fixed(detail.DetailIsFix)) || !fixed(master.isFix)) throw error(`${week}차 업체 또는 품목이 미확정입니다. 자동 확정하지 않았습니다. 다음 차수 확정 상태를 먼저 확인하세요.`);
  if (detail && existingPlan.some(g => Number(g.row.SdetailKey) === Number(detail.SdetailKey))) throw error(`${week}차 같은 품목도 편집 중입니다. 원본 차수 증가분부터 따로 저장하세요.`, 'OVERFLOW_TARGET_EDIT_CONFLICT');
  const row = {...source, ...(detail || {}), OrderWeek:week,ShipmentKey:master.ShipmentKey,MasterIsFix:master.isFix,ShipmentDtm:customer.BaseYmd};
  if (!detail) Object.assign(row,{SdetailKey:null,DetailOutQuantity:0,DetailEstQuantity:0,DetailBoxQuantity:0,DetailBunchQuantity:0,DetailSteamQuantity:0,DetailAmount:0,DetailVat:0,DetailIsFix:1});
  const allDates = detail ? (await tQ(`SELECT SdateKey,ShipmentDtm,ShipmentQuantity AS DateShipmentQuantity,EstQuantity AS DateEstQuantity,Cost AS DateCost,Descr AS DateDescr,Amount,Vat FROM ShipmentDate WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@sdk ORDER BY SdateKey`,{sdk:{type:sql.Int,value:detail.SdetailKey}})).recordset : [];
  if (detail && (!allDates.length || qty(allDates.reduce((sum,d)=>sum+Number(d.DateShipmentQuantity),0)) !== qty(detail.DetailOutQuantity))) throw error(`${week}차 기존 출고일 합계가 상세수량과 다릅니다.`);
  const matching = allDates.filter(d => stamp(d.ShipmentDtm) === stamp(customer.BaseYmd));
  if (matching.length > 1) throw error(`${week}차 기본 출고일 행이 중복되어 있습니다.`);
  const date = matching[0] || {SdateKey:null,ShipmentDtm:customer.BaseYmd,DateShipmentQuantity:0,DateEstQuantity:0,DateCost:row.DetailCost,DateDescr:''};
  // Existing target price and other dates remain untouched; same default date price must agree.
  if (matching.length && Number(date.DateCost) !== Number(row.DetailCost)) throw error(`${week}차 기본 출고일 단가와 품목 단가가 다릅니다. 단가부터 확인하세요.`);
  Object.assign(row,date);
  const orders = await tQ(`SELECT om.OrderMasterKey,om.Manager,od.OrderDetailKey,od.OutQuantity
    FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK) LEFT JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK)
      ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND od.isDeleted=0
    WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND om.isDeleted=0 ORDER BY om.OrderMasterKey,od.OrderDetailKey`,params);
  const needsOrder = !orders.recordset.some(o=>Number(o.OutQuantity)>0);
  const activeOrderRows=orders.recordset.filter(o=>o.OrderDetailKey!=null);
  if (activeOrderRows.length>1 || activeOrderRows.some(o=>!(Number(o.OutQuantity)>0))) throw error(`${week}차 같은 품목의 주문이 중복되거나 0/음수 주문행이 있습니다. 전산 견적 중복을 막기 위해 먼저 주문을 확인하세요.`, 'OVERFLOW_ORDER_AMBIGUOUS');
  if (needsOrder) {
    if (new Set(orders.recordset.map(o=>o.OrderMasterKey)).size>1) throw error(`${week}차 주문마스터가 중복되어 있습니다. 신규 주문을 넣을 기준을 먼저 확인하세요.`, 'OVERFLOW_ORDER_AMBIGUOUS');
    const existingOrderMaster=orders.recordset[0];
    const managerRef=existingOrderMaster ? existingOrderMaster.Manager : customer.Manager;
    // Customer.Manager can be a display name; OrderMaster.Manager must be a
    // real UserID for native ViewOrder. Never invent an admin fallback.
    const manager = await tQ(`SELECT u.UserID FROM UserInfo u WITH (UPDLOCK,HOLDLOCK)
      WHERE (u.UserID=@manager OR (@resolveName=1 AND u.UserName=@manager AND NOT EXISTS(SELECT 1 FROM UserInfo WHERE UserID=@manager)))
        AND EXISTS (SELECT 1 FROM Product p JOIN Country c ON c.CounName=p.CounName WHERE p.ProdKey=@pk AND p.isDeleted=0)`,{...params,manager:{type:sql.NVarChar,value:managerRef},resolveName:{type:sql.Bit,value:existingOrderMaster?0:1}});
    if (manager.recordset?.length!==1) throw error('신규 주문을 표시할 담당자 계정·품목 국가가 전산에 없습니다.');
    customer.Manager=manager.recordset[0].UserID;
  }
  const orderYearWeekColumn = await tQ(`SELECT is_computed FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.OrderMaster') AND name=N'OrderYearWeek'`);
  const units = shipmentUnitsFromUserInput(qty(Number(date.DateShipmentQuantity)+increment),row.OutUnit,row);
  const group = finalizeGroup({row,oldDetailOutQuantity:qty(row.DetailOutQuantity),fixed:true,overflowTarget:true,newDetail:!detail,newDate:!matching.length,customer,allDates,orders:orders.recordset,
    writeOrderYearWeek:orderYearWeekColumn.recordset.length===1 && !orderYearWeekColumn.recordset[0].is_computed,
    changes:[{row,item:{sdateKey:date.SdateKey,quantity:units.estQty,unit:row.EstUnit},newDateOutQuantity:qty(units.outQuantity),newDateEstQuantity:units.estQty}]});
  return group;
}

/** Only reads while planning. The same locked plan is used by preview and apply. */
export async function planEstimateOverflow(tQ, sql, originalPlan, costPreview = null) {
  const effectiveCosts = new Map((costPreview?.detailCosts || []).map(item => [Number(item.sdetailKey), Number(item.cost)]));
  const plan = originalPlan.map(g=>({...g,changes:g.changes.map(c=>({...c}))}));
  const facts = new Map();
  const consumed = [];
  const transfer = new Map();
  const rows = [];
  const getFacts = async row => {
    if (!facts.has(scopeKey(row))) facts.set(scopeKey(row),await readWeekFacts(tQ,sql,row));
    return facts.get(scopeKey(row));
  };
  const used = row => consumed.filter(c=>c.year===row.OrderYear && c.prodKey===row.ProdKey && c.week<=row.OrderWeek).reduce((sum,c)=>sum+c.quantity,0);
  for (const group of [...plan].sort((a,b)=>a.row.OrderWeek.localeCompare(b.row.OrderWeek) || a.row.SdetailKey-b.row.SdetailKey)) {
    for (const c of group.changes) {
      const increase = qty(c.newDateOutQuantity - Number(c.row.DateShipmentQuantity));
      if (increase <= 0) continue;
      const row = c.row;
      const f = await getFacts(row);
      const remain = qty(f.remain - used(row));
      const estIncrease = Number(c.newDateEstQuantity) - Number(row.DateEstQuantity);
      if (remain >= increase) {
        consumed.push({year:row.OrderYear,week:row.OrderWeek,prodKey:row.ProdKey,quantity:increase});
        continue;
      }
      if (!group.fixed) throw error(`${row.OrderWeek}차 원본이 미확정입니다. 이 화면에서 다음 차수로 자동 확정하지 않습니다.`);
      const next = {...row,OrderWeek:nextEstimateSubweek(row.OrderWeek)};
      const nextFacts = await getFacts(next);
      let split;
      try { split = splitEstimateIncrease({increase:estIncrease,currentRemain:remain,nextRemain:qty(nextFacts.remain-used(next)),outPerUnit:increase/estIncrease}); }
      catch (e) { e.message = `${formatDirectionalProductLabel({prodKey:row.ProdKey,prodName:row.ProdName,countryFlower:row.CountryFlower})} · ${row.OrderWeek}→${next.OrderWeek}: ${e.message}`; throw e; }
      c.newDateEstQuantity = Number(row.DateEstQuantity)+split.currentIncrease;
      c.newDateOutQuantity = qty(Number(row.DateShipmentQuantity)+split.currentOut);
      const currentUnits=shipmentUnitsFromUserInput(c.newDateEstQuantity,row.EstUnit,row);
      const nextUnits=shipmentUnitsFromUserInput(split.nextIncrease,row.EstUnit,row);
      if (qty(currentUnits.outQuantity)!==c.newDateOutQuantity || Number(currentUnits.estQty)!==c.newDateEstQuantity
        || qty(nextUnits.outQuantity)!==split.nextOut || Number(nextUnits.estQty)!==split.nextIncrease) {
        throw error(`${row.ProdName}은 차수별로 나눈 수량을 ${row.OutUnit}/${row.EstUnit}로 정확히 환산할 수 없습니다. 정수 단위로 조정하세요.`, 'OVERFLOW_UNIT_ROUNDTRIP');
      }
      consumed.push({year:row.OrderYear,week:row.OrderWeek,prodKey:row.ProdKey,quantity:split.currentOut},{year:row.OrderYear,week:next.OrderWeek,prodKey:row.ProdKey,quantity:split.nextOut});
      const key = scopeKey(next);
      const prev = transfer.get(key);
      const sourceCost = effectiveCosts.get(Number(row.SdetailKey)) ?? Number(row.DetailCost);
      if (prev && Number(prev.source.DetailCost)!==sourceCost) throw error('같은 다음 차수 품목으로 보내는 원본 단가가 다릅니다. 각각 확인해 주세요.');
      // Project only the target's inherited price, never mutate source snapshots.
      transfer.set(key,{source:{...row,DetailCost:sourceCost},week:next.OrderWeek,out:qty((prev?.out||0)+split.nextOut)});
      rows.push({sdateKey:row.SdateKey,prodKey:row.ProdKey,prodName:row.ProdName,unit:row.EstUnit,fromWeek:row.OrderWeek,toWeek:next.OrderWeek,oldQuantity:Number(row.DateEstQuantity),requestedQuantity:Number(c.item.quantity),currentQuantity:c.newDateEstQuantity,currentIncrease:split.currentIncrease,nextIncrease:split.nextIncrease,targetKey:key,sourceCost,sourceCostBefore:Number(row.DetailCost)});
    }
    finalizeGroup(group);
  }
  if (!rows.length) return {preview:{required:false},plan};
  const targets = [];
  for (const [key,t] of transfer) {
    const target = await readTarget(tQ,sql,t.source,t.week,t.out,originalPlan);
    targets.push(target);
    for (const row of rows.filter(r=>r.targetKey===key)) Object.assign(row,{shipmentDate:stamp(target.row.ShipmentDtm).slice(0,10),cost:effectiveCosts.get(Number(target.row.SdetailKey)) ?? Number(target.row.DetailCost),newShipment:target.newDetail,retainedTargetCost:!target.newDetail && !effectiveCosts.has(Number(target.row.SdetailKey))});
  }
  const preview = {required:true,rows,combinedCostCount:costPreview?.intent.items.length || 0,planHash:hash({facts:[...facts],consumed,plan:plan.map(g=>({row:g.row,changes:g.changes})),targets,...(costPreview ? {costIntent:costPreview.intent} : {})})};
  return {preview,plan:[...plan,...targets],targets};
}

/** No runtime DDL. Positive orders only; provisional zero shipment/date is never committed. */
export async function materializeOverflowTargets(tQ, sql, targets, userId) {
  for (const g of targets) {
    const r=g.row,uid={type:sql.NVarChar,value:userId};
    const params={yr:{type:sql.NVarChar,value:r.OrderYear},wk:{type:sql.NVarChar,value:r.OrderWeek},ck:{type:sql.Int,value:r.CustKey},pk:{type:sql.Int,value:r.ProdKey}};
    const orders=await tQ(`SELECT om.OrderMasterKey,od.OrderDetailKey,od.OutQuantity FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
      LEFT JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND od.isDeleted=0
      WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND om.isDeleted=0`,params);
    if (!orders.recordset.some(o=>Number(o.OutQuantity)>0)) {
      const manager=await tQ(`SELECT UserID FROM UserInfo WITH (UPDLOCK,HOLDLOCK) WHERE UserID=@manager`,{manager:{type:sql.NVarChar,value:g.customer.Manager}});
      if (manager.recordset?.length!==1) throw error('거래처 담당자의 전산 계정이 없어 신규 주문을 등록하지 않았습니다.');
      let mk=orders.recordset[0]?.OrderMasterKey;
      if (!mk) {
        mk=await safeNextKey(tQ,'OrderMaster','OrderMasterKey');
        // Some EXE installations omit this column; writable raw year-week is the parent key.
        await tQ(`INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,${g.writeOrderYearWeek?'OrderYearWeek,':''}Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
          VALUES (@mk,GETDATE(),@yr,@wk,${g.writeOrderYearWeek?'@ywk,':''}@manager,@ck,@orderCode,N'',0,@uid,GETDATE(),@uid,GETDATE())`,{...params,ywk:{type:sql.NVarChar,value:`${r.OrderYear}${r.OrderWeek.slice(0,2)}`},mk:{type:sql.Int,value:mk},uid,manager:{type:sql.NVarChar,value:g.customer.Manager},orderCode:{type:sql.NVarChar,value:g.customer.OrderCode||''}});
        await syncKeyNumbering(tQ,'OrderMasterKey','OrderMaster','OrderMasterKey');
      }
      const dk=await safeNextKey(tQ,'OrderDetail','OrderDetailKey');
      const units=shipmentUnitsFromUserInput(g.confirmedDelta,r.OutUnit,r);
      await tQ(`INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
        VALUES (@dk,@mk,@pk,@box,@bunch,@steam,@out,@out,0,N'견적 부족분 다음 차수 주문',0,@uid,GETDATE(),@uid,GETDATE())`,{...params,uid,dk:{type:sql.Int,value:dk},mk:{type:sql.Int,value:mk},box:{type:sql.Float,value:units.box},bunch:{type:sql.Float,value:units.bunch},steam:{type:sql.Float,value:units.steam},out:{type:sql.Float,value:g.confirmedDelta}});
      await syncKeyNumbering(tQ,'OrderDetailKey','OrderDetail','OrderDetailKey');
      await tQ(`INSERT INTO OrderHistory (OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
        VALUES (@dk,N'신규',N'수량',N'0',@after,N'견적 부족분 다음 차수 주문',@uid,GETDATE())`,{dk:{type:sql.Int,value:dk},after:{type:sql.NVarChar,value:String(g.confirmedDelta)},uid});
    }
    if (g.newDetail) {
      r.SdetailKey=await safeNextKey(tQ,'ShipmentDetail','SdetailKey');
      await tQ(`INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
        VALUES (@sdk,@sk,@ck,@pk,@dt,0,0,0,0,0,@cost,0,0,1,N'',N'')`,{...params,sdk:{type:sql.Int,value:r.SdetailKey},sk:{type:sql.Int,value:r.ShipmentKey},dt:{type:sql.DateTime,value:r.ShipmentDtm},cost:{type:sql.Float,value:r.DetailCost}});
      await syncKeyNumbering(tQ,'ShipmentDetailKey','ShipmentDetail','SdetailKey');
    }
    if (g.newDate) {
      const inserted=await tQ(`INSERT INTO ShipmentDate (SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        OUTPUT INSERTED.SdateKey VALUES (@sdk,@dt,0,0,@cost,0,0,N'')`,{sdk:{type:sql.Int,value:r.SdetailKey},dt:{type:sql.DateTime,value:r.ShipmentDtm},cost:{type:sql.Float,value:r.DetailCost}});
      r.SdateKey=inserted.recordset[0].SdateKey;
      g.changes[0].item.sdateKey=r.SdateKey;
    }
  }
}

export async function verifyOverflowTargets(tQ,sql,targets) {
  for (const g of targets) {
    const r=g.row;
    const verified=await tQ(`SELECT vs.SdetailKey,vs.OutQuantity,vs.DetailFix,
      (SELECT COUNT(*) FROM ShipmentDate d JOIN PeriodDay pd ON d.ShipmentDtm=pd.BaseYmd WHERE d.SdetailKey=vs.SdetailKey AND d.SdateKey=@dateKey AND d.EstQuantity>0) AS DateVisible,
      (SELECT COUNT(*) FROM ViewOrder vo WHERE vo.OrderYear=@yr AND vo.OrderWeek=@wk AND vo.CustKey=@ck AND vo.ProdKey=@pk AND vo.OrderYearWeek2=vs.OrderYearWeek2) AS OrderVisible
      FROM ViewShipment vs WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.OrderYearWeek=@yr+SUBSTRING(@wk,1,2) AND vs.CustKey=@ck AND vs.ProdKey=@pk AND vs.SdetailKey=@sdk AND vs.EstQuantity>0`,{yr:{type:sql.NVarChar,value:r.OrderYear},wk:{type:sql.NVarChar,value:r.OrderWeek},ck:{type:sql.Int,value:r.CustKey},pk:{type:sql.Int,value:r.ProdKey},sdk:{type:sql.Int,value:r.SdetailKey},dateKey:{type:sql.Int,value:r.SdateKey}});
    const v=verified.recordset?.[0];
    if (!v || verified.recordset.length!==1 || qty(v.OutQuantity)!==g.newDetailOutQuantity || !fixed(v.DetailFix) || Number(v.DateVisible)!==1 || Number(v.OrderVisible)!==1) throw error(`${r.OrderWeek}차 ${r.ProdName} 전산 주문·분배·견적 노출 검증에 실패했습니다. 전체 저장을 취소합니다.`, 'OVERFLOW_VERIFY_FAILED');
  }
}

export async function recordOverflowResult(tQ,sql,body,userId,result) {
  await tQ(`INSERT INTO SystemActionLog (Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
    VALUES (@uid,@op,N'ESTIMATE_OVERFLOW_APPLY',N'POST',N'/api/estimate/update-date-quantity',N'OrderDetail/ShipmentDetail/ShipmentDate',@count,@payload,N'SUCCESS',N'다음 세부차수 수량 배정 완료',N'HIGH')`,{
    uid:{type:sql.NVarChar,value:userId},op:{type:sql.NVarChar,value:body.overflowOperationId},count:{type:sql.Int,value:result.updatedCount},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({orderYear:String(body.orderYear??body.year),custKey:Number(body.custKey),requestHash:overflowRequestHash(body),result})},
  });
}
