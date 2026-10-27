'use strict';
const { recentMonth, PROGRAM, MODE } = require('./ecountCustomerLedgerPolicy.cjs');
function invalid() { throw new Error('INVALID_LEDGER'); }
function amount(v) { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e14) invalid(); return v; }
// Only dates and amounts are retained. Source memo/header fields can contain personal data.
function validateLedger(input, now = new Date()) {
  const period = recentMonth(now);
  if (!input || input.program !== PROGRAM || input.mode !== MODE || input.individual !== true ||
      input.periodFrom !== period.from || input.periodTo !== period.to ||
      !Number.isSafeInteger(input.custKey) || input.custKey < 1 ||
      !Array.isArray(input.rows) || input.rows.length > 20000 || input.screenRowCount !== input.rows.length) invalid();
  const rows = input.rows.map((r, i) => {
    if (!r || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(r.date)) || new Date(r.date).toISOString().slice(0,10) !== r.date || r.date < period.from || r.date > period.to) invalid();
    return { sequence: i + 1, date: r.date, sales: amount(r.sales), receipt: amount(r.receipt), balance: amount(r.balance) };
  });
  if (!rows.length && input.empty === true) {
    // An empty report establishes no vouchers, not a zero receivable balance.
    if (input.opening !== null || input.totals !== null || input.balanceOnly===true) invalid();
    return { program: PROGRAM, mode: MODE, custKey: input.custKey, periodFrom: period.from, periodTo: period.to, rows, opening: null, totals: null, verified: true };
  }
  const opening = amount(input.opening);
  if(input.balanceOnly===true&&rows.length)invalid();
  const totals = { sales: amount(input.totals?.sales), receipt: amount(input.totals?.receipt), balance: amount(input.totals?.balance) };
  let balance = opening, sales = 0, receipt = 0, previousDate = period.from;
  for (const r of rows) {
    if (r.date < previousDate) invalid();
    balance += r.sales - r.receipt; sales += r.sales; receipt += r.receipt;
    if (Math.abs(balance-r.balance)>1) invalid();
    previousDate = r.date;
  }
  if (Math.abs(sales-totals.sales)>1 || Math.abs(receipt-totals.receipt)>1 || Math.abs(balance-totals.balance)>1) invalid();
  return { program: PROGRAM, mode: MODE, custKey: input.custKey, periodFrom: period.from, periodTo: period.to, rows, opening, totals, balanceOnly:input.balanceOnly===true, verified: true };
}
function validateFailure(input,now=new Date()){
  const p=recentMonth(now);
  if(!input||!Number.isSafeInteger(input.custKey)||input.custKey<1||input.periodFrom!==p.from||input.periodTo!==p.to||!['LINK_CHECK_REQUIRED','SOURCE_UNAVAILABLE'].includes(input.failure))invalid();
  return {custKey:input.custKey,periodFrom:p.from,periodTo:p.to,failure:input.failure};
}
module.exports = { validateLedger,validateFailure };
