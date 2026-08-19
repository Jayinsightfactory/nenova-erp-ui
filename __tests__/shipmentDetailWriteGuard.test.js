import fs from 'node:fs';
import { canInsertShipmentDetail, isActiveShipmentOutQty } from '../lib/shipmentDetailWriteGuard.js';

let pass = 0;
let fail = 0;
const assert = (label, cond) => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  ✗ ${label}`);
};

console.log('=== shipmentDetailWriteGuard unit ===');
assert('0 is inactive', !isActiveShipmentOutQty(0));
assert('positive active', isActiveShipmentOutQty(5));
assert('cannot insert 0', !canInsertShipmentDetail(0));
assert('can insert 1', canInsertShipmentDetail(1));
const guard = fs.readFileSync('lib/shipmentDetailWriteGuard.js', 'utf8');
assert('0정리 시 농장도 삭제', guard.includes('DELETE FROM ShipmentFarm WHERE SdetailKey=@dk'));
assert('0정리는 주문 보존', !/DELETE FROM OrderDetail/.test(guard));

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
