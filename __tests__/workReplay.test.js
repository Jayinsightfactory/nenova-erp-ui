// __tests__/workReplay.test.js — 화면 기록(rrweb) 저장 규칙: 기록은 직원 계정(사장님·관리 계정 제외), 열람은 nenovaSS3 만, 파일만 씀.
// 실행: node __tests__/workReplay.test.js  (MSSQL 불필요, 임시 폴더에서 파일만 다룸)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-test-'));
const cwd = process.cwd();
process.chdir(tmp);

const src = fs.readFileSync(path.join(cwd, 'lib', 'workReplay.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^import \{ isOrbitReportViewer \} from '\.\/orbitReportAccess';/m,
    "const isOrbitReportViewer = (u) => String(u?.userId || '').toLowerCase() === 'nenovass3';")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { NO_RECORD_USER_IDS, canRecord, canViewReplay, appendEvents, listSessions, readSession };';
const modPath = path.join(tmp, 'workReplay.cjs');
fs.writeFileSync(modPath, src);
const wr = require(modPath);

const owner = { userId: 'nenovaSS3', userName: '관리자' };
const staff = { userId: 'seol', userName: '직원' };
const ev = (type, timestamp, data) => ({ type, timestamp, data: data || {} });

// 기록 대상·열람 권한: 직원은 기록, 사장님·관리 계정은 기록 안 함, 열람은 nenovaSS3 만
assert.strictEqual(wr.canRecord(staff), true);
assert.strictEqual(wr.canRecord(owner), false, '사장님 계정은 기록 안 함');
assert.strictEqual(wr.canRecord({ userId: 'ADMIN' }), false);
assert.strictEqual(wr.canRecord({}), false, '계정 없는 요청은 기록 안 함');
assert.strictEqual(wr.canViewReplay(staff), false);
assert.strictEqual(wr.canViewReplay(owner), true);

// 제외 계정의 추가 요청은 403, 파일도 안 생김
assert.strictEqual(wr.appendEvents(owner, 'sabcdefgh-1', [ev(4, 1)]).status, 403);
assert.strictEqual(fs.existsSync(path.join(tmp, 'data', 'replay')), false);

// sessionId 검증(경로 탈출 차단)
assert.strictEqual(wr.appendEvents(staff, '../../etc/passwd', [ev(4, 1)]).status, 400);
assert.strictEqual(wr.appendEvents(staff, 'sabcdefgh-1', []).status, 400);

// 정상 추가 + 단계 요약(route/click/input)
const t = 1789700000000;
assert.strictEqual(wr.appendEvents(staff, 'sabcdefgh-1', [
  ev(4, t), ev(2, t + 1),
  ev(5, t + 2, { tag: 'nv-route', payload: { path: '/orders' } }),
  ev(5, t + 3, { tag: 'nv-click', payload: { path: '/orders', label: '조회', tag: 'button' } }),
  ev(5, t + 4, { tag: 'nv-input', payload: { path: '/orders', label: '차수', value: '37-1', tag: 'input' } }),
  { bogus: true },
]).ok, true);
assert.strictEqual(wr.appendEvents(staff, 'sabcdefgh-1', [ev(3, t + 9)]).ok, true);

const list = wr.listSessions();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].events, 6, '유효하지 않은 이벤트는 버림');
assert.deepStrictEqual(list[0].routes, ['/orders']);
assert.strictEqual(list[0].stepCount, 3);

const s = wr.readSession('seol', 'sabcdefgh-1');
assert.strictEqual(s.events.length, 6);
assert.strictEqual(s.meta.steps[2].value, '37-1');
assert.strictEqual(wr.readSession('seol', '../x'), null);
assert.strictEqual(wr.readSession('../..', 'sabcdefgh-1'), null);

// 저장 위치는 data/replay 뿐
assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'data')), ['replay']);

process.chdir(cwd);
console.log('workReplay tests passed: 직원 기록·사장님 제외(403), 경로 탈출 차단, 단계 요약, 파일 전용 저장');
