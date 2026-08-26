const keyFor = (custKey, prodKey) => `${custKey}_${prodKey}`;

/** Return the visible matrix rectangle, using the order captured when a drag starts. */
export function rectanglePricingCellKeys({ products, customers, startKey, endKey }) {
  const productIndex = new Map(products.map((product, index) => [String(product.ProdKey), index]));
  const customerIndex = new Map(customers.map((customer, index) => [String(customer.CustKey), index]));
  const [startCustomer, startProduct] = String(startKey).split('_');
  const [endCustomer, endProduct] = String(endKey).split('_');
  const startRow = productIndex.get(startProduct);
  const endRow = productIndex.get(endProduct);
  const startColumn = customerIndex.get(startCustomer);
  const endColumn = customerIndex.get(endCustomer);

  if ([startRow, endRow, startColumn, endColumn].some(index => index === undefined)) return [];

  const rowStart = Math.min(startRow, endRow);
  const rowEnd = Math.max(startRow, endRow);
  const columnStart = Math.min(startColumn, endColumn);
  const columnEnd = Math.max(startColumn, endColumn);
  const keys = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      keys.push(keyFor(customers[column].CustKey, products[row].ProdKey));
    }
  }
  return keys;
}

const originalCost = (key, localCosts, costs) => (
  Object.prototype.hasOwnProperty.call(costs || {}, key) ? costs[key]?.cost : undefined
);

const sameCost = (left, right) => {
  if (left === '' || left === null || left === undefined) return right === '' || right === null || right === undefined;
  if (right === '' || right === null || right === undefined) return false;
  return Number(left) === Number(right);
};

/** Apply a validated browser-only draft value and retain unrelated drafts. */
export function applyPricingCellCost({ keys, value, localCosts, costs, changed }) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && value.trim() === '')) {
    throw new Error('선택 단가는 0 이상의 유한한 숫자여야 합니다.');
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error('선택 단가는 0 이상의 유한한 숫자여야 합니다.');
  }

  const nextLocalCosts = { ...(localCosts || {}) };
  const nextChanged = new Set(changed || []);
  for (const key of keys || []) {
    nextLocalCosts[key] = numericValue;
    if (sameCost(numericValue, originalCost(key, localCosts, costs))) nextChanged.delete(key);
    else nextChanged.add(key);
  }
  return { localCosts: nextLocalCosts, changed: nextChanged };
}
