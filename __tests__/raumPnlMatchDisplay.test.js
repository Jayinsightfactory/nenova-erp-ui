const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function main() {
  const { raumPnlMatchCounts, raumPnlMatchDisplay } = await import('../lib/raumPnlMatchDisplay.js');

  assert.equal(raumPnlMatchDisplay({ name: '수국 화이트', prodName: 'Hydrangea White', prodKey: 12 }).label, 'Hydrangea White');
  assert.equal(raumPnlMatchDisplay({ name: '수국 화이트', prodName: 'Hydrangea White', prodKey: 12 }).matched, true);
  assert.equal(raumPnlMatchDisplay({ prodKey: 12 }).label, '전산키 12');
  assert.equal(raumPnlMatchDisplay({ name: '수국 화이트' }).label, '미매칭');
  assert.equal(raumPnlMatchDisplay({ consigned: true, name: '사입꽃' }).label, '사입');
  assert.equal(raumPnlMatchDisplay({ isCustom: true, name: '손실' }).kind, 'custom');

  const counts = raumPnlMatchCounts([
    { name: '수국 화이트', prodName: 'Hydrangea White', prodKey: 12 },
    { name: '장미', prodKey: null },
    { consigned: true, name: '사입' },
    { isCustom: true, name: '손실' },
  ]);
  assert.equal(counts.matched, 1);
  assert.equal(counts.missing, 1);
  assert.equal(counts.total, 2);

  const lib = fs.readFileSync(path.join(root, 'lib/raumPnl.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/raum/pnl.js'), 'utf8');
  assert.match(lib, /LEFT JOIN Product p ON p\.ProdKey = i\.ProdKey/);
  assert.match(lib, /MatchedProdName/);
  assert.match(lib, /MissingMatch/);
  assert.match(page, /전산 매칭/);
  assert.match(page, /raumPnlMatchDisplay/);
  console.log('raumPnlMatchDisplay tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
