import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeManagementRequest } from '../lib/defectLedgerManagement.js';
import * as core from '../lib/salesDefectDeductionCore.js';

let logCalls = 0, ddlCalls = 0, manageCalls = 0, authCalls = 0;
const context = { console: { error() {} }, Date, ...core,
  withAuth: (fn) => async (...args) => { authCalls++; return fn(...args); },
  withActionLog: (fn) => async (...args) => { logCalls++; return fn(...args); },
  ensureSalesDefectTables: async () => { ddlCalls++; },
  manageDeductions: async (input) => {
    manageCalls++; const request = normalizeManagementRequest(input);
    return { preview: request.preview, rows: [{ deductionKey: 252, noteOnly: true }] };
  },
};
const source = fs.readFileSync(new URL('../pages/api/sales/defect-deductions.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
  .replace('export default withAuth(', 'globalThis.route = withAuth(');
vm.runInNewContext(source, context);
const body = { action: 'manage-edit', year: 2026, week: 40,
  rows: [{ deductionKey: 252, sourceYear: 2026, sourceWeek: 36, expectedRowVersionNo: 7 }], preview: true };
async function call(overrides = {}, user = { authority: 2 }) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, setHeader() {} };
  await context.route({ method: 'POST', body: { ...body, ...overrides }, user }, res);
  return res;
}
const good = await call();
assert.equal(good.statusCode, 200); assert.equal(good.body.rows[0].noteOnly, true);
assert.equal(logCalls, 0); assert.equal(ddlCalls, 0); assert.equal(manageCalls, 1);
const denied = await call({}, { authority: 6 });
assert.equal(denied.statusCode, 403); assert.equal(logCalls, 0); assert.equal(ddlCalls, 0);
const yearConflict = await call({ week: '2025-40' });
assert.equal(yearConflict.statusCode, 400); assert.match(yearConflict.body.error, /연도/);
assert.equal(logCalls, 0); assert.equal(ddlCalls, 0);
const archivePreview = await call({ action: 'manage-archive' });
assert.equal(archivePreview.statusCode, 200); assert.equal(logCalls, 0); assert.equal(ddlCalls, 0);
const actualWrite = await call({ preview: false, changes: { note: '확인' } });
assert.equal(actualWrite.statusCode, 200); assert.equal(logCalls, 1); assert.equal(ddlCalls, 0);
await call({ action: 'unsupported', preview: true });
assert.equal(logCalls, 2, 'only the narrow management preview branch bypasses logging');
assert.equal(ddlCalls, 1, 'unrelated behavior remains unchanged');
assert.equal(authCalls, 6, 'all branches retain authentication');
console.log('defect management HTTP route: read-only logger bypass, denied preview, raw year conflict and write audit passed');
