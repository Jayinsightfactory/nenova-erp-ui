import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { generatePedidos, readPedidosWorkbook, serializePedidosWorkbook, sanitizePedidosWeek, calculateEcuadorBoxes } from '../lib/importPedidos.js';

// Synthetic fixtures are local, non-live examples of the static Python contract.
// Colombia and the current China exporter also have optional local real samples.
function fixture(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Source'); return wb;
}
const sheet = output => output.workbook.Sheets[output.workbook.SheetNames[0]];
function xml(bytes, path) {
  const zip = XLSX.CFB.read(bytes, { type: 'array' });
  return new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip, `/${path}`).content));
}

const samplePath = new URL('../output/import-tool-sources/발주 목록_2026-09-07.xlsx', import.meta.url);
test('actual Colombia sample: 80 items, 1010 initial quantity, original Clavel layout', { skip: !fs.existsSync(samplePath) }, () => {
  const input = fs.readFileSync(samplePath);
  const wb = readPedidosWorkbook(input);
  const before = JSON.stringify(wb);
  const outputs = generatePedidos(wb, 'Colombia', 'W');
  assert.equal(outputs.length, 1);
  const out = outputs[0], ws = sheet(out);
  assert.equal(out.filename, 'W_Clavel.xlsx');
  assert.deepEqual(out.workbook.SheetNames, ['Clavel W차']);
  assert.equal(out.itemCount, 80); assert.equal(out.totalQuantity, 1010);
  assert.equal(ws.A1.v, 'Clavel - Pedido Colombia  |  Semana W차');
  assert.equal(ws.B4.t, 'n'); assert.equal(ws.C4.v, undefined);
  assert.equal(ws.D4.f, 'B4+C4'); assert.equal(ws.D4.v, ws.B4.v);
  assert.equal(ws.B84.f, 'SUM(B4:B83)'); assert.equal(ws.B84.v, 1010);
  assert.equal(ws.C84.f, 'SUM(C4:C83)'); assert.equal(ws.C84.v, 0);
  assert.equal(ws['!cols'][0].width, 52); assert.equal(ws['!rows'][0].hpt, 28);
  assert.equal(ws.A5.s.fill.fgColor.rgb, 'D6E4F0');
  assert.equal(ws.A3.s.font.name, 'Arial'); assert.equal(ws.A3.s.font.sz, 11);
  assert.equal(ws.A3.s.border.left.color.rgb, 'B4C7E7');
  assert.equal(out.preview.rows.length, 80);
  assert.equal(JSON.stringify(wb), before, 'input is not mutated');
  const bytes = serializePedidosWorkbook(out.workbook);
  const reread = readPedidosWorkbook(bytes), saved = reread.Sheets[reread.SheetNames[0]];
  assert.equal(saved.B84.v, 1010); assert.equal(saved.D4.f, 'B4+C4');
  assert.match(xml(bytes, 'xl/styles.xml'), /D6E4F0/);
  assert.match(xml(bytes, 'xl/workbook.xml'), /fullCalcOnLoad="1"/);
});

test('checked-in minimal Colombia fixture preserves all 80 sample products and quantities', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/importPedidosColombia.json', import.meta.url), 'utf8'));
  const wb = fixture(golden.rows), out = generatePedidos(wb, 'Colombia', 'W')[0];
  assert.equal(out.itemCount, golden.expectedItems); assert.equal(out.totalQuantity, golden.expectedQuantity);
  const expected = golden.rows.filter(row => typeof row[6] === 'string' && !row[6].endsWith('Total') && typeof row[8] === 'number').map(row => [row[6], row[8]]);
  assert.equal(expected.length, 80);
  assert.deepEqual(out.preview.rows.map(row => [row[0], row[1]]).sort(), expected.sort());
  if (fs.existsSync(samplePath)) {
    const actual = generatePedidos(readPedidosWorkbook(fs.readFileSync(samplePath)), 'Colombia', 'W')[0];
    assert.deepEqual(out.preview, actual.preview);
  }
});

