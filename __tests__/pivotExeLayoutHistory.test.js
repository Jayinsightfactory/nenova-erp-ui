import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPivotLayoutHistory, pivotLayoutHistoryKey } from '../lib/pivotExeInteraction.js';

const view = (over = {}) => ({ zones:{rows:['CounName'],cols:['OrderWeek'],values:[{id:'OutQuantity',aggregation:'sum'}],filters:[]}, hidden:[], selections:{}, ast:{type:'and',children:[]}, filterActive:true, weekGrouping:'sub', sorts:{}, valueOrders:{}, widths:{}, rowHeight:24, decimals:2, ...over });

{
  const history = createPivotLayoutHistory({ limit: 3 });
  assert.equal(history.record(view()), false, '첫 스냅샷은 이력이 아니다');
  assert.equal(history.record(view({ widths:{CounName:120}, decimals:0 })), false, '너비·소수점 변경은 이력에 넣지 않는다');
  const beforeMove = view({ widths:{CounName:120}, decimals:0 });
  const moved = view({ widths:{CounName:120}, decimals:0, zones:{rows:['CounName','FlowerName'],cols:['OrderWeek'],values:[{id:'OutQuantity',aggregation:'sum'}],filters:[]} });
  assert.equal(history.record(moved), true, '필드 이동은 이력에 쌓인다');
  assert.equal(history.size(), 1);
  const filtered = view({ ...moved, selections:{CounName:['네덜란드']} });
  assert.equal(history.record(filtered), true, '필터 추가는 이력에 쌓인다');
  assert.equal(history.size(), 2);
  const undone = history.undo();
  assert.deepEqual(undone.selections, {}, '되돌리기는 필터 추가 직전 화면을 돌려준다');
  assert.deepEqual(undone.zones.rows, ['CounName','FlowerName']);
  assert.equal(undone.widths.CounName, 120, '표시 설정은 되돌리기 시점 값 그대로');
  assert.equal(history.record(undone), false, '되돌리기로 생긴 변경은 다시 이력에 넣지 않는다');
  assert.equal(history.size(), 1);
  assert.equal(history.record(view({ ...undone, hidden:['AWB'] })), true, '되돌리기 직후의 실제 변경은 다시 이력에 쌓인다');
  assert.equal(history.size(), 2);
  assert.deepEqual(history.undo().hidden, [], '되돌리기 직후 변경도 되돌릴 수 있다');
  assert.deepEqual(history.undo().zones.rows, ['CounName'], '한 번 더 되돌리면 필드 이동 전으로');
  assert.equal(history.undo(), null, '이력이 비면 null');
  const wide = view({ range:{fromYear:'2026',fromWeek:'30-01',toYear:'2026',toWeek:'45-01'} });
  history.record(view({ range:{fromYear:'2026',fromWeek:'45-01',toYear:'2026',toWeek:'45-01'} }));
  assert.equal(history.record(wide), true, '조회 범위 변경도 이력에 쌓인다');
  assert.equal(history.undo().range.fromWeek, '45-01', '되돌리기는 범위를 넓히기 전으로');
}
{
  const history = createPivotLayoutHistory({ limit: 2 });
  history.record(view());
  for (let i = 1; i <= 5; i++) history.record(view({ hidden:[`F${i}`] }));
  assert.equal(history.size(), 2, '한도를 넘으면 오래된 것부터 버린다');
  assert.deepEqual(history.undo().hidden, ['F4']);
  assert.equal(pivotLayoutHistoryKey(view()), pivotLayoutHistoryKey(view({ widths:{a:1} })), '키는 표시 설정을 무시한다');
}
{
  const panel = fs.readFileSync(new URL('../components/PivotExePanel.js', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="pivot-exe-undo"/, '되돌리기 버튼');
  assert.match(panel, /createPivotLayoutHistory/, '패널이 이력 helper를 사용');
  assert.match(panel, /renderLimitError[\s\S]*pivot-exe-undo-in-error/, '셀 한도 오류 안내에도 되돌리기');
}
console.log('pivotExeLayoutHistory: ok');
