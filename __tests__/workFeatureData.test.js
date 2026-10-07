// __tests__/workFeatureData.test.js — /my-work 탭2 데이터 자동 갱신: runtime 우선 읽기·업로드 검증·파일 전용 저장·토큰 인증.
// 실행: node __tests__/workFeatureData.test.js  (MSSQL 불필요, 임시 폴더에서 파일만 다룸)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfd-test-'));
const src = fs.readFileSync(path.join(cwd, 'lib', 'workFeatureData.js'), 'utf8')
  .replace(/^import fs from 'fs';/m, "const fs = require('fs');")
  .replace(/^import path from 'path';/m, "const path = require('path');")
  .replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { FEATURE_NAMES, FEATURE_MAX, featureFilePath, saveFeatureFile };';
const modPath = path.join(tmp, 'workFeatureData.cjs');
fs.writeFileSync(modPath, src);
process.chdir(tmp);
const w = require(modPath);

// runtime 없으면 저장소 스냅샷 경로
assert.strictEqual(w.featureFilePath('storyboards'), path.join(tmp, 'data', 'work-feature-storyboards.json'));
assert.strictEqual(w.featureFilePath('../../etc/passwd'), null, '허용 이름만');
assert.deepStrictEqual([...w.FEATURE_NAMES], ['proposals', 'storyboards', 'workflows', 'simulations', 'adoption-ledger']);
// 도입 레이더 장부: 파일명 adoption-ledger.json, updatedAt 만 있어도 받는다
assert.strictEqual(w.featureFilePath('adoption-ledger'), path.join(tmp, 'data', 'adoption-ledger.json'));
assert.strictEqual(w.saveFeatureFile('adoption-ledger', Buffer.from('{"days":[]}')).status, 400, 'adoption-ledger 는 updatedAt 필수');
const al = w.saveFeatureFile('adoption-ledger', Buffer.from(JSON.stringify({ updatedAt: '2026-10-07T05:00:00Z', days: [] })));
assert.ok(al.ok && al.generatedAt === '2026-10-07T05:00:00Z', JSON.stringify(al));
assert.strictEqual(w.featureFilePath('adoption-ledger'), path.join(tmp, 'data', 'runtime', 'adoption-ledger.json'), 'adoption-ledger runtime 우선');
assert.strictEqual(w.featureFilePath('workflows'), path.join(tmp, 'data', 'work-feature-workflows.json'));
assert.strictEqual(w.featureFilePath('simulations'), path.join(tmp, 'data', 'work-feature-simulations.json'));

// 검증: 이름·JSON·generatedAt
assert.strictEqual(w.saveFeatureFile('evil', Buffer.from('{}')).status, 400);
assert.strictEqual(w.saveFeatureFile('proposals', Buffer.from('not json')).status, 400);
assert.strictEqual(w.saveFeatureFile('proposals', Buffer.from('{"people":[]}')).status, 400, 'generatedAt 필수');
assert.strictEqual(w.saveFeatureFile('proposals', Buffer.alloc(0)).status, 400);

// 저장 → runtime 에 쓰이고, 읽기 경로가 runtime 으로 바뀜
const r = w.saveFeatureFile('proposals', Buffer.from(JSON.stringify({ generatedAt: '2026-09-28T07:00:00Z', people: [] })));
assert.ok(r.ok && r.generatedAt === '2026-09-28T07:00:00Z', JSON.stringify(r));
const rt = path.join(tmp, 'data', 'runtime', 'work-feature-proposals.json');
assert.strictEqual(w.featureFilePath('proposals'), rt, 'runtime 우선');
assert.ok(fs.existsSync(rt) && !fs.existsSync(rt + '.tmp'), '임시 파일 남지 않음');
assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'data')), ['runtime'], '저장 위치는 data/runtime 뿐');
assert.ok(w.saveFeatureFile('simulations', Buffer.from(JSON.stringify({ generatedAt: 'x', people: [] }))).ok);
assert.strictEqual(w.featureFilePath('simulations'), path.join(tmp, 'data', 'runtime', 'work-feature-simulations.json'), 'simulations 도 runtime 우선');
process.chdir(cwd);

// API: 토큰 인증·POST 전용·파일 전용(SQL 없음)
const api = fs.readFileSync(path.join(cwd, 'pages', 'api', 'work', 'feature-data-ingest.js'), 'utf8');
assert.ok(/ORBIT_DRIVE_INGEST_TOKEN/.test(api) && /timingSafeEqual/.test(api), '토큰 인증');
assert.ok(/req\.method !== 'POST'/.test(api), 'POST 전용');
assert.ok(!/from '\.\.\/\.\.\/\.\.\/lib\/db'|\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(api), 'DB 접근 없음');

// 페이지가 runtime 우선 경로를 쓰는지
const page = fs.readFileSync(path.join(cwd, 'pages', 'my-work.js'), 'utf8');
// 2026-10 이후 탭 데이터는 /api/my-work/feature 지연 로딩(그 API 가 featureFilePath 사용). 직원 1인분(mineOnly)만 페이지가 직접 읽는다.
assert.ok(/featureFilePath\('workflows'\)/.test(page) && /\/api\/my-work\/feature\?/.test(page), '/my-work 는 featureFilePath·/api/my-work/feature 로 읽음');
const featApi = fs.readFileSync(path.join(cwd, 'pages', 'api', 'my-work', 'feature.js'), 'utf8');
assert.ok(/featureFilePath\(name\)/.test(featApi) && /isOrbitReportViewer/.test(featApi), '/api/my-work/feature 는 featureFilePath + 관리자 게이트');

// runtime 폴더는 git 추적 제외(배포가 덮어쓰지 않게)
assert.ok(/^data\/runtime\/$/m.test(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')), '.gitignore data/runtime/');

console.log('workFeatureData tests passed: runtime 우선·업로드 검증·파일 전용·토큰·gitignore');
