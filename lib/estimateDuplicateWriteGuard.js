import crypto from 'crypto';
import { sql } from './db.js';
import { normalizeUnit } from './salesDefectDeductionCore.js';

export const ESTIMATE_DUPLICATE_REVIEW_REQUIRED = 'ESTIMATE_DUPLICATE_REVIEW_REQUIRED';

const text = (value) => String(value ?? '').trim();
const parentWeekNumber = (value) => {
  const raw = text(value).split('-')[0];
  const week = Number(raw);
  return Number.isInteger(week) && week >= 1 && week <= 53 ? week : null;
};
const dateOnly = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
};
const closeNumber = (left, right) => Number.isFinite(Number(left))
  && Number.isFinite(Number(right))
  && Math.abs(Number(left) - Number(right)) < 0.0001;

function fail(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  Object.assign(error, extra);
  throw error;
}

export function normalizeEstimateDuplicateUnit(value) {
  return normalizeUnit(value).toLocaleLowerCase('ko-KR');
}

export function estimateDuplicateLockResource({ year, parentWeek, custKey, prodKey } = {}) {
  const scope = {
    version: 1,
    year: Number(year),
    parentWeek: parentWeekNumber(parentWeek),
    custKey: Number(custKey),
    prodKey: Number(prodKey),
  };
  if (!Number.isInteger(scope.year) || scope.year < 2000 || scope.year > 9999
    || !scope.parentWeek || !Number.isInteger(scope.custKey) || scope.custKey <= 0
    || !Number.isInteger(scope.prodKey) || scope.prodKey <= 0) {
    fail('견적 중복검사 업무 범위가 올바르지 않습니다.', 'ESTIMATE_DUPLICATE_SCOPE_INVALID');
  }
  const canonical = JSON.stringify(scope);
  return `nenova:estimate-duplicate:v1:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

export async function acquireEstimateDuplicateWriteLock(tQ, scope) {
  if (typeof tQ !== 'function') fail('견적 중복검사 트랜잭션이 없습니다.', 'ESTIMATE_DUPLICATE_SCOPE_INVALID');
  const resource = estimateDuplicateLockResource(scope);
  const result = await tQ(
    `DECLARE @lockResult INT;
     EXEC @lockResult=sys.sp_getapplock
       @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
     SELECT @lockResult AS LockResult;`,
    { resource: { type: sql.NVarChar, value: resource } },
  );
  const rawLockResult = result.recordset?.[0]?.LockResult;
  const lockResult = typeof rawLockResult === 'number'
    ? rawLockResult
    : typeof rawLockResult === 'string' && /^-?\d+$/.test(rawLockResult.trim())
      ? Number(rawLockResult)
      : Number.NaN;
  if (!Number.isInteger(lockResult) || lockResult < 0) {
    fail(
      '같은 차수·업체·품목의 견적 저장이 진행 중입니다. 잠시 후 다시 확인하세요.',
      'ESTIMATE_DUPLICATE_LOCK_FAILED',
      { lockResult },
    );
  }
  return { resource, lockResult };
}

function canonicalFamily(row) {
  return text(row?.Descr2 || row?.Descr).toLocaleLowerCase('ko-KR');
}

async function resolveTypeIdentityAndDescr(tQ, estimateType, descr) {
  const type = text(estimateType);
  if (!type) fail('견적 구분을 확인할 수 없어 저장을 중단했습니다.', 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
  const result = await tQ(
    `SELECT ci.DetailCode,ci.Descr,ci.Descr2,
            CASE
              WHEN ISNULL(@type,N'')<>N'정상출고'
               AND ISNULL(@descr,N'')<>N''
               AND (
                 @descr LIKE N'%차감수량%'
                 OR @descr LIKE N'%차감단가%'
                 OR @descr LIKE N'%수량%변동%'
                 OR @descr LIKE N'%분배%변동%'
                 OR @descr LIKE N'%단가%변경%'
               )
              THEN dbo.fn_SanitizeEstimateDescr(@descr)
              ELSE ISNULL(@descr,N'')
            END AS CanonicalDescr
       FROM CodeInfo ci WITH (HOLDLOCK)
      WHERE ci.Category=N'EstimateType' AND ci.DetailCode=@type
      ORDER BY ci.DetailCode,ci.Descr`,
    {
      type: { type: sql.NVarChar, value: type },
      descr: { type: sql.NVarChar, value: String(descr ?? '') },
    },
  );
  const rows = result.recordset || [];
  if (rows.length !== 1 || !canonicalFamily(rows[0])) {
    fail('견적 구분의 전산 분류가 없거나 여러 행과 겹쳐 저장을 중단했습니다.', 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
  }
  return {
    typeCode: text(rows[0].DetailCode),
    family: canonicalFamily(rows[0]),
    canonicalDescr: String(rows[0].CanonicalDescr ?? ''),
  };
}

function duplicateError(estimateKey, conflictEstimateKeys) {
  const key = Number(estimateKey);
  const error = new Error(`동일한 유형·출고·품목·단위·수량·단가·일자·적요의 기존 견적 #${key}이 있습니다. 기존 행을 확인하세요.`);
  error.code = ESTIMATE_DUPLICATE_REVIEW_REQUIRED;
  error.statusCode = 409;
  error.existingEstimateKey = key;
  error.conflictEstimateKey = key;
  error.conflictEstimateKeys = conflictEstimateKeys;
  return error;
}

