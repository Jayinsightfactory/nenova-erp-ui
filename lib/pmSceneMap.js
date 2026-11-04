// lib/pmSceneMap.js — 배경 일러스트 장면 좌표 지도(lib/pmSceneMaps.json) 조회·자리 계산. 클라이언트·서버 공용.
//   새 테마 배경: public/pm/scene-bg/{id}.webp + {id}-lq.webp 를 넣고 pmSceneMaps.json 에 { stations(9), seats(부서별), lab, robots } 추가.
import MAPS from './pmSceneMaps.json';

export const PM_SCENE_MAPS = MAPS;
export function hasSceneMap(id) { return !!(id && id !== '_doc' && MAPS[id] && Array.isArray(MAPS[id].stations)); }
export function sceneMapFor(id) { return hasSceneMap(id) ? MAPS[id] : null; }

// 부서 d 에 n 명을 앉힐 자리(%). 좌표 풀보다 많으면 기존 자리 옆으로 비켜 앉힌다.
export function seatPoints(map, d, n) {
  const pool = (map && map.seats && map.seats[d]) || [];
  if (!pool.length || !n) return [];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const b = pool[i % pool.length]; const lap = Math.floor(i / pool.length);
    out.push([Math.min(97, b[0] + lap * 4), Math.min(97, b[1] + lap * 2.5)]);
  }
  return out;
}
