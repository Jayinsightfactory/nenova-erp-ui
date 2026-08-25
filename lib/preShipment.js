import { query, sql, withTransaction } from './db.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import { normalizePreShipmentScope } from './preShipmentWorkbook.js';
import { rankProductSearchOptions } from './productSearchRanking.js';
import { loadPreShipmentErpStatus, resolvePreShipmentCustomer } from './preShipmentErpStatus.js';

const requirements = [
  { table: 'WebPreShipmentPlan', columns: ['PlanKey', 'OrderYear', 'MajorWeek'] },
  { table: 'WebPreShipmentItem', columns: ['ItemKey', 'PlanKey', 'SpeciesName', 'ItemName', 'ProdKey', 'MatchedProdName'] },
  { table: 'WebPreShipmentSchedule', columns: ['ScheduleKey', 'PlanKey', 'ShipmentDate', 'TargetMajorWeek'] },
  { table: 'WebPreShipmentAllocation', columns: ['AllocationKey', 'ScheduleKey', 'ItemKey', 'Quantity'] },
];
export const assertPreShipmentSchema = () => assertWebSchemaContract('pre-shipment-management', requirements);
const p = (type, value) => ({ type, value });

function decimalValue(value, fieldName) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${fieldName}은 0 이상의 숫자여야 합니다.`);
  return parsed;
}

/** 웹 전용 수기 품목의 입력 기준. ERP 주문/출고 수량과 무관하다. */
export function normalizeManualPreShipmentItem(input = {}) {
  const speciesName = String(input.speciesName || '').trim();
  const itemName = String(input.itemName || '').trim();
  if (!speciesName) throw new Error('품종을 입력하세요.');
  if (!itemName) throw new Error('품목명을 입력하세요.');
  return {
    speciesName: speciesName.slice(0, 100),
    itemName: itemName.slice(0, 200),
    orderBoxQty: decimalValue(input.orderBoxQty, '발주 박스'),
    orderUnitQty: decimalValue(input.orderUnitQty, '발주 단'),
    busanWilsonQty: decimalValue(input.busanWilsonQty, '부산윌슨 수량'),
    memo: String(input.memo || '').trim().slice(0, 500) || null,
  };
}

export async function loadPreShipmentPlans(planKey = null) {
  await assertPreShipmentSchema();
  const plans = (await query(`SELECT PlanKey,OrderYear,MajorWeek,CustomerName,SourceFileName,SourceSheetName,SourceSheetMajor,UpdatedAt FROM WebPreShipmentPlan WHERE isDeleted=0 ORDER BY OrderYear DESC,MajorWeek DESC,PlanKey DESC`)).recordset;
  const selected = Number(planKey) > 0 ? plans.find(row => Number(row.PlanKey) === Number(planKey)) : plans[0];
  if (!selected) return { plans, plan: null, items: [], schedules: [], allocations: [], customer: null, erpStatus: { summaries: {}, dates: {} } };
  const params = { key: p(sql.Int, selected.PlanKey) };
  const [items, schedules, allocations] = await Promise.all([
    query(`SELECT * FROM WebPreShipmentItem WHERE PlanKey=@key ORDER BY SortOrder,ItemKey`, params),
    query(`SELECT * FROM WebPreShipmentSchedule WHERE PlanKey=@key ORDER BY SortOrder,ScheduleKey`, params),
    query(`SELECT a.* FROM WebPreShipmentAllocation a JOIN WebPreShipmentSchedule s ON s.ScheduleKey=a.ScheduleKey WHERE s.PlanKey=@key`, params),
  ]);
  const customer = await resolvePreShipmentCustomer(selected.CustomerName);
  const erpStatus = await loadPreShipmentErpStatus({
    orderYear: selected.OrderYear,
    majorWeek: selected.MajorWeek,
    custKey: customer?.CustKey,
    prodKeys: items.recordset.map(row => row.ProdKey),
  });
  return { plans, plan: selected, items: items.recordset, schedules: schedules.recordset, allocations: allocations.recordset, customer, erpStatus };
}

function actorName(user) { return String(user?.userName || user?.userId || 'web').slice(0, 100); }
export async function createPreShipmentPlan({ parsed, orderYear, majorWeek, fileName, user }) {
  await assertPreShipmentSchema();
  const scope = normalizePreShipmentScope(orderYear, majorWeek);
  const actor = actorName(user);
  return withTransaction(async tQuery => {
    const master = await tQuery(`INSERT INTO WebPreShipmentPlan(OrderYear,MajorWeek,SourceFileName,SourceSheetName,SourceSheetMajor,CreatedBy,UpdatedBy) OUTPUT INSERTED.PlanKey VALUES(@year,@week,@file,@sheet,@sheetWeek,@actor,@actor)`, {
      year: p(sql.Char, scope.orderYear), week: p(sql.TinyInt, scope.majorWeek), file: p(sql.NVarChar, fileName), sheet: p(sql.NVarChar, parsed.sheetName), sheetWeek: p(sql.TinyInt, parsed.sheetMajor), actor: p(sql.NVarChar, actor),
    });
    const planKey = master.recordset[0].PlanKey;
    const scheduleDefs = [
      { source: 'PRE', label: '목요일 선출고', date: parsed.baseDate },
      { source: 'EXTRA', label: '일요일 출고', date: null },
    ];
    const scheduleKeys = {};
    for (let i = 0; i < scheduleDefs.length; i += 1) {
      const row = scheduleDefs[i];
      const inserted = await tQuery(`INSERT INTO WebPreShipmentSchedule(PlanKey,ShipmentDate,DayLabel,TargetOrderYear,TargetMajorWeek,SortOrder,UpdatedBy) OUTPUT INSERTED.ScheduleKey VALUES(@plan,@date,@label,@year,@week,@sort,@actor)`, {
        plan: p(sql.Int, planKey), date: p(sql.Date, row.date), label: p(sql.NVarChar, row.label), year: p(sql.Char, scope.orderYear), week: p(sql.TinyInt, scope.majorWeek), sort: p(sql.Int, i + 1), actor: p(sql.NVarChar, actor),
      });
      scheduleKeys[row.source] = inserted.recordset[0].ScheduleKey;
    }
    for (const item of parsed.items) {
      const inserted = await tQuery(`INSERT INTO WebPreShipmentItem(PlanKey,SpeciesName,ItemName,OrderBoxQty,OrderUnitQty,BusanWilsonQty,Memo,SortOrder) OUTPUT INSERTED.ItemKey VALUES(@plan,@species,@item,@box,@unit,@wilson,@memo,@sort)`, {
        plan: p(sql.Int, planKey), species: p(sql.NVarChar, item.speciesName), item: p(sql.NVarChar, item.itemName), box: p(sql.Decimal(18, 4), item.orderBoxQty), unit: p(sql.Decimal(18, 4), item.orderUnitQty), wilson: p(sql.Decimal(18, 4), item.busanWilsonQty), memo: p(sql.NVarChar, item.memo || null), sort: p(sql.Int, item.sortOrder),
      });
      const itemKey = inserted.recordset[0].ItemKey;
      for (const allocation of item.importedAllocations || []) {
        if (Number(allocation.quantity) === 0 || !scheduleKeys[allocation.source]) continue;
        await tQuery(`INSERT INTO WebPreShipmentAllocation(ScheduleKey,ItemKey,Quantity,UpdatedBy) VALUES(@schedule,@item,@qty,@actor)`, { schedule: p(sql.Int, scheduleKeys[allocation.source]), item: p(sql.Int, itemKey), qty: p(sql.Decimal(18, 4), allocation.quantity), actor: p(sql.NVarChar, actor) });
      }
    }
    return { planKey, itemCount: parsed.items.length };
  });
}

export async function savePreShipmentAllocation({ scheduleKey, itemKey, quantity, user }) {
  await assertPreShipmentSchema();
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) throw new Error('수량은 0 이상의 숫자여야 합니다.');
  await query(`MERGE WebPreShipmentAllocation WITH (HOLDLOCK) AS target USING (SELECT @schedule AS ScheduleKey,@item AS ItemKey) AS source ON target.ScheduleKey=source.ScheduleKey AND target.ItemKey=source.ItemKey WHEN MATCHED THEN UPDATE SET Quantity=@qty,UpdatedBy=@actor,UpdatedAt=SYSDATETIME() WHEN NOT MATCHED THEN INSERT(ScheduleKey,ItemKey,Quantity,UpdatedBy) VALUES(@schedule,@item,@qty,@actor);`, { schedule: p(sql.Int, Number(scheduleKey)), item: p(sql.Int, Number(itemKey)), qty: p(sql.Decimal(18, 4), qty), actor: p(sql.NVarChar, actorName(user)) });
}

export async function savePreShipmentSchedule({ scheduleKey, shipmentDate, dayLabel, targetOrderYear, targetMajorWeek, user }) {
  await assertPreShipmentSchema();
  const scope = normalizePreShipmentScope(targetOrderYear, targetMajorWeek);
  if (!String(dayLabel || '').trim()) throw new Error('출고 구분을 입력하세요.');
  await query(`UPDATE WebPreShipmentSchedule SET ShipmentDate=@date,DayLabel=@label,TargetOrderYear=@year,TargetMajorWeek=@week,UpdatedBy=@actor,UpdatedAt=SYSDATETIME() WHERE ScheduleKey=@key`, { key: p(sql.Int, Number(scheduleKey)), date: p(sql.Date, shipmentDate || null), label: p(sql.NVarChar, String(dayLabel).trim()), year: p(sql.Char, scope.orderYear), week: p(sql.TinyInt, scope.majorWeek), actor: p(sql.NVarChar, actorName(user)) });
}

export async function addPreShipmentSchedule({ planKey, shipmentDate, dayLabel, targetOrderYear, targetMajorWeek, user }) {
  await assertPreShipmentSchema();
  const scope = normalizePreShipmentScope(targetOrderYear, targetMajorWeek);
  const result = await query(`INSERT INTO WebPreShipmentSchedule(PlanKey,ShipmentDate,DayLabel,TargetOrderYear,TargetMajorWeek,SortOrder,UpdatedBy) OUTPUT INSERTED.* SELECT @plan,@date,@label,@year,@week,ISNULL(MAX(SortOrder),0)+1,@actor FROM WebPreShipmentSchedule WHERE PlanKey=@plan`, { plan: p(sql.Int, Number(planKey)), date: p(sql.Date, shipmentDate || null), label: p(sql.NVarChar, String(dayLabel || '추가 출고').trim()), year: p(sql.Char, scope.orderYear), week: p(sql.TinyInt, scope.majorWeek), actor: p(sql.NVarChar, actorName(user)) });
  return result.recordset[0];
}

export async function addManualPreShipmentItem({ planKey, user, ...input }) {
  await assertPreShipmentSchema();
  const item = normalizeManualPreShipmentItem(input);
  const numericPlanKey = Number(planKey);
  if (!Number.isInteger(numericPlanKey) || numericPlanKey <= 0) throw new Error('저장 차수를 먼저 선택하세요.');
  return withTransaction(async tQuery => {
    const plan = await tQuery(`SELECT PlanKey FROM WebPreShipmentPlan WITH (UPDLOCK,HOLDLOCK) WHERE PlanKey=@plan AND isDeleted=0`, { plan: p(sql.Int, numericPlanKey) });
    if (!plan.recordset[0]) throw new Error('저장 차수를 찾을 수 없습니다.');
    const inserted = await tQuery(`INSERT INTO WebPreShipmentItem(PlanKey,SpeciesName,ItemName,OrderBoxQty,OrderUnitQty,BusanWilsonQty,Memo,SortOrder) OUTPUT INSERTED.* SELECT @plan,@species,@item,@box,@unit,@wilson,@memo,ISNULL(MAX(SortOrder),0)+1 FROM WebPreShipmentItem WITH (UPDLOCK,HOLDLOCK) WHERE PlanKey=@plan`, {
      plan: p(sql.Int, numericPlanKey), species: p(sql.NVarChar, item.speciesName), item: p(sql.NVarChar, item.itemName), box: p(sql.Decimal(18, 4), item.orderBoxQty), unit: p(sql.Decimal(18, 4), item.orderUnitQty), wilson: p(sql.Decimal(18, 4), item.busanWilsonQty), memo: p(sql.NVarChar, item.memo),
    });
    return inserted.recordset[0];
  });
}

export async function searchPreShipmentProducts(rawQuery) {
  const term = String(rawQuery || '').trim();
  if (!term) throw new Error('검색할 품목명을 입력하세요.');
  const tokens = [...new Set(term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(token => token.length >= 1))].slice(0, 12);
  const params = {};
  const predicates = tokens.map((token, index) => {
    params[`q${index}`] = p(sql.NVarChar, `%${token}%`);
    return `(p.ProdName LIKE @q${index} OR ISNULL(p.DisplayName,'') LIKE @q${index} OR ISNULL(p.FlowerName,'') LIKE @q${index} OR ISNULL(p.CounName,'') LIKE @q${index})`;
  });
  const result = await query(`SELECT TOP 300 p.ProdKey,p.ProdName,ISNULL(p.DisplayName,'') AS DisplayName,ISNULL(p.FlowerName,'') AS FlowerName,ISNULL(p.CounName,'') AS CounName,ISNULL(p.OutUnit,'') AS OutUnit,ISNULL(u.UsageCount,0) AS UsageCount FROM Product p LEFT JOIN (SELECT od.ProdKey,COUNT_BIG(*) AS UsageCount FROM OrderDetail od JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey WHERE ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey IS NOT NULL GROUP BY od.ProdKey) u ON u.ProdKey=p.ProdKey WHERE ISNULL(p.isDeleted,0)=0 AND (${predicates.join(' OR ')})`, params);
  return rankProductSearchOptions(term, result.recordset || [], { limit: 50 });
}

export async function matchPreShipmentItem({ planKey, itemKey, prodKey, user }) {
  await assertPreShipmentSchema();
  const numericPlanKey = Number(planKey);
  const numericItemKey = Number(itemKey);
  if (!Number.isInteger(numericPlanKey) || !Number.isInteger(numericItemKey) || numericPlanKey <= 0 || numericItemKey <= 0) throw new Error('품목 매칭 대상이 올바르지 않습니다.');
  const numericProdKey = prodKey == null || prodKey === '' ? null : Number(prodKey);
  if (numericProdKey != null && (!Number.isInteger(numericProdKey) || numericProdKey <= 0)) throw new Error('전산 품목을 다시 선택하세요.');
  if (numericProdKey != null) {
    const product = await query(`SELECT ProdKey,ProdName,ISNULL(DisplayName,'') AS DisplayName FROM Product WHERE ProdKey=@prod AND ISNULL(isDeleted,0)=0`, { prod: p(sql.Int, numericProdKey) });
    if (!product.recordset[0]) throw new Error('사용 가능한 전산 품목을 찾을 수 없습니다.');
  }
  const result = await query(`UPDATE i SET ProdKey=@prod,MatchedProdName=CASE WHEN p.ProdKey IS NULL THEN NULL ELSE CONCAT(p.ProdName,CASE WHEN ISNULL(p.DisplayName,'')<>'' AND p.DisplayName<>p.ProdName THEN N' / '+p.DisplayName ELSE N'' END) END FROM WebPreShipmentItem i LEFT JOIN Product p ON p.ProdKey=@prod AND ISNULL(p.isDeleted,0)=0 WHERE i.PlanKey=@plan AND i.ItemKey=@item; SELECT i.* FROM WebPreShipmentItem i WHERE i.PlanKey=@plan AND i.ItemKey=@item;`, { plan: p(sql.Int, numericPlanKey), item: p(sql.Int, numericItemKey), prod: p(sql.Int, numericProdKey), actor: p(sql.NVarChar, actorName(user)) });
  const row = result.recordsets?.[1]?.[0] || result.recordset?.[0];
  if (!row) throw new Error('저장 차수에 속한 품목을 찾을 수 없습니다.');
  return row;
}
