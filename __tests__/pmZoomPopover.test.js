// __tests__/pmZoomPopover.test.js — /pm 장면 축소 하한(맞춤 아래까지)·팝오버 버튼(상세·꾸미기) 클릭 생존 회귀
// 실행: node __tests__/pmZoomPopover.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'lib', 'pmZoom.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmzoom-')), 'pmZoom.cjs');
fs.writeFileSync(tmp, src + '\nmodule.exports = { ZOOM_MIN, ZOOM_MAX, clampZoom, clampView, zoomViewAt, stepZoom, shouldCloseOnUp };');
const Z = require(tmp);

// 1) 축소 하한: 맞춤(1) 아래로 내려가고 ZOOM_MIN(0.4)에서 멈춤
assert.ok(Z.ZOOM_MIN < 1 && Z.ZOOM_MIN <= 0.4, 'ZOOM_MIN 은 맞춤 미만');
let v = { z: 1, x: 0, y: 0 };
v = Z.zoomViewAt(v, 0.8, 1000, 600); assert.ok(v.z < 1, `100%에서 − 한 번에 축소돼야 함 (z=${v.z})`);
assert.ok(Math.abs(v.x - (1000 - 1000 * v.z) / 2) < 1e-6, '축소 시 가로 가운데 정렬');
for (let i = 0; i < 20; i += 1) v = Z.zoomViewAt(v, 0.8, 1000, 600);
assert.strictEqual(v.z, Z.ZOOM_MIN, '하한에서 멈춤');
for (let i = 0; i < 20; i += 1) v = Z.zoomViewAt(v, 1.25, 1000, 600);
assert.strictEqual(v.z, Z.ZOOM_MAX, '상한');
const fitted = Z.clampView({ z: 1, x: 0, y: 0 }, 1000, 600); assert.deepStrictEqual(fitted, { z: 1, x: 0, y: 0 });
// 3D 단계형
assert.strictEqual(Z.stepZoom(1, -1), 0.8); assert.strictEqual(Z.stepZoom(0.4, -1), 0.4);
assert.strictEqual(Z.stepZoom(0.8, 1), 1); assert.strictEqual(Z.stepZoom(1, 1), 1.5); assert.strictEqual(Z.stepZoom(1.5, -1), 1);

// 2) 팝오버 버튼에서 시작된 누름(drag 미기록) → pointerup 이 팝오버를 닫으면 안 됨(닫으면 click 전 언마운트 = 상세·꾸미기 먹통)
assert.strictEqual(Z.shouldCloseOnUp(null), false, '버튼/팝오버 누름은 닫지 않음');
assert.strictEqual(Z.shouldCloseOnUp(undefined), false);
assert.strictEqual(Z.shouldCloseOnUp({ moved: false }), true, '장면 빈 곳 탭은 닫음');
assert.strictEqual(Z.shouldCloseOnUp({ moved: true }), false, '드래그는 닫지 않음');

// 3) 배선: BgScene 이 공용 규칙을 쓰고, 버튼·팝오버는 드래그 시작에서 제외, preventDefault 로 click 을 삼키지 않음
const bg = fs.readFileSync(path.join(root, 'components', 'pm', 'BgScene.js'), 'utf8');
assert.ok(/shouldCloseOnUp\(d0\)/.test(bg), 'onPointerUp 은 shouldCloseOnUp 사용');
assert.ok(/closest\('\[role="button"\],button,\.iso-pop'\)\) return;/.test(bg), '팝오버·버튼 누름은 드래그 미시작');
const down = bg.slice(bg.indexOf('const onPointerDown'), bg.indexOf('const onKey'));
assert.ok(!/preventDefault|stopPropagation/.test(down), '포인터 핸들러가 click 을 막지 않음');
assert.ok(/disabled=\{zv\.z <= ZMIN\}/.test(bg) && /ZMIN = ZOOM_MIN/.test(bg), '− 버튼은 ZOOM_MIN 에서만 비활성');
assert.ok(!/onWheel|'wheel'/.test(bg), '휠 확대 금지 유지');
const s3 = fs.readFileSync(path.join(root, 'components', 'pm3d', 'Scene3D.js'), 'utf8');
assert.ok(/stepZoom\(z, -1\)/.test(s3) && !/Math\.max\(1, \+\(z - 0\.5\)/.test(s3), '3D − 버튼 축소 가능');
assert.ok(!/'wheel'|onWheel/.test(s3), '3D 휠 확대 금지 유지');
// 팝오버 버튼 핸들러가 onOpenPerson 을 호출
const iso = fs.readFileSync(path.join(root, 'components', 'pm', 'IsoScene.js'), 'utf8');
assert.ok(/onClick=\{\(\) => \{ close\(\); onOpenPerson\(x\.name\); \}\}>상세/.test(iso));
assert.ok(/onOpenPerson\(x\.name, 'look'\); \}\}>꾸미기/.test(iso));
console.log('pmZoomPopover OK');
