'use strict';
// Offline only: derive definitions from the actual approved installer/planner.
// Never imports application DB/env or accepts a live hash as approval.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { prepareInstallation, hash } = require('./native-stock-gate-atomic.cjs');

async function reviewedDefinitions() {
  const native = JSON.parse(fs.readFileSync(path.join(__dirname, '../__tests__/fixtures/native-stock-gate-2026-10-12.json'), 'utf8').replace(/^\uFEFF/, ''))
    .find(row => row.name === 'usp_StockCalculation').definition;
  const atomic = prepareInstallation(native);
  const { planStockCalculationOrderRepair } = await import('../lib/stockCalculationOrderRepair.mjs');
  const ordered = planStockCalculationOrderRepair(atomic.definition);
  const orderedDefinitions = [ordered.alterSql, ordered.alterSql.replace('ALTER PROCEDURE', 'CREATE PROCEDURE')];
  const utf8Hashes = orderedDefinitions.map(sql => createHash('sha256').update(sql).digest('hex'));
  if (JSON.stringify(utf8Hashes) !== JSON.stringify(ordered.afterHashes)) throw Error('STOCK_REPAIR_GENERATED_HASH_MISMATCH');
  return [...atomic.acceptedDefinitions, ...orderedDefinitions];
}

function verifyHashCoverage({ definitions, allowedHashes, preferredHash }) {
  const generated = definitions.map(hash);
  const missing = generated.filter(value => !allowedHashes.includes(value));
  const unknown = allowedHashes.filter(value => !generated.includes(value));
  if (!generated.length || new Set(generated).size !== generated.length
      || new Set(allowedHashes).size !== allowedHashes.length || missing.length || unknown.length
      || !allowedHashes.includes(preferredHash)) {
    throw Error(`STOCK_PROCEDURE_HASH_MISMATCH missing=${missing.join(',')} unknown=${unknown.join(',')}`);
  }
  return generated;
}

async function main() {
  const recovery = require('../lib/pendingStockRecovery.cjs');
  const hashes = verifyHashCoverage({ definitions: await reviewedDefinitions(),
    allowedHashes: recovery.REVIEWED_CALC_SHA256, preferredHash: recovery.EXPECTED_CALC_SHA256 });
  console.log(`Stock procedure hashes verified (${hashes.length} exact approved CREATE/ALTER definitions; offline)`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { reviewedDefinitions, verifyHashCoverage };
