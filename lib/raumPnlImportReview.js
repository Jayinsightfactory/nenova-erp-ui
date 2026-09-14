// Import review policy shared by parser, UI, APIs, and the WebRaumPnl write core.
// A review warning is deliberately not a successful automatic-import signal.
export const RAUM_GANGNAM_MULTISHEET = 'RAUM_GANGNAM_MULTISHEET';

export function isRaumGangnamMultisheetReview(check, batch) {
  return check?.code === RAUM_GANGNAM_MULTISHEET
    && check?.ok === true
    && check?.requiresConfirmation === true
    && check?.group === '강남'
    && batch?.partnerCode === 'raum';
}

function isMalformedConfirmationCheck(check, batch) {
  return (check?.requiresConfirmation === true || check?.code === RAUM_GANGNAM_MULTISHEET)
    && !isRaumGangnamMultisheetReview(check, batch);
}

export function evaluateRaumPnlImportReview(batches, confirmGangnamMerge = false) {
  const allBatches = Array.isArray(batches) ? batches : [];
  const blocking = [];
  const review = [];
  for (const batch of allBatches) {
    for (const check of Array.isArray(batch?.verification) ? batch.verification : []) {
      if (isRaumGangnamMultisheetReview(check, batch)) review.push({ batch, check });
      else if (check?.ok !== true || isMalformedConfirmationCheck(check, batch)) blocking.push({ batch, check });
    }
  }
  const requiresConfirmation = review.length > 0;
  const manuallyConfirmed = confirmGangnamMerge === true;
  return {
    blocking,
    review,
    requiresConfirmation,
    manuallyConfirmed,
    allowAuto: allBatches.length > 0 && blocking.length === 0 && !requiresConfirmation,
    allowManual: allBatches.length > 0 && blocking.length === 0 && (!requiresConfirmation || manuallyConfirmed),
  };
}

export function raumPnlImportSaveError(decision) {
  if (decision.blocking.length) return '합계 검증에 실패해 전체 저장을 차단했습니다.';
  if (decision.requiresConfirmation && !decision.manuallyConfirmed) {
    return '강남 복수 시트의 원본 시트 목록과 합산 수량·금액을 확인한 뒤 저장 확인을 선택하세요.';
  }
  return null;
}
