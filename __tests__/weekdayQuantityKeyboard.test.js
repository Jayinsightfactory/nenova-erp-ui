import assert from 'node:assert/strict';
import test from 'node:test';
import { weekdayQuantityDirection, weekdayQuantityTarget, moveWeekdayQuantityFocus } from '../lib/weekdayQuantityKeyboard.js';

test('text caret, selection, composition and native modifier shortcuts are preserved', () => {
  const input = { value:'123', selectionStart:1, selectionEnd:1 };
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowLeft'}),null);
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowRight'}),null);
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowLeft',selectionStart:0,selectionEnd:0}),'left');
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowRight',selectionStart:3,selectionEnd:3}),'right');
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowRight',selectionStart:0,selectionEnd:3}),'right');
  assert.equal(weekdayQuantityDirection({...input,key:'ArrowLeft',selectionStart:0,selectionEnd:2}),null);
  for (const flag of ['altKey','ctrlKey','metaKey','shiftKey','isComposing']) {
    assert.equal(weekdayQuantityDirection({...input,key:'ArrowDown',[flag]:true}),null);
  }
});

test('navigation includes Wilson, skips disabled and collapsed rows, and never wraps rows', () => {
  const cells = [
    {row:'a',column:'2026-12-31|general'}, {row:'a',column:'2026-12-31|wilson'},
    {row:'a',column:'2027-01-01|general',disabled:true}, {row:'a',column:'2027-01-02|general'},
    {row:'b',column:'2026-12-31|general',hidden:true}, {row:'b',column:'2026-12-31|wilson',hidden:true},
    {row:'c',column:'2026-12-31|general'}, {row:'c',column:'2026-12-31|wilson'},
  ];
  assert.equal(weekdayQuantityTarget(cells,0,'right'),1);
  assert.equal(weekdayQuantityTarget(cells,1,'right'),3);
  assert.equal(weekdayQuantityTarget(cells,3,'right'),-1);
  assert.equal(weekdayQuantityTarget(cells,0,'left'),-1);
  assert.equal(weekdayQuantityTarget(cells,1,'down'),7);
  assert.equal(weekdayQuantityTarget(cells,7,'up'),1);
  assert.equal(weekdayQuantityTarget(cells,0,'down'),6);
  assert.equal(weekdayQuantityTarget(cells,3,'down'),-1);
});

test('DOM movement focuses the target without an extra save; blur remains the commit path', () => {
  const calls=[];
  const row={};
  const controls=['general','wilson'].map(column=>({value:'12',selectionStart:0,selectionEnd:2,disabled:false,
    dataset:{wcmQuantity:column}, closest:selector=>selector==='tr'?row:selector==='table'?{querySelectorAll:()=>controls}:null,
    focus:()=>calls.push('focus'),select:()=>calls.push('select'),scrollIntoView:()=>calls.push('scroll')}));
  const event={currentTarget:controls[0],key:'ArrowRight',preventDefault:()=>calls.push('prevent'),nativeEvent:{}};
  assert.equal(moveWeekdayQuantityFocus(event),true);
  assert.deepEqual(calls,['prevent','focus','select','scroll']);
  calls.length=0;
  assert.equal(moveWeekdayQuantityFocus({...event,currentTarget:controls[1]}),false);
  assert.deepEqual(calls,[]);
});
