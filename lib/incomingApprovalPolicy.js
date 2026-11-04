import { normalizedCorrection, correctionError } from './warehouseCorrectionPolicy.js';
import { shipmentUnitsFromUserInput, amountVatFromCostEst } from './distributeUnits.js';

export const INCOMING_APPROVAL_KIND = 'WAREHOUSE_CORRECTION_V1';
export const approvalError = (code, message, statusCode = 409) => correctionError(code, message, statusCode);
export function strictApprovalNumber(value, label, { integer = false, positive = false } = {}) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object' || String(value).trim() === '')
    throw approvalError('APPROVAL_NUMBER_REQUIRED', `${label} 값을 입력하세요.`, 400);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e10 || integer && (!Number.isSafeInteger(n) || n > 2147483647) || positive && n <= 0)
    throw approvalError('APPROVAL_NUMBER_INVALID', `${label} 값이 올바르지 않습니다.`, 400);
  return n;
}
export function approvalPermissions(user = {}) {
  const id = String(user.userId ?? '').trim();
  const authority = user.authority;
  const present = authority !== null && authority !== undefined && authority !== '';
  const admin = !!id && (id.toLowerCase() === 'nenovass3' || user.deptName === '대표'
    || present && ['0', '1', 'admin', '관리자', '대표'].includes(String(authority)));
  const active = !!id && user.accountActive !== false && user.isDeleted !== true;
  return {
    request: active && (admin || user.deptName === '수입부' || present && ['4', '7'].includes(String(authority))),
    review: active && (admin || user.deptName === '영업지원' || user.deptName === '영업지원부' || present && String(authority) === '2'),
    admin: active && admin,
  };
}
export function normalizeApprovalDraft(body) {
  const correction = normalizedCorrection(body.correction);
  const reason = String(body.reason ?? '').trim();
  if (!reason || reason.length > 500) throw approvalError('APPROVAL_REASON_REQUIRED', '수정 사유를 1~500자로 입력하세요.', 400);
  return { correction, reason };
}
export function normalizeApprovalMatching(body = {}) {
  if (!Array.isArray(body.rows) || body.rows.length > 500) throw approvalError('APPROVAL_MATCHING_INVALID', '매칭 행은 500개 이하여야 합니다.', 400);
  const seen = new Set();
  const rows = body.rows.map((r, i) => {
    const sdateKey = r.sdateKey == null ? null : strictApprovalNumber(r.sdateKey, '출고일 번호', { integer: true, positive: true });
    if (sdateKey && seen.has(sdateKey)) throw approvalError('APPROVAL_DUPLICATE_DATE', '같은 출고일 행이 중복되었습니다.', 400);
    if (sdateKey) seen.add(sdateKey);
    const shipmentKey = strictApprovalNumber(r.shipmentKey, '출고 번호', { integer: true, positive: true });
    const prodKey = strictApprovalNumber(r.prodKey, '대상 품목', { integer: true, positive: true });
    const quantity = strictApprovalNumber(r.quantity, `${i + 1}행 최종 분배수량`);
    const cost = strictApprovalNumber(r.cost, `${i + 1}행 판매단가`);
    if (!sdateKey && quantity === 0) throw approvalError('APPROVAL_EMPTY_ADDITION', '추가 분배수량은 0보다 커야 합니다.', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || !Number.isFinite(Date.parse(`${r.date}T00:00:00Z`)))
      throw approvalError('APPROVAL_DATE_INVALID', '출고일을 선택하세요.', 400);
    return { sdateKey, shipmentKey, prodKey, quantity, cost, date: r.date, createOrder: r.createOrder === true };
  });
  const farms = body.farms ?? [];
  if (!Array.isArray(farms) || farms.length > 500) throw approvalError('APPROVAL_FARMS_INVALID', '농장 매칭을 확인하세요.', 400);
  const farmSeen = new Set();
  return { rows, farms: farms.map(f => {
    const sfarmKey = strictApprovalNumber(f.sfarmKey, '농장 배정 번호', { integer: true, positive: true });
    if (farmSeen.has(sfarmKey)) throw approvalError('APPROVAL_FARM_DUPLICATE', '농장 배정 번호가 중복되었습니다.', 400);
    farmSeen.add(sfarmKey);
    return { sfarmKey, farmKey: strictApprovalNumber(f.farmKey, '농장 번호', { integer: true, positive: true }), quantity: strictApprovalNumber(f.quantity, '농장 배정수량') };
  }) };
}

