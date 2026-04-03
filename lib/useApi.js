// lib/useApi.js
// API 호출 공통 유틸
// 수정이력: 2026-03-27 — credentials: 'include' 추가 (쿠키 인증 누락 버그 수정)

export async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',   // ← 쿠키 포함 (JWT 인증에 필수)
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // 401 → 로그인 페이지로
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('로그인이 필요합니다.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  ).toString();
  return apiFetch(qs ? `${path}?${qs}` : path);
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body });
}

export async function apiPatch(path, body) {
  return apiFetch(path, { method: 'PATCH', body });
}

export async function apiDelete(path, body) {
  return apiFetch(path, { method: 'DELETE', body });
}
