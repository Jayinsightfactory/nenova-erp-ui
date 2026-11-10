import { query, sql } from './db.js';
import { classifyCategory, isNonInventoryCostItem, isNonValueWeightItem } from './profitReportClassification.js';
import { COLOMBIA_ALLOC_CATEGORIES } from './customsForwardingCalc.js';
import settlement from './customsSettlementPlan.cjs';
import { isGrossWeightItem, freightWeightOfRow } from './freightCalc.js';
import { countryToCurrency } from './countryClassification.js';

const { scopeOf, awbOf } = settlement;
export const SETTLEMENT_WAREHOUSE_SQL = `SELECT wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.OrderNo,
       p.ProdKey, p.CounName, p.FlowerName, p.ProdName, wd.WdetailKey, wd.TPrice,
       wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wm.GrossWeight
       FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey=wd.ProdKey
       WHERE CAST(wm.OrderYear AS nvarchar(4))=@yr AND ISNULL(wm.isDeleted,0)=0`;
export async function loadSettlementYearCandidates(year) {
  const scope=scopeOf(year,1);
  const r=await query(SETTLEMENT_WAREHOUSE_SQL,{yr:{type:sql.NVarChar,value:scope.year}});
  const majors=[...new Set(r.recordset.map(x=>String(x.OrderWeek).split('-')[0]))];
  return majors.flatMap(major=>settlementContextFromRows({year:scope.year,major,warehouse:r.recordset,countries:[],colombia:[],confirmed:false}).candidates);
}
// Never call any ERP writer, stock procedure, or runtime schema initializer here.
export async function loadSettlementContext(year, major) {
  const scope = scopeOf(year, major);
  const params = { yr: { type: sql.NVarChar, value: scope.year }, mw: { type: sql.NVarChar, value: scope.major }, prefix: { type: sql.NVarChar, value: `${scope.major}-%` } };
  const [warehouse, countries, colombia, confirmation] = await Promise.all([
    query(`${SETTLEMENT_WAREHOUSE_SQL} AND wm.OrderWeek LIKE @prefix`, params),
    query('SELECT * FROM WebCustomsWeekly WHERE OrderYear=@yr AND MajorWeek=@mw', params),
    query('SELECT * FROM WebColombiaWeekly WHERE OrderYear=@yr AND OrderWeek LIKE @prefix', params),
    query('SELECT ConfirmKey FROM WebProfitReportConfirm WHERE OrderYear=@yr AND MajorWeek=@mw AND IsActive=1', params),
  ]);
  return settlementContextFromRows({ ...scope, warehouse: warehouse.recordset, countries: countries.recordset, colombia: colombia.recordset, confirmed: confirmation.recordset.length > 0 });
}

export function settlementContextFromRows({ year, major, warehouse, countries, colombia, confirmed }) {
  const scope = scopeOf(year, major), groups = new Map(), candidates = [], saved = {}, mapping = {};
  for (const row of warehouse) {
    const awb = awbOf(row.OrderNo);
    if (!awb || String(row.OrderYear) !== scope.year || Number(row.isDeleted) === 1 || !String(row.OrderWeek).startsWith(`${scope.major}-`)) continue;
    const key = `${awb}|${row.OrderWeek}`;
    const group = groups.get(key) || { awb, orderWeek: row.OrderWeek, categories: new Set(), headerKeys: new Set(), details:new Map(), weights:new Map(), headerWeights:new Map() };
    group.headerKeys.add(row.WarehouseKey);
    if (row.WdetailKey != null) group.details.set(row.WdetailKey,Number(row.TPrice)||0);
    if (isGrossWeightItem(row.ProdName)) group.weights.set(row.WdetailKey,freightWeightOfRow(row));
    if (Number(row.GrossWeight)>0) group.headerWeights.set(row.WarehouseKey,Number(row.GrossWeight));
    if (String(row.ProdName ?? '').trim() && String(row.CounName ?? '').trim() && !isNonInventoryCostItem(row.ProdName) && !isNonValueWeightItem(row.ProdName)) {
      const category = classifyCategory(row.CounName, row.FlowerName, row.ProdName);
      if (category && category !== '기타(미분류)') group.categories.add(category);
    }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const cats = [...group.categories];
    const pooled = cats.some(c => COLOMBIA_ALLOC_CATEGORIES.includes(c)) && cats.every(c => COLOMBIA_ALLOC_CATEGORIES.includes(c) || c === '콜롬비아 수국');
    const phase = Number(String(group.orderWeek).split('-')[1]);
    const targetKey = pooled ? `colombia|${group.orderWeek}` : cats.length === 1 && [1, 2].includes(phase) ? `country|${cats[0]}|${String(phase).padStart(2, '0')}` : null;
    candidates.push({ year: scope.year, orderWeek: group.orderWeek, awb: group.awb, matchId:`${scope.year}|${group.orderWeek}|${group.awb}`, targetKey, categories: cats.sort(), headerKeys: [...group.headerKeys].sort((a, b) => a - b), foreignAmount:group.details.size?[...group.details.values()].reduce((a,b)=>a+b,0):null,grossWeight:group.weights.size?[...group.weights.values()].reduce((a,b)=>a+b,0):group.headerWeights.size?[...group.headerWeights.values()].reduce((a,b)=>a+b,0):null,currency:cats.length?countryToCurrency(cats[0]):null });
    if (!targetKey) continue;
    if (pooled) {
      saved[targetKey] = colombia.find(r => r.OrderWeek === group.orderWeek) || {};
      mapping[targetKey] = { DUTY: { field: 'CustomsFee', basis: 'total' }, HANDLING: { field: 'HandlingFee', basis: 'net' }, QUARANTINE_AGENCY: { field: 'ActualQuarantineAgencyFee', basis: 'net' } };
    } else {
      const row = { ...(countries.find(r => r.Category === cats[0]) || {}) };
      for (const stem of ['Customs', 'SunYul']) {
        const total = `${stem}${phase}`, parts = [1, 2, 3].map(i => `${total}_${i}`);
        if (!parts.some(f => row[f] != null && row[f] !== '') && row[total] != null) row[parts[0]] = row[total];
      }
      saved[targetKey] = row;
      mapping[targetKey] = { DUTY: { field: `Customs${phase}_1`, basis: 'total' }, HANDLING: { field: `SunYul${phase}_1`, basis: cats[0] === '베트남' ? 'net' : 'total' }, QUARANTINE_AGENCY: { field: `SunYul${phase}_1`, basis: cats[0] === '베트남' ? 'net' : 'total' } };
    }
  }
  return { ...scope, candidates: candidates.sort((a, b) => `${a.awb}|${a.orderWeek}`.localeCompare(`${b.awb}|${b.orderWeek}`)), saved, mapping, confirmed };
}
