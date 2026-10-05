import { sql } from './db.js';
import { digestDutchSnapshot, dutchError } from './dutchVolumeDistribution.js';

// The same year/week/category scope is read at preview and, with held update locks,
// inside the apply transaction. A changed category member is a stale plan too.
export async function readDutchScopeSnapshot(queryFn, { year, week, categories, pairs = [] }, lock = false) {
  if (!Array.isArray(categories) || !categories.length || categories.length > 30) {
    throw dutchError('EMPTY_DUTCH_SCOPE', '네덜란드 국가·품종 교체 범위가 비었습니다.', 409);
  }
  const categoryParams = {};
  const categorySql = categories.map((category, index) => {
    categoryParams[`cat${index}`] = { type: sql.NVarChar, value: String(category) };
    return `@cat${index}`;
  }).join(',');
  const params = {
    ...categoryParams,
    year: { type: sql.NVarChar, value: String(year) },
    week: { type: sql.NVarChar, value: String(week) },
  };
  const hint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const productScope = `p.CounName=N'네덜란드' AND p.CountryFlower IN (${categorySql}) AND ISNULL(p.isDeleted,0)=0`;
  const products = (await queryFn(
    `SELECT p.ProdKey,p.ProdName,p.DisplayName,p.CounName,p.CountryFlower,p.OutUnit,p.EstUnit,
            p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,p.Cost,p.isDeleted
       FROM Product p${hint} WHERE ${productScope} ORDER BY p.ProdKey`, params
  )).recordset || [];
  const orders = (await queryFn(
    `SELECT om.OrderMasterKey AS MasterKey,om.CustKey,om.OrderYear,om.OrderWeek,om.Manager,om.isDeleted AS MasterDeleted,od.*
       FROM OrderMaster om${hint}
       JOIN OrderDetail od${hint} ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
       JOIN Product p${hint} ON p.ProdKey=od.ProdKey
      WHERE om.OrderWeek=@week AND CAST(om.OrderYear AS NVARCHAR(4))=@year
        AND ISNULL(om.isDeleted,0)=0 AND ${productScope}
      ORDER BY om.CustKey,od.ProdKey,om.OrderMasterKey,od.OrderDetailKey`, params
  )).recordset || [];
  const shipments = (await queryFn(
    `SELECT sm.ShipmentKey AS MasterKey,sm.CustKey AS MasterCustKey,sm.OrderYear,sm.OrderWeek,
            sm.isFix AS MasterFix,sm.isDeleted AS MasterDeleted,sd.*
       FROM ShipmentMaster sm${hint}
       JOIN ShipmentDetail sd${hint} ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p${hint} ON p.ProdKey=sd.ProdKey
      WHERE sm.OrderWeek=@week AND CAST(sm.OrderYear AS NVARCHAR(4))=@year
        AND ISNULL(sm.isDeleted,0)=0 AND ${productScope}
      ORDER BY sm.CustKey,sd.ProdKey,sm.ShipmentKey,sd.SdetailKey`, params
  )).recordset || [];
  const dates = (await queryFn(
    `SELECT sdt.*
       FROM ShipmentMaster sm${hint}
       JOIN ShipmentDetail sd${hint} ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p${hint} ON p.ProdKey=sd.ProdKey
       JOIN ShipmentDate sdt${hint} ON sdt.SdetailKey=sd.SdetailKey
      WHERE sm.OrderWeek=@week AND CAST(sm.OrderYear AS NVARCHAR(4))=@year
        AND ISNULL(sm.isDeleted,0)=0 AND ${productScope}
      ORDER BY sd.SdetailKey,sdt.SdateKey`, params
  )).recordset || [];
  const farms = (await queryFn(
    `SELECT sf.*
       FROM ShipmentMaster sm${hint}
       JOIN ShipmentDetail sd${hint} ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p${hint} ON p.ProdKey=sd.ProdKey
       JOIN ShipmentFarm sf${hint} ON sf.SdetailKey=sd.SdetailKey
      WHERE sm.OrderWeek=@week AND CAST(sm.OrderYear AS NVARCHAR(4))=@year
        AND ISNULL(sm.isDeleted,0)=0 AND ${productScope}
      ORDER BY sd.SdetailKey,sf.FarmKey`, params
  )).recordset || [];
  const pairKeys = [...new Set(pairs.map(row => Number(row.custKey)).filter(Number.isSafeInteger))].sort((a, b) => a - b);
  const customers = [];
  const orderMasters = [];
  const shipmentMasters = [];
  for (let start = 0; start < pairKeys.length; start += 500) {
    const group = pairKeys.slice(start, start + 500);
    const keys = Object.fromEntries(group.map((key, index) => [`ck${index}`, { type: sql.Int, value: key }]));
    const keySql = group.map((_, index) => `@ck${index}`).join(',');
    const result = await queryFn(
      `SELECT CustKey,CustName,OrderCode,BaseOutDay,isDeleted FROM Customer${hint} WHERE CustKey IN (${keySql}) ORDER BY CustKey`, keys
    );
    customers.push(...(result.recordset || []));
    const masterParams = { ...keys, week: params.week, year: params.year };
    const om = await queryFn(
      `SELECT * FROM OrderMaster${hint} WHERE CustKey IN (${keySql}) AND OrderWeek=@week
         AND ISNULL(isDeleted,0)=0 AND (CAST(OrderYear AS NVARCHAR(4))=@year OR OrderYear IS NULL)
       ORDER BY CustKey,OrderMasterKey`, masterParams
    );
    orderMasters.push(...(om.recordset || []));
    const sm = await queryFn(
      `SELECT * FROM ShipmentMaster${hint} WHERE CustKey IN (${keySql}) AND OrderWeek=@week
         AND ISNULL(isDeleted,0)=0 AND (CAST(OrderYear AS NVARCHAR(4))=@year OR OrderYear IS NULL)
       ORDER BY CustKey,ShipmentKey`, masterParams
    );
    shipmentMasters.push(...(sm.recordset || []));
  }
  customers.sort((a, b) => Number(a.CustKey) - Number(b.CustKey));
  orderMasters.sort((a, b) => Number(a.CustKey) - Number(b.CustKey) || Number(a.OrderMasterKey) - Number(b.OrderMasterKey));
  shipmentMasters.sort((a, b) => Number(a.CustKey) - Number(b.CustKey) || Number(a.ShipmentKey) - Number(b.ShipmentKey));
  const costs = [];
  const uniquePairs = [...new Map(pairs.map(pair => [`${pair.custKey}|${pair.prodKey}`, pair])).values()]
    .sort((a, b) => Number(a.custKey) - Number(b.custKey) || Number(a.prodKey) - Number(b.prodKey));
  for (let start = 0; start < uniquePairs.length; start += 500) {
    const group = uniquePairs.slice(start, start + 500);
    const costParams = {};
    const keyRows = group.map((pair, index) => {
      costParams[`ck${index}`] = { type: sql.Int, value: Number(pair.custKey) };
      costParams[`pk${index}`] = { type: sql.Int, value: Number(pair.prodKey) };
      return `(@ck${index},@pk${index})`;
    }).join(',');
    const result = await queryFn(
      `SELECT cpc.* FROM CustomerProdCost cpc${hint}
         JOIN (VALUES ${keyRows}) target(CustKey,ProdKey)
           ON target.CustKey=cpc.CustKey AND target.ProdKey=cpc.ProdKey
        ORDER BY cpc.CustKey,cpc.ProdKey,cpc.AutoKey`, costParams
    );
    costs.push(...(result.recordset || []));
  }
  costs.sort((a, b) => Number(a.CustKey) - Number(b.CustKey) || Number(a.ProdKey) - Number(b.ProdKey) || Number(a.AutoKey) - Number(b.AutoKey));
  const snapshot = { products, customers, orderMasters, shipmentMasters, costs, orders, shipments, dates, farms };
  return { snapshot, digest: digestDutchSnapshot(snapshot) };
}

