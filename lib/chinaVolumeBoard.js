const BOX_RANGE_RE = /(\d+)\s*[-~]\s*(\d+)/g;

export function normalizeChinaText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(no|box|rose|carnation|hydrangea|cm)\.?\b/gi, ' ')
    .replace(/[()（）\[\]{}\/\\._-]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

export function parseChinaBoxNumbers(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const found = [];
  const expanded = raw.replace(BOX_RANGE_RE, (_, fromRaw, toRaw) => {
    const from = Number(fromRaw);
    const to = Number(toRaw);
    if (Number.isInteger(from) && Number.isInteger(to) && to >= from && to - from <= 200) {
      for (let n = from; n <= to; n += 1) found.push(String(n));
    }
    return ' ';
  });
  for (const match of expanded.matchAll(/\d+/g)) {
    const valueNum = String(Number(match[0]));
    if (valueNum !== '0') found.push(valueNum);
  }
  return [...new Set(found)];
}

export function splitChinaBoxQuantity(quantity, boxNumbers) {
  const qty = Number(quantity || 0);
  const boxes = Array.isArray(boxNumbers) ? boxNumbers.filter(Boolean) : [];
  if (!(qty > 0) || boxes.length === 0) return [];
  const base = Math.floor((qty / boxes.length) * 1000) / 1000;
  let used = 0;
  return boxes.map((boxNo, index) => {
    const allocatedQty = index === boxes.length - 1
      ? Math.round((qty - used) * 1000) / 1000
      : base;
    used += allocatedQty;
    return { boxNo: String(boxNo), quantity: allocatedQty };
  });
}

export function parseChinaPackingRows(aoa) {
  const rows = Array.isArray(aoa) ? aoa : [];
  const result = [];
  let customerCode = '';
  rows.forEach((line, index) => {
    const values = Array.isArray(line) ? line : [];
    const nextCustomer = String(values[0] || '').trim();
    if (nextCustomer && !/customer/i.test(nextCustomer)) customerCode = nextCustomer;
    const sourceBoxText = String(values[1] || '').trim();
    const sourceItemName = String(values[2] || '').trim();
    const quantity = Number(values[3] || 0);
    if (!customerCode || !sourceItemName || !(quantity > 0) || /item\s*name/i.test(sourceItemName)) return;
    const boxNumbers = parseChinaBoxNumbers(sourceBoxText);
    result.push({
      sourceRow: index + 1,
      customerCode,
      sourceBoxText,
      sourceItemName,
      quantity,
      boxNumbers,
      allocations: splitChinaBoxQuantity(quantity, boxNumbers),
    });
  });
  return result;
}

function productMatchScore(sourceName, product) {
  const source = normalizeChinaText(sourceName);
  const prod = normalizeChinaText(product?.prodName);
  if (!source || !prod) return 0;
  if (source === prod) return 1000;
  if (prod.includes(source) || source.includes(prod)) return 700 + Math.min(source.length, prod.length);
  const tokens = String(sourceName || '').toLowerCase().match(/[a-z]{3,}|[가-힣]{2,}/g) || [];
  const haystack = `${product?.prodName || ''} ${product?.flower || ''}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? token.length * 10 : 0), 0);
}

export function matchChinaPackingRows(packingRows, pivotData) {
  const customers = (pivotData?.customers || []).filter(c => String(c?.orderCode || '').trim());
  const products = (pivotData?.rows || []).filter(r => /중국/i.test(String(r?.country || '')));
  return (packingRows || []).map(row => {
    const customer = customers.find(c => normalizeChinaText(c.orderCode) === normalizeChinaText(row.customerCode));
    const ranked = products
      .map(product => ({ product, score: productMatchScore(row.sourceItemName, product) }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.prodKey) - Number(b.product.prodKey));
    const product = ranked[0]?.product || null;
    const ambiguous = ranked.length > 1 && ranked[0].score === ranked[1].score;
    return {
      ...row,
      customer: customer || null,
      product: ambiguous ? null : product,
      mappingStatus: !customer ? 'CUSTOMER_UNMATCHED' : (!product || ambiguous ? 'PRODUCT_UNMATCHED' : 'MATCHED'),
      cellKey: customer && product && !ambiguous ? `${customer.custKey}:${product.prodKey}` : '',
    };
  });
}

export function mergeChinaCellAllocations(matchedRows) {
  const cells = {};
  for (const row of matchedRows || []) {
    if (row.mappingStatus !== 'MATCHED' || !row.cellKey) continue;
    const current = cells[row.cellKey] || { quantity: 0, allocations: [], sourceRows: [] };
    current.quantity += Number(row.quantity || 0);
    current.allocations.push(...(row.allocations || []).map(allocation => ({
      boxNo: String(allocation.boxNo),
      quantity: Number(allocation.quantity || 0),
    })));
    current.sourceRows.push(row.sourceRow);
    cells[row.cellKey] = current;
  }
  return cells;
}

export function mergeChinaPackingIntoPivotCells(matchedRows, pivotData) {
  const automatic = mergeChinaCellAllocations(matchedRows);
  const rowsByKey = new Map((pivotData?.rows || []).map(row => [Number(row.prodKey), row]));
  const customersByKey = new Map((pivotData?.customers || []).map(customer => [Number(customer.custKey), customer]));
  return Object.fromEntries(Object.entries(automatic).map(([cellKey, cell]) => {
    const [custKeyRaw, prodKeyRaw] = cellKey.split(':');
    const customer = customersByKey.get(Number(custKeyRaw));
    const product = rowsByKey.get(Number(prodKeyRaw));
    const pivotQuantity = Number(product?.outOrders?.[customer?.custName] || 0);
    return [cellKey, { ...cell, packingQuantity: cell.quantity, quantity: pivotQuantity }];
  }));
}

export function validateChinaCellAllocation(cell) {
  const quantity = Number(cell?.quantity || 0);
  const allocated = (cell?.allocations || []).reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
  const difference = Math.round((quantity - allocated) * 1000) / 1000;
  return {
    quantity,
    allocated,
    difference,
    valid: quantity >= 0 && (cell?.allocations || []).every(item => String(item?.boxNo || '').trim() && Number(item?.quantity || 0) >= 0) && Math.abs(difference) < 0.001,
  };
}
