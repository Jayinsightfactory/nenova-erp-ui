// 운송기준원가 환율 원천 결정 — lib/sourceWorkbookFx.js (순수 함수, DB 없음)
import assert from 'node:assert/strict';
import { parseSubWeek, pickSourceWorkbookFx, resolveFreightExchangeRate, FX_SOURCE } from '../lib/sourceWorkbookFx.js';

assert.deepEqual(parseSubWeek('28-2'), { major: 28, minor: 2 });
assert.deepEqual(parseSubWeek('03-02'), { major: 3, minor: 2 });
assert.deepEqual(parseSubWeek('2802'), { major: 28, minor: 2 });
assert.equal(parseSubWeek(''), null);

const rows = [
  { OrderYear: '2026', OrderWeek: '37-1', CountryName: '네덜란드', ExchangeRate: 1600, n: 8 },
  { OrderYear: '2026', OrderWeek: '37-2', CountryName: '네덜란드', ExchangeRate: 1600, n: 53 },
  { OrderYear: '2026', OrderWeek: '36-2', CountryName: '네덜란드', ExchangeRate: 1750, n: 43 },
  { OrderYear: '2026', OrderWeek: '31-2', CountryName: '네덜란드', ExchangeRate: 1700, n: 23 },
  { OrderYear: '2026', OrderWeek: '31-2', CountryName: '네덜란드', ExchangeRate: 1650, n: 2 },
  { OrderYear: '2026', OrderWeek: '47-1', CountryName: '네덜란드', ExchangeRate: 1710, n: 73 },
  { OrderYear: '2025', OrderWeek: '30-2', CountryName: '네덜란드', ExchangeRate: 1500, n: 30 },
  { OrderYear: '2026', OrderWeek: '30-2', CountryName: '콜롬비아', ExchangeRate: 1550, n: 53 },
];
const pick = (orderWeek, currency = 'EUR', orderYear = '2026') => pickSourceWorkbookFx(rows, { orderYear, orderWeek, currency });

// 같은 세부차수 정확 일치 + 행수 최빈값
assert.deepEqual(pick('31-02'), { rate: 1700, source: FX_SOURCE.WORKBOOK_WEEK, sourceWeek: '31-2' });
assert.equal(pick('36-02').rate, 1750);
// 같은 대차수 다른 세부차수
assert.deepEqual(pick('36-01'), { rate: 1750, source: FX_SOURCE.WORKBOOK_MAJOR, sourceWeek: '36-2' });
// 직전 대차수 이월(뒤로만) — 40차는 37-2(1600), 미래 47차 값 사용 금지
assert.deepEqual(pick('40-01'), { rate: 1600, source: FX_SOURCE.WORKBOOK_CARRY, sourceWeek: '37-2' });
assert.equal(pick('45-01'), null, '4주 초과 이월 금지');
// 연도 격리 — 2025 원가자료는 2026 차수에 쓰지 않는다
assert.equal(pick('30-02'), null);
assert.equal(pick('30-02', 'EUR', '2025').rate, 1500);
// 대상 통화 외(USD/CNY/AUD)는 원가자료 환율 미적용 → CurrencyMaster 유지
assert.equal(pick('30-02', 'USD'), null);
assert.equal(pick('31-02', 'CNY'), null);

// 결정 순서: 스냅샷 > 원가자료 > CurrencyMaster
const base = { workbookRows: rows, orderYear: '2026', orderWeek: '31-02', currency: 'EUR', currencyMasterRate: 1450 };
assert.deepEqual(resolveFreightExchangeRate({ ...base, snapshotRate: 1800 }), { rate: 1800, source: FX_SOURCE.SNAPSHOT, sourceWeek: null });
assert.equal(resolveFreightExchangeRate({ ...base, snapshotRate: 0 }).rate, 1700);
assert.deepEqual(resolveFreightExchangeRate({ ...base, currency: 'USD', currencyMasterRate: 1550 }), { rate: 1550, source: FX_SOURCE.CURRENCY_MASTER, sourceWeek: null });
assert.equal(resolveFreightExchangeRate({ ...base, workbookRows: [] }).source, FX_SOURCE.CURRENCY_MASTER);
assert.deepEqual(resolveFreightExchangeRate({ ...base, workbookRows: [], currencyMasterRate: 0 }), { rate: 0, source: FX_SOURCE.NONE, sourceWeek: null });

console.log('sourceWorkbookFx tests passed');
