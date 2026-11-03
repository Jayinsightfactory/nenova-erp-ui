// __tests__/pmRequests.test.js — /pm 시험 실행 요청 큐: 추가·중복 방지·ack·검증·500건 보관
// 실행: node __tests__/pmRequests.test.js (임시 파일만 사용, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmRequests.js'), 'utf8')
  .replace(/^import (\w+) from '(\w+)';/gm, "const $1 = require('$2');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { addRequest, listRequests, ackRequest, readRequests, PM_REQUEST_MAX };';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmr-'));
const mod = path.join(dir, 'pmRequests.cjs');
fs.writeFileSync(mod, src);
const m = require(mod);
const file = path.join(dir, 'runtime', 'pm-requests.json');
const o = { file };

const body = { type: 'dry-run', person: '김지니', dataName: '아드리아나', workflow: 'ETA 입력' };
const a = m.addRequest(body, 'nenovaSS3', o);
assert.ok(a.ok && !a.duplicate && a.request.status === 'queued' && a.request.dataName === '아드리아나');
const b = m.addRequest(body, 'nenovaSS3', o);
assert.ok(b.duplicate && b.request.id === a.request.id, 'queued 중복 방지');
assert.strictEqual(m.addRequest({ ...body, type: 'run' }, 'x', o).status, 400);
assert.strictEqual(m.addRequest({ type: 'dry-run', person: '김지니' }, 'x', o).status, 400);

assert.strictEqual(m.ackRequest({ id: a.request.id, status: 'bogus' }, o).status, 400);
assert.strictEqual(m.ackRequest({ id: 'nope', status: 'done' }, o).status, 404);
assert.ok(m.ackRequest({ id: a.request.id, status: 'processing' }, o).ok);
assert.ok(m.addRequest(body, 'x', o).duplicate, 'processing 중에도 중복 방지');
const d = m.ackRequest({ id: a.request.id, status: 'done', result: { draftId: 531, mode: 'dry-run', clicks: 12, steps: 8, humanStops: 2, message: 'ok' } }, o);
assert.ok(d.ok && d.request.result.draftId === '531' && d.request.result.clicks === 12 && d.request.updatedAt);
assert.strictEqual(m.listRequests({ status: 'queued' }, o).length, 0);
const c = m.addRequest(body, 'x', o);
assert.ok(!c.duplicate, '완료 후에는 새 요청 허용');
assert.strictEqual(m.listRequests({ person: '김지니' }, o).length, 2);

for (let i = 0; i < m.PM_REQUEST_MAX + 5; i++) m.addRequest({ ...body, workflow: 'w' + i }, 'x', o);
assert.strictEqual(m.readRequests(file).length, m.PM_REQUEST_MAX, '최근 500건만');
console.log('pmRequests tests passed');