export function assertUniqueDutchLedger(snapshot) {
  for (const [kind, masters] of [['주문', snapshot.orderMasters || []], ['분배', snapshot.shipmentMasters || []]]) {
    const seen = new Set();
    for (const master of masters) {
      if (master.OrderYear == null) throw dutchError('NULL_YEAR_MASTER', `${kind} 원장에 연도 없는 동일 차수 업체 Master가 있어 안전하게 적용할 수 없습니다.`, 409);
      const key = `${master.CustKey}|${master.OrderYear}|${master.OrderWeek}`;
      if (seen.has(key)) throw dutchError('DUPLICATE_LEDGER_MASTER', `${kind} 원장에 같은 연도·차수 업체 Master가 중복됩니다: ${key}`, 409);
      seen.add(key);
    }
  }
  for (const [kind, rows, custField] of [
    ['주문', snapshot.orders, 'CustKey'],
    ['분배', snapshot.shipments, 'MasterCustKey'],
  ]) {
    const seen = new Set();
    for (const row of rows) {
      const key = `${row[custField]}|${row.ProdKey}`;
      if (seen.has(key)) throw dutchError('DUPLICATE_LEDGER_PAIR', `${kind} 원장에 중복 업체·품목 행이 있어 안전하게 교체할 수 없습니다: ${key}`, 409);
      seen.add(key);
    }
  }
  const datesByDetail = new Map();
  for (const date of snapshot.dates) {
    const key = Number(date.SdetailKey);
    datesByDetail.set(key, [...(datesByDetail.get(key) || []), date]);
  }
  const farmByDetail = new Map();
  for (const farm of snapshot.farms) {
    const key = Number(farm.SdetailKey);
    farmByDetail.set(key, [...(farmByDetail.get(key) || []), farm]);
  }
  return { datesByDetail, farmByDetail };
}

