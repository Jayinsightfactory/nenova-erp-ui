export function deriveSupportProcessingStatus(row = {}) {
  const storedStatus = String(row.status || '').toUpperCase();
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
  return status === 'REGISTERED' || status === 'COMPLETED_EXISTING';
}

export function supportProcessingLabel(row = {}) {
  const derived = row.processingStatus ? row : { ...row, ...deriveSupportProcessingStatus(row) };
  if (derived.processingStatus === 'COMPLETED_EXISTING') return `처리완료 (기존 불량차감 #${derived.processingEstimateKey})`;
  if (derived.processingStatus === 'REGISTERED') return `등록완료${derived.processingEstimateKey ? ` (#${derived.processingEstimateKey})` : ''}`;
  if (derived.processingStatus === 'CARRYOVER') return '이월 대기';
  return '미등록';
}
