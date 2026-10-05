import { safeNextKey, safeNextShipmentDetailKey, syncKeyNumbering } from './safeNextKey.js';
import { shipmentUnitsFromUserInput } from './distributeUnits.js';
import { weekdayDistributionError } from './weekdayDistributionPolicy.js';

const paramsFor = (sql, change) => ({ yr: { type: sql.NVarChar, value: change.year },
  wk: { type: sql.NVarChar, value: change.orderWeek }, ck: { type: sql.Int, value: change.custKey },
  pk: { type: sql.Int, value: change.prodKey } });
const fail = message => { throw weekdayDistributionError('ALLOCATION_SCOPE_UNVERIFIED', message); };

// Prepare every pricing/order decision under the caller's existing transaction.
// This phase performs SELECT only; allocation does not mean automatic confirmation.
export async function prepareWeekdayAllocation(tQ, sql, plans) {
  for (const plan of plans) {
    if (!plan.changed) continue;
    const params = paramsFor(sql, plan.change);
    if (plan.newDetail) {
      const costs = await tQ(`SELECT Cost FROM CustomerProdCost WITH (UPDLOCK,HOLDLOCK) WHERE CustKey=@ck AND ProdKey=@pk`, params);
      if (costs.recordset?.length > 1) fail('거래처·품목 단가가 중복되어 신규 분배 단가를 결정할 수 없습니다.');
      const cost = costs.recordset?.[0]?.Cost ?? 0;
      if (!Number.isFinite(Number(cost)) || Number(cost) < 0) fail('거래처·품목 단가를 확인할 수 없습니다.');
      plan.inheritedCost = Number(cost);
      plan.fixed = false;
    } else if (plan.actual.detail?.DetailCost == null || !Number.isFinite(Number(plan.actual.detail.DetailCost))
      || Number(plan.actual.detail.DetailCost) < 0) fail('기존 출고 상세 단가를 보존할 수 없습니다.');
    if (plan.delta <= 0) continue; // CANCEL never creates or changes order demand.
    const orders = await tQ(`SELECT om.OrderMasterKey,om.Manager,od.OrderDetailKey,od.OutQuantity
      FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
      LEFT JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey
        AND od.ProdKey=@pk AND ISNULL(od.isDeleted,0)=0
      WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0`, params);
    const rows = orders.recordset || [];
    if (rows.some(row => row.OrderDetailKey != null && (!Number.isFinite(Number(row.OutQuantity)) || Number(row.OutQuantity) < 0))) fail('주문 수량 기준을 확인할 수 없습니다.');
    const active = rows.filter(row => row.OrderDetailKey != null && Number(row.OutQuantity) > 0);
    if (active.length > 1) fail('같은 연도·차수·업체·품목의 활성 주문이 중복되었습니다.');
    const masterKeys = [...new Set(rows.map(row => Number(row.OrderMasterKey)))];
    if (!active.length && masterKeys.length > 1) fail('새 주문을 연결할 주문 마스터가 중복되었습니다.');
    plan.allocationOrder = { existing: active[0] || null, masterKey: masterKeys[0] || null };
    if (!active.length) {
      const manager = plan.actual.customer?.Manager;
      if (typeof manager !== 'string' || !manager.trim()) fail('신규 주문에는 거래처 담당자의 전산 계정이 필요합니다.');
      const user = await tQ(`SELECT UserID FROM UserInfo WITH (UPDLOCK,HOLDLOCK)
        WHERE UserID=@manager AND ISNULL(isDeleted,0)=0`, { manager: { type: sql.NVarChar, value: manager } });
      if (user.recordset?.length !== 1) fail('신규 주문 담당자의 활성 UserInfo 계정을 확인할 수 없습니다.');
    }
  }
  return plans;
}

