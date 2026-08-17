const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function buildPasteBatchChangeAudit(details = [], previous = {}) {
  const audit = { ...(previous || {}) };
  details.filter((row) => row?.ok && ['ADD', 'CANCEL'].includes(row.type)).forEach((row) => {
    const prodKey = Number(row.prodKey);
    if (!prodKey) return;
    const old = audit[prodKey] || {};
    audit[prodKey] = {
      ...old,
      prodKey,
      prodName: old.prodName || row.prodName || '',
      displayName: old.displayName || row.displayName || row.prodName || '',
      counName: old.counName || row.counName || '',
      flowerName: old.flowerName || row.flowerName || '',
      unit: old.unit || row.unit || '',
      actions: [...new Set([...(old.actions || []), row.type])],
      orderQtyBefore: old.orderQtyBefore ?? finiteOrNull(row.orderQtyBefore),
      orderQtyAfter: finiteOrNull(row.orderQtyAfter) ?? old.orderQtyAfter ?? null,
      outQtyBefore: old.outQtyBefore ?? finiteOrNull(row.outQtyBefore),
      outQtyAfter: finiteOrNull(row.outQtyAfter) ?? old.outQtyAfter ?? null,
    };
  });
  return audit;
}

export function mergePasteRegisteredItems(items = [], audit = {}) {
  const byKey = new Map(items.map((item) => [Number(item.prodKey), { ...item }]));
  Object.values(audit || {}).forEach((change) => {
    const prodKey = Number(change.prodKey);
    if (!prodKey || byKey.has(prodKey)) return;
    byKey.set(prodKey, {
      prodKey,
      prodName: change.prodName || '',
      displayName: change.displayName || change.prodName || '',
      counName: change.counName || '',
      flowerName: change.flowerName || '',
      qty: change.orderQtyAfter ?? 0,
      unit: change.unit || '',
      _auditOnly: true,
    });
  });
  return [...byKey.values()];
}

export function pasteAuditChanged(change) {
  if (!change) return false;
  return (
    (change.orderQtyBefore != null && change.orderQtyAfter != null && change.orderQtyBefore !== change.orderQtyAfter) ||
    (change.outQtyBefore != null && change.outQtyAfter != null && change.outQtyBefore !== change.outQtyAfter)
  );
}
