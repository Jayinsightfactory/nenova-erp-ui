import assert from 'node:assert/strict';
import { WEEK_CLOSE_ITEMS, parseWeek, validateWeekInput, weeksInclude, latestChecks, buildChecklist, isCloseable, validateCheckInput } from '../lib/mgmt/weekCloseCore.js';

assert.deepEqual(WEEK_CLOSE_ITEMS.map((i) => i.code), ['UNQUOTED', 'NEGATIVE_STOCK', 'EMPTY_SDETAIL', 'UNPAID', 'UNREMITTED', 'VERIFY_WEEK']);
assert.deepEqual(parseWeek('42-1').variants, ['42-1', '42-01']);
assert.equal(parseWeek('42').variants, null);
assert.equal(parseWeek('abc'), null);
assert.equal(validateWeekInput('2026', '42-1').ok, true);
assert.equal(validateWeekInput('26', '42-1').ok, false);
assert.equal(validateWeekInput('2026', 'x').ok, false);
assert.equal(weeksInclude('42-01,42-02', '42-1'), true);
assert.equal(weeksInclude('42-02', '42-1'), false);
assert.equal(weeksInclude('43-01', '42'), false);
assert.equal(weeksInclude('42-02', '42'), true);

// 최신 행이 현재 상태
const rows = [
  { CheckKey: 1, ItemCode: 'UNQUOTED', Status: 'done', Note: '' },
  { CheckKey: 3, ItemCode: 'UNQUOTED', Status: 'open', Note: '재확인' },
  { CheckKey: 2, ItemCode: 'UNPAID', Status: 'skipped', Note: '다음 주' },
  { CheckKey: 9, ItemCode: 'BOGUS', Status: 'done' },
];
const latest = latestChecks(rows);
assert.equal(latest.get('UNQUOTED').Status, 'open');
assert.equal(latest.has('BOGUS'), false);

// 미연결 = 0 이 아니라 null
const items = buildChecklist({ UNQUOTED: 0, UNREMITTED: null }, latest);
assert.equal(items.find((i) => i.code === 'UNREMITTED').count, null);
assert.equal(items.find((i) => i.code === 'UNREMITTED').connected, false);
assert.equal(items.find((i) => i.code === 'UNQUOTED').count, 0);
assert.equal(items.find((i) => i.code === 'VERIFY_WEEK').connected, true);
assert.equal(isCloseable(items), false);

const allDone = WEEK_CLOSE_ITEMS.map((i) => ({ code: i.code, status: 'done', note: '' }));
assert.equal(isCloseable(allDone), true);
assert.equal(isCloseable([...allDone.slice(1), { code: 'X', status: 'skipped', note: '' }]), false);
assert.equal(isCloseable([...allDone.slice(1), { code: 'X', status: 'skipped', note: '사유' }]), true);
assert.equal(isCloseable([]), false);

assert.equal(validateCheckInput({ itemCode: 'UNPAID', status: 'skipped', note: '' }).ok, false);
assert.equal(validateCheckInput({ itemCode: 'UNPAID', status: 'done' }).ok, true);
assert.equal(validateCheckInput({ itemCode: 'NOPE', status: 'done' }).ok, false);
assert.equal(validateCheckInput({ itemCode: 'UNPAID', status: 'bad' }).ok, false);
console.log('mgmt week close tests passed');
