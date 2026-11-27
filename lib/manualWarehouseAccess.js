import { canManageInvoiceReceipt } from './invoiceReceiptAccess.js';
import { isManualWarehouseAllowedAccount } from './manualWarehouseUpload.js';

export function canUseManualWarehouseUpload(user = {}) {
  return canManageInvoiceReceipt(user) || isManualWarehouseAllowedAccount(user);
}
