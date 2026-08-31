import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('docs/repair-manifests/2026-08-31_36-01_order-import-rollback.json', 'utf8'));
const script = fs.readFileSync('scripts/rollback-order-import-20260831.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/rollback-order-import-20260831.yml', 'utf8');

assert.equal(manifest.orderYear, '2026');
assert.equal(manifest.orderWeek, '36-01');
assert.equal(manifest.targets.length, 41);
assert.equal(new Set(manifest.targets.map(t => `${t.customer}|${t.product}|${t.orderCode}`)).size, 41);
assert.ok(manifest.targets.every(t => Number.isFinite(t.before) && Number.isFinite(t.after) && t.before !== t.after));

assert.match(script, /OrderMaster om\$\{masterHint\}/);
assert.match(script, /OrderDetail od\$\{detailHint\}/);
assert.match(script, /UPDLOCK, HOLDLOCK/);
assert.match(script, /CAST\(om\.OrderYear AS NVARCHAR\(4\)\)=@yr/);
assert.match(script, /om\.OrderWeek=@wk/);
assert.match(script, /LatestIsSourceChange/);
assert.match(script, /CONVERT\(DATETIME2,@fromDtm,126\)/);
assert.match(script, /dryRunDownstream = await downstreamSnapshot\(query, dryRun\)/);
assert.match(script, /current quantity|현재/);
assert.match(script, /withTransaction/);
assert.match(script, /INSERT INTO OrderHistory/);
assert.match(script, /INSERT INTO SystemActionLog/);
assert.match(script, /downstreamSnapshot/);
assert.doesNotMatch(script, /UPDATE\s+(?:ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|ProductStock|StockHistory|Estimate|WebProfitReport)\b/i);
assert.doesNotMatch(script, /DELETE\s+FROM\s+(?:ShipmentMaster|ShipmentDetail|ShipmentDate|ShipmentFarm|ProductStock|StockHistory|Estimate|WebProfitReport)\b/i);
assert.match(workflow, /ROLLBACK_2026_36_01_41/);
assert.match(workflow, /default:\s*dry-run/);
assert.match(workflow, /--apply/);

console.log('2026-08-31 order import rollback contract tests passed');
