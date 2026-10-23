import { chinaOrderQuantity, chinaPackingDistributions, mergeChinaPackingIntoPivotCells } from './chinaVolumeBoard.js';

export function chinaEditableCustomers(customers, visibleKeys, areas = {}, days = {}) {
  return customers.filter(c => visibleKeys.has(String(c.custKey)))
    .map(c => ({ ...c, area: areas[c.custKey] ?? c.area ?? '기타' }))
    .sort((a,b) => String(a.area).localeCompare(String(b.area), 'ko') || String(days[a.custKey] || '').localeCompare(String(days[b.custKey] || '')) || a.custName.localeCompare(b.custName, 'ko'));
}

export function chinaDistributionEntries(cells, products, customers) {
  const entries = [];
  for (const [key, cell] of Object.entries(cells)) {
    const [custKey, prodKey] = key.split(':').map(Number);
    const product = products.find(p => Number(p.prodKey) === prodKey);
    const customer = customers.find(c => Number(c.custKey) === custKey);
    const quantity = cell.quantity === '' ? 0 : Number(cell.quantity);
    if (!product || !customer || !product.unit || !Number.isFinite(quantity) || quantity < 0) throw new Error('품목·업체 매칭과 0 이상 수량을 확인하세요.');
    entries.push({ id: key, custKey, prodKey, product: product.prodName, customer: customer.custName, quantity, unit: product.unit });
  }
  if (!entries.length) throw new Error('분배할 수량을 입력하거나 인보이스 매칭을 적용하세요.');
  return entries;
}

// Rematching affects the draft only. Old explicit zero cells remain in the
// save payload so previously distributed quantities are actually cancelled.
export function remapChinaProduct({ cells, oldProduct, newProduct, customers }) {
  if (Number(oldProduct.prodKey) === Number(newProduct.prodKey)) return cells;
  if (oldProduct.unit !== newProduct.unit) throw new Error('단위가 다른 품목으로 변경할 수 없습니다. 새 품목을 추가하고 각 수량을 직접 입력하세요.');
  const next = { ...cells };
  for (const customer of customers) {
    const oldKey = `${customer.custKey}:${oldProduct.prodKey}`;
    const newKey = `${customer.custKey}:${newProduct.prodKey}`;
    const qty = Number(cells[oldKey]?.quantity ?? chinaOrderQuantity(oldProduct, customer));
    if (!Number.isFinite(qty) || qty < 0) throw new Error('기존 수량을 확인하세요.');
    if (!qty && !cells[oldKey]) continue;
    const target = Number(cells[newKey]?.quantity ?? chinaOrderQuantity(newProduct, customer));
    next[oldKey] = { ...cells[oldKey], quantity: 0, quantityEdited: true, allocations: [], boxNumbers: [] };
    next[newKey] = { ...cells[newKey], quantity: target + qty, quantityEdited: true,
      boxNumbers: [...new Set([...(cells[newKey]?.boxNumbers || []), ...(cells[oldKey]?.boxNumbers || [])])],
      allocations: [...(cells[newKey]?.allocations || []), ...(cells[oldKey]?.allocations || [])] };
  }
  return next;
}

export function applyChinaInvoiceCells(previous, packingRows, pivotData) {
  const next = { ...previous };
  // Clear obsolete imported keys on rematch/split, but retain deliberate edits.
  for (const [key, cell] of Object.entries(next)) {
    if ((cell.sourceRows?.length || cell.packingQuantity != null) && !cell.quantityEdited) {
      next[key] = { ...cell, quantity: 0, packingQuantity: 0, allocations: [], sourceRows: [] };
    }
  }
  for (const [key, cell] of Object.entries(mergeChinaPackingIntoPivotCells(packingRows, pivotData))) {
    next[key] = { ...cell, ...(previous[key]?.quantityEdited ? { ...previous[key], packingQuantity: cell.packingQuantity } : {}) };
  }
  return next;
}

export function chinaProductDifferences(rows, customers, packingRows, products = rows) {
  const map = new Map();
  const ensure = product => {
    const key = String(product.prodKey);
    if (!map.has(key)) map.set(key, { prodKey: product.prodKey, name: product.prodName, unit: product.unit, order: 0, received: 0 });
    return map.get(key);
  };
  for (const row of rows) ensure(row).order = customers.reduce((sum,c) => sum + chinaOrderQuantity(row,c), 0);
  for (const row of packingRows) {
    if (row.mappingStatus !== 'MATCHED') continue;
    for (const dist of chinaPackingDistributions(row)) {
      const prodKey = Number(dist.cellKey.split(':')[1]);
      const product = products.find(p => Number(p.prodKey) === prodKey);
      if (product) ensure(product).received += Number(dist.quantity || 0);
    }
  }
  return [...map.values()].map(item => ({ ...item, difference: Math.round((item.received - item.order) * 1000) / 1000 }))
    .filter(item => Math.abs(item.difference) >= 0.001);
}
