// __tests__/workManuals.test.js — 업무 매뉴얼 열람 규칙(본인 + nenovaSS3)과 저장 파일 격리 검사.
// 실행: node __tests__/workManuals.test.js  (MSSQL 불필요, 임시 폴더에서 파일만 다룸)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'));
fs.mkdirSync(path.join(tmp, 'data', 'work-manuals'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'data', 'work-manuals', 'a.draft.json'), JSON.stringify({
  id: 'a', dept: '영업지원', owner: '설연주', title: '발주', status: 'ai_draft',
  steps: [{ no: 1, title: '카톡 확인', detail: '', app: '', check: '' }, { no: 2, title: '엑셀 반영', detail: '', app: '', check: '' }],
}));
const cwd = process.cwd();
process.chdir(tmp);

// next 문법(import/export) 파일을 CommonJS 테스트에서 읽기 위한 최소 변환
const src = fs.readFileSync(path.join(cwd, 'lib', 'workManuals.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^import \{ isOrbitReportViewer \} from '\.\/orbitReportAccess';/m,
    "const isOrbitReportViewer = (u) => String(u?.userId || '').toLowerCase() === 'nenovass3';")
  .replace(/^export (const|function) /gm, 'exports.__x = 0; $1 ')
  + '\nmodule.exports = { DEPARTMENTS, isManualAdmin, allManuals, canView, visibleManuals, saveManualEdit, getLayout, saveLayout };';
const modPath = path.join(tmp, 'workManuals.cjs');
fs.writeFileSync(modPath, src);
const wm = require(modPath);

const admin = { userId: 'nenovaSS3', userName: '관리자' };
const seol = { userId: 'seol', userName: '설연주' };
const other = { userId: 'kang', userName: '강명훈' };

assert.strictEqual(wm.DEPARTMENTS.length, 4, '부서 4개');
assert.strictEqual(wm.visibleManuals(admin).length, 1, '관리자는 전체');
assert.strictEqual(wm.visibleManuals(seol).length, 1, '본인 매뉴얼 보임');
assert.strictEqual(wm.visibleManuals(other).length, 0, '타인 매뉴얼 안 보임');

const denied = wm.saveManualEdit(other, 'a', { steps: [], confirm: true });
assert.strictEqual(denied.status, 403, '타인 수정 거부');
const ok = wm.saveManualEdit(seol, 'a', { steps: [{ title: '카톡 확인', detail: 'x' }], confirm: true });
assert.ok(ok.ok && ok.manual.status === 'confirmed', '본인 확인 완료');
assert.ok(fs.existsSync(path.join(tmp, 'data', 'work-manuals', '_state.json')), '상태는 파일에만 저장');

assert.ok(wm.saveLayout(seol, 'home', ['import', 'sales-support']), '배치 저장');
assert.deepStrictEqual(wm.getLayout(seol).home, ['import', 'sales-support'], '배치 사람별 조회');
assert.deepStrictEqual(wm.getLayout(other), {}, '남의 배치 영향 없음');
assert.strictEqual(wm.saveLayout(seol, '../x', []), false, '잘못된 키 거부');

process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('workManuals tests passed: 열람 본인+관리자, 타인 수정 403, 파일 저장, 사람별 배치');
