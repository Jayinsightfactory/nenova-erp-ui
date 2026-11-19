// 공항 운항 정보·통관 진행·서류 전달함 저장 테스트 — node __tests__/importFlightSources.test.js (가짜 fetch, 지어낸 값)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeFlightId, parseIcnDatetime, pickIcnRecord, readIcnFlights, _clearIcnCache } from '../lib/importFlightIcn.js';
import { parseCustomsXml, summarizeCustoms, compactCustomsProgress, readCustoms, _clearCustomsCache } from '../lib/importFlightCustoms.js';
import { readDocsSent, setDocsSent } from '../lib/importFlightDocsStore.js';

// --- 공항
assert.equal(normalizeFlightId('KE0926'), 'KE926');
assert.equal(normalizeFlightId(' ac 063 '), 'AC63');
assert.equal(normalizeFlightId('KE926'), 'KE926');
assert.equal(parseIcnDatetime('202611171420'), '2026-11-17T14:20:00+09:00');
assert.equal(parseIcnDatetime(''), null);
assert.equal(parseIcnDatetime(null), null);

const rec = (sch, extra = {}) => ({ flightId: 'KE926', scheduleDatetime: sch, estimatedDatetime: sch, remark: null, codeshare: 'Master', passengerOrCargo: 'C', airport: '방콕', airportCode: 'BKK', ...extra });
const items = [rec('202611150600'), rec('202611170600'), rec('202611181400'), rec('202611170600', { codeshare: 'Slave', flightId: 'XX1' })];
assert.equal(pickIcnRecord(items, '2026-11-17T07:00:00+09:00').scheduleDatetime, '202611170600');
assert.equal(pickIcnRecord(items, '2026-11-17T07:00:00+09:00').codeshare, 'Master');
assert.equal(pickIcnRecord([rec('202611150600')], '2026-11-17T07:00:00+09:00'), null, '18시간 넘게 차이나면 없음');
assert.equal(pickIcnRecord([], '2026-11-17T07:00:00+09:00'), null);

const KEY = 'SECRET-KEY-VALUE';
const calls = [];
const fakeIcn = async (url) => {
  const u = new URL(String(url));
  const id = u.searchParams.get('flightId');
  const pc = u.searchParams.get('passengerOrCargo');
  calls.push(`${id}/${pc}`);
  if (id === 'ZZ1') throw new Error(`boom ${u.search}`);
  let list = [];
  if (id === 'KE926' && pc === 'C') list = [rec('202611170600', { estimatedDatetime: '202611170640', remark: '도착' })];
  if (id === 'KE926' && pc === 'P') list = [rec('202611170700', { passengerOrCargo: 'P' })];
  return { ok: true, json: async () => ({ response: { header: { resultCode: '00' }, body: { items: list.length ? { item: list } : '' } } }) };
};
_clearIcnCache();
const m = await readIcnFlights(KEY, [
  { flight: 'KE0926', arriveAt: '2026-11-17T06:20:00+09:00' },
  { flight: 'KE0926', arriveAt: '2026-11-17T06:20:00+09:00' },
  { flight: 'ZZ1', arriveAt: '2026-11-17T06:30:00+09:00' },
], { fetchImpl: fakeIcn, now: 1 });
assert.ok(calls.includes('KE0926/P') && calls.includes('KE0926/C'), '원래 표기로 먼저 조회');
assert.ok(calls.includes('KE926/P') && calls.includes('KE926/C'), '0건이면 앞 0 뺀 표기로 재조회');
assert.equal(calls.filter((c) => c.startsWith('KE0926')).length, 2, '편명 중복 제거');
const ke = m.get('KE0926');
assert.equal(ke.remark, '도착');
assert.equal(ke.cargo, true, 'P/C 합친 뒤 가장 가까운 것(06:20 에서 화물 06:00 이 여객 07:00 보다 가깝다)');
assert.equal(ke.estimatedAt, '2026-11-17T06:40:00+09:00');
assert.equal(ke.airportCode, 'BKK');
assert.equal(m.get('ZZ1'), null, '실패한 편은 null');
const noKey = await readIcnFlights('', [{ flight: 'KE926', arriveAt: '2026-11-17T06:30:00+09:00' }], { fetchImpl: fakeIcn });
assert.equal(noKey.get('KE926'), null);

