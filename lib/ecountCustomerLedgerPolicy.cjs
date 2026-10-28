'use strict';
// E040723 only. Caller must resolve ownership and unique ECOUNT code from the DB,
// never from request payloads or customer display names.
const PROGRAM = 'E040723';
const MODE = 'voucher';
function isLedgerAdmin(user) {
  return typeof user?.userId === 'string' && user.userId.trim().toLowerCase() === 'nenovass3';
}
function recentMonth(now = new Date()) {
  const kst = new Date(Number(now) + 9 * 3600000);
  if (!Number.isFinite(kst.getTime())) throw new Error('INVALID_DATE');
  const year = kst.getUTCFullYear(), month = kst.getUTCMonth(), day = kst.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
  return { from: from.toISOString().slice(0, 10), to: kst.toISOString().slice(0, 10) };
}
function canReadCustomer(user, customer) {
  return !!user && user.accountActive === true && typeof user.userId === 'string' && user.userId.trim() !== '' &&
    !!customer && customer.active === true && (customer.managerUserId === user.userId || isLedgerAdmin(user)) &&
    customer.codeMatchCount === 1 && typeof customer.ecountCode === 'string' && customer.ecountCode.trim() !== '';
}
function authorizeSnapshot(user, customer, snapshot, now = new Date()) {
  if (!canReadCustomer(user, customer)) return { allowed: false, reason: 'CUSTOMER_FORBIDDEN' };
  const period = recentMonth(now);
  if (!snapshot || snapshot.program !== PROGRAM || snapshot.mode !== MODE ||
      snapshot.ecountCode !== customer.ecountCode || snapshot.custKey !== customer.custKey ||
      snapshot.periodFrom !== period.from || snapshot.periodTo !== period.to) {
    return { allowed: false, reason: 'SOURCE_SCOPE_MISMATCH' };
  }
  if (snapshot.verified !== true) return { allowed: false, reason: 'SOURCE_UNVERIFIED' };
  return { allowed: true, reason: null };
}
module.exports = { PROGRAM, MODE, recentMonth, isLedgerAdmin, canReadCustomer, authorizeSnapshot };
