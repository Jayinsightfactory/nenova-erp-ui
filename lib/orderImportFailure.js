const AMBIGUOUS_GATEWAY_STATUSES = new Set([502, 503, 504]);

function getHttpStatus(error) {
  const status = error?.status;
  return Number.isInteger(status) ? status : null;
}

export function presentOrderImportFailure(error) {
  const status = getHttpStatus(error);
  const detail = String(error?.message || '알 수 없는 오류');
  const ambiguous = status === null || status >= 500 || AMBIGUOUS_GATEWAY_STATUSES.has(status);

  if (ambiguous) {
    return {
      kind: 'ambiguous',
      message: `저장 여부 확인 필요 — 서버 응답이 불명확합니다 (${status === null ? detail : `HTTP ${status}: ${detail}`}). 자동 재전송하지 않았습니다. 업로드 초안은 유지했습니다. 주문관리에서 업체·연도·차수의 현재 주문을 먼저 조회하고, 저장 여부 확인 전에는 다시 등록하지 마세요.`,
    };
  }

  return {
    kind: 'rejected',
    message: `주문 등록 요청이 거부되었습니다 (HTTP ${status}): ${detail}. 업로드 초안은 유지했습니다. 자동 재전송하지 않았습니다.`,
  };
}

export function orderImportWarningMessage(warning) {
  if (typeof warning === 'string') return warning;
  if (warning && typeof warning === 'object') {
    return String(warning.message || warning.error || warning.code || '재고 재계산에 실패했습니다.');
  }
  return String(warning || '재고 재계산에 실패했습니다.');
}
