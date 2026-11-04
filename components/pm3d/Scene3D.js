// components/pm3d/Scene3D.js — /pm 사무실 3D(베타). three.js 직교 아이소메트릭 카메라.
// 에셋: public/pm3d/kit.glb(모듈) · char.glb(리그+클립 idle/sit_type/walk/doze/dance) — scripts/pm3d/build_assets.py 로 생성.
// 확대·축소 = 배율 바(1% 단위)·맞춤 버튼만(휠 확대 없음). 확대했을 때만 드래그 이동.
// WebGL 없음·로드 실패·저사양(첫 프레임 3초 초과 / FPS<20)이면 onFallback(reason) → 부모가 2D 장면을 보여 준다.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { STAGES } from '../../lib/pmStages';
import { layoutDesks, floorBounds, stationPos, look3d, animOf, shouldFallback, declutter, CAM_DIR, CAM_YAW, FPS_CAP, FPS_IDLE, IDLE_AFTER_MS, FPS_WARMUP_MS, FPS_WINDOW_MS, MAX_DPR, CHAR_SCALE, SET_SCALE, PROP_SCALE, DEFAULT_ZOOM, sceneFit, deskStyle, ARC_Y } from '../../lib/pm3dLayout';
import { usePmTheme } from '../pm/PmTheme';
import { PM3D } from '../../lib/pmThemes';
import { pctToZoom, ZOOM_PCT_MIN, ZOOM_PCT_MAX } from '../../lib/pmZoom';
import { ZoomSlider } from '../pm/ui';

const THEMES = PM3D.THEMES; const U = PM3D.ui;
export const PM3D_THEMES = Object.keys(THEMES);
const STAGE_HEX = PM3D.STAGE;
// 책상 위 소품 슬롯(좌/중/우, 자리 그룹 로컬 좌표)과 펫 자리(책상 옆 바닥) — 구매 소품·펫이 3D 에서도 보이게
const PROP_SLOTS = [new THREE.Vector3(-0.61, 0.72 * 1.45 + 0.005, 0.22), new THREE.Vector3(0, 0.72 * 1.45 + 0.005, 0.3), new THREE.Vector3(0.61, 0.72 * 1.45 + 0.005, 0.22)];
const PET_SLOT = new THREE.Vector3(1.25, 0.22, 0.35);
const SEAT_Z = 0.62 * SET_SCALE; // 그룹 안 캐릭터·의자 위치(-Z = 책상 뒤, 캐릭터는 +Z = 카메라 쪽을 봄)
const SEAT_Y = 0.46 * SET_SCALE - 0.42 * CHAR_SCALE + 0.02; const DESK_H = 0.72 * SET_SCALE; const HEAD_Y = 1.95 * CHAR_SCALE + 0.35; // 앉은 엉덩이(리그 0.42)를 의자 좌판(0.46)에 맞춤

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}
let kitP = null;
function loadAssets() {
  if (kitP) return kitP;
  const draco = new DRACOLoader(); draco.setDecoderPath('/pm3d/draco/'); draco.setDecoderConfig({ type: 'wasm' });
  const l = new GLTFLoader(); l.setDRACOLoader(draco);
  const t0 = performance.now();
  kitP = Promise.all([l.loadAsync('/pm3d/kit.glb'), l.loadAsync('/pm3d/char.glb')]).then(([kit, ch]) => ({ kit, ch, loadMs: Math.round(performance.now() - t0) }));
  kitP.catch(() => { kitP = null; });
  return kitP;
}
function laptop() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: U.laptop, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.24), body); base.position.y = 0.01; base.castShadow = true; g.add(base);
  const lid = new THREE.Group(); lid.position.set(0, 0.02, 0.12); lid.rotation.x = 0.35; // 화면 윗부분이 카메라 쪽으로 젖혀짐 g.add(lid);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.015), body); back.position.y = 0.1; back.castShadow = true; lid.add(back);
  const scr = new THREE.MeshStandardMaterial({ color: U.screenOn, emissive: U.screenOn, emissiveIntensity: 0.6, roughness: 1 }); scr.name = 'screen';
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.17), scr); face.position.set(0, 0.1, -0.009); face.rotation.y = Math.PI; lid.add(face);
  return g;
}
function emojiSprite(txt) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 36);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(0.8, 0.8, 1); s.renderOrder = 10; return s;
}

