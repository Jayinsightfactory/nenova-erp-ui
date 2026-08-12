const qty = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function resolveShipmentDistributionEditPolicy({ hasDetail, oldQty, newQty, farmCount }) {
  const before = qty(oldQty);
  const after = qty(newQty);
  const farms = Math.max(0, Number(farmCount) || 0);

  if (farms > 0 && before !== after) {
    return { allowed: false, action: 'blocked-farm-mismatch', before, after };
  }
  if (!hasDetail && after === 0) return { allowed: true, action: 'noop', before, after };
  if (hasDetail && after === 0) return { allowed: true, action: 'delete', before, after };
  return { allowed: true, action: hasDetail ? 'update' : 'insert', before, after };
}
