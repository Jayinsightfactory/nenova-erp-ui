import crypto from 'crypto';
import { requireOrderYear } from './orderUtils.js';
import { normalizeOrderUnit } from './orderUtils.js';
import { amountVatFromCostEst, distributeUnits } from './distributeUnits.js';

const PLAN_TTL_MS = 20 * 60 * 1000;
if (!global._dutchVolumePlans) global._dutchVolumePlans = new Map();
const plans = global._dutchVolumePlans;

export function dutchError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function normalizeDutchPrice(value) {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw dutchError('INVALID_KRW_PRICE', '원화 단가는 숫자 또는 숫자 문자열이어야 합니다.');
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
    throw dutchError('INVALID_KRW_PRICE', '원화 단가는 공란 또는 0~1,000,000,000 범위의 유한한 숫자여야 합니다.');
  }
  return price;
}

export function dutchInputUnitIssue(product, entry) {
  if (Number(entry?.quantity) > 0 && !String(entry?.unit || '').trim()
      && /알스트로|alstroe?meria/i.test(`${product?.FlowerName || ''} ${product?.ProdName || ''}`)) {
    return '알스트로 물량표는 박스 환산 표시이므로 입력 단위를 직접 선택해야 합니다. 원본이 박스 수량이면 박스, 단 수량이면 단을 선택하세요.';
  }
  return '';
}

export function normalizeDutchEntries(body) {
  const { orderYear, orderWeek } = requireOrderYear(body?.week, body?.year);
  const entries = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 5000) {
    throw dutchError('INVALID_ENTRIES', '물량표 행은 1~5000건이어야 합니다.');
  }
  const seenIds = new Set();
  const normalized = entries.map((entry, index) => {
    const id = String(entry?.id ?? '').trim();
    if (!id || id.length > 120 || seenIds.has(id)) throw dutchError('DUPLICATE_ENTRY_ID', '행 ID가 비었거나 중복되었습니다.');
    seenIds.add(id);
    const quantity = Number(entry?.quantity);
    if ((typeof entry?.quantity !== 'number' && typeof entry?.quantity !== 'string') || entry?.quantity == null || String(entry.quantity).trim() === '' || !Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000_000) {
      throw dutchError('INVALID_QUANTITY', `${id}: 수량은 0~1,000,000,000 범위의 유한한 숫자여야 합니다.`);
    }
    const unit = String(entry?.unit || '').trim();
    if (unit && !['박스', '단', '송이'].includes(unit)) throw dutchError('INVALID_UNIT', `${id}: 지원하지 않는 단위입니다.`);
    const custKey = optionalKey(entry?.custKey, id, '업체');
    const prodKey = optionalKey(entry?.prodKey, id, '품목');
    return {
      id, index,
      product: String(entry?.product || '').trim().slice(0, 200),
      color: String(entry?.color || '').trim().slice(0, 120),
      customer: String(entry?.customer || '').trim().slice(0, 200),
      quantity, unit, custKey, prodKey,
      unitPrice: normalizeDutchPrice(entry?.unitPrice),
    };
  });
  return { year: String(orderYear), week: orderWeek, entries: normalized };
}

function optionalKey(value, id, label) {
  if (value == null || String(value).trim() === '') return null;
  const key = Number(value);
  if (!Number.isSafeInteger(key) || key <= 0) throw dutchError('INVALID_EXPLICIT_KEY', `${id}: ${label} 키가 유효하지 않습니다.`);
  return key;
}

export function resolveDutchPairPolicy(rows, entries) {
  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  return rows.map(row => {
    if (!Number.isFinite(Number(row.uploadQty)) || Number(row.uploadQty) < 0 || Number(row.uploadQty) > 1_000_000_000) {
      throw dutchError('INVALID_CONVERTED_QUANTITY', `${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 환산 수량은 0~1,000,000,000 범위여야 합니다.`, 409);
    }
    const matching = (row.entryIds || []).map(id => entryById.get(String(id))).filter(Boolean);
    if (!matching.length && !row.missingFromExcel) throw dutchError('ENTRY_MAPPING_MISSING', '입력 행과 미리보기 행의 연결이 누락되었습니다.', 409);
    const units = new Set(matching.map(entry => entry.unit || row.outUnit));
    const prices = new Set(matching.map(entry => entry.unitPrice == null ? 'blank' : `price:${entry.unitPrice}`));
    if (units.size > 1 || prices.size > 1) {
      throw dutchError('DUPLICATE_PAIR_CONFLICT', `${row.custName} / ${row.prodName}: 동일 업체·품목의 단위 또는 명시 단가가 충돌합니다.`, 409);
    }
    const unitPrice = matching.length ? matching[0].unitPrice : null;
    return { ...row, unitPrice, priceExplicit: unitPrice != null };
  });
}

