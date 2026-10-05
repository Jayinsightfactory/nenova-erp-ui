const assert = require('node:assert/strict');

async function main() {
  const { parsePnlPeriod, normalizePnlPeriod, formatPnlPeriod, comparePnlPeriods, pnlPeriodBaseMajor, pnlPeriodValue } = await import('../lib/raumPnlPeriod.js');
  assert.deepEqual(parsePnlPeriod('39-2'), { key: '39-2', baseMajor: '39', subPeriod: 2, label: '39-2차' });
  assert.deepEqual(parsePnlPeriod('05-2'), { key: '05-2', baseMajor: '05', subPeriod: 2, label: '5-2차' });
  assert.equal(normalizePnlPeriod(5), '05');
  assert.equal(normalizePnlPeriod('05'), '05');
  assert.equal(normalizePnlPeriod('5-2', { allowSubPeriod: true }), '05-2');
  assert.throws(() => normalizePnlPeriod('39-2'), /신라/);
  for (const invalid of ['039', '39-0', '39-02', '39-10', '39-2-1', '0', '00', '100', '+39', '39.0', '3e1', '39–2', '39차-2', '', null]) {
    assert.equal(parsePnlPeriod(invalid), null, String(invalid));
    assert.equal(formatPnlPeriod(invalid), null, String(invalid));
    assert.equal(pnlPeriodValue(invalid), null, String(invalid));
    assert.throws(() => normalizePnlPeriod(invalid, { allowSubPeriod: true }));
  }
  assert.equal(pnlPeriodValue('39'), 39);
  assert.equal(pnlPeriodValue('39-2'), '39-2');
  assert.equal(pnlPeriodBaseMajor('39-2'), '39');
  assert.deepEqual(['39-2', '38', '40', '39', '39-1'].sort(comparePnlPeriods), ['38', '39', '39-1', '39-2', '40']);
  console.log('P&L period helper tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
