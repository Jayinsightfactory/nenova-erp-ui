import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allocationKey, buildGroupRows, buildMajorWeeks, normalizeMajorWeek } from '../lib/shillaMiuBoard.js';

assert.equal(normalizeMajorWeek('2026-32-02'), '32');
assert.deepEqual(buildMajorWeeks('31','32'), ['31','32']);
assert.equal(allocationKey({groupKey:3,useWeek:'32',prodKey:7}), '3|32|7');

const rows=buildGroupRows({weeks:['32'],baseShipments:[{week:'32',orderWeek:'32-01',prodKey:1,prodName:'A',qty:100},{week:'32',orderWeek:'32-02',prodKey:1,prodName:'A',qty:50}],receiverShipments:[{week:'32',orderWeek:'32-01',prodKey:1,qty:40},{week:'32',prodKey:2,prodName:'receiver only',qty:99}],allocations:[{useWeek:'32',prodKey:1,qty:110,matched:true},{useWeek:'32',prodKey:3,qty:20}]});
assert.deepEqual(rows.map(r=>r.prodKey),[1],'수령업체만 출고된 품목과 웹값만 있는 품목은 기준업체 행에 포함하지 않는다.');
assert.equal(rows[0].weeks['32'].baseActual,150);
assert.equal(rows[0].weeks['32'].receiverActual,40);
assert.equal(rows[0].weeks['32'].calculatedRemainder,110);
assert.equal(rows[0].weeks['32'].difference,0);
assert.equal(rows[0].weeks['32'].subweeks.length,2);

const api=fs.readFileSync('pages/api/sales/shilla-miu-board.js','utf8');
const page=fs.readFileSync('pages/sales/shilla-miu-board.js','utf8');
assert.ok(api.includes('sm.OrderYear=@yr')&&api.includes('LEFT(sm.OrderWeek,2) IN'));
assert.ok(api.includes('sm.CustKey=@cust')&&!api.includes("CustName LIKE N'%신라%'"));
assert.ok(api.includes('ISNULL(sm.isDeleted,0)=0')&&api.includes('ISNULL(sd.OutQuantity,0)>0'));
assert.ok(api.includes('WebShillaMiuBoardGroup')&&api.includes('isAdmin'));
assert.ok(api.includes('GroupKey IS NULL'),'기존 저장값 호환 읽기를 유지한다.');
assert.ok(!api.match(/(?:INSERT|UPDATE|DELETE)\s+(?:Order|Shipment|Stock|Estimate|WebProfitReport)/i),'조회/저장 API에 ERP 쓰기가 없어야 한다.');
assert.ok(page.includes('업체 추가/관리')&&page.includes('미완료만')&&page.includes('펼치기'));
console.log('shilla miu board tests passed');