// --- 통관
const xmlOf = (steps, tCnt = 9) => `<?xml version="1.0" encoding="UTF-8"?><cargCsclPrgsInfoQryRtnVo><tCnt>${tCnt}</tCnt>
<cargCsclPrgsInfoQryVo><prgsStts>반입완료</prgsStts><csclPrgsStts>수입신고전</csclPrgsStts><etprDt>20261115</etprDt><prcsDttm>20261117124720</prcsDttm><shedNm>A &amp; B 창고</shedNm><pckGcnt>12</pckGcnt><ttwg>100</ttwg><cargMtNo>X</cargMtNo></cargCsclPrgsInfoQryVo>
${steps.map(([dt, name, rl]) => `<cargCsclPrgsInfoDtlQryVo><prcsDttm>${dt}</prcsDttm><cargTrcnRelaBsopTpcd>${name}</cargTrcnRelaBsopTpcd><rlbrCn>${rl || ''}</rlbrCn><shedNm>창고</shedNm></cargCsclPrgsInfoDtlQryVo>`).join('')}</cargCsclPrgsInfoQryRtnVo>`;
const steps = [
  ['20261117100000', '반출신고', '수입신고 수리후 반출'],
  ['20261117090000', '수입신고수리'],
  ['20261117080000', '수입신고수리'],
  ['20261116180000', '수입(사용소비) 결재통보'],
  ['20261116170000', '수입신고'],
  ['20261116160000', '수입신고'],
  ['20261116150000', '검사/검역 식물검역(합격)'],
  ['20261116140000', '식물 검사종류 확정(정밀)'],
  ['20261115143009', '반입신고', '입항 반입'],
  ['20261115120000', '하기신고 수리'],
  ['20261115110000', '입항보고 수리'],
  ['20261115100000', '입항보고 제출'],
  ['20261115090000', '입항적재화물목록 제출'],
];
const parsed = parseCustomsXml(xmlOf(steps));
assert.equal(parsed.found, true);
assert.equal(parsed.status, '반입완료');
assert.equal(parsed.customsStatus, '수입신고전');
assert.equal(parsed.arrivalDate, '2026-11-15');
assert.equal(parsed.warehouse, 'A & B 창고');
assert.equal(parsed.packages, 12);
assert.equal(parsed.steps.length, steps.length);
assert.ok(parsed.steps[0].at < parsed.steps[parsed.steps.length - 1].at, '시간 오름차순');
assert.equal(parsed.steps[0].at, '2026-11-15T09:00:00+09:00');
const sm = summarizeCustoms(parsed);
assert.equal(sm.manifestAt, '2026-11-15T09:00:00+09:00');
assert.equal(sm.arrivedAt, '2026-11-15T11:00:00+09:00');
assert.equal(sm.unloadedAt, '2026-11-15T12:00:00+09:00');
assert.equal(sm.warehousedAt, '2026-11-15T14:30:09+09:00');
assert.equal(sm.inspectionSetAt, '2026-11-16T14:00:00+09:00');
assert.equal(sm.inspectionType, '정밀');
assert.equal(sm.quarantinePassedAt, '2026-11-16T15:00:00+09:00');
assert.equal(sm.quarantineFailed, false);
assert.equal(sm.declaredAt, '2026-11-16T16:00:00+09:00', '수입신고 여러 건 → 가장 이른');
assert.equal(sm.clearedAt, '2026-11-17T09:00:00+09:00', '수리 → 가장 늦은');
assert.equal(sm.releasedAt, '2026-11-17T10:00:00+09:00');
const sm2 = summarizeCustoms(parseCustomsXml(xmlOf([['20261115100000', '입항보고 제출'], ['20261116100000', '검사/검역 식물검역(검사제외)'], ['20261116110000', '검사/검역 식물검역(불합격)']])));
assert.equal(sm2.arrivedAt, '2026-11-15T10:00:00+09:00', '입항보고 수리 없으면 제출');
assert.equal(sm2.inspectionType, '검사제외');
assert.equal(sm2.quarantinePassedAt, '2026-11-16T10:00:00+09:00');
assert.equal(sm2.quarantineFailed, true);
assert.equal(parseCustomsXml(xmlOf([], 0)).found, false);
assert.equal(parseCustomsXml(xmlOf([], -1)).found, false);
assert.equal(parseCustomsXml('').found, false);