test('Colombia: category order, continuation, all conversions, MiniCarnation last, negative style', () => {
  const wb = fixture([
    ['header', null, null, null, null, null, null, 'Grand Total'],
    ['콜롬비아', null, '장미', null, null, 'ROSE A', null, 2],
    [null, null, null, null, null, null, null, 3],
    [null, null, '카네이션', null, null, 'MiniCarnation A', null, 1],
    [null, null, null, null, null, 'CARNATION Z', null, -2],
    [null, null, '알스트로', null, null, 'ALSTROMERIA A', null, 16],
    [null, null, '루스커스', null, null, 'Ruscus A', null, 8],
    [null, null, '수국', null, null, 'Hydrangea A', null, 9],
    ['콜롬비아 Total'],
  ]);
  const out = generatePedidos(wb, 'Colombia', '34-1');
  assert.deepEqual(out.map(o => o.filename), ['34-1_Rosas.xlsx', '34-1_Clavel.xlsx', '34-1_Alstromeria.xlsx', '34-1_Ruscus.xlsx', '34-1_Hortensias.xlsx']);
  assert.equal(sheet(out[0]).B4.v, 5); assert.equal(sheet(out[0]).E4.f, 'D4*10'); assert.equal(sheet(out[0]).E4.v, 50);
  assert.equal(sheet(out[1]).A4.v, 'CARNATION Z'); assert.equal(sheet(out[1]).A5.v, 'MiniCarnation A');
  assert.equal(sheet(out[1]).B4.s.font.color.rgb, 'C00000');
  assert.equal(sheet(out[2]).E4.f, 'D4/16'); assert.equal(sheet(out[2]).E4.v, 1);
  assert.equal(sheet(out[3]).D4.f, 'B4+C4'); assert.equal(sheet(out[4]).D4.v, 9);
});

test('Netherlands: CL totals precedence, repeated raw sums, multipliers, split, duplicate overwrite, B4 freeze', () => {
  const wb = fixture([
    ['country header'], ['name', 'CL2', 'CL2', 'CL1', 'CL1 Total'],
    ['Tulip hyacinth', 1, 2, 99, 4], ['[EZ] Hyacinth A', 0, 1, 99, 2],
    ['Skimmia A', -1, 0, 99, 0], ['Eucalyptus A', 1, 0, 99, 0],
    ['Skimmia A', -2, 0, 99, 0], ['Grand Total', 999], ['After total Tulip', 999, 0, 0, 0],
  ]);
  const outputs = generatePedidos(wb, 'Netherlands', 'W');
  assert.deepEqual(outputs.map(o => o.filename), ['W_Holex.xlsx', 'W_EZ.xlsx']);
  assert.deepEqual(outputs[0].cls, ['CL1', 'CL2']);
  assert.equal(sheet(outputs[0]).B4.v, 40); assert.equal(sheet(outputs[0]).C4.v, 30);
  assert.equal(sheet(outputs[0]).D4.f, 'SUM(B4:C4)');
  assert.equal(outputs[0].totalQuantity, 67); assert.equal(outputs[1].totalQuantity, 15);
  assert.equal(sheet(outputs[0]).C5.s.font.color.rgb, 'C00000');
  const bytes = serializePedidosWorkbook(outputs[0].workbook);
  assert.match(xml(bytes, 'xl/worksheets/sheet1.xml'), /xSplit="1" ySplit="3" topLeftCell="B4"/);
});

test('Netherlands marker layout does not aggregate continuation CL rows; zero rows omitted', () => {
  const wb = fixture([['header', null, null, null, null, null, 'CL1'],
    ['네덜란드', null, '튤립', null, null, 'Tulip A', 2],
    [null, null, null, null, null, null, 50],
    [null, null, null, null, null, '[EZ] Lily', 0], ['네덜란드 Total']]);
  const outputs = generatePedidos(wb, 'Netherlands', 'W');
  assert.equal(outputs.length, 1); assert.equal(outputs[0].totalQuantity, 20);
});

test('Ecuador: sequential half-box pairing, display reordering, merged boxes, odd and 50 remainder', () => {
  const products = [['Rose A', 300], ['Rose B', 200], ['Rose C', 100], ['Rose D', 100], ['Rose E', 50]];
  assert.deepEqual(calculateEcuadorBoxes(products).order, [0, 2, 1, 3, 4]);
  const out = generatePedidos(fixture([['name', 'Grand Total'], ...products]), 'Ecuador', 'W')[0], ws = sheet(out);
  assert.equal(out.totalQuantity, 750); assert.equal(out.totalBoxes, 4);
  assert.equal(ws.A5.v, 'Rose C'); assert.equal(ws.C4.v, 2); assert.equal(ws.C5.v, undefined);
  assert.ok(ws['!merges'].some(m => m.s.r === 3 && m.e.r === 4 && m.s.c === 2));
  assert.equal(ws.B9.f, 'SUM(B4:B8)'); assert.equal(ws.C9.v, 4);
  assert.equal(calculateEcuadorBoxes([['Rose negative', -100]]).totalBoxes, 0);
});

