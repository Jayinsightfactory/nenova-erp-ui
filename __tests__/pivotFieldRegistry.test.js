const assert = require('assert');
const { sectionsFromColumnZone, columnZoneFromSections } = require('../lib/pivotFieldRegistry');

// custName/farmName 단독으로는 주문·입고 섹션이 켜지지 않아야 함
const cz = ['custName', 'area', 'secOut'];
const sec = sectionsFromColumnZone(cz);
assert.strictEqual(sec.order, false, 'custName alone must not enable order section');
assert.strictEqual(sec.incoming, false, 'farmName alone must not enable incoming section');
assert.strictEqual(sec.out, true, 'secOut must enable out section');

const restored = columnZoneFromSections({ order: true, out: true }, ['지역', '거래처명']);
assert.ok(restored.includes('secOrder'));
assert.ok(restored.includes('custName'));
assert.ok(restored.includes('area'));
assert.ok(restored.includes('secOut'));

console.log('pivotFieldRegistry.test.js OK');