export async function assertNoDuplicateEstimateWrite(tQ, input = {}) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity)) {
    fail('견적 중복검사 수량이 올바르지 않습니다.', 'ESTIMATE_DUPLICATE_SCOPE_INVALID');
  }
  if (!(quantity < 0)) return { checked: false, reason: 'positive-estimate' };

  const scope = {
    year: input.year,
    parentWeek: input.parentWeek,
    custKey: input.custKey,
    prodKey: input.prodKey,
  };
  const lock = input.lockAlreadyHeld
    ? { resource: estimateDuplicateLockResource(scope), lockResult: null, alreadyHeld: true }
    : await acquireEstimateDuplicateWriteLock(tQ, scope);
  const identity = await resolveTypeIdentityAndDescr(tQ, input.estimateType, input.descr);
  const fullWeek = text(input.fullWeek);
  const shipmentKey = Number(input.shipmentKey);
  const excludeEstimateKey = Number(input.excludeEstimateKey || 0);
  const targetDate = dateOnly(input.estimateDate);
  const targetParentWeek = parentWeekNumber(input.parentWeek);
  const fullParentWeek = parentWeekNumber(fullWeek);
  const targetUnit = normalizeEstimateDuplicateUnit(input.unit);
  if (!/^\d{1,2}-\d{2}$/.test(fullWeek) || !targetParentWeek || fullParentWeek !== targetParentWeek
    || !Number.isInteger(shipmentKey) || shipmentKey <= 0 || !targetDate
    || !Number.isFinite(Number(input.cost)) || !targetUnit
    || !Number.isInteger(excludeEstimateKey) || excludeEstimateKey < 0) {
    fail('견적 중복검사 대상 정보가 올바르지 않습니다.', 'ESTIMATE_DUPLICATE_SCOPE_INVALID');
  }

  const result = await tQ(
    `SELECT e.EstimateKey,e.EstimateType,e.Unit,e.Quantity,e.Cost,e.EstimateDtm,e.ShipmentKey,
            ISNULL(e.Descr,N'') AS StoredDescr,
            ci.DetailCode AS TypeDetailCode,ci.Descr AS TypeDescr,ci.Descr2 AS TypeDescr2
       FROM Estimate e WITH (UPDLOCK,HOLDLOCK)
       JOIN ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.ShipmentKey=e.ShipmentKey
       LEFT JOIN CodeInfo ci WITH (HOLDLOCK)
         ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE sm.OrderYear=@year AND sm.OrderWeek=@fullWeek AND sm.CustKey=@custKey
        AND e.ShipmentKey=@shipmentKey AND e.ProdKey=@prodKey AND e.Quantity<0
        AND ABS(ABS(e.Quantity)-ABS(@quantity))<0.0001
        AND ABS(ISNULL(e.Cost,0)-@cost)<0.0001
        AND CONVERT(date,e.EstimateDtm)=@estimateDate
        AND ISNULL(e.Descr,N'')=@canonicalDescr
        AND (@excludeEstimateKey=0 OR e.EstimateKey<>@excludeEstimateKey)
        AND ISNULL(sm.isDeleted,0)=0
      ORDER BY e.EstimateKey`,
    {
      year: { type: sql.Int, value: Number(input.year) },
      fullWeek: { type: sql.NVarChar, value: fullWeek },
      custKey: { type: sql.Int, value: Number(input.custKey) },
      shipmentKey: { type: sql.Int, value: shipmentKey },
      prodKey: { type: sql.Int, value: Number(input.prodKey) },
      quantity: { type: sql.Float, value: quantity },
      cost: { type: sql.Float, value: Number(input.cost) },
      estimateDate: { type: sql.Date, value: new Date(`${targetDate}T00:00:00`) },
      canonicalDescr: { type: sql.NVarChar, value: identity.canonicalDescr },
      excludeEstimateKey: { type: sql.Int, value: excludeEstimateKey },
    },
  );

  const candidates = new Map();
  for (const row of result.recordset || []) {
    if (normalizeEstimateDuplicateUnit(row.Unit) !== targetUnit
      || !closeNumber(row.Quantity, quantity)
      || !closeNumber(row.Cost, input.cost)
      || dateOnly(row.EstimateDtm) !== targetDate
      || String(row.StoredDescr ?? '') !== identity.canonicalDescr) continue;
    const key = Number(row.EstimateKey);
    if (!Number.isInteger(key) || key <= 0) fail('기존 견적 식별값이 올바르지 않아 저장을 중단했습니다.', 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
    const family = canonicalFamily({ Descr2: row.TypeDescr2, Descr: row.TypeDescr });
    if (!row.TypeDetailCode || !family) {
      fail(`기존 견적 #${key}의 전산 분류를 확인할 수 없어 저장을 중단했습니다.`, 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
    }
    if (!candidates.has(key)) candidates.set(key, new Set());
    candidates.get(key).add(family);
  }

  const conflicts = [];
  for (const [key, families] of candidates) {
    if (families.size !== 1) {
      fail(`기존 견적 #${key}의 전산 분류가 여러 행과 겹쳐 저장을 중단했습니다.`, 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
    }
    if ([...families][0] === identity.family) conflicts.push(key);
  }
  conflicts.sort((left, right) => left - right);
  if (conflicts.length) throw duplicateError(conflicts[0], conflicts);
  return { checked: true, lock, family: identity.family, canonicalDescr: identity.canonicalDescr };
}
