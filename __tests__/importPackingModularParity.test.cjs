'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx-js-style');
const babel = require('next/dist/compiled/babel/core');

const repoRoot = path.resolve(__dirname, '..');

test('lib/importPacking.js re-exports 100% identical references (===) across all 80 symbols from lib/importPacking/*', async () => {
  const rootMod = await import('../lib/importPacking.js');
  const seedAliases = await import('../lib/importPacking/seedAliases.js');
  const catalogAndMatching = await import('../lib/importPacking/catalogAndMatching.js');
  const countryRules = await import('../lib/importPacking/countryRules.js');
  const excelSheetBuilder = await import('../lib/importPacking/excelSheetBuilder.js');
  const countryGenerators = await import('../lib/importPacking/countryGenerators.js');
  const awbWorkbook = await import('../lib/importPacking/awbWorkbook.js');

  const submodules = [
    seedAliases,
    catalogAndMatching,
    countryRules,
    excelSheetBuilder,
    countryGenerators,
    awbWorkbook,
  ];

  const expectedExports = [
    'ALIGN_CENTER',
    'ALIGN_CENTER_WRAP',
    'ALIGN_LEFT',
    'ALIGN_LEFT_TOP',
    'ALL_SEED_ALIASES',
    'ANTIOQUIA_FARMS',
    'AWB_DEFAULT_COMPANIES',
    'BORDER_MEDIUM',
    'BORDER_THIN',
    'BUNCH_ST_NL',
    'COMPOUND_SPLITS',
    'CO_FARMS',
    'FAMILY_PATTERNS',
    'FONT_HEADER',
    'FONT_HEADER_BOLD',
    'FONT_TABLE',
    'FONT_TABLE_BOLD',
    'FONT_TITLE',
    'KR_COUNTRY_TO_CODE',
    'NF_INT',
    'NF_PLAIN_INT',
    'NF_PRICE2',
    'NF_PRICE3',
    'NF_TEXT',
    'NF_THOUSANDS',
    'NL_MAP',
    'NL_MASTER',
    'NL_MASTER_IDX',
    'NOISE_WORDS',
    'SEED_ALIASES_AU',
    'SEED_ALIASES_CN',
    'SEED_ALIASES_CO',
    'SEED_ALIASES_TH',
    'SEED_ALIASES_US',
    'SEED_ALIASES_VN',
    'STEMS_PER_BOX_CO',
    'STEMS_PER_BUNCH_CO',
    'aliasKey',
    'applyColWidths',
    'applyColWidths19_2',
    'bord',
    'bordersAll',
    'buildAWBSheet',
    'buildMerges',
    'buildMerges19_2',
    'buildSheet19_2',
    'detectCOFarm',
    'detectFamily',
    'exportAliasesXlsx',
    'extractSize',
    'familyForCatalog',
    'familyNL',
    'findBestMatch',
    'formatAwbNL',
    'genAustralia',
    'genChina',
    'genColombia',
    'genEcuador',
    'genNL',
    'genThailand',
    'genUS',
    'genVN',
    'isConfidentMatch',
    'makeProductResolver',
    'mapProductNL',
    'normalize',
    'packingSourceKey',
    'parseAliasesXlsx',
    'parseCatalog',
    'parseWeekFromFilename',
    'resolveProductNL',
    'scoreMatch',
    'setCell',
    'setEmpty',
    'setFormula',
    'splitCompounds',
    'stemsPerBoxCO',
    'stemsPerBunchCO',
    'tokenize',
    'writeAWBWorkbook',
    'writeDataRowAU',
    'writeDataRowCN',
    'writeDataRowCOAntioquia',
    'writeDataRowCOBogota',
    'writeDataRowEC',
    'writeDataRowNL',
    'writeDataRowPseudo',
    'writeDataRowTH',
    'writeDataRowUS',
    'writeDataRowVN',
    'writeTableHeaders',
    'writeTableHeaders19_2',
    'writeTopHeader',
    'writeTopHeader19_2',
  ].sort();

  assert.deepStrictEqual(Object.keys(rootMod).sort(), expectedExports);

  // Verify every single exported symbol in rootMod is === to its source submodule export
  const mergedFromSubmodules = {};
  for (const sub of submodules) {
    for (const [key, val] of Object.entries(sub)) {
      assert.ok(!(key in mergedFromSubmodules), `Duplicate symbol across submodules: ${key}`);
      mergedFromSubmodules[key] = val;
    }
  }
  assert.deepStrictEqual(Object.keys(mergedFromSubmodules).sort(), expectedExports);
  for (const key of expectedExports) {
    assert.strictEqual(rootMod[key], mergedFromSubmodules[key], `Reference mismatch for ${key}`);
  }
});