export async function materializeWeekdayAllocation(tQ, sql, plans, userId) {
  const capabilities = await tQ(`SELECT OBJECT_NAME(object_id) AS TableName,name,is_computed FROM sys.columns
    WHERE object_id IN (OBJECT_ID(N'dbo.OrderMaster'),OBJECT_ID(N'dbo.ShipmentMaster')) AND name=N'OrderYearWeek'`);
  const writable = table => (capabilities.recordset || []).some(row => row.TableName === table && !row.is_computed);
  const shipmentMasters = new Map(), orderMasters = new Map();
  const uid = { type: sql.NVarChar, value: userId };
  for (const plan of plans) {
    if (!plan.changed) continue;
    const change = plan.change, params = paramsFor(sql, change);
    const business = `${change.year}|${change.orderWeek}|${change.custKey}`;
    const ywk = { type: sql.NVarChar, value: `${change.year}${change.orderWeek.slice(0,2)}` };
    if (!plan.actual.master) {
      let master = shipmentMasters.get(business);
      if (!master) {
        const key = await safeNextKey(tQ, 'ShipmentMaster', 'ShipmentKey');
        await tQ(`INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,${writable('ShipmentMaster') ? 'OrderYearWeek,' : ''}CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
          VALUES (@sk,@yr,@wk,${writable('ShipmentMaster') ? '@ywk,' : ''}@ck,0,0,1,@uid,GETDATE())`,
        { ...params, sk: { type: sql.Int, value: key }, ywk, uid });
        await syncKeyNumbering(tQ, 'ShipmentMasterKey', 'ShipmentMaster', 'ShipmentKey');
        master = { ShipmentKey: key, MasterIsFix: 0, OrderYearWeek: ywk.value };
        shipmentMasters.set(business, master);
      }
      plan.actual.master = master;
    }
    const order = plan.allocationOrder;
    if (plan.delta > 0 && order && !order.existing) {
      let masterKey = order.masterKey || orderMasters.get(business);
      if (!masterKey) {
        masterKey = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        await tQ(`INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,${writable('OrderMaster') ? 'OrderYearWeek,' : ''}Manager,CustKey,OrderCode,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
          VALUES (@mk,GETDATE(),@yr,@wk,${writable('OrderMaster') ? '@ywk,' : ''}@manager,@ck,@orderCode,N'',0,@uid,GETDATE(),@uid,GETDATE())`,
        { ...params, mk: { type: sql.Int, value: masterKey }, manager: { type: sql.NVarChar, value: plan.actual.customer.Manager },
          orderCode: { type: sql.NVarChar, value: plan.actual.customer.OrderCode || '' }, uid, ywk });
        await syncKeyNumbering(tQ, 'OrderMasterKey', 'OrderMaster', 'OrderMasterKey');
      }
      orderMasters.set(business, masterKey);
      const detailKey = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
      const units = shipmentUnitsFromUserInput(plan.delta, plan.actual.product.OutUnit, plan.actual.product);
      await tQ(`INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
        VALUES (@dk,@mk,@pk,@box,@bunch,@steam,@out,@est,0,N'주광 요일 분배 주문',0,@uid,GETDATE(),@uid,GETDATE())`,
      { ...params, dk: { type: sql.Int, value: detailKey }, mk: { type: sql.Int, value: masterKey }, uid,
        box: { type: sql.Float, value: units.box }, bunch: { type: sql.Float, value: units.bunch }, steam: { type: sql.Float, value: units.steam },
        out: { type: sql.Float, value: plan.delta }, est: { type: sql.Float, value: units.estQty } });
      await syncKeyNumbering(tQ, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
      await tQ(`INSERT INTO OrderHistory (OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
        VALUES (@dk,N'신규',N'수량',N'0',@after,N'주광 요일 분배 주문',@uid,GETDATE())`,
      { dk: { type: sql.Int, value: detailKey }, after: { type: sql.NVarChar, value: String(plan.delta) }, uid });
      order.created = { masterKey, detailKey, quantity: plan.delta };
    }
    if (plan.newDetail) {
      const key = await safeNextShipmentDetailKey(tQ);
      await tQ(`INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
        VALUES (@sdk,@sk,@ck,@pk,CONVERT(datetime,@dt,121),0,0,0,0,0,@cost,0,0,0,N'',N'')`,
      { ...params, sdk: { type: sql.Int, value: key }, sk: { type: sql.Int, value: plan.actual.master.ShipmentKey },
        dt: { type: sql.NVarChar(23), value: plan.representativeTimestamp }, cost: { type: sql.Float, value: plan.inheritedCost } });
      await syncKeyNumbering(tQ, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
      plan.actual.detail = { SdetailKey: key, ShipmentKey: plan.actual.master.ShipmentKey, CustKey: change.custKey,
        ProdKey: change.prodKey, DetailCost: plan.inheritedCost, DetailIsFix: 0, OutQuantity: 0 };
    }
  }
  // Verify order creation/preservation inside the same transaction, never from View-only assumptions.
  for (const plan of plans.filter(plan => plan.allocationOrder)) {
    const order = plan.allocationOrder, expected = order.existing || order.created;
    const readback = await tQ(`SELECT om.OrderMasterKey,od.OrderDetailKey,od.OutQuantity FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
      JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND ISNULL(od.isDeleted,0)=0
      WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0 AND od.OutQuantity>0`, paramsFor(sql, plan.change));
    const row = readback.recordset?.[0];
    if (readback.recordset?.length !== 1 || Number(row.OrderMasterKey) !== Number(expected.OrderMasterKey ?? expected.masterKey)
      || Number(row.OrderDetailKey) !== Number(expected.OrderDetailKey ?? expected.detailKey)
      || Math.abs(Number(row.OutQuantity) - Number(expected.OutQuantity ?? expected.quantity)) > 0.000001) {
      fail('분배 적용 중 주문 생성·보존 검증에 실패하여 전체 작업을 취소합니다.');
    }
  }
}
