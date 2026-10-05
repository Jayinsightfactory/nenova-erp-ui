import assert from 'node:assert/strict';
import { matchDutchCustomer } from '../lib/dutchVolumeCustomerMatch.js';

const customers = [
  { CustKey: 533, CustName: '주광농원', OrderCode: 'YCL2', Descr: '주광/네-월/YCL2' },
  { CustKey: 13, CustName: '미카엘플라워', OrderCode: 'YCL22', Descr: '북문-☆/네-월/YCL22' },
  { CustKey: 688, CustName: '제이에스플라워', OrderCode: 'CL83', Descr: '제이에스/네-월/중-화' },
  { CustKey: 20, CustName: '정확 CL2 업체', OrderCode: 'CL2', Descr: '코드2/메모' },
  { CustKey: 22, CustName: '정확 CL22 업체', OrderCode: 'CL22', Descr: '코드22/메모' },
  { CustKey: 8, CustName: '정확 CL8 업체', OrderCode: 'CL8', Descr: '코드8/메모' },
];
const key = (label, list = customers) => matchDutchCustomer(list, label)?.CustKey ?? null;

assert.equal(key('제이에스\r\nCL83'), 688, 'exporter alias and exact code resolve together');
assert.equal(key(' 제 이에스 \n cl83 '), 688, 'same normalized tokens allow spaces/case');
assert.equal(key('미카엘플라워\nYCL22'), 13, 'full name fallback header resolves');
assert.equal(key('북문-☆\nYCL22'), 13, 'Descr head is an exact export alias');
assert.equal(key('코드22\nCL22'), 22, 'CL22 does not also match CL2');
assert.equal(key('unknown name\nCL83'), 688, 'one exact code can resolve an unknown name');
assert.equal(key('주광\nold-code'), 533, 'unique exact alias can resolve a stale unknown code');
assert.equal(key('주광\nCL2', customers.slice(0, 3)), 533,
  'historical CL2 resolves by unique name, not by equating CL2 with YCL2');
assert.equal(key('북문-☆\nCL22', customers.slice(0, 3)), 13,
  'historical unknown code does not invalidate a unique exact export alias');
assert.equal(key('주광\nCL2'), null, 'a currently known contradictory code must block');
assert.equal(key('주광\nCL83'), null, 'name/code conflict must not prefer one master');
assert.equal(key('unknown\nCL2', customers.slice(0, 3)), null, 'no arbitrary Y-prefix/suffix equivalence');
assert.equal(key('unknown\nCL8', customers.slice(0, 3)), null, 'no partial CL83 match');
assert.equal(key('제이에\nmissing'), null, 'no partial name match');
assert.equal(key('unknown\nunknown'), null);

const sharedName = [...customers, { CustKey: 99, CustName: '다른 이름', Descr: '제이에스/메모', OrderCode: 'OTHER' }];
assert.equal(key('제이에스\nmissing', sharedName), null, 'ambiguous names with no exact code block');
assert.equal(key('제이에스\nCL83', sharedName), 688, 'unique name/code intersection resolves duplicated alias');
const sharedCode = [...customers, { CustKey: 99, CustName: '다른 이름', Descr: '다른별칭', OrderCode: 'CL83' }];
assert.equal(key('unknown\nCL83', sharedCode), null, 'duplicate codes alone cannot select a master');
assert.equal(key('제이에스\nCL83', sharedCode), 688, 'exact name disambiguates duplicated code');
const duplicated = [...customers, { ...customers[2], CustKey: 99 }];
assert.equal(key('제이에스\nCL83', duplicated), null, 'multiple common masters fail closed');
assert.equal(key('제이에스\nCL83', [...customers, { ...customers[2] }]), 688, 'same PK repeated is one identity');

for (const label of ['주광', '주광농원', 'YCL2']) assert.equal(key(label), 533, 'single exact name/alias/code');
assert.equal(key('제이에스', sharedName), null, 'single ambiguous alias blocks');
assert.equal(key('CL83', sharedCode), null, 'single ambiguous code blocks');
assert.equal(key('CL83', [...customers, { CustKey: 99, CustName: 'CL83', OrderCode: 'OTHER' }]), null,
  'single-token name/code identity collision blocks');
for (const label of ['', ' ', null, '제이에스\nCL83\nextra']) assert.equal(key(label), null);
assert.equal(key('제이에스\nCL83', []), null);
assert.equal(key('제이에스\nCL83', [{ ...customers[2], CustKey: 0 }]), null);
assert.equal(key('제이에스\nCL83', [{ ...customers[2], CustKey: 1.5 }]), null);

const before = JSON.stringify(customers);
for (const label of ['주광\nCL2', '제이에스\nCL83', '코드22\nCL22', 'unknown\nCL83']) {
  assert.equal(key(label, [...customers].reverse()), key(label), 'candidate order cannot select an identity');
}
assert.equal(JSON.stringify(customers), before, 'matching never mutates master data');
assert.equal(matchDutchCustomer(customers, '제이에스\nCL83'), customers[2], 'return original selected object');
console.log('dutchVolumeCustomerMatch exact structured-header tests passed');
