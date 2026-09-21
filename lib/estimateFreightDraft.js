import { isFreightRow, roundBoxes } from './estimateFreightPolicy.js';

export function freightRowBoxes(row) {
  const dateRow = row.SdateKey != null;
  if (dateRow && (row.DateShipQty == null || row.DateShipQty === '')) return null;
  const qty = Number(dateRow ? row.DateShipQty : row.Quantity);
  const unit = dateRow ? row.OutUnit : row.Unit;
  if (!Number.isFinite(qty)) return null;
  if (qty <= 0) return 0;
  if (unit === '박스') return qty;
  const perBox = Number(unit === '단' ? row.BunchOf1Box : unit === '송이' ? row.SteamOf1Box : 0);
  if (perBox > 0) return qty / perBox;
  if (!dateRow && Number(row.BoxQty) > 0) return Number(row.BoxQty);
  return null;
}

export function freightSourceRows(items, year, parentWeek) {
  const prefix = `${String(parentWeek).padStart(2, '0')}-`;
  return items.filter(row => !isFreightRow(row) && !row.EstimateKey && Number(row.Quantity) > 0)
    .map((row, index) => {
      const week = String(row.OrderWeek || '');
      const valid = /^\d{2}-\d{2}$/.test(week) && week.startsWith(prefix)
        && (!row.OrderYear || String(row.OrderYear) === String(year));
      return { ...row, sourceKey: `${row.SdateKey || row.SdetailKey || 'row'}:${index}`,
        boxes: valid ? freightRowBoxes(row) : null,
        scopeError: valid ? '' : '차수 확인 필요' };
    });
}

export function buildFreightDraftRows(sources, products, rounding) {
  const groups = new Map();
  for (const row of sources) {
    if (row.boxes == null || row.boxes <= 0) continue;
    const country = String(row.CounName || '');
    const category = ['중국', '태국'].includes(country) ? country : String(row.FlowerName || country);
    for (const name of ['현지상차운임', `${category} 운송료`]) {
      const key = `${row.OrderWeek}|${row.outDate}|${name}`;
      const group = groups.get(key) || { key, weekShort: row.OrderWeek, shipmentDate: row.outDate, name, rawBoxes: 0 };
      group.rawBoxes += row.boxes;
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(row => {
    const matches = products.filter(p => String(p.ProdName || '').trim() === row.name);
    return { ...row, qty: roundBoxes(row.rawBoxes, rounding), prodKey: matches.length === 1 ? matches[0].ProdKey : '' };
  });
}

export function validateFreightDraft(rows, { year, parentWeek, custKey, products }) {
  if (!/^\d{4}$/.test(String(year)) || !(Number(custKey) > 0)) throw new Error('연도와 업체를 확인하세요.');
  const seen = new Set();
  if (!rows.length) throw new Error('등록할 운임을 선택하세요.');
  return rows.map(row => {
    if (!new RegExp(`^${String(parentWeek).padStart(2, '0')}-\\d{2}$`).test(row.weekShort)) throw new Error('선택 견적서와 운임 차수가 다릅니다.');
    const product = products.find(p => Number(p.ProdKey) === Number(row.prodKey));
    if (!product || !isFreightRow(product) || product.OutUnit !== '박스') throw new Error(`${row.name}: 박스 단위 운임 품목을 선택하세요.`);
    if (!(Number(row.qty) > 0) || !(Number(row.cost) > 0) || !Number.isFinite(Number(row.qty)) || !Number.isFinite(Number(row.cost))) throw new Error(`${row.name}: 수량과 단가는 0보다 커야 합니다.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.shipmentDate))) throw new Error(`${row.name}: 출고일을 확인하세요.`);
    const key = `${row.weekShort}|${row.prodKey}`;
    if (seen.has(key)) throw new Error(`${row.weekShort} ${product.ProdName}: 같은 운임이 여러 출고일에 있습니다. 한 출고일씩 등록하세요.`);
    seen.add(key);
    return { ...row, prodName: product.ProdName, prodKey: Number(product.ProdKey), qty: Number(row.qty), cost: Number(row.cost),
      custKey: Number(custKey), week: `${year}-${row.weekShort}`, unit: '박스', costSourceId: 'DIRECT', freight: true };
  });
}

export function additionalCycleWeek(row, year, parentWeek) {
  const short = String(row.weekShort || String(row.week || '').replace(/^\d{4}-/, ''));
  if (row.week && /^\d{4}-/.test(row.week) && !row.week.startsWith(`${year}-`)) throw new Error('추가 품목 연도가 다릅니다.');
  if (row.week && String(row.week).replace(/^\d{4}-/, '') !== short) throw new Error('추가 품목 표시 차수와 등록 차수가 다릅니다.');
  if (!new RegExp(`^${String(parentWeek).padStart(2, '0')}-\\d{2}$`).test(short)) throw new Error('추가 품목 차수가 다릅니다.');
  return short;
}
