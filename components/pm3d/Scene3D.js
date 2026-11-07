// components/pm3d/Scene3D.js — /pm 사무실 3D(베타). three.js 직교 아이소메트릭 카메라.
// 에셋: public/pm3d/kit.glb(모듈, AO 베이크=scripts/pm3d/bake_kit_ao.py) · char.glb(리그+클립 idle/sit_type/walk/doze/dance).
// 렌더 품질: nenova-pm/pm3d/QUALITY_RECIPE.md — 실시간 그림자 0(접지 블롭 평면) · AO 베이크(channel 1) ·
//   MeshToonMaterial 5단 파스텔 램프(캐릭터) · RoomEnvironment 1회 · ACESFilmic 노출 1.2 · 배경 그라데이션+안개.
// 확대·축소 = 배율 바(1% 단위)·맞춤 버튼만(휠 확대 없음). 확대했을 때만 드래그 이동.
// WebGL 없음·로드 실패·저사양(첫 프레임 3초 초과 / FPS<20)이면 onFallback(reason) → 부모가 2D 장면을 보여 준다.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { beachDecorGrid } from '../../lib/pm3dDecor';
import { CELL, tilesOf, facilityRects, worldBounds, walkPath, canOccupy, occupy, cellCenter, CRUISE_BOUNDS } from '../../lib/pm3dGrid';
import { STAGES } from '../../lib/pmStages';
import { layoutDesks, floorBounds, stationPos, look3d, animOf, shouldFallback, declutter, CAM_DIR, CAM_YAW, FPS_CAP, FPS_IDLE, IDLE_AFTER_MS, FPS_WARMUP_MS, FPS_WINDOW_MS, MAX_DPR, CHAR_SCALE, CHAR_STAND_H, seatWorld, SET_SCALE, PROP_SCALE, DEFAULT_ZOOM, defaultZoom, sceneFit, deskStyle, ARC_Y, bodyMetrics } from '../../lib/pm3dLayout';
import { usePmTheme } from '../pm/PmTheme';
import { ASSETS, ASSET_SCALE, DECOR_SCALE, TILE_TOP, unitForIndex, planParasols, worldToLocal, coastPick, boardwalkPick, railPick, fitScale, moundPick } from '../../lib/pm3dAssets';
import { loadKit, bake, lodBake, mergeStatic, mergeLocal, instanced, mat4, staticClone, splitUnit, hasBakedShadow } from './assetKit';
import { PM3D } from '../../lib/pmThemes';
import { pctToZoom, ZOOM_PCT_MIN, ZOOM_PCT_MAX } from '../../lib/pmZoom';
import { faceOf, isFaceId } from '../../lib/pmFaces';
import { mountById, mountPose } from '../../lib/pmMounts';
import { ridePath, pathLength, pathPoint, ringPoint, ringLength, ringRect, RIDE_MAX_CONCURRENT, rectPoint, rectLength, skyPoint, skyLength, bobY, insetRect, seaRect, flightPoint, FOLLOW_ZOOM, pickFollowTarget, followPan, followStep } from '../../lib/pm3dRide';
import { HUB_POS, HUB_ORB_Y, HUB_ORB_R, HUB_R, HUB_PEDESTAL_H, FLOW_MAX, FLOW_SPEED, flowSpawnCount, pulseScale, PULSE_MS, RING_MS, RING_R0, RING_R1, heartbeat, pruneArrivals, parkPose } from '../../lib/pm3dHub';
import { ZoomSlider } from '../pm/ui';

