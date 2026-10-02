import crypto from 'node:crypto';
import { normalizeShipmentQty } from './shipmentAvailability.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { weekdaySaveEligibility, exeWeekdayRepresentativeTimestamp } from './weekdayErpCompatibility.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEK_RE = /^(\d{2})-(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
const SNAPSHOT_DIGEST_RE = /^[0-9a-f]{64}$/;
const MAX_CHANGES = 200;
const MAX_DATES_PER_CHANGE = 31;
const NUMBER_EPSILON = 0.000000001;

export function weekdayDistributionError(code, message, statusCode = 409, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function invalid(message) {
  throw weekdayDistributionError('INVALID_WEEKDAY_APPLY_REQUEST', message, 400);
}

function redesign(message, missingScope = []) {
  throw weekdayDistributionError('NEEDS_REDESIGN', message, 409, { missingScope });
}

function strictNumber(value, label, { integer = false, nullable = false, min = 0 } = {}) {
  if (value == null && nullable) return null;
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    invalid(`${label} 값이 필요합니다.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min) {
    invalid(`${label} 값이 올바르지 않습니다.`);
  }
  return number;
}

function strictDate(value, label) {
  const text = String(value ?? '').trim();
  if (!DATE_RE.test(text)) invalid(`${label}은 YYYY-MM-DD 형식이어야 합니다.`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    invalid(`${label}이 실제 날짜가 아닙니다.`);
  }
  return text;
}

function strictTimestamp(value, label) {
  const text = String(value ?? '').trim();
  if (!TIMESTAMP_RE.test(text)) invalid(`${label}은 DB의 정확한 yyyy-MM-dd HH:mm:ss.fff 값이어야 합니다.`);
  const parsed = new Date(`${text.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed.getTime())) invalid(`${label}이 실제 시각이 아닙니다.`);
  return text;
}

function optionalDbNumber(value, label) {
  if (value == null) return null;
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    invalid(`${label} 값이 올바르지 않습니다.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) invalid(`${label} 값이 올바르지 않습니다.`);
  return number;
}

function normalizeFixed(value, label) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  invalid(`${label} 확정 상태가 올바르지 않습니다.`);
}

function normalizeExpectedDate(row, index) {
  const label = `expected.shipmentDates[${index}]`;
  for (const field of [
    'sdateKey', 'sdetailKey', 'shipmentKey', 'date', 'timestamp', 'shipmentQuantity',
    'estimateQuantity', 'detailFixed', 'cost', 'amount', 'vat',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(row || {}, field)) invalid(`${label}.${field}가 누락되었습니다.`);
  }
  const date = strictDate(row.date, `${label}.date`);
  const timestamp = strictTimestamp(row.timestamp, `${label}.timestamp`);
  if (timestamp.slice(0, 10) !== date) invalid(`${label}의 날짜와 정확 시각이 다릅니다.`);
  return {
    sdateKey: strictNumber(row.sdateKey, `${label}.sdateKey`, { integer: true, min: 1 }),
    sdetailKey: strictNumber(row.sdetailKey, `${label}.sdetailKey`, { integer: true, min: 1 }),
    shipmentKey: strictNumber(row.shipmentKey, `${label}.shipmentKey`, { integer: true, min: 1 }),
    date,
    timestamp,
    shipmentQuantity: strictNumber(row.shipmentQuantity, `${label}.shipmentQuantity`),
    estimateQuantity: strictNumber(row.estimateQuantity, `${label}.estimateQuantity`),
    detailFixed: normalizeFixed(row.detailFixed, label),
    cost: optionalDbNumber(row.cost, `${label}.cost`),
    amount: optionalDbNumber(row.amount, `${label}.amount`),
    vat: optionalDbNumber(row.vat, `${label}.vat`),
  };
}

function normalizeExpected(expected, label) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) invalid(`${label}.expected가 필요합니다.`);
  if (!Object.prototype.hasOwnProperty.call(expected, 'detailRows')
    || !Object.prototype.hasOwnProperty.call(expected, 'shipmentOutQuantity')
    || !Object.prototype.hasOwnProperty.call(expected, 'shipmentDates')
    || !Object.prototype.hasOwnProperty.call(expected, 'snapshotDigest')) {
    throw weekdayDistributionError(
      'EXPECTED_SNAPSHOT_DIGEST_REQUIRED',
      `${label}.expected에는 detailRows, shipmentOutQuantity, shipmentDates, snapshotDigest 전체가 필요합니다.`,
      400,
    );
  }
  const snapshotDigest = String(expected.snapshotDigest || '').trim();
  if (!SNAPSHOT_DIGEST_RE.test(snapshotDigest)) {
    throw weekdayDistributionError(
      'EXPECTED_SNAPSHOT_DIGEST_REQUIRED',
      `${label}.expected.snapshotDigest는 서버가 발급한 SHA-256 값이어야 합니다.`,
      400,
    );
  }
  const detailRows = strictNumber(expected.detailRows, `${label}.expected.detailRows`, { integer: true });
  const shipmentOutQuantity = optionalDbNumber(expected.shipmentOutQuantity, `${label}.expected.shipmentOutQuantity`);
  if (!Array.isArray(expected.shipmentDates) || expected.shipmentDates.length > MAX_DATES_PER_CHANGE) {
    invalid(`${label}.expected.shipmentDates는 최대 ${MAX_DATES_PER_CHANGE}행이어야 합니다.`);
  }
  const shipmentDates = expected.shipmentDates.map(normalizeExpectedDate)
    .sort((left, right) => left.sdateKey - right.sdateKey);
  const dateKeys = new Set();
  const timestamps = new Set();
  for (const row of shipmentDates) {
    if (dateKeys.has(row.sdateKey) || timestamps.has(row.timestamp)) {
      invalid(`${label}.expected.shipmentDates에 중복 물리행 또는 중복 시각이 있습니다.`);
    }
    dateKeys.add(row.sdateKey);
    timestamps.add(row.timestamp);
  }
  if (detailRows === 0 && (shipmentDates.length || ![null, 0].includes(shipmentOutQuantity))) {
    invalid(`${label}.expected의 출고상세가 없으면 날짜행도 없어야 합니다.`);
  }
  return { detailRows, shipmentOutQuantity, shipmentDates, snapshotDigest };
}

function normalizeChange(change, index, custKey) {
  const label = `changes[${index}]`;
  if (!change || typeof change !== 'object' || Array.isArray(change)) invalid(`${label}가 올바르지 않습니다.`);
  const year = String(change.year ?? '').trim();
  const orderWeek = String(change.orderWeek ?? '').trim();
  const weekMatch = WEEK_RE.exec(orderWeek);
  if (!/^\d{4}$/.test(year) || Number(year) <= 2025) invalid(`${label}.year는 2026년 이상의 명시 연도여야 합니다.`);
  if (!weekMatch || Number(weekMatch[1]) < 1 || Number(weekMatch[1]) > 53
    || Number(weekMatch[2]) < 1 || Number(weekMatch[2]) > 3) {
    invalid(`${label}.orderWeek는 NN-01~NN-03 형식이어야 합니다.`);
  }
  const prodKey = strictNumber(change.prodKey, `${label}.prodKey`, { integer: true, min: 1 });
  const unit = normalizeWeekdayUnit(change.unit);
  if (!unit) invalid(`${label}.unit은 박스/단/송이 중 실제 OutUnit이어야 합니다.`);
  if (!Array.isArray(change.dates) || !change.dates.length || change.dates.length > MAX_DATES_PER_CHANGE) {
    invalid(`${label}.dates는 변경할 날짜를 1~${MAX_DATES_PER_CHANGE}개 포함해야 합니다.`);
  }
  const seenDates = new Set();
  const dates = change.dates.map((row, dateIndex) => {
    const date = strictDate(row?.date, `${label}.dates[${dateIndex}].date`);
    const quantity = strictNumber(row?.quantity, `${label}.dates[${dateIndex}].quantity`);
    if (seenDates.has(date)) invalid(`${label}.dates에 ${date}가 중복되었습니다.`);
    seenDates.add(date);
    return { date, quantity };
  }).sort((left, right) => left.date.localeCompare(right.date));
  return {
    year,
    orderWeek,
    custKey,
    prodKey,
    unit,
    expected: normalizeExpected(change.expected, label),
    dates,
  };
}

export function normalizeWeekdayApplyRequest(body = {}) {
  const operationId = String(body.operationId ?? '').trim();
  const reason = String(body.reason ?? '').trim();
  const custKey = strictNumber(body.custKey, 'custKey', { integer: true, min: 1 });
  if (!UUID_RE.test(operationId)) invalid('operationId는 UUID여야 합니다.');
  if (!reason || reason.length > 1000) invalid('reason은 1~1000자로 입력하세요.');
  if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > MAX_CHANGES) {
    invalid(`changes는 1~${MAX_CHANGES}개여야 합니다.`);
  }
  const changes = body.changes.map((change, index) => normalizeChange(change, index, custKey));
  const identities = new Set();
  for (const change of changes) {
    const key = `${change.year}|${change.orderWeek}|${custKey}|${change.prodKey}`;
    if (identities.has(key)) invalid(`같은 연도·차수·업체·품목이 중복되었습니다. (${key})`);
    identities.add(key);
  }
  changes.sort((left, right) => `${left.year}|${left.orderWeek}|${left.prodKey}`
    .localeCompare(`${right.year}|${right.orderWeek}|${right.prodKey}`));
  return { operationId, reason, custKey, changes };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stableValue(value[key])]));
  return value;
}

function digestNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Object.is(number, -0) ? '0' : String(number);
}

function digestFixed(value) {
  if (value == null) return null;
  return value === true || value === 1;
}

/**
 * Canonical locked ERP state used by both the read API and apply core.
 * Decimal values are string tokens so 4+ decimal DB costs are not rounded to
 * the three-decimal shipment quantity normalizer.
 */
export function canonicalWeekdaySnapshotDigestInput(change = {}, actual = {}) {
  const detail = actual.detail || null;
  const master = actual.master || null;
  const product = actual.product || null;
  return stableValue({
    identity: {
      year: String(change.year || ''),
      orderWeek: String(change.orderWeek || ''),
      custKey: digestNumber(change.custKey),
      prodKey: digestNumber(change.prodKey),
    },
    detailRows: digestNumber(actual.detailRows || 0),
    shipmentOutQuantity: digestNumber(actual.shipmentOutQuantity),
    master: master ? {
      shipmentKey: digestNumber(master.ShipmentKey ?? master.shipmentKey),
      isFix: digestFixed(master.MasterIsFix ?? master.isFix),
      orderYearWeek: String(master.OrderYearWeek ?? master.orderYearWeek ?? ''),
    } : null,
    detail: detail ? {
      sdetailKey: digestNumber(detail.SdetailKey ?? detail.sdetailKey),
      shipmentKey: digestNumber(detail.ShipmentKey ?? detail.shipmentKey),
      shipmentTimestamp: detail.ShipmentTimestamp ?? detail.shipmentTimestamp ?? null,
      custKey: digestNumber(detail.CustKey ?? detail.custKey),
      prodKey: digestNumber(detail.ProdKey ?? detail.prodKey),
      outQuantity: digestNumber(detail.OutQuantity ?? detail.outQuantity),
      boxQuantity: digestNumber(detail.BoxQuantity ?? detail.boxQuantity),
      bunchQuantity: digestNumber(detail.BunchQuantity ?? detail.bunchQuantity),
      steamQuantity: digestNumber(detail.SteamQuantity ?? detail.steamQuantity),
      estimateQuantity: digestNumber(detail.EstQuantity ?? detail.estimateQuantity),
      cost: digestNumber(detail.DetailCost ?? detail.cost),
      amount: digestNumber(detail.DetailAmount ?? detail.amount),
      vat: digestNumber(detail.DetailVat ?? detail.vat),
      isFix: digestFixed(detail.DetailIsFix ?? detail.isFix),
    } : null,
    product: product ? {
      prodKey: digestNumber(product.ProdKey ?? product.prodKey),
      outUnit: product.OutUnit == null ? null : String(product.OutUnit),
      estUnit: product.EstUnit == null ? null : String(product.EstUnit),
      bunchOf1Box: digestNumber(product.BunchOf1Box),
      steamOf1Bunch: digestNumber(product.SteamOf1Bunch),
      steamOf1Box: digestNumber(product.SteamOf1Box),
    } : null,
    shipmentDates: (actual.shipmentDates || []).map((row) => ({
      sdateKey: digestNumber(row.sdateKey ?? row.SdateKey),
      sdetailKey: digestNumber(row.sdetailKey ?? row.SdetailKey),
      shipmentKey: digestNumber(row.shipmentKey ?? row.ShipmentKey),
      date: String(row.date ?? row.Date ?? ''),
      timestamp: String(row.timestamp ?? row.Timestamp ?? ''),
      shipmentQuantity: digestNumber(row.shipmentQuantity ?? row.ShipmentQuantity),
      estimateQuantity: digestNumber(row.estimateQuantity ?? row.EstQuantity),
      detailFixed: digestFixed(row.detailFixed ?? row.DetailFixed),
      cost: digestNumber(row.cost ?? row.Cost),
      amount: digestNumber(row.amount ?? row.Amount),
      vat: digestNumber(row.vat ?? row.Vat),
    })).sort((left, right) => Number(left.sdateKey) - Number(right.sdateKey)),
  });
}

export function weekdaySnapshotDigest(change, actual) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalWeekdaySnapshotDigestInput(change, actual)))
    .digest('hex');
}

export function assertWeekdaySnapshotDigest(change, actual) {
  const actualDigest = weekdaySnapshotDigest(change, actual);
  if (change.expected?.snapshotDigest !== actualDigest) {
    throw weekdayDistributionError(
      'STALE_SNAPSHOT',
      `${change.year}/${change.orderWeek}/업체${change.custKey}/품목${change.prodKey}의 상세·확정·단위 기준이 조회 이후 변경되었습니다. 다시 조회하세요.`,
      409,
      { expectedDigest: change.expected?.snapshotDigest, actualDigest },
    );
  }
  return actualDigest;
}

export function weekdayRequestHash(request) {
  const canonical = stableValue({
    reason: request.reason,
    custKey: request.custKey,
    changes: request.changes,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function canonicalPhysicalSnapshot(snapshot = {}) {
  return {
    detailRows: Number(snapshot.detailRows || 0),
    shipmentOutQuantity: snapshot.shipmentOutQuantity == null
      ? null : Number(snapshot.shipmentOutQuantity),
    shipmentDates: (snapshot.shipmentDates || []).map((row) => ({
      sdateKey: Number(row.sdateKey),
      sdetailKey: Number(row.sdetailKey),
      shipmentKey: Number(row.shipmentKey),
      date: String(row.date),
      timestamp: String(row.timestamp),
      shipmentQuantity: Number(row.shipmentQuantity),
      estimateQuantity: Number(row.estimateQuantity),
      detailFixed: row.detailFixed === true || row.detailFixed === 1,
      cost: row.cost == null ? null : Number(row.cost),
      amount: row.amount == null ? null : Number(row.amount),
      vat: row.vat == null ? null : Number(row.vat),
    })).sort((left, right) => left.sdateKey - right.sdateKey),
  };
}

function sameNumber(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(Number(left) - Number(right)) <= NUMBER_EPSILON;
}

export function assertExpectedPhysicalSnapshot(actualInput, expectedInput, identity = '') {
  const actual = canonicalPhysicalSnapshot(actualInput);
  const expected = canonicalPhysicalSnapshot(expectedInput);
  let same = actual.detailRows === expected.detailRows
    && sameNumber(actual.shipmentOutQuantity, expected.shipmentOutQuantity)
    && actual.shipmentDates.length === expected.shipmentDates.length;
  if (same) {
    same = actual.shipmentDates.every((row, index) => {
      const target = expected.shipmentDates[index];
      return row.sdateKey === target.sdateKey
        && row.sdetailKey === target.sdetailKey
        && row.shipmentKey === target.shipmentKey
        && row.date === target.date
        && row.timestamp === target.timestamp
        && sameNumber(row.shipmentQuantity, target.shipmentQuantity)
        && sameNumber(row.estimateQuantity, target.estimateQuantity)
        && row.detailFixed === target.detailFixed
        && sameNumber(row.cost, target.cost)
        && sameNumber(row.amount, target.amount)
        && sameNumber(row.vat, target.vat);
    });
  }
  if (!same) {
    throw weekdayDistributionError(
      'STALE_SNAPSHOT',
      `${identity || '대상'}의 전체 출고상세/날짜 기준이 조회 이후 변경되었습니다. 다시 조회하세요.`,
      409,
      { expected, actual },
    );
  }
  return actual;
}

function assertRequestedCalendar(change, calendar, existingDates) {
  const suffix = change.orderWeek.slice(-2);
  const allowed = suffix === '01' ? new Set([5, 6, 7, 1])
    : suffix === '02' ? new Set([2, 3, 4]) : null;
  if (!allowed) redesign(`${change.orderWeek}차의 목~수 업무주 날짜 배정 규칙이 정의되지 않았습니다.`, ['subweek-calendar-policy']);
  for (const patch of change.dates) {
    // Legacy ERP rows can be outside the current suffix convention. Their
    // locked exact PeriodDay timestamp is authoritative for edit/delete; only
    // a newly-created positive date must satisfy the current canonical suffix.
    if (existingDates.has(patch.date) || patch.quantity === 0) continue;
    const period = calendar.get(patch.date);
    if (!period || period.ambiguous || !period.timestamp || !allowed.has(Number(period.weekDay))) {
      throw weekdayDistributionError('CALENDAR_MISMATCH', `${change.year}/${change.orderWeek} ${patch.date}의 정확한 PeriodDay를 확인할 수 없습니다.`);
    }
  }
}

export function buildWeekdayChangePlan(change, actual, calendar) {
  const identity = `${change.year}/${change.orderWeek}/업체${change.custKey}/품목${change.prodKey}`;
  const before = assertExpectedPhysicalSnapshot(actual, change.expected, identity);
  if (actual.detailRows > 1) redesign(`${identity}에 ShipmentDetail이 ${actual.detailRows}개여서 임의 합산할 수 없습니다.`, ['multiple-shipment-details']);
  const eligibility = weekdaySaveEligibility(actual);
  if (!eligibility.allowed) throw weekdayDistributionError('ERP_CONFIRMATION_REQUIRED', `${identity}: ${eligibility.reason}`);
  if (actual.detailRows === 1 && (!actual.detail || !before.shipmentDates.length)) {
    redesign(`${identity}의 1 detail + N dates 기준이 불완전합니다.`, ['detail-date-shape']);
  }
  const rawByKey = new Map((actual.shipmentDates || []).map((row) => [Number(row.sdateKey), row]));
  const actualByDate = new Map(before.shipmentDates.map((row) => [row.date, {
    ...row,
    descr: String(rawByKey.get(Number(row.sdateKey))?.descr || ''),
  }]));
  assertRequestedCalendar(change, calendar, new Set(actualByDate.keys()));
  const finalByDate = new Map([...actualByDate].map(([date, row]) => [date, { ...row }]));
  for (const patch of change.dates) {
    const existing = actualByDate.get(patch.date);
    if (patch.quantity === 0) {
      finalByDate.delete(patch.date);
      continue;
    }
    const period = calendar.get(patch.date);
    finalByDate.set(patch.date, {
      ...(existing || {}),
      sdateKey: existing?.sdateKey || null,
      sdetailKey: existing?.sdetailKey || actual.detail?.SdetailKey || null,
      shipmentKey: existing?.shipmentKey || actual.master?.ShipmentKey || null,
      date: patch.date,
      timestamp: existing?.timestamp || period.timestamp,
      shipmentQuantity: patch.quantity,
      detailFixed: existing?.detailFixed ?? Boolean(actual.detail?.DetailIsFix ?? actual.master?.MasterIsFix),
      cost: existing?.cost ?? actual.detail?.DetailCost ?? null,
      amount: existing?.amount ?? null,
      vat: existing?.vat ?? null,
      estimateQuantity: existing?.estimateQuantity ?? 0,
      descr: existing?.descr ?? '',
      isNew: !existing,
    });
  }
  const finalDates = [...finalByDate.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const oldTotal = Number(before.shipmentDates.reduce((sum, row) => sum + Number(row.shipmentQuantity), 0).toFixed(9));
  if (actual.detailRows === 1 && !sameNumber(oldTotal, before.shipmentOutQuantity)) {
    throw weekdayDistributionError('DATE_TOTAL_MISMATCH', `${identity}의 기존 날짜합계와 ShipmentDetail.OutQuantity가 다릅니다.`);
  }
  const newTotal = Number(finalDates.reduce((sum, row) => sum + Number(row.shipmentQuantity), 0).toFixed(9));
  if (actual.detailRows === 0 && newTotal <= 0) {
    throw weekdayDistributionError('NO_POSITIVE_TARGET', `${identity}의 신규 대상에는 양수 날짜수량이 필요합니다.`, 400);
  }
  const delta = normalizeShipmentQty(newTotal - Number(before.shipmentOutQuantity || 0));
  let representativeTimestamp;
  try { representativeTimestamp = exeWeekdayRepresentativeTimestamp(finalDates, calendar); }
  catch (error) { throw weekdayDistributionError('CALENDAR_MISMATCH', `${identity}: ${error.message}`); }
  return {
    identity,
    change,
    actual,
    before,
    finalDates,
    representativeTimestamp,
    oldTotal: Number(before.shipmentOutQuantity || 0),
    newTotal,
    delta,
    fixed: actual.detailRows === 1
      ? Boolean(actual.detail.DetailIsFix) : Boolean(actual.master?.MasterIsFix),
    newDetail: actual.detailRows === 0,
    purged: actual.detailRows === 1 && newTotal === 0,
    changed: Math.abs(delta) > NUMBER_EPSILON
      || change.dates.some((patch) => {
        const row = actualByDate.get(patch.date);
        return !row ? patch.quantity > 0 : !sameNumber(row.shipmentQuantity, patch.quantity);
      }),
  };
}

export function resolveNewTargetCosts(plans = []) {
  const byProduct = new Map();
  for (const plan of plans) {
    const key = String(plan.change.prodKey);
    const list = byProduct.get(key) || [];
    list.push(plan);
    byProduct.set(key, list);
  }
  for (const productPlans of byProduct.values()) {
    const newTargets = productPlans.filter((plan) => plan.newDetail);
    if (!newTargets.length) continue;
    const net = normalizeShipmentQty(productPlans.reduce((sum, plan) => sum + plan.delta, 0));
    const sources = productPlans.filter((plan) => !plan.newDetail && plan.fixed && plan.delta < -NUMBER_EPSILON);
    const rawSourceCosts = sources.map((plan) => Number(plan.actual.detail?.DetailCost));
    const sourceCostsValid = rawSourceCosts.every((value) => Number.isFinite(value) && value > 0);
    const sourceCosts = [...new Set(rawSourceCosts)];
    const targetMastersFixed = newTargets.every((plan) => plan.actual.master?.MasterIsFix === true
      || plan.actual.master?.MasterIsFix === 1);
    if (Math.abs(net) > NUMBER_EPSILON || !sources.length || !sourceCostsValid
      || sourceCosts.length !== 1 || !targetMastersFixed) {
      redesign(
        `품목 ${productPlans[0].change.prodKey}의 신규 차수 대상은 확정 마스터, 같은-total 이동, 확정 원천과 유일한 원천 단가가 필요합니다.`,
        ['new-target-fixed-master', 'new-target-source-link', 'new-target-price'],
      );
    }
    for (const target of newTargets) target.inheritedCost = sourceCosts[0];
  }
  return plans;
}

export function positiveWeekdayIncreaseByProduct(plans = []) {
  const increases = new Map();
  for (const plan of plans) {
    if (plan.delta <= NUMBER_EPSILON) continue;
    const key = String(plan.change.prodKey);
    const current = increases.get(key) || {
      prodKey: plan.change.prodKey,
      prodName: plan.actual.product?.ProdName || '',
      countryFlower: plan.actual.product?.CountryFlower || '',
      increase: 0,
    };
    current.increase = normalizeShipmentQty(current.increase + plan.delta);
    increases.set(key, current);
  }
  return [...increases.values()];
}
