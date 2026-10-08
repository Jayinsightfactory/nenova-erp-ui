import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

export const EARLY_IMPORT_MODES = Object.freeze({
  ORIGINAL_INCLUDES_EARLY: 'ORIGINAL_INCLUDES_EARLY',
  ALREADY_EXCLUDED: 'ALREADY_EXCLUDED',
});

export function requireEarlyImportMode(value) {
  if (Object.values(EARLY_IMPORT_MODES).includes(value)) return value;
  const error = new Error('선출고 원문 포함 여부를 선택한 뒤 다시 검증하세요.');
  error.code = 'EARLY_IMPORT_MODE_REQUIRED';
  error.statusCode = 400;
  throw error;
}

export function projectEarlyImportTarget({ originalTotal, currentOutQty, exclusion, mode, missingFromExcel = false }) {
  requireEarlyImportMode(mode);
  const original = Number(originalTotal);
  const existing = Number(currentOutQty);
  const processed = Number(exclusion?.processedEarlyTotal ?? 0);
  const eligible = Number(exclusion?.earlyExcludedApplied ?? 0);
  if (![original, existing, processed, eligible].every(Number.isFinite) || original < 0 || processed < 0 || eligible < 0 || eligible > processed) {
    const error = new Error('선출고 업로드 수량 또는 처리 원장 수량이 유효하지 않습니다.');
    error.code = 'EARLY_IMPORT_QTY_INVALID';
    error.statusCode = 409;
    throw error;
  }
  // A missing full-replacement row is already an explicit target of zero.
  const earlyExcludedApplied = !missingFromExcel && mode === EARLY_IMPORT_MODES.ORIGINAL_INCLUDES_EARLY ? eligible : 0;
  const finalTarget = original - earlyExcludedApplied;
  if (finalTarget < -0.00001) {
    const error = new Error(`원문 ${original}보다 처리된 선출고 제외량 ${earlyExcludedApplied}이 큽니다. 파일/선출고 원장을 확인하세요.`);
    error.code = 'EARLY_IMPORT_NEGATIVE_TARGET';
    error.statusCode = 409;
    throw error;
  }
  return {
    originalTotal: original,
    existingTarget: existing,
    processedEarlyTotal: processed,
    earlyExcludedApplied,
    finalTarget: Math.max(0, finalTarget),
    delta: Math.max(0, finalTarget) - existing,
  };
}

export function findEarlyExclusion(exclusions, row) {
  const pair = (exclusions?.rows || []).filter(item => Number(item.custKey) === Number(row.custKey) && Number(item.prodKey) === Number(row.prodKey));
  if (!pair.length) return null;
  const unit = normalizeWeekdayUnit(row.outUnit);
  const matches = pair.filter(item => normalizeWeekdayUnit(item.unit) === unit);
  if (!unit || pair.some(item => normalizeWeekdayUnit(item.unit) !== unit) || matches.length !== 1) {
    const error = new Error(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 선출고 처리 단위 또는 대상 차수 연결이 모호합니다.`);
    error.code = 'EARLY_IMPORT_UNIT_OR_ANCHOR_CONFLICT';
    error.statusCode = 409;
    throw error;
  }
  return matches[0];
}

export function verifyEarlyImportPreviewRow({ row, originalTotal, exclusion, mode, fingerprint }) {
  const projection = projectEarlyImportTarget({
    originalTotal, currentOutQty: row.currentOutQty, exclusion, mode,
    missingFromExcel: row.missingFromExcel,
  });
  const close = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < 0.00001;
  if (!fingerprint || row.earlyLedgerFingerprint !== fingerprint || row.earlyImportMode !== mode ||
      !close(row.originalTotal, projection.originalTotal) ||
      !close(row.processedEarlyTotal, projection.processedEarlyTotal) ||
      !close(row.earlyExcludedApplied, projection.earlyExcludedApplied) ||
      !close(row.uploadQty, projection.finalTarget) ||
      !close(row.delta, projection.delta) ||
      String(row.targetImportYear || '') !== String(exclusion?.targetImportYear || '') ||
      String(row.targetImportWeek || '') !== String(exclusion?.targetImportWeek || '')) {
    const error = new Error(`${row.custName || row.custKey} / ${row.prodName || row.prodKey}: 선출고 원장 또는 원문 수량이 검증 이후 변경됐습니다. 다시 검증하세요.`);
    error.code = 'EARLY_IMPORT_PREVIEW_STALE';
    error.statusCode = 409;
    throw error;
  }
  return projection;
}
