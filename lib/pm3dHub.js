// lib/pm3dHub.js — /pm 3D 중앙 허브 "회사 심장" 연출(순수 함수, 테스트: __tests__/pm3dHub.test.js)
// 설계: 맵 중앙(발주→이익 스테이션 라인 중간, 스테이션 5·6 사이) 뒤쪽에 받침대+부유 수정구.
//   직원이 작업 이벤트를 처리하면 자리→허브로 빛 알갱이가 아치(ARC_Y 높이)를 타고 흘러가고,
//   도착 시 수정구가 1.15배 맥박 + 파문 링 1개. 최근 1분 도착 빈도만큼 부유·발광이 살짝 강해진다.
// 위치 근거(겹침 0, 테스트로 보증):
//   · 스테이션 줄 z=0(받침 반폭 0.9) — z=-1.5 로 비킴
//   · 주행 복도 z=±2 — 반폭 0.35 로 z=-1.9 까지만
//   · 스테이션 앞 진입 세로 구간 x=0·±2.2(z -2~-1.35) — x=1.1(스테이션 5·6 사이)로 비킴
//   · 도보 도착점은 카메라 쪽(z=+0.78) — 허브는 반대쪽(-z)

export const HUB_POS = Object.freeze({ x: 1.1, z: -1.5 });
export const HUB_R = 0.35;            // 받침대 바닥 반폭(충돌 사각 반폭)
export const HUB_ORB_Y = 2.6;         // 수정구 부유 중심(캐릭터 정수리 2.2 위, 아치 mid 3.6 아래)
export const HUB_ORB_R = 0.32;
export const HUB_PEDESTAL_H = 0.9;

export function hubRect(margin = 0) {
  return { cx: HUB_POS.x, cz: HUB_POS.z, hw: HUB_R + margin, hd: HUB_R + margin };
}

// ── 업무 라인 흐름(빛 알갱이) ──
export const FLOW_MAX = 12;           // 동시 알갱이 상한(성능 규칙)
export const FLOW_PER_EVENT_MIN = 2;  // 이벤트당 2~3개
export const FLOW_PER_EVENT_MAX = 3;
export const FLOW_SPEED = 0.35;       // 진행도/초(아치 1개 ≈ 3초)
export function flowSpawnCount(active, seed = 0) {
  const want = FLOW_PER_EVENT_MIN + (((seed % 2) + 2) % 2); // 2 또는 3
  return Math.max(0, Math.min(want, FLOW_MAX - active));
}

// ── 도착 맥박 ──
export const PULSE_SCALE = 1.15;      // 한 번 커졌다 줄어드는 배율
export const PULSE_MS = 520;
export const RING_MS = 900;           // 파문 링 수명
export const RING_R0 = 0.4; export const RING_R1 = 1.6;
export function pulseScale(elapsedMs) {
  if (elapsedMs < 0 || elapsedMs >= PULSE_MS) return 1;
  const t = elapsedMs / PULSE_MS;      // 0→피크→1 (sin 반주기)
  return 1 + (PULSE_SCALE - 1) * Math.sin(Math.PI * t);
}

// ── 심장 박동(최근 1분 도착 빈도 → 부유 속도·발광 소폭 강화, 과장 금지) ──
export const BEAT_WINDOW_MS = 60000;
export const BOB_BASE = 1.0;          // 부유 사이클 rad/s 배율
export const BOB_MAX = 1.8;
export const GLOW_BASE = 0.55;        // emissiveIntensity
export const GLOW_MAX = 1.0;
export function heartbeat(arrivals, now = Date.now()) {
  const n = (arrivals || []).filter((t) => now - t <= BEAT_WINDOW_MS).length;
  const k = Math.min(1, n / 10);       // 1분 10건이면 최대
  return { n, bob: BOB_BASE + (BOB_MAX - BOB_BASE) * k, glow: GLOW_BASE + (GLOW_MAX - GLOW_BASE) * k };
}
export function pruneArrivals(arrivals, now = Date.now()) {
  return (arrivals || []).filter((t) => now - t <= BEAT_WINDOW_MS);
}

// ── 탈것 주차 표현(업무 중 착석 직원의 장착 탈것을 책상 옆에 세워 둠) ──
// 자리 그룹 로컬: 좌석 (0,·,-0.9), 책상 중심 (0,0,0), 기존 park (-1.15, 0, 0.35).
//   보드류(stand) = 책상에 기대 세움(안쪽으로 눕힘) · 동물/탈것류(sit·ride) = 옆에 엎드림(낮게 눌림) · 비행류 = 살짝 부유.
export const FLY_MOUNTS = Object.freeze(['balloon', 'cloud', 'magic-carpet', 'hoverboard']);
export const PARK_X = -1.15; export const PARK_Z = 0.35; // 좌석(-0.9z)과 1m 이상 거리 — 좌석-책상 검사와 충돌 없음
export function parkPose(mount) {
  if (!mount) return null;
  if (FLY_MOUNTS.includes(mount.id)) return { kind: 'float', x: PARK_X, y: 0.28, z: PARK_Z, rotY: 0.5, rotZ: 0, sy: 1, hover: 0.06 };
  if (mount.ride === 'stand') return { kind: 'lean', x: PARK_X, y: 0.1, z: PARK_Z, rotY: 0.5, rotZ: 0.42, sy: 1, hover: 0 }; // 책상 쪽으로 기울여 세움
  return { kind: 'crouch', x: PARK_X, y: 0, z: PARK_Z, rotY: 0.5, rotZ: 0, sy: 0.72, hover: 0 }; // 엎드림(높이 눌림)
}
