import { parseWarehousePackingGrid } from './warehousePackingImport.js';

const text = value => String(value ?? '').trim();
const fields = {
  name: /English name/i, chinese: /Chinese name/i, code: /Customer Code/i, carton: /Ctn No/i,
  item: /Code\s*$/i, length: /Length/i, spec: /Specification/i, boxSize: /Box specifications/i,
  boxes: /Order Quantit/i, bunches: /Total of bunches/i, stems: /Stems/i,
  price: /UNIT PRICE/i, amount: /AMOUNT/i,
};

export function parseHubfreshInvoice(grid) {
  const index = grid.findIndex(row => Object.entries(fields)
    .filter(([key]) => key !== 'item').every(([, pattern]) => row.some(cell => pattern.test(text(cell)))));
  if (index === -1) throw new Error('HUBFRESH 상세 인보이스의 품목 제목을 찾을 수 없습니다.');
  const header = grid[index];
  const columns = Object.fromEntries(Object.entries(fields).map(([key, pattern]) => [
    key, header.findIndex(cell => pattern.test(text(cell)) && (key !== 'item' || !fields.code.test(text(cell)))),
  ]));
  const heading = grid.slice(0, index).flat().map(text).join(' ');
  const invoice = heading.match(/INVOICE\s+NO[.：:]?\s*([\w-]+)/i)?.[1] || '';
  if (!invoice || !/HUBFRESH/i.test(heading)) throw new Error('HUBFRESH 공급사명과 인보이스 번호를 확인하세요.');
  const groups = { nenova: [], other: [], review: [] };
  const counted = [];
  for (let i = index + 1; i < grid.length; i++) {
    const source = grid[i];
    const get = key => source[columns[key]];
    if ((!text(get('name')) && !text(get('chinese'))) || !text(get('boxes')) || Number(get('boxes')) === 0) continue;
    const row = { source: i + 1 };
    for (const key of Object.keys(fields)) row[key] = text(get(key));
    row.name ||= row.chinese;
    for (const key of ['boxes', 'bunches', 'stems', 'price', 'amount']) {
      row[key] = Number(get(key));
      const freeItem = key === 'price' && text(get('amount')) && Number(get('amount')) === 0;
      if ((!text(get(key)) && !freeItem) || !Number.isFinite(row[key]) || row[key] < 0) {
        throw new Error(`${row.source}행 수량 또는 금액을 확인하세요.`);
      }
    }
    counted.push(row);
    const codes = row.code.split(/[,/;\n]+/).map(text).filter(Boolean);
    const nenova = codes.filter(code => /CL/i.test(code));
    if (!row.carton || !codes.length || (nenova.length && codes.length !== nenova.length)) groups.review.push(row);
    else groups[nenova.length ? 'nenova' : 'other'].push(row);
  }
  if (!counted.length) throw new Error('수량이 있는 품목을 찾을 수 없습니다.');
  const summary = grid.slice(index + 1).find(row => !text(row[columns.name]) && !text(row[columns.chinese]) &&
    text(row[columns.boxes]) && text(row[columns.bunches]) && text(row[columns.stems]) && text(row[columns.amount]));
  if (summary && ['boxes', 'bunches', 'stems', 'amount'].some(key =>
    Math.abs(counted.reduce((sum, row) => sum + row[key], 0) - Number(summary[columns[key]])) > 0.005)) {
    throw new Error('읽은 수량 또는 상품대금이 원본 합계와 다릅니다.');
  }
  const cbmSummary = summarizeHubfreshCbm(groups);
  const charges = parseHubfreshFooterCharges(grid.slice(index + 1));
  return { invoice, ...groups, cbmSummary, charges };
}

