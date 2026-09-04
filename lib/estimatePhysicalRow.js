function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// 견적 수량 입력은 화면의 품목명이 아니라 실제 저장 행의 PK를 기준으로 분리한다.
// 정상 출고는 ShipmentDate.SdateKey, 불량·검역 차감은 Estimate.EstimateKey다.
export function estimateQuantityEditKey(row) {
  const estimateKey = positiveInteger(row?.EstimateKey);
  const sdetailKey = positiveInteger(row?.SdetailKey);
  if (estimateKey != null && sdetailKey == null) return `est:${estimateKey}`;

  const sdateKey = positiveInteger(row?.SdateKey);
  return sdateKey != null ? `sdate:${sdateKey}` : '';
}

export function estimatePhysicalRowKey(row) {
  const quantityKey = estimateQuantityEditKey(row);
  if (quantityKey) return quantityKey;

  const sdetailKey = positiveInteger(row?.SdetailKey);
  if (sdetailKey != null) {
    const outDate = String(row?.outDate || '').trim();
    return outDate ? `sd:${sdetailKey}@${outDate}` : `sd:${sdetailKey}`;
  }
  return '';
}

// JOIN 중복으로 같은 물리 행이 반복된 경우만 한 번 표시한다.
// 같은 품목·날짜라도 SdateKey가 다르면 별도 행으로 유지한다.
export function dedupeEstimatePhysicalRows(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = estimatePhysicalRowKey(row);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
