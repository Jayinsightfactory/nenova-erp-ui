const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { parseReportCycle, compareReportCycles, findPreviousCycle, buildExecutiveVolumeRows, summarizeExecutiveVolume } = await import('../lib/executiveVolumeReport.js');
  const cycles = ['2025|40-01','2025|40-02','2026|39-02','2026|40-01'].map(value => { const [year,week]=value.split('|'); return parseReportCycle(year,week); });
  assert.equal(parseReportCycle('2026','40-01').week,'40-01');
  assert.equal(parseReportCycle('2026','40-1'),null);
  assert.equal(compareReportCycles(cycles[0],cycles[3])<0,true);
  const selected=cycles[3];
  assert.deepEqual(findPreviousCycle(cycles,selected),cycles[2]);
  const report=buildExecutiveVolumeRows({
    orders:[{country:'콜롬비아',flower:'장미',unit:'박스',qty:10},{country:'콜롬비아',flower:'장미',unit:'단',qty:4}],
    arrivals:[{country:'콜롬비아',flower:'장미',unit:'박스',qty:8},{country:'콜롬비아',flower:'장미',unit:'단',qty:5}],
    shipments:[{country:'콜롬비아',flower:'장미',unit:'박스',qty:3}],
    previous:{rows:[{country:'콜롬비아',flower:'장미',unit:'박스',inbound:4,outbound:2}]},
    previousYear:{rows:[{country:'콜롬비아',flower:'장미',unit:'박스',inbound:0,outbound:0}]},
  });
  const box=report.find(row=>row.unit==='박스'), bunch=report.find(row=>row.unit==='단');
  assert.equal(box.missingQty,2); assert.equal(box.missingPct,20); assert.equal(box.overInboundQty,0);
  assert.equal(box.inboundVsPrevious.delta,4); assert.equal(box.inboundVsPrevious.ratePct,100);
  assert.equal(box.inboundVsPreviousYear.state,'new'); assert.equal(box.inboundVsPreviousYear.ratePct,null);
  assert.equal(box.outboundVsPrevious.delta,1); assert.equal(bunch.missingQty,0); assert.equal(bunch.overInboundQty,1);
  assert.deepEqual(summarizeExecutiveVolume(report).map(row=>row.unit),['단','박스']);
  const api=fs.readFileSync('pages/api/m/executive-volume.js','utf8');
  for(const marker of ['verifyReqUser','isAdminUser','req.method !== \'GET\'','ViewOrder','ViewWarehouse','ViewShipment','MasterFix','DetailFix','OutUnit']) assert(api.includes(marker),`API missing ${marker}`);
  assert(!/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE|EXEC\s)/i.test(api));
  assert(!api.includes('sd.isDeleted'));
  const page=fs.readFileSync('pages/m/executive-volume.js','utf8');
  assert(page.includes('엑셀 + 그래프 받기')); assert(page.includes('비교자료 없음')); assert(page.includes('getServerSideProps')); assert(page.includes('같은 단위 안에서 비교'));
  assert(page.includes('미입고 현황')); assert(page.includes('손실이나 폐기를 뜻하지 않습니다.'));
  assert(!page.includes('참고용 미입고'));
  console.log('executiveVolumeReport: cross-year identity, actual predecessor, product units, missing/over-inbound, zero baseline, readonly/auth, and xlsx chart path passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
