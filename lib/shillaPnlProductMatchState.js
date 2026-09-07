// Browser-safe snapshot helpers for a single saved Shilla P&L source row.
// Keep this module free of db/auth imports: the detail UI and server revalidation
// must compare exactly the same source-row state.

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function sourceValue(row, ...keys) {
  for (const key of keys) if (own(row, key)) return row[key];
  return undefined;
}

function requireSourceValue(row, field, ...keys) {
  if (!keys.some(key => own(row, key))) throw new Error(`${field} 값이 없습니다.`);
  return sourceValue(row, ...keys);
}

function numberOrNull(value, field) {
  if (value === null) return null;
  if (value === undefined || typeof value === 'boolean' || Array.isArray(value) ||
      (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim()))) {
    throw new Error(`${field} 값이 비어 있습니다.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} 값이 올바른 숫자가 아닙니다.`);
  return number;
}

function positiveInteger(value, field) {
  if (!((typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && /^\d+$/.test(value.trim())))) {
    throw new Error(`${field} 값이 올바르지 않습니다.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} 값이 올바르지 않습니다.`);
  return number;
}

function booleanValue(value, field) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new Error(`${field} 값이 올바른 논리값이 아닙니다.`);
}

/** Canonical, complete source-row snapshot. Numeric 0 and null deliberately differ. */
export function shillaPnlProductMatchSnapshot(row = {}) {
  const itemKey = positiveInteger(requireSourceValue(row, '결산 품목', 'itemKey', 'ItemKey'), '결산 품목');
  const name = requireSourceValue(row, '품목명', 'name', 'Name', 'itemName', 'ItemName');
  const unit = requireSourceValue(row, '단위', 'unit', 'Unit');
  if (typeof name !== 'string' || typeof unit !== 'string') {
    throw new Error('품목명과 단위가 올바르지 않습니다.');
  }
  const rawProdKey = requireSourceValue(row, '전산 품목번호', 'prodKey', 'ProdKey');
  const prodKey = rawProdKey == null ? null : positiveInteger(rawProdKey, '전산 품목번호');
  return {
    itemKey,
    name,
    unit,
    qty: numberOrNull(requireSourceValue(row, '수량', 'qty', 'Qty'), '수량'),
    salePrice: numberOrNull(requireSourceValue(row, '판매단가', 'salePrice', 'SalePrice', 'price', 'Price'), '판매단가'),
    saleAmount: numberOrNull(requireSourceValue(row, '판매금액', 'saleAmount', 'SaleAmount', 'supply', 'Supply'), '판매금액'),
    prodKey,
    isCustom: booleanValue(requireSourceValue(row, '수기 품목 여부', 'isCustom', 'IsCustom'), '수기 품목 여부'),
  };
}

export function sameShillaPnlProductMatchSnapshot(left, right) {
  try {
    return JSON.stringify(shillaPnlProductMatchSnapshot(left)) === JSON.stringify(shillaPnlProductMatchSnapshot(right));
  } catch {
    return false;
  }
}
