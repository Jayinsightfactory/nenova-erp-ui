import assert from 'node:assert/strict';
import test from 'node:test';
import { weekdaySaveEligibility, exeWeekdayRepresentativeTimestamp,exeDecimalToEvenAmountVat } from '../lib/weekdayErpCompatibility.js';

test('C# decimal 반올림은 수량과 공급가 midpoint 모두 ToEven이며 binary float에 의존하지 않는다',()=>{
  assert.deepEqual(exeDecimalToEvenAmountVat(110,4.5),{roundedQty:4,amount:400,vat:40,gross:440});
  assert.equal(exeDecimalToEvenAmountVat(110,5.5).roundedQty,6);
  assert.equal(exeDecimalToEvenAmountVat('1.65',1).amount,2);
  assert.equal(exeDecimalToEvenAmountVat('2.75',1).amount,2);
  assert.equal(exeDecimalToEvenAmountVat('2.7500001',1).amount,3);
  assert.equal(exeDecimalToEvenAmountVat('2.7499999',1).amount,2);
  assert.equal(exeDecimalToEvenAmountVat('1.1e-1',25).amount,2);
});

test('확정 상세만 저장하며 master 혼합 상태나 최초 기준은 상세 확정을 대체하지 않는다', () => {
  assert.equal(weekdaySaveEligibility({detailRows:1,detail:{DetailIsFix:1},master:{MasterIsFix:0}}).allowed,true);
  for (const flag of [false,0,null,undefined,'1','mixed']) {
    assert.equal(weekdaySaveEligibility({detailRows:1,detail:{DetailIsFix:flag},master:{MasterIsFix:1},baselineFixed:true}).allowed,false);
  }
  assert.equal(weekdaySaveEligibility({detailRows:1,fixed:true}).allowed,true);
  assert.equal(weekdaySaveEligibility({detailRows:0,masterFixed:true}).allowed,true);
  assert.equal(weekdaySaveEligibility({detailRows:0,masterFixed:false}).allowed,false);
  assert.equal(weekdaySaveEligibility({detailRows:2,fixed:true}).allowed,false);
});

test('EXE 마지막 순서는 일요일이 아니라 가장 큰 WeekDay 양수행이다', () => {
  const rows=[
    {date:'2026-10-01',timestamp:'2026-10-01 00:00:00.000',shipmentQuantity:5},
    {date:'2026-10-03',timestamp:'2026-10-03 12:00:00.000',shipmentQuantity:2},
    {date:'2026-10-04',timestamp:'2026-10-04 00:00:00.000',shipmentQuantity:15},
  ];
  const calendar=new Map(rows.map((row,i)=>[row.date,{timestamp:row.timestamp,weekDay:[5,7,1][i]}]));
  assert.equal(exeWeekdayRepresentativeTimestamp(rows,calendar),rows[1].timestamp);
  assert.equal(exeWeekdayRepresentativeTimestamp(rows.slice().reverse(),calendar),rows[1].timestamp);
  assert.equal(exeWeekdayRepresentativeTimestamp(rows.filter(row=>row.date!=='2026-10-03'),calendar),rows[0].timestamp);
  assert.equal(exeWeekdayRepresentativeTimestamp([{...rows[1],shipmentQuantity:0},rows[2]],calendar),rows[2].timestamp);
  assert.equal(exeWeekdayRepresentativeTimestamp([],calendar),null);
  assert.throws(()=>exeWeekdayRepresentativeTimestamp(rows,new Map()),/달력/);
  const mismatch=new Map(calendar);mismatch.set(rows[1].date,{timestamp:'2026-10-03 00:00:00.000',weekDay:7});
  assert.throws(()=>exeWeekdayRepresentativeTimestamp(rows,mismatch),/달력/);
});
