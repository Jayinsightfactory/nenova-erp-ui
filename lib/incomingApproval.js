import { readReceipt, recalculateChangedProducts } from './warehouseCorrection.js';
import { normalizedCorrection, buildCorrectionPlan, correctionDetailFields } from './warehouseCorrectionPolicy.js';
import { approvalError, normalizeApprovalMatching, buildApprovalDistributionPlan, approvalPermissions } from './incomingApprovalPolicy.js';
import { approvalHash, approvalParam as p, approvalRows as rows, readApproval, assertApprovalAccess, assertApprovalRevision, saveApprovalState } from './incomingApprovalStore.js';
import { acquireInvoiceReceiptGate, receiptTransactionCheckSql } from './invoiceReceiptNative.js';
import { verifyInvoiceStockReadback } from './invoiceReceiptStockReadback.js';
import { tryInsertWithRetry, syncKeyNumbering } from './safeNextKey.js';
import { assertShipmentLineHasOrder } from './shipmentEstimateGuard.js';
import { FARM_CANDIDATE_SCOPE_SQL } from './shipmentFarmCandidates.js';
import { suggestReceiptMappings, buildReceiptIdentityPlan, buildApprovalFarmPlan } from './incomingApprovalLinkedPolicy.js';
import { writeApprovalReceiptDetails, writeApprovalFarmGroups } from './incomingApprovalLinkedWriter.js';
import { readIncomingApprovalCosts, prepareIncomingApprovalCosts, writeIncomingApprovalCosts } from './incomingApprovalCosts.js';
import { readIncomingApprovalProfit, computeIncomingApprovalProfit, writeIncomingApprovalProfit, summarizeStoredApprovalProfit } from './incomingApprovalProfit.js';
import { getKcsTaxableRate } from './kcsTaxableRate.js';

