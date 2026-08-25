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

  const { matchArrivalFarm, inferArrivalQtyUnit } = await import('../lib/arrivalCostExcel.js');
  const farms = [
    { FarmKey: 10, FarmName: 'Antioquia' },
    { FarmKey: 11, FarmName: 'Greenland' },
    { FarmKey: 12, FarmName: 'Lozarte' },
    { FarmKey: 13, FarmName: 'Cloud Flowers' },
  ];
  assert.equal(matchArrivalFarm('Green Land', farms)?.FarmKey, 11, '공백 없는 전산 농장명도 매칭해야 한다.');
  assert.equal(matchArrivalFarm('Lorzate', farms)?.FarmKey, 12, '수국표 오탈자 농장도 별칭으로 매칭해야 한다.');
  assert.equal(matchArrivalFarm('Cloud', farms)?.FarmKey, 13, '상품명 정규화로 cloud를 지우면 안 된다.');
  assert.equal(inferArrivalQtyUnit({
    quantityHeader: '수량',
    unitCountHeader: '단당  수량',
    unitCostHeader: '도착원가(단)',
    unitCount: 1,
    product: { OutUnit: '박스' },
  }), '단', '단당수량·도착원가(단) 양식은 전산 OutUnit이 박스여도 입고수량은 단이다.');
  assert.equal(inferArrivalQtyUnit({
    quantityHeader: '수량(박스)',
    product: { OutUnit: '단' },
  }), '박스', '수량 헤더가 박스면 박스로 분류한다.');

  const fillDown = [
    ['COLOMBIA 수국'],
    ['차수', '34-2'],
    ['환율', 1550, 'GW', 10, 'CW', 12, '항공료', 120],
    [],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Antioquia', 'Hydrangea White (화이트)', 10, 0.5, 1.1, 1, 1800],
    ['', 'Hydrangea Blue (블루)', 5, 0.6, 1.2, 1, 1900],
  ];
  const fillWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(fillWb, XLSX.utils.aoa_to_sheet(fillDown), '34-2');
  const filledFarms = parseArrivalCostWorkbook(XLSX.write(fillWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '34-2 수국 원가자료.xlsx',
    products: [
      { ProdKey: 2, ProdName: 'Hydrangea White', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스' },
      { ProdKey: 3, ProdName: 'Hydrangea Blue', DisplayName: '수국 블루', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스' },
    ],
    farms: [{ FarmKey: 10, FarmName: 'Antioquia' }],
  });
  assert.equal(filledFarms.rowCount, 2, '농장명이 첫 행만 있어도 아래 품목 행을 읽어야 한다.');
  assert.equal(filledFarms.rows[1].farmNameRaw, 'Antioquia', '빈 농장 칸은 위 행 농장명을 이어받아야 한다.');
  assert.equal(filledFarms.rows[1].farmKey, 10);
  assert.ok(filledFarms.rows.every((row) => row.unit === '단'), '수국 Color Grade 수량은 단으로 분류해야 한다.');

  const merged = [
    ['COLOMBIA'],
    ['차수', '33-1'],
    ['GW', 80, 'CW', 140],
    [],
    ['농장', '품목명', '수량', '단위', '도착원가(단)'],
    ['Fillco', 'CARNATION Moon Light', 30, '단', 9520],
    [null, 'CARNATION White', 20, '단', 8800],
  ];
  const mergedWb = XLSX.utils.book_new();
  const mergedSheet = XLSX.utils.aoa_to_sheet(merged);
  mergedSheet['!merges'] = [{ s: { r: 5, c: 0 }, e: { r: 6, c: 0 } }];
  XLSX.utils.book_append_sheet(mergedWb, mergedSheet, '33-1');
  const mergedParsed = parseArrivalCostWorkbook(XLSX.write(mergedWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '33-1 카네이션 원가자료.xlsx',
    products: [
      { ProdKey: 11, ProdName: 'CARNATION Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스' },
      { ProdKey: 12, ProdName: 'CARNATION White', DisplayName: '카네이션 화이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '박스' },
    ],
    farms: [{ FarmKey: 21, FarmName: 'Fillco' }],
  });
  assert.equal(mergedParsed.rowCount, 2);
  assert.equal(mergedParsed.rows[1].farmNameRaw, 'Fillco', '세로 병합된 농장 칸을 아래 품목에도 채워야 한다.');
  assert.equal(mergedParsed.rows[1].farmKey, 21);
  assert.equal(mergedParsed.rows[0].chargeableWeight, 140);
  assert.equal(mergedParsed.rows[0].grossWeight, 80);
  assert.ok(mergedParsed.rows.every((row) => row.unit === '단'), '엑셀 단위 열이 단이면 전산 OutUnit이 박스여도 단이다.');

  const banner = [
    ['COLOMBIA'],
    ['차수', '33-1'],
    ['GW', 100, 'CW', 100],
    [],
    ['품목명', '수량', '도착원가(단)'],
    ['La Gaitana', '', ''],
    ['CARNATION Moon Light', 25, 9520],
    ['CARNATION White', 10, 8800],
  ];
  const bannerWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bannerWb, XLSX.utils.aoa_to_sheet(banner), '33-1');
  const bannerParsed = parseArrivalCostWorkbook(XLSX.write(bannerWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '33-1 카네이션 원가자료.xlsx',
    products: [
      { ProdKey: 11, ProdName: 'CARNATION Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단' },
      { ProdKey: 12, ProdName: 'CARNATION White', DisplayName: '카네이션 화이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단' },
    ],
    farms: [{ FarmKey: 22, FarmName: 'La Gaitana' }],
  });
  assert.equal(bannerParsed.rowCount, 2, '수량 없는 농장 제목 행 다음 품목을 읽어야 한다.');
  assert.equal(bannerParsed.rows[0].farmNameRaw, 'La Gaitana');
  assert.equal(bannerParsed.rows[1].farmNameRaw, 'La Gaitana');
  assert.equal(bannerParsed.rows[0].farmKey, 22);

  const { expandMergedCells } = await import('../lib/arrivalCostExcel.js');
  const hugeMerge = XLSX.utils.aoa_to_sheet([
    ['Fillco', 'CARNATION Moon Light', 30, '단', 9520],
    [null, 'CARNATION White', 20, '단', 8800],
  ]);
  hugeMerge['!ref'] = 'A1:E2';
  hugeMerge['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 200000, c: 0 } }];
  const mergeStarted = Date.now();
  expandMergedCells(hugeMerge);
  assert.ok(Date.now() - mergeStarted < 500, '시트 범위를 넘는 병합은 펼치지 않아야 한다.');
  assert.equal(hugeMerge.A2?.v, 'Fillco');
  assert.ok(Object.keys(hugeMerge).filter((key) => key[0] !== '!').length < 20);

  const hugeSum = {
    A1: { t: 'n', v: 2 },
    B1: { t: 'z', f: 'SUM(A1:A20000)', v: 0 },
  };
  const sumStarted = Date.now();
  hydrateSheetFormulas(hugeSum);
  assert.ok(Date.now() - sumStarted < 500, '과도한 SUM 범위는 계산을 건너뛰어야 한다.');
  assert.equal(hugeSum.B1.v, 0);

  const moonWb = XLSX.utils.book_new();
  const moonSheet = [
    ['COLOMBIA'],
    ['차수', '14-1'],
    ['GW', 80, 'CW', 140],
    [],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Fillco', 'CARNATION Moon Light', 30, 0.2, 0.08, 476, 20, 9520],
    ['Don Eusebio', 'CARNATION Moon Light', 25, 0.2, 0.08, 476, 20, 9520],
  ];
  XLSX.utils.book_append_sheet(moonWb, XLSX.utils.aoa_to_sheet(moonSheet), '14-1A');
  const moon33 = [
    ['COLOMBIA'],
    ['차수', '33-2'],
    ['GW', 2147, 'CW', 2274],
    [],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Fillco', 'CARNATION Moon Light', 1500, 0.2, 0.08, 449.287, 20, 8985.74],
  ];
  XLSX.utils.book_append_sheet(moonWb, XLSX.utils.aoa_to_sheet(moon33), '33-2');
  const moonParsed = parseArrivalCostWorkbook(XLSX.write(moonWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '33-2 원가자료 (1).xlsx',
    products: [{ ProdKey: 11, ProdName: 'CARNATION Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단' }],
    farms: [{ FarmKey: 21, FarmName: 'Fillco' }, { FarmKey: 22, FarmName: 'Don Eusebio' }],
  });
  const week14 = moonParsed.rows.filter((row) => row.orderWeek === '14-1');
  const week33 = moonParsed.rows.filter((row) => row.orderWeek === '33-2');
  assert.equal(week14.length, 2, '시트명 14-1A는 파일명 33-2보다 시트 차수를 써야 한다.');
  assert.equal(week33.length, 1);
  assert.ok(week14.every((row) => Math.round(row.sourceArrivalCostKRW) === 9520), '입고수량이 단이면 도착원가(단)을 써야 한다.');
  assert.equal(Math.round(week33[0].sourceArrivalCostKRW), 8986);
  assert.ok(week14.every((row) => Math.round(row.sourceArrivalCostPerStemKRW) === 476));

  const splitWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(splitWb, XLSX.utils.aoa_to_sheet([
    ['COLOMBIA 콜카장'],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Fillco', 'CARNATION Moon Light', 10, 0.2, 0.08, 488.5, 20, 9770],
  ]), '16-1A');
  XLSX.utils.book_append_sheet(splitWb, XLSX.utils.aoa_to_sheet([
    ['B'],
    ['Color Grade', '수량', 'FOB', '운송비(송이)', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    ['Ayura', 'CARNATION Moon Light', 10, 0.2, 0.08, 476, 20, 9520],
  ]), '16-1B');
  const splitParsed = parseArrivalCostWorkbook(XLSX.write(splitWb, { type: 'buffer', bookType: 'xlsx' }), {
    fileName: '33-2 원가자료 (1).xlsx',
    products: [{ ProdKey: 11, ProdName: 'CARNATION Moon Light', DisplayName: '카네이션 문라이트', FlowerName: '카네이션', CounName: '콜롬비아', OutUnit: '단' }],
    farms: [{ FarmKey: 21, FarmName: 'Fillco' }, { FarmKey: 23, FarmName: 'Ayura' }],
  });
  const sheetB = splitParsed.rows.filter((row) => row.sheetName === '16-1B');
  assert.equal(sheetB.length, 1);
  assert.equal(sheetB[0].orderWeek, '16-1');
  assert.equal(sheetB[0].countryName, '콜롬비아', '16-1B 머리글에 COLOMBIA가 없어도 같은 차수 시트의 국가를 이어받아야 한다.');
  assert.equal(Math.round(sheetB[0].sourceArrivalCostKRW), 9520);

  const { arrivalCostSupersedeScopes } = await import('../lib/arrivalCost.js');
  const scopes = arrivalCostSupersedeScopes([
    { orderWeek: '33-2', countryName: '콜롬비아' },
    { orderWeek: '16-1', countryName: '콜롬비아' },
  ]);
  assert.ok(scopes.includes('33-2|콜롬비아'));
  assert.ok(scopes.includes('33-2|'), '이전 업로드의 빈 국가 33-2 유령 행도 SUPERSEDE 해야 한다.');
  assert.ok(scopes.includes('16-1|'));

  console.log('arrival cost excel parser tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

