// 견적서 불량/검역 차감 선택 삭제의 화면용 순수 규칙.
// 서버의 최종 잠금/스냅샷 검증을 대체하지 않으며, 화면에 보일 수 있는 정상·판매요청
// 또는 다른 차감 유형을 선택 단계에서 섞지 않기 위한 공통 기준이다.
import { isLegacyDeductionType } from './estimateDeductionTypes.js';

export const DEFECT_ESTIMATE_TYPE_CODES = new Set([
  'FEE03-KR0009', 'FEE03-KR0010', 'FEE03-KR0011', 'FEE03-KR0020', 'FEE03-KR0024',
]);

export const QUARANTINE_ESTIMATE_TYPE_CODES = new Set([
  'FEE03-KR0012', 'FEE03-KR0013', 'FEE03-KR0014', 'FEE03-KR0019',
]);

const ALLOWED_ESTIMATE_TYPE_CODES = new Set([
  ...DEFECT_ESTIMATE_TYPE_CODES,
  ...QUARANTINE_ESTIMATE_TYPE_CODES,
]);

export function getEstimateDeductionDeleteSnapshot(item) {
  const snapshot = item?.DeleteSnapshot;
  return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

export function hasEstimateDeductionDeleteSnapshot(item) {
  const snapshot = getEstimateDeductionDeleteSnapshot(item);
  // estimateDate는 Estimate에 NULL로 저장된 경우도 정상이다. 표시용 outDate로 대체하지 않는다.
  return Boolean(snapshot
    && Object.prototype.hasOwnProperty.call(snapshot, 'quantity')
    && Object.prototype.hasOwnProperty.call(snapshot, 'cost')
    && Object.prototype.hasOwnProperty.call(snapshot, 'amount')
    && Object.prototype.hasOwnProperty.call(snapshot, 'vat')
    && Object.prototype.hasOwnProperty.call(snapshot, 'unit')
    && Object.prototype.hasOwnProperty.call(snapshot, 'estimateType')
    && Object.prototype.hasOwnProperty.call(snapshot, 'descr')
    && Object.prototype.hasOwnProperty.call(snapshot, 'estimateDate'));
}

export function rawEstimateType(item) {
  return String(getEstimateDeductionDeleteSnapshot(item)?.estimateType ?? '').trim();
}

export function isAllowedDeductionEstimateType(type) {
  const raw = String(type ?? '').trim();
  if (!raw) return false;
  if (ALLOWED_ESTIMATE_TYPE_CODES.has(raw.toUpperCase())) return true;
  return isLegacyDeductionType(raw);
}

export function hasNormalShipmentDate(item) {
  // Estimate 행의 outDate는 EstimateDtm 표시값일 수 있으므로 정상 출고일 여부로 쓰지 않는다.
  // SdateKey/SdetailKey가 있으면 ShipmentDate/ShipmentDetail 기반 정상출고 행이다.
  return item?.SdateKey != null || item?.SdetailKey != null;
}

export function isEligibleEstimateDeduction(item) {
  const snapshot = getEstimateDeductionDeleteSnapshot(item);
  return hasEstimateDeductionDeleteSnapshot(item)
    && Number(item?.EstimateKey) > 0
    && Number(snapshot.quantity) < 0
    && !hasNormalShipmentDate(item)
    && isAllowedDeductionEstimateType(rawEstimateType(item));
}

export function eligibleEstimateDeductions(items) {
  return (items || []).filter(isEligibleEstimateDeduction);
}

export function resetEstimateDeductionSelection() {
  return new Set();
}

export function toggleEstimateDeductionSelection(selectedKeys, estimateKey, checked) {
  const next = new Set(selectedKeys || []);
  const key = Number(estimateKey);
  if (!(key > 0)) return next;
  if (checked) next.add(key);
  else next.delete(key);
  return next;
}

export function selectAllEligibleEstimateDeductions(items, selectedKeys) {
  const eligibleKeys = eligibleEstimateDeductions(items).map((item) => Number(item.EstimateKey));
  const allSelected = eligibleKeys.length > 0 && eligibleKeys.every((key) => selectedKeys?.has(key));
  return allSelected ? resetEstimateDeductionSelection() : new Set(eligibleKeys);
}

export function buildEstimateDeductionDeletePayload({
  orderYear,
  orderWeek,
  custKey,
  items,
  selectedKeys,
  editGuard,
}) {
  const selectedRows = (items || []).filter((item) => selectedKeys?.has(Number(item?.EstimateKey)));
  if (selectedRows.some((item) => !hasEstimateDeductionDeleteSnapshot(item))) {
    throw new Error('선택 차감 행의 삭제 확인정보가 없습니다. 다시 조회한 뒤 선택하세요.');
  }
  const selected = selectedRows.filter(isEligibleEstimateDeduction);
  if (selected.length !== selectedRows.length) {
    throw new Error('선택한 행 중 삭제할 수 없는 차감이 있습니다. 다시 확인하세요.');
  }

  return {
    orderYear: String(orderYear ?? ''),
    orderWeek: String(orderWeek ?? ''),
    custKey: Number(custKey),
    entries: selected.map((item) => {
      const snapshot = getEstimateDeductionDeleteSnapshot(item);
      return {
        estimateKey: Number(item.EstimateKey),
        shipmentKey: Number(item.ShipmentKey),
        prodKey: Number(item.ProdKey),
        expected: {
          quantity: snapshot.quantity,
          cost: snapshot.cost,
          amount: snapshot.amount,
          vat: snapshot.vat,
          unit: snapshot.unit,
          estimateType: snapshot.estimateType,
          descr: snapshot.descr,
          estimateDate: snapshot.estimateDate,
        },
      };
    }),
    editGuard,
  };
}
