// Display preference only. This value never authenticates a user.
export const LOGIN_ID_COOKIE = 'nenovaLoginId';

export function readLoginId(cookieText = '') {
  try {
    const value = cookieText.split(';').map(part => part.trim()).find(part => part.startsWith(`${LOGIN_ID_COOKIE}=`));
    const id = value ? decodeURIComponent(value.slice(LOGIN_ID_COOKIE.length + 1)) : '';
    return id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id) ? id : '';
  } catch { return ''; }
}

export function loginIdCookie(id, secure = true) {
  if (typeof id !== 'string' || !id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) return '';
  try { return `${LOGIN_ID_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`; }
  catch { return ''; }
}
