import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { customerReviewCandidates, productReviewAllowed, buildPasteReviewTasks, applyPasteReview, reviewPasteMatches } from '../lib/pasteAiMatchReview.js';
import { applyPasteCustomerMappings } from '../lib/pasteCustomerMapping.js';

const customers = [
  { CustKey: 686, CustName: '양재동', CustArea: '양재동' },
  { CustKey: 325, CustName: '남촌양재', CustArea: '양재동' },
  { CustKey: 671, CustName: '부산 서부꽃집' }, { CustKey: 405, CustName: '서부청과(주)' },
];
const mappings = { '양재동': { custKey: 325 }, '서부꽃집': { custKey: 671 }, '서부청과': { custKey: 671 } };
assert.equal(customerReviewCandidates('양재동', customers, mappings, 325).lockedKey, 686);
assert.equal(customerReviewCandidates('서부꽃집', customers, mappings, 405).lockedKey, 671);
assert.equal(customerReviewCandidates('서부청과(주)', customers, mappings, 671).lockedKey, 405);
assert.equal(customerReviewCandidates('서부', customers, mappings, 405).lockedKey, null);
const products = [{ ProdKey: 1255, ProdName: 'ROSE / Pink Mondial 50cm', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
  { ProdKey: 1437, ProdName: 'ROSE / Pink Mondial 40cm', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' }];
assert.equal(productReviewAllowed('콜롬비아 장미 Pink Mondial 50cm', products[1]), false);
assert.equal(productReviewAllowed('중국 장미 Pink Mondial 50cm', products[0]), false);
assert.equal(productReviewAllowed('수국 화이트', products[0]), false);
for (const year of [2025, 2026]) {
  const orders = [{ year, week: '36-02', custName: '서부꽃집', custMatch: customers[3], items: [{
    inputName: '장미 핑크몬디알 50cm', qty: 10, unit: '단', unitExplicit: true, action: '취소',
    prodKey: 1437, suggestedProducts: [{ ProdKey: 1255 }],
  }] }];
  const tasks = buildPasteReviewTasks(orders, customers, products, mappings);
  const good = [{ id: 'p0:0', key: 1255, confidence: 0.95, reason: '50cm 일치' }];
  const result = applyPasteReview(orders, tasks, good, customers, products);
  assert.equal(result[0].custMatch.CustKey, 671);
  assert.equal(result[0].items[0].prodKey, 1255);
  assert.equal(result[0].items[0].qty, 10);
  assert.equal(result[0].items[0].unit, '단');
  assert.equal(result[0].items[0].action, '취소');
  assert.equal(result[0].year, year);
  assert.equal(result[0].week, '36-02');
  assert.equal(orders[0].items[0].prodKey, 1437, 'no input mutation');
  const cached = applyPasteCustomerMappings(result, { '서부꽃집': { custKey: 405 } }, customers);
  assert.equal(cached[0].custMatch.CustKey, 671, 'stale browser cannot override');
  for (const decisions of [[], [...good, ...good], [{ ...good[0], key: 9999 }], [{ ...good[0], confidence: 0.7 }], [{ ...good[0], confidence: 95 }]]) {
    const blocked = applyPasteReview(orders, tasks, decisions, customers, products);
    assert.equal(blocked[0].items[0].prodKey, null);
    assert.equal(blocked[0].items[0].qty, 10);
  }
  const failed = await reviewPasteMatches({ orders, customers, products, mappings, callModel: async () => { throw Error('timeout'); } });
  assert.equal(failed[0].items.length, 1);
  assert.equal(failed[0].items[0].prodKey, null);
}
const paste = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.ok(paste.includes('if (it.matchReviewed) return it;'));
assert.ok(paste.includes('matchReviewed: !!o.matchReviewed'));
assert.ok(paste.includes('it.matchReason'));
const api = fs.readFileSync('pages/api/orders/parse-paste.js', 'utf8');
assert.ok(api.includes('await reviewPasteMatches'));
assert.ok(!api.includes('matched.prodKey || item.prodKey'));

// Deploy seed changes must not overwrite user corrections; test in an isolated directory.
const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-match-test-'));
try {
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/order-mappings.json'), JSON.stringify({ original: { prodKey: 1 } }));
  process.chdir(dir);
  const store = await import(`../lib/parseMappings.js?runtime-test=${Date.now()}`);
  assert.equal(store.loadMappings(true).original.prodKey, 1);
  assert.equal(store.saveMapping('선택', { prodKey: 1255 }).saved, true);
  fs.writeFileSync(path.join(dir, 'data/order-mappings.json'), '{}');
  assert.equal(store.loadMappings(true)['선택'].prodKey, 1255);
  assert.equal(store.loadMappings(true).original.prodKey, 1);
  assert.equal(store.deleteMapping('선택').deleted, true);
  assert.equal(store.loadMappings(true)['선택'], undefined);
} finally {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true });
}
console.log('paste AI review: customer collisions, candidate validation, failure, immutable rows, cross-year, stale cache, runtime store passed');