// Values are final per-date OutUnit quantities, not increments. An omitted row is preserved.
export function buildApprovalDistributionPlan({ matching, dates, details, masters, products, scope, receiptPlan }) {
  if (!receiptPlan.detailsChanged && matching.rows.length)
    throw approvalError('APPROVAL_FARM_QUANTITY_CHANGE', '농장만 정정할 때 분배 수량·품목·단가를 변경할 수 없습니다.');
  const productByKey = new Map(products.map(p => [p.ProdKey, p]));
  const dateByKey = new Map(dates.map(d => [d.SdateKey, d]));
  const detailByKey = new Map(details.map(d => [d.SdetailKey, d]));
  const masterByKey = new Map(masters.map(m => [m.ShipmentKey, m]));
  const groups = new Map();
  const getGroup = (shipmentKey, prodKey) => {
    const key = `${shipmentKey}:${prodKey}`;
    if (groups.has(key)) return groups.get(key);
    const master = masterByKey.get(shipmentKey), product = productByKey.get(prodKey);
    if (!master || !product || ![0, false].includes(master.isDeleted) || ![0, false].includes(product.isDeleted))
      throw approvalError('APPROVAL_TARGET_MISSING', '활성 출고·품목을 찾을 수 없습니다.');
    if (`${master.OrderYear}${master.OrderWeek}` < `${scope.orderYear}${scope.orderWeek}`)
      throw approvalError('APPROVAL_SCOPE_MISMATCH', '선택 입고보다 앞선 연도·차수의 분배는 수정할 수 없습니다.');
    if (master.OrderYearWeek !== master.OrderYear + master.OrderWeek.slice(0, 2))
      throw approvalError('APPROVAL_MASTER_WEEK', '출고의 연도·대차수 연결을 확인하세요.');
    const found = details.filter(d => d.ShipmentKey === shipmentKey && d.ProdKey === prodKey);
    if (found.length > 1) throw approvalError('APPROVAL_DUPLICATE_DETAIL', '같은 출고·품목의 상세가 여러 개입니다. 원장 연결을 먼저 확인하세요.');
    const detail = found[0] ?? null;
    const original = detail ? dates.filter(d => d.SdetailKey === detail.SdetailKey) : [];
    if (detail && (!original.length || Math.abs(original.reduce((s, d) => s + Number(d.ShipmentQuantity), 0) - Number(detail.OutQuantity)) > 0.001))
      throw approvalError('APPROVAL_DATE_TOTAL', '기존 날짜별 분배 합계와 상세 총량이 다릅니다.');
    if (original.some(d => ['ShipmentQuantity', 'EstQuantity', 'Cost', 'Amount', 'Vat'].some(k => d[k] == null || !Number.isFinite(Number(d[k])))))
      throw approvalError('APPROVAL_DATE_MONEY_MISSING', '기존 출고일의 수량·단가·금액이 누락되었습니다. 먼저 원장을 확인하세요.');
    if (detail && ![0, 1, false, true].includes(detail.isFix)) throw approvalError('APPROVAL_FIX_INVALID', '상세 확정 상태를 확인하세요.');
    if (!['박스', '단', '송이'].includes(product.OutUnit) || !['박스', '단', '송이'].includes(product.EstUnit))
      throw approvalError('APPROVAL_UNIT_INVALID', '대상 품목의 출고·견적 단위를 확인하세요.');
    const group = { key, master, product, detail, before: original, after: original.map(d => ({ ...d })), createOrder: false };
    groups.set(key, group); return group;
  };
  for (const row of matching.rows) {
    if (!receiptPlan.keys.includes(row.prodKey)) throw approvalError('APPROVAL_UNRELATED_PRODUCT', '입고 정정 전후 품목만 분배 매칭할 수 있습니다.');
    if (row.sdateKey) {
      const d = dateByKey.get(row.sdateKey), parent = d && detailByKey.get(d.SdetailKey);
      const date = d?.DateText ?? (d?.ShipmentDtm instanceof Date ? d.ShipmentDtm.toISOString().slice(0,10) : String(d?.ShipmentDtm).slice(0,10));
      if (parent?.ShipmentKey === row.shipmentKey && parent.ProdKey === row.prodKey && Number(d.ShipmentQuantity) === row.quantity && Number(d.Cost) === row.cost && date === row.date) continue;
    }
    const target = getGroup(row.shipmentKey, row.prodKey);
    target.createOrder ||= row.createOrder;
    let original;
    if (row.sdateKey) {
      original = dateByKey.get(row.sdateKey);
      const detail = original && detailByKey.get(original.SdetailKey);
      if (!detail || detail.ShipmentKey !== row.shipmentKey || !receiptPlan.keys.includes(detail.ProdKey))
        throw approvalError('APPROVAL_SOURCE_CHANGED', '선택한 분배의 업체·품목 연결이 바뀌었습니다.');
      const source = getGroup(detail.ShipmentKey, detail.ProdKey);
      source.after = source.after.filter(d => d.SdateKey !== row.sdateKey);
    }
    if (row.quantity > 0) {
      const units = shipmentUnitsFromUserInput(row.quantity, target.product.OutUnit, target.product);
      if (Math.abs(units.outQuantity - row.quantity) > 0.000001 || units.estQty <= 0)
        throw approvalError('APPROVAL_QUANTITY_PRECISION', '분배는 소수 두 자리까지 입력하고 견적 환산수량을 확인하세요.');
      const money = amountVatFromCostEst(row.cost, units.estQty);
      target.after.push({ SdateKey: original && target.detail && original.SdetailKey === target.detail.SdetailKey ? original.SdateKey : null,
        SdetailKey: target.detail?.SdetailKey ?? null, ShipmentDtm: row.date,
        ShipmentQuantity: row.quantity, EstQuantity: units.estQty, Cost: row.cost, Amount: money.amount, Vat: money.vat,
        Descr: original?.Descr ?? '' });
    }
  }
  return [...groups.values()].map(g => {
    const outQuantity = g.after.reduce((s, d) => s + Number(d.ShipmentQuantity), 0);
    const units = shipmentUnitsFromUserInput(outQuantity, g.product.OutUnit, g.product);
    const amount = g.after.reduce((s, d) => s + Number(d.Amount), 0);
    const vat = g.after.reduce((s, d) => s + Number(d.Vat), 0);
    const costs = [...new Set(g.after.map(d => Number(d.Cost)))];
    const cost = costs.length === 1 ? costs[0] : g.detail?.Cost ?? costs[0] ?? 0;
    const fixed = g.detail ? [1, true].includes(g.detail.isFix) : [1, true].includes(g.master.isFix);
    return { ...g, outQuantity, units, amount, vat, cost, fixed,
      stockDelta: fixed ? Number(g.detail?.OutQuantity ?? 0) - outQuantity : 0 };
  });
}
