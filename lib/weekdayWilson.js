// Wilson is a web classification inside the ERP day total, never another shipment.
export function weekdayWilsonIdentity(value) {
  return `${value.year}|${value.orderWeek}|${value.custKey}|${value.prodKey}|${value.date}`;
}

export function weekdayWilsonSplit(expectedTotal, unit, record, identity) {
  if (!record) return { status: 'UNCLASSIFIED', general: expectedTotal, wilsonQuantity: 0, expectedTotal };
  // This tombstone clears only the web classification. It makes no claim that
  // ERP has a zero row, which native cancellation may have removed entirely.
  if (record.status === 'CLEARED' && record.expectedTotal === 0 && record.wilsonQuantity === 0
    && weekdayWilsonIdentity(record) === weekdayWilsonIdentity(identity)) {
    return { status: 'UNCLASSIFIED', general: expectedTotal, wilsonQuantity: 0, expectedTotal };
  }
  const valid = Number.isFinite(expectedTotal) && expectedTotal >= 0 && record.status !== 'STALE'
    && record.status !== 'UNVERIFIED' && weekdayWilsonIdentity(record) === weekdayWilsonIdentity(identity)
    && record.unit === unit && record.expectedTotal === expectedTotal && Number.isFinite(record.wilsonQuantity)
    && record.wilsonQuantity >= 0 && record.wilsonQuantity <= expectedTotal;
  if (!valid) return { status: 'STALE', general: null, wilsonQuantity: null, expectedTotal };
  return { status: 'CURRENT', general: Math.round((expectedTotal - record.wilsonQuantity) * 1000) / 1000,
    wilsonQuantity: record.wilsonQuantity, expectedTotal };
}

export function verifyWeekdayWilsonRecord(record, rows, { forSave = false } = {}) {
  // Explicit zero/zero is a durable classification-clear intent, including
  // after native date deletion or a later ERP total edit. Never infer ERP zero.
  const clearing = record.expectedTotal === 0 && record.wilsonQuantity === 0;
  if (clearing && !forSave) return { ...record, status: 'CLEARED' };
  const matching = rows.filter(row => Number(row.OrderYear) === record.year
    && Number(row.CustKey) === record.custKey && Number(row.ProdKey) === record.prodKey
    && row.OrderWeek?.slice(0, 2) === record.majorWeek && row.Date === record.date);
  if (!matching.length) return { ...record, status: clearing ? 'CLEARED' : 'UNVERIFIED' };
  const numeric = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0
    || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)))
    && Number(value) <= 2147483647 && Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) <= 0.000001;
  const valid = matching.every(row => row.OrderWeek === record.orderWeek && row.Unit === record.unit
    && Number(row.ProductActive) === 1 && Number(row.CustomerMatch) === 1 && numeric(row.Quantity));
  if (!valid) return { ...record, status: 'UNVERIFIED' };
  const currentTotal = Math.round(matching.reduce((sum, row) => sum + Number(row.Quantity), 0) * 1000) / 1000;
  if (clearing && currentTotal === 0) return { ...record, status: 'CLEARED' };
  return { ...record, status: currentTotal === record.expectedTotal && record.wilsonQuantity <= currentTotal ? 'CURRENT' : 'STALE', currentTotal };
}
