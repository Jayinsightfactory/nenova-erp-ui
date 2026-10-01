export const varietyKey = row => JSON.stringify([row.country || '', row.flower || '']);
export function moveFarmWeek(value, delta) {
  const match = /^(\d{4})-(\d{2})-(0[1-4])$/.exec(value || '');
  if (!match || +match[2] < 1 || +match[2] > 52) return null;
  const index = (+match[1] * 52 + +match[2] - 1) * 4 + +match[3] - 1 + delta;
  const year = Math.floor(index / 208), week = Math.floor((index % 208) / 4) + 1, sub = index % 4 + 1;
  if (year < 2020 || year > 2099) return null;
  return `${year}-${String(week).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
}
export function buildFarmWeekBoard(source, { orderYear, orderWeek }) {
  const rows = new Map();
  for (const r of source) {
    if (String(r.orderYear) !== String(orderYear) || r.orderWeek !== orderWeek) continue;
    const quantity = Number(r.quantity);
    if (!Number.isFinite(quantity)) throw new Error('수량 확인 필요');
    const key = Number(r.prodKey);
    if (!rows.has(key)) rows.set(key, { prodKey:key, prodName:r.prodName, country:r.country || '', flower:r.flower || '', unit:r.unit || '단위 미지정', incoming:{}, order:0, distribution:0, adjustment:0, received:0 });
    const row = rows.get(key);
    if (r.kind === 'incoming') {
      const farm = String(r.farm || '').trim() || '농장 미지정';
      row.incoming[farm] = (row.incoming[farm] || 0) + quantity;
      row.received += quantity;
    } else if (['order','distribution','adjustment'].includes(r.kind)) row[r.kind] += quantity;
  }
  return [...rows.values()].sort((a,b) => a.prodName.localeCompare(b.prodName, 'ko'));
}
export function summarizeFarmRows(rows) {
  const byUnit = new Map();
  for (const r of rows) {
    if (!byUnit.has(r.unit)) byUnit.set(r.unit, { unit:r.unit, received:0, order:0, distribution:0, adjustment:0, incoming:{} });
    const total = byUnit.get(r.unit);
    for (const key of ['received','order','distribution','adjustment']) total[key] += r[key];
    for (const [farm, qty] of Object.entries(r.incoming)) total.incoming[farm] = (total.incoming[farm] || 0) + qty;
  }
  return [...byUnit.values()];
}
