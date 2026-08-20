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

  const emptyCost = [
    ['COLOMBIA'],
    ['차수', '34-2'],
    ['총금액 Invoice', '', '', '', '', '', '', '', '', '', '', '', '', '', '백상', '', '겸역차감', 40000],
    ['환율', 1500, '', '', '', '', '', '', '', '', '', '', '', '', '통관 수수료', 33000],
    ['GW', 10, 'CW', 100, '', '', '', '', '', '', '', '', '', '', '검역 수수료'],
    ['품목수', 1, 'Rate', 2, '', '', '', '', '', '', '', '', '', '', '국내 운송비', 500],
    ['총수량'],
    ['항공료', '', '서류', 10, '운송비'],
    [],
    ['', 'Color\r\nGrade', '', '', '수량', 'FOB', '운송비 \r\n(송이)', 'CNF (송이)', '총금액\r\n(CNF포함)', 'CNF (원화)', '관세 (없음)', '그외통관\r\n(송이당)', '도착원가(송이)', '단당  수량', '도착원가(단)'],
    ['Antioquia', 'Hydrangea White (화이트)', '', '', 10, 1, '', '', '', '', '', '', '', 1, ''],
  ];
  const emptyWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(emptyWb, XLSX.utils.aoa_to_sheet(emptyCost), '34-2');
  const filled = parseArrivalCostWorkbook(XLSX.write(emptyWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '34-2 수국 원가자료.xlsx',
    products: [{ ProdKey: 2, ProdName: 'Hydrangea White', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '단', SteamOf1Box: 1 }],
    farms: [{ FarmKey: 10, FarmName: 'Antioquia' }],
  });
  assert.equal(filled.rowCount, 1, '도착원가 열이 비어도 Color Grade 수국 양식은 행을 읽어야 한다.');
  assert.equal(filled.rows[0].orderWeek, '34-2');
  assert.equal(filled.rows[0].farmKey, 10);
  // 백상=GW*410=4100, 검역=품목수*10000=10000, 그외통관합=4100+33000+10000+500+40000=87600
  // 항공료=서류10+Rate2*CW100=210, 송이운임=21, CNF원화=(1+21)*1500=33000, 도착원가=33000+87600/10=41760
  assert.equal(Math.round(filled.rows[0].sourceArrivalCostKRW), 41760);

  const { hydrateSheetFormulas } = await import('../lib/arrivalCostExcel.js');
  const formulaSheet = {
    A1: { t: 'n', v: 2 },
    B1: { t: 'n', v: 3 },
    C1: { t: 'z', f: 'A1+B1', v: 0 },
    D1: { t: 'z', f: 'SUM(A1:B1)*10', v: 0 },
    E1: { t: 'z', f: '$A$1/$B$1', v: 0 },
  };
  hydrateSheetFormulas(formulaSheet);
  assert.equal(formulaSheet.C1.v, 5);
  assert.equal(formulaSheet.D1.v, 50);
  assert.equal(formulaSheet.E1.v, 2 / 3);

  console.log('arrival cost excel parser tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

