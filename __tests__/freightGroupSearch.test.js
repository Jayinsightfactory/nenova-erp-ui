const assert = require('node:assert/strict');

async function main() {
  const { filterFreightGroups, normalizeFreightSearchTerm } = await import('../lib/freightGroupSearch.js');
  const groups = [
    {
      GroupKey: 'awb:00645360346', AWB: '006-45360346', OrderWeek: '28-02',
      FarmName: '콜롬비아 장미농장', InvoiceNo: 'INV-2802-A', InputDate: '2026-07-10',
    },
    {
      GroupKey: 'warehouse:42', AWB: '', OrderWeek: '29-01',
      FarmName: '주광농원', InvoiceNo: 'RODAS-29', InputDate: '2026-07-11',
    },
    {
      GroupKey: 'awb:123', AWB: '123 456', OrderWeek: '27-02',
      FarmName: '에콰도르 농장', InvoiceNo: 'INV-2702', InputDate: '2026-07-04',
    },
  ];

  assert.equal(normalizeFreightSearchTerm(' 006-45360346 '), '00645360346');
  assert.deepEqual(
    filterFreightGroups(groups, '00645360346').map(g => g.GroupKey),
    ['awb:00645360346'],
    'AWB 하이픈을 제거한 검색이 동작해야 합니다.'
  );
  assert.deepEqual(
    filterFreightGroups(groups, '콜롬비아 28-02').map(g => g.GroupKey),
    ['awb:00645360346'],
    '농장명과 차수를 함께 검색해야 합니다.'
  );
  assert.deepEqual(
    filterFreightGroups(groups, 'RODAS 29').map(g => g.GroupKey),
    ['warehouse:42'],
    '인보이스와 차수 검색이 동작해야 합니다.'
  );
  assert.deepEqual(
    filterFreightGroups(groups, '  ').map(g => g.GroupKey),
    groups.map(g => g.GroupKey),
    '검색어가 비어 있으면 전체 목록을 반환해야 합니다.'
  );
  assert.deepEqual(
    filterFreightGroups(groups, '없는검색어', 'warehouse:42').map(g => g.GroupKey),
    ['warehouse:42'],
    '검색어가 바뀌어도 현재 선택 그룹은 select 옵션에 남아야 합니다.'
  );

  console.log('Freight group search tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
