// lib/pmMood.js — /pm 캐릭터 '작업 분위기' 상태(외형 연출 전용, 순수 함수). 급여·평가·포인트와 무관.
// 입력 = 1분 피드 스냅샷(직원별 status·workLabel·lastAt). 성장 포인트 계산(lib/pmGrow)은 건드리지 않는다.
// 연출은 긍정·중립만: 집중·바쁨·몰입·휴식·졸기. 혼나는/벌/지침/우울 표현 금지.

export const FOCUS_MIN = 60;          // 연속 작업 60분+ → 집중
export const BUSY_WINDOW_MIN = 30;    // 30분 안에
export const BUSY_SWITCHES = 4;       //   작업 전환 4회+ → 바쁨
export const BLAZE_TODAY_MIN = 360;   // 오늘 업무 특정 6시간+ → 몰입 끝판
export const BREAK_MIN = 15;          // 15분 무활동 → 커피 휴식
export const DOZE_MIN = 90;           // 90분+ → 졸기(기존 sleep 과 같은 기준)

export const VIBES = Object.freeze({
  blaze: { label: '몰입 끝판', emote: 'sparkle', effect: 'aura', note: '오늘 업무 6시간+ — 불꽃 오라' },
  focus: { label: '집중', emote: 'think', effect: 'focus', note: '연속 작업 60분+' },
  busy: { label: '바쁨', emote: 'fighting', effect: 'papers', note: '30분에 작업 전환 4회+ — 서류 더미·빠른 타이핑' },
  work: { label: '작업중', emote: null, effect: 'type', note: '작업 중' },
  break: { label: '휴식', emote: 'coffee', effect: 'coffee', note: '15분 무활동 — 커피 한 잔' },
  doze: { label: '꿀잠', emote: 'zzz', effect: 'doze', note: '90분+ 무활동' },
  idle: { label: '대기', emote: null, effect: null, note: '' },
});

const label = (l) => String(l || '').replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, '').replace(/\s*중$/, '').trim();

// 직원 1명의 활동 추적값 갱신(피드 1틱). prev = { workSince, lastLabel, switches: [ms] }
export function trackActivity(prev, s, nowMs) {
  const a = { workSince: null, lastLabel: '', switches: [], ...(prev || {}) };
  a.switches = (a.switches || []).filter((t) => nowMs - t <= BUSY_WINDOW_MIN * 60000);
  if (s && s.status === 'working') {
    const l = label(s.workLabel);
    if (!a.workSince) a.workSince = nowMs;
    if (a.lastLabel && l && l !== a.lastLabel) a.switches.push(nowMs);
    if (l) a.lastLabel = l;
  } else {
    a.workSince = null;
  }
  a.switches = a.switches.slice(-20);
  return a;
}

// 오늘 업무 특정 분(활동만은 제외)
export function todayWorkMinutes(today) {
  return Object.entries((today && today.reasons) || {}).reduce((t, [k, v]) => (k.startsWith('활동') ? t : t + (Number(v) || 0)), 0);
}

// 상태 결정: 작업 중이면 몰입 > 집중 > 바쁨 > 작업, 아니면 무활동 시간으로 졸기 > 휴식 > 대기
export function vibeOf({ status, act, todayMin = 0, lastActiveAt }, nowMs) {
  if (status === 'working') {
    if (todayMin >= BLAZE_TODAY_MIN) return 'blaze';
    if (act && act.workSince && nowMs - act.workSince >= FOCUS_MIN * 60000) return 'focus';
    if (act && (act.switches || []).filter((t) => nowMs - t <= BUSY_WINDOW_MIN * 60000).length >= BUSY_SWITCHES) return 'busy';
    return 'work';
  }
  const last = Date.parse(lastActiveAt || '');
  if (!Number.isFinite(last)) return 'idle';
  const gap = (nowMs - last) / 60000;
  if (gap >= DOZE_MIN) return 'doze';
  if (gap >= BREAK_MIN) return 'break';
  return 'idle';
}

// 성장 상태 전체에 추적값 반영(포인트·단계는 그대로) — lib/pmGrowStore 에서 advanceGrow 직후 호출
export function trackAll(state, office, nowMs) {
  if (!state || !state.people) return state;
  for (const s of (office && Array.isArray(office.staff) ? office.staff : [])) {
    const p = state.people[String(s.name || '').trim()];
    if (p) p.act = trackActivity(p.act, s, nowMs);
  }
  return state;
}

// 화면용: 직원별 vibe
export function vibesView(state, nowMs, kstDay) {
  const out = {};
  for (const [name, p] of Object.entries((state && state.people) || {})) {
    const today = p.today && (!kstDay || p.today.day === kstDay(nowMs)) ? p.today : null;
    const v = vibeOf({ status: p.status, act: p.act, todayMin: todayWorkMinutes(today), lastActiveAt: p.lastActiveAt }, nowMs);
    out[name] = { vibe: v, ...VIBES[v] };
  }
  return out;
}

// 일일 물주기(출석) — 포인트 무관, 연속일 표시만. care = { [name]: { last: 'YYYY-MM-DD', streak, caredAt } }
export function water(care, name, day, nowIso) {
  const c = { ...(care || {}) };
  const prev = c[name] || { last: '', streak: 0 };
  if (prev.last === day) return { care: c, already: true, entry: prev };
  const y = new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const entry = { last: day, streak: prev.last === y ? (prev.streak || 0) + 1 : 1, caredAt: nowIso };
  c[name] = entry;
  return { care: c, already: false, entry };
}
