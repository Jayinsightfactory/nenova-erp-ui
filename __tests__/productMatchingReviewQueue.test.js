import assert from 'node:assert/strict';
import {
  buildProductMatchReviewQueue,
  classifyProductMatchEvidence,
  pasteMappingToEvidence,
} from '../lib/productMatchingReviewQueue.js';

const confirmed = classifyProductMatchEvidence({
  sourceType: 'explicit-save', sourceText: '콜롬비아 문라이트', prodKey: 447, custKey: 10,
  country: '콜롬비아', confirmedBy: 'user-1', confirmedAt: '2026-08-08T00:00:00Z', explicitUserConfirmation: true,
});
assert.equal(confirmed.status, 'CONFIRMED_TRAINING_SAMPLE');

const noCountry = classifyProductMatchEvidence({
  sourceType: 'explicit-save', sourceText: '문라이트', prodKey: 447, custKey: 10,
  confirmedBy: 'user-1', confirmedAt: '2026-08-08T00:00:00Z', explicitUserConfirmation: true,
});
assert.equal(noCountry.status, 'QUARANTINED');
assert(noCountry.blockers.includes('COUNTRY_MISSING'));

const automatic = classifyProductMatchEvidence({ sourceType: 'paste-auto', sourceText: '문라이트', prodKey: 447, country: '콜롬비아', autoSelected: true });
assert.equal(automatic.status, 'QUARANTINED');

const legacyManual = pasteMappingToEvidence(['문라이트', { prodKey: 447, counName: '콜롬비아', manual: true, savedAt: '2026-04-20' }]);
const [queued] = buildProductMatchReviewQueue([legacyManual]);
assert.equal(queued.status, 'LEARNING_CANDIDATE');
assert.equal(queued.confidence, 0.68);

const conflict = pasteMappingToEvidence(['충돌', { prodKey: 447, counName: '콜롬비아', manual: true, auto: true }]);
assert.equal(classifyProductMatchEvidence(conflict).status, 'QUARANTINED');

console.log('productMatchingReviewQueue tests passed');
