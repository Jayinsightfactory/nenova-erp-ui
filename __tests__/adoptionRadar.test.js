// __tests__/adoptionRadar.test.js — /my-work '도입 레이더' 탭: 관리자(isOrbitReportViewer) 에게만 노출·읽기, 파일 전용(MSSQL 무관).
// 실행: node __tests__/adoptionRadar.test.js  (DB 불필요, 소스 문자열 + 접근 판별 함수만 검사)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const read = (p) => fs.readFileSync(path.join(cwd, p), 'utf8');

// 1) 관리자 판별: 기존 lib/orbitReportAccess 그대로 재사용(새 권한 체계 없음)
const accessSrc = read('lib/orbitReportAccess.js').replace(/^export (const|function) /gm, '$1 ') + '\nmodule.exports = { ORBIT_REPORT_USER_IDS, isOrbitReportViewer };';
const tmpMod = path.join(require('os').tmpdir(), 'orbitReportAccess-' + process.pid + '.cjs');
fs.writeFileSync(tmpMod, accessSrc);
const { isOrbitReportViewer } = require(tmpMod);
fs.unlinkSync(tmpMod);
assert.strictEqual(isOrbitReportViewer({ userId: 'nenovaSS3' }), true, '사장 계정은 관리자');
assert.strictEqual(isOrbitReportViewer({ userId: 'NENOVASS3' }), true, '대소문자 무시');
assert.strictEqual(isOrbitReportViewer({ userId: 'admin' }), false, "'admin' 은 /my-work 관리자 아님(화이트리스트만)");
assert.strictEqual(isOrbitReportViewer({ userId: 'nenova01' }), false);
assert.strictEqual(isOrbitReportViewer(null), false);

// 2) 페이지: 탭은 관리자 목록에만 있고(mineOnly 목록엔 없음), 렌더도 !mineOnly 조건
const page = read('pages/my-work.js');
const tabsStart = page.indexOf('const TABS = mineOnly ?');
assert.ok(tabsStart > 0, 'TABS 정의');
const mineOnlyList = page.slice(tabsStart, page.indexOf(': [', tabsStart));
assert.ok(!/radar/.test(mineOnlyList), 'mineOnly(관리자 아님) 탭 목록에 radar 없음');
assert.ok(/\{ id: 'radar', label: '도입 레이더' \}/.test(page), '관리자 탭 목록에 도입 레이더');
assert.ok(/tab === 'radar' && !mineOnly && <RadarTab \/>/.test(page), 'radar 렌더는 !mineOnly 조건');
assert.ok(/useFeature\('adoption-ledger'\)/.test(page), '데이터는 /api/my-work/feature?name=adoption-ledger 로');
// SSR: 관리자 아니면 mineOnly:true + tab:'mine' 고정(?tab=radar 로 들어와도 radar 안 뜸)
assert.ok(/if \(!isOrbitReportViewer\(user\)\) \{[\s\S]*?mineOnly: true[\s\S]*?tab: 'mine'/.test(page), '비관리자 SSR 은 mineOnly·tab=mine 고정');

// 3) API: 같은 게이트(404 은닉) + adoption-ledger 허용 + 캐시 5분
const api = read('pages/api/my-work/feature.js');
assert.ok(/if \(!isOrbitReportViewer\(user\)\) return res\.status\(404\)/.test(api), '/api/my-work/feature 비관리자 404');
assert.ok(/name === 'adoption-ledger' \? 'private, max-age=300'/.test(api), '도입 레이더 캐시 5분');
assert.ok(!/\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(api) && !/lib\/db/.test(api), 'DB 접근 없음');

// 4) 수신: 기존 feature-data-ingest(토큰) 재사용 — lib 가 adoption-ledger 를 안다
const lib = read('lib/workFeatureData.js');
assert.ok(/'adoption-ledger'\]\)/.test(lib), 'FEATURE_NAMES 에 adoption-ledger');
assert.ok(/name === 'adoption-ledger' \? 'adoption-ledger\.json'/.test(lib), '파일명 adoption-ledger.json');

// 5) 런타임 파일은 git 미추적
assert.ok(/^data\/runtime\/$/m.test(read('.gitignore')), '.gitignore data/runtime/');

console.log('adoptionRadar tests passed: 관리자 판별 재사용·탭 비노출·API 게이트·캐시·파일 전용');