export function dutchPlanOwner(user) {
  const id = String(user?.userId || '').trim();
  if (!id) throw dutchError('USER_REQUIRED', '로그인 사용자 식별이 필요합니다.', 401);
  return id;
}

function prunePlans() {
  const now = Date.now();
  for (const [token, plan] of plans) if (now > plan.expiresAt + PLAN_TTL_MS) plans.delete(token);
}

export function issueDutchPlan(plan, user) {
  prunePlans();
  if (plans.size >= 100) throw dutchError('PLAN_STORE_BUSY', '대기 중인 계획이 많습니다. 잠시 후 다시 미리보기를 실행하세요.', 503);
  const token = crypto.randomBytes(32).toString('base64url');
  plans.set(token, { ...plan, owner: dutchPlanOwner(user), expiresAt: Date.now() + PLAN_TTL_MS, state: 'ready' });
  return token;
}

export function claimDutchPlan(token, user, jobId) {
  prunePlans();
  const plan = plans.get(String(token || ''));
  if (!plan || plan.owner !== dutchPlanOwner(user) || Date.now() > plan.expiresAt) {
    throw dutchError('PLAN_EXPIRED', '미리보기가 만료되었거나 다른 사용자 계획입니다. 다시 검증하세요.', 409);
  }
  if (plan.state !== 'ready') throw dutchError('PLAN_ALREADY_USED', '이 계획은 이미 적용 요청되었습니다. 작업 진행을 확인하세요.', 409);
  plan.state = 'running';
  plan.jobId = String(jobId || '');
  return plan;
}

export function finishDutchPlan(token, outcome) {
  const plan = plans.get(String(token || ''));
  if (plan) { plan.state = outcome; plan.finishedAt = Date.now(); }
}

export function digestDutchSnapshot(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function assessDutchPriceReadback(snapshot, expectedCost) {
  const detail = snapshot?.shipmentDetailRow;
  if (!detail) return ['ShipmentDetail 누락'];
  const cost = Number(expectedCost);
  const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.001;
  const problems = [];
  const amount = amountVatFromCostEst(cost, Number(detail.EstQuantity || 0));
  if (!close(detail.Cost, cost)) problems.push('ShipmentDetail.Cost');
  if (!close(detail.Amount, amount.amount)) problems.push('ShipmentDetail.Amount');
  if (!close(detail.Vat, amount.vat)) problems.push('ShipmentDetail.Vat');
  for (const date of snapshot.shipmentDateRows || []) {
    const dateAmount = amountVatFromCostEst(cost, Number(date.EstQuantity || 0));
    if (!close(date.Cost, cost)) problems.push(`ShipmentDate ${date.SdateKey} Cost`);
    if (!close(date.Amount, dateAmount.amount)) problems.push(`ShipmentDate ${date.SdateKey} Amount`);
    if (!close(date.Vat, dateAmount.vat)) problems.push(`ShipmentDate ${date.SdateKey} Vat`);
  }
  return problems;
}

export function dutchEstUnitConversionIssue(product, quantity) {
  if (!(Number(quantity) > 0)) return '';
  const outUnit = normalizeOrderUnit(product?.OutUnit, '박스');
  const estUnit = normalizeOrderUnit(product?.EstUnit, outUnit);
  if (outUnit === estUnit) return '';
  const bunchPerBox = Number(product?.BunchOf1Box || 0);
  const steamPerBunch = Number(product?.SteamOf1Bunch || 0);
  const steamPerBox = Number(product?.SteamOf1Box || 0);
  const valid = (outUnit === '박스' && estUnit === '단' && bunchPerBox > 0)
    || (outUnit === '박스' && estUnit === '송이' && (steamPerBox > 0 || (bunchPerBox > 0 && steamPerBunch > 0)))
    || (outUnit === '단' && estUnit === '박스' && bunchPerBox > 0)
    || (outUnit === '단' && estUnit === '송이' && steamPerBunch > 0)
    || (outUnit === '송이' && estUnit === '단' && steamPerBunch > 0)
    || (outUnit === '송이' && estUnit === '박스' && (steamPerBox > 0 || (bunchPerBox > 0 && steamPerBunch > 0)));
  return valid ? '' : `${outUnit}→${estUnit} 견적단위 환산계수가 비었거나 0입니다.`;
}

export function dutchComputedValueIssue(product, quantity, cost) {
  const values = distributeUnits(quantity, product || {});
  if (Object.values(values).some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    return '환산 결과가 유한한 비음수 수량이 아닙니다.';
  }
  if (cost != null) {
    const money = amountVatFromCostEst(cost, values.estQty);
    if (!Number.isFinite(money.amount) || !Number.isFinite(money.vat)) return '원화 금액 계산 결과가 유효하지 않습니다.';
  }
  return '';
}
