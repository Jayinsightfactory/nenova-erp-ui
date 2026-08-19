import assert from 'node:assert/strict';
import { customerMatchesSearch } from '../lib/customerSearch.js';
import {
  assembleHangulJamo,
  convertQwertyInputToHangul,
  editHangulSearchBuffer,
  qwertyToHangul,
} from '../lib/qwertyHangul.js';

assert.equal(qwertyToHangul('gksrmf'), '한글');
assert.equal(qwertyToHangul('thakd'), '소망');
assert.equal(qwertyToHangul('dnjsdP'), '원예');
assert.equal(qwertyToHangul('thakddnjsdP'), '소망원예');
assert.equal(assembleHangulJamo('ㅎㅏㄴㄱㅡㄹ'), '한글');
assert.equal(convertQwertyInputToHangul('gksrmf'), '한글');
assert.equal(convertQwertyInputToHangul('소망'), '소망');
assert.equal(convertQwertyInputToHangul('33-02'), '33-02');
assert.equal(qwertyToHangul('qkq'), '밥');
assert.equal(qwertyToHangul('dhk'), '와');
assert.equal(customerMatchesSearch({ CustName: '소망원예' }, 'thakd'), true);
assert.equal(customerMatchesSearch({ CustName: '한글꽃' }, 'gksrmf'), true);
assert.equal(customerMatchesSearch({ CustName: '소망원예' }, '소망'), true);
assert.equal(customerMatchesSearch({ CustName: 'ROSE FLOWER', CustCode: 'WS-123' }, 'rose'), true);
assert.equal(customerMatchesSearch({ CustName: 'ROSE FLOWER', CustCode: 'WS-123' }, 'WS-123'), true);

let edit = editHangulSearchBuffer({
  display: '', buffer: '', key: 'g', selectionStart: 0, selectionEnd: 0,
});
assert.deepEqual(edit, { handled: true, display: 'ㅎ', buffer: 'g' });
edit = editHangulSearchBuffer({
  display: '한글', buffer: 'gksrmf', key: ' ', selectionStart: 2, selectionEnd: 2,
});
assert.deepEqual(edit, { handled: true, display: '한글 ', buffer: 'gksrmf ' });
edit = editHangulSearchBuffer({
  display: '한글 ', buffer: 'gksrmf ', key: 'd', selectionStart: 3, selectionEnd: 3,
});
assert.deepEqual(edit, { handled: true, display: '한글 ㅇ', buffer: 'gksrmf d' });
edit = editHangulSearchBuffer({
  display: '소망', buffer: '', key: 'd', selectionStart: 2, selectionEnd: 2,
});
assert.equal(edit.handled, false, 'IME로 입력한 기존 한글을 영문 키가 덮어쓰지 않는다.');
edit = editHangulSearchBuffer({
  display: '한글', buffer: 'gksrmf', key: 'r', selectionStart: 1, selectionEnd: 1,
});
assert.equal(edit.handled, false, '커서 중간 편집을 가로채지 않는다.');
edit = editHangulSearchBuffer({
  display: 'ㅎ', buffer: 'g', key: 'Backspace', selectionStart: 1, selectionEnd: 1,
});
assert.deepEqual(edit, { handled: true, display: '', buffer: '' });
edit = editHangulSearchBuffer({
  display: '한글', buffer: 'gksrmf', key: 'Backspace', selectionStart: 2, selectionEnd: 2,
});
assert.deepEqual(edit, { handled: true, display: '한그', buffer: 'gksrm' });

console.log('qwertyHangul tests passed');
