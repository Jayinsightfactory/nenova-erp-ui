const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function main() {
  const { parseArrivalCostWorkbook } = await import('../lib/arrivalCostExcel.js');
  const wb = XLSX.utils.book_new();
  const standard = [
    ['COLOMBIA 원가자료'],
    ['차수', '29-1'],
    ['환율', 1550, 'GW', 100, 'CW', 120, '항공료', 1200],
    [],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['CARNATION Colombia / Moon Light', 10, 0.5, 0.2, 1085, 1, 1085],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(standard), '29-1');
  const shifted = [
    ['COLOMBIA 수국'],
    ['차수', '29-2'],
    ['환율', 1550, 'GW', 100, 'CW', 120, '항공료', 1200],
    [],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Antioquia', 'Hydrangea White (화이트)', 10, 0.5, 1.1, 1, 1800],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shifted), '29-2');

  const parsed = parseArrivalCostWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '29-1 수국 원가자료.xlsx',
    products: [
      { ProdKey: 1, ProdName: 'CARNATION Colombia / Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단', SteamOf1Box: 1 },
      { ProdKey: 2, ProdName: 'Hydrangea White', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '단', SteamOf1Box: 1 },
    ],
    farms: [{ FarmKey: 10, FarmName: 'Antioquia' }],
  });
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.rows[0].orderWeek, '29-1');
  assert.equal(parsed.rows[1].orderWeek, '29-2');
  assert.equal(parsed.rows[1].farmKey, 10, '첫 열 농장 구조도 매칭되어야 합니다.');
  assert.ok(parsed.rows.every(row => row.sourceArrivalCostKRW > 0));
  assert.ok(parsed.rows.every(row => row.rawJson));
  console.log('arrival cost excel parser tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

