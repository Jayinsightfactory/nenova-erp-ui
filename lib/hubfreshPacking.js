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
  return { invoice, ...groups };
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