export function parseHubfreshBoxCbm(boxSize) {
  const m = String(boxSize ?? '').match(/(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const [l, w, h] = m.slice(1).map(Number);
  if (!(l > 0 && w > 0 && h > 0)) return 0;
  return Math.round((l / 100) * (w / 100) * (h / 100) * 1e9) / 1e9;
}

export function summarizeHubfreshCbm(groups = {}) {
  const sumBoxes = rows => (rows || []).reduce((s, r) => s + (Number(r.boxes) || 0), 0);
  const sumCbm = rows => Math.round((rows || []).reduce((s, r) => s + (Number(r.boxes) || 0) * parseHubfreshBoxCbm(r.boxSize), 0) * 1e6) / 1e6;
  const nenovaBoxes = sumBoxes(groups.nenova), otherBoxes = sumBoxes(groups.other), reviewBoxes = sumBoxes(groups.review);
  const nenovaCbm = sumCbm(groups.nenova), otherCbm = sumCbm(groups.other), reviewCbm = sumCbm(groups.review);
  const totalBoxes = nenovaBoxes + otherBoxes + reviewBoxes;
  const realCbm = Math.round((nenovaCbm + otherCbm + reviewCbm) * 1e6) / 1e6;
  const cbmShare = realCbm > 0 ? Math.round((nenovaCbm / realCbm) * 1e6) / 1e6 : 0;
  return { nenovaBoxes, otherBoxes, reviewBoxes, totalBoxes, nenovaCbm, otherCbm, reviewCbm, realCbm, cbmShare };
}

export function parseHubfreshFooterCharges(rows = []) {
  const charges = {};
  const positiveNums = cells => cells.map(c => Number(String(c ?? '').replace(/,/g, '').trim())).filter(n => Number.isFinite(n) && n > 0);
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const joined = row.map(text).filter(Boolean).join(' ');
    if (!joined) continue;
    const nums = positiveNums(row);
    if (!nums.length) continue;
    if (/phyto|서류/i.test(joined) && charges.docFee == null) {
      charges.docFee = nums.find(n => n >= 100) ?? nums.at(-1);
    } else if (/process\s*cost/i.test(joined) && charges.processBoxes == null) {
      const unit = nums.find(n => n > 0 && n <= 20);
      const qty = nums.find(n => Number.isInteger(n) && n >= 10 && n !== unit);
      if (unit != null) charges.processUnit = unit;
      if (qty != null) charges.processBoxes = qty;
    } else if (/quarantine\s*box|검역\s*박스/i.test(joined) && charges.quarantineBoxes == null) {
      const unit = nums.find(n => n > 0 && n <= 30);
      const qty = nums.find(n => Number.isInteger(n) && n >= 10 && n !== unit);
      if (unit != null) charges.quarantineBoxUnit = unit;
      if (qty != null) charges.quarantineBoxes = qty;
    } else if (/sea\s*freight|logistics\s*fee|해상\s*운임/i.test(joined) && charges.seaFreight == null) {
      charges.seaFreight = nums.find(n => n >= 1000) ?? nums.at(-1);
    } else if (/temperature\s*data\s*logger|data\s*logger|로거/i.test(joined) && charges.logger == null) {
      charges.logger = nums.find(n => n >= 50 && n <= 5000) ?? nums.at(-1);
    } else if (/loading\s*and\s*unloading|상차|하역/i.test(joined) && charges.loading == null) {
      charges.loading = nums.find(n => n >= 100 && n <= 20000) ?? nums.at(-1);
    }
  }
  return charges;
}

export const hubfreshItemKey = row => JSON.stringify([row.item, row.name, row.length, row.spec, row.boxSize]);
export function sumHubfreshRows(rows, packing = false) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([hubfreshItemKey(row), row.price, packing ? [row.code, row.stems / row.bunches, row.stems / row.boxes] : '']);
    if (!groups.has(key)) groups.set(key, {
      ...row, boxes: 0, bunches: 0, stems: 0, amount: 0, cartons: new Set(), codes: new Set(),
    });
    const line = groups.get(key);
    for (const field of ['boxes', 'bunches', 'stems', 'amount']) line[field] += row[field];
    line.cartons.add(row.carton);
    line.codes.add(row.code);
  }
  return [...groups.values()];
}

function optionalPackingMetric(value, label, { nonNegative = false } = {}) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim().replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label} 숫자를 확인하세요.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (nonNegative && parsed < 0)) throw new Error(`${label} 숫자를 확인하세요.`);
  return parsed;
}

export function hubfreshPackingGrid(invoice, rows, names, week, date, extras = {}) {
  if (!/^\d{2}-\d{2}$/.test(week) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('입고 차수와 날짜를 확인하세요.');
  }
  const awb = text(extras?.awb);
  const freight = optionalPackingMetric(extras?.freight, '운송료');
  const gw = optionalPackingMetric(extras?.gw, 'GW', { nonNegative: true });
  const cw = optionalPackingMetric(extras?.cw, 'CW', { nonNegative: true });
  const pseudoRows = [];
  if (freight !== null && freight !== 0) {
    pseudoRows.push(['', '운송료', '', '', '', 1, 1, 1, 1, 1, freight, freight]);
  }
  if (gw !== null && gw > 0) {
    pseudoRows.push(['', 'Gross weight', '', '', '', 1, 1, 1, 1, gw, 0, 0]);
  }
  if (cw !== null && cw > 0) {
    pseudoRows.push(['', 'Chargeable weight', '', '', '', 1, 1, 1, 1, cw, 0, 0]);
  }
  const grid = [
    ['HUBFRESH PACKING LIST'],
    ['Grower:', '', 'HUBFRESH', '', 'Weekend:', '', week, '', 'Invoice:', '', invoice],
    ['AWB:', '', awb, '', 'Date:', '', date],
    [],
    ['COD', 'VARIETY NAME', 'PRODUCT', 'COLOR', 'SIZE', 'BOX', 'STEAM/BUNCH', 'STEAM/BOX', 'TOTAL\nBUNCH', 'TOTALSTEAM', 'U.PRICE', 'T.PRICE'],
    ...sumHubfreshRows(rows, true).map(row => {
      const name = names[hubfreshItemKey(row)];
      if (!name) throw new Error(`ERP 품목을 선택하세요. ${row.name}`);
      const stemsPerBunch = row.stems / row.bunches;
      const stemsPerBox = row.stems / row.boxes;
      return [row.code, name, '', '', '', row.boxes,
        Number.isInteger(stemsPerBunch) ? stemsPerBunch : '',
        Number.isInteger(stemsPerBox) ? stemsPerBox : '', row.bunches, row.stems, row.price, row.amount];
    }),
    ...pseudoRows,
  ];
  parseWarehousePackingGrid(grid);
  return grid;
}
