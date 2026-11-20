const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const babel = require('next/dist/compiled/babel/core');

const root = path.resolve(__dirname, '..');
const modulePromise = import('../lib/importOneStopPipeline.js');

test('normalizes scope, preserves zero/empty guards, and round-trips query parameters', async () => {
  const {
    normalizeCountryCode,
    normalizePipelineScope,
    parsePipelineQuery,
    pipelineQueryString,
    buildPipelineDeepLinks,
  } = await modulePromise;

  assert.equal(normalizeCountryCode(''), 'ALL');
  assert.equal(normalizeCountryCode('all'), 'ALL');
  assert.equal(normalizeCountryCode('콜롬비아'), 'CO');
  assert.equal(normalizeCountryCode('nl'), 'NL');
  assert.equal(normalizeCountryCode('unknown-country'), 'ALL');

  const normalized = normalizePipelineScope({ orderYear: '2026', orderWeek: '46-1', country: '콜롬비아', step: '3' });
  assert.deepEqual(normalized, {
    orderYear: '2026',
    orderWeek: '46-01',
    country: 'CO',
    step: 3,
    yearValid: true,
    weekValid: true,
    valid: true,
  });

  // Invalid week/step values never fall back silently to fake valid completions
  assert.equal(normalizePipelineScope({ orderYear: '2026', orderWeek: '0-1' }).valid, false);
  assert.equal(normalizePipelineScope({ orderYear: '2026', orderWeek: '54-01' }).valid, false);
  assert.equal(normalizePipelineScope({ orderYear: '202', orderWeek: '46-01' }).valid, false);
  assert.equal(normalizePipelineScope({ orderYear: '2026', orderWeek: '46-01', step: 0 }).step, 1);
  assert.equal(normalizePipelineScope({ orderYear: '2026', orderWeek: '46-01', step: 99 }).step, 1);

  const qs = pipelineQueryString(normalized, { popup: true });
  assert.equal(qs, 'year=2026&week=46-01&country=CO&step=3&popup=1');
  const parsed = parsePipelineQuery(`?${qs}`);
  assert.deepEqual(parsed, normalized);

  const links = buildPipelineDeepLinks(normalized);
  assert.equal(links.importHub, '/import?year=2026&week=46-01');
  assert.match(links.incoming, /^\/incoming\?week=46-01&from=2026-11-11&to=2026-11-13$/);
  assert.match(links.importToolsIncoming, /^\/import\/tools\?tab=incoming&week=46-01&from=2026-11-11&to=2026-11-13$/);
  assert.equal(links.arrivalCost, '/arrival-cost?year=2026&week=46-01&country=CO');
  assert.equal(links.workDrive, '/work/drive');
  assert.equal(links.moyiDrive, '/integrations/moyi-drive');
});

test('cross-year drive filtering isolates prior-year files with the same OrderWeek', async () => {
  const { formatShortDriveCycle, matchesDriveCycle, filterDriveFilesByScope } = await modulePromise;

  assert.equal(formatShortDriveCycle('46-01'), '46-1');
  assert.equal(formatShortDriveCycle('08-02'), '8-2');
  assert.equal(matchesDriveCycle('46-1', '46-01'), true);
  assert.equal(matchesDriveCycle('46-01', '46-01'), true);
  assert.equal(matchesDriveCycle('46', '46-01'), true);
  assert.equal(matchesDriveCycle('46-2', '46-01'), false);

  const files = [
    { id: '1', cycle: '46-1', year: 2026, stage: '입고', filename: '46-1 콜롬비아 인보이스.pdf' },
    { id: '2', cycle: '46-1', year: 2025, stage: '원가·운임', filename: '2025년 46-1차 콜롬비아 도착원가.xlsx' },
    { id: '3', cycle: '46-1', stage: '원가·운임', filename: '2025-46차 네덜란드 원가.xlsx' },
    { id: '4', cycle: '46-1', year: 2026, stage: '원가·운임', filename: '46-1 네덜란드 도착원가.xlsx' },
  ];

  const scopedCO = filterDriveFilesByScope(files, { orderYear: '2026', orderWeek: '46-01', country: 'CO' });
  assert.deepEqual(scopedCO.cycleFiles.map((f) => f.id), ['1', '4']);
  assert.deepEqual(scopedCO.countryFiles.map((f) => f.id), ['1']);
  assert.deepEqual(scopedCO.stageCounts, { '입고': 1, '원가·운임': 1 });
});

