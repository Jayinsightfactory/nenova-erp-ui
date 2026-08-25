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

export const SUPPORT_REGISTER_USAGE_STEPS = [
  '확정확인',
  '전체선택',
  '견적서관리에 불량차감 등록',
  '기존 견적서 조회 완료가 뜨면',
  '전산등록 실행 및 검증',
];

export function supportRegisterUsageNotice() {
  return `사용 방법: ${SUPPORT_REGISTER_USAGE_STEPS.join(' → ')}`;
}

function captureProductName(row = {}) {
  return String(row.matchedProductDbName || row.matchedProductName || row.productName || '').trim() || '품목 미확인';
}

export function buildSupportEstimateCapture(row = {}, scope = {}) {
  const customerName = String(row.customerName || '거래처').trim() || '거래처';
  const year = scope.year || row.appliedOrderYear || row.orderYear || '';
  const week = normalizeParentWeek(scope.week || row.appliedOrderWeek || row.orderWeek);
  const yearLabel = year ? `${year}년 ` : '';
  const weekLabel = week ? `${week}차 ` : '';
  const status = row.processingStatus || deriveSupportProcessingStatus(row).processingStatus;
  if (status === 'MANUAL_COMPLETED') {
    return {
      mode: 'manual',
      title: `${customerName} 견적서`,
      subtitle: `${yearLabel}${weekLabel}${customerName} · 수기 처리 · 견적서 미생성`,
      rows: [],
    };
  }
  const ownKey = Number(row.estimateKey || row.processingEstimateKey || row.exactExistingEstimateKey || 0);
  const records = Array.isArray(row.existingEstimateRecords) ? row.existingEstimateRecords : [];
  // 업체의 모든 견적서를 축소 화면에 다시 그리지 않는다. 이 원장 행과 연결된
  // EstimateKey가 있는 경우 그 한 건만 보여 준다.
  // 따라서 미리보기는 "이 불량차감이 등록됐는지" 확인하는 읽기 전용 용도다.
  const relevantRecords = records.filter((record) => {
    const estimateKey = Number(record.estimateKey ?? record.EstimateKey ?? 0);
    return ownKey > 0 && estimateKey === ownKey;
  });
  const rows = relevantRecords.map((record) => {
    const estimateKey = Number(record.estimateKey ?? record.EstimateKey ?? 0);
    const current = ownKey > 0 && estimateKey === ownKey;
    const storedStatus = String(row.status || '').toUpperCase();
    return {
      estimateKey,
      typeLabel: String(record.estimateTypeLabel || record.estimateType || record.EstimateType || '불량차감').trim() || '불량차감',
      productName: String(record.productName || record.prodName || record.ProdName || '').trim() || '품목 미확인',
      unit: String(record.unit || record.Unit || '').trim(),
      quantity: Number(record.quantity ?? record.Quantity ?? 0),
      cost: Number(record.cost ?? record.Cost ?? 0),
      amount: Number(record.amount ?? record.Amount ?? 0),
      vat: Number(record.vat ?? record.Vat ?? 0),
      date: String(record.estimateDtm || record.EstimateDtm || '').slice(0, 10),
      current,
      statusLabel: storedStatus === 'REGISTERED' || storedStatus === 'COMPLETED'
        ? '등록완료'
        : row.exactExistingEstimate ? '기존 등록' : '현재 불량차감',
    };
  });
  if (!rows.length && ownKey > 0) {
    rows.push({
      estimateKey: ownKey,
      typeLabel: '불량차감',
      productName: captureProductName(row),
      unit: String(row.sourceUnit || row.unit || '').trim(),
      quantity: -Math.abs(Number(row.remainingQuantity ?? row.quantity ?? 0)),
      cost: Number(row.distributionCost || row.estimateCost || 0),
      amount: Number(row.estimateAmount || 0),
      vat: Number(row.estimateVat || 0),
      date: String(row.estimateDtm || '').slice(0, 10),
      current: true,
      statusLabel: '현재 불량차감',
    });
  }
  return {
    mode: rows.length ? 'page' : 'empty',
    title: `${customerName} 견적서`,
    subtitle: `${yearLabel}${weekLabel}${customerName} 불량차감 ${rows.length}건`,
    rows,
  };
}
