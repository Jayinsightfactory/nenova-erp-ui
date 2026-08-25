const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function addQuoteSheet(wb, name, { remark, items }) {
  const aoa = [];
  aoa[0] = ['거래명세표'];
  aoa[1] = ['일련번호', null, null, new Date(Date.UTC(2026, 7, 13, 12, 0, 0))];
  aoa[7] = ['비 고', null, null, remark];
  aoa[14] = ['순번', '품목명', null, null, null, null, '원산지', null, null, '단위', '수량', '단가', null, null, '공급가액', '부가세', '적요'];
  items.forEach((it, i) => {
    const supply = it.qty * it.price;
    aoa[15 + i] = [i + 1, it.name, null, null, null, null, it.origin || '', null, null, it.unit || '대', it.qty, it.price, null, null, supply, supply * 0.1, ''];
  });
  const supply = items.reduce((a, it) => a + it.qty * it.price, 0);
  const vat = supply * 0.1;
  aoa[15 + items.length] = ['공급가액', null, supply, null, 'VAT', vat, null, null, null, null, null, '합계', null, supply + vat];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
}

async function main() {
  const { parseRaumQuoteWorkbookGroups } = await import('../lib/raumPnlParse.js');
  const { defaultPnlTitle, resolvePnlPartner } = await import('../lib/raumPnlPartner.js');

  assert.equal(resolvePnlPartner().code, 'raum');
  assert.equal(resolvePnlPartner('CHOIMUN').label, '초이문');
  assert.equal(defaultPnlTitle('choimun', '32'), '초이문 32차');
  assert.throws(() => resolvePnlPartner('other'), /라움 또는 초이문/);

  const choimunWb = XLSX.utils.book_new();
  addQuoteSheet(choimunWb, '32차', {
    remark: '초이문',
    items: [
      { name: '수국 화이트', origin: '콜롬비아', unit: '대', qty: 362, price: 2600 },
      { name: '장미 딥실버', origin: '콜롬비아', unit: '단', qty: 11, price: 13000 },
    ],
  });
  addQuoteSheet(choimunWb, '33차', {
    remark: '초이문',
    items: [{ name: '수국 화이트', origin: '콜롬비아', unit: '대', qty: 50, price: 2600 }],
  });

  const choimun = parseRaumQuoteWorkbookGroups(XLSX, choimunWb, { partnerCode: 'choimun' });
  assert.equal(choimun.batches.length, 2, '초이문 32·33차가 각각 독립 배치여야 한다.');
  assert.deepEqual(choimun.batches.map(b => b.major), ['32', '33']);
  assert.equal(choimun.batches[0].items[0].name, '수국 화이트');
  assert.equal(choimun.batches[0].items[0].qty, 362);
  assert.equal(choimun.batches[0].items[0].price, 2600);
  assert.equal(choimun.batches[0].items[0].byBranch.초이문, 362);
  assert.ok(choimun.batches.every(b => (b.verification || []).every(c => c.ok)), '초이문 합계 검증이 통과해야 한다.');

  const asRaum = parseRaumQuoteWorkbookGroups(XLSX, choimunWb, { partnerCode: 'raum' });
  assert.equal(asRaum.batches.length, 0, '라움 선택 시 초이문 시트를 합산하면 안 된다.');
  assert.ok(asRaum.warnings.some(w => /초이문/.test(w)), '라움 화면에 초이문 파일을 올리면 안내해야 한다.');

  const raumWb = XLSX.utils.book_new();
  addQuoteSheet(raumWb, '27차강남양식', {
    remark: '강남 라움',
    items: [{ name: '수국 화이트', origin: '콜롬비아', unit: '대', qty: 10, price: 2600 }],
  });
  addQuoteSheet(raumWb, '27차건대양식', {
    remark: '건대 라움',
    items: [{ name: '수국 화이트', origin: '콜롬비아', unit: '대', qty: 4, price: 2600 }],
  });
  const raum = parseRaumQuoteWorkbookGroups(XLSX, raumWb, { partnerCode: 'raum' });
  assert.equal(raum.batches.length, 1);
  assert.equal(raum.batches[0].items[0].qty, 14);
  assert.equal(raum.batches[0].items[0].byBranch.강남, 10);
  assert.equal(raum.batches[0].items[0].byBranch.건대, 4);

  const raumAsChoimun = parseRaumQuoteWorkbookGroups(XLSX, raumWb, { partnerCode: 'choimun' });
  assert.equal(raumAsChoimun.batches.length, 0, '초이문 선택 시 강남/건대 라움 시트를 합산하면 안 된다.');

  const real = 'C:/Users/USER/Documents/카카오톡 받은 파일/초이문 견적서 양식.xlsx';
  if (fs.existsSync(real)) {
    const realWb = XLSX.readFile(real, { cellDates: true });
    const parsed = parseRaumQuoteWorkbookGroups(XLSX, realWb, { partnerCode: 'choimun' });
    assert.ok(parsed.batches.length >= 1, '초이문 견적서 양식 실제 파일이 파싱되어야 한다.');
    assert.ok(parsed.batches.every(b => (b.verification || []).every(c => c.ok)), '실제 초이문 양식 합계가 맞아야 한다.');
    const hydrangea = parsed.batches.find(b => b.major === '32')?.items.find(it => it.name === '수국 화이트');
    assert.equal(hydrangea?.qty, 362);
    assert.equal(hydrangea?.price, 2600);
  }

  const lib = read('lib/raumPnl.js');
  const page = read('pages/raum/pnl.js');
  const layout = read('components/Layout.js');
  const panel = read('components/raum/RaumImageOrderPanel.js');
  const migration = read('docs/migrations/2026-08-25_web_raum_pnl_partner_code.sql');
  assert.match(lib, /OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc/);
  assert.match(lib, /INSERT INTO WebRaumPnl \(OrderYear, MajorWeek, PartnerCode/);
  assert.match(migration, /COL_LENGTH\('dbo\.WebRaumPnl', 'PartnerCode'\) IS NULL/);
  assert.match(layout, /라움 초이문 손익계산서/);
  assert.match(page, /selectPartner/);
  assert.match(page, /partnerCode/);
  assert.match(panel, /custName,/);
  assert.doesNotMatch(panel, /custName: '라움'/);
  console.log('Raum/Choimun P&L partner tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
