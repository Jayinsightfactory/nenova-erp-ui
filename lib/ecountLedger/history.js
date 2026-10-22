// 과거 전 기간 월 단위 수집용 순수 함수(DB·브라우저 없음, 테스트 대상).
export const DEFAULT_START_MONTH = '2019-01';
export const EMPTY_STREAK_STOP = 6;
// 기간 개념이 없어 1회만 받는 마스터 화면
export const MASTER_PRGIDS = ['E010101', 'E040103'];

export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
export const isMaster = (prgId) => MASTER_PRGIDS.includes(prgId);

export function nextMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export function prevMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }

// from~to 포함 월 목록(오름차순)
export function monthRange(from, to) {
  if (!isMonth(from) || !isMonth(to)) throw new Error('월은 YYYY-MM');
  if (from > to) return [];
  const out = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

// 월 → { from:'YYYY-MM-01', to:'YYYY-MM-말일' }
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

// 화면 입력용 날짜 문자열. fmt: 'yy/mm/dd' | 'yyyy/mm/dd' | 'yy/mm'
export function formatForInput(iso, fmt) {
  const [y, m, d] = iso.split('-');
  if (fmt === 'yyyy/mm/dd') return `${y}/${m}/${d}`;
  if (fmt === 'yy/mm') return `${y.slice(2)}/${m}`;
  return `${y.slice(2)}/${m}/${d}`;
}

export const historyFileName = (ym) => `${ym}.xlsx`;
export const historyRelPath = (prgId, ym) => `${prgId}/${historyFileName(ym)}`;
export const failShotName = (prgId, ym) => `${prgId}-${ym}.png`;

// --from 이 없을 때: 최신(--to)부터 과거로 거슬러 올라가며 연속 6개월 빈 결과면 중단.
export function descendingMonths(to, floor = DEFAULT_START_MONTH) { return monthRange(floor, to).reverse(); }
export function shouldStopBackfill(emptyStreak, limit = EMPTY_STREAK_STOP) { return emptyStreak >= limit; }

// 재실행 중복 판정: 이미 적재된 (prgId, 월) 또는 같은 파일 SHA 면 건너뜀
export const loadedKey = (prgId, ym) => `${prgId}|${ym}`;
export function isAlreadyLoaded(prgId, ym, loaded) {
  return !!(loaded && loaded.has && loaded.has(loadedKey(prgId, ym)));
}
export function isDuplicateSha(sha, knownShas) { return !!sha && !!knownShas && knownShas.has(sha); }
