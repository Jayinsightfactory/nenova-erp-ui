import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseOrderImportMetadata } from '../lib/orderImportParse.js';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal } from '../lib/orderShipmentList.js';

const meta = parseOrderImportMetadata([['남대문청화 35차 예상 출고리스트(8월30일 출고)']]);
assert.deepEqual(meta, { customerName:'남대문청화', majorWeek:'35' });
const rows = initializeShipDateAllocations([{prodKey:1,qty:5,unit:'박스'}], '2026-35-01', {1:'2026-08-30',2:'2026-09-01'});
assert.deepEqual(rows[0].allocations, {'2026-08-30':5});
const moved = moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 2);
assert.deepEqual(moved.allocations, {'2026-08-30':3,'2026-09-01':2});
assert.equal(allocationTotal(moved), 5);
assert.throws(()=>moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 6), /초과/);
const api = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/shipment-list-source.js'),'utf8');
assert.match(api,/om\.OrderYear=@year AND om\.OrderWeek=@week AND om\.CustKey=@ck/);
assert.match(api,/sm\.OrderYear=@year AND sm\.OrderWeek=@week AND sm\.CustKey=@ck/);
console.log('order shipment list tests passed');
