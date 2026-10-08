import { hasFullWebAccess, isAdminUser } from './userAccess';

export function canManageInvoiceReceipt(user = {}) {
  const userId = String(user?.userId ?? user?.UserID ?? '').trim();
  if (!userId || user?.accountActive === false || user?.isDeleted === true) return false;

  const department = String(user?.deptName ?? user?.DeptName ?? '').trim();
  if (department === '수입부' || department === '대표') return true;
  if (hasFullWebAccess(user)) return true;

  const authority = user?.authority ?? user?.Authority;
  return authority !== undefined && authority !== null && authority !== '' && isAdminUser(user);
}
