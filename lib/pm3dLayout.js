// lib/pm3dLayout.js — /pm 3D(베타) 장면의 배치·외형·저사양 판정(순수 함수, 테스트 대상)
// 단위 = 미터(three.js 월드). 스테이션은 가운데 복도(z=0)에 1~9 순서, 부서 책상은 복도 위/아래에 번갈아 놓는다.

export const STATION_GAP = 2.6;
export const DESK_DX = 1.6;   // 같은 줄 책상 간격
export const DESK_DZ = 2.2;   // 마주보는 두 줄 간격
export const DEPT_GAP = 1.4;

export function stationPos(no) {
  return { x: (no - 5) * STATION_GAP, z: 0 };
}

// rooms: [{ dept, seats:[{name,status,...}|{empty:true,name}] }]  →  desks: [{ name, dept, x, z, face, person }]
export function layoutDesks(rooms) {
  const list = Array.isArray(rooms) ? rooms : [];
  const sides = [[], []];
  list.forEach((r, i) => sides[i % 2].push(r));
  const desks = []; const plates = [];
  sides.forEach((rs, side) => {
    const sign = side === 0 ? -1 : 1;
    const widths = rs.map((r) => Math.max(1, Math.ceil(((r.seats || []).length || 1) / 2)) * DESK_DX);
    const total = widths.reduce((a, b) => a + b, 0) + DEPT_GAP * Math.max(0, rs.length - 1);
    let x0 = -total / 2;
    rs.forEach((r, k) => {
      const seats = r.seats || [];
      const cols = Math.max(1, Math.ceil((seats.length || 1) / 2));
      seats.forEach((p, j) => {
        const col = j % cols; const row = Math.floor(j / cols);
        const z = sign * (3.6 + row * DESK_DZ);
        desks.push({ name: p.name || '', dept: r.dept, x: x0 + DESK_DX / 2 + col * DESK_DX, z, face: row === 0 ? -sign : sign, person: p.empty ? null : p });
      });
      plates.push({ dept: r.dept, x: x0 + widths[k] / 2, z: sign * (3.6 + DESK_DZ * 1.5 + 0.6) });
      x0 += widths[k] + DEPT_GAP;
    });
  });
  return { desks, plates };
}

// 바닥 범위(타일 2m 단위로 반올림)
export function floorBounds(desks) {
  let mx = STATION_GAP * 5, mz = 6;
  for (const d of desks) { mx = Math.max(mx, Math.abs(d.x) + 2); mz = Math.max(mz, Math.abs(d.z) + 2.5); }
  return { hx: Math.ceil(mx / 2) * 2, hz: Math.ceil(mz / 2) * 2 };
}

import { PM3D } from './pmThemes.js';
const { OUTFIT_COLORS, SKINS, HAIR_COLORS, PASTEL, DESK_SKINS } = PM3D;
export { OUTFIT_COLORS, SKINS, HAIR_COLORS };

function hash(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// 모자 id → 리그 부착 메시(hat_cap / hat_straw / hat_party)
export function hatMesh(id) {
  if (!id) return '';
  if (/straw|sun|flower/.test(id)) return 'hat_straw';
  if (/crown|party|chef|gat/.test(id)) return 'hat_party';
  return 'hat_cap';
}

// cfg = 꾸미기 설정(normalize 전 원본도 허용) → 3D 외형
export function look3d(cfg, name) {
  const c = (cfg && cfg.view) || cfg || {};
  const items = c.items || {};
  const h = hash(name);
  const oc = OUTFIT_COLORS[items.outfit] || PASTEL[h % PASTEL.length];
  return {
    top: oc[0], bottom: oc[1],
    skin: SKINS[Number.isInteger(c.skin) ? c.skin % SKINS.length : 0],
    hair: HAIR_COLORS[Number.isInteger(c.hairColor) ? c.hairColor % HAIR_COLORS.length : (h >> 3) % HAIR_COLORS.length],
    hat: hatMesh(items.hat || ''),
    desk: items.desk ? DESK_SKINS[hash(items.desk) % DESK_SKINS.length] : '',
    props: ['deskL', 'deskM', 'deskR'].filter((k) => items[k]).map((k) => (hash(items[k]) % 2 ? 'mug' : 'plant')),
    pet: !!items.pet,
  };
}

// 상태 → 애니메이션 클립·이모트
export function animOf(person) {
  const st = person?.status || 'off';
  if (st === 'working') return { clip: 'sit_type', speed: 1, emote: '' };
  if (st === 'off') return { clip: 'doze', speed: 1, emote: '💤' };
  return { clip: 'sit_type', speed: 0.25, emote: '☕' };
}

// 저사양 판정: 첫 프레임 3초 초과 또는 측정 구간 평균 FPS 20 미만이면 2D 로 폴백
export const FIRST_FRAME_MS = 3000;
export const MIN_FPS = 20;
export function shouldFallback({ firstFrameMs, fps }) {
  if (firstFrameMs != null && firstFrameMs > FIRST_FRAME_MS) return 'slow-first-frame';
  if (fps != null && fps < MIN_FPS) return 'low-fps';
  return '';
}

// 라벨칩 겹침 회피: 화면 좌표 박스를 y 순으로 훑어 겹치면 아래로 민다
export function declutter(boxes, gap = 2) {
  const out = boxes.map((b) => ({ ...b })).sort((a, b) => a.y - b.y);
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = out[j]; const b = out[i];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && b.y < a.y + a.h + gap && b.y + b.h > a.y - gap) b.y = a.y + a.h + gap;
    }
  }
  return out;
}
