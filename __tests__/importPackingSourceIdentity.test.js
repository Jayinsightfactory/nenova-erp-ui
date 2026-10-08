const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx-js-style');

const ready = import('../lib/importPacking.js');

function catalog(country, names) {
  return { byCountry: { [country]: names.map((name) => ({ name })) } };
}

function aliasOptions(packing, country, sourceName, targetName) {
  return {
    catalog: catalog(country, [targetName]),
    aliases: { [packing.aliasKey(sourceName)]: targetName },
  };
}

test('CN XLSX rows expose raw source names and distinct family/length-qualified matching identities', async () => {
  const packing = await ready;
  const sourceName = '장미 다이아나 (Diana)';
  const targets = ['ROSE CHINA / Diana 60cm', 'ROSE CHINA / Diana 70cm'];
  const matchingDescriptions = [
    `${sourceName} [family:ROSE] [length:60CM]`,
    `${sourceName} [family:ROSE] [length:70CM]`,
  ];
  const products = matchingDescriptions.map((description, index) => ({
    description,
    source_description: sourceName,
    source_format: 'china_invoice_xlsx',
    source_row: 12 + index,
    family: 'ROSE',
    stem_length: index ? '70cm' : '60cm',
    pcs: 1,
    bunch_st: 10,
    steam_box: 100,
    total_bunch: 10,
    total_stems: 100,
    u_price: 1,
    t_price: 10,
  }));
  const inv = {
    source_format: 'china_invoice_xlsx',
    supplier: 'Kun Ming Hubfresh',
    invoice: 'CN-XLSX',
    products,
    additional_costs: [],
    item_subtotal: 20,
    freight: 0,
    invoice_total: 20,
    total_boxes: 2,
    total_bunches: 20,
    total_stems: 200,
  };
  const aliases = Object.fromEntries(matchingDescriptions.map((description, index) => (
    [packing.aliasKey(description), targets[index]]
  )));
  let book;
  const result = packing.genChina({ ...XLSX, write: (wb) => { book = wb; return new Uint8Array([1]); } },
    inv, '41', '01', { catalog: catalog('CN', targets), aliases });

  assert.deepEqual(result.products.map((row) => row.sourceName), [sourceName, sourceName]);
  assert.deepEqual(result.products.map((row) => row.matchingDescription), matchingDescriptions);
  assert.notEqual(packing.aliasKey(result.products[0].matchingDescription), packing.aliasKey(result.products[1].matchingDescription));
  assert.deepEqual(result.products.map((row) => row.name), [
    `${targets[0]} [length: 60cm]`,
    `${targets[1]} [length: 70cm]`,
  ]);
  const sheet = book.Sheets['CN-HUB'];
  assert.equal(sheet.B6.v, `${targets[0]} [length: 60cm]`);
  assert.equal(sheet.B7.v, `${targets[1]} [length: 70cm]`);
  assert.equal(sheet.L6.f, 'K6*I6');
  assert.equal(sheet.B6.s.font.name, 'Calibri');
});

test('legacy CN PDF identity remains the raw resolver description, never the generated target name', async () => {
  const packing = await ready;
  const sourceName = 'PDF RAW CARNATION';
  const targetName = 'CARNATION Nenova Target';
  const inv = {
    supplier: 'Yunnan Melody',
    invoice: 'CN-PDF',
    total_value: 10,
    products: [{ description: sourceName, pcs: 1, bunch_st: 1, steam_box: 10,
      total_bunch: 10, total_stems: 10, u_price: 1, t_price: 10 }],
  };
  const result = packing.genChina(XLSX, inv, '41', '01', aliasOptions(packing, 'CN', sourceName, targetName));
  assert.equal(result.products[0].name, targetName);
  assert.equal(result.products[0].sourceName, sourceName);
  assert.equal(result.products[0].matchingDescription, sourceName);
});

test('NL keeps differing raw identities separate and applies independent ERP mappings with exact quantities', async () => {
  const packing = await ready;
  const targetA = 'Tulip / Single Dynasty L/Pink';
  const targetB = 'Tulip / Single Crown Dynasty L/Pink';
  const inv = {
    supplier: 'Holex',
    invoice: 'NL-AGG',
    total_value: 30,
    lines: [
      { cl: 'CL2', description: 'TULIPA DYNASTY', stems: 10, price: 1 },
      { cl: 'CL2', description: 'TULIPA DYNASTY EXTRA', stems: 20, price: 1 },
    ],
  };
  const aliases = {
    [packing.packingSourceKey('TULIPA DYNASTY')]: targetA,
    [packing.packingSourceKey('TULIPA DYNASTY EXTRA')]: targetB,
  };
  const result = packing.genNL(XLSX, inv, '41', '01', { catalog: catalog('NL', [targetA, targetB]), aliases });
  assert.equal(result.products.length, 2);
  const rows = Object.fromEntries(result.products.map((row) => [row.sourceName, row]));
  assert.deepEqual({ name: rows['TULIPA DYNASTY'].name, qty: rows['TULIPA DYNASTY'].qty }, { name: targetA, qty: 10 });
  assert.deepEqual({ name: rows['TULIPA DYNASTY EXTRA'].name, qty: rows['TULIPA DYNASTY EXTRA'].qty }, { name: targetB, qty: 20 });
  assert.equal(rows['TULIPA DYNASTY EXTRA'].matchingDescription, 'TULIPA DYNASTY EXTRA');
});

