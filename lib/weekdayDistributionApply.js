import { amountVatFromCostEst, shipmentUnitsFromUserInput } from './distributeUnits.js';
import { weekdayDetailCustomerMatchesMaster } from './weekdayCustomerLink.js';
import {
  assertNativeResult,
  evaluateDirectionalCurrentStock,
  futureStockShortageError,
  preWriteStockGateAcknowledgement,
} from './estimateDirectionalQuantity.js';
import { materializeOverflowTargets } from './estimateOverflow.js';
import { safeNextShipmentDetailKey, tryInsertWithRetry } from './safeNextKey.js';
import { normalizeShipmentQty } from './shipmentAvailability.js';
import { purgeZeroOutShipmentDetail } from './shipmentDetailWriteGuard.js';
import {
  assertExpectedPhysicalSnapshot,
  assertWeekdaySnapshotDigest,
  buildWeekdayChangePlan,
  canonicalWeekdaySnapshotDigestInput,
  canonicalPhysicalSnapshot,
  normalizeWeekdayApplyRequest,
  positiveWeekdayIncreaseByProduct,
  resolveNewTargetCosts,
  weekdayDistributionError,
  weekdaySnapshotDigest,
  weekdayRequestHash,
} from './weekdayDistributionPolicy.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { shiftDate } from './weekdayEstimateCycle.js';

const EPSILON = 0.000001;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { weekdaySnapshotDigest };

function permanentWeekdaySnapshot(change, actual) {
  const digestInput = canonicalWeekdaySnapshotDigestInput(change, actual);
  return {
    ...canonicalPhysicalSnapshot(actual),
    snapshotDigest: weekdaySnapshotDigest(change, actual),
    master: digestInput.master,
    detail: digestInput.detail,
    product: digestInput.product,
  };
}

function paramsFor(sql, change) {
  return {
    yr: { type: sql.NVarChar, value: change.year },
    wk: { type: sql.NVarChar, value: change.orderWeek },
    ck: { type: sql.Int, value: Number(change.custKey) },
    pk: { type: sql.Int, value: Number(change.prodKey) },
    ywk: { type: sql.NVarChar, value: `${change.year}${change.orderWeek.slice(0, 2)}` },
  };
}

function exactUser(user = {}) {
  const userId = String(user.userId || '').trim();
  if (!userId) throw weekdayDistributionError('WEEKDAY_USER_REQUIRED', '로그인 사용자 식별값이 필요합니다.', 401);
  return userId;
}

function redesign(message, missingScope = []) {
  throw weekdayDistributionError('NEEDS_REDESIGN', message, 409, { missingScope });
}

function parseResponseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch (cause) {
    throw weekdayDistributionError(
      'WEEKDAY_AUDIT_CORRUPT',
      '저장 작업의 응답 감사값을 읽을 수 없습니다. 같은 작업번호로 다시 쓰지 않았습니다.',
      500,
      { cause },
    );
  }
}

export async function assertWeekdayAuditSchema(tQ) {
  try {
    await tQ(`SELECT TOP (0) UUID,RequestHash,[User],Reason,ResponseJson,Created
                FROM dbo.WebWeekdayDistributionOperation;
              SELECT TOP (0) OperationFK,[Year],[Week],CustKey,ProdKey,BeforeJson,AfterJson,StockValuesIfKnown
                FROM dbo.WebWeekdayDistributionChange;`);
  } catch (cause) {
    throw weekdayDistributionError(
      'WEEKDAY_AUDIT_UNAVAILABLE',
      '요일별 배분 감사 테이블이 준비되지 않아 저장하지 않았습니다.',
      503,
      { cause },
    );
  }
}

export function normalizeWeekdayOperationLookup(input = {}) {
  const operationId = String(input.operationId || '').trim();
  const custKey = Number(input.custKey);
  if (!UUID_RE.test(operationId) || !Number.isInteger(custKey) || custKey <= 0) {
    throw weekdayDistributionError('INVALID_WEEKDAY_OPERATION_LOOKUP', 'operationId UUID와 custKey가 필요합니다.', 400);
  }
  return { operationId, custKey };
}

export async function readWeekdayOperation(executor, sql, input = {}) {
  const { operationId, custKey } = normalizeWeekdayOperationLookup(input);
  let result;
  try {
    result = await executor(
      `SELECT o.ResponseJson
         FROM dbo.WebWeekdayDistributionOperation o
        WHERE o.UUID=@op
          AND EXISTS (
            SELECT 1 FROM dbo.WebWeekdayDistributionChange c
             WHERE c.OperationFK=o.UUID AND c.CustKey=@ck
          )`,
      {
        op: { type: sql.UniqueIdentifier, value: operationId },
        ck: { type: sql.Int, value: custKey },
      },
    );
  } catch (cause) {
    throw weekdayDistributionError(
      'WEEKDAY_AUDIT_UNAVAILABLE',
      '요일별 배분 작업 이력을 조회할 수 없습니다.',
      503,
      { cause },
    );
  }
  if (!result.recordset?.length) return null;
  if (result.recordset.length !== 1 || result.recordset[0].ResponseJson == null) {
    throw weekdayDistributionError('WEEKDAY_AUDIT_INCOMPLETE', '작업 감사값이 불완전합니다. 재실행하지 말고 관리자 확인이 필요합니다.', 500);
  }
  return parseResponseJson(result.recordset[0].ResponseJson);
}

export function normalizeWeekdayHistoryLookup(input = {}) {
  const year = String(input.year || '').trim();
  const majorWeek = String(input.majorWeek || '').trim().padStart(2, '0');
  const custKey = Number(input.custKey);
  const requestedLimit = input.limit == null || input.limit === '' ? 100 : Number(input.limit);
  if (!/^\d{4}$/.test(year) || Number(year) < 2026
    || !/^\d{2}$/.test(majorWeek) || Number(majorWeek) < 1 || Number(majorWeek) > 53
    || !Number.isInteger(custKey) || custKey <= 0
    || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
    throw weekdayDistributionError(
      'INVALID_WEEKDAY_HISTORY_LOOKUP',
      '저장 이력 조회에는 year, majorWeek, custKey와 1~500 limit이 필요합니다.',
      400,
    );
  }
  return { year, majorWeek, custKey, limit: requestedLimit };
}

export async function readWeekdayChanges(executor, sql, input = {}) {
  const scope = normalizeWeekdayHistoryLookup(input);
  let result;
  try {
    result = await executor(
      `SELECT TOP (@take)
              o.UUID,o.[User],o.Reason,o.Created,
              c.[Year],c.[Week],c.CustKey,c.ProdKey,
              c.BeforeJson,c.AfterJson,c.StockValuesIfKnown
         FROM dbo.WebWeekdayDistributionChange c
         JOIN dbo.WebWeekdayDistributionOperation o ON o.UUID=c.OperationFK
        WHERE c.[Year]=@yr AND c.[Week] LIKE @weekLike AND c.CustKey=@ck
        ORDER BY o.Created DESC,o.UUID DESC,c.[Week],c.ProdKey`,
      {
        take: { type: sql.Int, value: scope.limit + 1 },
        yr: { type: sql.Char(4), value: scope.year },
        weekLike: { type: sql.VarChar(6), value: `${scope.majorWeek}-%` },
        ck: { type: sql.Int, value: scope.custKey },
      },
    );
  } catch (cause) {
    throw weekdayDistributionError(
      'WEEKDAY_AUDIT_UNAVAILABLE',
      '요일별 배분 저장 이력을 조회할 수 없습니다.',
      503,
      { cause },
    );
  }
  const rows = result.recordset || [];
  const truncated = rows.length > scope.limit;
  const changes = rows.slice(0, scope.limit).map((row) => ({
    operationId: String(row.UUID),
    userId: String(row.User || ''),
    reason: String(row.Reason || ''),
    createdAt: row.Created,
    year: String(row.Year),
    orderWeek: String(row.Week),
    custKey: Number(row.CustKey),
    prodKey: Number(row.ProdKey),
    before: parseResponseJson(row.BeforeJson),
    after: parseResponseJson(row.AfterJson),
    stockValuesIfKnown: row.StockValuesIfKnown == null ? null : parseResponseJson(row.StockValuesIfKnown),
  }));
  return { scope, changes, limit: scope.limit, truncated };
}