export async function readIncomingApprovalFacts(q, types, input, locked = false) {
  const correction = normalizedCorrection(input), receipt = await readReceipt(q, types, correction, locked);
  const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const params = { year: p(types.NVarChar, correction.orderYear), week: p(types.NVarChar, correction.orderWeek),
    wk: p(types.Int, correction.warehouseKey), keys: p(types.NVarChar, JSON.stringify(receipt.details.map(d => d.ProdKey))),
    names: p(types.NVarChar, JSON.stringify(correction.items?.map(i => i.prodName) ?? [])) };
  const products = rows(await q(`SELECT ProdKey,ProdName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Box,SteamOf1Bunch,CountryFlower,CounName,FlowerName,BoxWeight,BoxCBM,TariffRate,Stock,isDeleted
    FROM Product ${hint} WHERE ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))
    OR LOWER(LTRIM(RTRIM(ProdName))) IN(SELECT LOWER(value) FROM OPENJSON(@names)) ORDER BY ProdKey`, params));
  const receiptPlan = {...buildCorrectionPlan(correction, receipt.header, receipt.details, products),farmName:correction.farmName};
  params.keys = p(types.NVarChar, JSON.stringify(receiptPlan.keys));
  const farms = rows(await q(`SELECT FarmKey,FarmName,FarmCode FROM Farm ${hint} WHERE isDeleted=0 ORDER BY FarmKey`));
  if (receiptPlan.farmChanged && farms.filter(f => f.FarmName === correction.farmName).length !== 1)
    throw approvalError('APPROVAL_FARM_INVALID', '등록된 농장을 정확히 선택하세요.');
  const masterScope = `sm.isDeleted=0 AND (sm.OrderYear>@year OR (sm.OrderYear=@year AND sm.OrderWeek>=@week))`;
  const masters = rows(await q(`SELECT DISTINCT sm.ShipmentKey,sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,sm.CustKey,sm.isFix,sm.isDeleted,c.CustName,c.Manager,c.OrderCode
    FROM ShipmentMaster sm ${hint} JOIN Customer c ${hint} ON c.CustKey=sm.CustKey AND c.isDeleted=0
    WHERE ${masterScope} AND EXISTS(SELECT 1 FROM ShipmentDetail sd ${hint} WHERE sd.ShipmentKey=sm.ShipmentKey
    AND sd.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))) ORDER BY sm.OrderYear,sm.OrderWeek,sm.ShipmentKey`, params));
  const details = rows(await q(`SELECT sd.* FROM ShipmentDetail sd ${hint} JOIN ShipmentMaster sm ${hint} ON sm.ShipmentKey=sd.ShipmentKey
    WHERE ${masterScope} AND sd.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) ORDER BY sd.SdetailKey`, params));
  if (details.length > 5000) throw approvalError('APPROVAL_SCOPE_TOO_LARGE', '영향 분배가 5,000행을 초과합니다. 관리자 검토가 필요합니다.');
  params.detailKeys = p(types.NVarChar, JSON.stringify(details.map(d => d.SdetailKey)));
  const dates = rows(await q(`SELECT d.*,CONVERT(varchar(10),d.ShipmentDtm,23) DateText FROM ShipmentDate d ${hint}
    WHERE d.SdetailKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@detailKeys)) ORDER BY d.SdateKey`, params));
  const farmAssignments = rows(await q(`SELECT sf.* FROM ShipmentFarm sf ${hint}
    WHERE sf.SdetailKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@detailKeys)) ORDER BY sf.SfarmKey`, params));
  const farmCandidates = {};
  for (const pk of receiptPlan.keys) {
    const found = rows(await q(`SELECT DISTINCT f.FarmKey,f.FarmName FROM ViewWarehouse vw ${hint}
      JOIN Farm f ${hint} ON f.FarmName=vw.FarmName AND f.isDeleted=0 WHERE ${FARM_CANDIDATE_SCOPE_SQL} ORDER BY f.FarmKey`, { pk:p(types.Int,pk) }));
    // This receipt's approved FarmName becomes part of the same product-wide ViewWarehouse scope at commit.
    const proposed = receiptPlan.after.some(d => d.ProdKey === pk) ? farms.filter(f => f.FarmName === correction.farmName) : [];
    farmCandidates[pk] = [...new Map([...found,...proposed].map(f => [f.FarmKey,f])).values()];
  }
  const orders = rows(await q(`SELECT vo.OrderYear,vo.OrderWeek,vo.CustKey,vo.ProdKey,vo.OrderDetailKey,vo.OutQuantity FROM ViewOrder vo ${hint}
    WHERE (vo.OrderYear>@year OR (vo.OrderYear=@year AND vo.OrderWeek>=@week))
    AND vo.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) ORDER BY vo.OrderDetailKey`, params));
  const rawOrders = rows(await q(`SELECT om.OrderMasterKey,om.OrderYear,om.OrderWeek,om.CustKey,om.isDeleted,
    CASE WHEN EXISTS(SELECT 1 FROM UserInfo u ${hint} WHERE u.UserID=om.Manager) THEN 1 ELSE 0 END ManagerValid,
    od.OrderDetailKey,od.ProdKey,od.OutQuantity FROM OrderMaster om ${hint}
    LEFT JOIN OrderDetail od ${hint} ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
      AND od.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))
    WHERE om.isDeleted=0 AND (om.OrderYear>@year OR (om.OrderYear=@year AND om.OrderWeek>=@week)) ORDER BY om.OrderMasterKey,od.OrderDetailKey`, params));
  const periodDays = rows(await q(`SELECT OrderYearWeek,CONVERT(varchar(10),BaseYmd,23) DateText FROM PeriodDay ${hint}
    WHERE OrderYearWeek>=@year+LEFT(@week,2) ORDER BY OrderYearWeek,BaseYmd`, params));
  const connections = rows(await q(`SELECT N'FREIGHT_DETAIL' Code,COUNT_BIG(*) Count FROM FreightCostDetail fc ${hint}
      JOIN WarehouseDetail wd ${hint} ON wd.WdetailKey=fc.WarehouseDetailKey WHERE wd.WarehouseKey=@wk
    UNION ALL SELECT N'FREIGHT',COUNT_BIG(*) FROM FreightCost ${hint} WHERE WarehouseKey=@wk
    UNION ALL SELECT N'INVOICE',COUNT_BIG(*) FROM WebInvoiceOperation ${hint} WHERE WarehouseKey=@wk AND Status=N'COMMITTED'
    UNION ALL SELECT N'INVOICE_COST',COUNT_BIG(*) FROM WebInvoiceCostRevision ${hint} WHERE WarehouseKey=@wk
    UNION ALL SELECT N'STOCK_TYPE',COUNT_BIG(*) FROM CodeInfo ${hint} WHERE Category=N'StockType' AND Descr IN(N'입고',N'출고')`, params));
  const reportConfirmations = rows(await q(`SELECT ConfirmKey,OrderYear,MajorWeek,RevisionNo FROM WebProfitReportConfirm ${hint}
    WHERE IsActive=1 AND (OrderYear>@year OR (OrderYear=@year AND TRY_CONVERT(int,MajorWeek)>=TRY_CONVERT(int,LEFT(@week,2)))) ORDER BY ConfirmKey`, params));
  const stocks = rows(await q(`SELECT sm.StockKey,sm.OrderYear,sm.OrderWeek,ps.ProdKey,ps.Stock FROM StockMaster sm ${hint}
    JOIN ProductStock ps ${hint} ON ps.StockKey=sm.StockKey
    WHERE sm.OrderYearWeek>=@year+REPLACE(@week,N'-',N'')
    AND ps.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) ORDER BY sm.OrderYearWeek,sm.StockKey,ps.ProdKey`, params));
  const reservations = rows(await q(`SELECT vs.OrderYear,vs.OrderWeek,vs.ProdKey,SUM(vs.OutQuantity) Quantity FROM ViewShipment vs ${hint}
    WHERE (vs.OrderYear>@year OR (vs.OrderYear=@year AND vs.OrderWeek>=LEFT(@week,2)+N'-01')) AND ISNULL(vs.DetailFix,0)=0
    AND vs.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) GROUP BY vs.OrderYear,vs.OrderWeek,vs.ProdKey ORDER BY vs.OrderYear,vs.OrderWeek,vs.ProdKey`,params));
  const hasCosts=connections.some(c=>c.Code!=='STOCK_TYPE'&&Number(c.Count)>0);
  const costFacts=hasCosts?await readIncomingApprovalCosts(q,types,correction.warehouseKey,locked):null;
  const profitFacts=receiptPlan.detailsChanged?await readIncomingApprovalProfit(q,types,correction,locked):null;
  return { correction, receipt, products, receiptPlan, farms, farmCandidates, masters, details, dates, farmAssignments, orders, rawOrders, periodDays, connections, reportConfirmations, stocks, reservations,costFacts,profitFacts,
    receiptMappingSuggestions:suggestReceiptMappings(receiptPlan) };
}