test('Ecuador marker chooses first numeric fallback, not numeric strings', () => {
  const wb = fixture([['header', null, null, null, null, null, null, 'Grand Total'],
    ['에콰도르', null, '장미', null, null, 'Rose A', 300, 'text'], ['에콰도르 Total']]);
  assert.equal(generatePedidos(wb, 'Ecuador', 'W')[0].totalQuantity, 300);
});

test('Australia exact box lookup and unknown first-word prefix: blank box with warning', () => {
  const out = generatePedidos(fixture([['name', 'Grand Total'], ['Fern Umbrella', 100], ['Wolly Bush Green Tip', 60], ['Fern Unknown', 5], ['Unknown', 99], ['Grand Total']]), 'Australia', 'W')[0];
  assert.equal(out.itemCount, 3); assert.equal(sheet(out).C4.f, 'B4/50'); assert.equal(sheet(out).C5.f, 'B5/30');
  assert.equal(sheet(out).C6.v, undefined); assert.equal(out.warnings.length, 1);
  assert.equal(sheet(out).C7.v, 4);
});

test('Thailand simple prefixes and marker column-6 preference', () => {
  const out = generatePedidos(fixture([['name', 'Grand Total'], ['Den. A', 2], ['MOK A', 3], ['ARAN A', 4], ['Oncidium A', 5], ['Other', 99]]), 'Thailand', 'W')[0];
  assert.equal(out.itemCount, 4); assert.equal(out.totalQuantity, 14); assert.equal(sheet(out).B8.f, 'SUM(B4:B7)');
  const marked = fixture([['header', null, null, null, null, null, null, 'Grand Total'], ['태국', null, '꽃', null, null, 'ignored', 'Den. A', 8], ['태국 Total']]);
  assert.equal(generatePedidos(marked, 'Thailand', 'W')[0].totalQuantity, 8);
});

test('China intended CL name-to-column mapping, first raw, total precedence, duplicate overwrite; no multiplier', () => {
  const wb = fixture([['header', null, null, null, null, null, 'CL1', 'CL1', 'CL2', 'CL2 Total'],
    ['중국', null, 'MEL Tulip A', null, null, null, 2, 99, 99, 3],
    [null, null, 'MEL Tulip A', null, null, null, 4, 99, 99, 5], ['중국 Total']]);
  const out = generatePedidos(wb, 'China', 'W')[0];
  assert.equal(out.filename, 'W_Melody.xlsx'); assert.equal(out.itemCount, 1); assert.equal(out.totalQuantity, 9);
  assert.equal(sheet(out).B4.v, 4); assert.equal(sheet(out).C4.v, 5);
});

test('Vietnam marker-only, stems/16, no-marker explicit empty summary', () => {
  const wb = fixture([['header', null, null, null, null, null, 'Grand Total'], ['베트남', null, '꽃', null, null, 'Royal A', 32], ['베트남 Total']]);
  const out = generatePedidos(wb, 'Vietnam', 'W')[0];
  assert.equal(out.filename, 'W_Royal_base.xlsx'); assert.equal(out.workbook.SheetNames[0], 'Royal base W');
  assert.equal(sheet(out).C4.f, 'B4/16'); assert.equal(sheet(out).C4.v, 2);
  const empty = generatePedidos(fixture([['Royal A', 32]]), 'Vietnam', 'W')[0];
  assert.equal(empty.itemCount, 0); assert.equal(empty.totalQuantity, 0); assert.deepEqual(empty.preview.rows, []);
});