test('summarizePipelineSteps gates completion honestly and preserves explicit zero metrics', async () => {
  const { summarizePipelineSteps } = await modulePromise;
  const scope = { orderYear: '2026', orderWeek: '46-01', country: 'CO', step: 1 };

  const empty = summarizePipelineSteps({ scope });
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.progressPercent, 0);
  assert.deepEqual(empty.steps.map((s) => s.status), ['pending', 'pending', 'pending', 'pending']);

  // Stale invoice cost or missing arrival cost must block Step 3 completion
  const partial = summarizePipelineSteps({
    scope,
    drafts: [{ documentId: 'd1', receiptStatus: 'COMMITTED', costStatus: 'STALE' }],
    warehouses: [{ WarehouseKey: 101, FarmName: 'AYURA', InvoiceNo: 'INV-1' }],
    board: {
      cards: [{ country: '콜롬비아', ordered: 100, received: 100, shipped: 80, missing: 0 }],
      items: [{ country: '콜롬비아', ordered: 100, received: 100, shipped: 80, tag: '일치' }],
    },
    invoiceCosts: [{ warehouseKey: 101, currentActual: null, latestStale: { totalCostKRW: 1000 } }],
    arrivalCosts: [
      { countryName: '콜롬비아', uploadStatus: 'UPLOADED', matchStatus: 'MATCHED', selectedArrivalCostKRW: 0 },
      { countryName: '콜롬비아', uploadStatus: 'COST_NOT_UPLOADED', matchStatus: 'COST_NOT_UPLOADED' },
    ],
    driveFiles: [{ id: 'f1', cycle: '46-1', year: 2026, stage: '입고', filename: '46-1 콜롬비아.pdf' }],
    copiedAt: '',
  });
  assert.equal(partial.steps[0].status, 'complete');
  assert.equal(partial.steps[1].status, 'complete');
  assert.equal(partial.steps[2].status, 'in_progress');
  assert.equal(partial.steps[3].status, 'in_progress');
  assert.equal(partial.completedCount, 2);
  assert.equal(partial.progressPercent, 50);

  // Explicit errors must never report complete
  const errored = summarizePipelineSteps({
    scope,
    errors: { drafts: 'timeout', warehouses: 'timeout', arrivalCosts: 'timeout', invoiceCosts: 'timeout', drive: 'timeout' },
  });
  assert.deepEqual(errored.steps.map((s) => s.status), ['error', 'error', 'error', 'error']);
  assert.equal(errored.completedCount, 0);

  // Fully verified across all 4 steps
  const complete = summarizePipelineSteps({
    scope,
    drafts: [{ documentId: 'd1', receiptStatus: 'COMMITTED', costStatus: 'APPROVED' }],
    warehouses: [{ WarehouseKey: 101, FarmName: 'AYURA', InvoiceNo: 'INV-1' }],
    board: {
      cards: [{ country: '콜롬비아', ordered: 100, received: 100, shipped: 80, missing: 0 }],
      items: [{ country: '콜롬비아', ordered: 100, received: 100, shipped: 80, tag: '일치' }],
    },
    invoiceCosts: [{ warehouseKey: 101, currentActual: { totalCostKRW: 5400000 } }],
    arrivalCosts: [
      { countryName: '콜롬비아', uploadStatus: 'UPLOADED', matchStatus: 'MATCHED', selectedArrivalCostKRW: 4200, unit: '송이' },
    ],
    driveFiles: [{ id: 'f1', cycle: '46-1', year: 2026, stage: '원가·운임', filename: '46-1 콜롬비아 원가.xlsx' }],
    copiedAt: '2026-11-18T09:00:00.000Z',
  });
  assert.deepEqual(complete.steps.map((s) => s.status), ['complete', 'complete', 'complete', 'complete']);
  assert.equal(complete.completedCount, 4);
  assert.equal(complete.progressPercent, 100);
});

