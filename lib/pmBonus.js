// lib/pmBonus.js — /pm 효율 보상·레벨·배지·팀 퀘스트(순수 함수). 기본 OFF: PM_BONUS_ENABLED=1 일 때만 보상 지급.
// 꺼져 있으면 '기록만' — 기준선·판정만 계산해 사장님 화면(/api/pm/bonus)에 보여주고 토큰은 주지 않는다.
// 원칙: 급여·평가와 분리(꾸미기·해금 전용), 서버 계산만, 전체 랭킹 없음, 측정 불가 = '판정 불가'(감점 없음).
// 설계: docs/pm-theme-brainstorm.md '토큰·상점·효율 보상' PR④.
import { buildHandoffs, DEFAULT_WINDOW_H } from './pmWorkLog';

export const PM_BONUS_ENABLED = () => process.env.PM_BONUS_ENABLED === '1';
export const BASELINE_DAYS = 28;      // 기준선 = 지난 4주 같은 업무(단계+국가) 처리시간 중앙값
export const RECORD_ONLY_DAYS = 14;   // 업무별 첫 기록 후 2주는 기록만(보상 0)
export const MIN_SAMPLES = 5;         // 표본이 이보다 적으면 판정 불가
export const MAX_SEG_MIN = 180;       // 한 줄 처리시간 상한(자리비움 부풀림 방지)
export const DAILY_BONUS_CAP = 30;    // 효율 보상 하루 상한(성장 적립 60 과 별도)
export const DIFFICULTY = Object.freeze({ 분배: 1.5, 해외송금: 1.5, 정산: 1.5, 이익: 1.3, 견적: 1.2 });
export const LEVELS = Object.freeze([0, 100, 300, 700, 1500, 3000]); // 누적 토큰 → 레벨 1~6, 상점 등급 해금(3=희귀, 5=전설)
export const MASTERY_FAST_CLEAN = 10; // 숙련 배지: 기준보다 빠르고 무오류 10건
export const STREAK_DAYS = 5;         // 연속 무오류 5일 보너스

const arr = (x) => (Array.isArray(x) ? x : []);
const t = (iso) => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : null; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
export const caseKey = (r) => `${r.stage || '?'}|${r.country || '-'}`;

// workLog(최신순, 라벨 바뀔 때만 한 줄) → 사람별 처리 구간: 다음 줄까지 시간 = 그 업무 처리시간
export function segments(workLog) {
  const byName = {};
  for (const r of arr(workLog)) if (r && r.name && t(r.at) != null) (byName[r.name] = byName[r.name] || []).push(r);
  const out = [];
  for (const rows of Object.values(byName)) {
    rows.sort((a, b) => t(a.at) - t(b.at));
    for (let i = 0; i < rows.length - 1; i++) {
      const min = (t(rows[i + 1].at) - t(rows[i].at)) / 60000;
      out.push({ ...rows[i], key: caseKey(rows[i]), minutes: Math.round(min * 10) / 10, measurable: min > 0 && min <= MAX_SEG_MIN });
    }
  }
  return out;
}

export function baselines(segs, nowMs) {
  const from = nowMs - BASELINE_DAYS * 86400e3;
  const g = {};
  for (const s of segs) {
    if (!s.measurable || t(s.at) < from) continue;
    const b = g[s.key] || (g[s.key] = { key: s.key, stage: s.stage, country: s.country || '', samples: [], firstAt: s.at });
    b.samples.push(s.minutes);
    if (t(s.at) < t(b.firstAt)) b.firstAt = s.at;
  }
  return Object.fromEntries(Object.values(g).map((b) => [b.key, {
    key: b.key, stage: b.stage, country: b.country, n: b.samples.length, medianMin: median(b.samples), firstAt: b.firstAt,
    learning: nowMs - t(b.firstAt) < RECORD_ONLY_DAYS * 86400e3,
  }]));
}