test('extracted lib/importPacking/* domain modules preserve deterministic parsing, matching, country rules, and workbook formulas', async () => {
  const rootMod = await import('../lib/importPacking.js');
  const supportMod = await import('../lib/importPacking/packingToolSupport.js');

  // 1) Seed aliases preserve exact CJK fullwidth spaces and trailing spaces
  assert.equal(
    rootMod.SEED_ALIASES_CN['ROSE (FRUTTETO)'],
    'ROSE CHINA / 프루테토, 큐피트\u3000(Frutteto, Cupid)'
  );
  assert.equal(
    rootMod.SEED_ALIASES_VN['PHALAENOPSIS CUT FLOWER W 07F'],
    'ORCHID VIETNAM / 호접란  화이트 7-8 (Party grade White 7-8) '
  );

  // 2) Normalization, aliasKey, packingSourceKey, family & scoring parity
  assert.equal(rootMod.normalize('  Rosé   Mondial  '), 'ROSE MONDIAL');
  assert.equal(rootMod.aliasKey('Luo shen (洛神)'), 'LUO SHEN');
  assert.equal(rootMod.packingSourceKey('  Rose  50cm '), 'erp:ROSE 50CM');
  assert.equal(rootMod.stemsPerBunchCO('CARNATION Doncel', 1), 20);
  assert.equal(rootMod.stemsPerBoxCO('TEU', 'CARNATION Doncel', 100), 300);
  assert.equal(rootMod.stemsPerBoxCO('ANY', 'ALSTROMERIA Dubai', 100), 160);

  // 3) NL & CO rules + week filename parser
  assert.equal(rootMod.formatAwbNL('180-5068-0206'), '180-50680206');
  assert.equal(rootMod.detectCOFarm('C.I Flores Balverde S.A.S').abbr, 'BAL');
  assert.equal(rootMod.ANTIOQUIA_FARMS.has('BAL'), true);
  assert.deepStrictEqual(rootMod.parseWeekFromFilename('47-2 Hortensias.pdf'), { week: '47', num: '02' });

  // 4) Country generator & AWB sheet builder parity
  const coCatalog = { byCountry: { CO: [{ name: 'CARNATION Doncel', family: 'CARNATION' }] } };
  const coOut = rootMod.genColombia(
    XLSX,
    {
      invoice: '18001',
      supplier: 'Teucali',
      awb: '145-12345678',
      date: '2026/11/20',
      invoice_total: 120,
      freight_total: 0,
      products: [{ description: 'CARNATION Doncel', pcs: 2, bunch_st: 20, steam_box: 300, total_stems: 600, total_bunch: 30, u_price: 0.2, t_price: 120 }],
    },
    '47',
    '02',
    { catalog: coCatalog }
  );
  assert.equal(coOut.name, '47-02_CO_TEU_18001.xlsx');
  assert.equal(coOut.totalMismatch, null);
  assert.notEqual(coOut.products[0].unmatched, true);
  assert.equal(coOut.products[0].name, 'CARNATION Doncel');

  const awbWs = rootMod.buildAWBSheet(XLSX, {
    company: 'EXCEL',
    weekend: '47-02',
    invoice: '999-11112222',
    awb: '999-11112222',
    date: '2026/11/20',
    gw: 150,
    cw: 200,
    uPrice1: 2.5,
    uPrice2: 50,
  });
  assert.equal(awbWs['!ref'], 'A1:L20');
  assert.equal(awbWs.L6.f, 'K6*I6');
  assert.equal(awbWs.L6.v, 500);
  assert.equal(awbWs.L7.v, 50);

  // 5) packingToolSupport helpers parity
  const koText = supportMod.packingText('ko');
  const koView = supportMod.buildPackingCountryView('CO', koText);
  assert.equal(koView.countryLabels.length, 8);
  assert.equal(koView.cfg[0], '🇨🇴');
  assert.ok(koView.cfg[1].includes('콜롬비아'));
  assert.equal(supportMod.detectAWBCompany('EXCEL TRANSPORT AIR WAYBILL'), 'EXCEL');
  assert.match(supportMod.seoulCalendarDate(new Date('2026-11-27T00:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(supportMod.isLegacyChinaInvoice({ source_format: 'china_legacy_invoice_xlsx' }), true);
  assert.equal(supportMod.isLegacyChinaInvoice({ source_format: 'china_legacy_invoice_reviewed' }), false);
});

test('Phase 2 extracted UI subcomponents compile cleanly and keep monolith line counts compact', () => {
  const libLines = fs.readFileSync(path.join(repoRoot, 'lib/importPacking.js'), 'utf8').split(/\r?\n/).length;
  const toolLines = fs.readFileSync(path.join(repoRoot, 'components/import-tools/PackingListTool.js'), 'utf8').split(/\r?\n/).length;
  assert.ok(libLines < 150, `lib/importPacking.js must stay a compact facade (<150 lines), got ${libLines}`);
  assert.ok(toolLines < 2100, `components/import-tools/PackingListTool.js must stay compact (<2100 lines), got ${toolLines}`);

  const uiFiles = [
    'components/import-tools/PackingListTool.js',
    'components/import-tools/PackingLegacyMatchItems.js',
    'components/import-tools/PackingAwbPanel.js',
    'components/import-tools/PackingCatalogSection.js',
    'components/import-tools/PackingCountryAndReusePanels.js',
  ];

  for (const rel of uiFiles) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    babel.transformSync(src, {
      filename: path.basename(rel),
      presets: [require('next/dist/compiled/babel/preset-react')],
      configFile: false,
      babelrc: false,
    });
  }

  const toolSrc = fs.readFileSync(path.join(repoRoot, 'components/import-tools/PackingListTool.js'), 'utf8');
  assert.match(toolSrc, /export \{ NoticeText, PendingItem, NoMatchItem, AWBPanel \}/);
});
