const assert = require('node:assert/strict');
async function main() {
  const { estimateDraftSnapshot: snapshot, reconcileEstimateDrafts: reconcile } = await import('../lib/estimateDraftReconcile.js');
  const row = { SdateKey: 8, SdetailKey: 4, ShipmentKey: 2, ProdKey: 3, DateCost: 0, Cost: 100, Quantity: 4, Unit: '단' };
  const keyOf = r => String(r.SdateKey);
  const args = { edits: { 8: '20' }, baselines: { 8: snapshot(row, 'cost') }, rows: [row], keyOf, kind: 'cost' };
  assert.equal(reconcile(args).conflicts.length, 0);
  assert.equal(reconcile({ ...args, rows: [{ ...row, DateCost: 10 }] }).conflicts.length, 1);
  assert.deepEqual(reconcile({ ...args, rows: [{ ...row, DateCost: 20 }] }).edits, {});
  assert.equal(reconcile({ ...args, rows: [] }).conflicts[0].missing, true);
  assert.equal(reconcile({ ...args, baselines: {} }).conflicts.length, 1);
  assert.equal(reconcile({ ...args, rows: [{ ...row, ProdKey: 9, DateCost: 20 }] }).conflicts.length, 1);
  assert.equal(snapshot({ EstimateKey: 3, Quantity: -5, Cost: 5 }, 'quantity').value, 5);
  const fs = require('node:fs'); const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../pages/estimate.js'), 'utf8');
  const begin = page.indexOf('        let baseline;');
  const end = page.indexOf('        if (!baseline', begin);
  assert.ok(begin > 0 && end > begin);
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const execute = new AsyncFunction('estimateEditPresence', 'captured', 'isCapturedEstimateScopeCurrent', `${page.slice(begin, end)} return baseline;`);
  for (const active of [false, true]) {
    let attempts = 0, acquired = 0;
    const presence = {
      refresh: async () => { if (++attempts === 1) throw Object.assign(new Error('expired'), { code: 'ERP_EDIT_LOCKED', data: { lease: { active } } }); return { success: true }; },
      acquire: async () => { acquired++; },
    };
    if (active) { await assert.rejects(execute(presence, {}, () => true)); assert.equal(acquired, 0); }
    else { assert.equal((await execute(presence, {}, () => true)).success, true); assert.equal(acquired, 1); assert.equal(attempts, 2); }
  }
  let wrongScopeAcquired = false;
  await assert.rejects(execute({ refresh: async () => { throw Object.assign(new Error('expired'), { code: 'ERP_EDIT_LOCKED', data: { lease: null } }); }, acquire: async () => { wrongScopeAcquired = true; } }, {}, () => false));
  assert.equal(wrongScopeAcquired, false);
  console.log('estimateDraftReconcile tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