export async function incomingApprovalBaseline(q, types, correction) {
  const f = await readIncomingApprovalFacts(q, types, correction);
  if (!f.receiptPlan.changed) throw approvalError('APPROVAL_UNCHANGED', '수정된 농장·품목·수량이 없습니다.');
  return { receipt: f.receipt, receiptPlan: f.receiptPlan, products: f.products, digest: approvalHash(f.receipt) };
}

export async function prepareIncomingApproval(q, types, row, locked = false) {
  const f = await readIncomingApprovalFacts(q, types, row.payload.correction, locked);
  if (approvalHash(f.receipt) !== row.payload.baseline.digest)
    throw approvalError('APPROVAL_RECEIPT_STALE', '요청 후 입고 원장이 변경됐습니다. 취소 후 현재 입고로 새 요청을 작성하세요.');
  const matching = normalizeApprovalMatching(row.payload.matching);
  const groups = buildApprovalDistributionPlan({ matching, dates: f.dates, details: f.details, masters: f.masters,
    products: f.products, scope: f.correction, receiptPlan: f.receiptPlan });
  const issues = [];
  if (f.farms.filter(farm=>farm.FarmName===f.receipt.header.FarmName).length>1)
    issues.push({code:'APPROVAL_FARM_AMBIGUOUS',message:'기존 농장명이 여러 농장에 중복 등록되어 있습니다. 입고 조회·재고 집계 연결을 먼저 확인하세요.'});
  if (!f.receiptPlan.changed) issues.push({ code: 'APPROVAL_UNCHANGED', message: '변경할 입고 내용이 없습니다.' });
  if(f.receiptPlan.detailsChanged&&f.connections.some(c=>c.Code==='STOCK_TYPE'&&Number(c.Count)))
    issues.push({code:'APPROVAL_STOCK_AUDIT_TYPE',message:'입고·출고 이력이 재고조정 코드에 포함되어 중복계산 위험이 있습니다. 전산 코드 기준을 확인하세요.'});
  const receiptIdentity=buildReceiptIdentityPlan(f.receiptPlan,matching,{preserveReferenced:!!f.costFacts});
  issues.push(...receiptIdentity.issues);
  let costPlan=null;
  if(f.costFacts){
    try{costPlan=await prepareIncomingApprovalCosts({q,types,costFacts:f.costFacts,receiptPlan:f.receiptPlan,
      receiptMappings:matching.receiptMappings.length?matching.receiptMappings:f.receiptMappingSuggestions,matching,products:f.products,beforeReceipt:f.receipt});
      issues.push(...(costPlan.issues??[]));
    }catch(e){if(!e.code?.startsWith('APPROVAL_'))throw e;issues.push({code:e.code,message:e.message});}
  }
  const farmPlan=buildApprovalFarmPlan(f,matching,groups);issues.push(...farmPlan.issues);
  if(f.profitFacts?.periods?.length&&(!matching.financial.acknowledged||!matching.financial.reason))
    issues.push({code:'APPROVAL_FINANCIAL_REVIEW_REQUIRED',message:'연결 손익 정정 사유를 입력하고 검토 여부를 확인하세요.'});
  for (const g of groups) {
    const order = f.orders.filter(o => o.OrderYear === g.master.OrderYear && o.OrderWeek === g.master.OrderWeek && o.CustKey === g.master.CustKey && o.ProdKey === g.product.ProdKey);
    g.orderRequired = g.outQuantity > 0 && !order.some(o => Number(o.OutQuantity) > 0);
    if (g.orderRequired && order.length) issues.push({ code: 'APPROVAL_EXISTING_ORDER_NOT_POSITIVE', message: `${g.master.CustName} / ${g.product.ProdName}: 기존 주문이 0 또는 음수입니다. 중복 주문을 만들지 않으므로 기존 주문을 확인하세요.` });
    if (g.orderRequired && !g.createOrder) issues.push({ code: 'APPROVAL_ORDER_CONFIRM_REQUIRED', message: `${g.master.CustName} / ${g.product.ProdName}: 양수 대체품 주문 신규 연결을 확인하세요.` });
    if (g.orderRequired) {
      const raw = f.rawOrders.filter(o => o.OrderYear === g.master.OrderYear && o.OrderWeek === g.master.OrderWeek && o.CustKey === g.master.CustKey);
      if (raw.some(o => o.ProdKey === g.product.ProdKey)) issues.push({ code: 'APPROVAL_EXISTING_ORDER_HIDDEN', message: `${g.master.CustName} / ${g.product.ProdName}: 기존 주문의 전산 연결을 먼저 확인하세요.` });
      if (new Set(raw.filter(o => o.ManagerValid === 1).map(o => o.OrderMasterKey)).size !== 1)
        issues.push({ code: 'APPROVAL_ORDER_MASTER_REQUIRED', message: `${g.master.CustName}: 대체품을 연결할 활성 주문서가 하나여야 합니다.` });
    }
    if (order.length > 1) issues.push({ code: 'APPROVAL_ORDER_DUPLICATE', message: `${g.master.CustName} / ${g.product.ProdName}: 주문 연결이 여러 개입니다.` });
    for (const d of g.after) {
      const day = String(d.DateText ?? d.ShipmentDtm).slice(0, 10);
      if (!f.periodDays.some(pd => pd.OrderYearWeek === g.master.OrderYearWeek && pd.DateText === day))
        issues.push({ code: 'APPROVAL_DATE_NOT_VISIBLE', message: `${g.master.CustName} ${day}: 해당 차수 견적 달력에 없는 출고일입니다.` });
    }
  }
  for (const a of matching.farms) {
    const original = f.farmAssignments.find(farm => farm.SfarmKey === a.sfarmKey);
    const pk = f.details.find(d => d.SdetailKey === original?.SdetailKey)?.ProdKey;
    if (!original || !f.farmCandidates[pk]?.some(farm => farm.FarmKey === a.farmKey) || a.quantity !== Number(original.ShipmentQuantity))
      issues.push({ code: 'APPROVAL_FARM_CONNECTION_INVALID', message: '농장만 연결 정정할 때 기존 배정수량은 보존해야 합니다.' });
  }
  const stockChanges = f.receiptPlan.changes.filter(c => c.delta !== 0).map(c => ({ prodKey: c.prodKey, delta: c.delta, year: f.correction.orderYear, week: f.correction.orderWeek }));
  for (const g of groups) if (g.stockDelta) stockChanges.push({ prodKey: g.product.ProdKey, delta: g.stockDelta, year: g.master.OrderYear, week: g.master.OrderWeek });
  const affected = new Set(stockChanges.map(c => c.prodKey));
  for(const pk of affected){
    const product=f.products.find(p=>p.ProdKey===pk),delta=stockChanges.filter(c=>c.prodKey===pk).reduce((s,c)=>s+c.delta,0);
    if(!Number.isFinite(product?.Stock)||Math.round((product.Stock+delta)*1000)<0)
      issues.push({code:'APPROVAL_NEGATIVE_STOCK',message:`${product?.ProdName??pk}: 최종 현재고가 부족하거나 현재고 기준이 없습니다.`});
  }
  const stockPreview = f.stocks.filter(s => affected.has(s.ProdKey)).map(s => ({ ...s,
    projected: s.Stock + stockChanges.filter(c => c.prodKey === s.ProdKey && `${c.year}${c.week}` <= `${s.OrderYear}${s.OrderWeek}`).reduce((sum, c) => sum + c.delta, 0) }));
  // The actual native calculation remains authoritative; this is a conservative preflight based on stored snapshots.
  for (const s of stockPreview.filter(s => Math.round(s.projected * 1000) < 0))
    issues.push({ code: 'APPROVAL_FUTURE_SHORTAGE', message: `${s.OrderYear}/${s.OrderWeek} 품목${s.ProdKey} 예상 부족 ${-s.projected}. 분배 또는 입고 수정안을 확인하세요.` });
  for (const g of groups.filter(g => !g.fixed && g.outQuantity > Number(g.detail?.OutQuantity ?? 0))) {
    const snapshots = f.stocks.filter(s => s.OrderYear === g.master.OrderYear && s.OrderWeek === g.master.OrderWeek && s.ProdKey === g.product.ProdKey);
    const inRange = m => m?.OrderYear === g.master.OrderYear && m.OrderWeek >= g.master.OrderWeek.slice(0,2)+'-01' && m.OrderWeek <= g.master.OrderWeek;
    let reserved = f.reservations.filter(r => r.ProdKey === g.product.ProdKey && inRange(r)).reduce((sum,r)=>sum+Number(r.Quantity),0);
    reserved += groups.filter(other => !other.fixed && other.product.ProdKey === g.product.ProdKey && inRange(other.master)).reduce((sum,other)=>sum+other.outQuantity-Number(other.detail?.OutQuantity??0),0);
    const projected = snapshots.length === 1 ? (stockPreview.find(s=>s.StockKey===snapshots[0].StockKey&&s.ProdKey===g.product.ProdKey)?.projected ?? snapshots[0].Stock) : null;
    if (projected === null || Math.round((projected-reserved)*1000)<0)
      issues.push({code:'APPROVAL_RESERVED_SHORTAGE',message:`${g.master.OrderYear}/${g.master.OrderWeek} ${g.product.ProdName}: 미확정 분배를 포함한 가용재고가 부족하거나 재고 기준이 없습니다.`});
  }
  const digest = approvalHash({ revision: row.payload.revision, facts: f, matching });
  return { ...f, matching, groups, stockPreview, digest, issues, canCommit: issues.length === 0,receiptIdentity,costPlan,farmPlan };
}

