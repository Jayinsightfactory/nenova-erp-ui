import assert from 'node:assert/strict';
import { CLAIM_SEED_CODES, seedsToInsert, latestLinkBySource, aggregateByFarmReason, NO_FARM_LABEL, NO_CODE_LABEL } from '../lib/mgmt/claimCodesCore.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from '../lib/mgmt/boundary.js';

// 시드: 8개, 지정 코드 포함
assert.equal(CLAIM_SEED_CODES.length, 8);
assert.deepEqual(CLAIM_SEED_CODES.map((s) => s.code), ['Q-WILT', 'Q-DISEASE', 'Q-SPEC', 'C-SHORT', 'C-WRONG', 'T-DAMAGE', 'T-DELAY', 'ETC']);
// 멱등: 첫 호출 8건, 모두 존재하면 0건, 일부 존재하면 나머지만
assert.equal(seedsToInsert([]).length, 8);
assert.equal(seedsToInsert(CLAIM_SEED_CODES.map((s) => s.code)).length, 0);
assert.deepEqual(seedsToInsert(['q-wilt', 'ETC']).map((s) => s.code), ['Q-DISEASE', 'Q-SPEC', 'C-SHORT', 'C-WRONG', 'T-DAMAGE', 'T-DELAY']);

// 최신 연결만 유효
const links = [
  { linkKey: 1, sourceKey: '10', code: 'Q-WILT' },
  { linkKey: 3, sourceKey: '10', code: 'Q-SPEC' },
  { linkKey: 2, sourceKey: '11', code: 'T-DAMAGE' },
];
assert.equal(latestLinkBySource(links).get('10').code, 'Q-SPEC');

// 집계: 농장 없음/코드 없음 정직 표기, 수량 합
const rows = [
  { deductionKey: 10, farmName: 'FarmA', quantity: 5 },
  { deductionKey: 11, farmName: '', quantity: 2 },
  { deductionKey: 12, farmName: 'FarmA', quantity: 3 },
  { deductionKey: 13, farmName: 'FarmA', quantity: 1 },
];
const agg = aggregateByFarmReason(rows, [...links, { linkKey: 4, sourceKey: '13', code: 'Q-SPEC' }]);
const get = (f, c) => agg.find((a) => a.farm === f && a.code === c);
assert.deepEqual([get('FarmA', 'Q-SPEC').count, get('FarmA', 'Q-SPEC').quantity], [2, 6]);
assert.deepEqual([get('FarmA', NO_CODE_LABEL).count, get('FarmA', NO_CODE_LABEL).quantity], [1, 3]);
assert.deepEqual([get(NO_FARM_LABEL, 'T-DAMAGE').count, get(NO_FARM_LABEL, 'T-DAMAGE').quantity], [1, 2]);
assert.equal(agg.reduce((s, a) => s + a.count, 0), rows.length);
assert.deepEqual(aggregateByFarmReason([], []), []);

// 불량차감 테이블 쓰기 SQL 은 web_mgmt 외로 나가지 않는다(링크는 web_mgmt 로만)
assert.ok(assertMgmtSqlReadOnlyOutsideSchema('INSERT INTO web_mgmt.ClaimReasonLink (SourceTable, SourceKey, Code) VALUES (1,2,3)'));
console.log('mgmt claim codes tests passed');
