import { hasFullWebAccess, isAdminUser } from './userAccess';

export function canManageInvoiceReceipt(user = {}) {
  const userId = String(user?.userId ?? user?.UserID ?? '').trim();
  if (!userId || user?.accountActive === false || user?.isDeleted === true) return false;

  const department = String(user?.deptName ?? user?.DeptName ?? '').trim();
  if (department === '수입부' || department === '대표') return true;
  if (hasFullWebAccess(user)) return true;

  const authority = user?.authority ?? user?.Authority;
  // UserInfo uses the existing numeric role codes even when DeptName is empty.
  // Keep this local to invoice work: 4=수입부, 7=수입부(관리), not general admin.
  if ((typeof authority === 'number' || typeof authority === 'string')
    && ['4', '7'].includes(String(authority).trim())) return true;
  return authority !== undefined && authority !== null && authority !== '' && isAdminUser(user);
}