const THEMES = PM3D.THEMES; const U = PM3D.ui;
export const PM3D_THEMES = Object.keys(THEMES);
const STAGE_HEX = PM3D.STAGE;
// 책상 위 소품 슬롯(좌/중/우, 자리 그룹 로컬 좌표)과 펫 자리(책상 옆 바닥) — 구매 소품·펫이 3D 에서도 보이게
const PROP_SLOTS = [new THREE.Vector3(-0.61, 0.72 * 1.45 + 0.005, 0.22), new THREE.Vector3(0, 0.72 * 1.45 + 0.005, 0.3), new THREE.Vector3(0.61, 0.72 * 1.45 + 0.005, 0.22)];
const PET_SLOT = new THREE.Vector3(1.25, 0.22, 0.35);
const SEAT_Z = 0.62 * SET_SCALE; // 그룹 안 캐릭터·의자 위치(-Z = 책상 뒤, 캐릭터는 +Z = 카메라 쪽을 봄)
const SEAT_Y = 0.46 * SET_SCALE - 0.52 * CHAR_SCALE + 0.02; const DESK_H = 0.72 * SET_SCALE; const HEAD_Y = 1.78 * CHAR_SCALE + 0.35; // 앉은 엉덩이(비율 교정 후 sit 힙 ≈0.52 = 0.406×BODY_K+클립 오프셋)를 의자 좌판(0.46)에 맞춤. 1.78=교정 후 머리끝
const RQ = PM3D.RENDER; // 렌더 품질 토큰(nenova-pm/pm3d/QUALITY_RECIPE.md 기준)

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
    .then(([kit, ch, mounts]) => {
      // 클립의 상수 scale 채널 제거(베이크는 전부 1) — 체형(BODY_TYPES)의 런타임 head 본 스케일을 믹서가 되돌리지 않게
      for (const c of ch.animations || []) c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
      return { kit, ch, mounts, loadMs: Math.round(performance.now() - t0) };
    });
  kitP.catch(() => { kitP = null; });
  return kitP;
}
function laptop() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: U.laptop, roughness: 0.75 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.24), body); base.position.y = 0.01; g.add(base);
  const lid = new THREE.Group(); lid.position.set(0, 0.02, 0.12); lid.rotation.x = 0.35; // 화면 윗부분이 카메라 쪽으로 젖혀짐 g.add(lid);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.015), body); back.position.y = 0.1; lid.add(back);
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
// 이름표 공통 = 둥근 클레이 배지(11/07): 위 하이라이트 + 아래 안쪽 그늘 + 따뜻한 바닥 그림자
const CLAY_BADGE = 'inset 0 1.5px 0 rgba(255,255,255,.75), inset 0 -2px 0 rgba(120,80,50,.16), 0 2px 4px rgba(90,55,30,.22)';
const STATUS_VIBE ={ working: 'work', off: 'doze', idle: 'break' };
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
  const [follow, setFollow] = useState(false); // 비행 근접 컷
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
    // QUALITY_RECIPE: 전역 shadowMap 금지(그림자 = 접지 블롭 평면).
    // 톤매핑: ACES 는 파스텔을 하얗게 바래게 만들어(2026-11-05 사장님 "색이 안 나온다") 색 보존형 Neutral 로.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = RQ.toneMap === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = RQ.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // [2026-11-06 색감 교정] 시안 대비 채도가 낮아 보여(모래 베이지화) 캔버스에 GPU 합성 색 필터 — 성능 비용 0, 토큰으로 끄기 가능
    if (RQ.canvasFilter) renderer.domElement.style.filter = RQ.canvasFilter;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // 배경: 세로 그라데이션(bgTop→bg) + 같은 톤 안개로 깊이감
    {
      const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, T.bgTop || T.bg); gr.addColorStop(1, T.bg);
      g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
      const bgTex = new THREE.CanvasTexture(c); bgTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = bgTex;
    }
    // 2026-11-07 클레이 맵: 수중 느낌 청록 FogExp2(멀수록 청록으로 스며듦) — RQ.fogExp2 없으면 기존 선형 안개
    scene.fog = RQ.fogExp2 ? new THREE.FogExp2(new THREE.Color(RQ.fogExp2.color), RQ.fogExp2.density) : new THREE.Fog(new THREE.Color(T.bg), RQ.fogNear, RQ.fogFar);
    // 환경광: RoomEnvironment 1회 생성 → PMREM 1개 → 즉시 dispose(QUALITY_RECIPE ②-4, 매 프레임 재생성 금지)
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
      scene.environmentIntensity = RQ.env;
      pmrem.dispose();
    }
    scene.add(new THREE.HemisphereLight(RQ.hemiSky || U.hemiSky, RQ.hemiGround || U.hemiGround, RQ.hemi));
    const sun = new THREE.DirectionalLight(T.light, RQ.sun); sun.position.set(-12, 22, 14); // 그림자 없는 약한 키 라이트(방향감만)
    scene.add(sun); scene.add(sun.target);
    // 접지 블롭 그림자(평면+방사형 그라데이션) — 공짜 contact shadow
    const blobTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.65, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    // [2026-11-05 디자인 자문] 그림자 2겹 = 속(진하고 좁게) + 퍼짐(연하고 넓게) — SSAO 흉내, 비용은 투명 평면 1장 추가
    const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, color: RQ.blob.color, transparent: true, opacity: RQ.blob.coreOpacity ?? RQ.blob.opacity, alphaMap: blobTex, depthWrite: false });
    const blobMat2 = new THREE.MeshBasicMaterial({ map: blobTex, color: RQ.blob.spreadColor || RQ.blob.color, transparent: true, opacity: RQ.blob.spreadOpacity ?? 0, alphaMap: blobTex, depthWrite: false });
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    const blob = (parent, x, z, rx, rz, y = 0.015) => {
      const m = new THREE.Mesh(blobGeo, blobMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.set(rx * 2 * 0.72, rz * 2 * 0.72, 1); m.renderOrder = 2;
      parent.add(m);
      if (blobMat2.opacity > 0) {
        const s = new THREE.Mesh(blobGeo, blobMat2);
        s.rotation.x = -Math.PI / 2; s.position.set(x, y - 0.004, z); s.scale.set(rx * 2 * 1.35, rz * 2 * 1.35, 1); s.renderOrder = 1;
        parent.add(s); m.userData.spread = s;
      }
      return m;
    };
    // 캐릭터 셰이딩: 기본 standard(RQ.charShade) / 'toon' 이면 5단 파스텔 램프(NearestFilter 필수)
    const toonRamp = (() => {
      const steps = new Uint8Array(RQ.toonRamp);
      const t = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
      t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
    })();
    const clayMatcap = new THREE.TextureLoader().load('/pm3d/clay_matcap.png', () => st.poke?.(), undefined, () => {});
    clayMatcap.colorSpace = THREE.SRGBColorSpace;
    const toonify = (root) => root.traverse((m) => {
      if (!(m.isMesh || m.isSkinnedMesh) || !m.material) return;
      const s = m.material;
      const base = { color: s.color?.clone?.() || new THREE.Color('#ffffff'), map: s.map || null, transparent: s.transparent, opacity: s.opacity, side: s.side };
      // 블렌더 클레이 렌더 기준: 기본은 부드러운 standard(색·음영 보존), 'toon' 토큰이면 예전 5단 램프
      // 'clay' = 클레이 MatCap(scripts/pm3d/bake_clay_matcap.py) — 위 크림·아래 연보라/피치·외곽 크림 림이 구워져 있어 검은 그림자 없음, 조명 계산 0이라 모바일도 가벼움
      const tm = RQ.charShade === 'clay'
        ? new THREE.MeshMatcapMaterial({ ...base, matcap: clayMatcap })
        : RQ.charShade === 'toon'
        ? new THREE.MeshToonMaterial({ ...base, gradientMap: toonRamp })
        : new THREE.MeshStandardMaterial({ ...base, roughness: RQ.charRough ?? 0.78, metalness: 0, normalMap: s.normalMap || null });
      tm.name = s.name; m.material = tm;
    });
    // 정적 모듈(kit) 클레이 질감: roughness 0.6~0.8 클램프 + AO 베이크(kit_ao.jpg, TEXCOORD_1) 주입
    const kitAo = new THREE.TextureLoader().load('/pm3d/kit_ao.jpg', () => st.poke?.(), undefined, () => {});
    kitAo.flipY = false; kitAo.channel = 1;
    // 소품·탈것·타일 일괄 클레이화(RQ.propShade 'clay'): standard 재질 → 클레이 MatCap. 발광(화면)·구운 그림자판은 그대로 둔다.
    const toClayMat = (m) => {
      if (RQ.propShade !== 'clay' || !m || m.isMeshMatcapMaterial || m.userData?.bakedShadow || /shadow|screen/i.test(m.name || '')) return null;
      if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) return null;
      const c = new THREE.MeshMatcapMaterial({ color: m.color?.clone?.() || new THREE.Color('#ffffff'), map: m.map || null, matcap: clayMatcap, vertexColors: !!m.vertexColors, transparent: m.transparent, opacity: m.opacity, side: m.side });
      c.name = m.name; c.userData = { ...m.userData }; return c;
    };
    const clay = (mesh) => {
      const m = mesh?.material ?? mesh; // 메시 또는 재질 모두 허용
      if (mesh?.isMesh) { const c = toClayMat(m); if (c) { mesh.material = c; return; } }
      if (!m || m.roughness === undefined) return;
      m.roughness = Math.min(RQ.roughMax, Math.max(RQ.roughMin, m.roughness ?? 1)); m.metalness = 0;
      // AO 베이크(TEXCOORD_1)가 있는 kit 메시에만 주입 — uv1 없는 메시(mounts 등)에 붙이면 셰이더 경고
      if (!m.aoMap && mesh?.geometry?.attributes?.uv1) { m.aoMap = kitAo; m.aoMapIntensity = RQ.aoIntensity; }
    };
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    if (typeof window !== 'undefined' && window.__PM3D_DEBUG) Object.assign(window.__PM3D_DEBUG, { renderer, scene, cam }); // 성능 측정 훅(window.__PM3D_DEBUG 를 미리 둔 측정 페이지에서만)
    const pan = new THREE.Vector3(); const wp = new THREE.Vector3();
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
      const mod = (n) => { const o = kit.scene.getObjectByName(n); if (!o) return new THREE.Group(); const c = o.clone(true); c.position.set(0, 0, 0); c.traverse((m) => { if (m.isMesh) clay(m); }); return c; };
      const put = (n, x, z, ry = 0, s = 1) => { const o = mod(n); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s); scene.add(o); return o; };
      st.mounts = mounts ? mounts.scene : null;
      const lay = T.layout || {};
      const { desks, plates, world } = layoutDesks(dataRef.current.rooms);
      const { hx, hz } = floorBounds(desks, lay.mapScale || 1);
      const island = T.props !== 'office'; // 해변 = 격자 섬 세계(lib/pm3dGrid), 사무실 테마 = 기존 사각 바닥
      st.bounds = island ? { ...CRUISE_BOUNDS } : { hx, hz };
      st.world = world;
      // [2026-11-06] 탈것 코스: 수영장·카트트랙 실좌표(시설 존 안쪽 루프) — 크루징이 코스를 실제로 돌게
      if (island) { st.courses = {}; for (const r of facilityRects(world)) { if (r.kind === 'pool') st.courses.pool = insetRect(r, 1.0); else if (r.kind === 'kart') st.courses.kart = insetRect(r, 0.9); else if (r.kind === 'airfield') st.courses.runway = { x0: Math.min(r.x0, r.x1) + 1, x1: Math.max(r.x0, r.x1) - 1, z: (r.z0 + r.z1) / 2 }; } }
      const fb = island ? floorBounds(desks) : { hx, hz }; // 섬: 광장+자리 줄이 화면에 차게(캐릭터 90~110px 규칙), 나머지는 이동·축소로
      st.fit = sceneFit(fb.hx, fb.hz); placeCam();
      // 첫 화면 배율 = 기획 기준(캐릭터 ≈100px) 자동 계산 — 인원이 늘어 fit 이 커져도 휑하지 않게. 최초 1회만(사용자 조작 보존).
      if (!st.zoomInit) {
        st.zoomInit = true; const z0 = defaultZoom(st.fit, el.clientHeight || 720);
        const z1 = island && z0 > 1 ? Math.max(1.05, +(z0 * 0.86).toFixed(2)) : +z0.toFixed(2); // 시안 프레이밍: 살짝 넓게 잡고
        if (z1 > DEFAULT_ZOOM + 0.01) setZoom(z1);
        // 첫 화면 시선을 북서쪽으로 당겨 해안·바다가 좌상단에 걸리게(섬 테마만, 사용자 조작 전 1회)
        if (island && z1 > 1) { pan.set(-4.6, 0, -4.6); placeCam(); }
      }
      // 연구실 로봇 자리(섬: 1호 섬 남쪽 해변 끝단 칸 점유 — 장식보다 먼저, 다리 착지 열 제외)
      const robotSpots = [];
      if (island) for (const X of [-11, -9, -7, -5, 3, 5, 7, 9]) { const c = [{ X, Z: 11 }]; if (canOccupy(world, c)) { occupy(world, c, `robot:${X}`); robotSpots.push(cellCenter(X, 11)); } }
      if (!island) for (let x = -hx + 1; x < hx; x += 2) for (let z = -hz + 1; z < hz; z += 2) put(T.floor, x, z);
      // 테마 장식
      if (!island) {
        for (let x = -hx + 1; x < hx; x += 2) put('wall', x, -hz);
        for (let z = -hz + 1; z < hz; z += 2) put('wall', -hx, z, Math.PI / 2);
        [[-hx + 1, -hz + 1.2], [hx - 1, -hz + 1.2], [hx - 1, hz - 1], [-hx + 1.2, hz - 1]].forEach(([x, z]) => put('plant_k1', x, z));
        put('lamp_k', -hx + 2.2, -hz + 1.1); put('lamp_k', hx - 2.3, hz - 1.3);
        put('parcel', hx - 2.4, -hz + 1.3); put('parcel', hx - 2.9, -hz + 1.6, 0.5, 0.8);
        for (const p of plates) put('partition', p.x, p.z - Math.sign(p.z) * 0.1);
      } else {
        // 격자 섬 세계: 바다 평면 1장 + 칸 타일 종류별 InstancedMesh(드로콜 = 종류 수) · 시설 존은 예약 칸 연한 테두리만
        const GC = PM3D.GRID;
        const wb = worldBounds(world);
        {
          // [2026-11-07 사장님 스크린샷 "바다 위 사각 판"] 얕은 물·해안 거품·반짝임·명암판을 별도 사각 평면 6장+스프라이트 18개로
          //   겹쳐 두던 것을 바다 셰이더 한 장 안에서 계산 → 사각 테두리·이음매 0, 드로콜 -24, 투명 겹침(오버드로) 제거.
          //   물결 = 정점 셰이더 sin 2겹(uTime 1개만 갱신 → FPS_CAP 불변·CPU 비용 0). 해안 거리 = 섬 사각형의 둥근 SDF.
          const cx = (wb.x0 + wb.x1) / 2, cz = (wb.z0 + wb.z1) / 2;
          const iw = wb.x1 - wb.x0, ih = wb.z1 - wb.z0;
          const seaMat = new THREE.MeshLambertMaterial({ color: T.sea || GC.sea });
          st.seaTime = { value: 0 };
          const shallowC = new THREE.Color(T.sea || GC.sea).lerp(new THREE.Color('#c2f1f0'), 0.42);
          seaMat.onBeforeCompile = (sh) => {
            sh.uniforms.uTime = st.seaTime;
            sh.uniforms.uHalf = { value: new THREE.Vector2(iw / 2, ih / 2) };
            sh.uniforms.uShallow = { value: shallowC };
            sh.fragmentShader = 'uniform float uTime;\nuniform vec2 uHalf;\nuniform vec3 uShallow;\nvarying vec2 vSea;\n' + sh.fragmentShader
              .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 q = abs(vSea) - uHalf + 1.2;
  float dCoast = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.2; // 섬 가장자리에서 바깥으로 거리(m)
  // 깊이 그라데이션(색감 보완 11/07): 먼 바다는 채도·명도를 낮춘 깊은 청록, 해안 쪽은 밝은 얕은 물 — 쨍한 단색 평면감 제거
  vec3 deepC = diffuseColor.rgb * vec3(0.62, 0.74, 0.80);
  diffuseColor.rgb = mix(diffuseColor.rgb, deepC, smoothstep(3.0, 22.0, dCoast));
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, (1.0 - smoothstep(0.0, 4.5, dCoast)) * 0.85);
  float br = 0.55 + 0.35 * sin(uTime * 1.1);
  float foam = smoothstep(1.0, 0.25, abs(dCoast - 0.35 - 0.12 * br)) * (0.38 + 0.14 * br);
  float glint = pow(max(0.0, sin(vSea.x * 2.3 + uTime * 1.3) * sin(vSea.y * 1.9 - uTime * 0.9)), 24.0) * (1.0 - smoothstep(2.0, 9.0, dCoast)) * 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(foam + glint, 0.0, 1.0));`);
            sh.vertexShader = 'uniform float uTime;\nvarying vec2 vSea;\n' + sh.vertexShader
              .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  float wA = 0.55, wB = 0.38;
  vec2 wp = position.xy;
  vSea = wp;
  float dX = 0.06 * wA * cos(wp.x * wA + uTime * 1.1) + 0.04 * wB * cos((wp.x + wp.y) * wB + uTime * 0.8);
  float dY = 0.04 * wB * cos((wp.x + wp.y) * wB + uTime * 0.8);
  objectNormal = normalize(vec3(-dX, -dY, 1.0));`)
              .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.z += 0.06 * sin(wp.x * wA + uTime * 1.1) + 0.04 * sin((wp.x + wp.y) * wB + uTime * 0.8);`);
          };
          // 격자 48×48(이전 96×96 → 삼각형 1/4). 물결 파장 ≈ 11m 라 칸 ~1.5m 로 충분
          const sea = new THREE.Mesh(new THREE.PlaneGeometry(iw + 60, ih + 60, 48, 48), seaMat);
          sea.rotation.x = -Math.PI / 2; sea.position.set(cx, -0.12, cz); scene.add(sea);
        }
        st.fb = { tiles: {}, reserved: [], palms: [], scatter: [] };
        const tiles = tilesOf(world);
        const tileH = { beach: 0.08, sand: 0.1, path: 0.11, plaza: 0.12, boardwalk: 0.13, bridge: 0.13 };
        const tGeo = new THREE.BoxGeometry(1, 1, 1);
        const m4 = new THREE.Matrix4(); const q0 = new THREE.Quaternion(); const v0 = new THREE.Vector3(); const s0 = new THREE.Vector3();
        for (const [kind, h] of Object.entries(tileH)) {
          const list = tiles[kind]; if (!list.length) continue;
          const mat0 = new THREE.MeshStandardMaterial({ color: GC[kind], roughness: 0.8 }); const mat = toClayMat(mat0) || mat0; // 광장·통로 타일도 클레이
          const im = new THREE.InstancedMesh(tGeo, mat, list.length);
          const gap = kind === 'boardwalk' || kind === 'bridge' ? 0.94 : 1;
          list.forEach((t, i) => { m4.compose(v0.set(t.x, -h / 2, t.z), q0, s0.set(CELL * gap, h, CELL * gap)); im.setMatrixAt(i, m4); });
          im.instanceMatrix.needsUpdate = true; scene.add(im); st.fb.tiles[kind] = im;
        }
        // 시설 예약 부지(수영장·카트트랙·비행장) — 연한 테두리 선만(실물은 애셋 도착 후)
        for (const r of facilityRects(world)) {
          const g = new THREE.BufferGeometry().setFromPoints([[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x0, r.z0]].map(([x, z]) => new THREE.Vector3(x + (x === r.x0 ? 0.1 : -0.1), 0.02, z + (z === r.z0 ? 0.1 : -0.1))));
          const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: GC.reserved, transparent: true, opacity: 0.7 }));
          ln.userData = { kind: 'reserved', zone: r.kind, label: r.label }; scene.add(ln); st.fb.reserved.push(ln);
        }
        // 배경 밀도 — 야자수·바위·조개·불가사리를 비점유 해변 끝단 칸에만(lib/pm3dDecor.beachDecorGrid, 칸 점유 기록)
        const D = beachDecorGrid(world);
        for (const p of D.palms) { const o = put('palm', p.x, p.z, p.ry, p.s); blob(o, 0, 0, 0.75 * p.s, 0.75 * p.s); st.fb.palms.push({ o, p }); }
        for (const q of D.scatter) st.fb.scatter.push({ o: put(q.m, q.x, q.z, q.ry, q.s), q });
      }
      // 스테이션 1~9
      STAGES.forEach((s) => {
        const p = stationPos(s.no); const o = put(`station_${s.no}`, p.x, p.z, 0, 1.18); mergeLocal(o); // 부품 재질별 병합(드로콜↓)
        // 색감 보완(11/07): 9단계 표지 = 주인공 → 18% 크게 + 채도 한 단계↑(파스텔 배경 위로 시선 유도)
        o.traverse((m) => { if (m.isMesh && m.material?.color && !/glow|shadow/i.test(m.material.name || '')) { m.material = m.material.clone(); m.material.color.offsetHSL(0, 0.12, -0.02); } });
        o.userData = { kind: 'stage', no: s.no, label: s.label }; st.stations.push(o); st.clickables.push(o);
        blob(o, 0, 0, 1.0, 0.95);
      });
      // 중앙 허브 "회사 심장" — 받침대 위 떠 있는 수정구(파스텔 자체발광 · 느린 회전+부유). lib/pm3dHub 위치(주행로·좌석·스테이션 교차 0, 테스트 보증)
      {
        const HC = PM3D.HUB;
        const grp = new THREE.Group(); grp.position.set(HUB_POS.x, 0, HUB_POS.z); scene.add(grp);
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R * 0.72, HUB_R, HUB_PEDESTAL_H, 14), (toClayMat(new THREE.MeshStandardMaterial({ color: HC.pedestal })) || new THREE.MeshStandardMaterial({ color: HC.pedestal, roughness: 0.8 })));
        ped.position.y = HUB_PEDESTAL_H / 2; grp.add(ped);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R * 0.82, HUB_R * 0.72, 0.08, 14), (toClayMat(new THREE.MeshStandardMaterial({ color: HC.pedestalTop })) || new THREE.MeshStandardMaterial({ color: HC.pedestalTop, roughness: 0.7 })));
        top.position.y = HUB_PEDESTAL_H + 0.04; grp.add(top);
        const orbMat = new THREE.MeshStandardMaterial({ color: HC.crystal, emissive: HC.glow, emissiveIntensity: 0.55, roughness: 0.25, transparent: true, opacity: 0.95 });
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(HUB_ORB_R, 2), orbMat); orb.position.y = HUB_ORB_Y; grp.add(orb);
        blob(grp, 0, 0, HUB_R * 1.15, HUB_R * 1.1);
        st.hub = { grp, orb, orbMat, arrivals: [], particles: [], rings: [], pulseAt: -1e9, bobPh: 0 };
      }
      // 연구실 로봇(AI 에이전트) — 뒤쪽 줄
      (dataRef.current.agents || []).slice(0, 8).forEach((a, i) => {
        const rp = island ? robotSpots[i] : null;
        if (island && !rp) return;
        const o = put('robot', rp ? rp.x : -hx + 2 + i * 1.8, rp ? rp.z : hz - 1.9, 0, 0.8); o.userData = { kind: 'robot', name: a.name || a.id, status: a.status, baseY: 0, i };
        mergeLocal(o); // 부품 재질별 병합 후 재질 복제(투명도는 로봇 단위라 겉모습 동일)
        o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; } });
        blob(o, 0, 0, 0.55, 0.5);
        st.robots.push(o);
      });
      // 직원 자리 — 파라솔은 전 자리 동시 계획(lib/pm3dAssets.planParasols: 캐릭터 정뒤·누구도 가리지 않는 자리, 없으면 생략)
      const pPlan = island ? planParasols(desks.map((d) => ({ ...seatWorld(d), headTop: CHAR_STAND_H * CHAR_SCALE + 0.1, size: d.size || 2 }))) : [];
      const depts = [...new Set(desks.map((d) => d.dept))];
      st.seatFx = [];
      for (const [di, d] of desks.entries()) {
        const g = new THREE.Group(); g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; scene.add(g);
        const dstyle = deskStyle(d.dept, '', PM3D.DESK_SKINS);
        const desk = mod(dstyle.model); desk.scale.setScalar(SET_SCALE);
        // Kenney desk_k1 은 피벗이 모서리에 있음 → 바닥 중심(그룹 원점)으로 재중심(x/z), 바닥 y=0 맞춤.
        // 이게 빠지면 책상이 자리에서 대각선으로 밀려 "의자+캐릭터 따로, 책상 따로" 로 보인다(사장님 스크린샷 회귀).
        const dbb = new THREE.Box3().setFromObject(desk); const dc = dbb.getCenter(new THREE.Vector3());
        desk.position.set(-dc.x, -dbb.min.y, -dc.z); g.add(desk);
        blob(g, 0, 0.05, 1.05, 0.75); // 책상 접지 그림자
        const chairBlob = blob(g, 0, -SEAT_Z, 0.52, 0.48, 0.02); // 의자·캐릭터 접지 그림자(체형 s 를 따라감)
        if (dstyle.color) desk.traverse((m) => { if (m.isMesh && m.material) { m.material = m.material.clone(); m.material.color.lerp(new THREE.Color(dstyle.color), 0.4); } }); // 부서색 틴트
        // 낮은 노트북(화면 높이 0.2m) — 실측 책상 상판 높이 위에 얹음(고정 DESK_H는 Kenney 책상보다 높아 공중부양). 화면은 캐릭터 쪽(-Z).
        const deskTopY = dbb.max.y - dbb.min.y;
        const mon = laptop(); mon.scale.setScalar(SET_SCALE); mon.position.set(0, deskTopY + 0.01, -0.07); g.add(mon);
        const chair = mod(dstyle.chair || 'chair_k1'); // Kenney 의자도 피벗 보정 후 좌석(0,0,-SEAT_Z)에 중심 배치
        const cbb = new THREE.Box3().setFromObject(chair); const cc = cbb.getCenter(new THREE.Vector3());
        chair.position.set(-cc.x, -cbb.min.y, -SEAT_Z - cc.z); g.add(chair);
        // 격자 섬: 자리 = 파라솔+책상(파라솔 색 = 부서색). 자리 칸(2×2/3×3) 안쪽 뒤 모서리
        if (island) {
          const ps = mod('parasol'); const k = (d.size || 2) * CELL / 2 - 0.35; ps.position.set(k, 0, -k); ps.scale.setScalar(0.85); g.add(ps);
          if (dstyle.color) ps.traverse((m) => { if (m.isMesh && m.material && !/pole|stick|wood/i.test(m.material.name || '')) { m.material = m.material.clone(); m.material.color.lerp(new THREE.Color(dstyle.color), 0.55); } });
          st.seatFx.push({ g, d, desk, mon, ps, cn: pPlan[di], unit: unitForIndex(depts.indexOf(d.dept)), deskTopY });
        }
        if (!d.person) continue;
        const ch2 = skClone(ch.scene); ch2.scale.setScalar(CHAR_SCALE); ch2.position.set(0, SEAT_Y, -SEAT_Z); ch2.rotation.y = 0;
        ch2.traverse((m) => { if (m.isMesh || m.isSkinnedMesh) { m.frustumCulled = false; if (m.material) m.material = m.material.clone(); } });
        toonify(ch2); // 5단 파스텔 toon 램프(QUALITY_RECIPE ②-3) — 색 갈아입히기는 재질 이름으로 그대로 동작
        g.add(ch2);
        const mixer = new THREE.AnimationMixer(ch2);
        const acts = Object.fromEntries(ch.animations.map((c) => [c.name, mixer.clipAction(c)]));
        const emo = emojiSprite(' '); emo.position.set(0, HEAD_Y, -SEAT_Z); emo.visible = false; g.add(emo);
        const person = { name: d.person.name, g, desk, mon, ch: ch2, mixer, acts, cur: '', emo, emoTxt: '', home: new THREE.Vector3(0, SEAT_Y, -SEAT_Z), deskTop: deskTopY, walk: null, stage: null, decor: [], d, blobChar: chairBlob };
        ch2.userData = { kind: 'person', name: d.person.name };
        st.clickables.push(ch2, desk);
        desk.userData = { kind: 'person', name: d.person.name };
        st.people.set(d.person.name, person);
      }
      // [게임화 1차] 입장 연출: 자리·스테이션이 톡톡 튀어오르며 등장(easeOutBack, 0.9초 스태거). 모션 줄이기면 생략
      if (!dataRef.current.reduced) {
        const objs = [...st.seatFx.map((f) => f.g), ...st.stations];
        st.intro = { t0: performance.now(), items: objs.map((o, i) => ({ o, base: o.scale.x || 1, delay: Math.min(900, i * 55) })) };
        for (const it of st.intro.items) it.o.scale.setScalar(it.base * 0.001);
      }
      // [게임화 1차] 하늘 구름: 말랑 구름 스프라이트가 천천히 흘러감(섬 테마만, 스프라이트 4장 = 비용 미미)
      if (island) {
        const cc = document.createElement('canvas'); cc.width = 256; cc.height = 128; const cg = cc.getContext('2d');
        cg.fillStyle = 'rgba(255,255,255,.96)';
        for (const [bx, by, br] of [[70, 84, 38], [120, 66, 50], [176, 84, 40], [120, 92, 52]]) { cg.beginPath(); cg.arc(bx, by, br, 0, Math.PI * 2); cg.fill(); }
        const ct = new THREE.CanvasTexture(cc); ct.colorSpace = THREE.SRGBColorSpace;
        st.clouds = [];
        for (let i = 0; i < 4; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
          const s = 6 + i * 1.8; sp.scale.set(s, s * 0.5, 1);
          sp.position.set(-6 + i * 9, 7 + (i % 2) * 2, -12 - i * 2);
          scene.add(sp); st.clouds.push(sp);
        }
      }
      st.built = true;
      setStat(`로드 ${loadMs}ms`);
      apply();
      if (island) mountAssets(); // 블렌더 glb 애셋은 첫 화면 뒤에 지연 장착(첫 프레임·저사양 폴백 판정에 영향 없음)
    };

    // ── 블렌더 glb 애셋 장착(lib/pm3dAssets · components/pm3d/assetKit). 실패한 애셋은 기존 단순 그래픽 그대로 ──
    const mountAssets = () => {
      const names = [...ASSETS.tiles, ...ASSETS.units, ...ASSETS.props, ...ASSETS.pool, ...ASSETS.kart, ...ASSETS.airfield];
      loadKit(names).then(({ scenes: A, ms, bytes, failed }) => {
        if (dead) return;
        const t0 = performance.now();
        const before = new Set(scene.children); // 이 단계에서 새로 깔리는 정적 소품만 골라 마지막에 재질별 병합(mergeStatic)
        const clayM = (m) => { const c = toClayMat(m); if (c) return c; if (m.roughness !== undefined) { m.roughness = Math.min(RQ.roughMax, Math.max(RQ.roughMin, m.roughness ?? 1)); m.metalness = 0; } };
        const world = st.world; const S = ASSET_SCALE; const y0 = -TILE_TOP * S;
        // 1) 칸 타일: 모래·해안·보드워크·다리(재질별 InstancedMesh). 광장·통로는 기존 색 타일 유지
        const land = (X, Z) => world.cells.get(`${X},${Z}`);
        const groups = new Map(); const addT = (asset, x, z, yaw, y = y0) => { if (!groups.has(asset)) groups.set(asset, []); groups.get(asset).push(mat4(x, y, z, yaw, S)); };
        // [기차레일] 레일은 기차가 실제로 도는 둘레 순환로(ringRect)와 겹치는 보드워크 칸에만
        const RR = ringRect(CRUISE_BOUNDS.hx, CRUISE_BOUNDS.hz);
        const nearRing = (x, z) => {
          const dx = Math.max(RR.x0 - x, 0, x - RR.x1); const dz = Math.max(RR.z0 - z, 0, z - RR.z1);
          const inside = x >= RR.x0 && x <= RR.x1 && z >= RR.z0 && z <= RR.z1;
          const d = inside ? Math.min(x - RR.x0, RR.x1 - x, z - RR.z0, RR.z1 - z) : Math.hypot(dx, dz);
          return d < 0.52;
        };
        const onRing = (X, Z) => { const q = land(X, Z); return !!q && q.kind === 'boardwalk' && nearRing((X + 0.5) * CELL, (Z + 0.5) * CELL); };
        for (const c of world.cells.values()) {
          const x = (c.X + 0.5) * CELL; const z = (c.Z + 0.5) * CELL;
          if (c.kind === 'sand') { const lc = ((c.X % 28) + 28 + 12) % 28; const lr = ((c.Z % 28) + 28 + 12) % 28; const md = !world.occ.has(`${c.X},${c.Z}`) && moundPick(c.X, c.Z, lc, lr); addT(md || 'tile_sand', x, z, 0); } // [P2] 바깥 띠 일부 = 모래 둔덕(점유·보행 칸 제외)
          else if (c.kind === 'beach') { const sea = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !land(c.X + dx, c.Z + dz)); const k = coastPick(sea); addT(k.asset, x, z, k.yaw); }
          else if (c.kind === 'boardwalk') { const bw = (dx, dz) => { const n = land(c.X + dx, c.Z + dz); return !!n && (n.kind === 'boardwalk' || n.kind === 'bridge'); }; const conn = { n: bw(0, -1), s: bw(0, 1), e: bw(1, 0), w: bw(-1, 0) }; const k = boardwalkPick(conn); addT(k.asset, x, z, k.yaw); if (onRing(c.X, c.Z)) { const rl = railPick({ n: onRing(c.X, c.Z - 1), s: onRing(c.X, c.Z + 1), e: onRing(c.X + 1, c.Z), w: onRing(c.X - 1, c.Z) }); addT(rl.asset, x, z, rl.yaw, y0 + 0.012); } } // [기차레일] 둘레 순환로에만 레일
          else if (c.kind === 'bridge') addT('tile_bridge', x, z, c.axis === 'x' ? 0 : Math.PI / 2, -0.06 * S);
        }
        const done = new Set();
        for (const [asset, list] of groups) {
          if (!A[asset]) continue;
          const tg = instanced(list.length >= 20 ? lodBake(bake(A[asset])) : bake(A[asset]), list, clayM); // 많이 깔리는 타일 = 경량판(lodBake)
          // 색감 보완(11/07): 같은 타일이 똑같은 베이지로 반복돼 단조롭던 바닥 → 칸마다 명도 ±5% 변주(인스턴스 색, 비용 0)
          if (/^tile_(sand|coast|mound)/.test(asset)) tg.traverse((im) => { if (!im.isInstancedMesh || im.material?.userData?.bakedShadow) return; const c = new THREE.Color(); for (let i = 0; i < im.count; i++) { const h = Math.sin(i * 12.9898 + asset.length * 78.233) * 43758.5453; const k = 0.95 + (h - Math.floor(h)) * 0.09; im.setColorAt(i, c.setRGB(k, k * 0.995, k * 0.985)); } if (im.instanceColor) im.instanceColor.needsUpdate = true; });
          scene.add(tg); done.add(asset);
        }
        const hideFb = (kind, ok) => { if (ok && st.fb.tiles[kind]) st.fb.tiles[kind].visible = false; };
        hideFb('sand', done.has('tile_sand'));
        hideFb('beach', done.has('tile_coast_a') && done.has('tile_coast_b') && done.has('tile_sand'));
        hideFb('boardwalk', ['tile_boardwalk_straight', 'tile_boardwalk_corner', 'tile_boardwalk_cross'].every((a) => done.has(a) || !groups.has(a)));
        hideFb('bridge', done.has('tile_bridge'));
        // 2) 자리 유닛: 책상(작업) → 캐릭터 → 파라솔(맨 뒤). 유닛 책상 윗면 = 기존 책상 윗면(소품 슬롯 높이 유지)
        // 구운 접지 그림자: 애셋 바닥 상자(Box3) 타원 블롭 — 실시간 그림자 0 유지(QUALITY_RECIPE), 비용 = 투명 평면 1장
        const shade = (n, k = 0.25) => { // k = 물체 바닥 상자보다 번지는 여유(m)
          if (!n) return n;
          if (hasBakedShadow(n)) return n; // [P1] 애셋이 자기 그림자를 구워 들고 오면 procedural 블롭 생략
          n.updateWorldMatrix(true, true);
          const b = new THREE.Box3().setFromObject(n); if (!isFinite(b.min.x)) return n;
          blob(scene, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, Math.max(0.25, (b.max.x - b.min.x) / 2 + k), Math.max(0.25, (b.max.z - b.min.z) / 2 + k), 0.02);
          return n;
        };
        let seats = 0;
        for (const f of st.seatFx) {
          const U = A[f.unit]; if (!U) continue;
          const { desk: ud, parasol: up } = splitUnit(U, clayM); mergeLocal(ud); mergeLocal(up); // 자리 유닛 부품 재질별 병합(드로콜↓, 책상 상판 등 이름 다른 재질은 따로 남음)
          ud.scale.setScalar(f.deskTopY / 1.17); ud.rotation.y = Math.PI; // 유닛 책상 윗면 1.17(애셋) → 기존 책상 높이, 화면이 캐릭터(-Z) 쪽
          ud.userData = f.d.person ? { kind: 'person', name: f.d.person.name } : {};
          f.g.add(ud); shade(ud, 0.15); f.desk.visible = false; f.mon.visible = false; st.clickables.push(ud);
          f.ps.visible = false;
          if (f.cn) { const l = worldToLocal(f.cn.x - f.d.x, f.cn.z - f.d.z, f.d.yaw); up.position.set(l.x, 0, l.z); up.scale.setScalar(f.cn.scale); f.g.add(up); if (!hasBakedShadow(up)) blob(scene, f.cn.x, f.cn.z, f.cn.r * 0.72, f.cn.r * 0.72, 0.018); f.g.userData.parasolTip = { x: l.x, y: f.cn.y1 + 0.25, z: l.z }; } // 작업 말풍선 기준점 = 파라솔 꼭대기 위
          seats++;
        }
        // 2.5) 서핑보드: 파라솔 기둥 옆에 기대 세움(디자인 자문 — 빈 공간 소품). 4자리마다 1개, 자체 16° 기울기 베이크
        {
          let sb = 0;
          for (const f of st.seatFx) {
            if (!f.cn || sb++ % 4 !== 0) continue;
            if (A.prop_surfboard) { const n = staticClone(A.prop_surfboard, clayM); n.position.set(f.cn.x + f.cn.r * 0.55, 0, f.cn.z + f.cn.r * 0.4); n.rotation.y = Math.PI / 5 + sb; n.scale.setScalar(f.cn.scale * 0.5); scene.add(n); shade(n, 0.1); }
          }
        }
        // 2.6) [P3] 깃발 체인: 같은 줄 이웃 파라솔 꼭대기 사이에 걸기(두 쌍 중 하나만 — 과밀 방지)
        {
          const cns = st.seatFx.filter((f) => f.cn).map((f) => f.cn);
          let laid = 0;
          for (let i = 0; i + 1 < cns.length; i++) {
            const A1 = cns[i]; const B1 = cns[i + 1];
            const d = Math.hypot(B1.x - A1.x, B1.z - A1.z);
            if (d < 2.0 || d > 4.4 || Math.abs(B1.z - A1.z) > 1.2 || laid++ % 2) continue;
            if (!A.prop_flag_chain) break;
            const n = staticClone(A.prop_flag_chain, clayM);
            const sc = (A1.y1 * 0.92) / 2.42; // 기둥(2.42)을 파라솔 꼭대기 높이에 근사
            n.scale.set(d / (3.92 * sc) * sc, sc, sc);
            n.position.set((A1.x + B1.x) / 2, 0, (A1.z + B1.z) / 2);
            n.rotation.y = Math.atan2(B1.x - A1.x, B1.z - A1.z) + Math.PI / 2;
            scene.add(n);
          }
        }
        // 3) 소품: 야자수·바위·덤불(해변 끝단 장식 교체)
        const one = (asset, x, z, ry, s, y = 0) => {
          if (!A[asset]) return null; const n = staticClone(A[asset], clayM); n.position.set(x, y, z); n.rotation.y = ry; n.scale.setScalar(s); scene.add(n);
          if (!/^(track_|runway_|tile_|pool_|float_)/.test(asset)) shade(n); // 바닥 깔림형·물 위 애셋은 그림자 제외
          return n;
        };
        st.palms3d = [];
        for (const { o, p } of st.fb.palms) { const g3 = one('prop_palm', p.x, p.z, p.ry, DECOR_SCALE * p.s); if (g3) { o.visible = false; st.palms3d.push(g3); } }
        for (const { o, q } of st.fb.scatter) {
          const n = q.m === 'rock' ? one('prop_rock', q.x, q.z, q.ry, DECOR_SCALE * Math.max(0.7, q.s))
            : q.m === 'shell' ? (one('prop_pebbles', q.x, q.z, q.ry, DECOR_SCALE * 0.8) || one('prop_bush', q.x, q.z, q.ry, DECOR_SCALE * 0.8))
            : q.m === 'starfish' ? (one('prop_starfish', q.x, q.z, q.ry, DECOR_SCALE * 0.7) || one('prop_pebbles', q.x, q.z, q.ry, DECOR_SCALE * 0.7)) : null;
          if (n) o.visible = false;
        }
        // 4) 시설 존(예약 부지 → 실물). 애셋 단위 치수는 ASSET_LIST.md 실측
        for (const r of facilityRects(world)) {
          const w = r.x1 - r.x0; const dd = r.z1 - r.z0; const cx = (r.x0 + r.x1) / 2; const cz = (r.z0 + r.z1) / 2; let ok = false;
          if (r.kind === 'pool') {
            const s = fitScale(w, dd, 7.4, 4.0, 0.85); ok = !!one('pool_kit', cx, cz, 0, s);
            one('pool_ladder', cx + 2.6 * s, cz - 1.75 * s, Math.PI, s);
            [['float_flamingo', -1.6], ['float_duck', 0], ['float_ring', 1.6]].forEach(([n, ox], i) => one(n, cx + ox * s, cz + (i % 2 ? 0.25 : -0.25) * s, i * 1.3, s * 0.38, 0.32 * s));
            one('prop_sign', cx - 3.2 * s, cz + 2.6 * s, 0, s);
            one('prop_table_set', cx - 4.6 * s, cz - 1.2 * s, 0.4, s * 0.9); one('prop_beach_set', cx - 4.2 * s, cz + 1.8 * s, 1.1, s); // [P3] 수영장 옆 테이블·비치타월
          } else if (r.kind === 'kart') {
            // [2026-11-06 사장님 '서킷 짤림'] 열린 조각 배치 → 닫힌 스타디움 루프(직선 2 + 코너 4)
            const s = fitScale(w, dd, 15, 9.4, 0.9); const dx = 4.4 * s, dz = 2.1 * s;
            ok = !!one('track_straight', cx, cz + dz, 0, s); one('track_straight', cx, cz - dz, Math.PI, s);
            one('track_corner', cx + dx, cz - dz, 0, s); one('track_corner', cx + dx, cz + dz, -Math.PI / 2, s);
            one('track_corner', cx - dx, cz + dz, Math.PI, s); one('track_corner', cx - dx, cz - dz, Math.PI / 2, s);
            one('track_arch', cx, cz + dz, Math.PI / 2, s); one('kart_coral', cx - 1.8 * s, cz - dz, 0, s); one('kart_mint', cx + 1.2 * s, cz + dz, 0, s);
            one('prop_crates', cx - 3 * s, cz, 0.3, s); one('prop_sign', cx + 3.6 * s, cz, 0, s);
          } else if (r.kind === 'airfield') {
            const s = fitScale(w, dd, 16, 7.2, 0.95); ok = !!one('runway_straight', cx, cz, 0, s);
            one('runway_threshold', cx + 6 * s, cz, 0, s); one('runway_threshold', cx - 6 * s, cz, Math.PI, s);
            one('prop_plane', cx - 1 * s, cz, 0, s); one('prop_windsock', cx + 5 * s, cz - 3.2 * s, 0, s);
            one('prop_barrel', cx - 5 * s, cz + 3 * s, 0, s); one('prop_barrel', cx - 3.8 * s, cz + 3.3 * s, 0.6, s);
            one('prop_campfire', cx + 3.5 * s, cz - 3.0 * s, 0.8, s); one('prop_beach_set', cx + 5.2 * s, cz + 2.4 * s, 2.2, s); // [P3] 비행장 옆 모닥불·비치타월
          }
          if (ok) for (const ln of st.fb.reserved) if (ln.userData.zone === r.kind) ln.visible = false;
        }
        // [2026-11-07 성능] 정적 소품·접지 그림자 병합(드로콜 감소). 흔들리는 야자수는 제외, 기차는 아래에서 나중에 추가
        const sway = new Set(st.palms3d);
        const merged = mergeStatic(scene, scene.children.filter((c) => !before.has(c) && !sway.has(c)));
        // [P3] 꼬마기차: 둘레 보드워크(레일 겸)를 상시 순환 — 구름과 같은 0비용 생동감
        if (A.mini_train && st.bounds) {
          const tr = staticClone(A.mini_train, clayM); tr.scale.setScalar(ASSET_SCALE);
          scene.add(tr); st.train = { obj: tr, t: 0.37 };
        }
        st.assets = { ms, bytes, mountMs: Math.round(performance.now() - t0), merged, failed, seats, parasols: st.seatFx.filter((f) => f.cn).length, seatTotal: st.seatFx.length };
        if (typeof window !== 'undefined') window.__pm3dAssets = st.assets;
        setStat((x) => `${x} · 애셋 ${(bytes / 1048576).toFixed(2)}MB ${ms}ms${failed.length ? ` · 실패 ${failed.length}` : ''}`);
        st.poke?.();
      });
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
          // 착용 소품·종족 부속 = char.glb 전용 모델(본 스키닝, scripts/pm3d/build_wearables.py) — 이름 일치만 보이기.
          //   다중 재질 모델은 로더가 그룹(이름 유지) + 자식 메시(데이터명)로 쪼개므로, 메시가 아니어도 이름으로 토글한다.
          const nm = m.name || '';
          if (/^hat_/.test(nm)) { m.visible = nm === L.hat; return; }
          if (/^gls_/.test(nm)) { m.visible = nm === L.glasses; return; }
          if (/^hnd_/.test(nm)) { m.visible = nm === L.hand; return; }
          if (/^bdg_/.test(nm)) { m.visible = nm === L.badge; return; }
          if (/^race_/.test(nm)) { m.visible = nm === L.raceMesh; return; }
          if (!m.isMesh && !m.isSkinnedMesh) return;
          const n = m.material?.name || '';
          if (n === 'top') m.material.color.set(L.top); else if (n === 'bottom') m.material.color.set(L.bottom);
          else if (n === 'skin') m.material.color.set(L.skin); else if (n === 'hair') { m.material.color.set(L.hair); m.visible = !L.hideHair; }
        });
        // 체형(선택형 3종, lib/pm3dLayout.BODY_TYPES): head 본 스케일 + 전체 스케일 — glb 1개로 귀염/밸런스/늘씬.
        //   모자·안경·종족 부속은 head 본 스키닝이라 소켓이 자동 추종, 좌석 y·블롭 그림자도 체형을 따른다.
        const BM = bodyMetrics(L.bodyType);
        if (P.bodyId !== BM.id) {
          P.bodyId = BM.id;
          P.ch.scale.setScalar(CHAR_SCALE * BM.s);
          const hb = P.ch.getObjectByName('head'); if (hb) hb.scale.setScalar(BM.head);
          P.home.y = BM.seatY;
          if (!P.walk && !P.riding && !P.cruise) P.ch.position.y = BM.seatY;
          P.emoY = BM.headTop * CHAR_SCALE + 0.3;
          P.emo.position.y = P.emoY;
          if (P.blobChar) { P.blobChar.scale.set(1.04 * BM.s * 0.72, 0.96 * BM.s * 0.72, 1); P.blobChar.userData.spread?.scale.set(1.04 * BM.s * 1.35, 0.96 * BM.s * 1.35, 1); }
          st.poke?.();
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
        // 책장·큰 소품(구매 shelf) — 책상 오른쪽 뒤 바닥(kit.glb shelf_* 모듈). 그림자=블롭 방식이라 cast/receive 불필요
        if (L.shelf) { const o = kitMod(L.shelf); o.position.set(1.45, 0, -SEAT_Z - 0.15); o.rotation.y = -0.35; P.g.add(o); P.decor.push(o); }
        if (L.pet) { const pet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), (toClayMat(new THREE.MeshStandardMaterial({ color: U.pet })) || new THREE.MeshStandardMaterial({ color: U.pet, roughness: 0.8 }))); pet.scale.set(1.2, 0.85, 1); pet.position.copy(PET_SLOT); P.g.add(pet); P.decor.push(pet); }
        const A = animOf(p);
        const off = p.status === 'off';
        P.mon.traverse((m) => { if (m.isMesh && m.material?.name === 'screen') { m.material = m.material.clone(); m.material.emissiveIntensity = off ? 0 : 0.6; m.material.color.set(off ? U.screenOff : U.screenOn); } });
        P.clip = A.clip; P.speed = A.speed;
        if (A.emote !== P.emoTxt) { P.g.remove(P.emo); P.emo = emojiSprite(A.emote || ' '); P.emo.position.set(0, P.emoY ?? HEAD_Y, -SEAT_Z); P.emo.visible = !!A.emote; P.g.add(P.emo); P.emoTxt = A.emote; }
        // 탈것(슬롯 mount): 평소 책상 옆 park, 이동은 ride, PC 꺼짐 hidden (lib/pmMounts.mountPose)
        const mdef = mountById(L.mount);
        const mpose = mdef ? mountPose(p.status, !!(P.walk || P.cruise)) : 'hidden';
        if ((mdef?.id || '') !== P.mountId) {
          // [2026-11-06 사장님 신고 "타도 타지 않음"] 세션 중 장착이 바뀌면(첫 로드는 제외) 바로 시승 한 바퀴 — 장착 체감
          if (P.mountId !== undefined && mdef) P.justEquipped = true;
          if (P.mountObj) { P.g.remove(P.mountObj); P.mountObj = null; }
          if (mdef && st.mounts) {
            const src = st.mounts.getObjectByName('mount_' + mdef.id.replace(/-/g, '_'));
            if (src) {
              const o = src.clone(true);
              o.traverse((m) => { if (m.isMesh) { if (m.material) { m.material = m.material.clone(); clay(m); } } });
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
            const sp = stationPos(stg);
            const path = (P.d.island > 0 && st.world && walkPath(st.world, P.d, { x: sp.x, z: P.d.z >= 0 ? 1.35 : -1.35 })) || ridePath(P.d, stg, st.bounds || {}); // 다른 섬 자리는 격자 경로(다리 경유)
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
          if (P.justEquipped && p.status !== 'off' && !P.cruise && rides < RIDE_MAX_CONCURRENT) {
            P.justEquipped = false; P.cruise = { t0: now, dur: 12000, from: Math.random() }; // 장착 직후 시승 한 바퀴
          } else if (P.prevStatus === 'off' && p.status === 'working' && !P.cruise && rides < RIDE_MAX_CONCURRENT) {
            P.cruise = { t0: now, dur: 6000, from: Math.random() };               // 출근 한 바퀴 살짝
          } else if ((p.status === 'idle' || p.status === 'working') && !P.cruise && rides < RIDE_MAX_CONCURRENT) {
            const slot = Math.floor(now / 180000);                                 // 3분 창마다 해시 추첨
            let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
            // [2026-11-06] 작업중에도 드물게(1/17) 한 바퀴 — 탈것이 "쓰이는 모습"이 평소에도 보이게(대기는 기존 1/7 유지)
            const mod = p.status === 'idle' ? 7 : 17;
            if ((h + slot) % mod === 0 && P.cruiseSlot !== slot) { P.cruiseSlot = slot; P.cruise = { t0: now, dur: 12000, from: (h % 100) / 100 }; }
          }
        }
        if (P.cruise && !P.cruise.fixed && mountById(P.mountId)?.course === 'flight') { P.cruise.dur = Math.max(P.cruise.dur, 16000); P.cruise.fixed = true; } // 비행은 이륙·착륙 포함이라 최소 16초
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
    const kitMod = (n) => { const o = kitScene?.getObjectByName(n); const c = o ? o.clone(true) : new THREE.Group(); c.position.set(0, 0, 0); c.traverse((m) => { if (m.isMesh) clay(m); }); return c; };
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
        // 이름표 = 머리 위 (#1548 때 push 가 주석에 삼켜져 전원 이름표가 좌상단에 쌓이던 버그 복구)
        P.ch.getWorldPosition(v); v.y += P.walk || P.cruise ? 1.3 : (P.emoY ?? HEAD_Y) - P.ch.position.y + 0.25; v.project(cam);
        items.push({ key: name, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 20, ...sizeOf(name, 56, 16) });
        if (P.stage) { const tip = P.g.userData?.parasolTip; if (tip) wv.set(tip.x, tip.y, tip.z); else wv.set(0, HEAD_Y + 0.9, -SEAT_Z); P.g.localToWorld(wv); wv.project(cam); items.push({ key: 'w:' + name, x: (wv.x + 1) / 2 * w, y: (1 - wv.y) / 2 * h - 12, ...sizeOf('w:' + name, 150, 30) }); } // 작업 말풍선 = 파라솔 위(파라솔 없으면 머리 위)
      }
      for (const o of st.stations) { o.getWorldPosition(v); v.y += 1.9; v.project(cam); items.push({ key: 'st' + o.userData.no, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, ...sizeOf('st' + o.userData.no, 70, 18) }); }
      for (const o of st.robots) { o.getWorldPosition(v); v.y += 1.6; v.project(cam); items.push({ key: 'rb' + o.userData.i, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h - 18, ...sizeOf('rb' + o.userData.i, 170, 18) }); }
      for (const it of items) if (it.y > -20 && it.y < h) it.y = Math.max(2, Math.min(it.y, h - it.h - 26)); // 화면 안 칩은 아래 가장자리(맞춤 버튼 줄·상태 글씨)에 잘리지 않게
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
              // 탈것별 코스(2026-11-06 사장님 지시): circuit=카트트랙 질주, water=수영장 둥실, sky=상공 선회, ring=보드워크(레일 겸)
              const course = (mountById(P.mountId)?.course) || 'ring';
              const sec = el2 / 1000; const K = st.courses || {};
              let pt; let rideY = 0.02;
              if (course === 'circuit' && K.kart) { const tt = C.from + sec * 4.4 / rectLength(K.kart); pt = rectPoint(K.kart, tt); }
              else if (course === 'water' && K.pool) { const tt = C.from + sec * 1.1 / rectLength(K.pool); pt = rectPoint(K.pool, tt); rideY = bobY(sec + C.from * 7); }
              else if (course === 'flight' && K.runway) { pt = flightPoint(K.runway, st.bounds.hx, st.bounds.hz, prog); rideY = 0.02 + pt.y; } // 이륙→상공 선회→착륙(경비행기)
              else if (course === 'rail') { const tt = C.from + sec * 1.6 / ringLength(st.bounds.hx, st.bounds.hz); pt = ringPoint(st.bounds.hx, st.bounds.hz, tt); rideY = 0.1; } // 둘레 레일 순환(꼬마기차·보드워크 레일 위)
              else if (course === 'sea') { const R = seaRect(st.bounds.hx, st.bounds.hz); const tt = C.from + sec * 1.6 / rectLength(R); pt = rectPoint(R, tt); rideY = bobY(sec + C.from * 7, 0.02) - 0.12; } // 섬 둘레 바다 일주(돛단배) — 물면 근처에서 출렁
              else if (course === 'sky') { const tt = C.from + sec * 2.8 / skyLength(st.bounds.hx, st.bounds.hz); pt = skyPoint(st.bounds.hx, st.bounds.hz, tt, sec + C.from * 9); rideY = pt.y; }
              else { const tt = C.from + sec * (2.2 * 1.3) / ringLength(st.bounds.hx, st.bounds.hz); pt = ringPoint(st.bounds.hx, st.bounds.hz, tt); }
              const lp = new THREE.Vector3(pt.x, 0, pt.z); P.g.worldToLocal(lp);
              const yawL = pt.yaw - P.g.rotation.y;
              P.mountObj.position.set(lp.x, rideY, lp.z); P.mountObj.rotation.y = yawL;
              if (course === 'flight') { P.mountObj.rotation.x = -(pt.pitch || 0) * 0.8; const pr = P.mountObj.getObjectByName('plane_prop'); if (pr) pr.rotation.y += 0.9; } else P.mountObj.rotation.x = 0;
              P.ch.position.set(lp.x, rideY - 0.02 + P.mountSeat, lp.z); P.ch.rotation.y = yawL;
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
        // [게임화 1차] 입장 연출·구름 흐름·호버 통통 — 전부 스케일/위치만 건드림(드로우콜 변화 0)
        if (st.intro) {
          const tnow = performance.now(); let live = false;
          const back = (t) => { const c1 = 1.70158; const c3 = c1 + 1; const u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
          for (const it of st.intro.items) {
            const k = Math.min(1, Math.max(0, (tnow - st.intro.t0 - it.delay) / 480));
            it.o.scale.setScalar(it.base * (k >= 1 ? 1 : Math.max(0.001, back(k))));
            if (k < 1) live = true;
          }
          if (!live) st.intro = null; else st.poke?.();
        }
        if (st.clouds && !red) for (const sp of st.clouds) { sp.position.x += dt * 0.25; if (sp.position.x > 34) sp.position.x = -14; }
        // [2026-11-06 톤 업그레이드] 거품 숨쉬기·수면 반짝임·야자수 바람(전부 투명도/소각 회전만 — 비용 미미)
        if (st.seaTime && !red) st.seaTime.value = now / 1000;
        if (st.palms3d && !red) for (const g3 of st.palms3d) g3.rotation.z = Math.sin(now / 1300 + g3.position.x * 0.7) * 0.03;
        if (st.train && !red) { // 꼬마기차 상시 순환(속도 1.6m/s)
          const ringL2 = ringLength(st.bounds.hx, st.bounds.hz);
          st.train.t = (st.train.t + dt * 1.6 / ringL2) % 1;
          const tp = ringPoint(st.bounds.hx, st.bounds.hz, st.train.t);
          st.train.obj.position.set(tp.x, 0.02, tp.z); st.train.obj.rotation.y = tp.yaw;
        }
        if (st.hoverFx) {
          const { o, base } = st.hoverFx; const want = st.hoverOn === o ? 1.07 : 1;
          const cur = o.scale.x / base; const nk = cur + (want - cur) * Math.min(1, dt * 10);
          o.scale.setScalar(base * nk);
          if (Math.abs(nk - 1) < 0.002 && st.hoverOn !== o) st.hoverFx = null;
        }
        updateLabels();
      }
      // [비행 근접 컷] 켜져 있으면 하늘 코스 비행체를 따라가며 확대 — 없으면 원래 시점 유지(대기)
      if (st.follow) {
        const riders = [...st.people.values()].map((P) => ({ P, riding: !!(P.riding && P.mountObj), course: mountById(P.mountId)?.course }));
        const tgt = pickFollowTarget(riders);
        st.followLive = !!tgt;
        if (tgt) {
          tgt.P.mountObj.getWorldPosition(wp);
          const goal = followPan(wp, CAM_DIR);
          const nx = followStep(pan, goal, dt);
          pan.x = nx.x; pan.z = nx.z; if (st.zoom !== FOLLOW_ZOOM) st.zoom = FOLLOW_ZOOM; placeCam(); st.poke?.();
        }
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
      if (!drag) { // [게임화 1차] 호버 통통: 90ms 스로틀 레이캐스트 — 캐릭터·스테이션이 마우스에 반응
        const tn = performance.now(); if (tn - (st.hoverAt || 0) < 90 || dataRef.current.reduced || st.intro) return;
        st.hoverAt = tn;
        const r0 = renderer.domElement.getBoundingClientRect();
        if (e.clientX < r0.left || e.clientX > r0.right || e.clientY < r0.top || e.clientY > r0.bottom) { st.hoverOn = null; cvs.style.cursor = ''; return; }
        ndc.set(((e.clientX - r0.left) / r0.width) * 2 - 1, -((e.clientY - r0.top) / r0.height) * 2 + 1);
        ray.setFromCamera(ndc, cam);
        const hv = ray.intersectObjects(st.clickables, true)[0];
        let ho = hv && hv.object; while (ho && !ho.userData?.kind) ho = ho.parent;
        const tgt = ho?.userData?.kind === 'person' ? (st.people.get(ho.userData.name)?.ch || null) : ho?.userData?.kind === 'stage' ? ho : null;
        cvs.style.cursor = tgt ? 'pointer' : '';
        if (tgt !== st.hoverOn) {
          st.hoverOn = tgt;
          if (tgt) { if (tgt.userData.baseScale == null) tgt.userData.baseScale = tgt.scale.x; st.hoverFx = { o: tgt, base: tgt.userData.baseScale }; st.poke?.(); }
        }
        return;
      }
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
      // 비행 근접 컷 켜기/끄기 — 끄면 켜기 전 배율·시점으로 복귀
      setFollow: (on, zoomBack) => {
        st.poke?.();
        if (on) { st.followSave = { zoom: st.zoom, x: pan.x, z: pan.z }; st.follow = true; }
        else if (st.follow) { st.follow = false; st.followLive = false; const b = st.followSave; if (b) { st.zoom = zoomBack ?? b.zoom; pan.set(b.x, 0, b.z); } placeCam(); }
      },
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
  useEffect(() => { if (!follow) api.current?.setZoom(zoom); }, [zoom, follow]);
  useEffect(() => { api.current?.setFollow(follow, zoom); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = []; for (const r of rooms || []) for (const p of r.seats || []) if (!p.empty) people.push(p);
  const cur = new Map(); for (const l of links || []) if (l.kind === 'current') cur.set(l.name, l);
  return (
    <div className="pm3d" style={{ position: 'relative', width: '100%', height: 'min(72vh, 760px)', minHeight: 420, borderRadius: 16, overflow: 'hidden', touchAction: zoom > 1 ? 'none' : 'auto', cursor: zoom > 1 ? 'grab' : 'default' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {/* [2026-11-05 디자인 자문] 미니어처 디오라마 연출 — 비용 0: CSS 비네팅 + 상·하단 가짜 틸트시프트 블러 */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(circle at 50% 46%, transparent 62%, rgba(68,43,26,.16) 100%)' }} />
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 64, pointerEvents: 'none', backdropFilter: 'blur(2.2px)', WebkitBackdropFilter: 'blur(2.2px)', maskImage: 'linear-gradient(to bottom, black, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)' }} />
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 52, pointerEvents: 'none', backdropFilter: 'blur(2.2px)', WebkitBackdropFilter: 'blur(2.2px)', maskImage: 'linear-gradient(to top, black, transparent)', WebkitMaskImage: 'linear-gradient(to top, black, transparent)' }} />
      <div ref={labelsRef} aria-hidden={false} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {people.map((p) => (
          <button key={p.name} type="button" data-k={p.name} onClick={() => onOpenPerson?.(p.name)} title={p.name}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '600 11px/1.2 inherit', padding: '2px 9px', borderRadius: 999, border: 0, whiteSpace: 'nowrap', background: p.status === 'working' ? U.chip : U.chipDim, color: U.ink, boxShadow: CLAY_BADGE, cursor: 'pointer' }}>
            {p.name}
          </button>
        ))}
        {people.map((p) => {
          const l = cur.get(p.name);
          if (!l?.text || !l.stage) return null;
          return (
            <button key={'w:' + p.name} type="button" data-k={'w:' + p.name} onClick={() => onOpenPerson?.(p.name, 'time')} title={`${p.name} · ${l.text}`}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '600 10.5px/1.25 inherit', padding: '4px 10px', borderRadius: 14, border: 0, maxWidth: 150, background: U.chip, color: U.ink, boxShadow: '0 3px 8px rgba(0,0,0,.1)', cursor: 'pointer', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textAlign: 'left', borderLeft: `3px solid ${STAGE_HEX[l.stage - 1]}` }}>
              {String(l.text).slice(0, 36)}
            </button>
          );
        })}
        {STAGES.map((s) => (
          <button key={s.no} type="button" data-k={'st' + s.no} onClick={() => onPickStage?.(s.no)}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', font: '700 11px/1.2 inherit', padding: '3px 10px', borderRadius: 999, border: 0, background: '#ffffff', color: '#1e293b', boxShadow: `inset 0 0 0 2px ${STAGE_HEX[s.no - 1]}, 0 2px 6px rgba(0,0,0,.1)`, cursor: 'pointer' }}>
            {s.no}. {s.label}
          </button>
        ))}
        {(agents || []).slice(0, 8).map((a, i) => {
          const on = a.status === 'working';
          return (
            // [2026-11-07] 로봇은 한 줄에 2칸 간격으로 서 있어 긴 칩(170px, 활동 문구 포함)이 서로 겹쳤다 → 이름만, 폭 ≤132px. 활동은 마우스 올리면(title)
            <span key={a.id || a.name || i} data-k={'rb' + i} title={on && a.activity ? `${a.name || a.id} · ${a.activity}` : (a.name || a.id)} style={{ position: 'absolute', left: 0, top: 0, font: '600 10px/1.2 inherit', padding: '2px 8px', borderRadius: 999, boxShadow: CLAY_BADGE, background: U.robot, color: U.dot, whiteSpace: 'nowrap', maxWidth: 132, overflow: 'hidden', textOverflow: 'ellipsis', opacity: on ? 1 : 0.6 }}>
              🤖 {a.name || a.id}
            </span>
          );
        })}
      </div>
      <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 6 }}>
        <ZoomSlider pct={zoom * 100} min={ZOOM_PCT_MIN} max={ZOOM_PCT_MAX} onChange={(pct) => setZoom(pctToZoom(pct))} />
        <button type="button" aria-label="비행 근접 컷" aria-pressed={follow} title="하늘을 나는 탈것을 따라가며 크게 보기" onClick={() => setFollow((v) => !v)} style={{ ...zbtn, width: 'auto', padding: '0 10px', background: follow ? '#ffe08a' : U.btn }}>{follow ? '🎥 컷 끄기' : '🎥 비행 컷'}</button>
        <button type="button" aria-label="화면 맞춤" onClick={() => { setFollow(false); setZoom(1); }} style={{ ...zbtn, width: 'auto', padding: '0 10px' }}>맞춤</button>
      </div>
      <small style={{ position: 'absolute', left: 10, bottom: 8, color: U.note, background: U.chipDim, padding: '1px 6px', borderRadius: 6 }}>3D 베타 {stat}</small>
    </div>
  );
}
const zbtn = { width: 34, height: 34, borderRadius: 10, border: 0, background: U.btn, boxShadow: '0 1px 4px rgba(0,0,0,.18)', font: '700 16px/1 inherit', cursor: 'pointer', color: U.ink };
