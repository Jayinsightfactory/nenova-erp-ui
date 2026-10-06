const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { parseAwbFields, parsePrintedDate } = await import('../lib/importAwbFields.js');
  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
  const item = (str, x, y, width = 30) => ({ str, x, y, width });
  const fixture = () => ({ text: '006 UIO 45504454 APOLLO FREIGHT ECUADOR Total Prepaid Total Collect 1379.60 01-Oct-26 Executed on (date)', items: [
    item('303', 50, 400), item('380.0', 120, 400), item('3.37', 180, 400),
    item('Total Prepaid', 54, 110, 33), item('Total Collect', 152, 110, 31),
    item('1379.60', 83, 96, 36), item('Currency Conversion Rates', 36, 88, 68),
    item('01-Oct-26', 215, 84, 38), item('Executed on (date)', 216, 72, 46),
  ] });
  check('positioned intervening Total Collect label; existing numeric shape preserved', () => {
    assert.deepEqual(parseAwbFields(fixture()), { awb: '006-45504454', company: 'Apollo', gw: 303, cw: 380, uPrice1: 3.37, total: 1379.6, date: '2026/10/01' });
  });
  check('accept raw pdfjs transforms and page object', () => {
    const f = fixture(); const items = f.items.map(({ x, y, ...i }) => ({ ...i, transform: [1, 0, 0, 1, x, y] }));
    assert.equal(parseAwbFields({ pages: [{ text: f.text, items }] }).total, 1379.6);
  });
  check('no unlabeled largest-money fallback', () => {
    assert.equal(parseAwbFields({ text: '006-45504454 Shipper invoice 99999.99 weight charge 1280.60' }).total, undefined);
  });
  check('ambiguous nonzero prepaid and collect omitted', () => {
    const f = fixture(); f.items.push(item('100.00', 155, 96));
    assert.equal(parseAwbFields(f).total, undefined);
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Prepaid USD 1,379.60 Total Collect USD 100.00' }).total, undefined);
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Prepaid USD 100.00 Total Collect USD 100.00' }).total, undefined);
  });
  check('multiple candidate amounts inside one total cell omitted', () => {
    const f = fixture(); f.items.push(item('1400.00', 80, 100));
    assert.equal(parseAwbFields(f).total, undefined);
  });
  check('direct labeled totals remain supported', () => {
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Prepaid USD 1,379.60' }).total, 1379.6);
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Collect USD 450.00' }).total, 450);
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Prepaid USD 0.00' }).total, 0);
    assert.equal(parseAwbFields({ text: 'Air Waybill 006-45504454 Total Prepaid USD 0.00 Total Collect USD 450.00' }).total, 450);
  });
  check('text-only interleaved labels not guessed', () => {
    assert.equal(parseAwbFields({ text: fixture().text }).total, undefined);
  });
  check('missing or invalid dates never replaced with today', () => {
    const f = fixture(); f.items = f.items.filter(i => i.str !== '01-Oct-26');
    assert.equal(parseAwbFields(f).date, undefined);
    f.items.push(item('31-Feb-26', 215, 84)); assert.equal(parseAwbFields(f).date, undefined);
  });
  check('conflicting execution dates omitted', () => {
    const f = fixture(); f.items.push(item('02-Oct-26', 215, 90));
    assert.equal(parseAwbFields(f).date, undefined);
  });
  check('strict dates reject impossible dates and ambiguous numeric day/month', () => {
    assert.equal(parsePrintedDate('29-Feb-24'), '2024/02/29');
    assert.equal(parsePrintedDate('29-Feb-26'), null);
    assert.equal(parsePrintedDate('2026/13/01'), null);
    assert.equal(parsePrintedDate('01/10/26'), null);
    assert.equal(parsePrintedDate('04 oktober 2026'), '2026/10/04');
  });
  check('existing AWB formats and companies retained', () => {
    for (const awb of ['006 4550 4454', '006-4550-4454', '00645504454']) {
      assert.equal(parseAwbFields({ text: awb + ' EXCEL TRANSPORT air waybill freight document' }).awb, '006-45504454');
    }
    assert.equal(parseAwbFields({ text: 'FREIGHTWISE ECUADOR air waybill freight document' }).company, 'Freightwise Ecuador');
    assert.equal(parseAwbFields({ text: 'FREIGHTWISE air waybill freight document' }).company, 'FREIGHTWISE');
    assert.equal(parseAwbFields({ text: 'LA ROSALEDA ECUADOR air waybill freight document' }).company, 'Freightwise Ecuador');
  });
  check('scanned input reports existing manual-entry error shape', () => {
    assert.deepEqual(Object.keys(parseAwbFields({ text: '', items: [] })), ['_error']);
    assert.ok(parseAwbFields(null)._error);
    assert.ok(parseAwbFields({ pages: [null] })._error);
  });
  const file = path.resolve(__dirname, '../output/drive-samples/40-2차 ECUA AWB 006-45504454.pdf');
  if (fs.existsSync(file)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const c = await (await pdf.getPage(n)).getTextContent();
      const items = c.items.map(i => ({ str: i.str, x: i.transform[4], y: Math.round(i.transform[5]), width: i.width }));
      pages.push({ text: c.items.map(i => i.str).join(' '), items });
    }
    check('actual local AWB, rounded-y main-reader contract (read-only)', () => {
      const input = { text: pages.map(p => p.text).join('\n'), items: pages[0].items, pages };
      const before = JSON.stringify(input);
      assert.deepEqual(parseAwbFields(input), { awb: '006-45504454', company: 'Apollo', gw: 303, cw: 380, uPrice1: 3.37, total: 1379.6, date: '2026/10/01' });
      assert.equal(JSON.stringify(input), before);
    });
    await pdf.destroy();
  } else console.log('SKIP actual PDF (local sample not present)');
  console.log(`${passed} AWB checks passed`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
