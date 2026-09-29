import { freightEvidenceRows } from './estimateFreightEvidence.js';
import { amountVatFromCostEst } from './distributeUnits.js';

// Use the same bounded GET evidence, but never label current-week rows as previous.
export function previousFreightHistory(rows, scope) {
  const previous = freightEvidenceRows(rows, scope).filter(row => Number(row.OrderWeek.slice(0, 2)) < Number(scope.parentWeek));
  const weeks = [...new Set(previous.map(row => row.OrderWeek.slice(0, 2)))].sort((a, b) => Number(b) - Number(a));
  return weeks.map(week => {
    const seen = new Set();
    const items = previous.filter(row => row.OrderWeek.startsWith(`${week}-`)).filter(row => {
      if (row.SdateKey == null) return true;
      const key = `${row.OrderYear}|${row.CustKey}|${row.SdateKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((row, index) => ({
      ...row, historyKey: `${week}|${row.SdateKey ?? index}`,
      // Persisted invoice amounts are authoritative, not quantity * price estimates.
      total: Number.isFinite(row.Amount) && Number.isFinite(row.Vat) ? row.Amount + row.Vat : null,
    })).sort((a, b) => a.OrderWeek.localeCompare(b.OrderWeek) || a.ProdName.localeCompare(b.ProdName, 'ko') || String(a.outDate).localeCompare(String(b.outDate)));
    return { week, rows: items, total: items.every(row => row.total != null) ? items.reduce((sum, row) => sum + row.total, 0) : null };
  });
}

export function editFreightInput(previous, values) {
  // Direct typing selects the row, but never posts or replaces explicit zero/empty.
  return { ...previous, ...values, enabled: true, ...(Object.hasOwn(values, 'qty') ? {manualQty: true} : {}) };
}

export function freightInputTotal(qty, cost) {
  if (qty === '' || cost === '' || qty == null || cost == null || typeof qty === 'boolean' || typeof cost === 'boolean') return null;
  if (!Number.isFinite(Number(qty)) || !Number.isFinite(Number(cost)) || Number(qty) <= 0 || Number(cost) <= 0) return null;
  const money = amountVatFromCostEst(Number(cost), Number(qty));
  return money.amount + money.vat;
}