const ccalls = [];
const fakeCustoms = (body) => async (url) => {
  ccalls.push(String(url));
  if (String(url).includes('mblNo=99999999999')) throw new Error(`fail ${url}`);
  return { ok: true, text: async () => body };
};
_clearCustomsCache();
const cm = await readCustoms(KEY, [{ awb: '18012345697', year: 2026 }, { awb: '999-9999-9999', year: 2026 }, { awb: '123', year: 2026 }], { fetchImpl: fakeCustoms(xmlOf(steps)), now: 1000 });
assert.equal(cm.size, 2, '11자리가 아닌 운송장은 건너뜀');
const c1 = cm.get('18012345697');
assert.ok(ccalls.some((u) => u.includes('mblNo=18012345697') && u.includes('blYy=2026') && u.includes(`crkyCn=${KEY}`)));
assert.equal(c1.releasedAt, '2026-11-17T10:00:00+09:00');
assert.equal(c1.steps.length, steps.length);
assert.equal(cm.get('99999999999'), null);
assert.ok(!JSON.stringify([...cm.values()]).includes(KEY), '결과에 키가 없다');
// 캐시: 반출 끝난 건은 10분 뒤에도 재조회 안 함
const before = ccalls.length;
await readCustoms(KEY, [{ awb: '18012345697', year: 2026 }], { fetchImpl: fakeCustoms(xmlOf(steps)), now: 1000 + 60 * 60 * 1000 });
assert.equal(ccalls.length, before);
// 키가 오류로 새지 않는지: 실패 시 예외를 던지지 않고 null
const leak = await readCustoms(KEY, [{ awb: '99999999999', year: 2026 }], { fetchImpl: fakeCustoms(''), now: 5 });
assert.equal(leak.get('99999999999'), null);

// --- 서류 전달함
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-docs-'));
process.env.IMPORT_FLIGHT_DOCS_FILE = path.join(dir, 'sub', 'docs.json');
assert.deepEqual(readDocsSent(), {});
const t0 = Date.parse('2026-11-17T00:00:00Z');
setDocsSent('18012345697', 'u1', true, t0);
assert.equal(readDocsSent()['18012345697'].by, 'u1');
assert.equal(readDocsSent()['18012345697'].at, '2026-11-17T00:00:00.000Z');
setDocsSent('99912345675', 'u2', true, t0 + 1000);
setDocsSent('18012345697', 'u1', false, t0 + 2000);
assert.deepEqual(Object.keys(readDocsSent()), ['99912345675']);
setDocsSent('18012345686', 'u3', true, t0 + 91 * 86400000);
assert.deepEqual(Object.keys(readDocsSent()), ['18012345686'], '90일 지난 항목은 정리');
fs.rmSync(dir, { recursive: true, force: true });
delete process.env.IMPORT_FLIGHT_DOCS_FILE;

console.log('importFlightSources tests passed');

{
  const checkedAt = Date.parse('2026-11-19T18:24:00+09:00');
  const declaration = { found: true, checkedAt, status: '반입신고', customsStatus: '수입신고', declaredAt: '2026-11-19T16:38:00+09:00' };
  assert.deepEqual(compactCustomsProgress(declaration, checkedAt), { declaration: 'pending', release: 'unknown' });
  assert.deepEqual(compactCustomsProgress({ ...declaration, clearedAt: '2026-11-19T18:17:00+09:00' }, checkedAt), { declaration: 'cleared', release: 'unknown' });
  assert.deepEqual(compactCustomsProgress({ ...declaration, status: '반출 대기' }, checkedAt), { declaration: 'pending', release: 'waiting' });
  assert.equal(compactCustomsProgress({ ...declaration, releasedAt: '2026-11-19T18:19:00+09:00' }, checkedAt), null);
  assert.equal(compactCustomsProgress({ ...declaration, status: '반출완료' }, checkedAt), null);
  assert.equal(compactCustomsProgress({ ...declaration, status: '수입신고 취하' }, checkedAt), null);
  assert.equal(compactCustomsProgress({ found: true, checkedAt, warehousedAt: declaration.declaredAt }, checkedAt), null);
  assert.equal(compactCustomsProgress({ ...declaration, found: false }, checkedAt), null);
  assert.equal(compactCustomsProgress({ ...declaration, status: '', customsStatus: '' }, checkedAt), null);
  assert.equal(compactCustomsProgress(declaration, checkedAt + 600000), null);
}
