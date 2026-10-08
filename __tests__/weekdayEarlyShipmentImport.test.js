import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUploadQtyForProduct } from '../lib/shipmentImportQty.js';
import {
  findEarlyExclusion, projectEarlyImportTarget, verifyEarlyImportPreviewRow,
} from '../lib/weekdayEarlyShipmentImport.js';

const target = { custKey: 533, custName: '주광', prodKey: 359, prodName: '장미', outUnit: '박스' };
const early = { custKey: 533, prodKey: 359, unit: '박스', processedEarlyTotal: 3,
  earlyExcludedApplied: 3, targetImportYear: 2026, targetImportWeek: '41-01' };
const ledger = { rows: [early], fingerprint: 'same-ledger-state' };

test('native unit aliases match the canonical early ledger unit', () => {
  assert.equal(findEarlyExclusion({rows:[{...early,unit:'송이'}]}, {...target,outUnit:'STEM'}).unit,'송이');
  assert.equal(findEarlyExclusion(ledger, {...target,outUnit:'BOX'}).unit,'박스');
  assert.throws(()=>findEarlyExclusion(ledger,{...target,outUnit:'unrecognized'}),{code:'EARLY_IMPORT_UNIT_OR_ANCHOR_CONFLICT'});
});

test('40→41: absolute source 10 minus processed 3 yields final 7 and delta 5 from existing 2', () => {
  const originalTotal = normalizeUploadQtyForProduct({ excelQty: 10, uploadQty: 7, excelUnit: '박스' }, { OutUnit: '박스' });
  assert.equal(originalTotal, 10, 'apply must normalize original cell, not an already reduced target');
  const projection = projectEarlyImportTarget({ originalTotal, currentOutQty: 2,
    exclusion: findEarlyExclusion(ledger, target), mode: 'ORIGINAL_INCLUDES_EARLY' });
  assert.deepEqual(projection, { originalTotal: 10, existingTarget: 2, processedEarlyTotal: 3,
    earlyExcludedApplied: 3, finalTarget: 7, delta: 5 });
  const previewRow = { ...target, ...projection, uploadQty: 7, currentOutQty: 2,
    earlyImportMode: 'ORIGINAL_INCLUDES_EARLY', earlyLedgerFingerprint: ledger.fingerprint,
    targetImportYear: 2026, targetImportWeek: '41-01' };
  assert.equal(verifyEarlyImportPreviewRow({ row: previewRow, originalTotal, exclusion: early,
    mode: 'ORIGINAL_INCLUDES_EARLY', fingerprint: ledger.fingerprint }).finalTarget, 7);
  assert.equal(projectEarlyImportTarget({ originalTotal, currentOutQty: 7, exclusion: early,
    mode: 'ORIGINAL_INCLUDES_EARLY' }).finalTarget, 7, 'same original reupload cannot subtract early again');
});

test('already excluded, other suffix, prior year and omitted rows never subtract early again', () => {
  assert.equal(projectEarlyImportTarget({ originalTotal: 7, currentOutQty: 2, exclusion: early,
    mode: 'ALREADY_EXCLUDED' }).finalTarget, 7);
  assert.equal(projectEarlyImportTarget({ originalTotal: 10, currentOutQty: 2,
    exclusion: { ...early, earlyExcludedApplied: 0 }, mode: 'ORIGINAL_INCLUDES_EARLY' }).finalTarget, 10);
  assert.equal(projectEarlyImportTarget({ originalTotal: 10, currentOutQty: 2,
    exclusion: findEarlyExclusion({ rows: [{ ...early, custKey: 534 }] }, target),
    mode: 'ORIGINAL_INCLUDES_EARLY' }).finalTarget, 10);
  assert.equal(projectEarlyImportTarget({ originalTotal: 0, currentOutQty: 2, exclusion: early,
    mode: 'ORIGINAL_INCLUDES_EARLY', missingFromExcel: true }).finalTarget, 0);
});

test('negative target, unit conflict and stale ledger payload block before writing', () => {
  assert.throws(() => projectEarlyImportTarget({ originalTotal: 2, currentOutQty: 0,
    exclusion: early, mode: 'ORIGINAL_INCLUDES_EARLY' }), { code: 'EARLY_IMPORT_NEGATIVE_TARGET' });
  assert.throws(() => findEarlyExclusion({ rows: [{ ...early, unit: '단' }] }, target),
    { code: 'EARLY_IMPORT_UNIT_OR_ANCHOR_CONFLICT' });
  assert.throws(() => verifyEarlyImportPreviewRow({ row: { ...target, originalTotal: 10,
    processedEarlyTotal: 3, earlyExcludedApplied: 3, uploadQty: 7, currentOutQty: 2,
    delta: 5, earlyImportMode: 'ORIGINAL_INCLUDES_EARLY', earlyLedgerFingerprint: 'old',
    targetImportYear: 2026, targetImportWeek: '41-01' }, originalTotal: 10, exclusion: early,
  mode: 'ORIGINAL_INCLUDES_EARLY', fingerprint: 'new' }), { code: 'EARLY_IMPORT_PREVIEW_STALE' });
});
