import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseOrderImportMetadata } from '../lib/orderImportParse.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal } from '../lib/orderShipmentList.js';

const meta = parseOrderImportMetadata([['남대문청화 35차 예상 출고리스트(8월30일 출고)']]);
assert.deepEqual(meta, { customerName:'남대문청화', majorWeek:'35' });
const matchedCustomer = resolveImportCustomer('남대문청화', [
  { CustKey: 77, CustName: '남대문 청화', CustCode: '', OrderCode: '', CustArea: '' },
], { savedMappings: {} });
assert.equal(matchedCustomer.custKey, 77, '붙여넣기와 같은 정규화 규칙으로 공백이 다른 업체명을 매칭해야 한다');
const rows = initializeShipDateAllocations([{prodKey:1,qty:5,unit:'박스'}], '2026-35-01', {1:'2026-08-30',2:'2026-09-01'});
assert.deepEqual(rows[0].allocations, {'2026-08-30':5});
const moved = moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 2);
assert.deepEqual(moved.allocations, {'2026-08-30':3,'2026-09-01':2});
assert.equal(allocationTotal(moved), 5);
assert.throws(()=>moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 6), /초과/);
const api = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/shipment-list-source.js'),'utf8');
assert.match(api,/om\.OrderYear=@year AND om\.OrderWeek=@week AND om\.CustKey=@ck/);
assert.match(api,/sm\.OrderYear=@year AND sm\.OrderWeek=@week AND sm\.CustKey=@ck/);
const parseApi = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/import-parse.js'),'utf8');
assert.match(parseApi,/resolveImportCustomer\(parsedMetadata\.customerName/);
const page = fs.readFileSync(path.join(process.cwd(),'pages/orders/import.js'),'utf8');
assert.ok(page.indexOf('1. 파일을 드래그하거나 클릭하여 업로드') < page.indexOf('2. 자동 매칭 결과 확인'), '업로드가 거래처·차수 매칭보다 먼저 보여야 한다');
console.log('order shipment list tests passed');
