import assert from 'node:assert/strict';
import { customerMatchesSearch } from '../lib/customerSearch.js';
import {
  assembleHangulJamo,
  convertQwertyInputToHangul,
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

console.log('qwertyHangul tests passed');
