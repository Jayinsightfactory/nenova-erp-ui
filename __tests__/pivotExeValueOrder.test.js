import assert from 'node:assert/strict';
import { collectPivotOrderValues, createPivotValueOrderComparator, movePivotValue } from '../lib/pivotExeValueOrder.js';

const groups = collectPivotOrderValues([{v:'B'},{v:0},{v:'0'},{v:'A'},{v:null},{v:''},{v:0}], 'v', value=>value===null?'(null)':String(value));
assert.deepEqual(groups.get('0'), [0,'0'], 'display-equivalent raw values are all preserved');
assert.deepEqual([...groups.keys()], ['B','0','A','(null)',''], 'default choices preserve source encounter order');
const movedRaw = movePivotValue([...groups.keys()],1,-1).flatMap(label=>groups.get(label));
assert.deepEqual(movedRaw,[0,'0','B','A',null,'']);
assert.deepEqual(['B','A'].sort(createPivotValueOrderComparator([],null)),['B','A'],'default reset keeps source order');

const typed = [null, '', 0, false, '00', '0', true, 1, '1'];
assert.deepEqual([...typed].reverse().sort(createPivotValueOrderComparator(typed)), typed);
assert.deepEqual(['x10', 'x2', 'ranked'].sort(createPivotValueOrderComparator(['ranked'], 'asc')), ['ranked', 'x2', 'x10']);
assert.deepEqual(['x2', 'ranked', 'x10'].sort(createPivotValueOrderComparator(['ranked'], 'desc')), ['ranked', 'x10', 'x2']);
assert.deepEqual(['new2', 'ranked', 'new1'].sort(createPivotValueOrderComparator(['ranked', 'ranked'])), ['ranked', 'new2', 'new1']);
assert.equal(createPivotValueOrderComparator()(null, 0), 0);
assert.deepEqual([10, 2, 1].sort(createPivotValueOrderComparator([], 'asc')), [1, 2, 10]);
const original = Object.freeze(['a', 'b', 'c']);
assert.deepEqual(movePivotValue(original, 1, -1), ['b', 'a', 'c']);
assert.deepEqual(movePivotValue(original, 0, 99), ['b', 'c', 'a']);
assert.deepEqual(movePivotValue(original, 2, -99), ['c', 'a', 'b']);
assert.deepEqual(movePivotValue(original, -1, 1), original);
assert.deepEqual(movePivotValue(original, 0, -1), original);
assert.notEqual(movePivotValue(original, 0, 0), original);
console.log('pivotExeValueOrder tests passed');
