const assert = require('node:assert/strict');
const XLSX = require('xlsx-js-style');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const helper = await import('../lib/pivotVolumeCombinedCells.js');
  const { combinedCellContext, combinedParts, combinedNumberFormat } = helper;
  const row = (key, qty) => ({ prodKey: key, prodName: 'same name', orders: { Customer: qty } });
  const data = { orderYear: 2026, weeks: ['36-02', '36-01'], byWeek: {
    '36-01': { rows: [row(1, 10), row(2, 5)] }, '36-02': { rows: [row(1, 20)] },
    '2025-36-01': { rows: [row(1, 999)] },
  } };
  for (const flag of [undefined, null, false, '0', 'false', 'stale']) assert.equal(combinedCellContext({}, flag), null);
  const ctx = combinedCellContext(data, '1');
  assert.deepEqual(ctx.weeks, ['36-01', '36-02']);
  assert.deepEqual(combinedParts(ctx, row(1, 30), 'Customer', (_, n) => n), [10, 20]);
  assert.deepEqual(combinedParts(ctx, row(2, 5), 'Customer', (_, n) => n), [5, 0]);
  assert.deepEqual(combinedParts(ctx, row(1, 30), 'Customer', (_, n) => n / 16), [0.625, 1.25]);
  assert.throws(() => combinedParts(ctx, row(1, 31), 'Customer', (_, n) => n), /다릅니다/);
  assert.throws(() => combinedCellContext({...data, weeks:['36-01']}, '1'), /범위/);
  assert.throws(() => combinedCellContext({...data, weeks:['36-01','37-01']}, 'true'), /범위/);
  assert.throws(() => combinedCellContext({...data, orderYear:'2025~2026'}, '1'), /범위/);
  assert.throws(() => combinedCellContext({...data, byWeek:{}}, '1'), /데이터/);
  for (const [total, parts, expected] of [[30,[10,20],'30(10,20)'], [5,[5,0],'5(5,0)'], [1.875,[0.625,1.25],'1.875(0.625,1.25)']]) {
    const z = combinedNumberFormat(total, parts);
    assert.equal(XLSX.SSF.format(z, total), expected);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, { A1: { t:'n', v:total, z, s:{numFmt:z} }, '!ref':'A1' }, 'test');
    const back = XLSX.read(XLSX.write(wb, {type:'buffer', bookType:'xlsx'}), {type:'buffer', cellNF:true});
    assert.equal(back.Sheets.test.A1.v, total);
    assert.equal(back.Sheets.test.A1.w, expected);
  }
  // Exercise actual production sheet generator, replacing only imported read/presentation dependencies.
  const source = fs.readFileSync('pages/api/stats/pivot-volume-excel.js','utf8')
    .split('export default withAuth')[0].replace(/^import[\s\S]*?;\r?\n/gm, '');
  const context = { XLSX, ...helper, getFarmDisplayName: x=>x, customerDisplayLabel:c=>c.custName,
    DAY_ORDER:{}, extractDays:()=>[], pickDataDay:()=>'', isNetherlandsVolume:()=>false,
    buildPivotVolumeIdentityColumns:()=>[{type:'product'}], pivotVolumeFlowerLabel:r=>r.flower,
    sumOrderQty:r=>Object.values(r.orders||{}).reduce((a,b)=>a+b,0), sumIncomingQty:()=>0 };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.generate = makeSheet;', context);
  const args = [[row(1,30)], [{custName:'Customer',custKey:1}], [], {weekLabel:'36-01~36-02',flower:'장미'}];
  const ordinary = context.generate(...args).ws;
  const combined = context.generate(...args.slice(0,3), {...args[3],combined:ctx}).ws;
  assert.equal(ordinary.B4.v, combined.B4.v);
  assert.equal(ordinary.B4.s.numFmt, 'General');
  assert.equal(XLSX.SSF.format(combined.B4.z, combined.B4.v), '30(10,20)');
  assert.equal(combined.B5.f, ordinary.B5.f);
  assert.equal(combined.C4.f, ordinary.C4.f);
  assert.deepEqual(combined.A1.s, ordinary.A1.s);
  assert.equal(combined.B2.v, '합산(1차,2차)');
  console.log('pivot combined cells: defaults, year, missing, precision, production sheet and XLSX roundtrip passed');
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
