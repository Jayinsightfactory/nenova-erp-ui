import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPivotValueSelection, createPivotPreferenceWriter, createPivotResizeSession, describePivotValueSelection, movePivotField, normalizeCollectivePivotWidths, pivotResizePreferenceKey, withCollectivePivotWidth } from '../lib/pivotExeInteraction.js';

function fakeWindow() {
  const listeners = new Map(), frames = new Map(); let id = 0;
  return {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(key) { frames.delete(key); },
    emit(name, event = {}) { [...(listeners.get(name) || [])].forEach((callback) => callback(event)); },
    paint() { const work = [...frames.values()]; frames.clear(); work.forEach((callback) => callback()); },
    counts() { return { listeners:[...listeners.values()].reduce((sum, set) => sum + set.size, 0), frames:frames.size }; },
  };
}
for (const termination of ['mouseup', 'Escape', 'blur', 'pagehide', 'dispose']) {
  const target = fakeWindow(), preview = [], commits = []; let finished = 0;
  const cancel = createPivotResizeSession({ target, startX:100, startWidth:96, onPreview:(w,x)=>preview.push([w,x]), onCommit:(w)=>commits.push(w), onFinish:()=>finished++ });
  for (let x = 101; x <= 160; x++) target.emit('mousemove', {clientX:x});
  assert.deepEqual(commits, [], 'drag must not commit per mousemove');
  assert.equal(target.counts().frames, 1, 'preview coalesces to one animation frame');
  target.paint(); assert.deepEqual(preview.at(-1), [156,160]);
  if (termination === 'mouseup') target.emit('mouseup', {clientX:175});
  else if (termination === 'Escape') target.emit('keydown', {key:'Escape',preventDefault(){}});
  else if (termination === 'dispose') cancel();
  else target.emit(termination);
  assert.deepEqual(commits, termination === 'mouseup' ? [171] : []);
  cancel(); target.emit('mouseup', {clientX:200}); target.paint();
  assert.equal(finished, 1); assert.deepEqual(target.counts(), {listeners:0,frames:0});
}
for (const [x, expected] of [[-1000,48],[9999,400],[100,96]]) {
  const target = fakeWindow(); let result;
  createPivotResizeSession({target,startX:100,startWidth:96,onPreview(){},onFinish(){},onCommit:(width)=>result=width});
  target.emit('mouseup',{clientX:x}); assert.equal(result,expected);
}
const timers = new Map(); let nextTimer = 0; const storedA = [], storedB = [];

assert.equal(pivotResizePreferenceKey('CounName', ['CounName','FlowerName']), 'CounName', '세로 행 머리글은 개별 너비를 유지한다');
assert.equal(pivotResizePreferenceKey('col-abc-Quantity:sum', ['CounName','FlowerName']), '__data', '가로 데이터 열은 공통 너비 키를 사용한다');
assert.deepEqual(
  withCollectivePivotWidth({CounName:90,'col-old-a':72,'col-old-b':140,__data:96}, '__data', 118),
  {CounName:90,__data:118},
  '가로 열 일괄 조정 시 과거 개별 열 너비를 제거하고 공통 너비만 저장한다',
);
assert.deepEqual(withCollectivePivotWidth({CounName:90,__data:96}, 'CounName', 120), {CounName:120,__data:96});
assert.deepEqual(normalizeCollectivePivotWidths({CounName:90,'col-first':72,'col-second':140}), {CounName:90,__data:72}, '기존 개별 열 설정은 첫 너비를 전체 너비로 승격한다');

const countries = ['국내','중국','콜롬비아'];
assert.deepEqual(describePivotValueSelection(countries, undefined, true), {active:false,label:'전체',selectedCount:3,totalCount:3});
assert.deepEqual(describePivotValueSelection(countries, [], true), {active:true,label:'선택 없음',selectedCount:0,totalCount:3});
assert.deepEqual(describePivotValueSelection(countries, ['콜롬비아'], true), {active:true,label:'콜롬비아',selectedCount:1,totalCount:3});
assert.deepEqual(describePivotValueSelection(countries, ['중국','콜롬비아'], true), {active:true,label:'중국 외 1',selectedCount:2,totalCount:3});
assert.deepEqual(describePivotValueSelection(countries, ['콜롬비아'], false), {active:false,label:'필터 꺼짐',selectedCount:1,totalCount:3});
assert.deepEqual(applyPivotValueSelection({FlowerName:['장미']}, 'CounName', countries, countries), {FlowerName:['장미']}, '전체 선택은 활성 필터를 남기지 않는다');
assert.deepEqual(applyPivotValueSelection({}, 'CounName', [], countries), {CounName:[]}, '전체 해제는 0행 필터로 보존한다');
assert.deepEqual(applyPivotValueSelection({}, 'CounName', ['콜롬비아'], countries), {CounName:['콜롬비아']});

