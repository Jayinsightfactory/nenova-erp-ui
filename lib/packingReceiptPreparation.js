export function packingPreparationBlockReason({
  sharedReady,
  saving,
  processing,
  latestShared,
  matchingComplete,
  remainingMatches,
  allowAllocationReview = false,
  allocationCount = 0,
}) {
  if (!sharedReady) return '팀 공용 매칭 정보를 불러오는 중입니다. 조회 오류가 있으면 매칭 정보를 다시 불러오세요.';
  if (saving) return '품목 매칭 저장이 끝난 뒤 진행해 주세요.';
  if (processing) return '파일 분석이 끝난 뒤 진행해 주세요.';
  if (latestShared) return '다른 작업자가 매칭을 변경했습니다. 최신 매칭을 불러온 뒤 다시 진행해 주세요.';
  const canReviewAllocation = allowAllocationReview && allocationCount > 0;
  if (!matchingComplete && !canReviewAllocation) return `전산 품목을 확인할 행이 ${remainingMatches}건 남았습니다. 해당 품목을 선택해 주세요.`;
  return '';
}
