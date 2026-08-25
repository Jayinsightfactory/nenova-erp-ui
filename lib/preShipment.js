import { query, sql, withTransaction } from './db.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import { normalizePreShipmentScope } from './preShipmentWorkbook.js';

const requirements = [
  { table: 'WebPreShipmentPlan', columns: ['PlanKey', 'OrderYear', 'MajorWeek'] },
  { table: 'WebPreShipmentItem', columns: ['ItemKey', 'PlanKey', 'SpeciesName', 'ItemName'] },
  { table: 'WebPreShipmentSchedule', columns: ['ScheduleKey', 'PlanKey', 'ShipmentDate', 'TargetMajorWeek'] },
  { table: 'WebPreShipmentAllocation', columns: ['AllocationKey', 'ScheduleKey', 'ItemKey', 'Quantity'] },
];
export const assertPreShipmentSchema = () => assertWebSchemaContract('pre-shipment-management', requirements);
const p = (type, value) => ({ type, value });

export async function loadPreShipmentPlans(planKey = null) {
  await assertPreShipmentSchema();
  const plans = (await query(`SELECT PlanKey,OrderYear,MajorWeek,CustomerName,SourceFileName,SourceSheetName,SourceSheetMajor,UpdatedAt FROM WebPreShipmentPlan WHERE isDeleted=0 ORDER BY OrderYear DESC,MajorWeek DESC,PlanKey DESC`)).recordset;
  const selected = Number(planKey) > 0 ? plans.find(row => Number(row.PlanKey) === Number(planKey)) : plans[0];
  if (!selected) return { plans, plan: null, items: [], schedules: [], allocations: [] };
  const params = { key: p(sql.Int, selected.PlanKey) };
  const [items, schedules, allocations] = await Promise.all([
    query(`SELECT * FROM WebPreShipmentItem WHERE PlanKey=@key ORDER BY SortOrder,ItemKey`, params),
    query(`SELECT * FROM WebPreShipmentSchedule WHERE PlanKey=@key ORDER BY SortOrder,ScheduleKey`, params),
    query(`SELECT a.* FROM WebPreShipmentAllocation a JOIN WebPreShipmentSchedule s ON s.ScheduleKey=a.ScheduleKey WHERE s.PlanKey=@key`, params),
  ]);
  return { plans, plan: selected, items: items.recordset, schedules: schedules.recordset, allocations: allocations.recordset };
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
