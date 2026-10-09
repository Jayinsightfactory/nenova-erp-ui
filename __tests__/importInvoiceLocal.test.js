const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Synthetic known-layout fixture; arbitrary amounts, IDs and dates demonstrate
// that neither the success criterion nor the extracted values are sample-specific.
function fixture() {
  const pages = [{ items: [] }, { items: [] }];
  const add = (p, y, cells) => pages[p].items.push(...cells.map(([x, str]) => ({ x, y, str, width: Math.min(str.length * 3, 80) })));
  for (let p = 0; p < 2; p++) {
    add(p, 790, [[18, 'HOLEX FLOWER B.V.']]);
    add(p, 80, [[420, `777 - Nenova Co. Ltd. - Page ${p + 1} of 2`]]);
  }
  add(0, 740, [[18, 'Invoicenumber'], [120, '777']]);
  add(0, 720, [[18, 'Date'], [120, '01 maart 2025']]);
  add(0, 700, [[18, 'Currency'], [120, 'EUR']]);
  add(0, 680, [[18, 'Shipmentnumber'], [120, 'Airwaybillnumber'], [240, 'Arrivaldate']]);
  add(0, 666, [[18, 'KE999'], [120, '180-1111-2222'], [240, '03 maart 2025']]);
  add(0, 640, [[18, 'Order 123 - CL 7']]);
  add(0, 620, [[18, 'Boxes'], [102, 'Packing'], [150, 'Box'], [188, 'Amount'], [275, 'Org'], [294, 'Item'], [493, 'Price'], [546, 'Total']]);
  add(0, 600, [[18, '123.1.1-1'], [104, '1 x 30'], [150, 'H3'], [207, '20'], [246, '(20 st)'], [278, 'NL'], [294, 'ROSE RED 60cm'], [494, '0,25'], [540, '5,00']]);
  // Blank Boxes/Packing cells are valid continuation products (not consolidation).
  add(1, 740, [[150, 'H3'], [207, '10'], [246, '(10 st)'], [278, 'NL'], [294, 'ROSE WHITE'], [494, '0,50'], [540, '5,00']]);
  add(1, 730, [[294, '70cm']]);
  add(1, 700, [[240, 'Subtotal Order 123'], [540, '10,00']]);
  add(1, 680, [[212, '1'], [294, 'Vracht 12 Kg'], [489, '2,00'], [540, '2,00']]);
  add(1, 660, [[212, '1'], [294, 'Handling'], [489, '1,00'], [540, '1,00']]);
  add(1, 630, [[240, 'Total (EUR)'], [530, '13,00']]);
  add(1, 600, [[18, 'CBS']]);
  add(1, 580, [[18, 'Name'], [146, 'Number'], [184, 'Countrycode'], [253, 'Units'], [306, 'Total'], [342, 'Weight']]);
  add(1, 560, [[18, 'Total'], [248, '30'], [300, '10'], [344, '9']]);
  add(1, 530, [[18, 'Weight & Colli']]);
  add(1, 510, [[18, 'Volume Weight'], [120, '12.00 kg']]);
  add(1, 490, [[18, 'Gross Weight'], [120, '9.50 kg']]);
  add(1, 470, [[18, 'Total colli'], [120, '1']]);
  for (const p of pages) p.text = p.items.map(i => i.str).join(' ');
  return { text: pages.map(p => p.text).join('\n'), items: pages[0].items, pages };
}