test('buildKakaoSummaryText formats copy-ready report with no auto-send guarantee', async () => {
  const { buildKakaoSummaryText } = await modulePromise;
  const text = buildKakaoSummaryText({
    scope: { orderYear: '2026', orderWeek: '46-01', country: 'CO' },
    drafts: [{ documentId: 'd1', receiptStatus: 'COMMITTED' }],
    warehouses: [{ WarehouseKey: 101, FarmName: 'AYURA' }],
    board: {
      cards: [{ country: '콜롬비아', ordered: 120, received: 120, shipped: 100, missing: 0 }],
      items: [{ country: '콜롬비아', ordered: 120, received: 120, shipped: 100, tag: '일치' }],
    },
    invoiceCosts: [{ warehouseKey: 101, currentActual: { totalCostKRW: 3250000 } }],
    arrivalCosts: [
      {
        countryName: '콜롬비아',
        displayName: '수국 화이트',
        farmName: 'AYURA',
        unit: '송이',
        selectedArrivalCostKRW: 8500,
        uploadStatus: 'UPLOADED',
        matchStatus: 'MATCHED',
      },
      {
        countryName: '네덜란드',
        displayName: '장미 레드',
        farmName: 'HOLEX',
        unit: '단',
        selectedArrivalCostKRW: 12000,
        uploadStatus: 'UPLOADED',
        matchStatus: 'MATCHED',
      },
    ],
    driveFiles: [{ id: 'f1', cycle: '46-1', year: 2026, stage: '원가·운임', filename: '46-1 콜롬비아.xlsx' }],
    includeItems: true,
    customNote: '정상 검수 완료',
  });

  assert.match(text, /\[수입 현황 요약\] 2026년 46-01차/);
  assert.match(text, /콜롬비아/);
  assert.match(text, /수국 화이트 \(AYURA\): 8,500원\/송이/);
  assert.doesNotMatch(text, /장미 레드/);
  assert.match(text, /특이사항: 정상 검수 완료/);
  assert.match(text, /자동 발송 아님/);
});

test('page, UI component, Layout, and desktop menu.json satisfy layout and ERP safety contracts', () => {
  const pagePath = path.join(root, 'pages/import/pipeline.js');
  const uiPath = path.join(root, 'components/import-tools/ImportOneStopPipeline.js');
  const pageSrc = fs.readFileSync(pagePath, 'utf8');
  const uiSrc = fs.readFileSync(uiPath, 'utf8');
  const layoutSrc = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
  const desktopMenu = JSON.parse(fs.readFileSync(path.join(root, 'desktop/menu.json'), 'utf8'));

  // Compile JSX component cleanly
  babel.transformSync(uiSrc, {
    filename: uiPath,
    presets: [require('next/dist/compiled/babel/preset-react')],
    configFile: false,
    babelrc: false,
  });
  babel.transformSync(pageSrc, {
    filename: pagePath,
    presets: [require('next/dist/compiled/babel/preset-react')],
    configFile: false,
    babelrc: false,
  });

  // Single shell rule: no direct Layout import/wrapper
  assert.doesNotMatch(pageSrc, /import\s+Layout|<Layout/);
  assert.match(pageSrc, /verifyReqUser/);
  assert.match(pageSrc, /ImportOneStopPipeline/);

  // Embedded guide, keyboard tabs, copy-only Kakao, drive links, zero direct SQL/ERP write endpoints
  assert.match(uiSrc, /<WorkflowGuide\s+workflowId="import-onestop-pipeline"/);
  assert.match(uiSrc, /MENU_BACK_REQUEST_EVENT/);
  assert.match(uiSrc, /navigator\?\.clipboard\?\.writeText/);
  assert.match(uiSrc, /자동 발송 금지 안전선 준수/);
  assert.match(uiSrc, /deepLinks\.workDrive/);
  assert.match(uiSrc, /deepLinks\.moyiDrive/);
  assert.match(uiSrc, /<PackingListTool/);
  assert.match(uiSrc, /<InvoiceReceiptWorkbench/);
  assert.match(uiSrc, /<NativeReceiptCost/);
  assert.match(uiSrc, /<InvoiceArrivalCostPanel/);
  assert.doesNotMatch(uiSrc, /\b(INSERT\s+INTO|UPDATE\s+dbo\.|DELETE\s+FROM|usp_StockCalculation)\b/i);

  // Desktop menu & Layout parity
  assert.match(layoutSrc, /href:\s*'\/import\/pipeline',\s*labelKey:\s*'수입 원스톱 파이프라인\(인보이스→원가→공유\) · 콜롬비아 주차 원가',\s*popup:\s*false/);
  const desktopItem = desktopMenu.flatMap((g) => g.items).find((item) => item.href === '/import/pipeline');
  assert.ok(desktopItem, 'desktop/menu.json must contain /import/pipeline');
  assert.match(desktopItem.labelKey, /수입 원스톱 파이프라인.*콜롬비아 주차 원가/);
  assert.equal(desktopItem.popup, false);
});
