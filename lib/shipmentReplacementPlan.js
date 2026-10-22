import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 30 * 60 * 1000;
const MATCH_POLICY = 'catalog-original-name-v2';
function blocked(message) {
  return Object.assign(new Error(`${message} 다시 검증한 뒤 전체 적용하세요.`), {
    code: 'SHIPMENT_REPLACEMENT_REVERIFY', statusCode: 409,
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function signature(payload, secret) {
  if (!secret) throw blocked('전체 교체 검증 서명이 설정되지 않았습니다.');
  return createHmac('sha256', secret).update(`shipment-replacement-v1:${payload}`).digest('hex');
}
export function assertReplacementRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw blocked('전체 교체 대상이 없습니다.');
  const keys = new Set();
  for (const row of rows) {
    const key = `${row?.custKey}|${row?.prodKey}`;
    if (!Number.isSafeInteger(row?.custKey) || row.custKey <= 0 ||
        !Number.isSafeInteger(row?.prodKey) || row.prodKey <= 0 ||
        typeof row.uploadQty !== 'number' || !Number.isFinite(row.uploadQty) || row.uploadQty < 0 || keys.has(key)) {
      throw blocked('전체 교체 행에 잘못된 키·수량 또는 중복이 있습니다.');
    }
    keys.add(key);
  }
  return keys;
}
// A skip cannot safely identify every possible ERP product from an unmatched label.
// Restrict replacement to the remaining matched products, and sign that scope.
export function replacementScopeSql(scope, productAlias, categoryPredicate) {
  if (scope == null) return categoryPredicate;
  if (!Array.isArray(scope) || !scope.length || scope.some(k => !Number.isSafeInteger(k) || k <= 0) || new Set(scope).size !== scope.length) {
    throw blocked('적용 품목 범위가 유효하지 않습니다.');
  }
  return `${productAlias}.ProdKey IN (${scope.join(',')})`;
}
function planData(input) {
  assertReplacementRows(input.rows);
  if (input.replacementProductKeys != null) {
    replacementScopeSql(input.replacementProductKeys, 'p', '');
    if (input.rows.some(r => !input.replacementProductKeys.includes(r.prodKey))) throw blocked('적용 범위 밖 품목입니다.');
  }
  return { year: String(input.year), week: String(input.week), rows: input.rows,
    earlyImportMode: input.earlyImportMode, earlyLedgerFingerprint: input.earlyLedgerFingerprint,
    earlyImportScope: input.earlyImportScope, ...(input.replacementProductKeys != null ? { replacementProductKeys: input.replacementProductKeys } : {}) };
}
export function createReplacementPlan(preview, userId, { secret = process.env.JWT_SECRET, now = Date.now() } = {}) {
  if (!preview.rows?.length || !preview.success || preview.unmatched?.length || preview.rows?.some(row => row.fixBlocked)) return null;
  const input = { year: preview.orderYear, week: preview.week, rows: preview.rows,
    earlyImportMode: preview.earlyImport?.mode, earlyLedgerFingerprint: preview.earlyImport?.fingerprint,
    earlyImportScope: preview.earlyImport?.scope, replacementProductKeys: preview.replacementProductKeys };
  const payload = Buffer.from(JSON.stringify({ userId, issued: now, matchPolicy: MATCH_POLICY, hash: digest(planData(input)) })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function assertReplacementPlan(input, userId, { secret = process.env.JWT_SECRET, now = Date.now() } = {}) {
  if (input.fullCategoryReplacement !== true) throw blocked('이 업로드는 전체 교체만 지원합니다.');
  const [payload, sig, extra] = String(input.replacementPlan || '').split('.');
  if (!payload || !/^[a-f0-9]{64}$/.test(sig || '') || extra) throw blocked('전체 교체 검증 정보가 없습니다.');
  const expected = signature(payload, secret);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw blocked('전체 교체 검증 정보가 변경됐습니다.');
  let plan;
  try { plan = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw blocked('잘못된 검증 정보입니다.'); }
  if (plan.matchPolicy !== MATCH_POLICY) throw blocked('품목 매칭 기준이 업데이트됐습니다.');
  if (plan.userId !== userId || !Number.isFinite(plan.issued) || now < plan.issued || now - plan.issued > MAX_AGE_MS ||
      plan.hash !== digest(planData(input))) throw blocked('검증 후 대상·수량·계정이 바뀌었거나 검증 시간이 만료됐습니다.');
}

// Read raw shipment identities, never ViewOrder: deleted/missing orders must not hide leftovers.
export async function assertReplacementCoverage(queryFn, rows, year, week, sql, lock = false, replacementProductKeys = null) {
  const keys = assertReplacementRows(rows);
  const products = [...new Set(rows.map(row => row.prodKey))].join(',');
  const hint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const result = await queryFn(`SELECT DISTINCT sm.CustKey, sd.ProdKey
    FROM ShipmentMaster sm${hint}
    JOIN ShipmentDetail sd${hint} ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Product p ON p.ProdKey=sd.ProdKey
    WHERE sm.OrderYear=@replacementYear AND sm.OrderWeek=@replacementWeek
      AND ISNULL(sm.isDeleted,0)=0
      AND ${replacementScopeSql(replacementProductKeys, 'p', `p.CountryFlower IN (SELECT CountryFlower FROM Product WHERE ProdKey IN (${products}))`)}
      AND (ISNULL(sd.OutQuantity,0)<>0 OR EXISTS
        (SELECT 1 FROM ShipmentDate d WHERE d.SdetailKey=sd.SdetailKey AND ISNULL(d.ShipmentQuantity,0)<>0))`, {
    replacementYear: { type: sql.NVarChar, value: String(year) },
    replacementWeek: { type: sql.NVarChar, value: String(week) },
  });
  const missing = (result.recordset || []).filter(row => !keys.has(`${row.CustKey}|${row.ProdKey}`));
  if (missing.length) throw blocked(`전체 교체 목록에 없는 기존 분배 ${missing.length}건이 있습니다. 저장하지 않았습니다.`);
}
