import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateRaumPnlImportReview, RAUM_GANGNAM_MULTISHEET, raumPnlImportSaveError } from '../lib/raumPnlImportReview.js';

const gangnamCheck = {
  code: RAUM_GANGNAM_MULTISHEET,
  group: '강남',
  ok: true,
  requiresConfirmation: true,
  sheetNames: ['34차강남', '34차 강남 콘서트'],
};
const gangnamBatch = { partnerCode: 'raum', orderYear: '2026', major: '34', items: [{ qty: 13, supply: 33800 }], verification: [gangnamCheck] };

const unconfirmed = evaluateRaumPnlImportReview([gangnamBatch]);
assert.equal(unconfirmed.allowAuto, false, '강남 복수 시트는 자동 저장하면 안 된다.');
assert.equal(unconfirmed.allowManual, false, '명시 확인 전에는 수동 저장도 안 된다.');
assert.equal(unconfirmed.review[0].check.sheetNames.length, 2);
assert.match(raumPnlImportSaveError(unconfirmed), /원본 시트 목록/);

for (const value of [false, 'true', 1, 0, null, undefined]) {
  assert.equal(evaluateRaumPnlImportReview([gangnamBatch], value).allowManual, false, `확인값 ${String(value)}는 boolean true가 아니다.`);
}
const confirmed = evaluateRaumPnlImportReview([gangnamBatch], true);
assert.equal(confirmed.allowManual, true, '명시 boolean true만 강남 13개 합산 저장을 허용한다.');
assert.equal(confirmed.allowAuto, false);

const badTotal = evaluateRaumPnlImportReview([{ ...gangnamBatch, verification: [gangnamCheck, { group: '합계', label: '합계', ok: false }] }], true);
assert.equal(badTotal.allowManual, false, '실제 합계 불일치는 확인으로 우회할 수 없다.');
const duplicateKonkuk = evaluateRaumPnlImportReview([{ partnerCode: 'raum', verification: [{ group: '건대', label: '동일 차수·지점 시트', ok: false }] }], true);
assert.equal(duplicateKonkuk.allowManual, false, '건대 중복은 계속 차단한다.');

for (const malformed of [
  { ...gangnamCheck, group: '건대' },
  { ...gangnamCheck, code: RAUM_GANGNAM_MULTISHEET, requiresConfirmation: true },
  { ...gangnamCheck, code: RAUM_GANGNAM_MULTISHEET, requiresConfirmation: false },
]) {
  const partnerCode = malformed.group === '건대' ? 'raum' : 'choimun';
  assert.equal(evaluateRaumPnlImportReview([{ partnerCode, verification: [malformed] }], true).allowManual, false,
    '강남·라움의 정확한 review schema가 아니면 fail-closed 한다.');
}

assert.equal(evaluateRaumPnlImportReview([{ partnerCode: 'raum', verification: null }], false).allowManual, true,
  '검증 정보 없는 레거시 단일 저장은 이 변경으로 차단하지 않는다.');

const core = fs.readFileSync(new URL('../lib/raumPnl.js', import.meta.url), 'utf8');
const singleApi = fs.readFileSync(new URL('../pages/api/raum/pnl.js', import.meta.url), 'utf8');
const importApi = fs.readFileSync(new URL('../pages/api/raum/pnl-import.js', import.meta.url), 'utf8');
const pnlPage = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
assert.match(core, /assertImportBatches\(batches, confirmGangnamMerge\)/, 'core batch write must use the shared review gate');
assert.match(core, /saveRaumPnl\([^]*confirmGangnamMerge/, 'core single write must receive the confirmation');
assert.match(singleApi, /req\.body\?\.confirmGangnamMerge === true/, 'single JSON API accepts only boolean true');
assert.match(importApi, /asField\(fields\.confirmGangnamMerge\) === 'true'/, 'multipart API accepts only exact string true');
assert.match(importApi, /saveRaumPnlImportBatch\([^]*confirmGangnamMerge/, 'multipart API forwards its strict boolean to the core');
assert.match(pnlPage, /isShilla \|\| partner\.customHotel \|\| batches\.length > 1 \|\| evaluateRaumPnlImportReview\(batches\)\.requiresConfirmation/,
  'single Gangnam review imports must retain the multipart preview token and snapshot-protected save path');

console.log('Raum P&L import review tests passed');
