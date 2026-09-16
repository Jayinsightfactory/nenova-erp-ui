import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-order-import-customer-map-'));

try {
  fs.mkdirSync(path.join(dir, 'data'));
  process.chdir(dir);
  const store = await import(`../lib/orderImportCustomerProductMappings.js?test=${Date.now()}`);

  assert.equal(store.saveCustomerProductMapping(101, '프리덤', { prodKey: 11, prodName: 'ROSE / Freedom 50cm' }, { custName: '업체 A' }).saved, true);
  assert.equal(store.saveCustomerProductMapping(202, '프리덤', { prodKey: 22, prodName: 'ROSE / Freedom 60cm' }, { custName: '업체 B' }).saved, true);

  const globalMappings = {
    '프리덤': { prodKey: 99, prodName: 'global freedom' },
    '문라이트': { prodKey: 33, prodName: 'global moonlight' },
  };
  const customerA = store.mergeCustomerProductMappings(globalMappings, 101, true);
  const customerB = store.mergeCustomerProductMappings(globalMappings, 202, true);
  const customerC = store.mergeCustomerProductMappings(globalMappings, 303, true);

  assert.equal(customerA['프리덤'].prodKey, 11, '업체 A의 동일 입력명은 업체 A 저장매칭이 공용값보다 우선해야 한다');
  assert.equal(customerB['프리덤'].prodKey, 22, '업체 B 매칭은 업체 A와 분리되어야 한다');
  assert.equal(customerC['프리덤'].prodKey, 99, '업체 저장값이 없으면 기존 공용매칭을 사용해야 한다');
  assert.equal(customerA['문라이트'].prodKey, 33, '업체별 저장값 외 품목은 공용매칭을 유지해야 한다');
  assert.equal(customerA['프리덤'].mappingScope, 'customer');
  assert.equal(store.saveCustomerProductMapping(0, '프리덤', { prodKey: 1 }).saved, false, '유효하지 않은 고객 범위에는 저장하지 않아야 한다');
} finally {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('order import customer product mappings tests passed');
