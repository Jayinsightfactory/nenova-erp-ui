import { weekdayWilsonIdentity } from './weekdayWilson.js';

// Reconcile verified total-only changes for current display, export and explicit editing.
// The persisted record/revision stays intact; reading never writes a classification.
export function recoverWeekdayWilsonEditing({ record, identity, unit, savedTotal, plannedTotal, draft, error, disabledReason }) {
  const quantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
  if (!record || record.status !== 'STALE' || draft || plannedTotal != null || error || disabledReason
    || !unit || record.unit !== unit || weekdayWilsonIdentity(record) !== weekdayWilsonIdentity(identity)
    || !quantity(savedTotal) || !quantity(record.currentTotal) || Math.abs(record.currentTotal - savedTotal) > 1e-6
    || !quantity(record.wilsonQuantity) || record.wilsonQuantity > savedTotal) return null;
  return {
    general: Number((savedTotal - record.wilsonQuantity).toFixed(6)),
    wilson: record.wilsonQuantity,
    notice: '최신 ERP 합계에 기존 윌슨 구분 적용',
  };
}