test('typed numeric quantities and formula caches: cached numeric accepted, absent/string/error blocked', () => {
  const wb = fixture([['name', 'Grand Total'], ['Den. A', 0], ['Den. B', '4']]);
  wb.Sheets.Source.B2 = { t: 'n', f: '2+3', v: 5 };
  assert.throws(() => generatePedidos(wb, 'Thailand', 'W'), /Source!B3.*숫자형/);
  wb.Sheets.Source.B3 = { t: 'n', v: 0 };
  const out = generatePedidos(wb, 'Thailand', 'W')[0];
  assert.equal(out.totalQuantity, 5); assert.equal(out.warnings.length, 0);
  for (const cell of [{ t: 'n', f: '2+3' }, { t: 's', f: '2+3', v: '5' }, { t: 'e', f: '1/0', v: 7 }]) {
    wb.Sheets.Source.B2 = cell; assert.throws(() => generatePedidos(wb, 'Thailand', 'W'), /Source!B2.*계산값/);
  }
  wb.Sheets.Source.B2 = { t: 'n', f: '1-1', v: 0 };
  assert.equal(generatePedidos(wb, 'Thailand', 'W')[0].totalQuantity, 0);
});

test('active sheet metadata survives actual OOXML read; missing metadata selects first sheet', () => {
  const wb = fixture([['name', 'Grand Total'], ['Den. first', 1]]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'Grand Total'], ['Den. active', 8]]), 'Active');
  assert.equal(generatePedidos(wb, 'Thailand', 'W')[0].totalQuantity, 1);
  wb.Workbook = { Views: [{ activeTab: 1 }] };
  assert.equal(generatePedidos(wb, 'Thailand', 'W')[0].sourceSheet, 'Active');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const content = new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip, '/xl/workbook.xml').content));
  const changed = content.replace(/<bookViews>[\s\S]*?<\/bookViews>/, '').replace('<sheets>', '<bookViews><workbookView activeTab="1"/></bookViews><sheets>');
  XLSX.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(changed));
  const read = readPedidosWorkbook(new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' })));
  assert.equal(generatePedidos(read, 'Thailand', 'W')[0].totalQuantity, 8);
});

test('week sanitization and invalid country/long sheet name are explicit; no SQL/network/storage imports', () => {
  assert.equal(sanitizePedidosWeek(' 34 / 1차_! '), '341차_'); assert.throws(() => sanitizePedidosWeek(' /! '));
  assert.throws(() => generatePedidos(fixture([]), 'Other', 'W'));
  assert.throws(() => generatePedidos(fixture([['name', 'Grand Total'], ['Den. A', 1]]), 'Thailand', 'W'.repeat(40)), /너무 깁니다/);
  for (const path of ['../lib/importPedidos.js', '../components/import-tools/PedidosTool.js']) {
    const text = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bfetch\s*\(|\baxios\b|localStorage|\/api\/|from ['"].*\/db['"]|child_process/);
  }
});

test('last suffix Total fallback, source header-index-zero quirk, and empty category workbook retained', () => {
  const thai = fixture([['name', 'Earlier Total', 'Last Total'], ['Den. A', 100, 7]]);
  assert.equal(generatePedidos(thai, 'Thailand', 'W')[0].totalQuantity, 7);
  const nl = fixture([['name', 'CL1'], ['Lily skipped', 99], [], [], ['Lily kept', 3]]);
  assert.equal(generatePedidos(nl, 'Netherlands', 'W')[0].totalQuantity, 3);
  const col = fixture([['header', null, null, null, null, null, null, 'Grand Total'],
    ['콜롬비아', null, '장미'], [null, null, '카네이션', null, null, 'CARNATION A', null, 1], ['콜롬비아 Total']]);
  const outputs = generatePedidos(col, 'Colombia', 'W');
  assert.equal(outputs.length, 2); assert.equal(outputs[0].filename, 'W_Rosas.xlsx'); assert.equal(outputs[0].itemCount, 0);
});

test('missing formula caches are blocked across CL, continuation and fallback parsers', () => {
  const fixtures = [
    ['Colombia', fixture([['header', null, null, null, null, null, null, 'Grand Total'], ['콜롬비아', null, '장미', null, null, 'ROSE A', null, 1], [null, null, null, null, null, null, null, 2]]), 'H3'],
    ['Netherlands', fixture([[], ['name', 'CL1'], ['Tulip A', 1]]), 'B3'],
    ['China', fixture([['header', null, null, 'CL1'], [null, null, 'MEL A', 1]]), 'D2'],
    ['Ecuador', fixture([['header', null, null, null, null, null, null, 'Grand Total'], ['에콰도르', null, null, null, null, 'Rose A', 300, 1]]), 'H2'],
    ['Australia', fixture([['name', 'Grand Total'], ['Fern Umbrella', 1]]), 'B2'],
    ['Vietnam', fixture([['header', null, null, null, null, null, 'Grand Total'], ['베트남', null, null, null, null, 'Royal A', 1]]), 'G2'],
  ];
  for (const [country, wb, addr] of fixtures) {
    wb.Sheets.Source[addr] = { t: 'n', f: '1+1' };
    assert.throws(() => generatePedidos(wb, country, 'W'), /계산값/, country);
  }
});

test('legacy xls read uses existing SheetJS parser, without Python runtime', () => {
  const wb = fixture([['name', 'Grand Total'], ['Den. A', 12]]);
  const input = XLSX.write(wb, { type: 'array', bookType: 'biff8' });
  assert.equal(generatePedidos(readPedidosWorkbook(input), 'Thailand', 'W')[0].totalQuantity, 12);
});

const chinaGolden = JSON.parse(fs.readFileSync(new URL('./fixtures/importPedidosChinaMatrix.json', import.meta.url), 'utf8'));
function chinaFixture(names = Object.keys(chinaGolden.sheets)) {
  const wb = XLSX.utils.book_new();
  for (const name of names) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chinaGolden.sheets[name]), name);
  return wb;
}
const chinaOutput = (wb, year = 2026) => generatePedidos(wb, 'China', '42-01', { year });

