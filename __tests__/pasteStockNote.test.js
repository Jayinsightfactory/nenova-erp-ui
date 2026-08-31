import assert from 'node:assert/strict';
import { buildStockNoteChangeEntry, parseStockNoteQuantities, resolveInitialStockBaseWeek } from '../lib/pasteStockNote.js';

const parsed = parseStockNoteQuantities('수국\n화이트 10\n블루 5박스\n메모만');
assert.equal(parsed.get('화이트'), 10);
assert.equal(parsed.get('블루'), 5);

const entry = buildStockNoteChangeEntry({
  baseWeek: '2026-35-02',
  previousText: '화이트 10\n블루 5\n라벤더 3',
  nextText: '화이트 12\n블루 2\n신규 4',
  savedAt: '2026-08-31T00:00:00.000Z',
});
assert.deepEqual(entry.changes, [
  { name: '화이트', previousQty: 10, nextQty: 12, delta: 2 },
  { name: '블루', previousQty: 5, nextQty: 2, delta: -3 },
  { name: '라벤더', previousQty: 3, nextQty: 0, delta: -3 },
  { name: '신규', previousQty: 0, nextQty: 4, delta: 4 },
]);
assert.equal(entry.copyText, '35-2 변경사항 재고 현황\n화이트 +2\n블루 -3\n라벤더 -3\n신규 +4');
assert.equal(resolveInitialStockBaseWeek('2026-35-01'), '2026-35-01');
console.log('paste stock note tests passed');
