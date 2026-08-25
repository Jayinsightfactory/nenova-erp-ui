import { normalizeParentWeek, normalizeYear } from './salesDefectDeductionCore.js';

export function deriveSupportProcessingStatus(row = {}) {
  const storedStatus = String(row.status || '').toUpperCase();
  if (storedStatus === 'MANUAL_COMPLETED') {
    return { processingStatus: 'MANUAL_COMPLETED', processingEstimateKey: null };
  }
  if (storedStatus === 'REGISTERED' || storedStatus === 'COMPLETED') {
    return { processingStatus: 'REGISTERED', processingEstimateKey: Number(row.estimateKey || 0) || null };
  }
  if (row.exactExistingEstimate && Number(row.exactExistingEstimateKey || 0) > 0) {
    return { processingStatus: 'COMPLETED_EXISTING', processingEstimateKey: Number(row.exactExistingEstimateKey) };
  }
  return { processingStatus: row.isCarryover ? 'CARRYOVER' : 'UNREGISTERED', processingEstimateKey: null };
}

export function isSupportProcessingComplete(row = {}) {
  const status = row.processingStatus || deriveSupportProcessingStatus(row).processingStatus;
  return status === 'REGISTERED' || status === 'COMPLETED_EXISTING' || status === 'MANUAL_COMPLETED';
}

export function isSupportManualCompleteSelectable(row = {}) {
  return Number(row.deductionKey || row.DeductionKey || 0) > 0 && !isSupportProcessingComplete(row);
}

export function supportProcessingLabel(row = {}) {
  const derived = row.processingStatus ? row : { ...row, ...deriveSupportProcessingStatus(row) };
  if (derived.processingStatus === 'COMPLETED_EXISTING') return `처리완료 (기존 불량차감 #${derived.processingEstimateKey})`;
  if (derived.processingStatus === 'MANUAL_COMPLETED') return '수동처리완료';
  if (derived.processingStatus === 'REGISTERED') return `등록완료${derived.processingEstimateKey ? ` (#${derived.processingEstimateKey})` : ''}`;
  if (derived.processingStatus === 'CARRYOVER') return '이월 대기';
  return '미등록';
}

export function supportRegistrationDecisionLabel(row = {}) {
  if (isSupportProcessingComplete(row)) return supportProcessingLabel(row);
  return row.registrationEligible ? '등록 가능' : '등록 불가';
}

export function supportCarryoverFromLabel(row = {}, targetYear, targetWeek) {
  const originYear = normalizeYear(row.orderYear ?? row.OrderYear);
  const originWeek = normalizeParentWeek(row.orderWeek ?? row.OrderWeek);
  const y = normalizeYear(targetYear);
  const w = normalizeParentWeek(targetWeek);
  if (!originYear || !originWeek || !y || !w) return '';
  if (originYear === y && originWeek === w) return '';
  return `${originYear}년 ${originWeek}차부터 이월`;
}

export function supportStatusDetail(row = {}, targetYear, targetWeek) {
  const carryoverFrom = supportCarryoverFromLabel(row, targetYear, targetWeek);
  if (isSupportProcessingComplete(row)) {
    if ((row.processingStatus || deriveSupportProcessingStatus(row).processingStatus) === 'MANUAL_COMPLETED') {
      return [carryoverFrom, '수기 처리 · 견적서 미생성'].filter(Boolean).join(' · ');
    }
    return carryoverFrom || (row.exactExistingEstimate
      ? '동일 차수·업체·품목·수량·단위의 기존 불량차감 확인 · 중복 등록 제외'
      : '');
  }
  const code = String(row.registrationEligibilityCode || '');
  const hideError = code === 'CUSTOMER_SALE_MISSING' || code === 'IMPORT_REVIEW_REQUIRED';
  const extra = !row.registrationEligible && !hideError ? String(row.registrationError || '').trim() : '';
  return [carryoverFrom, extra].filter(Boolean).join(' · ');
}