async function reserveOperation(tQ, sql, request, userId, requestHash) {
  const locked = await tQ(
    `SELECT UUID,RequestHash,[User],ResponseJson
       FROM dbo.WebWeekdayDistributionOperation WITH (UPDLOCK,HOLDLOCK)
      WHERE UUID=@op`,
    { op: { type: sql.UniqueIdentifier, value: request.operationId } },
  );
  if (locked.recordset?.length) {
    const row = locked.recordset[0];
    if (String(row.RequestHash) !== requestHash || String(row.User) !== userId) {
      throw weekdayDistributionError(
        'WEEKDAY_OPERATION_CONFLICT',
        '같은 operationId를 다른 사용자 또는 다른 요청에 재사용할 수 없습니다.',
        409,
      );
    }
    if (row.ResponseJson == null) {
      throw weekdayDistributionError('WEEKDAY_AUDIT_INCOMPLETE', '완료 응답이 없는 작업번호입니다. 자동 재실행하지 않습니다.', 500);
    }
    return parseResponseJson(row.ResponseJson);
  }
  await tQ(
    `INSERT INTO dbo.WebWeekdayDistributionOperation
       (UUID,RequestHash,[User],Reason,ResponseJson,Created)
     VALUES (@op,@hash,@uid,@reason,NULL,SYSUTCDATETIME())`,
    {
      op: { type: sql.UniqueIdentifier, value: request.operationId },
      hash: { type: sql.Char(64), value: requestHash },
      uid: { type: sql.NVarChar, value: userId },
      reason: { type: sql.NVarChar, value: request.reason },
    },
  );
  return null;
}

function scopeFor(change) {
  return {
    orderYear: change.year,
    orderWeek: change.orderWeek.slice(0, 2),
    custKey: change.custKey,
  };
}

function uniqueScopes(changes) {
  const result = new Map();
  for (const change of changes) {
    const scope = scopeFor(change);
    result.set(`${scope.orderYear}|${scope.orderWeek}|${scope.custKey}`, scope);
  }
  return [...result.values()].sort((a, b) => `${a.orderYear}|${a.orderWeek}|${a.custKey}`
    .localeCompare(`${b.orderYear}|${b.orderWeek}|${b.custKey}`));
}

async function acquireInternalLeases(tQ, request, user, dependencies) {
  const leases = [];
  const clientId = `weekday:${request.operationId}`;
  for (const scope of uniqueScopes(request.changes)) {
    const acquired = await dependencies.acquireEditLease(tQ, scope, user, {
      clientId,
      pageCode: 'estimate-weekday-apply',
      takeover: false,
      forceTakeover: false,
    });
    const token = acquired?.lease?.leaseToken;
    if (!token) throw weekdayDistributionError('ERP_EDIT_GUARD_INVALID', '내부 편집 보호 토큰을 획득하지 못했습니다.', 500);
    const editGuard = { leaseToken: token, clientId };
    await dependencies.assertEditGuard(tQ, scope, user, { editGuard });
    leases.push({ scope, editGuard });
  }
  return leases;
}

async function releaseInternalLeases(tQ, leases, user, dependencies, failure) {
  let releaseFailure = null;
  for (const owned of [...leases].reverse()) {
    try {
      await dependencies.releaseEditLease(tQ, owned.scope, user, { editGuard: owned.editGuard });
    } catch (error) {
      if (!failure && !releaseFailure) releaseFailure = error;
    }
  }
  if (releaseFailure) throw releaseFailure;
}

function physicalDate(row, detail) {
  return {
    sdateKey: Number(row.SdateKey),
    sdetailKey: Number(row.SdetailKey),
    shipmentKey: Number(row.ShipmentKey),
    date: String(row.Date),
    timestamp: String(row.Timestamp),
    shipmentQuantity: Number(row.ShipmentQuantity),
    estimateQuantity: Number(row.EstQuantity),
    detailFixed: detail?.DetailIsFix === true || detail?.DetailIsFix === 1,
    cost: row.Cost == null ? null : Number(row.Cost),
    amount: row.Amount == null ? null : Number(row.Amount),
    vat: row.Vat == null ? null : Number(row.Vat),
    descr: String(row.Descr || ''),
  };
}

async function readActualScope(tQ, sql, change) {
  const params = paramsFor(sql, change);
  const context = await tQ(
    `SELECT p.ProdKey,p.ProdName,p.CountryFlower,p.OutUnit,p.EstUnit,
            p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,
            p.Stock,
            c.CustKey,c.Manager,c.OrderCode,ISNULL(c.BaseOutDay,0) AS BaseOutDay
       FROM Product p WITH (UPDLOCK,HOLDLOCK)
       CROSS JOIN Customer c WITH (UPDLOCK,HOLDLOCK)
      WHERE p.ProdKey=@pk AND ISNULL(p.isDeleted,0)=0
        AND c.CustKey=@ck AND ISNULL(c.isDeleted,0)=0`,
    params,
  );
  if (context.recordset?.length !== 1) {
    throw weekdayDistributionError('WEEKDAY_SCOPE_NOT_FOUND', `${change.year}/${change.orderWeek}의 업체 또는 품목을 찾을 수 없습니다.`, 404);
  }
  const product = context.recordset[0];
  const customer = context.recordset[0];
  if (normalizeWeekdayUnit(product.OutUnit) !== change.unit) {
    throw weekdayDistributionError('OUT_UNIT_MISMATCH', `품목 ${change.prodKey}의 실제 OutUnit(${product.OutUnit})과 요청 단위(${change.unit})가 다릅니다.`);
  }
  if (!normalizeWeekdayUnit(product.EstUnit)) {
    throw weekdayDistributionError('EST_UNIT_UNSUPPORTED', `품목 ${change.prodKey}의 EstUnit을 확인할 수 없습니다. 자동 단위 fallback을 사용하지 않습니다.`);
  }

  const masters = await tQ(
    `SELECT ShipmentKey,isFix AS MasterIsFix,OrderYearWeek
       FROM ShipmentMaster WITH (UPDLOCK,HOLDLOCK)
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck
        AND ISNULL(isDeleted,0)=0 AND OrderYearWeek=@ywk`,
    params,
  );
  if (masters.recordset?.length !== 1) {
    redesign(
      `${change.year}/${change.orderWeek}/업체${change.custKey}의 기존 ShipmentMaster가 없거나 중복됩니다.`,
      ['shipment-master-create-or-disambiguate'],
    );
  }
  const master = masters.recordset[0];
  const details = await tQ(
    `SELECT sd.SdetailKey,sd.ShipmentKey,sd.CustKey,sd.ProdKey,sd.ShipmentDtm,
            CONVERT(nvarchar(23),sd.ShipmentDtm,121) AS ShipmentTimestamp,
            sd.OutQuantity,sd.BoxQuantity,sd.BunchQuantity,sd.SteamQuantity,sd.EstQuantity,
            sd.Cost AS DetailCost,sd.Amount AS DetailAmount,sd.Vat AS DetailVat,
            sd.isFix AS DetailIsFix,ISNULL(sd.Descr,N'') AS DetailDescr,ISNULL(sd.EstDescr,N'') AS EstDescr
       FROM ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK)
      WHERE sd.ShipmentKey=@sk AND sd.ProdKey=@pk`,
    { ...params, sk: { type: sql.Int, value: Number(master.ShipmentKey) } },
  );
  const detail = details.recordset?.[0] || null;
  if (details.recordset?.length > 1) {
    redesign(`${change.year}/${change.orderWeek}/품목${change.prodKey}의 ShipmentDetail이 여러 개입니다.`, ['multiple-shipment-details']);
  }
  if (detail && !weekdayDetailCustomerMatchesMaster(detail.CustKey,change.custKey)) {
    throw weekdayDistributionError('SHIPMENT_CUSTOMER_MISMATCH', 'ShipmentDetail과 ShipmentMaster의 업체가 다릅니다.', 409);
  }
  const dateResult = detail ? await tQ(
    `SELECT d.SdateKey,d.SdetailKey,sd.ShipmentKey,
            CONVERT(nvarchar(10),d.ShipmentDtm,120) AS [Date],
            CONVERT(nvarchar(23),d.ShipmentDtm,121) AS [Timestamp],
            d.ShipmentQuantity,d.EstQuantity,d.Cost,d.Amount,d.Vat,ISNULL(d.Descr,N'') AS Descr
       FROM ShipmentDate d WITH (UPDLOCK,HOLDLOCK)
       JOIN ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK) ON sd.SdetailKey=d.SdetailKey
      WHERE d.SdetailKey=@sdk
      ORDER BY d.SdateKey`,
    { sdk: { type: sql.Int, value: Number(detail.SdetailKey) } },
  ) : { recordset: [] };
  const shipmentDates = (dateResult.recordset || []).map((row) => physicalDate(row, detail));
  return {
    detailRows: details.recordset?.length || 0,
    shipmentOutQuantity: detail ? Number(detail.OutQuantity) : null,
    shipmentDates,
    detail,
    master,
    product,
    customer,
  };
}

