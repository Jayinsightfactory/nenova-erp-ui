// __tests__/orbitThumbs.test.js — /api/work/orbit-thumbs: 권한 게이트·id 검증·GET 전용·DB 없음, /my-work 업무 흐름·시뮬레이터 연결.
// 실행: node __tests__/orbitThumbs.test.js  (네트워크·MSSQL 불필요, 정적 계약 + 픽스처 스키마)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
const api = fs.readFileSync(path.join(cwd, 'pages', 'api', 'work', 'orbit-thumbs.js'), 'utf8');

assert.ok(/withAuth\(/.test(api), 'withAuth 로그인 필수');
assert.ok(/isOrbitReportViewer\(req\.user\)/.test(api) && /status\(404\)/.test(api), 'nenovaSS3 게이트(404 은닉)');
assert.ok(/req\.method !== 'GET'/.test(api), 'GET 전용');
assert.ok(!/lib\/db'|\b(SELECT|INSERT|UPDATE|DELETE)\s/i.test(api), 'DB 접근 없음');
assert.ok(/ORBIT_OWNER_TOKEN/.test(api) && /Bearer/.test(api), 'Orbit 토큰 Bearer');
assert.ok(/\/api\/vision\/thumbnails\?/.test(api) && /\/api\/vision\/thumbnail\/\$\{encodeURIComponent\(id\)\}/.test(api), 'Orbit 경로');
assert.ok(/'Cache-Control', 'private, max-age=86400'/.test(api) && /image\/jpeg/.test(api), '이미지 캐시 헤더');

// id 정규식 동작
const re = new RegExp(api.match(/const ID_RE = \/(.+)\/;/)[1]);
for (const ok of ['1727500000000-abc', 'ev_1.2:3']) assert.ok(re.test(ok), ok);
for (const bad of ['../etc', 'a/b', 'a b', '', 'x?y=1']) assert.ok(!re.test(bad), 'reject ' + bad);

// normalizeThumb (import 제거 후 평가)
const src = api.replace(/^import .*$/mg, '').replace(/export default withAuth[\s\S]*$/, '').replace(/^export (const|function) /gm, '$1 ');
const normalizeThumb = new Function(src + '\nreturn normalizeThumb;')();
assert.deepStrictEqual(normalizeThumb({ id: 'e1', timestamp: 't', app: 'Excel', activity: 'a', screen: 's', hint: 'h', extra: 1 }), { id: 'e1', timestamp: 't', app: 'Excel', activity: 'a', screen: 's', hint: 'h' });
assert.strictEqual(normalizeThumb({ id: '../x' }), null);
assert.strictEqual(normalizeThumb(null), null);

// /my-work 연결: 업무 흐름 기본 탭·썸네일 API·시뮬레이터·폴백
const page = fs.readFileSync(path.join(cwd, 'pages', 'my-work.js'), 'utf8');
assert.ok(/featureFilePath\('workflows'\)/.test(page) && /featureFilePath\('simulations'\)/.test(page), 'runtime 우선 경로');
assert.ok(/tab: query\.tab \|\| 'workflows'/.test(page), '업무 흐름이 기본 탭');
assert.ok(/\/api\/work\/orbit-thumbs\?user=/.test(page) && /\/api\/work\/orbit-thumbs\?img=/.test(page), '썸네일 목록·이미지 프록시 사용');
assert.ok(/캡처는 있으나 해독 안 됨/.test(page), '해독 0건 안내');
assert.ok(/<Simulator sims=\{simulations\} fallback=\{<Proposals data=\{data\} \/>\} \/>/.test(page), '시뮬레이터 + 텍스트 폴백');
assert.ok(/drawImage\(/.test(page), '영상 슬라이드에 캡처 삽입');

// 시뮬레이션 픽스처 스키마
const sim = JSON.parse(fs.readFileSync(path.join(cwd, '__tests__', 'fixtures', 'work-feature-simulations.sample.json'), 'utf8'));
assert.ok(sim.generatedAt && sim.people.length);
for (const p of sim.people) for (const it of p.items) {
  assert.ok(it.title && it.before && it.after && Array.isArray(it.before.steps) && it.after.screen && Array.isArray(it.after.steps));
  assert.strictEqual(it.before.steps.reduce((a, s) => a + s.minutes, 0), it.before.totalMinutes);
  assert.ok(it.after.screen.table.rows.every((r) => r.length === it.after.screen.table.columns.length));
}
console.log('orbitThumbs tests passed: 게이트·id검증·GET전용·Orbit 프록시·/my-work 연결·시뮬레이션 픽스처');
