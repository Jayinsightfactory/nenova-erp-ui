// components/pm3d/charLook.js — 직원 캐릭터 외형 마무리(2026-11-07 디테일 단계, scripts/pm3d/detail_char.py 와 짝).
//   · rimify(): 클레이 MatCap 에 가장자리 크림빛(림라이트)을 더해 배경과 분리. 셰이더 1종 공유(프로그램 캐시 키 고정).
//   · dressDetail(): 직원별 머리 모양(hs_*)·머리 소품(acc_*)을 같은 재질의 몸통 조각에 "합쳐" 그린다
//     → 사람마다 그리기 명령이 늘지 않는다. 합친 지오메트리는 (몸통 조각, 부품) 쌍마다 1번만 만들어 모두 공유.
//   · poseDetail(): 상태별 자세 덧입힘(작업중=화면 쪽으로 살짝 숙임, 대기=등 기대고 고개 갸웃, 잠=고개 떨굼) — 믹서 갱신 직후 호출.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const RIM_COLOR = new THREE.Color('#fff3df');
export const RIM = Object.freeze({ strength: 0.38, power: 2.4 });
export function rimify(mat) {
  if (!mat || !mat.isMeshMatcapMaterial) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: RIM_COLOR };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uRimColor;\nvoid main() {')
      .replace('#include <opaque_fragment>', `float pmRim = pow(1.0 - clamp(abs(normal.z), 0.0, 1.0), ${RIM.power.toFixed(2)}) * smoothstep(-0.4, 0.6, normal.y + 0.25);\noutgoingLight += uRimColor * pmRim * ${RIM.strength.toFixed(2)};\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'pm-rim-1';
  return mat;
}

// ── 머리 모양·소품 합치기 ──
const KEEP_ATTR = ['position', 'normal', 'skinIndex', 'skinWeight'];
const mergedCache = new Map();
function strip(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!KEEP_ATTR.includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  return g;
}
// 부품의 본 번호를 대상 스켈레톤 번호로 바꿈(같은 glb 라 보통 그대로지만, 이름으로 맞춰 안전하게)
function remapSkin(g, fromBones, toBones) {
  const byName = new Map(toBones.map((b, i) => [b.name, i]));
  const map = fromBones.map((b) => byName.get(b.name) ?? 0);
  if (map.every((v, i) => v === i)) return;
  const si = g.attributes.skinIndex;
  for (let i = 0; i < si.count; i++) for (let k = 0; k < si.itemSize; k++) si.setComponent(i, k, map[si.getComponent(i, k)] ?? 0);
}
function mergedGeometry(target, parts) {
  const base = target.userData.pmBaseGeo || (target.userData.pmBaseGeo = target.geometry);
  if (!parts.length) return base;
  const key = base.uuid + '|' + parts.map((p) => p.geometry.uuid).join('|');
  if (mergedCache.has(key)) return mergedCache.get(key);
  const gs = [strip(base)];
  for (const p of parts) { const g = strip(p.geometry); remapSkin(g, p.skeleton?.bones || [], target.skeleton?.bones || []); gs.push(g); }
  for (const g of gs) for (const k of KEEP_ATTR) if (!g.attributes[k]) return base; // 속성 불일치면 합치지 않음(기본 모양 유지)
  const merged = mergeGeometries(gs, false) || base;
  merged.computeBoundingSphere();
  mergedCache.set(key, merged);
  return merged;
}
// L = look3d() 결과(hairStyle·acc). 같은 값이면 다시 안 만든다.
export function dressDetail(root, L) {
  const sig = `${L.hideHair ? '-' : L.hairStyle}|${L.acc}`;
  if (root.userData.pmDetailSig === sig) return false;
  root.userData.pmDetailSig = sig;
  const byMat = {}; const src = {};
  root.traverse((m) => {
    const nm = m.name || '';
    if (/^(hs_|acc_)/.test(nm)) { m.visible = false; if (m.isSkinnedMesh) src[nm] = m; else m.traverse((c) => { if (c.isSkinnedMesh) src[nm] = c; }); return; }
    if (m.isSkinnedMesh && m.material && !/^(hat_|gls_|hnd_|bdg_|race_)/.test(nm) && !/^(hat_|gls_|hnd_|bdg_|race_|hs_|acc_)/.test(m.parent?.name || '')) {
      const n = m.material.name; if (!byMat[n]) byMat[n] = m;
    }
  });
  const want = {};
  const add = (id) => { const s = src[id]; if (!s) return; const n = s.material?.name; if (!byMat[n]) return; (want[n] = want[n] || []).push(s); };
  if (!L.hideHair && L.hairStyle) add('hs_' + L.hairStyle);
  if (L.acc) add('acc_' + L.acc);
  for (const n of ['hair', 'cheek', 'shoe']) { const t = byMat[n]; if (t) t.geometry = mergedGeometry(t, want[n] || []); }
  return true;
}

// ── 상태별 자세 덧입힘(본 회전 가산, 라디안) ──
const POSE = {
  working: { spine: [0.1, 0, 0], head: [0.06, 0, 0] }, // 고개는 조금만(얼굴 보이게)
  idle: { spine: [-0.12, 0, 0], head: [-0.05, 0, 0.16] },
  off: { spine: [0.1, 0, 0], head: [0.04, 0, 0.14] }, // 고개를 덜 떨궈 얼굴이 보이게
};
const _e = new THREE.Euler(); const _q = new THREE.Quaternion();
export function poseDetail(P, status, now) {
  const p = POSE[status]; if (!p || P.walk || P.riding || P.cruise || P.dance) return;
  if (!P.pmBones) P.pmBones = { spine: P.ch.getObjectByName('spine'), head: P.ch.getObjectByName('head') };
  const sway = status === 'idle' ? Math.sin(now / 1400 + (P.name?.length || 0)) * 0.05 : status === 'off' ? Math.sin(now / 2200) * 0.04 : 0;
  for (const k of ['spine', 'head']) {
    const b = P.pmBones[k]; if (!b) continue;
    const r = p[k]; _e.set(r[0] + (k === 'head' ? sway : 0), r[1], r[2] + (k === 'head' ? sway * 0.6 : 0));
    b.quaternion.multiply(_q.setFromEuler(_e));
  }
}
