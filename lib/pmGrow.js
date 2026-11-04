// lib/pmGrow.js — /pm 키우기 미니게임 성장 계산(서버 전용, 순수 함수). 설계: docs/pm-grow-game.md
// 입력 = 1분 피드(pm-office) 스냅샷. 클라이언트 값은 쓰지 않는다. 성장치는 줄지 않는다(죽음·후퇴 없음). 급여·평가 무관.
// 비율은 토큰 설계(docs/pm-theme-brainstorm.md)와 같다: 업무 특정 1h=10, 활성만 1h=3, 하루 상한 60.

export const STAGES = Object.freeze([
  { stage: 1, name: '씨앗', at: 0 },
  { stage: 2, name: '새싹', at: 60 },
  { stage: 3, name: '꽃봉오리', at: 240 },
  { stage: 4, name: '만개', at: 600 },
  { stage: 5, name: '전설 꽃', at: 1500 },
]);
export const EXCLUDED = Object.freeze(['손지윤', 'Luke']);
export const RATE_WORK_PER_H = 10;
export const RATE_ACTIVE_PER_H = 3;
export const DAILY_CAP = 60;
const MAX_STEP_MS = 5 * 60 * 1000; // 피드가 끊겼다 다시 오면 그 틈은 최대 5분만 인정(부풀림 방지)
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const DOZE_MS = 90 * 60 * 1000;
const WILT_MS = 3 * 24 * 60 * 60 * 1000;

export function kstDay(ms) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

export function stageOf(points) {
  let cur = STAGES[0];
  for (const s of STAGES) if (points >= s.at) cur = s;
  const next = STAGES.find((s) => s.at > points) || null;
  const progress = next ? (points - cur.at) / (next.at - cur.at) : 1;
  return { stage: cur.stage, name: cur.name, next: next ? { stage: next.stage, name: next.name, at: next.at } : null, progress: Math.max(0, Math.min(1, progress)) };
}

export function cleanLabel(l) { return String(l || '').replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, '').replace(/\s*중$/, '').trim() || '업무'; }

// 상태(외형만): 작업 / 대기 / 졸기 / 시듦. 성장치와 무관.
export function moodOf(p, nowMs) {
  if (p.status === 'working') return 'work';
  const last = Date.parse(p.lastActiveAt || '');
  if (!Number.isFinite(last)) return 'sleep';
  const gap = nowMs - last;
  if (gap >= WILT_MS && !(p.caredAt && Date.parse(p.caredAt) > last)) return 'wilt';
  if (gap >= DOZE_MS) return 'sleep';
  return 'idle';
}

// state = { version, lastTickAt, people: { [name]: { dept, line, points, lastActiveAt, status, today: { day, base, reasons: {label: minutes} } } } }
export function advanceGrow(state, office, nowMs) {
  const st = state && state.version === 1 ? JSON.parse(JSON.stringify(state)) : { version: 1, lastTickAt: null, people: {} };
  const prev = Date.parse(st.lastTickAt || '');
  const dt = Number.isFinite(prev) ? Math.max(0, Math.min(MAX_STEP_MS, nowMs - prev)) : 0;
  const day = kstDay(nowMs);
  for (const s of (office && Array.isArray(office.staff) ? office.staff : [])) {
    const name = String(s.name || '').trim();
    if (!name || EXCLUDED.includes(name)) continue;
    const p = st.people[name] || (st.people[name] = { dept: s.dept || '미배치', line: 'flower', points: 0, lastActiveAt: null, status: 'idle', today: { day, base: 0, reasons: {} } });
    p.dept = s.dept || p.dept;
    if (p.today.day !== day) {
      // 지갑 적립 내역용: 지난 날 적립을 보관(최근 60일). 계산은 그대로, 기록만 추가.
      if (p.today.base > 0) p.history = [...(p.history || []), { day: p.today.day, points: Math.round(p.today.base * 10) / 10, reasons: p.today.reasons }].slice(-60);
      p.today = { day, base: 0, reasons: {} };
    }
    const lastAt = Date.parse(s.lastAt || '');
    const active = Number.isFinite(lastAt) && nowMs - lastAt <= ACTIVE_WINDOW_MS;
    const rate = s.status === 'working' ? RATE_WORK_PER_H : active ? RATE_ACTIVE_PER_H : 0;
    const gain = Math.min(rate * dt / 3600000, Math.max(0, DAILY_CAP - p.today.base));
    if (gain > 0) {
      p.points += gain;
      p.today.base += gain;
      const label = s.status === 'working' ? cleanLabel(s.workLabel) : '활동(업무 미특정)';
      p.today.reasons[label] = Math.round(((p.today.reasons[label] || 0) + dt / 60000) * 10) / 10;
    }
    p.status = s.status === 'working' ? 'working' : 'idle';
    if (s.status === 'working' || active) p.lastActiveAt = new Date(Number.isFinite(lastAt) ? Math.min(lastAt, nowMs) : nowMs).toISOString();
  }
  st.lastTickAt = new Date(nowMs).toISOString();
  return st;
}

// 화면용 요약: 직원별 단계·진행률·오늘 원인, 부서 정원.
export function growView(state, nowMs) {
  const people = Object.entries((state && state.people) || {}).map(([name, p]) => {
    const today = p.today && p.today.day === kstDay(nowMs) ? p.today : { base: 0, reasons: {} };
    return {
      ...stageOf(p.points), stageName: stageOf(p.points).name, name, dept: p.dept, line: p.line || 'flower', points: Math.round(p.points), mood: moodOf(p, nowMs),
      today: { points: Math.round(today.base * 10) / 10, cap: DAILY_CAP, reasons: Object.entries(today.reasons).map(([label, minutes]) => ({ label, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes) },
    };
  });
  const depts = {};
  for (const p of people) {
    const d = depts[p.dept] || (depts[p.dept] = { dept: p.dept, members: 0, points: 0 });
    d.members += 1; d.points += p.points;
  }
  const gardens = Object.values(depts).map((d) => { const g = stageOf(d.points / Math.max(1, d.members)); return { ...d, ...g, stageName: g.name }; });
  return { updatedAt: state && state.lastTickAt, stages: STAGES, people, gardens };
}