export default function Scene3D({ themeId = 'I', rooms, agents, links, reduced, onOpenPerson, onPickStage, onFallback }) {
  const { avatars } = usePmTheme();
  const host = useRef(null); const labelsRef = useRef(null);
  const api = useRef(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [stat, setStat] = useState('');
  const dataRef = useRef({ rooms, agents, links, avatars, reduced });
  dataRef.current = { rooms, agents, links, avatars, reduced };
  const T = THEMES[themeId] || THEMES.I;

  // 장면 생성(테마 바뀌면 다시)
  useEffect(() => {
    const el = host.current; if (!el) return undefined;
    if (!webglOk()) { onFallback?.('no-webgl'); return undefined; }
    let dead = false; let raf = 0;
    const mountAt = performance.now();
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(T.bg);
    scene.add(new THREE.HemisphereLight(U.hemiSky, U.hemiGround, 1.6));
    const sun = new THREE.DirectionalLight(T.light, 2.0); sun.position.set(-12, 22, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; sun.shadow.bias = -0.0008;
    scene.add(sun); scene.add(sun.target);
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    const pan = new THREE.Vector3();
    const st = { fit: 10, zoom: 1, people: new Map(), stations: [], robots: [], lines: [], clickables: [], built: false, clock: new THREE.Clock(), frames: 0, fpsT0: 0, firstFrame: null, checked: false };
    const placeCam = () => {
      const w = el.clientWidth || 800; const h = el.clientHeight || 500; const a = w / h;
      const half = st.fit / st.zoom;
      cam.left = -half * a; cam.right = half * a; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
      cam.position.set(42.4 * CAM_DIR.x + pan.x, 30, 42.4 * CAM_DIR.z + pan.z); cam.lookAt(pan.x, 0, pan.z);
      renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    };
    const ro = new ResizeObserver(placeCam); ro.observe(el);

    const build = ({ kit, ch, loadMs }) => {
      const mod = (n) => { const o = kit.scene.getObjectByName(n); if (!o) return new THREE.Group(); const c = o.clone(true); c.position.set(0, 0, 0); c.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return c; };
      const put = (n, x, z, ry = 0, s = 1) => { const o = mod(n); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s); scene.add(o); return o; };
      const { desks, plates } = layoutDesks(dataRef.current.rooms);
      const { hx, hz } = floorBounds(desks);
      st.fit = sceneFit(hx, hz); placeCam();
      sun.shadow.camera.left = -hx - 4; sun.shadow.camera.right = hx + 4; sun.shadow.camera.top = hz + 4; sun.shadow.camera.bottom = -hz - 4; sun.shadow.camera.far = 80; sun.shadow.camera.updateProjectionMatrix();
      for (let x = -hx + 1; x < hx; x += 2) for (let z = -hz + 1; z < hz; z += 2) { const f = put(T.floor, x, z); f.traverse((m) => { if (m.isMesh) m.castShadow = false; }); }
      // 테마 장식
      if (T.props === 'office') {
        for (let x = -hx + 1; x < hx; x += 2) put('wall', x, -hz);
        for (let z = -hz + 1; z < hz; z += 2) put('wall', -hx, z, Math.PI / 2);
        [[-hx + 1, -hz + 1.2], [hx - 1, -hz + 1.2], [hx - 1, hz - 1], [-hx + 1.2, hz - 1]].forEach(([x, z]) => put('plant', x, z));
        put('parcel', hx - 2.4, -hz + 1.3); put('parcel', hx - 2.9, -hz + 1.6, 0.5, 0.8);
        for (const p of plates) put('partition', p.x, p.z - Math.sign(p.z) * 0.1);
      } else {
        for (let x = -hx + 1; x < hx; x += 2) { put('sea', x, -hz - 1); put('sea', x, -hz - 3); }
        for (let x = -hx + 1; x < hx; x += 2) put('boardwalk', x, 0, Math.PI / 2);
        [[-hx + 0.8, -hz + 1], [hx - 0.8, -hz + 1.4], [-hx + 0.9, hz - 1], [hx - 1, hz - 1.2], [0, -hz + 0.9]].forEach(([x, z], i) => put('palm', x, z, i));
        put('hut', -hx + 1.6, -2.4); put('hut', hx - 1.6, 2.4); put('rock', -hx + 2, -hz + 1.5); put('rock', hx - 3, hz - 0.8);
        for (const p of plates) { put('parasol', p.x, p.z, 0, 1.1); put('surfboard', p.x + 2.6, p.z, 0.3); }
      }
      // 스테이션 1~9
      STAGES.forEach((s) => {
        const p = stationPos(s.no); const o = put(`station_${s.no}`, p.x, p.z);
        o.userData = { kind: 'stage', no: s.no, label: s.label }; st.stations.push(o); st.clickables.push(o);
      });
      // 연구실 로봇(AI 에이전트) — 뒤쪽 줄
      (dataRef.current.agents || []).slice(0, 8).forEach((a, i) => {
        const o = put('robot', -hx + 2 + i * 1.8, hz - 1.9, 0, 0.8); o.userData = { kind: 'robot', name: a.name || a.id, status: a.status, baseY: 0, i };
        o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; } });
        st.robots.push(o);
      });
      // 직원 자리
      for (const d of desks) {
        const g = new THREE.Group(); g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; scene.add(g);
        const dstyle = deskStyle(d.dept, '', PM3D.DESK_SKINS);
        const desk = mod(dstyle.model); desk.scale.setScalar(SET_SCALE); g.add(desk);
        if (dstyle.color) desk.traverse((m) => { if (m.isMesh && /^desk/.test(m.material?.name || '')) { m.material = m.material.clone(); m.material.color.set(dstyle.color); } });
        // 낮은 노트북(화면 높이 0.2m) — 화면은 캐릭터 쪽(-Z), 뒷면이 얼굴을 가리지 않음
        const mon = laptop(); mon.scale.setScalar(SET_SCALE); mon.position.set(0, DESK_H + 0.01, -0.07); g.add(mon);
        const chair = mod('chair'); chair.scale.setScalar(SET_SCALE); chair.position.set(0, 0, -SEAT_Z); g.add(chair);
        if (!d.person) continue;
        const ch2 = skClone(ch.scene); ch2.scale.setScalar(CHAR_SCALE); ch2.position.set(0, SEAT_Y, -SEAT_Z); ch2.rotation.y = 0;
        ch2.traverse((m) => { if (m.isMesh || m.isSkinnedMesh) { m.castShadow = true; m.frustumCulled = false; if (m.material) m.material = m.material.clone(); } });
        g.add(ch2);
        const mixer = new THREE.AnimationMixer(ch2);
        const acts = Object.fromEntries(ch.animations.map((c) => [c.name, mixer.clipAction(c)]));
        const emo = emojiSprite(' '); emo.position.set(0, HEAD_Y, -SEAT_Z); emo.visible = false; g.add(emo);
        const person = { name: d.person.name, g, desk, mon, ch: ch2, mixer, acts, cur: '', emo, emoTxt: '', home: new THREE.Vector3(0, SEAT_Y, -SEAT_Z), walk: null, stage: null, decor: [], d };
        ch2.userData = { kind: 'person', name: d.person.name };
        st.clickables.push(ch2, desk);
        desk.userData = { kind: 'person', name: d.person.name };
        st.people.set(d.person.name, person);
      }
      st.built = true;
      setStat(`로드 ${loadMs}ms`);
      apply();
    };

    // 데이터 반영(폴링마다)
    const apply = () => {
      if (!st.built) return;
      const { rooms: rs, links: ls, avatars: av } = dataRef.current;
      const byName = new Map(); for (const r of rs || []) for (const p of r.seats || []) if (!p.empty) byName.set(p.name, p);
      const cur = new Map(); for (const l of ls || []) if (l.kind === 'current' && l.stage) cur.set(l.name, l.stage);
      for (const ln of st.lines) scene.remove(ln.obj); st.lines = [];
      for (const [name, P] of st.people) {
        const p = byName.get(name) || { status: 'off' };
        const L = look3d(av?.[name], name);
        P.ch.traverse((m) => {
          if (!m.isMesh && !m.isSkinnedMesh) return;
          const n = m.material?.name || '';
          if (n === 'top') m.material.color.set(L.top); else if (n === 'bottom') m.material.color.set(L.bottom);
          else if (n === 'skin') m.material.color.set(L.skin); else if (n === 'hair') m.material.color.set(L.hair);
          if (/^hat_/.test(m.name)) m.visible = m.name === L.hat;
        });
        if (L.desk) P.desk.traverse((m) => { if (m.isMesh && m.material?.name === 'desk_top') { m.material = m.material.clone(); m.material.color.set(L.desk); } });
        for (const o of P.decor) P.g.remove(o); P.decor = [];
        L.props.forEach((k, i) => { const o = kitMod(k); o.position.copy(PROP_SLOTS[Math.min(i, 2)]); o.scale.setScalar(PROP_SCALE * (k === 'plant' ? 0.5 : 1)); P.g.add(o); P.decor.push(o); });
        if (L.pet) { const pet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), new THREE.MeshStandardMaterial({ color: U.pet, roughness: 1 })); pet.scale.set(1.2, 0.85, 1); pet.position.copy(PET_SLOT); pet.castShadow = true; P.g.add(pet); P.decor.push(pet); }
        const A = animOf(p);
        const off = p.status === 'off';
        P.mon.traverse((m) => { if (m.isMesh && m.material?.name === 'screen') { m.material = m.material.clone(); m.material.emissiveIntensity = off ? 0 : 0.6; m.material.color.set(off ? U.screenOff : U.screenOn); } });
        P.clip = A.clip; P.speed = A.speed;
        if (A.emote !== P.emoTxt) { P.g.remove(P.emo); P.emo = emojiSprite(A.emote || ' '); P.emo.position.set(0, HEAD_Y, -SEAT_Z); P.emo.visible = !!A.emote; P.g.add(P.emo); P.emoTxt = A.emote; }
        const stg = cur.get(name) || null;
        if (stg && P.stage != null && stg !== P.stage && !dataRef.current.reduced) P.walk = { t: 0, to: stg };
        P.stage = stg;
        if (stg) {
          // 머리 위 아치(캐릭터 관통 방지, lib/pm3dLayout ARC_Y — 테스트 있음)
          const sp = stationPos(stg); const a = new THREE.Vector3(); P.g.localToWorld(a.copy(P.home)); a.y = ARC_Y.start;
          const b = new THREE.Vector3(sp.x, ARC_Y.end, sp.z); const mid = a.clone().lerp(b, 0.5); mid.y = ARC_Y.mid;
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          const geo = new THREE.TubeGeometry(curve, 24, 0.028, 5, false);
          const obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: STAGE_HEX[stg - 1], transparent: true, opacity: 0.55 }));
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: U.dot }));
          obj.add(dot); scene.add(obj); st.lines.push({ obj, curve, dot, ph: Math.random() });
        }
        playClip(P, P.walk ? 'walk' : P.clip, P.walk ? 1 : P.speed);
      }
      // 로봇(AI 에이전트): 작업중=선명, 대기=흐림
      const ags = dataRef.current.agents || [];
      for (const r of st.robots) {
        const a2 = ags[r.userData.i]; const on = a2?.status === 'working';
        r.traverse((m) => { if (m.isMesh) m.material.opacity = on ? 1 : 0.45; });
      }
      const labels = labelsRef.current; if (labels) labels.dataset.n = String(st.people.size);
    };
    let kitScene = null;
    const kitMod = (n) => { const o = kitScene?.getObjectByName(n); const c = o ? o.clone(true) : new THREE.Group(); c.position.set(0, 0, 0); return c; };
    const playClip = (P, name, speed) => {
      const a = P.acts[name]; if (!a) return;
      a.timeScale = speed;
      if (P.cur === name) return;
      const prev = P.acts[P.cur]; a.reset().play(); if (prev) a.crossFadeFrom(prev, 0.3, false);
      P.cur = name;
    };

    // 라벨칩(HTML 오버레이)
    const v = new THREE.Vector3();
    const updateLabels = () => {
      const box = labelsRef.current; if (!box) return;
      const w = el.clientWidth; const h = el.clientHeight;
      const items = [];
      const wv = new THREE.Vector3();
      for (const [name, P] of st.people) {
        P.ch.getWorldPosition(v); v.y += 1.45; v.project(cam); items.push({ key: name, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 20, w: 56, h: 16 });
        if (P.stage) { wv.set(0, 0.15, 2.0); P.g.localToWorld(wv); wv.project(cam); items.push({ key: 'w:' + name, x: (wv.x + 1) / 2 * w, y: (1 - wv.y) / 2 * h, w: 150, h: 30 }); }
      }
      for (const o of st.stations) { o.getWorldPosition(v); v.y += 1.9; v.project(cam); items.push({ key: 'st' + o.userData.no, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, w: 70, h: 18 }); }
      for (const o of st.robots) { o.getWorldPosition(v); v.y += 1.6; v.project(cam); items.push({ key: 'rb' + o.userData.i, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, w: 70, h: 18 }); }
      const placed = declutter(items);
      for (const it of placed) {
        const n = box.querySelector(`[data-k="${CSS.escape(it.key)}"]`); if (!n) continue;
        n.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translateX(-50%)`;
        n.style.display = it.x < -40 || it.x > w + 40 || it.y < -20 || it.y > h ? 'none' : '';
      }
    };

    // 프레임 상한 24fps(활동 시)·8fps(변화 없음) · 탭 숨김/화면 밖이면 정지 · 폴백 측정 = 로드 후 3초 제외, 5초 평균
    let visible = true; let lastAct = performance.now(); let lastDraw = 0;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }) : null;
    io?.observe(el);
    st.poke = () => { lastAct = performance.now(); };
    const tick = () => {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (!visible || document.hidden) {
        st.clock.getDelta();
        // 가려진 동안은 FPS 측정 일시정지(배경 탭 스로틀로 저사양 오판 방지)
        if (st.built && !st.checked) { st.fpsT0 = now + 500; st.frames = 0; }
        return;
      }
      const measuring = st.built && !st.checked;
      const busy = measuring || now - lastAct < IDLE_AFTER_MS || [...st.people.values()].some((P) => P.walk);
      if (now - lastDraw < 1000 / (busy ? FPS_CAP : FPS_IDLE) - 1) return;
      lastDraw = now;
      const dt = Math.min(0.2, st.clock.getDelta());
      const red = dataRef.current.reduced;
      if (st.built) {
        for (const P of st.people.values()) {
          if (P.walk) {
            P.walk.t += dt / 4;
            const sp = stationPos(P.walk.to); const tgt = new THREE.Vector3(sp.x + CAM_DIR.x * 1.1, 0.02, sp.z + CAM_DIR.z * 1.1); P.g.worldToLocal(tgt);
            const k = P.walk.t < 0.5 ? P.walk.t * 2 : (1 - P.walk.t) * 2;
            P.ch.position.lerpVectors(P.home, tgt, Math.min(1, k));
            const dir = P.walk.t < 0.5 ? tgt.clone().sub(P.home) : P.home.clone().sub(tgt);
            // 이동 중엔 진행 방향, 스테이션 도착 구간(k>0.85)엔 카메라 쪽으로 돌아섬
            P.ch.rotation.y = k > 0.85 ? CAM_YAW - P.g.rotation.y : Math.atan2(dir.x, dir.z);
            if (P.walk.t >= 1) { P.walk = null; P.ch.position.copy(P.home); P.ch.rotation.y = 0; playClip(P, P.clip, P.speed); }
          }
          if (!red) P.mixer.update(dt); else if (!P.frozen) { P.mixer.update(0.4); P.frozen = true; }
        }
        if (!red) {
          const t = st.clock.elapsedTime;
          for (const r of st.robots) r.position.y = 0.05 + Math.sin(t * 2 + r.userData.i) * 0.05;
          for (const ln of st.lines) ln.dot.position.copy(ln.curve.getPoint((t * 0.4 + ln.ph) % 1));
        }
        updateLabels();
      }
      renderer.render(scene, cam);
      // 저사양 판정
      if (st.built && st.firstFrame == null) { st.firstFrame = now - mountAt; st.fpsT0 = now + FPS_WARMUP_MS; st.frames = 0; }
      else if (measuring && now >= st.fpsT0) {
        st.frames++; if (st.lastT) st.maxGap = Math.max(st.maxGap || 0, now - st.lastT); st.lastT = now;
        if (now - st.fpsT0 > FPS_WINDOW_MS) {
          // 500ms+ 프레임 공백 = 브라우저 백그라운드 스로틀 → 저사양 오판 방지, 최대 3회 재측정
          const throttled = (st.maxGap || 0) > 500;
          if (throttled && (st.retry || 0) < 3) { st.retry = (st.retry || 0) + 1; st.fpsT0 = now + 500; st.frames = 0; st.maxGap = 0; st.lastT = 0; return; }
          st.checked = true; const fps = Math.round(st.frames * 1000 / (now - st.fpsT0));
          // 재측정까지 전부 스로틀이면 측정 불가로 보고 폴백하지 않음(가려진 창 오판 방지)
          const why = throttled ? '' : shouldFallback({ firstFrameMs: st.firstFrame - st.loadMs, fps: red ? null : fps });
          setStat((x) => `${x} · 첫 프레임 ${Math.round(st.firstFrame)}ms · ${fps}fps`);
          if (typeof window !== 'undefined') window.__pm3dStat = { firstFrameMs: Math.round(st.firstFrame), loadMs: st.loadMs, fps };
          if (why) onFallback?.(why);
        }
      }
    };

    // 클릭(레이캐스트) · 드래그 이동(확대 시에만)
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let drag = null;
    const onDown = (e) => { st.poke?.(); drag = { x: e.clientX, y: e.clientY, px: pan.x, pz: pan.z, moved: false }; };
    const onMove = (e) => {
      if (!drag || st.zoom <= 1) return;
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const k = (2 * st.fit / st.zoom) / (el.clientHeight || 500);
      // 화면 x → 월드 (1,0,-1)/√2, 화면 y → 월드 (1,0,1)/√2·(1/sin 35°)
      pan.x = drag.px - (dx * k) / Math.SQRT2 - (dy * k * 1.22) / Math.SQRT2;
      pan.z = drag.pz + (dx * k) / Math.SQRT2 - (dy * k * 1.22) / Math.SQRT2;
      placeCam();
    };
    const onUp = (e) => {
      const d0 = drag; drag = null; if (d0?.moved) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(st.clickables, true)[0]; if (!hit) return;
      let o = hit.object; while (o && !o.userData?.kind) o = o.parent;
      if (o?.userData.kind === 'person') onOpenPerson?.(o.userData.name);
      else if (o?.userData.kind === 'stage') onPickStage?.(o.userData.no);
    };
    const cvs = renderer.domElement;
    cvs.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); cvs.addEventListener('pointerup', onUp);
    st.loadMs = 0;
    loadAssets().then((a) => { if (dead) return; st.loadMs = a.loadMs; kitScene = a.kit.scene; build(a); }).catch(() => { if (!dead) onFallback?.('load-failed'); });
    placeCam(); tick();
    api.current = {
      apply: () => { st.poke?.(); apply(); },
      setZoom: (z) => { st.poke?.(); st.zoom = z; if (z <= 1) pan.set(0, 0, 0); placeCam(); },
    };
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect(); io?.disconnect();
      cvs.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); cvs.removeEventListener('pointerup', onUp);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose(); cvs.remove(); api.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, (rooms || []).map((r) => (r.seats || []).length).join(','), (agents || []).length]);

  useEffect(() => { api.current?.apply(); }, [rooms, links, avatars, reduced]);
  useEffect(() => { api.current?.setZoom(zoom); }, [zoom]);

  const people = []; for (const r of rooms || []) for (const p of r.seats || []) if (!p.empty) people.push(p);
  const cur = new Map(); for (const l of links || []) if (l.kind === 'current') cur.set(l.name, l);
  return (
    <div className="pm3d" style={{ position: 'relative', width: '100%', height: 'min(72vh, 760px)', minHeight: 420, borderRadius: 16, overflow: 'hidden', touchAction: zoom > 1 ? 'none' : 'auto', cursor: zoom > 1 ? 'grab' : 'default' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labelsRef} aria-hidden={false} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {people.map((p) => (
          <button key={p.name} type="button" data-k={p.name} onClick={() => onOpenPerson?.(p.name)} title={p.name}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '600 11px/1.2 inherit', padding: '1px 7px', borderRadius: 999, border: 0, whiteSpace: 'nowrap', background: p.status === 'working' ? U.chip : U.chipDim, color: U.ink, boxShadow: '0 1px 3px rgba(0,0,0,.15)', cursor: 'pointer' }}>
            {p.name}
          </button>
        ))}
        {people.map((p) => {
          const l = cur.get(p.name);
          if (!l?.text || !l.stage) return null;
          return (
            <button key={'w:' + p.name} type="button" data-k={'w:' + p.name} onClick={() => onOpenPerson?.(p.name, 'time')} title={`${p.name} · ${l.text}`}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '500 10.5px/1.25 inherit', padding: '3px 8px', borderRadius: 8, border: 0, maxWidth: 150, background: U.chipDim, color: U.ink, boxShadow: '0 1px 3px rgba(0,0,0,.12)', cursor: 'pointer', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textAlign: 'left', borderLeft: `3px solid ${STAGE_HEX[l.stage - 1]}` }}>
              {String(l.text).slice(0, 36)}
            </button>
          );
        })}
        {STAGES.map((s) => (
          <button key={s.no} type="button" data-k={'st' + s.no} onClick={() => onPickStage?.(s.no)}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '700 11px/1.2 inherit', padding: '2px 8px', borderRadius: 8, border: 0, background: STAGE_HEX[s.no - 1], color: U.stageInk, cursor: 'pointer' }}>
            {s.no}. {s.label}
          </button>
        ))}
        {(agents || []).slice(0, 8).map((a, i) => {
          const on = a.status === 'working';
          return (
            <span key={a.id || a.name || i} data-k={'rb' + i} style={{ position: 'absolute', left: 0, top: 0, font: '600 10px/1.2 inherit', padding: '1px 6px', borderRadius: 6, background: U.robot, color: U.dot, whiteSpace: 'nowrap', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', opacity: on ? 1 : 0.5 }}>
              🤖 {a.name || a.id}{on && a.activity ? ` · ${String(a.activity).slice(0, 16)}` : ''}
            </span>
          );
        })}
      </div>
      <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 6 }}>
        <ZoomSlider pct={zoom * 100} min={ZOOM_PCT_MIN} max={ZOOM_PCT_MAX} onChange={(pct) => setZoom(pctToZoom(pct))} />
        <button type="button" aria-label="화면 맞춤" onClick={() => setZoom(1)} style={{ ...zbtn, width: 'auto', padding: '0 10px' }}>맞춤</button>
      </div>
      <small style={{ position: 'absolute', left: 10, bottom: 8, color: U.note, background: U.chipDim, padding: '1px 6px', borderRadius: 6 }}>3D 베타 {stat}</small>
    </div>
  );
}
const zbtn = { width: 34, height: 34, borderRadius: 10, border: 0, background: U.btn, boxShadow: '0 1px 4px rgba(0,0,0,.18)', font: '700 16px/1 inherit', cursor: 'pointer', color: U.ink };
