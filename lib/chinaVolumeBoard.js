const BOX_RANGE_RE = /(\d+)\s*[-~]\s*(\d+)/g;

export function normalizeChinaText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(no|box|rose|carnation|hydrangea|cm)\.?\b/gi, ' ')
    .replace(/[()（）\[\]{}\/\\._-]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

export function chinaVolumeProductLabel(value) {
  return String(value || '').replace(/^\s*china\s*\/\s*/i, '').trim();
}

export function chinaVolumeCellText(quantity, allocations = []) {
  const qty = Number(quantity || 0);
  const quantityText = Number.isInteger(qty) ? String(qty) : qty.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
  const boxText = allocations.map(item => String(item?.boxNo || '').trim()).filter(Boolean).join(',');
  return boxText ? `${quantityText} (${boxText})` : (qty > 0 ? quantityText : '');
}

export function buildChinaVolumeWorkbookRows({ year, week, rows = [], customers = [], cells = {} }) {
  return [
    [`${year}년 ${week} 중국 물량표`, ...customers.map(customer => customer.custName)],
    ['품목', ...customers.map(customer => customer.orderCode || '')],
    ...rows.map(row => [
      chinaVolumeProductLabel(row.prodName),
      ...customers.map(customer => {
        const saved = cells[`${customer.custKey}:${row.prodKey}`];
        const quantity = saved?.quantity ?? Number(row.outOrders?.[customer.custName] || 0);
        return chinaVolumeCellText(quantity, saved?.allocations || []);
      }),
    ]),
  ];
}

export function planChinaBoxNeighborAreas({ rows = [], customers = [], cells = {} }) {
  const claimed = new Set();
  const result = {};
  const keyAt = (rowIndex, columnIndex) => `${customers[columnIndex]?.custKey}:${rows[rowIndex]?.prodKey}`;
  const isEmpty = (rowIndex, columnIndex) => {
    if (rowIndex < 0 || columnIndex < 0 || rowIndex >= rows.length || columnIndex >= customers.length) return false;
    const key = keyAt(rowIndex, columnIndex);
    const saved = cells[key];
    const quantity = saved?.quantity ?? Number(rows[rowIndex]?.outOrders?.[customers[columnIndex]?.custName] || 0);
    return Number(quantity || 0) === 0 && !(saved?.allocations || []).length && !claimed.has(key);
  };
  rows.forEach((row, rowIndex) => customers.forEach((customer, columnIndex) => {
    const key = `${customer.custKey}:${row.prodKey}`;
    if (!(cells[key]?.allocations || []).length) return;
    const candidates = [
      ['right', rowIndex, columnIndex + 1],
      ['left', rowIndex, columnIndex - 1],
      ['down', rowIndex + 1, columnIndex],
      ['up', rowIndex - 1, columnIndex],
    ];
    const selected = candidates.find(([, r, c]) => isEmpty(r, c));
    result[key] = selected?.[0] || 'self';
    if (selected) claimed.add(keyAt(selected[1], selected[2]));
  }));
  return result;
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

const CHINA_TOTAL_EPSILON = 0.001;

function roundedChinaTotal(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

/**
 * 업로드 원장·피벗 표시·박스 배정의 누락을 화면에서 진단하기 위한 순수 집계 함수.
 * 피벗과 패킹의 차이는 선출고/잔량 때문에 정상일 수 있으므로 참고값이며,
 * 상태 판정은 미매칭과 품목별 패킹↔박스 배정 차이만 사용한다.
 */
export function summarizeChinaVolumeTotals({ pivotData, packingRows = [], cells = {} } = {}) {
  const rows = (pivotData?.rows || []).filter(row => /중국/i.test(String(row?.country || '')));
  const customers = pivotData?.customers || [];
  const rowByKey = new Map(rows.map(row => [Number(row.prodKey), row]));
  const customerByKey = new Map(customers.map(customer => [Number(customer.custKey), customer]));
  const pivotByCell = {};
  let pivotTotal = 0;
  for (const row of rows) {
    for (const customer of customers) {
      const raw = row?.outOrders?.[customer.custName] ?? row?.outOrders?.[customer.orderCode];
      const quantity = Number(raw || 0);
      if (!Number.isFinite(quantity)) continue;
      const key = `${customer.custKey}:${row.prodKey}`;
      pivotByCell[key] = roundedChinaTotal(quantity);
      pivotTotal += quantity;
    }
  }

  const packingByCell = {};
  let packingTotal = 0;
  let matchedPackingTotal = 0;
  let unmatchedPackingTotal = 0;
  let matchedRowCount = 0;
  let unmatchedRowCount = 0;
  for (const packingRow of packingRows || []) {
    const quantity = Number(packingRow?.quantity || 0);
    if (!Number.isFinite(quantity)) continue;
    packingTotal += quantity;
    if (packingRow?.mappingStatus === 'MATCHED' && packingRow?.cellKey) {
      matchedRowCount += 1;
      matchedPackingTotal += quantity;
      packingByCell[packingRow.cellKey] = roundedChinaTotal((packingByCell[packingRow.cellKey] || 0) + quantity);
    } else {
      unmatchedRowCount += 1;
      unmatchedPackingTotal += quantity;
    }
  }

  const cellKeys = new Set([...Object.keys(pivotByCell), ...Object.keys(packingByCell), ...Object.keys(cells || {})]);
  const mismatches = [];
  const unitTotals = {};
  const addUnitTotal = (cellKey, field, value) => {
    const prodKey = Number(String(cellKey).split(':')[1]);
    const product = rowByKey.get(prodKey);
    const unit = String(product?.unit || product?.outUnit || '단위미상').trim() || '단위미상';
    unitTotals[unit] ||= { unit, pivot: 0, packing: 0, board: 0, allocated: 0 };
    unitTotals[unit][field] = roundedChinaTotal(unitTotals[unit][field] + Number(value || 0));
  };
  let allocationTotal = 0;
  let boardTotal = 0;
  for (const cellKey of cellKeys) {
    const saved = cells?.[cellKey] || {};
    const packingQuantity = roundedChinaTotal(packingByCell[cellKey] || 0);
    const boardQuantity = roundedChinaTotal(saved.quantity ?? pivotByCell[cellKey] ?? 0);
    const allocatedQuantity = roundedChinaTotal((saved.allocations || []).reduce((sum, item) => sum + Number(item?.quantity || 0), 0));
    const allocationDifference = roundedChinaTotal(packingQuantity - allocatedQuantity);
    const boardDifference = roundedChinaTotal(boardQuantity - (pivotByCell[cellKey] || 0));
    const boardAllocationDifference = roundedChinaTotal(boardQuantity - allocatedQuantity);
    allocationTotal += allocatedQuantity;
    boardTotal += boardQuantity;
    addUnitTotal(cellKey, 'pivot', pivotByCell[cellKey] || 0);
    addUnitTotal(cellKey, 'packing', packingQuantity);
    addUnitTotal(cellKey, 'board', boardQuantity);
    addUnitTotal(cellKey, 'allocated', allocatedQuantity);
    if (Math.abs(allocationDifference) >= CHINA_TOTAL_EPSILON || Math.abs(boardAllocationDifference) >= CHINA_TOTAL_EPSILON) {
      const [custKeyRaw, prodKeyRaw] = cellKey.split(':');
      const customer = customerByKey.get(Number(custKeyRaw));
      const product = rowByKey.get(Number(prodKeyRaw));
      mismatches.push({
        cellKey,
        customerName: customer?.custName || '',
        productName: product?.prodName || '',
        pivotQuantity: roundedChinaTotal(pivotByCell[cellKey] || 0),
        packingQuantity,
        allocatedQuantity,
        boardQuantity,
        allocationDifference,
        boardAllocationDifference,
        boardDifference,
      });
    }
  }

  const difference = roundedChinaTotal(packingTotal - (matchedPackingTotal + unmatchedPackingTotal));
  const status = Math.abs(difference) >= CHINA_TOTAL_EPSILON || unmatchedRowCount > 0 || mismatches.length > 0
    ? 'WARNING'
    : 'OK';
  return {
    pivotTotal: roundedChinaTotal(pivotTotal),
    boardTotal: roundedChinaTotal(boardTotal),
    packingTotal: roundedChinaTotal(packingTotal),
    matchedPackingTotal: roundedChinaTotal(matchedPackingTotal),
    unmatchedPackingTotal: roundedChinaTotal(unmatchedPackingTotal),
    allocationTotal: roundedChinaTotal(allocationTotal),
    boardAllocationDifference: roundedChinaTotal(boardTotal - allocationTotal),
    difference,
    pivotVsPackingDifference: roundedChinaTotal(pivotTotal - packingTotal),
    matchedRowCount,
    unmatchedRowCount,
    mismatches,
    unitTotals: Object.values(unitTotals),
    status,
  };
}
