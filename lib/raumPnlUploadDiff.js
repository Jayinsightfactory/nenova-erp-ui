const n = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const round = value => Math.round(n(value) * 100) / 100;

function aggregate(items) {
  const grouped = new Map();
  for (const item of items || []) {
    const key = [
      text(item.name), n(item.price).toFixed(2), String(item.unit || ''),
      item.consigned ? 'S' : 'N', item.isImageRow ? 'I' : 'N',
    ].join('|');
    const row = grouped.get(key) || {
      name: String(item.name || ''), unit: String(item.unit || ''), price: n(item.price), qty: 0, supply: 0,
    };
    row.qty += n(item.qty);
    row.supply += n(item.supply);
    grouped.set(key, row);
  }
  return grouped;
}

/** 같은 연도·대차수의 기존 웹 결산과 새 견적 원본을 품목·단가·단위별로 비교한다. */
export function diffRaumPnlUpload(existing, uploaded) {
  const before = aggregate(existing);
  const after = aggregate(uploaded);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, oldItem] of before) {
    const newItem = after.get(key);
    if (!newItem) {
      removed.push({ ...oldItem, qty: round(oldItem.qty), supply: round(oldItem.supply) });
      continue;
    }
    const qtyDiff = round(newItem.qty - oldItem.qty);
    const supplyDiff = round(newItem.supply - oldItem.supply);
    if (qtyDiff !== 0 || supplyDiff !== 0) {
      changed.push({
        name: newItem.name, unit: newItem.unit, price: newItem.price,
        beforeQty: round(oldItem.qty), afterQty: round(newItem.qty), qtyDiff,
        beforeSupply: round(oldItem.supply), afterSupply: round(newItem.supply), supplyDiff,
      });
    }
  }
  for (const [key, newItem] of after) {
    if (!before.has(key)) added.push({ ...newItem, qty: round(newItem.qty), supply: round(newItem.supply) });
  }

  const sum = (rows, field) => [...rows.values()].reduce((total, item) => total + item[field], 0);
  const counts = {
    existingItemCount: before.size,
    uploadItemCount: after.size,
    existingRowCount: (existing || []).length,
    uploadRowCount: (uploaded || []).length,
    qtyDelta: round(sum(after, 'qty') - sum(before, 'qty')),
    supplyDelta: round(sum(after, 'supply') - sum(before, 'supply')),
  };
  return {
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0 || counts.existingRowCount !== counts.uploadRowCount,
    added, removed, changed, counts,
  };
}
