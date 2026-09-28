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
process.chdir(cwd);

// API: 토큰 인증·POST 전용·파일 전용(SQL 없음)
const api = fs.readFileSync(path.join(cwd, 'pages', 'api', 'work', 'feature-data-ingest.js'), 'utf8');
assert.ok(/ORBIT_DRIVE_INGEST_TOKEN/.test(api) && /timingSafeEqual/.test(api), '토큰 인증');
assert.ok(/req\.method !== 'POST'/.test(api), 'POST 전용');
assert.ok(!/from '\.\.\/\.\.\/\.\.\/lib\/db'|\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(api), 'DB 접근 없음');

// 페이지가 runtime 우선 경로를 쓰는지
const page = fs.readFileSync(path.join(cwd, 'pages', 'my-work.js'), 'utf8');
assert.ok(/featureFilePath\('storyboards'\)/.test(page) && /featureFilePath\('proposals'\)/.test(page), '/my-work 는 featureFilePath 로 읽음');

// runtime 폴더는 git 추적 제외(배포가 덮어쓰지 않게)
assert.ok(/^data\/runtime\/$/m.test(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')), '.gitignore data/runtime/');

console.log('workFeatureData tests passed: runtime 우선·업로드 검증·파일 전용·토큰·gitignore');
