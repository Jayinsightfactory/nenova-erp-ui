// components/pm3d/assetKit.js — 블렌더 glb 애셋(public/pm3d/assets, lib/pm3dAssets 목록) 지연·공유 로드 + 인스턴싱 도우미.
//   · 같은 glb 는 페이지 수명 동안 1회만 받는다(Promise 캐시). 개별 실패는 null → 호출부가 기존 단순 그래픽을 유지(폴백).
//   · bake(): glb 장면을 "재질별 병합 지오메트리" 로 굽는다(노드 변환 적용) → 칸 타일·반복 소품은 InstancedMesh 1개/재질.
//   · DRACO 불필요(애셋은 비압축 glb, 합계 ≈2.8MB).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl, unitPartOf, UNIT_GEOM } from '../../lib/pm3dAssets';

const cache = new Map();
let loader = null;
export function loadGlb(name) {
  if (!cache.has(name)) {
    loader = loader || new GLTFLoader();
    const p = loader.loadAsync(assetUrl(name)).then((g) => g.scene).catch(() => { cache.delete(name); return null; });
    cache.set(name, p);
  }
  return cache.get(name);
}
// 여러 개 동시 로드 → { scenes: {name: Object3D|null}, ms, bytes(전송량, Resource Timing), failed:[...] }
export async function loadKit(names) {
  const t0 = performance.now();
  const list = await Promise.all(names.map((n) => loadGlb(n)));
  const scenes = {}; const failed = [];
  names.forEach((n, i) => { scenes[n] = list[i]; if (!list[i]) failed.push(n); });
  let bytes = 0;
  try { for (const e of performance.getEntriesByType('resource')) if (e.name.includes('/pm3d/assets/')) bytes += e.encodedBodySize || e.transferSize || 0; } catch { /* 측정 불가 브라우저 */ }
  return { scenes, ms: Math.round(performance.now() - t0), bytes, failed };
}

// 재질별 병합: [{ geometry, material }] (장면 루트 기준 좌표). 속성이 안 맞으면 메시 단위로 둔다.
const bakeCache = new WeakMap();
export function bake(root, filter = null) {
  if (!filter && bakeCache.has(root)) return bakeCache.get(root);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse((m) => {
    if (!m.isMesh || (filter && !filter(m))) return;
    const g = m.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    // [2026-11-06 P1] COLOR_0(버텍스 AO·음영 베이크)과 uv(baked_shadow 텍스처)는 보존 — 속성 불일치 병합은 아래 null 폴백이 받아줌
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') g.deleteAttribute(k);
    if ((m.name === 'baked_shadow' || m.material?.name === 'baked_shadow') && m.material) m.material.userData.bakedShadow = true; // 구운 그림자판 표식(병합 후에도 재질로 식별)
    const key = m.material; if (!byMat.has(key)) byMat.set(key, []); byMat.get(key).push(g.index ? g.toNonIndexed() : g);
  });
  const out = [];
  for (const [material, gs] of byMat) {
    const merged = gs.length > 1 ? mergeGeometries(gs, false) : gs[0];
    if (merged) out.push({ geometry: merged, material }); else gs.forEach((g) => out.push({ geometry: g, material }));
  }
  if (!filter) bakeCache.set(root, out);
  return out;
}
// 구운 애셋을 행렬 목록으로 인스턴싱 → Group(InstancedMesh × 재질 수)
export function instanced(baked, matrices, prep) {
  const grp = new THREE.Group();
  if (!matrices.length) return grp;
  for (const { geometry, material } of baked) {
    const mat = material.clone(); prep?.(mat); markShadowMat(mat);
    const im = new THREE.InstancedMesh(geometry, mat, matrices.length);
    if (mat.userData.bakedShadow) im.renderOrder = 1;
    matrices.forEach((m4, i) => im.setMatrixAt(i, m4));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); grp.add(im);
  }
  return grp;
}
const _q = new THREE.Quaternion(); const _up = new THREE.Vector3(0, 1, 0);
export function mat4(x, y, z, yaw, s) { return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(_up, yaw), new THREE.Vector3(s, s, s)); }

// 단일 배치용 정적 복제(구운 지오메트리 공유, 재질 공유)
export function staticClone(root, prep) {
  const g = new THREE.Group();
  for (const { geometry, material } of bake(root)) { const mat = material.clone(); prep?.(mat); markShadowMat(mat); const ms = new THREE.Mesh(geometry, mat); if (mat.userData.bakedShadow) ms.renderOrder = 1; g.add(ms); }
  return g;
}

// 파라솔 자리 유닛 분해: { desk, parasol } — 각각 원점 재중심(책상 = 책상 중심, 파라솔 = 덮개 중심), 애셋 단위
export function splitUnit(root, prep) {
  const part = (want) => {
    const g = new THREE.Group();
    for (const { geometry, material } of bake(root, (m) => unitPartOf(nameOf(m)) === want || (want === 'parasol' && (m.name === 'baked_shadow' || m.material?.name === 'baked_shadow')))) { const mat = material.clone(); prep?.(mat); markShadowMat(mat); const ms = new THREE.Mesh(geometry, mat); if (mat.userData.bakedShadow) ms.renderOrder = 1; g.add(ms); }
    return g;
  };
  const desk = part('desk'); desk.position.set(-UNIT_GEOM.desk.x, 0, -UNIT_GEOM.desk.z);
  const parasol = part('parasol'); parasol.position.set(-UNIT_GEOM.canopy.x, 0, -UNIT_GEOM.canopy.z);
  const wrap = (o) => { const w = new THREE.Group(); w.add(o); return w; };
  return { desk: wrap(desk), parasol: wrap(parasol) };
}
// 다중 재질 노드는 로더가 그룹(노드명)+자식 메시로 쪼갬 → 이름 있는 가장 가까운 조상
function nameOf(m) { let o = m; while (o && !UNIT_NAMES.has(o.name)) o = o.parent; return o ? o.name : m.name; }
const UNIT_NAMES = new Set(['canopy', 'pole', 'pole_base', 'tip', 'stool_board', 'cushion', 'stoolleg0', 'stoolleg1', 'stoolleg2', 'tile_base', 'tile_top']);

// 구운 그림자판 재질 공통 세팅(P1): 반투명·깊이쓰기 끔 — 지면 위에 겹쳐도 z-fight 없이 깔림
export function markShadowMat(mat) {
  if (!mat?.userData?.bakedShadow) return mat;
  mat.transparent = true; mat.depthWrite = false; if (mat.metalness !== undefined) { mat.metalness = 0; mat.roughness = 1; }
  return mat;
}
export const hasBakedShadow = (root) => { let f = false; root.traverse?.((o) => { if (o.material?.userData?.bakedShadow) f = true; }); return f; };
