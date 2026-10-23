const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx-js-style');

// Evaluate only the SUM/reference arithmetic emitted here. XLSX preserves formulas
// and cached values but does not calculate edited workbooks itself.
function evaluate(ws, address, visiting = new Set()) {
  assert.ok(!visiting.has(address), `circular formula at ${address}`);
  const cell = ws[address];
  if (!cell?.f) return typeof cell?.v === 'number' ? cell.v : 0;
  const next = new Set(visiting).add(address);
  const expression = cell.f.replace(/SUM\(([A-Z]+\d+)(?::([A-Z]+\d+))?\)/g, (_, start, end) => {
    if (!end) return String(evaluate(ws, start, next));
    const range = XLSX.utils.decode_range(`${start}:${end}`);
    let total = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) total += evaluate(ws, XLSX.utils.encode_cell({ r, c }), next);
    }
    return String(total);
  });
  assert.match(expression, /^[\d.()+\-]+$/, `unsupported formula ${cell.f}`);
  return vm.runInNewContext(expression);
}

function roundtrip(ws) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '물량표');
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    type: 'buffer', cellNF: true,
  }).Sheets['물량표'];
}

async function main() {
  const context = { XLSX, getFarmDisplayName: name => name, customerDisplayLabel: c => c.custName };
  for (const name of ['pivotVolumeRows', 'pivotVolumeCombinedCells', 'pivotVolumeProductLabel',
    'pivotCustomerQuantity', 'pivotVolumeNetherlands', 'pivotVolumeCustDays', 'productColor']) {
    Object.assign(context, await import(`../lib/${name}.js`));
  }
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/stats/pivot-volume-excel.js'), 'utf8')
    .split('export default withAuth')[0].replace(/^import[\s\S]*?;\r?\n/gm, '');
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.generate = makeSheet; this.plan = makeColumnPlan;`, context);
  const customer = { custName: 'Customer', custKey: 10, orderCode: 'CL10', area: '서울' };
  const makeRow = (prodKey, incoming, outbound, country) => ({
    prodKey, prodName: `Rose ${prodKey}`, flower: '장미', country,
    incoming: { Farm: incoming }, orders: { Customer: outbound },
    ordersByCustKey: { 10: outbound }, curStock: 9999, prevStock: 8888,
  });

  for (const country of ['콜롬비아', '네덜란드', '중국']) {
    const rows = [makeRow(1, 12.5, 10, country), makeRow(2, 1.25, 3.75, country), makeRow(3, 0, 0, country)];
    const meta = { country, flower: '장미', weekLabel: '41-01', orderYear: 2026 };
    const plan = context.plan(rows, [customer], ['Farm'], meta);
    const columns = Object.fromEntries(plan.map((col, index) => [col.type === 'summary' ? col.label : '', index]));
    const cellAt = (label, row) => XLSX.utils.encode_cell({ r: row - 1, c: columns[label] });
    const start = country === '중국' ? 5 : 4;
    const total = start + rows.length;
    const original = context.generate(rows, [customer], ['Farm'], meta).ws;
    assert.equal(original['!freeze'].ySplit, start - 1);
    if (country === '중국') assert.equal(original.A4.v, '클라이언트 번호');
    if (country === '네덜란드') assert.equal(original.C3.v, '칼라');
    const back = roundtrip(original);
    for (const ws of [original, back]) {
      rows.forEach((row, index) => {
        const excelRow = start + index;
        const remain = cellAt('잔량', excelRow);
        assert.equal(ws[cellAt('재고', excelRow)]?.v ?? '', '', 'manual stock starts blank, not an ERP snapshot');
        assert.equal(ws[cellAt('재고', excelRow)]?.f, undefined);
        assert.equal(ws[remain].f, `SUM(${cellAt('입고', excelRow)})-SUM(${cellAt('주문', excelRow)})+SUM(${cellAt('재고', excelRow)})`);
        assert.equal(ws[remain].v, [2.5, -2.5, 0][index]);
        assert.equal(evaluate(ws, remain), ws[remain].v);
      });
      const totalAddress = cellAt('잔량', total);
      assert.equal(ws[totalAddress].f, `SUM(${cellAt('잔량', start)}:${cellAt('잔량', total - 1)})`);
      assert.equal(ws[totalAddress].v, 0, 'zero cached total must retain its SUM formula');
      for (const [index, input] of [0, -3.25, 4.5].entries()) {
        ws[cellAt('재고', start + index)] = { t: 'n', v: input };
      }
      assert.equal(evaluate(ws, cellAt('잔량', start)), 2.5);
      assert.equal(evaluate(ws, cellAt('잔량', start + 1)), -5.75);
      assert.equal(evaluate(ws, cellAt('잔량', start + 2)), 4.5);
      assert.equal(evaluate(ws, totalAddress), 1.25);
      // Editing the existing displayed incoming/outbound cells feeds the same formula.
      ws[cellAt('입고', start)] = { t: 'n', v: 20.25 };
      ws[cellAt('주문', start)] = { t: 'n', v: 4.5 };
      assert.equal(evaluate(ws, cellAt('잔량', start)), 15.75);
    }
    assert.equal(roundtrip(back)[cellAt('재고', start + 1)].v, -3.25, 'manual numeric edits survive XLSX');
  }

  // No-customer input-only sheets still reference a numeric zero outbound summary.
  for (const country of ['콜롬비아', '네덜란드', '중국']) {
    const rows = [makeRow(1, 5.5, 0, country)];
    const meta = { country, flower: '장미', weekLabel: '41-01' };
    const plan = context.plan(rows, [], ['Farm'], meta);
    const first = country === '중국' ? 5 : 4;
    const ws = roundtrip(context.generate(rows, [], ['Farm'], meta).ws);
    const remainCol = plan.findIndex(col => col.label === '잔량');
    assert.equal(evaluate(ws, XLSX.utils.encode_cell({ r: first - 1, c: remainCol })), 5.5);
  }

  // Same business keys/week in another year cannot supply the downloaded cache.
  const fixture = [2025, 2026].map(year => ({
    orderYear: year, orderWeek: '41-01', row: makeRow(7, year === 2025 ? 700 : 12, 2, '콜롬비아'),
  }));
  for (const selectedYear of [2025, 2026]) {
    const selected = fixture.filter(entry => entry.orderYear === selectedYear).map(entry => entry.row);
    const ws = roundtrip(context.generate(selected, [customer], ['Farm'], {
      country: '콜롬비아', flower: '장미', weekLabel: '41-01', orderYear: selectedYear,
    }).ws);
    assert.equal(ws.F4.v, selectedYear === 2025 ? 698 : 10);
    assert.equal(evaluate(ws, 'F4'), ws.F4.v);
  }
  console.log('pivot volume remaining: actual sheets, XLSX readback, manual stock, zero/negative/decimal, country layouts, no customer and cross-year fixtures passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