async function createMissingOrder(q, types, g, actor) {
  if (!g.orderRequired) return;
  if (!g.createOrder || g.outQuantity <= 0) throw approvalError('APPROVAL_ORDER_CONFIRM_REQUIRED', '양수 대체품 주문 신규 연결을 확인하세요.');
  const params = { year: p(types.NVarChar, g.master.OrderYear), week: p(types.NVarChar, g.master.OrderWeek), ck: p(types.Int, g.master.CustKey), pk: p(types.Int, g.product.ProdKey), actor: p(types.NVarChar, actor) };
  const masters = rows(await q(`SELECT om.OrderMasterKey FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
    JOIN UserInfo u WITH (HOLDLOCK) ON u.UserID=om.Manager
    WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.CustKey=@ck AND om.isDeleted=0 ORDER BY om.OrderMasterKey`, params));
  if (masters.length !== 1) throw approvalError('APPROVAL_ORDER_MASTER_REQUIRED', '대체품을 연결할 현재 차수의 활성 주문서가 하나여야 합니다.');
  const existing = rows(await q(`SELECT od.OrderDetailKey FROM OrderDetail od WITH (UPDLOCK,HOLDLOCK)
    JOIN OrderMaster om WITH (UPDLOCK,HOLDLOCK) ON om.OrderMasterKey=od.OrderMasterKey
    WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.CustKey=@ck AND om.isDeleted=0 AND od.ProdKey=@pk AND od.isDeleted=0`, params));
  if (existing.length) throw approvalError('APPROVAL_EXISTING_ORDER_HIDDEN', '기존 주문이 견적 연결에서 제외되어 있습니다. 중복 주문을 생성하지 않았습니다.');
  const u = g.units, est = g.product.EstUnit === '박스' ? u.box : g.product.EstUnit === '단' ? u.bunch : u.steam;
  await tryInsertWithRetry(q, 'OrderDetail', 'OrderDetailKey', async key => {
    await q(`INSERT OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
      VALUES(@key,@mk,@pk,@box,@bunch,@steam,@out,@est,0,N'입고 정정 승인 대체품',0,N'admin',GETDATE(),@actor,GETDATE());
      INSERT OrderHistory(OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
      VALUES(@key,N'신규',N'수량',N'0',@out,N'입고 정정 승인 대체품',@actor,GETDATE());`, {
      ...params, key: p(types.Int, key), mk: p(types.Int, masters[0].OrderMasterKey), box: p(types.Float, u.box), bunch: p(types.Float, u.bunch), steam: p(types.Float, u.steam), out: p(types.Float, g.outQuantity), est: p(types.Float, est),
    });
  });
  await syncKeyNumbering(q, 'OrderDetailKey', 'OrderDetail', 'OrderDetailKey');
}

