// components/pm3d/assetKit.js — 블렌더 glb 애셋(public/pm3d/assets, lib/pm3dAssets 목록) 지연·공유 로드 + 인스턴싱 도우미.
//   · 같은 glb 는 페이지 수명 동안 1회만 받는다(Promise 캐시). 개별 실패는 null → 호출부가 기존 단순 그래픽을 유지(폴백).
//   · bake(): glb 장면을 "재질별 병합 지오메트리" 로 굽는다(노드 변환 적용) → 칸 타일·반복 소품은 InstancedMesh 1개/재질.
//   · DRACO 디코더 장착(2026-11-07 클레이 리메시 후 애셋은 Draco 압축 glb — 디코더는 Scene3D 와 같은 /pm3d/draco/).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { assetUrl, unitPartOf, UNIT_GEOM } from '../../lib/pm3dAssets';

const cache = new Map();
let loader = null;
export function loadGlb(name) {
  if (!cache.has(name)) {
    if (!loader) { const d = new DRACOLoader(); d.setDecoderPath('/pm3d/draco/'); d.setDecoderConfig({ type: 'wasm' }); loader = new GLTFLoader(); loader.setDRACOLoader(d); }
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
// [2026-11-07 성능] 수백 번 깔리는 칸 타일은 클레이 리메시로 개당 700~2,200 삼각형 → 장면 전체 약 200만 삼각형이었다.
//   위에서 내려다보는 작은 타일이라 잔주름은 화면에 안 보이므로, 인스턴스가 많은 애셋만 정점을 줄인 판을 쓴다(애셋별 1회·캐시).
const lodCache = new WeakMap();
export function lodBake(baked, keep = 0.35, minTris = 400) {
  if (lodCache.has(baked)) return lodCache.get(baked);
  const mod = new SimplifyModifier();
  const out = baked.map(({ geometry, material }) => {
    const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    if (tris < minTris || geometry.attributes.uv) return { geometry, material }; // uv(구운 그림자 텍스처) 있는 판은 그대로
    try {
      // 병합본은 면마다 정점이 따로(비인덱스·면 법선)라 그대로는 정점이 안 합쳐진다 → 법선 빼고 위치·색으로 합친 뒤 줄이고, 법선은 다시 계산(클레이=부드러운 면)
      const src = geometry.clone(); src.deleteAttribute('normal');
      const merged = mergeVertices(src, 1e-4);
      const g = mod.modify(merged, Math.floor(merged.attributes.position.count * (1 - keep)));
      g.computeVertexNormals();
      const t2 = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      return t2 > 0 && t2 < tris ? { geometry: g, material } : { geometry, material };
    } catch { return { geometry, material }; }
  });
  lodCache.set(baked, out);
  return out;
}
// [2026-11-07 성능] 움직이지 않는 소품(시설 존·바위·조개·서핑보드·깃발·접지 그림자 블롭)을 "같은 재질끼리 한 메시"로 합친다.
//   소품마다 재질을 복제해 쓰므로 그림 1개 = 드로콜 1개였다(구운 그림자판만 100여 개). 재질 속성이 완전히 같은 것끼리만 합쳐 겉모습은 그대로.
//   roots 는 장면(scene) 바로 아래 정적 노드만 넘길 것(움직이는 야자수·기차·사람·로봇 제외). 반환 = 줄어든 메시 수.
// 겉모습이 같은 재질인지(복제본끼리도 같다고 본다). 자체발광·AO맵·투명도·면 방향까지 포함해 다르면 절대 안 합친다.
function matKey(m) {
  const mat = m.material; const g = m.geometry;
  return [mat.type, mat.name, mat.color?.getHexString(), mat.emissive?.getHexString(), mat.emissiveIntensity, mat.roughness, mat.metalness, mat.map?.uuid, mat.alphaMap?.uuid, mat.aoMap?.uuid, mat.matcap?.uuid, mat.transparent, mat.opacity, mat.depthWrite, mat.vertexColors, mat.side, mat.onBeforeCompile ? String(mat.onBeforeCompile).length : 0, m.renderOrder, Object.keys(g.attributes).sort().join(','), !!g.index].join('|');
}
export function mergeStatic(scene, roots) {
  const groups = new Map();
  for (const r of roots) {
    if (!r) continue;
    r.updateWorldMatrix(true, true);
    r.traverse((m) => {
      if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || Array.isArray(m.material)) return;
      for (let o = m; o; o = o.parent) if (!o.visible) return;
      if (m.matrixWorld.determinant() < 0) return; // 거울 변환은 면 방향이 뒤집혀 제외
      const key = matKey(m);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
  }
  let saved = 0;
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const geos = items.map((m) => { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g; });
    const merged = mergeGeometries(geos, false); if (!merged) continue;
    merged.computeBoundingSphere();
    const one = new THREE.Mesh(merged, items[0].material); one.renderOrder = items[0].renderOrder; one.matrixAutoUpdate = false;
    scene.add(one);
    for (const m of items) m.removeFromParent();
    saved += items.length - 1;
  }
  return saved;
}
// 한 물체(로봇·스테이션처럼 통째로만 움직이는 것) 안의 부품을 같은 재질끼리 합친다 — 물체 기준 좌표라 이후 이동·흔들림 그대로
export function mergeLocal(root) {
  if (!root) return 0;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || Array.isArray(m.material) || !m.visible) return;
    const k = matKey(m); // 부품마다 재질이 복제돼 있어 uuid 가 아닌 속성으로 비교
    if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(m);
  });
  let saved = 0;
  for (const items of byMat.values()) {
    if (items.length < 2) continue;
    const geos = items.map((m) => { const g = m.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); return g; });
    const merged = mergeGeometries(geos, false); if (!merged) continue;
    const one = new THREE.Mesh(merged, items[0].material); one.renderOrder = items[0].renderOrder; one.name = items[0].name;
    root.add(one);
    for (const m of items) m.removeFromParent();
    saved += items.length - 1;
  }
  return saved;
}
// 구운 애셋을 행렬 목록으로 인스턴싱 → Group(InstancedMesh × 재질 수)
export function instanced(baked, matrices, prep) {
  const grp = new THREE.Group();
  if (!matrices.length) return grp;
  for (const { geometry, material } of baked) {
    let mat = material.clone(); mat = prep?.(mat) || mat; markShadowMat(mat);
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
  for (const { geometry, material } of bake(root)) { let mat = material.clone(); mat = prep?.(mat) || mat; markShadowMat(mat); const ms = new THREE.Mesh(geometry, mat); if (mat.userData.bakedShadow) ms.renderOrder = 1; g.add(ms); }
  return g;
}

// 파라솔 자리 유닛 분해: { desk, parasol } — 각각 원점 재중심(책상 = 책상 중심, 파라솔 = 덮개 중심), 애셋 단위
export function splitUnit(root, prep) {
  const part = (want) => {
    const g = new THREE.Group();
    for (const { geometry, material } of bake(root, (m) => unitPartOf(nameOf(m)) === want || (want === 'parasol' && (m.name === 'baked_shadow' || m.material?.name === 'baked_shadow')))) { let mat = material.clone(); mat = prep?.(mat) || mat; markShadowMat(mat); const ms = new THREE.Mesh(geometry, mat); if (mat.userData.bakedShadow) ms.renderOrder = 1; g.add(ms); }
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
