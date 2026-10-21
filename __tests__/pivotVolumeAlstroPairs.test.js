const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const XLSX = require('xlsx-js-style');

async function main() {
  const context = { XLSX, getFarmDisplayName: x => x, customerDisplayLabel: c => c.custName };
  for (const name of ['pivotVolumeRows', 'pivotVolumeCombinedCells', 'pivotVolumeProductLabel',
    'pivotCustomerQuantity', 'pivotVolumeNetherlands', 'pivotVolumeCustDays']) {
    Object.assign(context, await import(`../lib/${name}.js`));
  }
  const source = fs.readFileSync('pages/api/stats/pivot-volume-excel.js', 'utf8')
    .split('export default withAuth')[0].replace(/^import[\s\S]*?;\r?\n/gm, '');
  vm.createContext(context);
  vm.runInContext(source + '\nthis.generate = makeSheet;', context);
  // Only parse functions; DB/write dependencies cannot execute in this fixture.
  const importSource = fs.readFileSync('lib/shipmentImport.js', 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export \{[^}]+\} from [^;]+;/gm, '').replace(/export /g, '');
  const parser = { normalizeOrderWeek: x => x, cleanPivotProdName: x => x };
  vm.createContext(parser);
  vm.runInContext(importSource + '\nthis.parse = parseAllocationWorkbook;', parser);
  const customers = [{ custName: 'Fixture A', custKey: 1 }, { custName: 'Fixture B', custKey: 2 }];
  const row = (key, quantity) => ({ prodKey: key, prodName: `ALSTROMERIA Fixture ${key}`,
    country: '콜롬비아', flower: '알스트로', orders: { 'Fixture A': quantity, 'Fixture B': 0 },
    incoming: { Farm: 64 } });
  for (const year of [2025, 2026]) {
    const amount = year === 2025 ? 160 : 32;
    const second = row(2, 0); second.orders['Fixture B'] = 16;
    const { ws, keymap } = context.generate([row(1, amount), second], customers, ['Farm'],
      { orderYear: year, weekLabel: '41-01', country: '콜롬비아', flower: '알스트로' });
    assert.equal(ws.B4.v, amount);
    assert.equal(ws.C4.v, `(${amount / 16})`);
    assert.ok(ws.C5.f, 'initially blank quantity has box formula');
    assert.equal(ws.D6.f, 'SUM(D4:D5)', 'initially empty customer total calculates');
    assert.equal(ws.F4.f, 'SUM(INDEX(4:4,1,2):INDEX(4:4,1,COLUMN()-1))', 'inserted pairs before summary are included');
    assert.equal(ws.J6.f, 'SUM(J4:J5)', 'manual stock has total formula');
    assert.equal(ws.L4.f, 'SUM(H4)-SUM(F4)+SUM(J4)');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '알스트로');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['type','sheet','label','key'],
      ...keymap.map(k => [k.kind, '알스트로', k.label, k.key])]), '_keymap');
    const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
    const parsed = parser.parse(XLSX, back).rows;
    assert.equal(parsed.length, 4, 'automatic box columns never become customers');
    assert.equal(parsed[0].uploadQty, amount);
    assert.equal(parsed[0].alstroErpQuantity, true);
    assert.equal(parsed[0].custKey, 1);
    back.Sheets['알스트로'].B3.v = 'New customer';
    back.Sheets['알스트로'].B4 = { t: 's', v: '' };
    const edited = parser.parse(XLSX, back).rows;
    assert.equal(edited[0].customerLabel, 'New customer');
    assert.equal(edited[0].custKey, undefined, 'renaming never retains copied old customer key');
    assert.equal(edited[0].uploadQty, 0);
    assert.equal(edited[0].blankInExcel, true);
    assert.equal(edited[0].hasFinalDistributionDirective, true);
    if (process.env.ALSTRO_FIXTURE_DIR && year === 2026) {
      fs.mkdirSync(process.env.ALSTRO_FIXTURE_DIR, { recursive: true });
      XLSX.writeFile(wb, `${process.env.ALSTRO_FIXTURE_DIR}/alstro-pairs.xlsx`);
    }
  }
  if (process.env.ALSTRO_EDITED_FILE) {
    const edited = XLSX.readFile(process.env.ALSTRO_EDITED_FILE);
    const parsed = parser.parse(XLSX, edited).rows;
    assert.equal(parsed.length, 6, 'Excel-inserted pair is exactly one new customer');
    const added = parsed.filter(r => r.customerLabel === 'New customer');
    assert.equal(added.length, 2);
    assert.equal(added[0].uploadQty, 16);
    assert.equal(added[0].custKey, undefined);
    const deleted = parsed.find(r => r.customerLabel === 'Fixture A' && r.rowNo === 4);
    assert.equal(deleted.uploadQty, 0);
    assert.equal(deleted.blankInExcel, true);
    assert.equal(deleted.custKey, 1);
    assert.equal(parsed.reduce((sum, r) => sum + r.uploadQty, 0), 36);
  }
  console.log('Alstro pairs: actual export/import, XLSX roundtrip, empty cells/totals, renamed customer, deletion and separate years PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
