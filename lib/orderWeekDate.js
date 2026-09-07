// lib/orderWeekDate.js — 차수(OrderYear-OrderWeek-Seq) ↔ 달력 날짜 변환 (표시 전용, read-only)
//
// 규칙 (2026-09-07 사용자 확인):
//   - 한 차수(NN) = 7일, 수요일 시작 ~ 화요일 종료
//   - 전반(seq=1) = 수/목/금 3일, 후반(seq=2) = 토/일/월/화 4일
//   - 연도 경계: 새해 첫 수요일-주 안에서 새해쪽 날짜가 4일 이상이면 그 주가 신년 1차,
//     아니면 다음 수요일부터 신년 1차 시작 (majority-day 규칙)
//     검증 fixture: 2025년 52차 종료 = 2025-12-30, 2026년 01차 시작 = 2025-12-31
//
// 이 모듈은 DB 조회·저장에 쓰이지 않는다. 화면에 차수 옆 날짜를 보여주는 용도로만 쓴다.

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}
function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}
function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
function nearestWednesdayOnOrBefore(date) {
  const dow = date.getUTCDay(); // 0=일 ... 3=수 ... 6=토
  const diff = (dow - 3 + 7) % 7;
  return addDays(date, -diff);
}

/** 해당 연도 01-01(전반) 시작일 (UTC 자정, 수요일) */
export function yearWeek1Start(year) {
  const jan1 = utcDate(year, 1, 1);
  const wed = nearestWednesdayOnOrBefore(jan1);
  const oldYearDays = diffDays(wed, jan1); // wed 포함 jan1 이전(구년도) 일수, 0~6
  const newYearDays = 7 - oldYearDays;
  return newYearDays >= 4 ? wed : addDays(wed, 7);
}

/**
 * (year, week, seq) → { start, end } (UTC 자정 Date)
 * @param {number|string} year
 * @param {number|string} week 1~52
 * @param {number|string} seq  1(전반 3일) | 2(후반 4일)
 */
export function orderWeekToDateRange(year, week, seq) {
  const y = Number(year);
  const w = Number(week);
  const s = Number(seq) || 1;
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1) return null;
  const weekStart = addDays(yearWeek1Start(y), (w - 1) * 7);
  if (s <= 1) return { start: weekStart, end: addDays(weekStart, 2) };
  return { start: addDays(weekStart, 3), end: addDays(weekStart, 6) };
}

const pad2 = (n) => String(n).padStart(2, '0');
const monthDay = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

/**
 * 'WW-SS' 형식 파싱 → { week, seq } — 앞뒤 자리수는 1~2자리 모두 허용한다
 * (pivot.js의 WeekSpinInput은 '36-01'처럼 0채움, arrival-cost.js 검색창은 '37-1'처럼 미채움 입력을 쓴다).
 */
export function parseWeekSeq(weekStr) {
  const m = String(weekStr || '').trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { week: Number(m[1]), seq: Number(m[2]) };
}

/**
 * 화면 표시용: "9/2~9/4" (단일 세부차수) 또는 "9/2~9/8" (전반~후반 범위)
 * @param {number|string} year
 * @param {string} weekStr   'WW-SS' (예: '36-01')
 * @param {string} [weekEndStr] 범위 끝 'WW-SS' — 생략 시 weekStr 하나만 표시
 */
export function formatOrderWeekDateRange(year, weekStr, weekEndStr) {
  const start = parseWeekSeq(weekStr);
  if (!start) return '';
  const startRange = orderWeekToDateRange(year, start.week, start.seq);
  if (!startRange) return '';

  const endStr = weekEndStr || weekStr;
  const end = parseWeekSeq(endStr);
  const endRange = end ? orderWeekToDateRange(year, end.week, end.seq) : startRange;
  if (!endRange) return `${monthDay(startRange.start)}~${monthDay(startRange.end)}`;

  return `${monthDay(startRange.start)}~${monthDay(endRange.end)}`;
}

export function formatOrderWeekLabelWithDate(year, weekStr, weekEndStr) {
  const range = formatOrderWeekDateRange(year, weekStr, weekEndStr);
  if (!range) return '';
  const suffix = weekEndStr && weekEndStr !== weekStr ? `${weekStr}~${weekEndStr}` : weekStr;
  return `${year} ${suffix} (${range})`;
}
