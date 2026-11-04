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
import { faceOf, isFaceId } from '../../lib/pmFaces';
import { mountById, mountPose } from '../../lib/pmMounts';
import { ridePath, pathLength, pathPoint, ringPoint, ringLength, RIDE_MAX_CONCURRENT } from '../../lib/pm3dRide';
import { HUB_POS, HUB_ORB_Y, HUB_ORB_R, HUB_R, HUB_PEDESTAL_H, FLOW_MAX, FLOW_SPEED, flowSpawnCount, pulseScale, PULSE_MS, RING_MS, RING_R0, RING_R1, heartbeat, pruneArrivals, parkPose } from '../../lib/pm3dHub';
import { ZoomSlider } from '../pm/ui';

const THEMES = PM3D.THEMES; const U = PM3D.ui;
export const PM3D_THEMES = Object.keys(THEMES);
const STAGE_HEX = PM3D.STAGE;
// 책상 위 소품 슬롯(좌/중/우, 자리 그룹 로컬 좌표)과 펫 자리(책상 옆 바닥) — 구매 소품·펫이 3D 에서도 보이게
const PROP_SLOTS = [new THREE.Vector3(-0.61, 0.72 * 1.45 + 0.005, 0.22), new THREE.Vector3(0, 0.72 * 1.45 + 0.005, 0.3), new THREE.Vector3(0.61, 0.72 * 1.45 + 0.005, 0.22)];
const PET_SLOT = new THREE.Vector3(1.25, 0.22, 0.35);
const SEAT_Z = 0.62 * SET_SCALE; // 그룹 안 캐릭터·의자 위치(-Z = 책상 뒤, 캐릭터는 +Z = 카메라 쪽을 봄)
const SEAT_Y = 0.46 * SET_SCALE - 0.48 * CHAR_SCALE + 0.02; const DESK_H = 0.72 * SET_SCALE; const HEAD_Y = 1.95 * CHAR_SCALE + 0.35; // 앉은 엉덩이(KayKit sit 클립 힙 높이 0.48)를 의자 좌판(0.46)에 맞춤

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}
let kitP = null;
function loadAssets() {
  if (kitP) return kitP;
  const draco = new DRACOLoader(); draco.setDecoderPath('/pm3d/draco/'); draco.setDecoderConfig({ type: 'wasm' });
  const l = new GLTFLoader(); l.setDRACOLoader(draco);
  const t0 = performance.now();
  kitP = Promise.all([l.loadAsync('/pm3d/kit.glb'), l.loadAsync('/pm3d/char.glb'), l.loadAsync('/pm3d/mounts.glb').catch(() => null)])
    .then(([kit, ch, mounts]) => ({ kit, ch, mounts, loadMs: Math.round(performance.now() - t0) }));
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
// 표정 텍스처(public/pm3d/face/<id>.webp — scripts/pm3d/build_faces.py). 캐시 공유, 로드 전엔 기존 얼굴 유지.
const faceTexCache = new Map();
function faceTexture(id, onReady) {
  if (!isFaceId(id)) id = 'smile';
  if (faceTexCache.has(id)) return faceTexCache.get(id);
  const tex = new THREE.TextureLoader().load(`/pm3d/face/${id}.webp`, () => onReady?.());
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
  faceTexCache.set(id, tex); return tex;
}
// 상태 → 작업 분위기(lib/pmMood 간이판: 3D 는 status 만 안다)
const STATUS_VIBE = { working: 'work', off: 'doze', idle: 'break' };
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

    const build = ({ kit, ch, mounts, loadMs }) => {
      const mod = (n) => { const o = kit.scene.getObjectByName(n); if (!o) return new THREE.Group(); const c = o.clone(true); c.position.set(0, 0, 0); c.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return c; };
      const put = (n, x, z, ry = 0, s = 1) => { const o = mod(n); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s); scene.add(o); return o; };
      st.mounts = mounts ? mounts.scene : null;
      const lay = T.layout || {};
      const { desks, plates } = layoutDesks(dataRef.current.rooms);
      const { hx, hz } = floorBounds(desks, lay.mapScale || 1);
      st.bounds = { hx, hz };
      st.fit = sceneFit(hx, hz); placeCam();
      sun.shadow.camera.left = -hx - 4; sun.shadow.camera.right = hx + 4; sun.shadow.camera.top = hz + 4; sun.shadow.camera.bottom = -hz - 4; sun.shadow.camera.far = 80; sun.shadow.camera.updateProjectionMatrix();
      for (let x = -hx + 1; x < hx; x += 2) for (let z = -hz + 1; z < hz; z += 2) { const f = put(T.floor, x, z); f.traverse((m) => { if (m.isMesh) m.castShadow = false; }); }
      // 테마 장식
      if (T.props === 'office') {
        for (let x = -hx + 1; x < hx; x += 2) put('wall', x, -hz);
        for (let z = -hz + 1; z < hz; z += 2) put('wall', -hx, z, Math.PI / 2);
        [[-hx + 1, -hz + 1.2], [hx - 1, -hz + 1.2], [hx - 1, hz - 1], [-hx + 1.2, hz - 1]].forEach(([x, z]) => put('plant_k1', x, z));
        put('lamp_k', -hx + 2.2, -hz + 1.1); put('lamp_k', hx - 2.3, hz - 1.3);
        put('parcel', hx - 2.4, -hz + 1.3); put('parcel', hx - 2.9, -hz + 1.6, 0.5, 0.8);
        for (const p of plates) put('partition', p.x, p.z - Math.sign(p.z) * 0.1);
      } else {
        for (let x = -hx + 1; x < hx; x += 2) { put('sea', x, -hz - 1); put('sea', x, -hz - 3); }
        for (let x = -hx + 1; x < hx; x += 2) put('boardwalk', x, 0, Math.PI / 2);
        // 소품 밀도 업(결정적 의사난수): 야자수 둘레 + 조개·불가사리·바위 흩뿌림
        const rnd = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
        for (let k = 0; k < 7; k++) put('palm', -hx + 0.9 + k * (2 * hx - 1.8) / 6, -hz + 0.8 + rnd(k) * 0.8, rnd(k + 9) * 6, 0.85 + rnd(k + 3) * 0.4);
        for (let k = 0; k < 4; k++) put('palm', -hx + 0.9 + k * (2 * hx - 1.8) / 3, hz - 0.8 - rnd(k + 20) * 0.6, rnd(k + 29) * 6, 0.9 + rnd(k + 23) * 0.3);
        for (let k = 0; k < 10; k++) { const m = ['shell', 'starfish', 'rock'][k % 3]; put(m, -hx + 1 + rnd(k + 40) * (2 * hx - 2), (rnd(k + 50) * 2 - 1) * (hz - 1.4), rnd(k + 60) * 6, m === 'rock' ? 0.5 + rnd(k) * 0.5 : 0.9); }
        put('hut', -hx + 2, -hz + 2.6, 0.4); put('hut', hx - 2, hz - 2.4, -0.3);
        // 둘레 순환 보드워크(주행로) — lib/pmThemes layout.ring + lib/pm3dRide ringRect(인셋 1m)
        if (lay.ring) {
          const rm = lay.ringModel || 'boardwalk';
          for (let x = -hx + 1; x < hx; x += 2) { put(rm, x, -hz + 1, Math.PI / 2); put(rm, x, hz - 1, Math.PI / 2); }
          for (let z = -hz + 3; z < hz - 2; z += 2) { put(rm, -hx + 1, z); put(rm, hx - 1, z); }
        }
        for (const p of plates) { put('parasol', p.x, p.z, 0, 1.1); put('surfboard', p.x + 2.6, p.z, 0.3); put('parasol', p.x - 3.1, p.z + 0.6, 0.4, 0.95); }
      }
      // 스테이션 1~9
      STAGES.forEach((s) => {
        const p = stationPos(s.no); const o = put(`station_${s.no}`, p.x, p.z);
        o.userData = { kind: 'stage', no: s.no, label: s.label }; st.stations.push(o); st.clickables.push(o);
      });
      // 중앙 허브 "회사 심장" — 받침대 위 떠 있는 수정구(파스텔 자체발광 · 느린 회전+부유). lib/pm3dHub 위치(주행로·좌석·스테이션 교차 0, 테스트 보증)
      {
        const HC = PM3D.HUB;
        const grp = new THREE.Group(); grp.position.set(HUB_POS.x, 0, HUB_POS.z); scene.add(grp);
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R * 0.72, HUB_R, HUB_PEDESTAL_H, 14), new THREE.MeshStandardMaterial({ color: HC.pedestal, roughness: 0.85 }));
        ped.position.y = HUB_PEDESTAL_H / 2; ped.castShadow = true; ped.receiveShadow = true; grp.add(ped);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R * 0.82, HUB_R * 0.72, 0.08, 14), new THREE.MeshStandardMaterial({ color: HC.pedestalTop, roughness: 0.7 }));
        top.position.y = HUB_PEDESTAL_H + 0.04; top.castShadow = true; grp.add(top);
        const orbMat = new THREE.MeshStandardMaterial({ color: HC.crystal, emissive: HC.glow, emissiveIntensity: 0.55, roughness: 0.25, transparent: true, opacity: 0.95 });
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(HUB_ORB_R, 2), orbMat); orb.position.y = HUB_ORB_Y; orb.castShadow = true; grp.add(orb);
        st.hub = { grp, orb, orbMat, arrivals: [], particles: [], rings: [], pulseAt: -1e9, bobPh: 0 };
      }
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
        const desk = mod(dstyle.model); desk.scale.setScalar(SET_SCALE);
        // Kenney desk_k1 은 피벗이 모서리에 있음 → 바닥 중심(그룹 원점)으로 재중심(x/z), 바닥 y=0 맞춤.
        // 이게 빠지면 책상이 자리에서 대각선으로 밀려 "의자+캐릭터 따로, 책상 따로" 로 보인다(사장님 스크린샷 회귀).
        const dbb = new THREE.Box3().setFromObject(desk); const dc = dbb.getCenter(new THREE.Vector3());
        desk.position.set(-dc.x, -dbb.min.y, -dc.z); g.add(desk);
        if (dstyle.color) desk.traverse((m) => { if (m.isMesh && m.material) { m.material = m.material.clone(); m.material.color.lerp(new THREE.Color(dstyle.color), 0.4); } }); // 부서색 틴트
        // 낮은 노트북(화면 높이 0.2m) — 실측 책상 상판 높이 위에 얹음(고정 DESK_H는 Kenney 책상보다 높아 공중부양). 화면은 캐릭터 쪽(-Z).
        const deskTopY = dbb.max.y - dbb.min.y;
        const mon = laptop(); mon.scale.setScalar(SET_SCALE); mon.position.set(0, deskTopY + 0.01, -0.07); g.add(mon);
        const chair = mod(dstyle.chair || 'chair_k1'); // Kenney 의자도 피벗 보정 후 좌석(0,0,-SEAT_Z)에 중심 배치
        const cbb = new THREE.Box3().setFromObject(chair); const cc = cbb.getCenter(new THREE.Vector3());
        chair.position.set(-cc.x, -cbb.min.y, -SEAT_Z - cc.z); g.add(chair);
        if (!d.person) continue;
        const ch2 = skClone(ch.scene); ch2.scale.setScalar(CHAR_SCALE); ch2.position.set(0, SEAT_Y, -SEAT_Z); ch2.rotation.y = 0;
        ch2.traverse((m) => { if (m.isMesh || m.isSkinnedMesh) { m.castShadow = true; m.frustumCulled = false; if (m.material) m.material = m.material.clone(); } });
        g.add(ch2);
        const mixer = new THREE.AnimationMixer(ch2);
        const acts = Object.fromEntries(ch.animations.map((c) => [c.name, mixer.clipAction(c)]));
        const emo = emojiSprite(' '); emo.position.set(0, HEAD_Y, -SEAT_Z); emo.visible = false; g.add(emo);
        const person = { name: d.person.name, g, desk, mon, ch: ch2, mixer, acts, cur: '', emo, emoTxt: '', home: new THREE.Vector3(0, SEAT_Y, -SEAT_Z), deskTop: deskTopY, walk: null, stage: null, decor: [], d };
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
      const cur = new Map(); const curSig = new Map();
      for (const l of ls || []) if (l.kind === 'current' && l.stage) { cur.set(l.name, l.stage); curSig.set(l.name, `${l.stage}|${l.text || ''}`); }
      for (const ln of st.lines) scene.remove(ln.obj); st.lines = [];
      for (const [name, P] of st.people) {
        const p = byName.get(name) || { status: 'off' };
        const L = look3d(av?.[name], name);
        P.ch.traverse((m) => {
          if (!m.isMesh && !m.isSkinnedMesh) return;
          const n = m.material?.name || '';
          if (n === 'top') m.material.color.set(L.top); else if (n === 'bottom') m.material.color.set(L.bottom);
          else if (n === 'skin') m.material.color.set(L.skin); else if (n === 'hair') { m.material.color.set(L.hair); m.visible = !L.hideHair; }
          if (/^hat_/.test(m.name)) m.visible = m.name === L.hat;
        });
        // 종족 부속(귀·더듬이 등, PM3D.RACES) — head 본에 부착해 앉기/걷기 포즈를 따라간다. 상점 렌더(render_shop.py)와 같은 표.
        if ((L.char || 'human') !== P.raceId) {
          if (P.raceObj) { P.raceObj.parent?.remove(P.raceObj); P.raceObj = null; }
          const bone = P.ch.getObjectByName('head');
          if (bone && L.attach?.length) {
            const grp = new THREE.Group();
            P.ch.updateWorldMatrix(true, true);
            for (const a of L.attach) {
              const col = a.c === 'hair' ? L.hair : a.c === 'skin' ? L.skin : a.c;
              const mt = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 });
              const geo = a.shape === 'cone' ? new THREE.ConeGeometry(a.r, a.h, 12)
                : a.shape === 'cyl' ? new THREE.CylinderGeometry(a.r, a.r, a.h, 10)
                : a.shape === 'torus' ? new THREE.TorusGeometry(a.R, a.r, 8, 18)
                : new THREE.SphereGeometry(a.r, 12, 8);
              const mesh = new THREE.Mesh(geo, mt);
              if (a.s) mesh.scale.set(a.s[0], a.s[1], a.s[2]);
              if (a.rot) mesh.rotation.set(a.rot[0], a.rot[1], a.rot[2]);
              else if (a.shape === 'torus') mesh.rotation.x = Math.PI / 2;
              // 캐릭터 로컬 좌표 → head 본 로컬(본이 움직여도 상대 위치 유지)
              const v = new THREE.Vector3(a.p[0], a.p[1], a.p[2]);
              P.ch.localToWorld(v); bone.worldToLocal(v); mesh.position.copy(v);
              mesh.castShadow = true; grp.add(mesh);
            }
            bone.add(grp); P.raceObj = grp;
          }
          P.raceId = L.char || 'human';
        }
        // 표정: 춤 > 작업 분위기(status) > 직원 기본 표정 > smile (lib/pmFaces.faceOf)
        const faceId = faceOf({ vibe: STATUS_VIBE[p.status] || '', defaultFace: L.face }) || (isFaceId(L.face) ? L.face : 'smile');
        P.ch.traverse((m) => {
          if ((m.isMesh || m.isSkinnedMesh) && m.material?.name === 'face' && P.faceId !== faceId) {
            m.material.map = faceTexture(faceId, () => { st.poke?.(); m.material.needsUpdate = true; });
            m.material.needsUpdate = true; P.faceId = faceId;
          }
        });
        if (L.desk) P.desk.traverse((m) => { if (m.isMesh && m.material?.name === 'desk_top') { m.material = m.material.clone(); m.material.color.set(L.desk); } });
        for (const o of P.decor) P.g.remove(o); P.decor = [];
        L.props.forEach((k, i) => { const o = kitMod(k); o.position.copy(PROP_SLOTS[Math.min(i, 2)]); o.position.y = (P.deskTop ?? DESK_H) + 0.005; o.scale.setScalar(k === 'mug' ? PROP_SCALE : 0.9); P.g.add(o); P.decor.push(o); });
        if (L.pet) { const pet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), new THREE.MeshStandardMaterial({ color: U.pet, roughness: 1 })); pet.scale.set(1.2, 0.85, 1); pet.position.copy(PET_SLOT); pet.castShadow = true; P.g.add(pet); P.decor.push(pet); }
        const A = animOf(p);
        const off = p.status === 'off';
        P.mon.traverse((m) => { if (m.isMesh && m.material?.name === 'screen') { m.material = m.material.clone(); m.material.emissiveIntensity = off ? 0 : 0.6; m.material.color.set(off ? U.screenOff : U.screenOn); } });
        P.clip = A.clip; P.speed = A.speed;
        if (A.emote !== P.emoTxt) { P.g.remove(P.emo); P.emo = emojiSprite(A.emote || ' '); P.emo.position.set(0, HEAD_Y, -SEAT_Z); P.emo.visible = !!A.emote; P.g.add(P.emo); P.emoTxt = A.emote; }
        // 탈것(슬롯 mount): 평소 책상 옆 park, 이동은 ride, PC 꺼짐 hidden (lib/pmMounts.mountPose)
        const mdef = mountById(L.mount);
        const mpose = mdef ? mountPose(p.status, !!(P.walk || P.cruise)) : 'hidden';
        if ((mdef?.id || '') !== P.mountId) {
          if (P.mountObj) { P.g.remove(P.mountObj); P.mountObj = null; }
          if (mdef && st.mounts) {
            const src = st.mounts.getObjectByName('mount_' + mdef.id.replace(/-/g, '_'));
            if (src) {
              const o = src.clone(true);
              o.traverse((m) => { if (m.isMesh) { m.castShadow = true; if (m.material) m.material = m.material.clone(); } });
              o.scale.setScalar(CHAR_SCALE); P.g.add(o); P.mountObj = o;
              P.mountSeat = (src.userData?.seatZ ?? 0.3) * CHAR_SCALE; P.mountRide = src.userData?.pose || mdef.ride;
            }
          }
          P.mountId = mdef?.id || '';
        }
        if (P.mountObj && !P.riding) { // park: 책상 왼쪽 바닥(종류별 자세 — lib/pm3dHub.parkPose)
          P.mountObj.visible = mpose !== 'hidden';
          applyPark(P);
        }
        const stg = cur.get(name) || null;
        if (stg && P.stage != null && stg !== P.stage && !dataRef.current.reduced) {
          const rides = [...st.people.values()].filter((q) => q.riding || q.cruise).length;
          if (P.mountObj && mpose !== 'hidden' && rides < RIDE_MAX_CONCURRENT) {
            const path = ridePath(P.d, stg, st.bounds || {});
            P.walk = { t: 0, to: stg, ride: { path, len: pathLength(path), speed: mdef.speed || 1.2 } };
          } else P.walk = { t: 0, to: stg };
        }
        P.stage = stg;
        // 업무 라인 흐름: 작업 이벤트(현재 작업 텍스트/단계 변화) 처리 시 자리→허브로 빛 알갱이 2~3개(아치 경로, 상한 12)
        const sig = curSig.get(name) || '';
        if (st.hub && sig && P.flowSig !== undefined && sig !== P.flowSig && p.status === 'working' && !dataRef.current.reduced) spawnFlow(P);
        P.flowSig = sig;
        // 출근 직후(off→working) 짧은 둘레 주행 · 휴식자 가끔 크루징 — 동시 3명 상한, reduced 땐 없음
        if (P.mountObj && !dataRef.current.reduced && st.bounds) {
          const rides = [...st.people.values()].filter((q) => q.riding || q.cruise).length;
          const now = Date.now();
          if (P.prevStatus === 'off' && p.status === 'working' && !P.cruise && rides < RIDE_MAX_CONCURRENT) {
            P.cruise = { t0: now, dur: 6000, from: Math.random() };               // 출근 한 바퀴 살짝
          } else if (p.status === 'idle' && !P.cruise && rides < RIDE_MAX_CONCURRENT) {
            const slot = Math.floor(now / 180000);                                 // 3분 창마다 해시 추첨
            let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
            if ((h + slot) % 7 === 0 && P.cruiseSlot !== slot) { P.cruiseSlot = slot; P.cruise = { t0: now, dur: 12000, from: (h % 100) / 100 }; }
          }
        }
        P.prevStatus = p.status;
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
    // 자리→허브 빛 알갱이(머리 위 아치 — 기존 연결선과 같은 ARC_Y 높이, 캐릭터 관통 없음)
    const spawnFlow = (P) => {
      const H = st.hub; if (!H) return;
      const n = flowSpawnCount(H.particles.length, (performance.now() / 16) | 0);
      if (n <= 0) return;
      const a = new THREE.Vector3(); P.g.localToWorld(a.copy(P.home)); a.y = ARC_Y.start;
      const b = new THREE.Vector3(HUB_POS.x, HUB_ORB_Y, HUB_POS.z);
      const mid = a.clone().lerp(b, 0.5); mid.y = ARC_Y.mid;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: PM3D.HUB.particle, transparent: true, opacity: 0.9 }));
        m.position.copy(a); scene.add(m);
        H.particles.push({ m, curve, t: -i * 0.12 }); // 같은 이벤트 알갱이는 줄지어 따라감
      }
      st.poke?.();
    };
    // 탈것 주차(책상 옆): 보드류=기대 세움 · 동물류=엎드림 · 비행류=부유(lib/pm3dHub.parkPose)
    const applyPark = (P) => {
      const o = P.mountObj; if (!o) return;
      const pp = parkPose(mountById(P.mountId)) || { x: -1.15, y: 0, z: 0.35, rotY: 0.5, rotZ: 0, sy: 1, hover: 0 };
      o.position.set(pp.x, pp.y, pp.z); o.rotation.set(0, pp.rotY, pp.rotZ);
      o.scale.set(CHAR_SCALE, CHAR_SCALE * pp.sy, CHAR_SCALE);
      P.parkHover = pp.hover; P.parkY = pp.y;
    };
    const unparkMount = (P) => { const o = P.mountObj; if (o) { o.rotation.set(0, 0, 0); o.scale.setScalar(CHAR_SCALE); } };

    // 라벨칩(HTML 오버레이)
    const v = new THREE.Vector3();
    const updateLabels = () => {
      const box = labelsRef.current; if (!box) return;
      const w = el.clientWidth; const h = el.clientHeight;
      // 실제 렌더된 칩 크기로 겹침을 판정한다(고정 추정폭 → 로봇/작업 칩이 겹쳐 보이던 버그).
      const sizeOf = (key, fw, fh) => {
        const n = box.querySelector(`[data-k="${CSS.escape(key)}"]`);
        return n && n.offsetWidth ? { w: n.offsetWidth, h: n.offsetHeight } : { w: fw, h: fh };
      };
      const items = [];
      const wv = new THREE.Vector3();
      for (const [name, P] of st.people) {
        P.ch.getWorldPosition(v); v.y += 1.45; v.project(cam); items.push({ key: name, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 20, ...sizeOf(name, 56, 16) });
        if (P.stage) { wv.set(0, 0.15, 2.0); P.g.localToWorld(wv); wv.project(cam); items.push({ key: 'w:' + name, x: (wv.x + 1) / 2 * w, y: (1 - wv.y) / 2 * h, ...sizeOf('w:' + name, 150, 30) }); }
      }
      for (const o of st.stations) { o.getWorldPosition(v); v.y += 1.9; v.project(cam); items.push({ key: 'st' + o.userData.no, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, ...sizeOf('st' + o.userData.no, 70, 18) }); }
      for (const o of st.robots) { o.getWorldPosition(v); v.y += 1.6; v.project(cam); items.push({ key: 'rb' + o.userData.i, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, ...sizeOf('rb' + o.userData.i, 170, 18) }); }
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
      const busy = measuring || now - lastAct < IDLE_AFTER_MS || (st.hub && (st.hub.particles.length > 0 || st.hub.rings.length > 0 || now - st.hub.pulseAt < PULSE_MS)) || [...st.people.values()].some((P) => P.walk || P.cruise);
      if (now - lastDraw < 1000 / (busy ? FPS_CAP : FPS_IDLE) - 1) return;
      lastDraw = now;
      const dt = Math.min(0.2, st.clock.getDelta());
      const red = dataRef.current.reduced;
      if (st.built) {
        for (const P of st.people.values()) {
          if (P.walk && P.walk.ride && P.mountObj) {
            // 탑승 주행: 자리→(책상 틈→복도)→스테이션 폴리라인 왕복 (lib/pm3dRide)
            const R0 = P.walk.ride;
            P.riding = true;
            P.walk.t += dt * (2.2 * R0.speed) / Math.max(1, R0.len) / 2; // 왕복이라 절반 속도 진행
            const k = P.walk.t < 0.5 ? P.walk.t * 2 : (1 - P.walk.t) * 2;
            const pt = pathPoint(R0.path, Math.min(1, k) * R0.len);
            const lp = new THREE.Vector3(pt.x, 0, pt.z); P.g.worldToLocal(lp);
            const yawL = (P.walk.t < 0.5 ? pt.yaw : pt.yaw + Math.PI) - P.g.rotation.y;
            unparkMount(P);
            P.mountObj.position.set(lp.x, 0.02, lp.z); P.mountObj.rotation.y = yawL;
            P.ch.position.set(lp.x, P.mountSeat, lp.z); P.ch.rotation.y = yawL;
            playClip(P, P.mountRide === 'stand' || P.mountRide === 'hang' ? 'idle' : 'sit_type', 1);
            if (P.walk.t >= 1) {
              P.walk = null; P.riding = false;
              P.ch.position.copy(P.home); P.ch.rotation.y = 0;
              applyPark(P);
              playClip(P, P.clip, P.speed);
            }
          } else if (P.walk) {
            P.walk.t += dt / 4;
            const sp = stationPos(P.walk.to); const tgt = new THREE.Vector3(sp.x + CAM_DIR.x * 1.1, 0.02, sp.z + CAM_DIR.z * 1.1); P.g.worldToLocal(tgt);
            const k = P.walk.t < 0.5 ? P.walk.t * 2 : (1 - P.walk.t) * 2;
            P.ch.position.lerpVectors(P.home, tgt, Math.min(1, k));
            const dir = P.walk.t < 0.5 ? tgt.clone().sub(P.home) : P.home.clone().sub(tgt);
            // 이동 중엔 진행 방향, 스테이션 도착 구간(k>0.85)엔 카메라 쪽으로 돌아섬
            P.ch.rotation.y = k > 0.85 ? CAM_YAW - P.g.rotation.y : Math.atan2(dir.x, dir.z);
            if (P.walk.t >= 1) { P.walk = null; P.ch.position.copy(P.home); P.ch.rotation.y = 0; playClip(P, P.clip, P.speed); }
          } else if (P.cruise && P.mountObj && st.bounds) {
            // 둘레 순환로 크루징(출근 직후·휴식) — 끝나면 자리·park 로 복귀
            const C = P.cruise; const el2 = performance.now() - (C.el0 ?? (C.el0 = performance.now()));
            const prog = el2 / C.dur;
            if (prog >= 1 || dataRef.current.reduced) {
              P.cruise = null; P.riding = false;
              P.ch.position.copy(P.home); P.ch.rotation.y = 0;
              applyPark(P);
              playClip(P, P.clip, P.speed);
            } else {
              P.riding = true;
              unparkMount(P);
              const ringL = ringLength(st.bounds.hx, st.bounds.hz);
              const speed = 2.2 * 1.3; const tt = C.from + (el2 / 1000) * speed / ringL;
              const pt = ringPoint(st.bounds.hx, st.bounds.hz, tt);
              const lp = new THREE.Vector3(pt.x, 0, pt.z); P.g.worldToLocal(lp);
              const yawL = pt.yaw - P.g.rotation.y;
              P.mountObj.position.set(lp.x, 0.02, lp.z); P.mountObj.rotation.y = yawL;
              P.ch.position.set(lp.x, P.mountSeat, lp.z); P.ch.rotation.y = yawL;
              playClip(P, P.mountRide === 'stand' || P.mountRide === 'hang' ? 'idle' : 'sit_type', 1);
            }
          }
          if (!red) P.mixer.update(dt); else if (!P.frozen) { P.mixer.update(0.4); P.frozen = true; }
        }
        if (!red) {
          const t = st.clock.elapsedTime;
          for (const r of st.robots) r.position.y = 0.05 + Math.sin(t * 2 + r.userData.i) * 0.05;
          for (const ln of st.lines) ln.dot.position.copy(ln.curve.getPoint((t * 0.4 + ln.ph) % 1));
          // 주차된 비행류 탈것: 살짝 부유
          for (const P of st.people.values()) if (P.mountObj && !P.riding && P.parkHover) P.mountObj.position.y = (P.parkY || 0) + Math.sin(t * 1.6) * P.parkHover;
          // 중앙 허브: 느린 회전+부유(최근 1분 도착 빈도만큼 살짝 빨라짐) · 도착 맥박 · 파문 링
          const H = st.hub;
          if (H) {
            H.arrivals = pruneArrivals(H.arrivals);
            const hb = heartbeat(H.arrivals);
            H.bobPh += dt * hb.bob;
            H.orb.rotation.y += dt * 0.35 * hb.bob;
            const base = HUB_ORB_Y + Math.sin(H.bobPh * 1.3) * 0.08;
            H.orb.position.y = base;
            const nowMs = performance.now();
            H.orb.scale.setScalar(pulseScale(nowMs - H.pulseAt));
            H.orbMat.emissiveIntensity = hb.glow + (nowMs - H.pulseAt < PULSE_MS ? 0.35 : 0);
            for (let i = H.particles.length - 1; i >= 0; i--) {
              const q = H.particles[i];
              q.t += dt * FLOW_SPEED;
              if (q.t < 0) { q.m.visible = false; continue; }
              q.m.visible = true; q.m.position.copy(q.curve.getPoint(Math.min(1, q.t)));
              if (q.t >= 1) { // 도착: 알갱이 제거 + 맥박 + 파문 링 1개
                scene.remove(q.m); q.m.geometry.dispose(); q.m.material.dispose(); H.particles.splice(i, 1);
                H.arrivals.push(Date.now()); H.pulseAt = nowMs;
                const rg = new THREE.Mesh(new THREE.RingGeometry(RING_R0, RING_R0 + 0.06, 28), new THREE.MeshBasicMaterial({ color: PM3D.HUB.ring, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
                rg.rotation.x = -Math.PI / 2; rg.position.set(HUB_POS.x, base, HUB_POS.z); scene.add(rg);
                H.rings.push({ m: rg, t0: nowMs });
              }
            }
            for (let i = H.rings.length - 1; i >= 0; i--) {
              const R = H.rings[i]; const k = (nowMs - R.t0) / RING_MS;
              if (k >= 1) { scene.remove(R.m); R.m.geometry.dispose(); R.m.material.dispose(); H.rings.splice(i, 1); continue; }
              const s = (RING_R0 + (RING_R1 - RING_R0) * k) / RING_R0;
              R.m.scale.setScalar(s); R.m.material.opacity = 0.8 * (1 - k);
            }
          }
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
