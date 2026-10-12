const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adjust = read('pages/api/shipment/adjust.js');
const stockBatch = read('pages/api/stock/adjust-batch.js');
const dateQuantity = read('pages/api/estimate/update-date-quantity.js');

assert.doesNotMatch(adjust, /type === 'ADD' && !req\.body\.force/,
  '분배 ADD의 가용재고 검사는 force로 우회할 수 없어야 한다.');
assert.match(adjust, /if \(type === 'ADD'\)[\s\S]{0,900}remainAfter < 0/,
  '분배 ADD는 음수 잔량을 항상 차단해야 한다.');

assert.doesNotMatch(stockBatch, /if \(!force && await isWeekFixed/,
  '확정 차수 재고조정은 force로 우회할 수 없어야 한다.');
assert.match(stockBatch, /if \(await isWeekFixed\(orderYear, week\)\)/,
  '재고조정 API는 확정 차수를 항상 차단해야 한다.');
assert.equal((stockBatch.match(/withTransaction\(/g) || []).length, 1,
  '재고 여러 행은 단일 트랜잭션으로 원자 처리해야 한다.');
assert.match(stockBatch, /const results = await withTransaction[\s\S]*for \(const e of normalizedEdits\)/,
  '모든 재고조정 행은 같은 트랜잭션 콜백 안에서 처리해야 한다.');

assert.match(dateQuantity, /if \(Number\(row\.DetailIsFix\) === 1\) throw fixedWeekError/,
  '확정된 출고일 수량은 서버에서 직접 수정을 차단해야 한다.');
assert.doesNotMatch(dateQuantity, /force/,
  '출고일 수량 수정 API에는 확정 우회 force 경로가 없어야 한다.');

console.log('ERP write safety hardening tests passed');
