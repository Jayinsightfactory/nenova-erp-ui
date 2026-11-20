'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { reviewedDefinitions, verifyHashCoverage } = require('../scripts/check-stock-procedure-hashes.cjs');
const { hash } = require('../scripts/native-stock-gate-atomic.cjs');
const recovery = require('../lib/pendingStockRecovery.cjs');
const verify = (definitions, allowedHashes = recovery.REVIEWED_CALC_SHA256) => verifyHashCoverage({ definitions, allowedHashes, preferredHash: recovery.EXPECTED_CALC_SHA256 });

test('actual atomic installer and order-repair planner outputs match recovery exactly', async () => {
  assert.equal(verify(await reviewedDefinitions()).length, 4);
});
test('approved SQL change with stale recovery allowlist is rejected', async () => {
  const definitions = await reviewedDefinitions();
  // A future reviewed generator changes SQL bytes; the runtime list was forgotten.
  definitions[2] += '\n-- changed approved procedure revision';
  assert.throws(() => verify(definitions), /STOCK_PROCEDURE_HASH_MISMATCH missing=[a-f0-9]+/);
});
test('missing approved hash exits the executable validation with failure', () => {
  const guard = path.join(__dirname, '../scripts/check-stock-procedure-hashes.cjs');
  const core = path.join(__dirname, '../lib/pendingStockRecovery.cjs');
  const script = `(async()=>{const g=require(${JSON.stringify(guard)}),r=require(${JSON.stringify(core)});g.verifyHashCoverage({definitions:await g.reviewedDefinitions(),allowedHashes:r.REVIEWED_CALC_SHA256.filter(h=>h!==r.EXPECTED_CALC_SHA256),preferredHash:r.EXPECTED_CALC_SHA256});})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STOCK_PROCEDURE_HASH_MISMATCH missing=/);
});
test('unreviewed hash and duplicate cannot be added to recover availability', async () => {
  const definitions = await reviewedDefinitions();
  assert.throws(() => verify(definitions, [...recovery.REVIEWED_CALC_SHA256, 'f'.repeat(64)]), /unknown=ffffffff/);
  assert.throws(() => verify(definitions, [...recovery.REVIEWED_CALC_SHA256, hash(definitions[0])]), /HASH_MISMATCH/);
});