const dragZones = {rows:['CounName','FlowerName'],cols:['OrderYear','OrderWeek'],values:[{id:'Quantity',aggregation:'sum'}],filters:['CustArea']};
assert.deepEqual(movePivotField(dragZones,'CustArea','rows',1,false).rows,['CounName','CustArea','FlowerName'],'영역 사이 드롭은 정확한 삽입 위치를 사용한다');
assert.deepEqual(movePivotField(dragZones,'OrderWeek','cols',0,false).cols,['OrderWeek','OrderYear'],'같은 영역 안에서도 드래그로 순서를 바꾼다');
assert.deepEqual(movePivotField(dragZones,'Quantity','filters',0,true).values,[],'값 필드를 다른 영역으로 옮기면 이전 영역에서 제거한다');
assert.deepEqual(movePivotField(dragZones,'Quantity','values',0,true).values,[{id:'Quantity',aggregation:'sum'}],'값 영역 재정렬은 기존 집계 방식을 보존한다');

const panelSource = fs.readFileSync(new URL('../components/PivotExePanel.js', import.meta.url), 'utf8');
const gridSource = fs.readFileSync(new URL('../components/PivotExeGrid.js', import.meta.url), 'utf8');
assert.match(panelSource, /zoneArea\('rows','세로 행'\)/, '세로 행 영역을 화면에 명확히 표시한다');
assert.match(panelSource, /zoneArea\('cols','가로 열'\)/, '가로 열 영역을 화면에 명확히 표시한다');
assert.match(panelSource, /필드 버튼 전체를 마우스로 잡아/, 'EXE 방식의 직접 드래그 사용법을 표시한다');
assert.match(panelSource, /pivot-exe-drop-marker/, '드롭할 정확한 삽입 위치를 안내선으로 표시한다');
assert.doesNotMatch(panelSource, />⇄<\/button>/, '별도 이동 아이콘을 주 조작으로 노출하지 않는다');
assert.match(panelSource, /오른쪽.*실제 값 필터/, '필드 오른쪽 화살표가 실제 값 목록을 연다는 안내를 표시한다');
assert.match(panelSource, /체크한 값만 피벗 표와 엑셀에 표시됩니다/, '값 선택 결과의 적용 범위를 명확히 안내한다');
assert.match(panelSource, /zone === 'filters' \? openValueFilter : openFieldMenu/, '필터 영역의 기본 버튼은 실제 값 선택창을 바로 연다');
assert.match(panelSource, /key=\{filterField\.id\}/, '다른 필드 필터를 열면 초안 값이 해당 필드 기준으로 초기화된다');
assert.match(gridSource, /가로 데이터 열 전체 너비 조절/, '가로 데이터 열 핸들은 일괄 조절임을 안내한다');

const options = (write) => ({write,setTimer:(callback)=>{timers.set(++nextTimer,callback);return nextTimer;},clearTimer:(id)=>timers.delete(id)});
const a = createPivotPreferenceWriter(options((v)=>storedA.push(v)));
a.schedule({width:100}); a.schedule({width:120}); a.schedule({width:0,zeroVisible:false});
assert.equal(timers.size,1); assert.equal(storedA.length,0);
a.flush(); assert.deepEqual(storedA,[{width:0,zeroVisible:false}]); assert.equal(timers.size,0);
a.schedule({rowHeight:33}); a.dispose(); a.dispose(); a.schedule({rowHeight:99});
assert.deepEqual(storedA.at(-1),{rowHeight:33}); assert.equal(storedA.length,2);
const b = createPivotPreferenceWriter(options((v)=>storedB.push(v)));
b.schedule({rowHeight:24}); b.flush(); assert.deepEqual(storedB,[{rowHeight:24}]); assert.equal(storedA.length,2);
let errors = 0; const broken = createPivotPreferenceWriter({...options(()=>{throw new Error('quota');}),onError:()=>errors++});
broken.schedule({width:48}); broken.dispose(); broken.flush(); assert.equal(errors,1);
console.log('pivot interactions: single final resize, animation coalescing, limits, cancel/cleanup, delayed preference flush and owner separation passed');
