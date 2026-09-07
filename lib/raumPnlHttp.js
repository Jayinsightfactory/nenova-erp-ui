// 라움 손익 업로드는 nginx 등의 앞단이 JSON 대신 HTML 오류 페이지를 돌려줄 수 있다.
// 전역 parseJsonResponse 정책은 건드리지 않고, 이 화면의 미리보기/저장만 안전하게 해석한다.

export const MAX_RAUM_PNL_UPLOAD_BYTES = 30 * 1024 * 1024;

function operationLabel(operation) {
  return operation === 'save' ? '저장' : '미리보기';
}

function pnlHttpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.raumPnlHttp = true;
  return error;
}

function gatewayMessage(status, operation) {
  const label = operationLabel(operation);
  if (operation === 'save') {
    return `서버 연결 문제(HTTP ${status})로 저장 결과를 확인할 수 없습니다. 자동으로 다시 저장하지 않았습니다. 목록을 새로고침해 저장 여부를 먼저 확인하세요.`;
  }
  return `서버 연결 문제(HTTP ${status})로 미리보기를 받지 못했습니다. 자동으로 다시 요청하지 않았습니다. 잠시 후 미리보기 버튼을 다시 눌러 주세요.`;
}

function responseFailureMessage(status, operation, data) {
  const label = operationLabel(operation);
  if (status === 413) {
    if (data && typeof data === 'object') {
      const detail = typeof data.error === 'string' ? ` ${data.error}` : '';
      return `업로드가 서버에서 거절되었습니다(HTTP 413). 저장 완료되지 않았습니다.${detail}`;
    }
    return '업로드가 서버에서 거절되었습니다(HTTP 413). 현재 서버 업로드 크기 제한을 관리자에게 확인하세요. 선택한 파일은 그대로 유지됩니다.';
  }
  if (status === 401 || status === 403) {
    return `로그인이 필요하거나 ${label} 권한이 없습니다(HTTP ${status}). 다시 로그인한 뒤 미리보기를 다시 실행하세요.`;
  }
  if ([502, 503, 504].includes(status)) return gatewayMessage(status, operation);
  if (data && typeof data === 'object') {
    const detail = typeof data.error === 'string' ? data.error : (typeof data.message === 'string' ? data.message : '');
    if (detail) return detail;
  }
  return `${label} 요청이 실패했습니다(HTTP ${status}). 서버 응답 형식을 확인할 수 없습니다.`;
}

function invalidResponseMessage(status, operation) {
  if (operation === 'save') {
    return `저장 응답을 확인할 수 없습니다(HTTP ${status}). 저장 완료 여부가 확정되지 않았습니다. 목록을 새로고침해 저장 여부를 먼저 확인하세요.`;
  }
  return `서버 응답 형식이 올바르지 않습니다(HTTP ${status}). 미리보기 결과를 확인할 수 없습니다. 새로고침 후 미리보기를 다시 실행하세요.`;
}

/**
 * Response 본문을 단 한 번만 읽고 JSON일 때만 해석한다.
 * HTML 본문은 오류 문구에 넣지 않아 프록시 페이지나 내부 정보가 화면에 노출되지 않는다.
 */
export async function readRaumPnlJsonResponse(response, { operation = 'preview' } = {}) {
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw pnlHttpError(responseFailureMessage(response.status, operation, data), response.status, 'RAUM_PNL_HTTP_ERROR');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
    const message = data?.success === false
      ? (typeof data.error === 'string' ? data.error : (typeof data.message === 'string' ? data.message : `${operationLabel(operation)}에 실패했습니다.`))
      : invalidResponseMessage(response.status, operation);
    throw pnlHttpError(
      message,
      response.status,
      'RAUM_PNL_INVALID_RESPONSE',
    );
  }
  return data;
}

/** P&L 업로드/저장에만 사용한다. 실패한 저장을 자동 재시도하지 않는다. */
export async function fetchRaumPnlJson(url, options, context = {}) {
  try {
    const response = await fetch(url, options);
    return await readRaumPnlJsonResponse(response, context);
  } catch (error) {
    if (error?.raumPnlHttp || error?.name === 'AbortError') throw error;
    const label = operationLabel(context.operation);
    throw pnlHttpError(
      context.operation === 'save'
        ? `네트워크 연결 문제로 ${label} 결과를 확인할 수 없습니다. 자동으로 다시 저장하지 않았습니다. 목록을 새로고침해 저장 여부를 먼저 확인하세요.`
        : `네트워크 연결 문제로 ${label}를 받지 못했습니다. 자동으로 다시 요청하지 않았습니다. 연결을 확인한 뒤 미리보기 버튼을 다시 눌러 주세요.`,
      null,
      'RAUM_PNL_NETWORK_ERROR',
    );
  }
}
