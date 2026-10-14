import { weekdayWilsonIdentity } from './weekdayWilson.js';

// Only a verified ERP total change can reuse an old classification as an editing suggestion.
// This does not mark the stored split CURRENT and never writes a classification by itself.
export function recoverWeekdayWilsonEditing({ record, identity, unit, savedTotal, plannedTotal, draft, error, disabledReason }) {
  const quantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
  if (!record || record.status !== 'STALE' || draft || plannedTotal != null || error || disabledReason
    || !unit || record.unit !== unit || weekdayWilsonIdentity(record) !== weekdayWilsonIdentity(identity)
    || !quantity(savedTotal) || !quantity(record.currentTotal) || Math.abs(record.currentTotal - savedTotal) > 1e-6
    || !quantity(record.wilsonQuantity) || record.wilsonQuantity > savedTotal) return null;
  return {
    general: Number((savedTotal - record.wilsonQuantity).toFixed(6)),
    wilson: record.wilsonQuantity,
    notice: `ERP 합계가 변경되어 저장된 일반·윌슨 구분은 미확인입니다. 기존 윌슨 ${record.wilsonQuantity}을 유지한 편집용 예상값입니다. 일반 또는 윌슨 수량을 변경하면 재확인 초안을 만들고, 분배 적용 시 함께 저장합니다. 합계 변경 없이 구분만 확인하려면 분류 버튼을 누르세요.`,
  };
}
