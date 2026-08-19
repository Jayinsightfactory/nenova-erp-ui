import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildFixStatusQuery,
  findFixStatusWeek,
  resolveFixStatusOrderYear,
} from '../lib/fixStatusYearScope.js';

const sameWeekAcrossYears = [
  { OrderYear: '2025', OrderWeek: '29-02', status: 'FIXED' },
  { OrderYear: '2026', OrderWeek: '29-02', status: 'UNFIXED' },
];

assert.equal(
  findFixStatusWeek(sameWeekAcrossYears, { orderYear: '2025', orderWeek: '29-02' })?.status,
  'FIXED',
  '2025년 29-02 확정상태는 2025 행에서만 판정해야 한다.',
);
assert.equal(
  findFixStatusWeek(sameWeekAcrossYears, { orderYear: '2026', orderWeek: '29-02' })?.status,
  'UNFIXED',
  '2026년 29-02 확정상태는 2026 행에서만 판정해야 한다.',
);

const query = buildFixStatusQuery({ orderYear: '2025', fromWeek: '29-01', toWeek: '29-04' });
assert.equal(new URLSearchParams(query).get('orderYear'), '2025', '확정현황 GET은 선택 연도를 명시해야 한다.');
assert.throws(
  () => resolveFixStatusOrderYear('', '29-02'),
  /선택 연도/,
  '짧은 차수만으로 서버 현재 연도를 추정하면 안 된다.',
);
assert.throws(
  () => resolveFixStatusOrderYear('2026', '2025-29-02'),
  /서로 다릅니다/,
  '화면 연도와 차수 연도가 다르면 조회 전에 차단해야 한다.',
);

const page = fs.readFileSync('pages/estimate.js', 'utf8');
const fixStatusApi = fs.readFileSync('pages/api/shipment/fix-status.js', 'utf8');
const adjustApi = fs.readFileSync('pages/api/shipment/adjust.js', 'utf8');
const parityApi = fs.readFileSync('pages/api/dev/fix-parity-audit.js', 'utf8');
const parityProbe = fs.readFileSync('scripts/probe-fix-parity-audit.mjs', 'utf8');
const unfixProbe = fs.readFileSync('scripts/probe-fix-unfix-status.mjs', 'utf8');

assert.ok(page.includes('buildFixStatusQuery({ orderYear: yearStr'), '견적서 확정현황 GET은 화면 선택 연도를 사용해야 한다.');
assert.match(page, /orderYear: yearStr,\r?\n\s+fromWeek/, '견적서 구간 확정취소 POST도 화면 선택 연도를 사용해야 한다.');
assert.ok(fixStatusApi.includes('requireOrderYear(input, explicitYear)'), '확정현황 API는 현재 연도를 추정하지 않아야 한다.');
assert.equal(fixStatusApi.includes('new Date().getFullYear()'), false, '확정현황 API에 현재 연도 fallback이 없어야 한다.');
assert.match(fixStatusApi, /WHERE sm\.OrderYear = @yr\r?\n\s+AND sm\.OrderWeek = @wk/, '확정취소 재고 품목 조회는 OrderYear+OrderWeek로 한정해야 한다.');
assert.ok(fixStatusApi.includes('loadShipmentProdKeys(t.OrderYear, t.OrderWeek'), '재고 재계산 대상 조회에 선택 연도를 전달해야 한다.');
assert.ok(fixStatusApi.includes('ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @defaultYear) = @defaultYear'), '후속 확정 차수 경고도 선택 연도 안에서만 조회해야 한다.');
assert.ok(adjustApi.includes('requireOrderYear(week, req.query.orderYear || req.query.year)'), '품목군 확정조회도 선택 연도를 엄격히 사용해야 한다.');
assert.ok(parityApi.includes('requireOrderYear(req.query.week, req.query.orderYear || req.query.year)'), 'read-only 정합성 API도 현재 연도를 추정하지 않아야 한다.');
assert.ok(parityProbe.includes('orderYear=${encodeURIComponent(ORDER_YEAR)}'), '확정현황 read-only probe도 연도를 명시해야 한다.');
assert.ok(unfixProbe.includes('orderYear=${encodeURIComponent(ORDER_YEAR)}'), '확정 로그 read-only probe도 연도를 명시해야 한다.');

assert.ok(page.includes('＋ 불량/검역등록'), '기존 불량/검역등록 버튼을 유지해야 한다.');
assert.ok(page.includes('＋ 불량차감등록'), '불량차감등록 버튼을 유지해야 한다.');
assert.ok(page.includes('＋ 판매요청'), '판매요청 버튼을 유지해야 한다.');
assert.ok(page.includes('＋ 추가 품목등록'), '추가 품목등록 버튼을 유지해야 한다.');
assert.ok(page.includes("mode: 'PIVOT_DISTRIBUTION'"), '추가 품목등록의 주문/분배 부작용 정책을 유지해야 한다.');

console.log('estimate fix-status selected-year contract tests passed');
