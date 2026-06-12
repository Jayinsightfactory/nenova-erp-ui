// lib/orderUtils.js — 주문 공통 유틸리티

export function normalizeOrderUnit(unit, fallback = '박스') {
  const raw = String(unit || '').trim();
  if (raw === '박스' || raw === '단' || raw === '송이') return raw;
  if (raw === '개') return '송이';

  const lower = raw.toLowerCase();
  if (/(stem|steam|stems|송이|개|스팀|스템)/i.test(lower)) return '송이';
  if (/(bunch|bun|단)/i.test(lower)) return '단';
  if (/(box|박스|박)/i.test(lower)) return '박스';

  const fb = String(fallback || '').trim();
  if (fb && fb !== raw) return normalizeOrderUnit(fb, '박스');
  return '박스';
}

/**
 * 품목 단위 결정 — 우선순위:
 * 1. Product.OutUnit (사용자 수동 설정)
 * 2. DB 주문이력에서 집계한 단위 (prodUnitMap[prodKey])
 * 3. fallback (Claude 파싱값 또는 기본값 '박스')
 *
 * @param {object|null} prod  - Product 객체 (ProdKey 포함)
 * @param {string}      fallback - 이력 없을 때 사용할 값
 * @param {object}      prodUnitMap - { [ProdKey]: '박스'|'단'|'송이' }
 */
export function defaultUnit(prod, fallback, prodUnitMap = {}) {
  if (prod?.OutUnit) return normalizeOrderUnit(prod.OutUnit, fallback || '박스');
  if (prod?.ProdKey && prodUnitMap[prod.ProdKey]) return normalizeOrderUnit(prodUnitMap[prod.ProdKey], fallback || '박스');
  return normalizeOrderUnit(fallback, '박스');
}

export function normalizeOrderWeek(week) {
  if (!week) return '';
  return validateOrderWeek(String(week)).week;
}

export function normalizeOrderYear(week, fallbackYear = new Date().getFullYear().toString()) {
  if (!week) return String(fallbackYear);
  const parsed = validateOrderWeek(String(week));
  return parsed.year || String(fallbackYear);
}

/**
 * OrderWeek 형식 검증 + 정규화
 * - 허용: 'NN-NN' (예: '17-02') 또는 'YYYY-NN-NN' (예: '2026-17-02')
 * - 거부: '17-01B', '470-01', '17-2', '', null, 빈문자 등
 *
 * 운영 데이터에 박힌 형식 오류 행 ('17-01B', '470-01') 의 신규 생성을 차단하기 위함.
 * 전산 SP 들이 OrderYearWeek = OrderYear + REPLACE(OrderWeek,'-','') 로 키를 만들어
 * 형식이 깨지면 전산-웹 매칭이 어긋남.
 *
 * @param {string} week 입력
 * @returns {{ year: string|null, week: string }} 정규화 결과
 * @throws {Error} 형식 오류
 */
export function validateOrderWeek(week) {
  if (!week || typeof week !== 'string') {
    const e = new Error(`OrderWeek 형식 오류: 빈 값 또는 비문자열 (받음: ${JSON.stringify(week)})`);
    e.code = 'INVALID_ORDER_WEEK';
    throw e;
  }
  const w = week.trim();
  // YYYY-NN-NN 형식
  const m1 = w.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (m1) return { year: m1[1], week: m1[2] };
  // NN-NN 형식
  const m2 = w.match(/^(\d{2}-\d{2})$/);
  if (m2) return { year: null, week: m2[1] };
  // 거부
  const e = new Error(
    `OrderWeek 형식 오류: 'NN-NN' 또는 'YYYY-NN-NN' 만 허용 (받음: '${w}'). ` +
    `예: '17-02' 또는 '2026-17-02'. ` +
    `차수에 알파벳/3자리/대시 누락 등 포함되면 전산 프로그램과 매칭이 깨집니다.`
  );
  e.code = 'INVALID_ORDER_WEEK';
  throw e;
}

/**
 * OrderYearWeek (전산 결합 키) 생성 — 'YYYYNNNN' (예: '20261702')
 */
export function buildOrderYearWeek(year, week) {
  return String(year) + (week || '').replace('-', '');
}

/** 차수 내 순번(1~4) — useWeekInput WeekSpinInput 과 동일 */
export const MAX_ORDER_WEEK_SEQ = 4;

/** NN-NN 차수를 delta 만큼 이동 (양수=다음 차수) */
export function shiftOrderWeek(week, delta) {
  const m = String(week || '').match(/^(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`shiftOrderWeek: invalid week '${week}'`);
  let w = parseInt(m[1], 10);
  let s = parseInt(m[2], 10);
  const step = delta >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i += 1) {
    s += step;
    if (s > MAX_ORDER_WEEK_SEQ) { s = 1; w += 1; }
    if (s < 1) { s = MAX_ORDER_WEEK_SEQ; w -= 1; }
    if (w > 52) w = 52;
    if (w < 1) w = 1;
  }
  return `${String(w).padStart(2, '0')}-${String(s).padStart(2, '0')}`;
}

/**
 * weekStart ~ weekEnd 사이 모든 차수(NN-NN) 목록 — OrderYearWeek 순
 * @throws {Error} 범위 역전 또는 MAX_WEEKS 초과
 */
export function listOrderWeeksInRange(weekStart, weekEnd, orderYear = new Date().getFullYear().toString()) {
  const ws = normalizeOrderWeek(weekStart);
  const we = normalizeOrderWeek(weekEnd || weekStart);
  const y = String(orderYear);
  const yws = buildOrderYearWeek(y, ws);
  const ywe = buildOrderYearWeek(y, we);
  if (yws > ywe) throw new Error('차수 범위가 올바르지 않습니다.');

  const weeks = [];
  let cur = ws;
  for (let guard = 0; guard < 200; guard += 1) {
    weeks.push(cur);
    if (buildOrderYearWeek(y, cur) >= ywe) break;
    const next = shiftOrderWeek(cur, 1);
    if (next === cur) break;
    cur = next;
  }
  const MAX = 80;
  if (weeks.length > MAX) {
    throw new Error(`차수 범위가 너무 깁니다 (${weeks.length}개). 최대 ${MAX}개까지 조회 가능합니다.`);
  }
  return weeks;
}