test('current China numeric matrix: IDs, duplicate codes/names, zero products, ignored box blanks and immutable input', () => {
  const wb = chinaFixture(), before = JSON.stringify(wb), out = chinaOutput(wb)[0];
  assert.equal(out.sourceSheet, '수량원본'); assert.equal(out.sourceAdapter, 'china-numeric-v1');
  assert.equal(out.sourceScope, '2026/42-1'); assert.equal(out.filename, '42-01_Melody.xlsx');
  assert.equal(out.itemCount, chinaGolden.expectedItems); assert.equal(out.totalQuantity, chinaGolden.expectedQuantity);
  assert.equal(out.unit, 'bunches'); assert.equal(out.sourceUnit, '단');
  assert.deepEqual(out.products.map(p => p.prodKey), ['2358', '2329', '3404']);
  assert.ok(out.preview.rows[0][0].includes('ProdKey:2358')); assert.ok(out.preview.rows[1][0].includes('ProdKey:2329'));
  const firstK = out.preview.headers.indexOf('K01 [CustKey:565]'), secondK = out.preview.headers.indexOf('K01 [CustKey:689]');
  assert.ok(firstK > 0 && secondK > 0 && firstK !== secondK);
  assert.equal(out.preview.rows.reduce((s, row) => s + (row[firstK] ?? 0), 0), 40);
  assert.equal(out.preview.rows.reduce((s, row) => s + (row[secondK] ?? 0), 0), 30);
  assert.equal(out.preview.rows[2].at(-1), 0); assert.equal(out.warnings.length, 0);
  assert.equal(JSON.stringify(wb), before);
  const reread = readPedidosWorkbook(serializePedidosWorkbook(out.workbook));
  assert.equal(reread.Sheets['Melody 42-01'].F7.v, 80);
});

test('China structured detail and customer numeric fallbacks preserve totals; repeated details aggregate', () => {
  for (const name of ['주문상세', '업체별발주']) {
    const out = chinaOutput(chinaFixture([name]))[0];
    assert.equal(out.totalQuantity, 80); assert.equal(out.itemCount, 2); assert.equal(out.sourceSheet, name);
    assert.equal(out.customers.filter(c => c.code === 'K01').length, 2);
  }
  const wb = chinaFixture(['주문상세']);
  XLSX.utils.sheet_add_aoa(wb.Sheets['주문상세'], [chinaGolden.sheets['주문상세'][1]], { origin: -1 });
  assert.equal(chinaOutput(wb)[0].totalQuantity, 100);
});

