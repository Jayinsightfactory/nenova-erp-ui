import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveQuantityFocus } from '../lib/orderQuantityFocus.mjs';

test('arrows follow displayed quantity cells and suppress native spin at grid edges', () => {
  let focused, prevented;
  const rows = [0, 1].map(r => ({ cells: Array.from({ length: 5 }, (_, c) => ({
    querySelector: () => c > 0 && c < 4 ? { focus: () => { focused = [r, c]; } } : null,
    cellIndex: c, parentElement: { sectionRowIndex: r },
  })) }));
  function press(r, c, key) {
    focused = [r, c]; prevented = false;
    moveQuantityFocus({ key, target: { type: 'number', closest: () => rows[r].cells[c] },
      currentTarget: { rows }, preventDefault: () => { prevented = true; } });
    return [focused, prevented];
  }
  assert.deepEqual(press(0, 1, 'ArrowRight'), [[0, 2], true]);
  assert.deepEqual(press(0, 2, 'ArrowLeft'), [[0, 1], true]);
  assert.deepEqual(press(0, 2, 'ArrowDown'), [[1, 2], true]);
  assert.deepEqual(press(1, 2, 'ArrowUp'), [[0, 2], true]);
  for (const [r,c,key] of [[0,1,'ArrowLeft'],[1,3,'ArrowRight'],[0,2,'ArrowUp'],[1,2,'ArrowDown']])
    assert.deepEqual(press(r,c,key), [[r,c],true]);
  assert.deepEqual(press(0,1,'Tab'), [[0,1],false]);
});
