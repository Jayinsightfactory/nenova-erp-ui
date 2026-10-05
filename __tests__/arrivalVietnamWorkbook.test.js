const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function main() {
  const { parseArrivalCostWorkbook } = await import('../lib/arrivalCostExcel.js');
  const name = 'ORCHID VIETNAM / 호접란  화이트 8 (Party grade White 8)';
  const rows = [
    ['베트남 SUNPRIDE (Royal Base) 원가자료 2026'],
    ['차수', '', '38-1차'],
    ['환율', '', 1400],
    ['Color', '', '', '수량', 'CNF (송의)', '총금액', 'CNF (원화)', '관세', '그외통관(송의당)', '도착원가(송의)', '단당 수량', '도착원가(단)'],
    ['[Premium] Sprayed Galaxy, Jingle Bell Series 7F', '', '', 0, '', 0],
    [name, '', '', 1600, 6.75, 10800, 9450, 472.5, 269.4375, 10191.9375, 1, 10191.9375],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '38-1');
  for (const template of ['100kg', '300kg', '500kg']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), template);
  }
  const parsed = parseArrivalCostWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: 'VT SUNPRIDE (RB)원가자료 (2026) (38-1).xlsx', orderYear: '2026',
    products: [{ ProdKey: 3074, ProdName: name, CounName: '베트남', OutUnit: '단', FlowerName: '호접란' }],
  });
  assert.equal(parsed.rowCount, 1, '중량별 견적 템플릿은 실제 공급 차수 원가에 포함하지 않는다');
  const row = parsed.rows[0];
  assert.equal(row.orderYear, '2026');
  assert.equal(row.orderWeek, '38-1');
  assert.equal(row.countryName, '베트남');
  assert.equal(row.prodKey, 3074);
  assert.equal(row.quantity, 1600);
  assert.equal(row.sourceArrivalCostKRW, 10191.9375);
  assert.equal(row.sourceRow, 6);
  assert.equal(row.farmNameRaw, '', '미공급 품목명을 농장 배너로 전달하지 않는다');
  assert.equal(row.fobUSD, null, 'CNF를 FOB로 간주해 운송비를 이중 계산하지 않는다');
  assert.equal(JSON.parse(row.rawJson).cells['CNF (송의)'], 6.75);
  assert.deepEqual(parsed.skippedSheets.map(s => s.sheetName), ['100kg', '300kg', '500kg']);
  console.log('arrivalVietnamWorkbook tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