test('China numeric all-zero, cancelling totals, empty structured and legacy blank cells remain serializable', () => {
  const wb = chinaFixture();
  for (let r = 2; r <= 5; r++) wb.Sheets['주문상세'][`K${r}`] = { t: 'n', v: 0 };
  for (let r = 2; r <= 4; r++) for (const col of ['D', 'F', 'G', 'H', 'I']) wb.Sheets['수량원본'][`${col}${r}`] = { t: 'n', v: 0 };
  const out = chinaOutput(wb)[0];
  assert.equal(out.itemCount, 3); assert.equal(out.totalQuantity, 0);
  assert.ok(serializePedidosWorkbook(out.workbook).length > 0);
  const detail = chinaFixture(['주문상세']);
  detail.Sheets['주문상세'].K2.v = -60;
  assert.equal(chinaOutput(detail)[0].totalQuantity, 0, 'nonzero rows that cancel are legitimate zero totals');
  const empty = fixture([chinaGolden.sheets['주문상세'][0]]);
  empty.Sheets['주문상세'] = empty.Sheets.Source; empty.SheetNames = ['주문상세']; delete empty.Sheets.Source;
  assert.equal(chinaOutput(empty)[0].itemCount, 0);
  const legacy = generatePedidos(fixture([['header', null, null, 'CL1'], [null, null, 'MEL Zero', 0], [null, null, 'MEL Blank']]), 'China', 'W')[0];
  assert.equal(legacy.itemCount, 2); assert.equal(legacy.totalQuantity, 0);
  assert.equal(sheet(legacy).B4.f, '0', 'zero-only legacy has no self-referencing total formula');
  assert.ok(serializePedidosWorkbook(legacy.workbook).length > 0);
});

test('China malformed/missing numeric sources fail actionably, never fall back to display text or silently zero', () => {
  const cases = [
    [wb => { delete wb.Sheets['수량원본'].F2; }, /수량원본!F2.*숫자형/],
    [wb => { wb.Sheets['수량원본'].G2 = { t: 's', v: '20(—)' }; }, /수량원본!G2.*숫자형/],
    [wb => { wb.Sheets['수량원본'].D1.v = 'Missing'; }, /수량원본.*열/],
    [wb => { wb.Sheets['수량원본'].F1.v = 'Missing'; }, /수량원본.*열.*누락/],
    [wb => { wb.Sheets['수량원본'].G1.v = '515 원수량'; }, /원수량 열.*중복/],
    [wb => { wb.Sheets['주문상세'].K1.v = 'Missing'; }, /주문상세.*열/],
    [wb => { wb.Sheets['주문상세'].K2 = { t: 's', v: '20' }; }, /주문상세!K2.*숫자형/],
    [wb => { wb.Sheets['수량원본'].D2 = { t: 'n', f: 'SUM(F2:I2)' }; }, /수량원본!D2.*계산값/],
    [wb => { wb.Sheets['수량원본'].G2 = { t: 'e', v: 7 }; }, /수량원본!G2.*Excel 오류/],
    [wb => { wb.Sheets['수량원본'].G2.v = 19; }, /일치하지/],
    [wb => { wb.Sheets['수량원본'].D2.v = 99; }, /총수량.*일치하지/],
    [wb => { wb.Sheets['수량원본'].B2.v = '송이'; }, /품목명·단위/],
    [wb => { wb.Sheets['주문상세'].J2.v = 'unknown'; }, /지원하지 않는 단위/],
  ];
  for (const [change, expected] of cases) {
    const wb = chinaFixture(); change(wb); assert.throws(() => chinaOutput(wb), expected);
  }
  assert.throws(() => chinaOutput(chinaFixture(['품목별업체수량'])), /표시 수량.*주문상세/);
  assert.throws(() => generatePedidos(fixture([['name', null, 'MEL A', 'B16'], [null, null, 'MEL A', '20(1)']]), 'China', 'W'), /CL 수량 열/);
  assert.throws(() => generatePedidos(fixture([['name'], ['Den. A', 5]]), 'Thailand', 'W'), /수량 열.*원본/);
});

