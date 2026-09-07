export const SHILLA_PNL_PRODUCT_SEARCH_LIMIT = 50;

export function shillaPnlProductSearchUrl(value) {
  const query = String(value ?? '').trim();
  return `/api/products/search?q=${encodeURIComponent(query)}`;
}

export function isShillaPnlCompositionEnter(event) {
  return Boolean(event?.isComposing || event?.nativeEvent?.isComposing || Number(event?.keyCode) === 229 || Number(event?.nativeEvent?.keyCode) === 229);
}

export function runShillaPnlSearchEnter(event, search) {
  if (event?.key !== 'Enter' || isShillaPnlCompositionEnter(event)) return false;
  event.preventDefault?.();
  search(String(event?.currentTarget?.value ?? ''));
  return true;
}

export function isCurrentShillaPnlSearchRequest(request, currentRequest) {
  return request === currentRequest;
}

function searchResponseError(response, body, result) {
  if (result?.error) return String(result.error);
  const status = Number(response?.status);
  const prefix = Number.isFinite(status) && status > 0 ? `품목 검색 요청이 실패했습니다 (HTTP ${status}).` : '품목 검색 요청이 실패했습니다.';
  if (/^\s*</.test(body || '')) return `${prefix} 서버가 품목 목록 대신 오류 화면을 보냈습니다. 잠시 후 다시 검색해 주세요.`;
  return prefix;
}

// 검색 API가 프록시 오류 HTML을 반환해도 JSON 파싱 오류로 숨기지 않는다.
export async function readShillaPnlProductSearchResponse(response) {
  const body = await response.text();
  let result;
  try {
    result = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(searchResponseError(response, body));
  }
  if (!response.ok || !result?.success) throw new Error(searchResponseError(response, body, result));
  if (!Array.isArray(result.products)) throw new Error('서버에서 품목 목록을 받지 못했습니다. 잠시 후 다시 검색해 주세요.');
  return result.products.slice(0, SHILLA_PNL_PRODUCT_SEARCH_LIMIT);
}

export function shillaPnlSearchEmptyMessage({ hasSearched, products, error }) {
  if (error || !hasSearched || (products || []).length) return '';
  return '검색 결과 없음';
}
