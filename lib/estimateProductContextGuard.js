export function shouldApplyEstimateProductContext({
  requestId,
  currentRequestId,
  requestedProdKey,
  currentProdKey,
}) {
  return Number(requestId) === Number(currentRequestId)
    && Number(requestedProdKey) > 0
    && Number(requestedProdKey) === Number(currentProdKey);
}
