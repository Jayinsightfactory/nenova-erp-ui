const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function main() {
  const { parseArrivalCostWorkbook } = await import('../lib/arrivalCostExcel.js');
  const parse = (name, products, mappings = {}) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['CHINA 원가자료 2026'],
      ['품목명', '수량', '도착원가(단)'],
      [name, 10, 2500],
    ]), '40-1');
    return parseArrivalCostWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
      fileName: 'CHINA 2026 40-1 원가자료.xlsx', orderYear: '2026', products, mappings,
    }).rows[0];
  };
  const wrongCountry = { ProdKey: 1, ProdName: 'Hydrangea White', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '단' };
  assert.equal(parse('Hydrangea White', [wrongCountry]).prodKey, null, '다른 국가의 정확명도 자동 매칭하지 않는다');
  const china = { ...wrongCountry, ProdKey: 2, CounName: '중국' };
  assert.equal(parse('Hydrangea White', [wrongCountry, china]).prodKey, 2);
  const white = { ...china, ProdKey: 3, ProdName: 'Hydrangea White' };
  const pink = { ...china, ProdKey: 4, ProdName: 'Hydrangea Pink' };
  assert.equal(parse('Hydrangea', [white, pink]).prodKey, null);
  assert.equal(parse('Hydrangea', [pink, white]).prodKey, null, '동점은 DB 순서가 바뀌어도 미매칭 유지');
  assert.equal(parse('Hydrangea White', [white, pink]).prodKey, 3);
  console.log('arrival product country and fuzzy tie tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
