import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parsePasteOperation, matchesPasteOperation } from '../lib/pasteOperationHistory.js';
import { normalizeOrderHistorySearch } from '../lib/orderHistorySearch.js';

const payload = { year: '2026', week: '2026-36-01', entries: [{ type: 'CANCEL', custKey: 1, prodKey: 2, custName: '라움', prodName: '수국', qty: 5, unit: '송이', editGuard: { secret: 'never-return' } }, { type: 'ADD', custKey: 3, prodKey: 2, custName: '꽃길', prodName: '수국', qty: 5, unit: '송이' }] };
const row = { LogKey: 5, Actor: '담당자', ActionType: 'SHIPMENT_ADJUST_BATCH', Result: 'SUCCESS', ResultDesc: 'committed=2; verified=2', Payload: JSON.stringify(payload) };
const op = parsePasteOperation(row);
assert.equal(op.status, 'committed'); assert.equal(op.entries.length, 2);
assert.ok(!JSON.stringify(op).includes('secret'));
assert.equal(matchesPasteOperation(op, normalizeOrderHistorySearch({ year: '2026', week: '36', custName: '꽃길' })), true);
assert.equal(matchesPasteOperation(op, normalizeOrderHistorySearch({ year: '2025', week: '36' })), false);
assert.equal(parsePasteOperation({ ...row, Payload: JSON.stringify({ ...payload, year: '2025' }) }), null);
assert.equal(parsePasteOperation({ ...row, ResultDesc: 'committed=0; verified=2' }).status, 'preview');
assert.equal(parsePasteOperation({ ...row, Result: 'FAIL' }).status, 'failed');
const truncated = parsePasteOperation({ ...row, Payload: '{"week":"2026-36-01","year":"2026","entries":[{"cut' });
assert.equal(truncated.incomplete, true); assert.deepEqual(truncated.entries, []);
assert.equal(parsePasteOperation({ ...row, Payload: '{"nested":{"year":"2026"' }), null);
assert.equal(parsePasteOperation({ ...row, Payload: JSON.stringify({ ...payload, schema: 'paste-operation-v1', committedCount: 2 }) }).committedCount, 2);
assert.notEqual(parsePasteOperation({ ...row, LogKey: 6 }).key, op.key);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(root, 'pages/api/orders/paste-history.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default withAuth(', 'globalThis.handler = withAuth(');
const calls = [];
const context = { normalizeOrderHistorySearch, parsePasteOperation, matchesPasteOperation, sql: { Int: 'int', NVarChar: 'str' }, withAuth: fn => fn,
  query: async (statement, params) => { calls.push({ statement, params }); assert.ok(/^SELECT/.test(statement.trim())); return { recordset: statement.includes('SystemActionLog') ? [row] : [] }; } };
vm.runInNewContext(source, context);
async function run(query = {}, method = 'GET') { let body, status = 200; await context.handler({ method, query, user: { userId: 'u', userName: '담당자' } }, { status(code) { status = code; return this; }, json(value) { body = value; return this; } }); return { body, status }; }
const result = await run({ year: '2026', custName: '꽃길' });
assert.equal(result.body.operations.length, 1); assert.equal(result.body.operations[0].entries.length, 2);
assert.match(calls[0].statement, /Actor=@actor OR Actor=@actorName/);
assert.equal((await run({ year: '2025' })).body.operations.length, 0);
assert.equal((await run({ year: '2026', cursor: '-1' })).status, 400);
const before = calls.length; assert.equal((await run({}, 'POST')).status, 405); assert.equal(calls.length, before);
console.log('paste operation history tests passed');
