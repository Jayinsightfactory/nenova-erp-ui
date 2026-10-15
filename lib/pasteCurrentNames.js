// Display-only hydration for an existing paste analysis. The saved ERP keys are
// authoritative; source aliases and business fields must never be rematched.
function positiveKey(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const key = Number(value);
  return Number.isSafeInteger(key) && key > 0 ? key : null;
}

function activeIndex(rows, keyName) {
  const index = new Map();
  for (const row of rows || []) {
    const key = positiveKey(row?.[keyName]);
    if (key && Number(row.isDeleted || 0) === 0) index.set(key, row);
  }
  return index;
}

export function hydratePasteOrderNames(orders, customers, products) {
  const customerByKey = activeIndex(customers, 'CustKey');
  const productByKey = activeIndex(products, 'ProdKey');
  let changed = false;
  const next = (orders || []).map(order => {
    let nextOrder = order;
    const customer = customerByKey.get(positiveKey(order?.custMatch?.CustKey));
    if (customer && typeof customer.CustName === 'string' && order.custMatch.CustName !== customer.CustName) {
      nextOrder = { ...nextOrder, custMatch: { ...order.custMatch, CustName: customer.CustName } };
    }
    const items = Array.isArray(order?.items) ? order.items : [];
    let itemChanged = false;
    const nextItems = items.map(item => {
      const product = productByKey.get(positiveKey(item?.prodKey));
      if (!product || typeof product.ProdName !== 'string') return item;
      const displayKnown = product.DisplayName === null || typeof product.DisplayName === 'string';
      if (item.prodName === product.ProdName && (!displayKnown || item.displayName === product.DisplayName)) return item;
      itemChanged = true;
      return {
        ...item,
        prodName: product.ProdName,
        ...(displayKnown ? { displayName: product.DisplayName } : {}),
      };
    });
    if (itemChanged) nextOrder = { ...nextOrder, items: nextItems };
    if (nextOrder !== order) changed = true;
    return nextOrder;
  });
  return changed ? next : orders;
}

// Base-stock matching rows are evidence and must retain their saved names.
// Project only the visible label from the current product at the same key.
export function currentProductLabel(row, products) {
  const key = positiveKey(row?.prodKey);
  const current = key && (products || []).find(product =>
    positiveKey(product?.ProdKey) === key && Number(product.isDeleted || 0) === 0);
  if (current && typeof current.ProdName === 'string')
    return typeof current.DisplayName === 'string' && current.DisplayName.trim()
      ? current.DisplayName : current.ProdName;
  return row?.displayName || row?.prodName || '';
}

export function hydratePasteOrderNamesWithCompletion({
  orders, customers, products, week, pasteText, evidenceMessages = [], completionFingerprint,
  buildFingerprint,
}) {
  const nextOrders = hydratePasteOrderNames(orders, customers, products);
  if (nextOrders === orders) return { orders, completionFingerprint, changed: false };
  const currentFingerprint = typeof buildFingerprint === 'function'
    ? buildFingerprint({ week, pasteText, orders, evidenceMessages }) : null;
  const shouldRebase = Boolean(completionFingerprint) && Boolean(currentFingerprint) &&
    completionFingerprint === currentFingerprint;
  return {
    orders: nextOrders,
    completionFingerprint: shouldRebase
      ? buildFingerprint({ week, pasteText, orders: nextOrders, evidenceMessages })
      : completionFingerprint,
    changed: true,
    completionRebased: shouldRebase,
  };
}