// BaseYmd can be nvarchar (including date-only values). Match the EXE's
// datetime equality before serializing; do not discard a real clock difference.
const CALENDAR_DATETIME_SQL = 'CONVERT(datetime,BaseYmd,121)';
const CALENDAR_PROJECTION_SQL = `CONVERT(nvarchar(10),${CALENDAR_DATETIME_SQL},120) AS [Date],
            CONVERT(nvarchar(23),${CALENDAR_DATETIME_SQL},121) AS [Timestamp]`;

export async function readWeekdayCalendar(tQ, sql, change, actual) {
  const anchorResult = await tQ(
    `SELECT ${CALENDAR_PROJECTION_SQL}
       FROM PeriodDay WITH (UPDLOCK,HOLDLOCK)
      WHERE OrderYearWeek=@anchorYwk AND WeekDay=5`,
    { anchorYwk: { type: sql.NVarChar, value: `${change.year}${change.orderWeek.slice(0, 2)}` } },
  );
  if (anchorResult.recordset?.length !== 1) {
    throw weekdayDistributionError(
      'CALENDAR_MISMATCH',
      `${change.year}/${change.orderWeek.slice(0, 2)}차의 목요일 업무주 anchor가 없거나 중복됩니다.`,
      409,
    );
  }
  const startDate = String(anchorResult.recordset[0].Date);
  const endDate = shiftDate(startDate, 6);
  const dates = new Set([
    ...change.dates.map((row) => row.date),
    ...actual.shipmentDates.map((row) => row.date),
  ]);
  const calendar = new Map();
  for (const date of [...dates].sort()) {
    if (date < startDate || date > endDate) {
      calendar.set(date, { ambiguous: true, outOfCycle: true, startDate, endDate });
      continue;
    }
    const result = await tQ(
      `SELECT ${CALENDAR_PROJECTION_SQL},WeekDay
         FROM PeriodDay WITH (UPDLOCK,HOLDLOCK)
        WHERE BaseYmd>=CONVERT(date,@date,23)
          AND BaseYmd<DATEADD(day,1,CONVERT(date,@date,23))`,
      {
        date: { type: sql.NVarChar, value: date },
      },
    );
    if (result.recordset?.length !== 1) {
      calendar.set(date, { ambiguous: true });
      continue;
    }
    const row = result.recordset[0];
    calendar.set(date, { date: row.Date, timestamp: row.Timestamp, weekDay: Number(row.WeekDay) });
  }
  for (const row of actual.shipmentDates) {
    if (calendar.get(row.date)?.outOfCycle) {
      throw weekdayDistributionError(
        'CALENDAR_SCOPE_MISMATCH',
        `${change.year}/${change.orderWeek}의 기존 출고일 ${row.date}가 ${startDate}~${endDate} 업무주 밖입니다.`,
        409,
      );
    }
    if (calendar.get(row.date)?.timestamp !== row.timestamp) {
      throw weekdayDistributionError(
        'CALENDAR_TIMESTAMP_MISMATCH',
        `${change.year}/${change.orderWeek} ${row.date}의 ShipmentDate 시각이 정확한 PeriodDay와 다릅니다.`,
        409,
      );
    }
  }
  return calendar;
}

async function preparePlans(tQ, sql, request) {
  const plans = [];
  for (const change of request.changes) {
    const actual = await readActualScope(tQ, sql, change);
    assertWeekdaySnapshotDigest(change, actual);
    const calendar = await readWeekdayCalendar(tQ, sql, change, actual);
    const plan = buildWeekdayChangePlan(change, actual, calendar);
    // New-target materialization later fills plan.actual.detail with the new
    // key.  Freeze the locked before state now so audit/response cannot be
    // retroactively contaminated by that mutation.
    plan.beforeAudit = permanentWeekdaySnapshot(change, actual);
    plans.push(plan);
  }
  const resolved = resolveNewTargetCosts(plans);
  assertWeekdayPricePreservation(resolved);
  return resolved;
}

