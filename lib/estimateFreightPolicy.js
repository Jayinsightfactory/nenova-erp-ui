const FREIGHT_WORDS = ['운송료', '운송비', '항공료', '항공비', 'freight', 'air freight', 'shipping', 'service fee', '현지상차운임'];

export const FREIGHT_ROUNDING = Object.freeze({
  CEIL: 'CEIL',
  FLOOR: 'FLOOR',
  EXACT: 'EXACT',
});

export function isFreightRow(row) {
  const name = String(row?.ProdName || '').trim().toLowerCase();
  return FREIGHT_WORDS.some(word => name.includes(word));
}

export function freightKind(row) {
  const name = String(row?.ProdName || '');
  return name.includes('현지상차운임') ? 'LOADING' : 'TRANSPORT';
}

export function boxEquivalent(row) {
  const direct = Number(row?.BoxQty ?? row?.RawBoxQuantity ?? 0);
  if (Number.isFinite(direct) && direct !== 0) return direct;
  const qty = Number(row?.Quantity || 0);
  if (!Number.isFinite(qty)) return 0;
  if (String(row?.Unit || '') === '박스') return qty;
  const perBox = Number(row?.BunchesPerBox || row?.SteamsPerBox || 0);
  if (perBox > 0) return qty / perBox;
  return 0;
}

export function roundBoxes(value, policy = FREIGHT_ROUNDING.CEIL) {
  const n = Math.max(0, Number(value) || 0);
  if (policy === FREIGHT_ROUNDING.FLOOR) return Math.floor(n);
  if (policy === FREIGHT_ROUNDING.EXACT) return Number(n.toFixed(4));
  return Math.ceil(n);
}

function weekOf(row) {
  return String(row?.OrderWeek || row?.week || '').trim();
}

function categoryOf(row) {
  const country = String(row?.CountryFlower || '').trim();
  const flower = String(row?.FlowerName || '').trim();
  return country && flower ? `${country} ${flower}` : (country || flower || '기타');
}

export function buildFreightPreview(items = [], options = {}) {
  const rounding = options.rounding || FREIGHT_ROUNDING.CEIL;
  const aggregate = options.aggregate !== false;
  const unitPrice = Number(options.unitPrice || 0);
  const transportUnitPrice = Number(options.transportUnitPrice ?? unitPrice);
  const loadingUnitPrice = Number(options.loadingUnitPrice ?? unitPrice);
  const normalRows = items.filter(row => !isFreightRow(row) && Number(row?.Quantity || 0) > 0);
  const existing = items.filter(isFreightRow).map(row => ({
    kind: freightKind(row), name: row.ProdName, quantity: Number(row.Quantity || 0),
    unitPrice: Number(row.Cost || 0), week: weekOf(row), category: categoryOf(row),
  }));
  const byWeek = new Map();
  for (const row of normalRows) {
    const key = aggregate ? '합산' : (weekOf(row) || '차수 미상');
    const item = byWeek.get(key) || { key, rawBoxes: 0, categories: new Map() };
    const boxes = boxEquivalent(row);
    item.rawBoxes += boxes;
    const cat = categoryOf(row);
    item.categories.set(cat, (item.categories.get(cat) || 0) + boxes);
    byWeek.set(key, item);
  }
  const rows = [...byWeek.values()].map(item => {
    const boxes = roundBoxes(item.rawBoxes, rounding);
    return {
      key: item.key, rawBoxes: Number(item.rawBoxes.toFixed(4)), boxes,
      loadingAmount: boxes * loadingUnitPrice,
      transportAmount: boxes * transportUnitPrice,
      categories: [...item.categories.entries()].map(([category, raw]) => ({
        category, rawBoxes: Number(raw.toFixed(4)), boxes: roundBoxes(raw, rounding),
      })),
    };
  });
  return {
    rounding, aggregate, rows, existing,
    totalRawBoxes: Number(rows.reduce((sum, row) => sum + row.rawBoxes, 0).toFixed(4)),
    totalBoxes: rows.reduce((sum, row) => sum + row.boxes, 0),
    loadingUnitPrice, transportUnitPrice,
    totalLoadingAmount: rows.reduce((sum, row) => sum + row.loadingAmount, 0),
    totalTransportAmount: rows.reduce((sum, row) => sum + row.transportAmount, 0),
  };
}

