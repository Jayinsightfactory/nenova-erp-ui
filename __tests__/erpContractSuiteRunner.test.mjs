import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  countSuiteTargets,
  expandErpContractSuite,
  isIsolatedSerialCommand,
  parseLeafCommand,
  runTaskPool,
} from '../scripts/run-erp-contract-suite.mjs';

test('expandErpContractSuite preserves all pre/main/post lifecycle hooks and leaf checks', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:erp-contract'], 'node scripts/run-erp-contract-suite.mjs');
  const tasks = expandErpContractSuite(pkg.scripts);
  const targets = countSuiteTargets(tasks);
  assert.ok(tasks.length >= 492, `expected >= 492 leaf commands, got ${tasks.length}`);
  assert.ok(targets >= 672, `expected >= 672 test targets, got ${targets}`);
  assert.ok(tasks.some((t) => t.cmd.includes('orderStockCalculation.test.js')), 'includes pre-phase check');
  assert.ok(tasks.some((t) => t.cmd.includes('hotelMiuIntake.test.js')), 'includes main-phase check');
  assert.ok(tasks.some((t) => t.cmd.includes('profitChinaTransportApi.test.cjs')), 'includes nested posttest:profit-inventory-basis check');
  assert.ok(tasks.some((t) => t.cmd.includes('shipmentFarmTextImport.test.cjs')), 'includes post-phase check');
  assert.ok(tasks.some((t) => isIsolatedSerialCommand(t.cmd)), 'marks contention-sensitive child suites as isolated');
});

test('parseLeafCommand bounds multi-file node --test concurrency and counts targets accurately', () => {
  const multi = parseLeafCommand('node --test __tests__/a.test.js __tests__/b.test.js __tests__/c.test.js', { multiTestConcurrency: 1 });
  assert.equal(multi.targetCount, 3);
  assert.deepEqual(multi.args.slice(0, 2), ['--test', '--test-concurrency=1']);

  const single = parseLeafCommand('node __tests__/plain.test.js --flag', { allowWorkerThread: false });
  assert.equal(single.targetCount, 1);
  assert.deepEqual(single.args, ['__tests__/plain.test.js', '--flag']);
});

test('runTaskPool serializes duplicate commands and reports non-zero exit failures', async () => {
  const tasks = [
    { index: 1, cmd: 'node -e "process.exit(0)"', chain: 'unit' },
    { index: 2, cmd: 'node -e "process.exit(0)"', chain: 'unit-dup' },
    { index: 3, cmd: 'node -e "console.error(\'EXPECTED_FAILURE_MARKER\'); process.exit(2)"', chain: 'unit-fail' },
  ];
  const summary = await runTaskPool(tasks, { concurrency: 3, quiet: true });
  assert.equal(summary.totalCommands, 3);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.failures[0].code, 2);
  assert.match(summary.failures[0].stderr, /EXPECTED_FAILURE_MARKER/);
});
