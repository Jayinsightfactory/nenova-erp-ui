const FULL_ACCESS_USER_IDS = new Set(['nenovass3']);

export function hasFullWebAccess(user = {}) {
  return FULL_ACCESS_USER_IDS.has(String(user?.userId ?? user?.UserID ?? '').trim().toLowerCase());
}

export function effectiveAuthority(user = {}) {
  return hasFullWebAccess(user) ? 1 : (user?.authority ?? user?.Authority);
}

export function applyEffectiveWebAccess(user = {}) {
  return { ...user, authority: effectiveAuthority(user) };
}

export function isAdminUser(user = {}) {
  const authority = Number(effectiveAuthority(user));
  return (Number.isFinite(authority) && authority <= 1)
    || /admin|관리자|대표/i.test(String(user?.authority ?? user?.Authority ?? ''))
    || String(user?.deptName ?? user?.DeptName ?? '') === '대표';
}
