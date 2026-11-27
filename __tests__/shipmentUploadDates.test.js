import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { allocationDateHeader, planUploadedDates, addUploadedDates } from '../lib/shipmentUploadDates.js';

const wed = '2026-11-25 00:00:00.000';
const thu = '2026-11-26 00:00:00.000';
const calendar = [{ Timestamp: wed, WeekDay: 4 }, { Timestamp: thu, WeekDay: 5 }];

assert.equal(allocationDateHeader({ v: '목요일' }, XLSX), '목');
assert.equal(allocationDateHeader({ v: '2026.11.26' }, XLSX), '2026-11-26');
assert.equal(allocationDateHeader({ v: '47차 선출고' }, XLSX), '');
assert.equal(allocationDateHeader({
  t: 'n', v: (Date.UTC(2026, 10, 26) - Date.UTC(1899, 11, 30))/86400000, z: 'yyyy-mm-dd',
}, XLSX), '2026-11-26');
assert.deepEqual(planUploadedDates([{header:'',quantity:3}], calendar, 3), []);
assert.deepEqual(planUploadedDates([{header:'목',quantity:3}], calendar, 2), [{timestamp:thu,quantity:2}]);
const allocations=planUploadedDates([
  {header:'수',quantity:1}, {header:'목',quantity:2}, {header:'2026-11-26',quantity:3}, {header:'',quantity:0},
], calendar, 6);
assert.deepEqual(allocations, [{timestamp:wed,quantity:1},{timestamp:thu,quantity:5}]);
assert.throws(()=>planUploadedDates([{header:'2025-11-26',quantity:1}],calendar,1), /선택 차수 달력/);
assert.throws(()=>planUploadedDates([{header:'월',quantity:1}],calendar,1), /선택 차수 달력/);
assert.throws(()=>planUploadedDates([{header:'목',quantity:1},{header:'',quantity:1}],calendar,2), /섞여/);
assert.throws(()=>planUploadedDates([{header:'목',quantity:1}], [...calendar,calendar[1]],1), /한 날짜/);
assert.throws(()=>planUploadedDates([{header:'목',quantity:1},{header:'수',quantity:1}],calendar,1), /합계/);
assert.deepEqual(addUploadedDates(allocations,[{ShipmentDtm:new Date('2026-11-25T00:00:00Z'),ShipmentQuantity:2}],2),
  [{timestamp:wed,quantity:3},{timestamp:thu,quantity:5}]);
assert.throws(()=>addUploadedDates(allocations,[],2), /합계/);
console.log('Excel shipment date headers, selected calendar, combined dates, and existing add date allocations passed.');