async function writeDistribution(q, types, g, actor) {
  await createMissingOrder(q, types, g, actor);
  let key = g.detail?.SdetailKey;
  const params = { sk: p(types.Int, g.master.ShipmentKey), pk: p(types.Int, g.product.ProdKey), ck: p(types.Int, g.master.CustKey),
    out: p(types.Float, g.outQuantity), box: p(types.Float, g.units.box), bunch: p(types.Float, g.units.bunch), steam: p(types.Float, g.units.steam),
    est: p(types.Float, g.after.reduce((s, d) => s + Number(d.EstQuantity), 0)), amount: p(types.Float, g.amount), vat: p(types.Float, g.vat),
    cost: p(types.Float, g.cost), date: p(types.DateTime, new Date(g.after[0]?.ShipmentDtm ?? g.detail?.ShipmentDtm)), fixed: p(types.Bit, g.fixed), actor: p(types.NVarChar, actor) };
  if (!key && !g.outQuantity) return;
  if (!key) {
    key = await tryInsertWithRetry(q, 'ShipmentDetail', 'SdetailKey', async next => q(`INSERT ShipmentDetail
      (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
      VALUES(@key,@sk,@ck,@pk,@date,@out,@box,@bunch,@steam,@est,@cost,@amount,@vat,@fixed,N'',N'')`, { ...params, key: p(types.Int, next) }));
    await syncKeyNumbering(q, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
  } else {
    await q(`UPDATE ShipmentDetail SET OutQuantity=@out,BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,
      EstQuantity=@est,Cost=@cost,Amount=@amount,Vat=@vat WHERE SdetailKey=@key AND ShipmentKey=@sk AND ProdKey=@pk;
      IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_SHIPMENT_CHANGED',1;`, { ...params, key: p(types.Int, key) });
  }
  g.resultDetailKey = key;
  const retained = g.after.filter(d => d.SdateKey).map(d => d.SdateKey);
  await q(`DELETE FROM ShipmentDate WHERE SdetailKey=@key AND SdateKey NOT IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@retained))`, { key: p(types.Int, key), retained: p(types.NVarChar, JSON.stringify(retained)) });
  for (const d of g.after) {
    const dp = { key: p(types.Int, key), dateKey: p(types.Int, d.SdateKey), date: p(types.DateTime, new Date(d.ShipmentDtm)),
      qty: p(types.Float, d.ShipmentQuantity), est: p(types.Float, d.EstQuantity), cost: p(types.Float, d.Cost), amount: p(types.Float, d.Amount), vat: p(types.Float, d.Vat), descr: p(types.NVarChar, d.Descr ?? '') };
    if (d.SdateKey) await q(`UPDATE ShipmentDate SET ShipmentDtm=@date,ShipmentQuantity=@qty,EstQuantity=@est,Cost=@cost,Amount=@amount,Vat=@vat
      WHERE SdateKey=@dateKey AND SdetailKey=@key; IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_SHIPMENT_DATE_CHANGED',1;`, dp);
    else await q(`INSERT ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(@key,@date,@qty,@est,@cost,@amount,@vat,@descr)`, dp);
  }
  await q(`INSERT ShipmentHistory(SdetailKey,ChangeType,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
    VALUES(@key,N'수정',@before,@after,N'입고 정정 승인',@actor,GETDATE())`, {
    key: p(types.Int, key), before: p(types.NVarChar, String(g.detail?.OutQuantity ?? 0)), after: p(types.NVarChar, String(g.outQuantity)), actor: p(types.NVarChar, actor),
  });
  if (!g.outQuantity) {
    await q('DELETE FROM ShipmentFarm WHERE SdetailKey=@key; DELETE FROM ShipmentDetail WHERE SdetailKey=@key', { key: p(types.Int, key) });
  } else await assertShipmentLineHasOrder(q, types, { orderYear: g.master.OrderYear, orderWeek: g.master.OrderWeek, custKey: g.master.CustKey, prodKey: g.product.ProdKey });
}

export async function commitIncomingApproval({ withTransactionFn, types, user, input, rehearsal = false }) {
  if (!approvalPermissions(user).review) throw approvalError('APPROVAL_FORBIDDEN', '영업지원 확정 권한이 필요합니다.', 403);
  if (!rehearsal && (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.digest ?? '') || !/^[a-f0-9-]{36}$/i.test(input.operationId ?? '')))
    throw approvalError('APPROVAL_CONFIRM_REQUIRED', '영향 미리보기를 확인하고 최종 확정하세요.', 400);
  return withTransactionFn(async q => {
    const tx = await acquireInvoiceReceiptGate(q, types);
    const row = await readApproval(q, types, input.requestId, true);
    assertApprovalAccess(row, user);
    if (!rehearsal && row.Status === 'applied' && row.payload.result?.operationId === input.operationId) {
      if (row.payload.result.digest !== input.digest || row.DecidedBy !== user.userId) throw approvalError('APPROVAL_OPERATION_CONFLICT', '같은 작업번호의 확정 내용이 다릅니다.');
      return { ...row.payload.result, replayed: true };
    }
    assertApprovalRevision(row, input.revision);
    if (row.Status !== 'requested') throw approvalError('APPROVAL_STATE_INVALID', '검토 대기 요청만 확정할 수 있습니다.');
    const f = await prepareIncomingApproval(q, types, row, true);
    if (!f.canCommit) {if(rehearsal)return {preview:f};throw approvalError(f.issues[0].code, f.issues[0].message);}
    if (!rehearsal && f.digest !== input.digest) throw approvalError('APPROVAL_PREVIEW_STALE', '미리보기 이후 원장이 변경됐습니다. 다시 검토하세요.');
    const profitBefore=f.profitFacts?.periods?.length?await computeIncomingApprovalProfit({q,types,facts:f.profitFacts,externalEvidence:input.externalEvidence??{}}):null;
    const scope = f.correction, actor = user.userId;
    const params = { ...tx, wk: p(types.Int, scope.warehouseKey), year: p(types.NVarChar, scope.orderYear), week: p(types.NVarChar, scope.orderWeek), farm: p(types.NVarChar, scope.farmName), actor: p(types.NVarChar, actor) };
    await q(`${receiptTransactionCheckSql} UPDATE WarehouseMaster SET FarmName=@farm,LastUpdateID=@actor,LastUpdateDtm=GETDATE()
      WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0;
      IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_WAREHOUSE_CHANGED',1;`, params);
    const targetDetails=f.receiptPlan.detailsChanged?await writeApprovalReceiptDetails(q,types,scope,f.receiptIdentity)
      :f.receipt.details.map((d,targetRowIndex)=>({...d,targetRowIndex}));
    for (const g of f.groups) await writeDistribution(q, types, g, actor);
    for (const a of f.matching.farms) await q('UPDATE ShipmentFarm SET FarmKey=@farm WHERE SfarmKey=@key; IF @@ROWCOUNT<>1 THROW 51104,\'INCOMING_FARM_CHANGED\',1;', { farm: p(types.Int, a.farmKey), key: p(types.Int, a.sfarmKey) });
    let afterFarmAssignments=f.farmAssignments;
    if(f.matching.farms.length){
      afterFarmAssignments=rows(await q(`SELECT * FROM ShipmentFarm WITH (HOLDLOCK) WHERE SfarmKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) ORDER BY SfarmKey`,{keys:p(types.NVarChar,JSON.stringify(f.farmAssignments.map(a=>a.SfarmKey)))}));
      const expected=f.farmAssignments.map(a=>({...a,FarmKey:f.matching.farms.find(change=>change.sfarmKey===a.SfarmKey)?.farmKey??a.FarmKey}));
      if(approvalHash(afterFarmAssignments)!==approvalHash(expected))throw approvalError('APPROVAL_FARM_READBACK_FAILED','농장 연결 저장 검산이 실패하여 전체 취소합니다.');
    }
    const farmEvidence=await writeApprovalFarmGroups(q,types,f.farmPlan.plans,f.farms);
    const changes = f.receiptPlan.changes.filter(c => c.delta !== 0).map(c => ({ prodKey: c.prodKey, delta: c.delta, year: scope.orderYear, week: scope.orderWeek, type: '입고' }));
    for (const g of f.groups) if (g.stockDelta) changes.push({ prodKey: g.product.ProdKey, delta: g.stockDelta, year: g.master.OrderYear, week: g.master.OrderWeek, type: '출고' });
    // Check the combined final balance; the transient A decrease before A shipment reduction must not fail.
    const total = new Map(); for (const c of changes) total.set(c.prodKey, (total.get(c.prodKey) ?? 0) + c.delta);
    for (const [pk, delta] of total) {
      const stock = rows(await q('SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0', { pk: p(types.Int, pk) }));
      if (stock.length !== 1 || !Number.isFinite(stock[0].Stock) || Math.round((stock[0].Stock + delta) * 1000) < 0)
        throw approvalError('APPROVAL_NEGATIVE_STOCK', `품목 ${pk}의 최종 현재고가 부족합니다. 전체 변경을 취소합니다.`);
      let current = stock[0].Stock;
      for (const c of changes.filter(c => c.prodKey === pk)) {
        await q(`INSERT StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
          VALUES(GETDATE(),@year,@week,@actor,@type,N'수량',@before,@after,@descr,@pk)`, {
          year: p(types.NVarChar, c.year), week: p(types.NVarChar, c.week), actor: p(types.NVarChar, actor), type: p(types.NVarChar, c.type), before: p(types.Float, current), after: p(types.Float, current + c.delta), descr: p(types.NVarChar, `입고 정정 요청 #${row.RequestId}`), pk: p(types.Int, pk),
        }); current += c.delta;
      }
      await q('UPDATE Product SET Stock=@stock WHERE ProdKey=@pk AND isDeleted=0', { stock: p(types.Float, current), pk: p(types.Int, pk) });
    }
    const keys = [...total.keys()];
    if (keys.length) {
      await recalculateChangedProducts(q, types, tx, scope, keys, actor);
      await verifyInvoiceStockReadback(q, types, scope, keys);
      const negative = rows(await q(`SELECT ps.ProdKey,sm.OrderYear,sm.OrderWeek,ps.Stock FROM ProductStock ps WITH (HOLDLOCK)
        JOIN StockMaster sm WITH (HOLDLOCK) ON sm.StockKey=ps.StockKey WHERE sm.OrderYearWeek>=@year+REPLACE(@week,N'-',N'')
        AND ps.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) AND ROUND(ps.Stock,3)<0`, { ...params, keys: p(types.NVarChar, JSON.stringify(keys)) }));
      if (negative.length) throw approvalError('APPROVAL_FUTURE_SHORTAGE', `후속 차수 재고 부족: ${negative.slice(0, 10).map(n => `${n.OrderYear}/${n.OrderWeek} 품목${n.ProdKey} ${-n.Stock}`).join(', ')}. 전체 변경을 취소합니다.`);
    }
    // New or increased unfixed allocations reserve inventory even though native stock only deducts fixed details.
    for (const g of f.groups.filter(g => !g.fixed && g.outQuantity > Number(g.detail?.OutQuantity ?? 0))) {
      const remaining = rows(await q(`SELECT ps.Stock-ISNULL((SELECT SUM(vs.OutQuantity) FROM ViewShipment vs WITH (HOLDLOCK)
        WHERE vs.OrderYear=@year AND vs.OrderWeek>=LEFT(@week,2)+N'-01' AND vs.OrderWeek<=@week AND vs.ProdKey=@pk AND ISNULL(vs.DetailFix,0)=0),0) Remain
        FROM ProductStock ps WITH (HOLDLOCK) JOIN StockMaster sm WITH (HOLDLOCK) ON sm.StockKey=ps.StockKey
        WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND ps.ProdKey=@pk`, {
        year: p(types.NVarChar, g.master.OrderYear), week: p(types.NVarChar, g.master.OrderWeek), pk: p(types.Int, g.product.ProdKey),
      }));
      if (remaining.length !== 1 || !Number.isFinite(remaining[0].Remain) || Math.round(remaining[0].Remain * 1000) < 0)
        throw approvalError('APPROVAL_RESERVED_SHORTAGE', `${g.master.OrderYear}/${g.master.OrderWeek} ${g.product.ProdName}: 미확정 분배를 포함한 가용재고가 부족합니다. 전체 변경을 취소합니다.`);
    }
    for (const g of f.groups.filter(g => g.outQuantity > 0)) {
      const verified = rows(await q(`SELECT sd.OutQuantity,sd.Amount,sd.Vat,sd.isFix,
        (SELECT SUM(d.ShipmentQuantity) FROM ShipmentDate d WHERE d.SdetailKey=sd.SdetailKey) DateQuantity,
        (SELECT SUM(d.Amount) FROM ShipmentDate d WHERE d.SdetailKey=sd.SdetailKey) DateAmount,
        (SELECT SUM(d.Vat) FROM ShipmentDate d WHERE d.SdetailKey=sd.SdetailKey) DateVat,
        (SELECT COUNT(*) FROM ShipmentDate d JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm AND pd.OrderYearWeek=@year+LEFT(@week,2)
          WHERE d.SdetailKey=sd.SdetailKey AND d.EstQuantity>0) VisibleDates,
        (SELECT COUNT(*) FROM ViewShipment vs WHERE vs.SdetailKey=sd.SdetailKey AND vs.OrderYear=@year AND vs.OrderWeek=@week AND vs.CustKey=@ck AND vs.ProdKey=@pk) Visible
        FROM ShipmentDetail sd WHERE sd.SdetailKey=@key`, { key: p(types.Int, g.resultDetailKey), year: p(types.NVarChar, g.master.OrderYear), week: p(types.NVarChar, g.master.OrderWeek), ck: p(types.Int, g.master.CustKey), pk: p(types.Int, g.product.ProdKey) }))[0];
      if (!verified || verified.Visible !== 1 || verified.VisibleDates !== g.after.length || [verified.OutQuantity, verified.DateQuantity].some(n => Math.abs(n - g.outQuantity) > 1e-6)
        || [verified.Amount, verified.DateAmount].some(n => Math.abs(n - g.amount) > 1e-6)
        || [verified.Vat, verified.DateVat].some(n => Math.abs(n - g.vat) > 1e-6) || !!verified.isFix !== g.fixed)
        throw approvalError('APPROVAL_SALES_READBACK_FAILED', '분배·견적·매출 검산이 일치하지 않아 전체 취소합니다.');
    }
    const after = await readReceipt(q, types, scope, true);
    after.targetDetails=targetDetails;
    const canonical = list => list.map(d => correctionDetailFields.map(k => d[k] ?? null)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const expectedDetails=[...f.receiptPlan.after,...f.receiptIdentity.removed.filter(r=>r.preserve).map(({row})=>({...row,BoxQuantity:0,BunchQuantity:0,SteamQuantity:0,OutQuantity:0,EstQuantity:0,TPrice:0}))];
    if (after.header.FarmName !== scope.farmName || approvalHash(canonical(after.details)) !== approvalHash(canonical(expectedDetails)))
      throw approvalError('APPROVAL_RECEIPT_READBACK_FAILED', '입고 저장 검산이 실패하여 전체 취소합니다.');
    const costEvidence=f.costPlan?await writeIncomingApprovalCosts({q,types,plan:f.costPlan,beforeReceipt:f.receipt,afterReceipt:after,actor,requestId:row.RequestId}):null;
    const profitAfter=f.profitFacts?.periods?.length?await computeIncomingApprovalProfit({q,types,facts:f.profitFacts,externalEvidence:input.externalEvidence??{}}):null;
    const financialSummary={costs:f.costPlan?.summary??null,profitBefore:f.profitFacts?summarizeStoredApprovalProfit(f.profitFacts).map(({orderYear,major,sourceHash,totals})=>({orderYear,major,sourceHash,totals})):[],
      computedBefore:profitBefore?.periods?.map(({orderYear,major,sourceHash,semanticHash})=>({orderYear,major,sourceHash,semanticHash}))??[],
      profitAfter:profitAfter?.periods?.map(({orderYear,major,sourceHash,semanticHash,payload})=>({orderYear,major,sourceHash,semanticHash,totals:payload.totals}))??[]};
    const financialHash=approvalHash(financialSummary);
    if(!rehearsal&&(f.costPlan||f.profitFacts?.periods?.length)&&!input.financialHash)throw approvalError('APPROVAL_FINANCIAL_REVIEW_REQUIRED','원가·손익 최종 검토를 먼저 실행하세요.');
    if(!rehearsal&&input.financialHash&&input.financialHash!==financialHash)throw approvalError('APPROVAL_FINANCIAL_STALE','원가·손익 검산값이 미리보기와 달라졌습니다. 다시 검토하세요.');
    const profitEvidence=profitAfter?await writeIncomingApprovalProfit({q,types,before:f.profitFacts,after:profitAfter,actor,requestId:row.RequestId,reason:f.matching.financial.reason||row.payload.reason}):null;
    const result = { requestId: row.RequestId, operationId: input.operationId, digest: input.digest, warehouseKey: scope.warehouseKey,
      shipmentGroups: f.groups.length, stockProducts: keys.length, status: 'applied', erpWritePerformed: true,
      financialHash,costRevisions:costEvidence,profitRevisions:profitEvidence };
    await q(receiptTransactionCheckSql, tx);
    if(rehearsal)return {preview:{...f,financialSummary,financialHash,farmEvidence},externalEvidence:input.externalEvidence??{}};
    await saveApprovalState(q, types, row, { status: 'applied', actor, action: 'approve', note: row.payload.reason,
      payload: { ...row.payload, result, appliedAt: new Date().toISOString(), evidence: { before: f.receipt, after, receiptChanges: f.receiptPlan.changes, matching: f.matching, groups: f.groups,beforeFarmAssignments:f.farmAssignments,afterFarmAssignments,farmEvidence,costEvidence,profitEvidence,financialSummary } } });
    return result;
  }, { retries: 0, rollbackOnly:rehearsal });
}

export async function previewIncomingApproval({withTransactionFn,types,user,input}){
  const externalEvidence={};
  for(let attempt=0;attempt<8;attempt++){
    try{return await commitIncomingApproval({withTransactionFn,types,user,input:{...input,externalEvidence},rehearsal:true});}
    catch(error){
      if(error.code!=='APPROVAL_EXTERNAL_EVIDENCE_REQUIRED')throw error;
      const keys=error.evidenceKeys.filter(key=>!Object.hasOwn(externalEvidence,key));
      if(!keys.length||keys.length>500)throw approvalError('APPROVAL_EVIDENCE_LIMIT','환율 근거 조회 범위를 확인하세요.');
      for(const key of keys){const [currency,declarationDate]=key.split('::');externalEvidence[key]=await getKcsTaxableRate({currency,declarationDate});}
    }
  }
  throw approvalError('APPROVAL_EVIDENCE_LIMIT','보고서 근거를 모두 조회하지 못했습니다. 다시 검토하세요.');
}
