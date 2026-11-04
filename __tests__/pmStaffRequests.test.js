// __tests__/pmStaffRequests.test.js — /pm 직원 요청 게시판: 작성·검증·권한(작성자/관리자)·재분류·PM 갱신·스크린샷·URL 정리
// 실행: node __tests__/pmStaffRequests.test.js (임시 파일만 사용, MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export \{[^}]*\} from .*$/gm, '').replace(/^export (const|function) /gm, '$1 ');
const labels = strip(fs.readFileSync(path.join(process.cwd(), 'lib', 'pmStaffReqLabels.js'), 'utf8'));
const src = "const fs = require('fs'); const path = require('path'); const crypto = require('crypto');\n" + labels
  + strip(fs.readFileSync(path.join(process.cwd(), 'lib', 'pmStaffRequests.js'), 'utf8'))
  + '\nmodule.exports = { addStaffRequest, editStaffRequest, listStaffRequests, pmUpdateStaffRequest, staffShotFile, cleanPageUrl, decodeShot, readStaffRequests, STAFF_REQ_DAILY_LIMIT };';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmsr-'));
const mod = path.join(dir, 'm.cjs');
fs.writeFileSync(mod, src);
const m = require(mod);
const o = { file: path.join(dir, 'rt', 'pm-staff-requests.json'), shotDir: path.join(dir, 'rt', 'shots') };
const kim = { userId: 'kim', userName: '김직원' }, lee = { userId: 'lee', userName: '이직원' };

assert.strictEqual(m.addStaffRequest({ category: 'error', title: 'x' }, {}, o).status, 401);
assert.strictEqual(m.addStaffRequest({ category: 'bogus', title: 'x' }, kim, o).status, 400);
assert.strictEqual(m.addStaffRequest({ category: 'error', title: ' ' }, kim, o).status, 400);
assert.strictEqual(m.addStaffRequest({ category: 'error', title: 'x', shot: 'data:image/png;base64,AAAA' }, kim, o).status, 400, '매직바이트 아닌 이미지 거부');
const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
const a = m.addStaffRequest({ category: 'error', title: '버튼 안 눌림', body: '견적', pageUrl: 'https://nenovaweb.com/estimate?w=1', shot: png }, kim, o);
assert.ok(a.ok && a.request.status === 'received' && a.request.byName === '김직원' && a.request.pageUrl === '/estimate?w=1');
assert.ok(m.staffShotFile(a.request.id, o), '스크린샷 저장');
assert.strictEqual(m.cleanPageUrl('javascript:alert(1)'), '');

// 권한: 다른 직원 수정 불가, 관리자 가능, 상태 변경은 관리자만
assert.strictEqual(m.editStaffRequest(a.request.id, { title: '남의글' }, lee, false, o).status, 403);
assert.strictEqual(m.editStaffRequest(a.request.id, { status: 'rejected' }, kim, false, o).status, 403);
assert.ok(m.editStaffRequest(a.request.id, { title: '관리자 수정' }, { userId: 'nenovaSS3' }, true, o).ok);
assert.ok(m.editStaffRequest(a.request.id, { status: 'rejected' }, { userId: 'nenovaSS3' }, true, o).request.status === 'rejected');

// PM 갱신 → 답변완료 후 작성자가 덧붙이면 재접수
const b = m.addStaffRequest({ category: 'etc', title: '사용법 질문' }, kim, o).request;
assert.strictEqual(m.pmUpdateStaffRequest({ id: b.id, status: 'nope' }, o).status, 400);
const u = m.pmUpdateStaffRequest({ id: b.id, status: 'answered', answer: '이렇게 하세요', log: '답변', pr: 'https://evil.com/x' }, o).request;
assert.ok(u.status === 'answered' && u.answer && u.pr === '' && u.log.at(-1).by === 'pm');
assert.strictEqual(m.editStaffRequest(b.id, { comment: '그래도 안 돼요' }, kim, false, o).request.status, 'received', '덧붙이면 재분류');
assert.strictEqual(m.listStaffRequests({ status: 'received' }, o).length, 1);

// 하루 상한
for (let i = 0; i < m.STAFF_REQ_DAILY_LIMIT; i++) m.addStaffRequest({ category: 'etc', title: 't' + i }, lee, o);
assert.strictEqual(m.addStaffRequest({ category: 'etc', title: 'over' }, lee, o).status, 429);
console.log('pmStaffRequests tests passed');