test('NL still aggregates repeated identical source identity and price', async () => {
  const packing = await ready;
  const targetName = 'Tulip / Single Dynasty L/Pink';
  const inv = {
    supplier: 'Holex',
    invoice: 'NL-SAME',
    total_value: 30,
    lines: [
      { cl: 'CL2', description: 'TULIPA DYNASTY', stems: 10, price: 1 },
      { cl: 'CL2', description: 'TULIPA DYNASTY', stems: 20, price: 1 },
    ],
  };
  const result = packing.genNL(XLSX, inv, '41', '01', { catalog: catalog('NL', [targetName]) });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].qty, 30);
  assert.equal(result.products[0].sourceName, 'TULIPA DYNASTY');
});

test('NL explicit ERP alias overrides a valid built-in dictionary target', async () => {
  const packing = await ready;
  const dictionaryTarget = 'Tulip / Single Dynasty L/Pink';
  const manualTarget = 'Tulip / Single Crown Dynasty L/Pink';
  const description = 'TULIPA DYNASTY';
  const inv = { supplier: 'Holex', invoice: 'NL-OVERRIDE', total_value: 10,
    lines: [{ cl: 'CL2', description, stems: 10, price: 1 }] };
  const result = packing.genNL(XLSX, inv, '41', '01', {
    catalog: catalog('NL', [dictionaryTarget, manualTarget]),
    aliases: { [packing.packingSourceKey(description)]: manualTarget },
  });
  assert.equal(result.products[0].name, manualTarget);
  assert.equal(result.products[0].viaAlias, true);
});

test('NL legacy alias still applies when no explicit ERP source identity exists', async () => {
  const packing = await ready;
  const description = 'NL LEGACY RAW NAME';
  const targetName = 'Tulip / Single Dynasty L/Pink';
  const inv = { supplier: 'Holex', invoice: 'NL-LEGACY', total_value: 10,
    lines: [{ cl: 'CL2', description, stems: 10, price: 1 }] };
  const result = packing.genNL(XLSX, inv, '41', '01', {
    catalog: catalog('NL', [targetName]),
    aliases: { [packing.aliasKey(description)]: targetName },
  });
  assert.equal(result.products[0].name, targetName);
  assert.equal(result.products[0].viaAlias, true);
  assert.equal(result.products[0].unmatched, undefined);
});

test('NL stale ERP alias stays unmatched instead of falling back to a valid dictionary target', async () => {
  const packing = await ready;
  const dictionaryTarget = 'Tulip / Single Dynasty L/Pink';
  const description = 'TULIPA DYNASTY';
  const inv = { supplier: 'Holex', invoice: 'NL-STALE', total_value: 10,
    lines: [{ cl: 'CL2', description, stems: 10, price: 1 }] };
  const result = packing.genNL(XLSX, inv, '41', '01', {
    catalog: catalog('NL', [dictionaryTarget]),
    aliases: {
      [packing.packingSourceKey(description)]: '\u0000ERP_MATCH_REQUIRES_REVIEW',
      [packing.aliasKey(description)]: dictionaryTarget,
    },
  });
  assert.equal(result.products[0].name, description);
  assert.equal(result.products[0].unmatched, true);
  assert.equal(result.products[0].viaAlias, undefined);
  assert.equal(result.pending.length + result.noMatches.length, 1);
});

test('all remaining country writers expose the exact raw resolver description in every output map', async () => {
  const packing = await ready;
  const cases = [
    { name: 'CO Bogota', country: 'CO', generate: packing.genColombia, invoice: { supplier: 'Teucali', invoice_total: 10 } },
    { name: 'CO Antioquia', country: 'CO', generate: packing.genColombia, invoice: { supplier: 'Balverde', invoice_total: 10 } },
    { name: 'EC', country: 'EC', generate: packing.genEcuador, invoice: { invoice_total: 10 } },
    { name: 'TH', country: 'TH', generate: packing.genThailand, invoice: { supplier: 'Super Fresh', invoice_total: 10 } },
    { name: 'AU', country: 'AU', generate: packing.genAustralia, invoice: {} },
    { name: 'US', country: 'US', generate: packing.genUS, invoice: {} },
    { name: 'VN', country: 'VN', generate: packing.genVN, invoice: {} },
  ];

  for (const entry of cases) {
    const sourceName = `${entry.name} raw source`;
    const targetName = `${entry.name} Nenova target`;
    const product = { description: sourceName, pcs: 1, bunch_st: 1, steam_box: 10,
      total_bunch: 10, total_stems: 10, u_price: 1, t_price: 10 };
    const result = entry.generate(XLSX, { invoice: `${entry.country}-1`, products: [product], ...entry.invoice },
      '41', '01', aliasOptions(packing, entry.country, sourceName, targetName));
    assert.equal(result.products.length, 1, entry.name);
    assert.equal(result.products[0].name, targetName, entry.name);
    assert.equal(result.products[0].sourceName, sourceName, entry.name);
    assert.equal(result.products[0].matchingDescription, sourceName, entry.name);
  }
});