// 한 건 판정. quality: true(무오류 확인) / false(재수정·무결성 오류·다음 부서 반려) / null(신호 없음=판정 불가)
export function judge(seg, base, quality = null) {
  if (!seg.measurable) return { verdict: '판정 불가', reason: '측정 불가(시간 공백)', points: 0 };
  if (!base || base.n < MIN_SAMPLES) return { verdict: '판정 불가', reason: `표본 ${base ? base.n : 0}건(<${MIN_SAMPLES})`, points: 0 };
  if (base.learning) return { verdict: '기록만', reason: `첫 기록 ${RECORD_ONLY_DAYS}일 이내`, points: 0 };
  if (quality === null) return { verdict: '판정 불가', reason: '품질 신호 없음', points: 0 };
  if (quality === false) return { verdict: '품질 0', reason: '재수정·오류·반려', points: 0 };
  const saved = base.medianMin - seg.minutes;
  if (saved <= 0) return { verdict: '기준 이내', reason: `기준 ${base.medianMin}분`, points: 0 };
  const diff = DIFFICULTY[seg.stage] || 1;
  return { verdict: '빠름', reason: `기준 ${base.medianMin}분 → ${seg.minutes}분 × 난이도 ${diff}`, points: Math.round((saved / 10) * diff * 10) / 10 };
}

export function levelOf(points) {
  let lv = 1;
  LEVELS.forEach((at, i) => { if (points >= at) lv = i + 1; });
  return { level: lv, next: LEVELS[lv] ?? null, unlocks: lv >= 5 ? ['common', 'rare', 'legendary'] : lv >= 3 ? ['common', 'rare'] : ['common'] };
}

// 팀 퀘스트: 같은 국가 넘김이 지연 없이(창 안에서) 이어진 건 = 부서 전원 공동 진행. 개인 경쟁 없음.
export function teamQuests(workLog, nowMs) {
  const h = buildHandoffs(arr(workLog), { windowH: DEFAULT_WINDOW_H });
  const today = new Date(nowMs + 9 * 3600e3).toISOString().slice(0, 10);
  const onTime = h.filter((x) => new Date(t(x.b.at) + 9 * 3600e3).toISOString().slice(0, 10) === today);
  const depts = [...new Set(onTime.flatMap((x) => [x.a.dept, x.b.dept]).filter(Boolean))];
  return { goal: 3, done: onTime.length, depts, complete: onTime.length >= 3, note: `오늘 같은 국가 넘김 ${onTime.length}건이 ${DEFAULT_WINDOW_H}시간 안에 이어짐(추정)` };
}

// 사장님용 요약(기록만 모드에서도 계산). 직원별 기록은 본인 산식 공개용 — 랭킹 정렬 안 함.
export function bonusView(workLog, nowMs, qualityOf = () => null) {
  const segs = segments(workLog);
  const base = baselines(segs, nowMs);
  const people = {};
  for (const s of segs) {
    const j = judge(s, base[s.key], qualityOf(s));
    const p = people[s.name] || (people[s.name] = { name: s.name, cases: 0, verdicts: {}, points: 0 });
    p.cases += 1; p.verdicts[j.verdict] = (p.verdicts[j.verdict] || 0) + 1; p.points += j.points;
  }
  for (const p of Object.values(people)) p.points = Math.min(DAILY_BONUS_CAP, Math.round(p.points * 10) / 10);
  return {
    enabled: PM_BONUS_ENABLED(), mode: PM_BONUS_ENABLED() ? 'live' : 'record-only',
    rules: { BASELINE_DAYS, RECORD_ONLY_DAYS, MIN_SAMPLES, MAX_SEG_MIN, DAILY_BONUS_CAP, DIFFICULTY, LEVELS, MASTERY_FAST_CLEAN, STREAK_DAYS },
    baselines: Object.values(base).sort((a, b) => b.n - a.n),
    people: Object.values(people).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    teamQuest: teamQuests(workLog, nowMs),
  };
}