async function checkPositiveStock(tQ, sql, plans) {
  const validations = [];
  const plansByProduct = new Map();
  for (const plan of plans) {
    const key = String(plan.change.prodKey);
    const list = plansByProduct.get(key) || [];
    list.push(plan);
    plansByProduct.set(key, list);
  }
  for (const scope of positiveWeekdayIncreaseByProduct(plans)) {
    const productPlans = plansByProduct.get(String(scope.prodKey)) || [];
    const physical = productPlans.filter((plan) => Math.abs(plan.delta) > EPSILON);
    const positive = normalizeShipmentQty(physical
      .filter((plan) => plan.delta > 0).reduce((sum, plan) => sum + plan.delta, 0));
    const decrease = normalizeShipmentQty(physical
      .filter((plan) => plan.delta < 0).reduce((sum, plan) => sum - plan.delta, 0));
    const pureFixedTransfer = physical.length >= 2
      && physical.every((plan) => plan.fixed)
      && Math.abs(positive - decrease) <= EPSILON;
    const locked = await tQ(
      `SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK)
        WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
      { pk: { type: sql.Int, value: Number(scope.prodKey) } },
    );
    validations.push(evaluateDirectionalCurrentStock({
      currentStock: pureFixedTransfer
        ? normalizeShipmentQty(Number(locked.recordset?.[0]?.Stock) + decrease)
        : locked.recordset?.[0]?.Stock,
      increase: scope.increase,
      scope: {
        ...scope,
        transferCredit: pureFixedTransfer ? decrease : 0,
        pureSameTotalTransfer: pureFixedTransfer,
      },
    }));
  }
  return validations;
}

async function assertStockHistoryPolicy(tQ, plans) {
  if (!plans.some((plan) => plan.fixed && Math.abs(plan.delta) > EPSILON)) return;
  const conflict = await tQ(
    `SELECT TOP (1) Descr FROM CodeInfo WITH (UPDLOCK,HOLDLOCK)
      WHERE Category=N'StockType' AND Descr=N'출고'`,
  );
  if (conflict.recordset?.length) {
    throw weekdayDistributionError('STOCK_HISTORY_TYPE_CONFLICT', 'StockType에 출고가 등록되어 있어 직접 확정수량 저장을 중단했습니다.');
  }
}

async function prepareNewTargetGroups(tQ, sql, plans) {
  const groups = [];
  const orderYearWeekCapability = await tQ(
    `SELECT is_computed FROM sys.columns
      WHERE object_id=OBJECT_ID(N'dbo.OrderMaster') AND name=N'OrderYearWeek'`,
  );
  const writeOrderYearWeek = orderYearWeekCapability.recordset?.length === 1
    && !orderYearWeekCapability.recordset[0].is_computed;
  for (const plan of plans.filter((item) => item.newDetail)) {
    if (!plan.fixed || !(Number(plan.inheritedCost) > 0)) {
      redesign(`${plan.identity} 신규 target의 확정 상태 또는 원천 단가가 안전하지 않습니다.`, ['new-target-fixed-source-price']);
    }
    const change = plan.change;
    const params = paramsFor(sql, change);
    const orders = await tQ(
      `SELECT om.OrderMasterKey,om.Manager,od.OrderDetailKey,od.OutQuantity
         FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
         LEFT JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK)
           ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND ISNULL(od.isDeleted,0)=0
        WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
        ORDER BY om.OrderMasterKey,od.OrderDetailKey`,
      params,
    );
    const detailRows = (orders.recordset || []).filter((row) => row.OrderDetailKey != null);
    const activeRows = detailRows.filter((row) => Number(row.OutQuantity) > 0);
    const masterKeys = new Set((orders.recordset || []).map((row) => row.OrderMasterKey).filter((value) => value != null));
    if (detailRows.length > 1 || detailRows.some((row) => !(Number(row.OutQuantity) > 0)) || activeRows.length > 1
      || (!activeRows.length && masterKeys.size > 1)) {
      redesign(`${plan.identity} 신규 target의 OrderMaster/OrderDetail이 중복 또는 0수량입니다.`, ['new-target-order-disambiguation']);
    }

    if (!activeRows.length) {
      redesign(
        `${plan.identity} 신규 출고 target에는 기존 활성 양수 OrderDetail 등록이 필요합니다. 이 기능은 주문 수요를 자동 생성하지 않습니다.`,
        ['new-target-active-positive-order'],
      );
    }
    const manager = String(orders.recordset[0]?.Manager || '');
    const product = plan.actual.product;
    const row = {
      OrderYear: change.year,
      OrderWeek: change.orderWeek,
      CustKey: change.custKey,
      ProdKey: change.prodKey,
      ProdName: product.ProdName,
      OutUnit: product.OutUnit,
      EstUnit: product.EstUnit,
      BunchOf1Box: product.BunchOf1Box,
      SteamOf1Bunch: product.SteamOf1Bunch,
      SteamOf1Box: product.SteamOf1Box,
      ShipmentKey: Number(plan.actual.master.ShipmentKey),
      ShipmentDtm: plan.representativeTimestamp,
      DetailCost: Number(plan.inheritedCost),
      SdetailKey: null,
    };
    const group = {
      row,
      customer: { ...plan.actual.customer, Manager: manager },
      writeOrderYearWeek,
      newDetail: true,
      // Shared target creation is reused for OrderMaster/OrderDetail/ShipmentDetail.
      // Weekday apply owns exact PeriodDay rows and therefore suppresses its default date.
      newDate: false,
      confirmedDelta: plan.newTotal,
      changes: [],
      plan,
      preservedOrder: {
        orderMasterKey: Number(activeRows[0].OrderMasterKey),
        orderDetailKey: Number(activeRows[0].OrderDetailKey),
        outQuantity: Number(activeRows[0].OutQuantity),
      },
    };
    groups.push(group);
  }
  return groups;
}

export async function allocateWeekdayShipmentDetailKey(tQ, sql) {
  const nextKey = await safeNextShipmentDetailKey(tQ);
  if (!Number.isSafeInteger(nextKey) || nextKey <= 0) {
    throw weekdayDistributionError('SHIPMENT_DETAIL_KEY_INVALID', '신규 ShipmentDetail의 history-safe 키를 할당할 수 없습니다.', 500);
  }
  return nextKey;
}

export async function inspectShipmentDateKeyMode(tQ) {
  const result = await tQ(
    `SELECT COLUMNPROPERTY(OBJECT_ID(N'dbo.ShipmentDate'),N'SdateKey','IsIdentity') AS IsIdentity`,
  );
  const value = result.recordset?.[0]?.IsIdentity;
  if (value !== 0 && value !== 1) {
    throw weekdayDistributionError('SHIPMENT_DATE_SCHEMA_UNSUPPORTED', 'ShipmentDate.SdateKey 생성 방식을 확인할 수 없습니다.', 503);
  }
  return value === 1 ? 'identity' : 'manual';
}

export async function insertWeekdayShipmentDate(tQ, sql, keyMode, row) {
  const params = {
    sdk: { type: sql.Int, value: Number(row.sdetailKey) },
    dt: { type: sql.NVarChar, value: row.timestamp },
    shipQty: { type: sql.Float, value: Number(row.shipmentQuantity) },
    estQty: { type: sql.Float, value: Number(row.estimateQuantity) },
    cost: { type: sql.Float, value: Number(row.cost) },
    amount: { type: sql.Float, value: Number(row.amount) },
    vat: { type: sql.Float, value: Number(row.vat) },
    descr: { type: sql.NVarChar, value: String(row.descr || '') },
  };
  if (keyMode === 'identity') {
    const inserted = await tQ(
      `DECLARE @Inserted TABLE(SdateKey int NOT NULL);
       INSERT INTO ShipmentDate
         (SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
       OUTPUT INSERTED.SdateKey INTO @Inserted(SdateKey)
       VALUES (@sdk,CONVERT(datetime,@dt,121),@shipQty,@estQty,@cost,@amount,@vat,@descr);
       SELECT SdateKey FROM @Inserted;`,
      params,
    );
    const key = Number(inserted.recordset?.[0]?.SdateKey);
    if (!Number.isInteger(key) || key <= 0) throw weekdayDistributionError('SHIPMENT_DATE_INSERT_FAILED', '신규 출고일 키를 확인하지 못했습니다.', 500);
    return key;
  }
  if (keyMode !== 'manual') throw weekdayDistributionError('SHIPMENT_DATE_SCHEMA_UNSUPPORTED', 'ShipmentDate 키 모드가 올바르지 않습니다.', 500);
  return tryInsertWithRetry(tQ, 'ShipmentDate', 'SdateKey', async (key) => {
    await tQ(
      `INSERT INTO ShipmentDate
         (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
       VALUES (@dateKey,@sdk,CONVERT(datetime,@dt,121),@shipQty,@estQty,@cost,@amount,@vat,@descr)`,
      { ...params, dateKey: { type: sql.Int, value: key } },
    );
  });
}

async function recordDateHistory(tQ, sql, { sdetailKey, timestamp, type, before, after, userId, operationId }) {
  await tQ(
    `INSERT INTO ShipmentHistory
       (SdetailKey,ShipmentDtm,ChangeType,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
     VALUES (@sdk,CONVERT(datetime,@dt,121),@kind,@before,@after,@descr,@uid,GETDATE())`,
    {
      sdk: { type: sql.Int, value: Number(sdetailKey) },
      dt: { type: sql.NVarChar, value: timestamp },
      kind: { type: sql.NVarChar, value: type },
      before: { type: sql.NVarChar, value: String(before) },
      after: { type: sql.NVarChar, value: String(after) },
      descr: { type: sql.NVarChar, value: `요일별 배분 웹 적용 ${operationId}` },
      uid: { type: sql.NVarChar, value: userId },
    },
  );
}

async function applyStockDelta(tQ, sql, plan, userId) {
  if (!plan.fixed || Math.abs(plan.delta) <= EPSILON) return null;
  const locked = await tQ(
    `SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`,
    { pk: { type: sql.Int, value: Number(plan.change.prodKey) } },
  );
  const before = Number(locked.recordset?.[0]?.Stock);
  if (!Number.isFinite(before)) throw weekdayDistributionError('PRODUCT_STOCK_INVALID', '현재고를 잠그지 못해 저장하지 않았습니다.', 500);
  const after = normalizeShipmentQty(before - plan.delta);
  await tQ(
    `INSERT INTO StockHistory
       (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
     VALUES (GETDATE(),@yr,@wk,@uid,N'출고',N'수량',@before,@after,N'요일별 배분 웹 적용',@pk);
     UPDATE Product SET Stock=@after WHERE ProdKey=@pk;`,
    {
      yr: { type: sql.NVarChar, value: plan.change.year },
      wk: { type: sql.NVarChar, value: plan.change.orderWeek },
      uid: { type: sql.NVarChar, value: userId },
      before: { type: sql.Float, value: before },
      after: { type: sql.Float, value: after },
      pk: { type: sql.Int, value: Number(plan.change.prodKey) },
    },
  );
  return { before, after, delta: plan.delta, fixed: true };
}

function finalDateValues(plan, row) {
  const product = plan.actual.product;
  const cost = Number(row.cost ?? plan.actual.detail?.DetailCost ?? plan.inheritedCost);
  if (!Number.isFinite(cost) || cost <= 0) {
    redesign(`${plan.identity}의 출고일 단가를 확인할 수 없습니다.`, ['shipment-date-price']);
  }
  const units = assertExactProductConversion(plan, Number(row.shipmentQuantity));
  const money = amountVatFromCostEst(cost, units.estQty);
  return {
    ...row,
    shipmentQuantity: Number(row.shipmentQuantity),
    estimateQuantity: units.estQty,
    cost,
    amount: money.amount,
    vat: money.vat,
  };
}

function priceBucketKey(cost) {
  return Number(cost).toString();
}

function requiredPriceNumber(value, plan, field) {
  if (value == null || typeof value === 'boolean'
    || (typeof value === 'string' && value.trim() === '')) {
    redesign(
      `${plan.identity}의 변경 날짜 ${field} 값을 확인할 수 없어 단가를 보존하지 못합니다.`,
      ['date-price-transfer-policy'],
    );
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (field === 'cost' && number === 0)) {
    redesign(
      `${plan.identity}의 변경 날짜 ${field} 값을 확인할 수 없어 단가를 보존하지 못합니다.`,
      ['date-price-transfer-policy'],
    );
  }
  return number;
}

/**
 * A weekday move is not price-edit authority.  Decreases and increases may
 * offset only inside the exact DateCost bucket, even when the request also has
 * a net quantity change.  A product-level same-total operation must additionally
 * preserve stored gross (Amount + Vat).  This deliberately uses the physical
 * date rows, not ShipmentDetail.Cost, for the before side.
 */
export function assertWeekdayPricePreservation(plans = []) {
  const byProduct = new Map();
  for (const plan of plans) {
    const key = String(plan.change.prodKey);
    const grouped = byProduct.get(key) || [];
    grouped.push(plan);
    byProduct.set(key, grouped);
  }

  for (const productPlans of byProduct.values()) {
    const net = normalizeShipmentQty(productPlans.reduce((sum, plan) => sum + plan.delta, 0));
    const estimateDeltaByCost = new Map();
    let beforeGross = 0;
    let afterGross = 0;
    let changedDateCount = 0;

    for (const plan of productPlans) {
      const beforeByDate = new Map(plan.before.shipmentDates.map((row) => [row.date, row]));
      const afterByDate = new Map(plan.finalDates.map((row) => [row.date, row]));
      const dates = new Set([...beforeByDate.keys(), ...afterByDate.keys()]);
      for (const date of dates) {
        const before = beforeByDate.get(date);
        const after = afterByDate.get(date);
        const beforeQty = Number(before?.shipmentQuantity || 0);
        const afterQty = Number(after?.shipmentQuantity || 0);
        if (Math.abs(beforeQty - afterQty) <= EPSILON) continue;
        changedDateCount += 1;

        if (before) {
          const cost = requiredPriceNumber(before.cost, plan, 'cost');
          const estimateQuantity = requiredPriceNumber(before.estimateQuantity, plan, 'estimateQuantity');
          const amount = requiredPriceNumber(before.amount, plan, 'amount');
          const vat = requiredPriceNumber(before.vat, plan, 'vat');
          const key = priceBucketKey(cost);
          estimateDeltaByCost.set(key, (estimateDeltaByCost.get(key) || 0) - estimateQuantity);
          beforeGross += amount + vat;
        }

        if (after) {
          const values = finalDateValues(plan, after);
          const key = priceBucketKey(values.cost);
          estimateDeltaByCost.set(key, (estimateDeltaByCost.get(key) || 0) + values.estimateQuantity);
          afterGross += values.amount + values.vat;
        }
      }
    }

    if (!changedDateCount) continue;
    const positiveBuckets = [...estimateDeltaByCost.entries()]
      .filter(([, estimateDelta]) => estimateDelta > EPSILON);
    const negativeBuckets = [...estimateDeltaByCost.entries()]
      .filter(([, estimateDelta]) => estimateDelta < -EPSILON);
    if (positiveBuckets.length && negativeBuckets.length) {
      redesign(
        `품목 ${productPlans[0].change.prodKey}의 감소 단가(${negativeBuckets.map(([cost]) => cost).join(', ')})와 증가 단가(${positiveBuckets.map(([cost]) => cost).join(', ')})가 달라 수량 이동이 단가를 바꿉니다.`,
        ['date-price-transfer-policy'],
      );
    }
    if (Math.abs(net) <= EPSILON && Math.abs(beforeGross - afterGross) > 0.000001) {
      redesign(
        `품목 ${productPlans[0].change.prodKey}의 같은-total 이동이 출고일 Amount+Vat 합계를 바꿉니다.`,
        ['date-price-total-preservation'],
      );
    }
  }
  return plans;
}

export function assertExactProductConversion(plan, outQuantity) {
  const product = plan.actual.product;
  const outUnit = normalizeWeekdayUnit(product.OutUnit);
  const estUnit = normalizeWeekdayUnit(product.EstUnit);
  if (!outUnit || !estUnit) {
    throw weekdayDistributionError('UNIT_CONVERSION_UNSUPPORTED', `${plan.identity}의 OutUnit/EstUnit을 명확히 확인할 수 없습니다.`);
  }
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  const s1bn = Number(product.SteamOf1Bunch || 0);
  const supported = outUnit === estUnit
    || (outUnit === '박스' && estUnit === '단' && b1b > 0)
    || (outUnit === '박스' && estUnit === '송이' && (s1b > 0 || (b1b > 0 && s1bn > 0)))
    || (outUnit === '단' && estUnit === '박스' && b1b > 0)
    || (outUnit === '단' && estUnit === '송이' && s1bn > 0)
    || (outUnit === '송이' && estUnit === '단' && s1bn > 0)
    || (outUnit === '송이' && estUnit === '박스' && (s1b > 0 || (b1b > 0 && s1bn > 0)));
  if (!supported) {
    throw weekdayDistributionError(
      'UNIT_CONVERSION_UNSUPPORTED',
      `${plan.identity}의 ${outUnit}→${estUnit} 환산 마스터가 없어 0/1 fallback으로 저장하지 않습니다.`,
    );
  }
  // This value is an OutUnit input, not an already-rounded estimate input.
  // shipmentUnitsFromUserInput preserves the EXE's direct 단→박스 relation;
  // distributeUnits has a legacy 단+송이 branch that divides BoxQuantity by
  // SteamOf1Bunch a second time.
  const inputUnits = shipmentUnitsFromUserInput(outQuantity, outUnit, product);
  if (Math.abs(Number(inputUnits.outQuantity) - Number(outQuantity)) > EPSILON) {
    throw weekdayDistributionError(
      'UNIT_CONVERSION_ROUNDTRIP_FAILED',
      `${plan.identity}의 OutUnit 수량 ${outQuantity}${outUnit}은 전산 저장 정밀도로 정확히 표현할 수 없습니다.`,
    );
  }
  const roundTrip = shipmentUnitsFromUserInput(inputUnits.estQty, estUnit, product);
  if (Math.abs(Number(roundTrip.outQuantity) - Number(outQuantity)) > EPSILON) {
    throw weekdayDistributionError(
      'UNIT_CONVERSION_ROUNDTRIP_FAILED',
      `${plan.identity}의 전체수량 ${outQuantity}${outUnit}을 ${inputUnits.estQty}${estUnit}로 정확히 왕복 환산할 수 없습니다.`,
    );
  }
  return { ...inputUnits, outQty: inputUnits.outQuantity };
}

async function writePlan(tQ, sql, plan, userId, operationId, keyMode) {
  const detail = plan.actual.detail;
  const sdetailKey = Number(detail?.SdetailKey);
  const shipmentKey = Number(plan.actual.master.ShipmentKey);
  const actualByDate = new Map(plan.before.shipmentDates.map((row) => [row.date, row]));
  const finalByDate = new Map(plan.finalDates.map((row) => {
    const before = actualByDate.get(row.date);
    const unchanged = before
      && Math.abs(Number(before.shipmentQuantity) - Number(row.shipmentQuantity)) <= EPSILON;
    return [row.date, unchanged ? {
      ...row,
      shipmentQuantity: Number(before.shipmentQuantity),
      estimateQuantity: Number(before.estimateQuantity),
      cost: before.cost,
      amount: before.amount,
      vat: before.vat,
    } : finalDateValues(plan, row)];
  }));
  const allDates = [...new Set([...actualByDate.keys(), ...finalByDate.keys()])].sort();

  for (const date of allDates) {
    const before = actualByDate.get(date);
    const after = finalByDate.get(date);
    if (!before && after) {
      await recordDateHistory(tQ, sql, {
        sdetailKey, timestamp: after.timestamp, type: '신규', before: 0,
        after: after.shipmentQuantity, userId, operationId,
      });
    } else if (before && !after) {
      await recordDateHistory(tQ, sql, {
        sdetailKey, timestamp: before.timestamp, type: '삭제', before: before.shipmentQuantity,
        after: 0, userId, operationId,
      });
    } else if (Math.abs(Number(before.shipmentQuantity) - Number(after.shipmentQuantity)) > EPSILON) {
      await recordDateHistory(tQ, sql, {
        sdetailKey, timestamp: before.timestamp, type: '수정', before: before.shipmentQuantity,
        after: after.shipmentQuantity, userId, operationId,
      });
    }
  }

  if (plan.newTotal <= EPSILON) {
    await purgeZeroOutShipmentDetail(tQ, sdetailKey, sql);
    plan.finalDates = [];
    return;
  }

  const detailCost = Number(detail?.DetailCost ?? plan.inheritedCost);
  if (!Number.isFinite(detailCost) || detailCost <= 0) {
    redesign(`${plan.identity}의 ShipmentDetail 단가를 확인할 수 없습니다.`, ['shipment-detail-price']);
  }
  const units = assertExactProductConversion(plan, plan.newTotal);
  const money = amountVatFromCostEst(detailCost, units.estQty);
  await tQ(
    `UPDATE ShipmentDetail
        SET OutQuantity=@outQty,BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,
            EstQuantity=@estQty,Cost=@cost,Amount=@amount,Vat=@vat,
            ShipmentDtm=CONVERT(datetime,@shipmentTimestamp,121)
      WHERE SdetailKey=@sdk`,
    {
      sdk: { type: sql.Int, value: sdetailKey },
      shipmentTimestamp: { type: sql.NVarChar(23), value: plan.representativeTimestamp },
      outQty: { type: sql.Float, value: plan.newTotal },
      box: { type: sql.Float, value: units.box },
      bunch: { type: sql.Float, value: units.bunch },
      steam: { type: sql.Float, value: units.steam },
      estQty: { type: sql.Float, value: units.estQty },
      cost: { type: sql.Float, value: detailCost },
      amount: { type: sql.Float, value: money.amount },
      vat: { type: sql.Float, value: money.vat },
    },
  );

  for (const date of allDates) {
    const before = actualByDate.get(date);
    const after = finalByDate.get(date);
    if (before && !after) {
      await tQ(`DELETE FROM ShipmentDate WHERE SdateKey=@dateKey`, {
        dateKey: { type: sql.Int, value: Number(before.sdateKey) },
      });
      continue;
    }
    if (before && after) {
      if (Math.abs(Number(before.shipmentQuantity) - Number(after.shipmentQuantity)) > EPSILON) {
        await tQ(
          `UPDATE ShipmentDate
              SET ShipmentQuantity=@shipQty,EstQuantity=@estQty,Cost=@cost,Amount=@amount,Vat=@vat
            WHERE SdateKey=@dateKey`,
          {
            dateKey: { type: sql.Int, value: Number(before.sdateKey) },
            shipQty: { type: sql.Float, value: after.shipmentQuantity },
            estQty: { type: sql.Float, value: after.estimateQuantity },
            cost: { type: sql.Float, value: after.cost },
            amount: { type: sql.Float, value: after.amount },
            vat: { type: sql.Float, value: after.vat },
          },
        );
      }
      Object.assign(after, {
        sdateKey: before.sdateKey,
        sdetailKey,
        shipmentKey,
        detailFixed: plan.fixed,
      });
      continue;
    }
    if (!before && after) {
      Object.assign(after, { sdetailKey, shipmentKey, detailFixed: plan.fixed });
      after.sdateKey = await insertWeekdayShipmentDate(tQ, sql, keyMode, after);
    }
  }
  plan.finalDates = [...finalByDate.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function nativeStockRecalculation(tQ, sql, plans, userId) {
  const fixedPlans = plans.filter((plan) => plan.fixed && Math.abs(plan.delta) > EPSILON);
  const positive = new Set(fixedPlans.filter((plan) => plan.delta > EPSILON)
    .map((plan) => `${plan.change.year}|${plan.change.prodKey}`));
  const scopes = new Map();
  for (const plan of fixedPlans) {
    const key = `${plan.change.year}|${plan.change.prodKey}`;
    const prior = scopes.get(key);
    if (!prior || plan.change.orderWeek < prior.change.orderWeek) scopes.set(key, plan);
  }
  const verified = [];
  for (const plan of scopes.values()) {
    let calculated;
    try {
      calculated = await tQ(
        `DECLARE @r int,@m nvarchar(max),@returnCode int;
         EXEC @returnCode=dbo.usp_StockCalculation
              @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,
              @oResult=@r OUTPUT,@oMessage=@m OUTPUT;
         SELECT @returnCode AS returnCode,@r AS result,@m AS message,XACT_STATE() AS TransactionState;`,
        {
          yr: { type: sql.NVarChar, value: plan.change.year },
          wk: { type: sql.NVarChar, value: plan.change.orderWeek },
          pk: { type: sql.Int, value: Number(plan.change.prodKey) },
          uid: { type: sql.NVarChar, value: userId },
        },
      );
    } catch (error) {
      if (Number(error.number) === 266 && /current count\s*=\s*0\b/i.test(error.message || '')) {
        throw weekdayDistributionError('STOCK_CALC_TRANSACTION_ABORTED', '재고 재계산이 실패하여 전체 변경을 되돌렸습니다.', 500);
      }
      throw error;
    }
    assertNativeResult(calculated);
    if (positive.has(`${plan.change.year}|${plan.change.prodKey}`)) {
      const negative = await tQ(
        `SELECT TOP (1) sm.OrderYear,sm.OrderWeek,ps.Stock
           FROM ProductStock ps
           JOIN StockMaster sm ON sm.StockKey=ps.StockKey
          WHERE ps.ProdKey=@pk AND sm.OrderYearWeek>=@ywk AND ROUND(ps.Stock,3)<0
          ORDER BY sm.OrderYearWeek,sm.StockKey`,
        {
          pk: { type: sql.Int, value: Number(plan.change.prodKey) },
          ywk: { type: sql.NVarChar, value: `${plan.change.year}${plan.change.orderWeek.replace('-', '')}` },
        },
      );
      if (negative.recordset?.length) {
        throw futureStockShortageError({
          scope: {
            prodKey: plan.change.prodKey,
            prodName: plan.actual.product.ProdName,
            countryFlower: plan.actual.product.CountryFlower,
            orderYear: plan.change.year,
            orderWeek: plan.change.orderWeek,
          },
          negativeRow: negative.recordset[0],
        });
      }
    }
    verified.push({ prodKey: plan.change.prodKey, orderYear: plan.change.year, fromOrderWeek: plan.change.orderWeek, negative: false });
  }
  return verified;
}

async function verifyPlan(tQ, sql, plan) {
  const actual = await readActualScope(tQ, sql, plan.change);
  const expectedAfter = plan.newTotal <= EPSILON ? {
    detailRows: 0,
    shipmentOutQuantity: null,
    shipmentDates: [],
  } : {
    detailRows: 1,
    shipmentOutQuantity: plan.newTotal,
    shipmentDates: plan.finalDates,
  };
  const after = assertExpectedPhysicalSnapshot(actual, expectedAfter, `${plan.identity} 저장 후`);
  if (plan.newTotal > EPSILON) {
    const units = assertExactProductConversion(plan, plan.newTotal);
    const expectedCost = Number(plan.actual.detail?.DetailCost ?? plan.inheritedCost);
    const money = amountVatFromCostEst(expectedCost, units.estQty);
    const detail = actual.detail || {};
    const detailMatches = Math.abs(Number(detail.OutQuantity) - plan.newTotal) <= EPSILON
      && Math.abs(Number(detail.BoxQuantity) - Number(units.box)) <= EPSILON
      && Math.abs(Number(detail.BunchQuantity) - Number(units.bunch)) <= EPSILON
      && Math.abs(Number(detail.SteamQuantity) - Number(units.steam)) <= EPSILON
      && Math.abs(Number(detail.EstQuantity) - Number(units.estQty)) <= EPSILON
      && Math.abs(Number(detail.DetailCost) - expectedCost) <= EPSILON
      && Math.abs(Number(detail.DetailAmount) - Number(money.amount)) <= EPSILON
      && Math.abs(Number(detail.DetailVat) - Number(money.vat)) <= EPSILON
      && Boolean(detail.DetailIsFix) === Boolean(plan.fixed)
      && detail.ShipmentTimestamp === plan.representativeTimestamp
      && Boolean(actual.master?.MasterIsFix) === Boolean(plan.actual.master?.MasterIsFix);
    if (!detailMatches) {
      throw weekdayDistributionError(
        'WEEKDAY_VERIFY_FAILED',
        `${plan.identity}의 ShipmentDetail 환산·금액·확정·대표 출고일 readback이 다릅니다.`,
        500,
      );
    }
  }
  const visible = await tQ(
    `SELECT
       (SELECT COUNT(*) FROM ViewShipment vs
         WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.CustKey=@ck AND vs.ProdKey=@pk
           AND ISNULL(vs.OutQuantity,0)<>0) AS ShipmentCount,
       (SELECT ISNULL(SUM(vs.OutQuantity),0) FROM ViewShipment vs
         WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.CustKey=@ck AND vs.ProdKey=@pk
           AND ISNULL(vs.OutQuantity,0)<>0) AS ShipmentQty,
       (SELECT COUNT(*) FROM ViewOrder vo
         WHERE vo.OrderYear=@yr AND vo.OrderWeek=@wk AND vo.CustKey=@ck AND vo.ProdKey=@pk
           AND ISNULL(vo.OutQuantity,0)>0) AS OrderCount,
       (SELECT COUNT(*) FROM ShipmentDate d
         JOIN ShipmentDetail sd ON sd.SdetailKey=d.SdetailKey
         JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         JOIN PeriodDay pd ON pd.BaseYmd=d.ShipmentDtm
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sd.ProdKey=@pk) AS ExactDateCount`,
    paramsFor(sql, plan.change),
  );
  const row = visible.recordset?.[0] || {};
  if (plan.newTotal <= EPSILON) {
    if (Number(row.ShipmentCount) !== 0 || Number(row.ExactDateCount) !== 0) {
      throw weekdayDistributionError('WEEKDAY_VERIFY_FAILED', `${plan.identity}의 0수량 정리 검증에 실패했습니다.`, 500);
    }
  } else if (Number(row.ShipmentCount) !== 1
    || Math.abs(Number(row.ShipmentQty) - plan.newTotal) > EPSILON
    || Number(row.OrderCount) < 1
    || Number(row.ExactDateCount) !== plan.finalDates.length) {
    throw weekdayDistributionError('WEEKDAY_VERIFY_FAILED', `${plan.identity}의 전산 주문·출고·달력 노출 검증에 실패했습니다.`, 500);
  }
  return permanentWeekdaySnapshot(plan.change, actual);
}

async function verifyFinalProductStock(tQ, sql, plans) {
  const expectedByProduct = new Map();
  for (const plan of plans) {
    const key = String(plan.change.prodKey);
    const prior = expectedByProduct.get(key);
    const observedStart = Number(plan.actual.product?.Stock);
    if (!Number.isFinite(observedStart)) {
      throw weekdayDistributionError('PRODUCT_STOCK_INVALID', `품목 ${plan.change.prodKey}의 저장 전 현재고가 올바르지 않습니다.`, 500);
    }
    if (prior && Math.abs(prior.start - observedStart) > EPSILON) {
      throw weekdayDistributionError('PRODUCT_STOCK_STALE', `품목 ${plan.change.prodKey}의 잠긴 현재고 기준이 작업 항목 간 다릅니다.`, 409);
    }
    const entry = prior || {
      prodKey: plan.change.prodKey, start: observedStart, fixedDelta: 0, stockWasWritten: false,
    };
    if (plan.fixed) {
      entry.fixedDelta = normalizeShipmentQty(entry.fixedDelta + plan.delta);
      if (Math.abs(plan.delta) > EPSILON) entry.stockWasWritten = true;
    }
    expectedByProduct.set(key, entry);
  }
  for (const entry of expectedByProduct.values()) {
    const result = await tQ(`SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`, {
      pk: { type: sql.Int, value: Number(entry.prodKey) },
    });
    const actual = Number(result.recordset?.[0]?.Stock);
    const expected = entry.stockWasWritten
      ? normalizeShipmentQty(entry.start - entry.fixedDelta)
      : entry.start;
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > EPSILON) {
      throw weekdayDistributionError(
        'PRODUCT_STOCK_READBACK_MISMATCH',
        `품목 ${entry.prodKey}의 최종 현재고가 예상값과 다릅니다. 전체 작업을 되돌렸습니다.`,
        500,
        { expected, actual },
      );
    }
  }
}

async function persistAudit(tQ, sql, request, plans, afterByPlan, stockByPlan, response) {
  for (const plan of plans) {
    await tQ(
      `INSERT INTO dbo.WebWeekdayDistributionChange
         (OperationFK,[Year],[Week],CustKey,ProdKey,BeforeJson,AfterJson,StockValuesIfKnown)
       VALUES (@op,@yr,@wk,@ck,@pk,@before,@after,@stock)`,
      {
        op: { type: sql.UniqueIdentifier, value: request.operationId },
        yr: { type: sql.Char(4), value: plan.change.year },
        wk: { type: sql.VarChar(5), value: plan.change.orderWeek },
        ck: { type: sql.Int, value: Number(plan.change.custKey) },
        pk: { type: sql.Int, value: Number(plan.change.prodKey) },
        before: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(plan.beforeAudit) },
        after: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(afterByPlan.get(plan)) },
        stock: { type: sql.NVarChar(sql.MAX), value: stockByPlan.get(plan) == null ? null : JSON.stringify(stockByPlan.get(plan)) },
      },
    );
  }
  const saved = await tQ(
    `UPDATE dbo.WebWeekdayDistributionOperation
        SET ResponseJson=@response
      WHERE UUID=@op AND ResponseJson IS NULL`,
    {
      op: { type: sql.UniqueIdentifier, value: request.operationId },
      response: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(response) },
    },
  );
  const count = Number(saved.rowsAffected?.[0] ?? saved.rowsAffected ?? 0);
  if (count !== 1) throw weekdayDistributionError('WEEKDAY_AUDIT_WRITE_FAILED', '작업 완료 응답을 감사 테이블에 저장하지 못했습니다.', 500);
}

function requiredDependency(dependencies, name) {
  if (typeof dependencies?.[name] !== 'function') throw new TypeError(`weekday apply dependency ${name} is required`);
}

export async function executeWeekdayDistributionApply(tQ, sql, rawBody, user = {}, dependencies = {}) {
  for (const name of [
    'assertGateCapability', 'lockGate', 'acquireEditLease', 'assertEditGuard',
    'advanceEditGuard', 'releaseEditLease',
  ]) requiredDependency(dependencies, name);
  const request = normalizeWeekdayApplyRequest(rawBody);
  const userId = exactUser(user);
  const requestHash = weekdayRequestHash(request);

  // Gate ownership V2 must be held before every ERP business row lock.
  await dependencies.assertGateCapability(tQ);
  await dependencies.lockGate(tQ);
  await assertWeekdayAuditSchema(tQ);
  const replay = await reserveOperation(tQ, sql, request, userId, requestHash);
  if (replay) return replay;

  const leases = [];
  let failure = null;
  try {
    leases.push(...await acquireInternalLeases(tQ, request, user, dependencies));
    const plans = await preparePlans(tQ, sql, request);
    const stockValidation = {
      availability: await checkPositiveStock(tQ, sql, plans),
      postNative: [],
    };
    await assertStockHistoryPolicy(tQ, plans);
    const newTargetGroups = await prepareNewTargetGroups(tQ, sql, plans);
    if (newTargetGroups.length) {
      await materializeOverflowTargets(tQ, sql, newTargetGroups, userId, {
        allowOrderCreate: false,
        allocateShipmentDetailKey: allocateWeekdayShipmentDetailKey,
      });
      for (const group of newTargetGroups) {
        const plan = group.plan;
        const preservedOrder = await tQ(
          `SELECT om.OrderMasterKey,od.OrderDetailKey,od.OutQuantity
             FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
             JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK)
               ON od.OrderMasterKey=om.OrderMasterKey AND od.ProdKey=@pk AND ISNULL(od.isDeleted,0)=0
            WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0`,
          paramsFor(sql, plan.change),
        );
        const order = preservedOrder.recordset?.[0];
        if (preservedOrder.recordset?.length !== 1
          || Number(order.OrderMasterKey) !== group.preservedOrder.orderMasterKey
          || Number(order.OrderDetailKey) !== group.preservedOrder.orderDetailKey
          || Math.abs(Number(order.OutQuantity) - group.preservedOrder.outQuantity) > EPSILON) {
          throw weekdayDistributionError(
            'ORDER_PRESERVATION_FAILED',
            `${plan.identity} 신규 출고 target 생성 중 기존 주문이 생성·변경되었습니다. 전체 작업을 되돌렸습니다.`,
            500,
          );
        }
        if (!Number.isInteger(Number(group.row.SdetailKey)) || Number(group.row.SdetailKey) <= 0) {
          throw weekdayDistributionError('NEW_TARGET_CREATE_FAILED', `${plan.identity}의 신규 ShipmentDetail을 만들지 못했습니다.`, 500);
        }
        plan.actual.detail = {
          SdetailKey: Number(group.row.SdetailKey),
          ShipmentKey: Number(group.row.ShipmentKey),
          CustKey: plan.change.custKey,
          ProdKey: plan.change.prodKey,
          DetailCost: Number(plan.inheritedCost),
          DetailIsFix: 1,
          OutQuantity: 0,
        };
        plan.fixed = true;
      }
    }

    const keyMode = await inspectShipmentDateKeyMode(tQ);
    const stockByPlan = new Map();
    const writeOrder = [...plans].sort((left, right) => {
      const leftRank = left.fixed && left.delta < -EPSILON ? 0 : left.fixed && left.delta > EPSILON ? 2 : 1;
      const rightRank = right.fixed && right.delta < -EPSILON ? 0 : right.fixed && right.delta > EPSILON ? 2 : 1;
      return leftRank - rightRank || left.identity.localeCompare(right.identity);
    });
    for (const plan of writeOrder) {
      stockByPlan.set(plan, await applyStockDelta(tQ, sql, plan, userId));
      await writePlan(tQ, sql, plan, userId, request.operationId, keyMode);
    }
    stockValidation.postNative = await nativeStockRecalculation(tQ, sql, plans, userId);
    await verifyFinalProductStock(tQ, sql, plans);

    const afterByPlan = new Map();
    for (const plan of plans) afterByPlan.set(plan, await verifyPlan(tQ, sql, plan));
    for (const owned of leases) {
      await dependencies.advanceEditGuard(tQ, owned.scope, user, { editGuard: owned.editGuard });
    }
    const changes = plans.map((plan) => ({
      year: plan.change.year,
      orderWeek: plan.change.orderWeek,
      prodKey: plan.change.prodKey,
      unit: plan.change.unit,
      oldQuantity: plan.oldTotal,
      newQuantity: plan.newTotal,
      delta: plan.delta,
      fixed: plan.fixed,
      createdTarget: plan.newDetail,
      purged: plan.purged,
      before: plan.beforeAudit,
      after: afterByPlan.get(plan),
    }));
    const response = {
      success: true,
      operationId: request.operationId,
      appliedCount: plans.filter((plan) => plan.changed).length,
      changes,
      saved: true,
    };
    await persistAudit(tQ, sql, request, plans, afterByPlan, stockByPlan, response);
    return response;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await releaseInternalLeases(tQ, leases, user, dependencies, failure);
  }
}

export function weekdayDistributionErrorResponse(error = {}) {
  const conflictCodes = new Set([
    'NEEDS_REDESIGN', 'STALE_SNAPSHOT', 'CALENDAR_MISMATCH', 'CALENDAR_TIMESTAMP_MISMATCH',
    'DATE_TOTAL_MISMATCH', 'OUT_UNIT_MISMATCH', 'SHIPMENT_CUSTOMER_MISMATCH',
    'WEEKDAY_OPERATION_CONFLICT', 'ERP_EDIT_LOCKED', 'ERP_EDIT_STALE',
    'ERP_EDIT_GUARD_INVALID', 'STOCK_SHORTAGE', 'FUTURE_STOCK_SHORTAGE',
    'STOCK_HISTORY_TYPE_CONFLICT', 'STOCK_GATE_BUSY',
  ]);
  const status = Number(error.statusCode || error.status)
    || (conflictCodes.has(error.code) ? 409 : 500);
  return {
    status,
    body: {
      success: false,
      code: error.code,
      error: error.message || '요일별 배분 저장 중 오류가 발생했습니다.',
      missingScope: error.missingScope || [],
      expected: error.expected,
      actual: error.actual,
      expectedDigest: error.expectedDigest,
      actualDigest: error.actualDigest,
      lease: error.lease || null,
      stockValidation: error.stockValidation || null,
      ...weekdayRollbackAcknowledgement(error),
      ...preWriteStockGateAcknowledgement(error),
    },
  };
}

export function weekdayRollbackAcknowledgement(error = {}) {
  if (error.weekdayTransactionBodyFailed !== true) return {};
  const code = String(error.code || error.name || '').toUpperCase();
  const message = String(error.message || '');
  const ambiguousCode = new Set([
    'ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ECONNRESET', 'EPIPE',
    'COMMIT_OUTCOME_UNKNOWN', 'TRANSPORT_OUTCOME_UNKNOWN',
  ]);
  if (ambiguousCode.has(code)
    || /\b(timeout|timed out|socket|transport|connection (?:closed|lost|reset)|network|commit outcome)\b/i.test(message)) {
    return {};
  }
  return { rolledBack: true };
}