async function main() {
  const { parseInvoiceLocal, inspectInvoiceLocal } = await import('../lib/importInvoiceLocal.js');
  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
  const reject = input => { const r = inspectInvoiceLocal(input); assert.equal(r.result, null); assert.ok(r.reason); return r.reason; };
  const replace = (f, from, to) => { for (const p of f.pages) for (const i of p.items) if (i.str === from) i.str = to; return f; };
  const remove = (f, str) => { for (const p of f.pages) p.items = p.items.filter(i => i.str !== str); return f; };
  check('exact invoices JSON and cross-page CL inheritance', () => {
    const f = fixture(), before = JSON.stringify(f);
    assert.deepEqual(parseInvoiceLocal(f), { invoices: [{ invoice: '777', supplier: 'Holex', awb: '180-1111-2222', date: '2025/03/03', raw_date: '03 maart 2025', date_kind: 'arrival', date_order: 'DMY', currency: 'EUR', vol_weight: 12, gross_weight: 9.5, total_colli: 1, freight: 2, handling: 1, total_value: 13, lines: [
      { cl: 'CL7', description: 'ROSE RED 60cm', stems: 20, price: 0.25 },
      { cl: 'CL7', description: 'ROSE WHITE 70cm', stems: 10, price: 0.5 },
    ] }] });
    assert.equal(JSON.stringify(f), before);
  });
  check('raw pdfjs item transforms accepted', () => {
    const f = fixture(); for (const p of f.pages) p.items = p.items.map(({ x, y, ...i }) => ({ ...i, transform: [1, 0, 0, 1, x, y] }));
    assert.ok(parseInvoiceLocal(f));
  });
  check('missing page, duplicated page and reordered pages rejected', () => {
    for (const pages of [[fixture().pages[0]], [fixture().pages[1]], [fixture().pages[0], fixture().pages[0]], fixture().pages.reverse()]) reject({ pages });
  });
  check('unknown layout, country and scans rejected with reason', () => {
    reject(replace(fixture(), 'HOLEX FLOWER B.V.', 'EZ Flower B.V.'));
    assert.equal(inspectInvoiceLocal(fixture(), { country: 'CO' }).reason, 'UNSUPPORTED_COUNTRY');
    reject({ text: 'HOLEX FLOWER B.V. scanned invoice', items: [] });
    reject(null);
    reject({ pages: [null] }); reject({ items: true });
  });
  check('missing or invalid invoice and arrival dates rejected (no clock default)', () => {
    reject(remove(fixture(), '03 maart 2025'));
    reject(replace(fixture(), '03 maart 2025', '31 februari 2025'));
    reject(replace(fixture(), '01 maart 2025', '29 februari 2025'));
    reject(replace(fixture(), '03 maart 2025', '03/04/2025'));
  });
  check('header invoice conflict, currency and AWB malformed rejected', () => {
    reject(replace(fixture(), '777', '778'));
    reject(replace(fixture(), 'EUR', 'USD'));
    reject(replace(fixture(), '180-1111-2222', '123'));
  });
  check('missing or conflicting grand total rejected', () => {
    reject(remove(fixture(), 'Total (EUR)'));
    reject(replace(fixture(), '13,00', '13,01'));
    const f = fixture(); f.pages[1].items.push({ str: 'Total (EUR)', x: 240, y: 620 }, { str: '13,00', x: 530, y: 620 }); reject(f);
  });
  check('line amount, price, stems and missing description rejected', () => {
    reject(replace(fixture(), '0,25', '0,26'));
    reject(replace(fixture(), '(20 st)', '(21 st)'));
    reject(remove(fixture(), 'ROSE RED 60cm'));
    reject(remove(fixture(), '(20 st)'));
    reject(remove(fixture(), '0,25'));
  });
  check('missing/mismatched order subtotal and CBS totals rejected', () => {
    reject(remove(fixture(), 'Subtotal Order 123'));
    reject(replace(fixture(), '10,00', '9,99'));
    reject(replace(fixture(), '30', '31'));
    reject(remove(fixture(), 'CBS'));
  });
  check('right-aligned CBS units are identified by column center, not left edge', () => {
    const f = fixture();
    const units = f.pages[1].items.find(i => i.str === '30');
    units.x = 242.9; units.width = 28;
    const total = f.pages[1].items.find(i => i.y === 560 && i.str === '10');
    total.x = 297.7; total.width = 28;
    assert.equal(inspectInvoiceLocal(f).reason, null);
    assert.equal(parseInvoiceLocal(f).invoices[0].lines.reduce((sum, line) => sum + line.stems, 0), 30);
    const missing = structuredClone(f);
    missing.pages[1].items = missing.pages[1].items.filter(i => !(i.y === 560 && i.str === '30'));
    missing.pages[1].items.find(i => i.y === 560 && i.str === '10').str = '30';
    assert.equal(reject(missing), 'CBS_UNITS_MISSING');
    const duplicate = structuredClone(f);
    duplicate.pages[1].items.push({ str: '30', x: 258, y: 560, width: 12 });
    assert.equal(reject(duplicate), 'CBS_UNITS_MISSING');
    const mismatch = structuredClone(f);
    mismatch.pages[1].items.find(i => i.y === 560 && i.str === '30').str = '31';
    assert.equal(reject(mismatch), 'MISSING_OR_MISMATCHED_INDEPENDENT_TOTALS');
    const negative = structuredClone(f);
    negative.pages[1].items.find(i => i.y === 560 && i.str === '30').str = '-30';
    assert.equal(reject(negative), 'MISSING_OR_MISMATCHED_INDEPENDENT_TOTALS');
    const duplicateTotal = structuredClone(f);
    duplicateTotal.pages[1].items.push(...duplicateTotal.pages[1].items.filter(i => i.y === 560).map(i => ({ ...i, y: 550 })));
    assert.equal(reject(duplicateTotal), 'CBS_TOTAL_AMBIGUOUS');
  });
  check('charges independently reconcile; unknown and duplicate charges rejected', () => {
    reject(replace(fixture(), 'Handling', 'Unrecognized charge'));
    reject(remove(fixture(), 'Handling'));
    reject(replace(fixture(), '2,00', '2,01'));
    const f = fixture(); f.pages[1].items.push(...f.pages[1].items.filter(i => i.y === 660).map(i => ({ ...i, y: 650 }))); reject(f);
  });
  check('optional absent freight/handling only accepted if grand reconciles', () => {
    const f = fixture(); f.pages[1].items = f.pages[1].items.filter(i => i.y !== 680 && i.y !== 660);
    replace(f, '13,00', '10,00'); const r = parseInvoiceLocal(f); assert.ok(r); assert.equal(r.invoices[0].freight, 0); assert.equal(r.invoices[0].handling, 0);
  });
  check('weights/colli and ambiguous continuation rejected', () => {
    reject(remove(fixture(), 'Volume Weight'));
    reject(replace(fixture(), '9.50 kg', '-9.50 kg'));
    const f = fixture(); f.pages[1].items.find(i => i.str === '70cm').y = 714; reject(f);
  });
  check('onReject reports reason and returns null, never partial invoices', () => {
    let reason; const result = parseInvoiceLocal({ items: [] }, { onReject: r => { reason = r; } });
    assert.equal(result, null); assert.ok(reason);
  });
  const file = path.resolve(__dirname, '../output/drive-samples/40-2 NL H CI.pdf');
  if (fs.existsSync(file)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const c = await (await pdf.getPage(n)).getTextContent();
      pages.push({ text: c.items.map(i => i.str).join(' '), items: c.items.map(i => ({ str: i.str, x: i.transform[4], y: Math.round(i.transform[5]), width: i.width })) });
    }
    const input = { text: pages.map(p => p.text).join('\n'), items: pages[0].items, pages };
    check('actual 5-page Holex PDF, rounded-y main-reader contract (read-only)', () => {
      const report = inspectInvoiceLocal(input); assert.equal(report.reason, null);
      const inv = report.result.invoices[0];
      assert.equal(inv.invoice, '1212437'); assert.equal(inv.date, '2026/10/04'); assert.equal(inv.awb, '180-9160-1893');
      assert.equal(inv.lines.length, 90); assert.equal(inv.lines.reduce((s, l) => s + l.stems, 0), 7589);
      assert.equal(inv.lines.reduce((s, l) => s + l.stems * Math.round(l.price * 100), 0), 1112194);
      assert.equal(inv.freight, 3261.1); assert.equal(inv.handling, 50); assert.equal(inv.total_value, 14433.04);
      assert.equal(inv.vol_weight, 1222); assert.equal(inv.gross_weight, 1098.5); assert.equal(inv.total_colli, 107);
      const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'nl-ai-response.json'), 'utf8'));
      const expected = JSON.parse(saved.content[0].text.replace(/^```json\s*|\s*```$/g, '')).invoices[0];
      assert.deepEqual(Object.keys(inv).filter(key => !['raw_date', 'date_kind', 'date_order', 'currency'].includes(key)).sort(), Object.keys(expected).sort());
      assert.equal(inv.currency, 'EUR');
      assert.equal(inv.date_kind, 'arrival');
      assert.ok(inv.raw_date);
      assert.deepEqual(Object.keys(inv.lines[0]).sort(), Object.keys(expected.lines[0]).sort());
      console.log(`INFO saved AI sample: ${expected.lines.length} rows / ${expected.lines.reduce((s, l) => s + l.stems, 0)} stems; local PDF: ${inv.lines.length} rows / ${inv.lines.reduce((s, l) => s + l.stems, 0)} stems`);
    });
    check('actual missing interior/last page and malformed total rejected', () => {
      reject({ pages: pages.filter((_, i) => i !== 2) }); reject({ pages: pages.slice(0, -1) });
      reject(replace(structuredClone(input), '14.433,04', '14.433,05'));
    });
    await pdf.destroy();
  } else console.log('SKIP actual PDF (local sample not present)');
  const shiftedFile = path.resolve(__dirname, '../outputs/drive-other-country-audit/mubyilch-41ebd8.pdf');
  if (fs.existsSync(shiftedFile)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(shiftedFile)), useSystemFonts: true }).promise;
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const c = await (await pdf.getPage(n)).getTextContent();
        pages.push({ items: c.items.map(i => ({ str: i.str, x: i.transform[4], y: Math.round(i.transform[5]), width: i.width })) });
      }
      check('actual 4-page Holex PDF with shifted CBS units (read-only)', () => {
        assert.equal(pages.length, 4);
        const report = inspectInvoiceLocal({ pages });
        assert.equal(report.reason, null);
        const inv = report.result.invoices[0];
        assert.equal(inv.invoice, '1180208');
        assert.equal(inv.lines.reduce((sum, line) => sum + line.stems, 0), 10027);
        assert.equal(inv.lines.reduce((sum, line) => sum + line.stems * Math.round(line.price * 100), 0), 1091843);
        assert.equal(inv.freight, 2159.94); assert.equal(inv.handling, 50); assert.equal(inv.total_value, 13128.37);
        assert.equal(inv.gross_weight, 714.2); assert.equal(inv.vol_weight, 795);
      });
    } finally { await pdf.destroy(); }
  } else console.log('SKIP actual shifted PDF (private local sample not present; anonymous regression remains mandatory)');
  console.log(`${passed} invoice checks passed`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