export function findDutchFarmQtyBlockers(snapshot, rows) {
  const assigned = new Set((snapshot.farms || []).map(row => Number(row.SdetailKey)));
  const shipmentByPair = new Map((snapshot.shipments || []).map(row => [`${row.MasterCustKey}|${row.ProdKey}`, row]));
  return (rows || []).flatMap(row => {
    const current = shipmentByPair.get(`${row.custKey}|${row.prodKey}`);
    if (!current || !assigned.has(Number(current.SdetailKey))) return [];
    const finalQty = Number(row.uploadQty);
    const oldQty = Number(current.OutQuantity || 0);
    if (!(finalQty > 0) || Math.abs(finalQty - oldQty) <= 0.0001) return [];
    return [`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 농장 배정이 있는 분배 ${oldQty}→${finalQty} 변경은 배정수량 불일치 위험으로 차단됩니다.`];
  });
}

export function findDutchDateIntegrityBlockers(snapshot, rows) {
  const datesByDetail = new Map();
  for (const date of snapshot.dates || []) {
    const key = Number(date.SdetailKey);
    if (!datesByDetail.has(key)) datesByDetail.set(key, []);
    datesByDetail.get(key).push(date);
  }
  const shipmentByPair = new Map((snapshot.shipments || []).map(row => [`${row.MasterCustKey}|${row.ProdKey}`, row]));
  return (rows || []).flatMap(row => {
    if (!(Number(row.uploadQty) > 0)) return [];
    const detail = shipmentByPair.get(`${row.custKey}|${row.prodKey}`);
    if (!detail || !(Number(detail.OutQuantity) > 0)) return [];
    const dates = datesByDetail.get(Number(detail.SdetailKey)) || [];
    const total = dates.reduce((sum, date) => sum + Number(date.ShipmentQuantity || 0), 0);
    const representative = detail.ShipmentDtm && new Date(detail.ShipmentDtm).getTime();
    const valid = dates.length > 0 && Math.abs(total - Number(detail.OutQuantity || 0)) <= 0.0001
      && dates.every(date => date.ShipmentDtm != null)
      && Number.isFinite(representative)
      && dates.some(date => new Date(date.ShipmentDtm).getTime() === representative);
    return valid ? [] : [`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 기존 출고일 수량합·대표일이 일치하지 않아 자동 보정하지 않습니다.`];
  });
}
