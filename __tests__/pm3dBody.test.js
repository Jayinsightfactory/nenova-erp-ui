// __tests__/pm3dBody.test.js — /pm 3D 선택형 체형(귀염/밸런스/늘씬, lib/pm3dLayout.BODY_TYPES) 검증
// 핵심 보증: 3체형 각각 ① 좌석-책상 정렬(힙=좌판) ② 머리:전신 비율 목표 ③ 장착 소켓(본 스키닝) 존재 ④ 저장 스키마·기본값
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3dbody-'));
  for (const n of ['pm3dLayout', 'pm3dGrid', 'pmThemes']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dGrid.js'", "'./pm3dGrid.mjs'"));
  }
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);
  fs.rmSync(td, { recursive: true, force: true });

  // 1) 프리셋 3종·기본값·방어
  assert.deepStrictEqual(Object.keys(L.BODY_TYPES), ['cute', 'balance', 'slim']);
  assert.strictEqual(L.DEFAULT_BODY_TYPE, 'balance');
  assert.strictEqual(L.bodyTypeOf('nope'), 'balance');
  assert.strictEqual(L.bodyTypeOf(''), 'balance');
  assert.strictEqual(L.look3d({ bodyType: 'cute' }, 'a').bodyType, 'cute');
  assert.strictEqual(L.look3d(null, 'a').bodyType, 'balance');

  // 2) 치비 비율 목표(2026-11-07 사장님 지시: 머리:몸통 = 1:1.2 기본 · 귀염 ≈1:1.0 · 늘씬 ≈1:1.5)
  const want = { cute: [0.9, 1.1], balance: [1.1, 1.3], slim: [1.35, 1.6] };
  for (const [id, [lo, hi]] of Object.entries(want)) {
    const m = L.bodyMetrics(id);
    assert.ok(m.bodyRatio >= lo && m.bodyRatio <= hi, `${id} 머리:몸통 1:${m.bodyRatio.toFixed(2)} (목표 ${lo}~${hi})`);
  }
  // 귀염 < 밸런스 < 늘씬 (키), 머리 크기는 반대
  const ms = ['cute', 'balance', 'slim'].map((i) => L.bodyMetrics(i));
  assert.ok(ms[0].headTop < ms[1].headTop && ms[1].headTop < ms[2].headTop, '키 순서');
  assert.ok(ms[0].headH > ms[1].headH && ms[1].headH > ms[2].headH, '머리 크기 순서');

  // 3) 좌석-책상 정렬: 체형별 seatY + 앉은 힙(CHAR_SCALE 반영) = 의자 좌판(0.46×SET) + 2cm — 세 체형 전부 오차 0
  for (const id of Object.keys(L.BODY_TYPES)) {
    const m = L.bodyMetrics(id);
    const hip = m.seatY + m.sitHip * L.CHAR_SCALE;
    assert.ok(Math.abs(hip - (0.46 * L.SET_SCALE + 0.02)) < 1e-9, `${id} 좌석 정렬 ${hip}`);
  }

  // 4) 장착 소켓: char.glb 에 head 본 + 착용 메시(모자/안경/손/종족)가 실재(본 스키닝 → 체형 스케일 자동 추종)
  const glb = fs.readFileSync(path.join(process.cwd(), 'public', 'pm3d', 'char.glb'));
  const json = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)).toString());
  const nodeNames = new Set((json.nodes || []).map((n) => n.name));
  for (const need of ['head', 'chest', 'hand.r', 'hat_cap', 'gls_sun', 'race_cat']) {
    assert.ok(nodeNames.has(need), `char.glb 노드 ${need}`);
  }
  // 체형 런타임 스케일이 클립과 충돌하지 않게: glb 의 scale 채널은 전부 상수 1 이고, 장면이 로드 시 scale 트랙을 제거한다
  for (const a of json.animations || []) {
    for (const ch of a.channels) {
      if (ch.target.path !== 'scale') continue;
      const acc = json.accessors[a.samplers[ch.sampler].output];
      for (const v of [...(acc.min || []), ...(acc.max || [])]) assert.ok(Math.abs(v - 1) < 1e-4, `클립 ${a.name} scale≠1 (체형 스케일과 충돌)`);
    }
  }

  // 5) 장면·저장·미리보기 경유: Scene3D 가 head 본 스케일·seatY·블롭을 적용, 꾸미기 저장이 bodyType 허용, 미리보기가 체형 세트 선택
  const scene = fs.readFileSync('components/pm3d/Scene3D.js', 'utf8');
  assert.ok(/bodyMetrics\(L\.bodyType\)/.test(scene) && /hb\.scale\.setScalar\(BM\.head\)/.test(scene), 'Scene3D 체형 적용');
  assert.ok(/P\.home\.y = BM\.seatY/.test(scene) && /blobChar/.test(scene), 'Scene3D 좌석·블롭 추종');
  const av = fs.readFileSync('lib/pmAvatars.js', 'utf8');
  assert.ok(/bodyType: \['cute', 'balance', 'slim'\]/.test(av), '저장 스키마 bodyType(무료)');
  const theme = fs.readFileSync('components/pm/PmTheme.js', 'utf8');
  assert.ok(/bsfx/.test(theme) && /3D 체형/.test(theme), '꾸미기 UI·미리보기 체형');

  console.log('pm3dBody OK —', ms.map((m) => `${m.id} 머리:몸통 1:${m.bodyRatio.toFixed(2)}`).join(' · '));
})().catch((e) => { console.error(e); process.exit(1); });
