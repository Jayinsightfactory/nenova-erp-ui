// __tests__/pm3dLayout.test.js — /pm 3D(베타): 책상 배치 겹침 없음·스테이션 9개·외형 매핑·저사양 폴백·라벨 겹침 회피·에셋 용량.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pm3d-'));
  for (const n of ['pm3dLayout', 'pm3dGrid', 'pmThemes']) fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8').replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dGrid.js'", "'./pm3dGrid.mjs'"));
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href); fs.rmSync(td, { recursive: true, force: true });
  const rooms = [['영업지원', 3], ['수입부', 2], ['영업부', 3], ['경영지원', 1], ['미배치', 5]].map(([dept, n]) => ({ dept, seats: Array.from({ length: n }, (_, i) => ({ name: `${dept}${i}`, status: i % 2 ? 'off' : 'working' })) }));
  const { desks } = L.layoutDesks(rooms);
  assert.strictEqual(desks.length, 14);
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) {
    const a = desks[i]; const b = desks[j];
    assert.ok(Math.abs(a.x - b.x) >= 1.9 || Math.abs(a.z - b.z) >= 1.9, `책상 겹침 ${a.name}/${b.name}`);
  }
  for (const d of desks) assert.ok(Math.abs(d.z) >= 3, '책상이 스테이션 복도를 침범');
  // 뒤통수 금지: 모든 좌석 방향 · 카메라 방향 내적 > 0.3
  for (const d of desks) assert.ok(L.facingDot(d.yaw) > 0.3, `좌석이 카메라 반대쪽: ${d.name} dot=${L.facingDot(d.yaw).toFixed(2)}`);
  for (let i = 0; i < 30; i++) assert.ok(L.facingDot(L.seatYaw(i)) > 0.99, '일자 라인: 전원 카메라 정면');
  // 일자 라인: z 값은 격자 섬 자리 줄(lib/pm3dGrid HUB_BANDS → 광장 남/북 ±4.8, ±8.4, ±10.8) 위에만
  for (const d of desks) assert.ok([4.8, 8.4, 10.8].includes(Math.abs(+d.z.toFixed(1))), `책상이 줄 밖: ${d.name} z=${d.z}`);
  const st1 = L.deskStyle('영업지원', '', ['#a', '#b']); assert.ok(L.DESK_MODELS.includes(st1.model) && st1.color);
  assert.strictEqual(L.deskStyle('x', '#own', ['#a']).color, '#own');
  // 연결선 아치-캐릭터 바운딩 교차 0: 모든 좌석→모든 스테이션 아치를 샘플링,
  // 다른 좌석 반경 0.45m 안에서는 높이가 머리(2.2m)보다 위여야 한다.
  {
    const seats = desks.map((d) => L.seatWorld(d));
    for (const d of desks) {
      const s0 = L.seatWorld(d);
      for (let st2 = 1; st2 <= 9; st2++) {
        const sp = L.stationPos(st2);
        for (let k = 0; k <= 40; k++) {
          const t = k / 40;
          const x = s0.x + (sp.x - s0.x) * t; const z = s0.z + (sp.z - s0.z) * t; const y = L.arcY(t);
          for (const o of seats) {
            if (o === s0 && t < 0.02) continue;
            const dd = Math.hypot(x - o.x, z - o.z);
            if (dd < 0.45) assert.ok(y > L.CHAR_TOP, `연결선이 캐릭터 관통: t=${t} y=${y.toFixed(2)}`);
          }
        }
      }
    }
  }
  // 비율: 1440x720 화면 100% 기본 배율에서 캐릭터 90~110px, 9 스테이션 전부 보임
  const { hx, hz } = L.floorBounds(desks);
  const fit = L.sceneFit(hx, hz);
  const px = L.charPixelHeight(720, fit);
  assert.ok(px >= 90 && px <= 110, `캐릭터 화면 높이 ${px.toFixed(0)}px (목표 90~110)`);
  assert.ok((fit / L.DEFAULT_ZOOM) * 2 >= L.stationPos(9).x + 0.4, '기본 배율에서 9 스테이션 전부 보임(1440 화면)');
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => L.stationPos(n).x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]));
  const lk = L.look3d({ items: { outfit: 'outfit.aloha', hat: 'hat.straw', deskL: 'desk.mug', pet: 'pet.cat' }, skin: 1, hairColor: 2 }, '홍길동');
  assert.deepStrictEqual([lk.top, lk.bottom, lk.hat, lk.pet, lk.props.length], ['#ff9a3c', '#3ab0c8', 'hat_straw', true, 1]);
  assert.strictEqual(L.look3d(null, 'a').hat, '');
  // 머리 모양·소품: 이름으로 고정 배정(같은 이름 = 같은 모습), 모자를 쓰면 앞머리만·소품 없음, 종족(고양이 등)은 소품 없음
  assert.strictEqual(lk.hairStyle, 'bangs'); assert.strictEqual(lk.acc, '');
  const staff = ['설연주', '강현우', '임재용', '가브리엘', '김원빈', '박성수', '정재훈', '조현욱', '강명훈'];
  const looks = staff.map((n) => L.look3d(null, n));
  for (const x of looks) { assert.ok(L.HAIR_STYLES.includes(x.hairStyle)); assert.ok(L.HAIR_ACCS.includes(x.acc)); }
  assert.deepStrictEqual(looks.map((x) => x.hairStyle), staff.map((n) => L.look3d(null, n).hairStyle), '머리 모양 배정이 매번 달라짐');
  assert.ok(new Set(looks.map((x) => x.hairStyle)).size >= 3, '직원 9명 머리 모양이 3종 미만(개성 부족)');
  assert.strictEqual(L.look3d({ char: 'cat' }, '설연주').acc, '');
  assert.strictEqual(L.look3d({ hairStyle: 'pony', acc: 'band' }, '아무개').hairStyle, 'pony');
  assert.strictEqual(L.animOf({ status: 'off' }).clip, 'doze');
  assert.strictEqual(L.animOf({ status: 'working' }).clip, 'sit_type');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 3500, fps: 60 }), 'slow-first-frame');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 9 }), 'low-fps');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 12 }), '');
  assert.deepStrictEqual([L.MIN_FPS, L.FPS_WARMUP_MS, L.FPS_WINDOW_MS, L.FPS_CAP, L.FPS_IDLE, L.MAX_DPR], [10, 3000, 5000, 15, 8, 1.25]);
  // 회귀(2026-11-07 사장님 스크린샷): 한 줄로 선 로봇 이름표 8개가 아래로 계단식으로 쌓여 잘림 → 위·아래 번갈아 두 줄 안에 수납
  const row = L.declutter(Array.from({ length: 8 }, (_, i) => ({ key: 'rb' + i, x: 100 + i * 45, y: 400, w: 80, h: 14 })));
  for (let i = 0; i < row.length; i++) for (let j = 0; j < i; j++) { const p = row[i], q = row[j]; assert.ok(!(Math.abs(p.x - q.x) < (p.w + q.w) / 2 && Math.abs(p.y - q.y) < p.h), `로봇 이름표 겹침 ${p.key}/${q.key}`); }
  assert.ok(Math.max(...row.map((r) => r.y)) - Math.min(...row.map((r) => r.y)) <= 2 * 17 + 1, '로봇 이름표가 계단식으로 멀리 밀림');
  assert.strictEqual(L.shouldFallback({ firstFrameMs: 200, fps: 55 }), '');
  const out = L.declutter([{ key: 'a', x: 100, y: 50, w: 60, h: 18 }, { key: 'b', x: 110, y: 55, w: 60, h: 18 }, { key: 'c', x: 400, y: 52, w: 60, h: 18 }]);
  const a = out.find((o) => o.key === 'a'); const b = out.find((o) => o.key === 'b');
  assert.ok(b.y >= a.y + a.h, '라벨 겹침'); assert.strictEqual(out.find((o) => o.key === 'c').y, 52);
  // 에셋: 존재·첫 로드 합계 8MB 이하·필수 모듈·클립
  const dir = path.join(process.cwd(), 'public/pm3d');
  const files = ['kit.glb', 'char.glb', 'draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js'];
  const total = files.reduce((s, x) => s + fs.statSync(path.join(dir, x)).size, 0);
  assert.ok(total < 8 * 1024 * 1024, `3D 첫 로드 ${total}B > 8MB`);
  const gl = (n) => { const b = fs.readFileSync(path.join(dir, n)); return JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString()); };
  const kit = gl('kit.glb'); const names = new Set(kit.nodes.map((n) => n.name));
  for (const m of ['floor_b', 'floor_i', 'wall', 'desk', 'desk_b', 'desk_c', 'chair', 'desk_k1', 'desk_k2', 'desk_k3', 'chair_k1', 'chair_k2', 'plant_k1', 'plant_k2', 'lamp_k', 'rug_k', 'shell', 'starfish', 'monitor', 'robot', 'plant', 'mug', 'parcel', 'palm', 'parasol', 'boardwalk', 'hut', 'sea', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `station_${n}`)]) assert.ok(names.has(m), `kit 모듈 없음: ${m}`);
  const ch = gl('char.glb'); const clips = ch.animations.map((x) => x.name);
  for (const c of ['idle', 'sit_type', 'walk', 'doze', 'dance']) assert.ok(clips.includes(c), `클립 없음: ${c}`);
  for (const h of ['hat_cap', 'hat_straw', 'hat_crown']) assert.ok(ch.nodes.some((n) => n.name === h), `모자 없음: ${h}`);
  // 직원별 개성(2026-11-07 detail_char.py): 머리 모양 6종·머리 소품 4종 메시가 char.glb 안에 있어야 look3d 값이 그려진다
  for (const id of L.HAIR_STYLES) assert.ok(ch.nodes.some((n) => n.name === 'hs_' + id), `머리 모양 없음: hs_${id}`);
  for (const id of L.HAIR_ACCS.filter(Boolean)) assert.ok(ch.nodes.some((n) => n.name === 'acc_' + id), `머리 소품 없음: acc_${id}`); // 모자 16종 전용 메시(build_wearables.py), 전수는 pmProps3d.test.js
  // 휠 확대 금지(사장님 지시)
  const src = fs.readFileSync(path.join(process.cwd(), 'components/pm3d/Scene3D.js'), 'utf8');
  assert.ok(!/['"]wheel['"]/.test(src), '3D 장면에 휠 핸들러 금지');
  assert.ok(/data-k=\{'w:' \+ p\.name\}/.test(src) && !/\{p\.name\}\{l\?\.text/.test(src), '이름·작업 칩 분리');
  assert.ok(/MAX_DPR/.test(src) && /FPS_CAP/.test(src) && /IntersectionObserver/.test(src), '3D 프레임 상한·화면밖 정지');
  // 회귀(2026-11-07 실서버 "3D 흰 화면"): WebGL 컨텍스트 유실 시 캔버스만 비고 이름표만 남던 것 → 복구 대기 후 못 살리면 2D 로 넘김
  assert.ok(/webglcontextlost/.test(src) && /webglcontextrestored/.test(src) && /onFallback\?\.\('webgl-context-lost'\)/.test(src) && /isContextLost\(\)/.test(src), 'WebGL 컨텍스트 유실 대응 없음');
  assert.ok(!/d\.face/.test(src), '옛 좌석 방향(face) 사용 금지');
  // 회귀: 로봇 칩(실측 170px) ↔ 작업 칩 겹침 — 실제 DOM 크기 기반 declutter (2026-11-04 사장님 스크린샷 버그)
  const over = L.declutter([
    { key: 'w:설연주', x: 300, y: 100, w: 150, h: 30 },
    { key: 'rb0', x: 360, y: 110, w: 170, h: 18 },
  ]);
  const [wa, rb] = [over.find((o) => o.key === 'w:설연주'), over.find((o) => o.key === 'rb0')];
  assert.ok(rb.y >= wa.y + wa.h, '로봇 칩이 작업 칩 위에 겹침');
  assert.ok(/offsetWidth/.test(src) && /sizeOf/.test(src), '라벨 declutter 는 실측 크기 사용');
  // 새 리그 클립(응원·손흔들기·여분 춤)과 표정 데칼
  for (const c of ['cheer', 'wave']) assert.ok(clips.includes(c), `클립 없음: ${c}`);
  assert.ok((ch.materials || []).some((m) => m.name === 'face'), '표정 데칼(face 재질) 없음');
  const faceDir = path.join(dir, 'face');
  for (const f of ['smile', 'grin', 'focus', 'wow', 'wink', 'sleepy', 'fire', 'proud', 'shy', 'teary', 'sing', 'thinking']) assert.ok(fs.existsSync(path.join(faceDir, f + '.webp')), `표정 없음: ${f}`);
  // 회귀(2026-11-04 사장님 스크린샷): 의자+캐릭터가 책상에서 분리 — 좌석은 자기 책상에서 일정 거리 이내여야 한다.
  for (const d of desks) {
    const s = L.seatWorld(d);
    const dist = Math.hypot(s.x - d.x, s.z - d.z);
    assert.ok(Math.abs(dist - L.SEAT_OFF) < 1e-9 && dist <= 1.0, `좌석-책상 거리 이탈: ${d.name} ${dist.toFixed(2)}m`);
  }
  // mapScale(1.5)은 바닥만 키운다 — 책상·좌석은 항상 확장된 바닥 안
  {
    const { hx, hz } = L.floorBounds(desks, 1.5);
    for (const d of desks) { const s = L.seatWorld(d); assert.ok(Math.abs(d.x) < hx && Math.abs(d.z) < hz && Math.abs(s.x) < hx && Math.abs(s.z) < hz, `mapScale 바닥 밖: ${d.name}`); }
  }
  // Kenney 가구 피벗 보정: 책상·의자는 bbox 로 재중심(모서리 피벗 그대로 두면 책상이 대각선으로 밀림), 노트북은 실측 상판 높이
  assert.ok(/setFromObject\(desk\)/.test(src) && /-dbb\.min\.y/.test(src), '책상 피벗 재중심 없음');
  assert.ok(/setFromObject\(chair\)/.test(src) && /-SEAT_Z - cc\.z/.test(src), '의자 피벗 재중심 없음');
  assert.ok(/deskTopY \+ 0\.01/.test(src) && !/DESK_H \+ 0\.01/.test(src), '노트북이 고정 DESK_H 공중부양');
  console.log(`pm3dLayout OK (assets ${(total / 1024).toFixed(0)}KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
