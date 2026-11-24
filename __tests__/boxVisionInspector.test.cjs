'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('5 sample warehouse photos exist in public/samples/box-vision/', () => {
  const expectedFiles = [
    'sample-1-silla.jpg',
    'sample-2-neulbom-a.jpg',
    'sample-3-neulbom-b.jpg',
    'sample-4-jukwang.jpg',
    'sample-5-holex-mint.jpg',
  ];
  for (const fileName of expectedFiles) {
    const abs = path.join(repoRoot, 'public/samples/box-vision', fileName);
    assert.ok(fs.existsSync(abs), `Sample image must exist: ${fileName}`);
    const stat = fs.statSync(abs);
    assert.ok(stat.size > 50000, `Sample image must be non-empty JPEG: ${fileName}`);
  }
});

test('Layout.js and desktop/menu.json include /vision/box-inspector menu entry', () => {
  const layoutSource = fs.readFileSync(path.join(repoRoot, 'components/Layout.js'), 'utf8');
  assert.match(layoutSource, /href:\s*['"]\/vision\/box-inspector['"]/);
  assert.match(layoutSource, /박스 사진 판독 · 품목\/수량 매칭/);

  const desktopMenu = JSON.parse(fs.readFileSync(path.join(repoRoot, 'desktop/menu.json'), 'utf8'));
  const items = desktopMenu.flatMap((g) => g.items || []);
  const entry = items.find((i) => i.href === '/vision/box-inspector');
  assert.ok(entry, 'desktop/menu.json must include /vision/box-inspector');
  assert.equal(entry.labelKey, '박스 사진 판독 · 품목/수량 매칭');
  assert.equal(entry.popup, false);
});

test('boxVisionInspector engine deduplicates overlapping serial numbers across photos and reconciles ERP shipments', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos } = mod;

  // 1) Single sample 1: Silla Hotel 4 boxes (40+39+40+40 = 159 stems) + 1 background Cloudland orchid box
  const s1 = analyzeBoxVisionPhotos({ sampleIds: ['sample-1-silla'] });
  assert.equal(s1.totals.countedBoxes, 4);
  assert.equal(s1.totals.backgroundBoxes, 1);
  assert.equal(s1.totals.duplicateBoxes, 0);
  const sillaRow = s1.customerItemSummary.find((r) => r.custKey === 446 && r.prodKey === 181);
  assert.ok(sillaRow, 'Silla Hotel Anthurium Graciosa 15cm must be aggregated');
  assert.equal(sillaRow.photoBoxCount, 4);
  assert.equal(sillaRow.photoTotalQty, 159);
  assert.equal(sillaRow.erpOutQty, 159);
  assert.equal(sillaRow.reconcileStatus, 'MATCH');

  // 2) Neulbom pair (sample 2 + sample 3): 7 boxes in sample 2 + 5 unique boxes in sample 3 (+ 2 duplicate boxes 2494510.31.1 & 30.1 excluded)
  const pair = analyzeBoxVisionPhotos({ sampleIds: ['sample-2-neulbom-a', 'sample-3-neulbom-b'] });
  assert.equal(pair.totals.countedBoxes, 12);
  assert.equal(pair.totals.duplicateBoxes, 2);
  const neulbomGraciosa = pair.customerItemSummary.find((r) => r.custKey === 335 && r.prodKey === 181);
  assert.ok(neulbomGraciosa);
  assert.equal(neulbomGraciosa.photoBoxCount, 8);
  assert.equal(neulbomGraciosa.photoTotalQty, 270);
  assert.equal(neulbomGraciosa.erpOutQty, 270);
  assert.equal(neulbomGraciosa.reconcileStatus, 'MATCH');

  // 3) All 5 samples: deduplicates 3 overlapping boxes (2 in sample 3 + 1 Calla 2494510.27.1 in sample 5) and separates 2 background pallets
  const all = analyzeBoxVisionPhotos({
    sampleIds: [
      'sample-1-silla',
      'sample-2-neulbom-a',
      'sample-3-neulbom-b',
      'sample-4-jukwang',
      'sample-5-holex-mint',
    ],
  });
  assert.equal(all.totals.duplicateBoxes, 3);
  assert.equal(all.totals.backgroundBoxes, 2);
  assert.ok(all.matchedDefects.length >= 4);
  assert.ok(all.farmBoxProfiles.length >= 5);
});