test('China year/week selection excludes prior-year same-week rows and rejects ambiguity/mismatched scope', () => {
  const wb = chinaFixture(['주문상세']);
  const prior = [...chinaGolden.sheets['주문상세'][1]]; prior[0] = 2025; prior[10] = 999;
  XLSX.utils.sheet_add_aoa(wb.Sheets['주문상세'], [prior], { origin: -1 });
  assert.equal(chinaOutput(wb, 2026)[0].totalQuantity, 80);
  assert.equal(chinaOutput(wb, 2025)[0].totalQuantity, 999);
  assert.throws(() => generatePedidos(wb, 'China', '42-01'), /여러 연도/);
  assert.throws(() => chinaOutput(wb, 2024), /연도·차수/);
  assert.equal(generatePedidos(wb, 'China', '42-1', { year: 2026 })[0].totalQuantity, 80);
  const matrix = chinaFixture(); XLSX.utils.sheet_add_aoa(matrix.Sheets['주문상세'], [prior], { origin: -1 });
  assert.throws(() => chinaOutput(matrix), /단일 연도·차수/);
  const customer = chinaFixture(['업체별발주']);
  const rows = chinaGolden.sheets['업체별발주'].map((row, r) => [...row.slice(0, 9), r === 0 ? '2025-42-01' : 999, row[9], r === 0 ? '합계' : 999 + row[10]]);
  customer.Sheets['업체별발주'] = XLSX.utils.aoa_to_sheet(rows);
  assert.equal(chinaOutput(customer)[0].totalQuantity, 80);
  assert.equal(chinaOutput(customer, 2025)[0].totalQuantity, 3996);
});

test('China mixed units are separate outputs, with no box conversion or cross-unit total', () => {
  const wb = chinaFixture(['주문상세']);
  const stems = [...chinaGolden.sheets['주문상세'][1]]; stems[9] = '송이'; stems[10] = 200;
  XLSX.utils.sheet_add_aoa(wb.Sheets['주문상세'], [stems], { origin: -1 });
  const outputs = chinaOutput(wb);
  assert.deepEqual(outputs.map(o => [o.filename, o.unit, o.totalQuantity]), [['42-01_Melody_단.xlsx', 'bunches', 80], ['42-01_Melody_송이.xlsx', 'stems', 200]]);
  assert.equal(outputs[1].products[0].prodKey, '2358');
});

const chinaSamplePath = new URL('../output/drive-samples/중국_발주현황_2026-42-01 (1).xlsx', import.meta.url);
test('actual China sample independent numeric totals: 59 products, 19 CustKeys, 1850 bunches, K01 remains two columns', { skip: !fs.existsSync(chinaSamplePath) }, () => {
  const wb = readPedidosWorkbook(fs.readFileSync(chinaSamplePath)), before = JSON.stringify(wb);
  const rows = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true });
  const detail = rows('주문상세').slice(1), customer = rows('업체별발주').slice(1);
  const raw = rows('수량원본').slice(1).filter(row => /^\d+$/.test(String(row[0])));
  assert.equal(detail.length, 123);
  assert.equal(detail.reduce((s, row) => s + row[10], 0), 1850);
  assert.equal(customer.reduce((s, row) => s + row[9], 0), 1850);
  assert.equal(raw.reduce((s, row) => s + row[3], 0), 1850);
  assert.equal(raw.reduce((s, row) => s + row.slice(5, 24).reduce((s, qty) => s + qty, 0), 0), 1850);
  const out = chinaOutput(wb)[0];
  assert.equal(out.itemCount, 59); assert.equal(out.totalQuantity, 1850); assert.equal(out.customers.length, 19);
  for (const [custKey, total] of [['565', 590], ['689', 200]]) {
    const column = out.customers.find(c => c.custKey === custKey).column;
    const c = out.preview.headers.indexOf(column);
    assert.equal(out.preview.rows.reduce((s, row) => s + (row[c] ?? 0), 0), total);
  }
  const saved = readPedidosWorkbook(serializePedidosWorkbook(out.workbook)).Sheets['Melody 42-01'];
  assert.equal(saved.U63.v, 1850); assert.equal(JSON.stringify(wb), before);
});

test('Pedidos UI passes year scope and never disables downloads based on zero totals', () => {
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  assert.match(ui, /generatePedidos\(workbook, country, cleanWeek, \{ year: Number\(year\) \}\)/);
  assert.match(ui, /정상적인 0 수량 결과도 다운로드/);
  assert.match(ui, /<button type="button" onClick=\{\(\) => download\(output\)\}>엑셀 다운로드/);
  assert.doesNotMatch(ui, /if\s*\([^)]*totalQuantity[^)]*\)\s*(?:return|throw)/);
});
