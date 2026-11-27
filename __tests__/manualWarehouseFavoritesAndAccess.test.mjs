import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { canManageInvoiceReceipt } from '../lib/invoiceReceiptAccess.js';
import { canUseManualWarehouseUpload } from '../lib/manualWarehouseAccess.js';
import { manualWarehouseLine } from '../lib/manualWarehouseUpload.js';
import { readImportTeamRecord } from '../lib/importTeamStore.js';
import {
  MANUAL_WAREHOUSE_FAVORITES_KEY,
  applyManualFavoriteToForm,
  buildManualFavoriteDraft,
  defaultManualFavoriteName,
  mergeManualFavoriteLists,
  rankManualWarehouseFarms,
  validateManualWarehouseFavorites,
} from '../lib/manualWarehouseFavorites.js';
import { createManualFavoritesHandler } from '../lib/manualWarehouseFavoritesStore.js';

const require = createRequire(import.meta.url);

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    end() { return this; },
  };
}

test('nenovaSS2 has case-insensitive manual upload access while keeping least-privilege on general ledger writes', () => {
  for (const id of ['nenovaSS2', 'nenovass2', 'NENOVASS2', ' nenovaSS2 ']) {
    const ss2 = { UserID: id, UserName: '설연주', DeptName: '', Authority: 2, isDeleted: false };
    assert.equal(canUseManualWarehouseUpload(ss2), true, `${id} should be allowed for manual upload`);
    assert.equal(canManageInvoiceReceipt(ss2), false, `${id} should not become full general ledger editor`);
  }

  assert.equal(canUseManualWarehouseUpload({ UserID: 'nenovaSS2', Authority: 2, isDeleted: true }), false);
  assert.equal(canUseManualWarehouseUpload({ userId: 'nenovaSS2', authority: 2, accountActive: false }), false);
  assert.equal(canUseManualWarehouseUpload({ UserID: 'nenovaSS1', DeptName: '', Authority: 2 }), false);
  assert.equal(canUseManualWarehouseUpload({ UserID: 'nenovaSS4', DeptName: '', Authority: 2 }), false);
  assert.equal(canUseManualWarehouseUpload({ UserID: 'nenovaSS3', DeptName: '', Authority: 2 }), true);
  assert.equal(canUseManualWarehouseUpload({ userId: 'import01', authority: 4, deptName: '' }), true);
});

test('multi-row manual upload favorites persist across restarts, strip numeric fields, and restore conditions for number+round-only entry', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-manual-fav-'));
  try {
    const handler = createManualFavoritesHandler({ root: tempRoot });
    const ss2User = { userId: 'nenovaSS2', userName: '설연주', authority: 2, deptName: '', accountActive: true };
    const unauthorizedUser = { userId: 'nenovaSS1', userName: '테스트', authority: 2, deptName: '', accountActive: true };

    // Unauthorized user rejected with 403
    const forbiddenRes = mockResponse();
    await handler({ method: 'GET', user: unauthorizedUser }, forbiddenRes);
    assert.equal(forbiddenRes.statusCode, 403);

    // Save 3-row favorite (even when user already typed numbers on screen, numbers must NOT be stored)
    const catalogProducts = [
      { ProdKey: 101, ProdName: '장미 레드 60', OutUnit: '박스', EstUnit: '단', CountryFlower: '장미' },
      { ProdKey: 202, ProdName: '카네이션 핑크', OutUnit: '단', EstUnit: '단', CountryFlower: '카네이션' },
      { ProdKey: 303, ProdName: '수국 화이트', OutUnit: '송이', EstUnit: '송이', CountryFlower: '수국' },
    ];
    const saveRes = mockResponse();
    await handler({
      method: 'POST',
      user: ss2User,
      body: {
        action: 'upsert',
        farmName: 'HUB2',
        farm: { FarmKey: 55, FarmName: 'HUB2', CounName: '중국' },
        expectedRevision: 0,
        rows: [
          {
            product: catalogProducts[0],
            quantity: '12',
            quantityUnit: '박스',
            stemsPerBox: '100',
            stemsPerBunch: '10',
            amountMode: 'total',
            amount: '360',
          },
          {
            product: catalogProducts[1],
            quantity: '40',
            quantityUnit: '단',
            stemsPerBox: '',
            stemsPerBunch: '20',
            amountMode: 'perStem',
            amount: '0.25',
          },
          {
            product: catalogProducts[2],
            quantity: '500',
            quantityUnit: '송이',
            stemsPerBox: '',
            stemsPerBunch: '',
            amountMode: 'total',
            amount: '750',
          },
        ],
      },
    }, saveRes);

    assert.equal(saveRes.statusCode, 200);
    assert.equal(saveRes.payload.favorites.length, 1);
    const saved = saveRes.payload.favorite;
    assert.equal(saved.farmName, 'HUB2');
    assert.equal(saved.farmKey, 55);
    assert.equal(saved.countryName, '중국');
    assert.equal(saved.items.length, 3);
    assert.equal(saved.name, defaultManualFavoriteName('HUB2', saved.items));

    // Verify raw disk record never contains quantity, amount, orderWeek, invoiceNo, awb
    const diskRecord = await readImportTeamRecord(MANUAL_WAREHOUSE_FAVORITES_KEY, { root: tempRoot });
    assert.equal(diskRecord.revision, 1);
    const serialized = JSON.stringify(diskRecord.value);
    assert.equal(serialized.includes('"quantity"'), false);
    assert.equal(serialized.includes('"amount"'), false);
    assert.equal(serialized.includes('"orderWeek"'), false);

    // Tampered numeric payload must be rejected by validator
    assert.throws(
      () => validateManualWarehouseFavorites({
        version: 1,
        entries: [{ ...saved, items: [{ ...saved.items[0], quantity: '10' }] }],
      }),
      /수량·금액 숫자를 저장할 수 없습니다/,
    );

    // Apply favorite to form -> all 3 rows and conditions restored, quantity & amount blank!
    let seq = 10;
    const applied = applyManualFavoriteToForm(saved, catalogProducts, () => seq++);
    assert.equal(applied.farmName, 'HUB2');
    assert.deepEqual(applied.missingProducts, []);
    assert.equal(applied.rows.length, 3);
    assert.deepEqual(
      applied.rows.map(r => [r.product.ProdKey, r.quantityUnit, r.stemsPerBox, r.stemsPerBunch, r.amountMode, r.quantity, r.amount]),
      [
        [101, '박스', '100', '10', 'total', '', ''],
        [202, '단', '', '20', 'perStem', '', ''],
        [303, '송이', '', '', 'total', '', ''],
      ],
    );

    // Entering ONLY numbers converts all 3 rows cleanly with zero unit/packaging re-entry
    const numbersOnly = [
      { ...applied.rows[0], quantity: '3', amount: '90' },
      { ...applied.rows[1], quantity: '15', amount: '0.3' },
      { ...applied.rows[2], quantity: '200', amount: '300' },
    ];
    const converted = numbersOnly.map(row => manualWarehouseLine({
      prodKey: row.product.ProdKey,
      prodName: row.product.ProdName,
      expectedOutUnit: row.product.OutUnit,
      expectedEstUnit: row.product.EstUnit,
      quantity: row.quantity,
      quantityUnit: row.quantityUnit,
      stemsPerBox: row.stemsPerBox,
      stemsPerBunch: row.stemsPerBunch,
      amountMode: row.amountMode,
      amount: row.amount,
    }, row.product));
    assert.deepEqual(converted.map(c => [c.steamQty, c.outQuantity, c.estQuantity, c.totalPrice]), [
      [300, 3, 30, 90],
      [300, 15, 15, 90],
      [200, 200, 200, 300],
    ]);

    // Stale expectedRevision (0 instead of 1) auto-retries cleanly so concurrent team saves do not fail
    const secondRes = mockResponse();
    await handler({
      method: 'POST',
      user: { userId: 'NENOVASS2', userName: '설연주', authority: 2, accountActive: true },
      body: {
        action: 'upsert',
        name: 'HUB2 단품 수국',
        farmName: 'HUB2',
        expectedRevision: 0,
        rows: [{ product: catalogProducts[2], quantityUnit: '송이', stemsPerBox: '', stemsPerBunch: '', amountMode: 'total' }],
      },
    }, secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(secondRes.payload.favorites.length, 2);

    // Delete first favorite
    const delRes = mockResponse();
    await handler({
      method: 'DELETE',
      user: ss2User,
      body: { id: saved.id, expectedRevision: secondRes.payload.revision },
    }, delRes);
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.payload.favorites.length, 1);
    assert.equal(delRes.payload.favorites[0].name, 'HUB2 단품 수국');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('localStorage backup merges cleanly with server favorites without losing newer templates', () => {
  const draftA = buildManualFavoriteDraft({
    id: 'fav-hub2-a',
    name: 'HUB2 기본',
    farmName: 'HUB2',
    rows: [{ prodKey: 101, prodName: '장미 레드', outUnit: '단', estUnit: '단', quantityUnit: '단', stemsPerBunch: '10', stemsPerBox: '', amountMode: 'total' }],
    actorUserId: 'nenovaSS2',
    now: '2026-11-27T01:00:00.000Z',
  });
  const draftB = buildManualFavoriteDraft({
    id: 'fav-cloud-b',
    name: 'CLOUD 추가',
    farmName: 'CLOUD',
    rows: [{ prodKey: 202, prodName: '카네이션', outUnit: '송이', estUnit: '송이', quantityUnit: '송이', stemsPerBunch: '', stemsPerBox: '', amountMode: 'perStem' }],
    actorUserId: 'nenovaSS2',
    now: '2026-11-27T02:00:00.000Z',
  });
  const merged = mergeManualFavoriteLists([draftA], [draftB]);
  assert.deepEqual(merged.map(item => item.id), ['fav-cloud-b', 'fav-hub2-a']);
});

test('farm autocomplete click-open ranks favorite and recent manual-upload farms first and filters partial queries', () => {
  const farms = [
    { FarmKey: 1, FarmName: 'ALPHA FLORES', CounName: '콜롬비아' },
    { FarmKey: 2, FarmName: 'BETA ROSES', CounName: '에콰도르' },
    { FarmKey: 3, FarmName: 'HUB2', CounName: '중국' },
    { FarmKey: 4, FarmName: 'HUB FRESH', CounName: '중국' },
    { FarmKey: 5, FarmName: 'CLOUD FARM', CounName: '중국' },
  ];
  const recentManualFarms = [{ farmName: 'HUB2', useCount: 4, lastWarehouseKey: 8257 }];
  const favorites = [{ id: 'fav-1', farmName: 'CLOUD FARM' }];

  // Empty query (on input click/focus): favorite + recent manual farms appear right at the top
  const onFocusRank = rankManualWarehouseFarms({ farms, recentManualFarms, favorites, query: '' });
  assert.equal(onFocusRank.totalFarms, 5);
  assert.deepEqual(onFocusRank.items.slice(0, 2).map(f => f.farmName), ['CLOUD FARM', 'HUB2']);
  assert.equal(onFocusRank.items[0].favoriteCount, 1);
  assert.equal(onFocusRank.items[1].manualUseCount, 4);

  // Typing partial case/space-insensitive query filters and prioritizes exact/prefix + recent usage
  const hubFiltered = rankManualWarehouseFarms({ farms, recentManualFarms, favorites, query: 'hub' });
  assert.deepEqual(hubFiltered.items.map(f => f.farmName), ['HUB2', 'HUB FRESH']);

  const spaceInsensitive = rankManualWarehouseFarms({ farms, recentManualFarms, favorites, query: 'hubfresh' });
  assert.deepEqual(spaceInsensitive.items.map(f => f.farmName), ['HUB FRESH']);
});

test('warehouse API allows nenovaSS2 on manualOptions + manual upload and caches manualOptions for 5 minutes', async () => {
  const apiSource = fs.readFileSync(new URL('../pages/api/warehouse/index.js', import.meta.url), 'utf8');
  const babel = require('next/dist/compiled/babel/core');
  const compiled = babel.transformSync(apiSource, {
    plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
    configFile: false,
    babelrc: false,
  }).code;

  let queryCount = 0;
  const query = async sqlText => {
    queryCount += 1;
    if (sqlText.includes('FROM dbo.StockMaster')) {
      return { recordset: [{ OrderYear: '2026', OrderWeek: '48-01' }] };
    }
    if (sqlText.includes("wm.FileName LIKE N'manual-%'")) {
      return { recordset: [{ FarmName: 'HUB2', UseCount: 2, LastWarehouseKey: 8257 }] };
    }
    if (sqlText.includes('LEFT JOIN dbo.Country')) {
      return { recordset: [{ FarmKey: 55, CounName: '중국' }] };
    }
    if (sqlText.includes('FROM dbo.Farm f')) {
      return { recordset: [{ FarmKey: 55, FarmName: 'HUB2' }] };
    }
    if (sqlText.includes('FROM Product')) {
      return { recordset: [{ ProdKey: 303, CountryFlower: '수국', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 1, BunchOf1Box: 1 }] };
    }
    return { recordset: [] };
  };

  const out = { exports: {} };
  const manualPolicy = await import('../lib/manualWarehouseUpload.js');
  const farmChoices = await import('../lib/warehouseFarmChoices.js');
  const roundPolicy = await import('../lib/incomingRoundLabel.js');
  const mocks = {
    '../../../lib/db': { sql: new Proxy({}, { get: (_, k) => k }), query, withTransaction: async fn => fn(query) },
    '../../../lib/auth': { withAuth: fn => fn },
    '../../../lib/withActionLog.js': { withActionLog: fn => fn },
    '../../../lib/exeParity/common.js': { useExeParityFlag: () => false },
    '../../../lib/exeWarehouseViewSql.js': { sqlWarehouseViewGetData: () => '', WAREHOUSE_DETAIL_COST_COLUMNS_SQL: '', WAREHOUSE_DOCUMENT_FREIGHT_APPLY_SQL: '' },
    '../../../lib/invoiceReceiptNative.js': {},
    '../../../lib/receiptBunchQuantity.js': { resolveReceiptBunch: () => ({ bunchQty: 1 }) },
    '../../../lib/warehouseWeightRows.js': { WAREHOUSE_WEIGHT_ROW_SQL: '0=1' },
    '../../../lib/invoiceReceiptAccess.js': { canManageInvoiceReceipt, canUseManualWarehouseUpload },
    '../../../lib/manualWarehouseUpload.js': manualPolicy,
    '../../../lib/manualWarehouseUploadDb.js': { assertManualWarehouseEligible: async () => {}, readManualWarehouseAttempt: async () => ({ fileName: 'manual-test', replay: null }) },
    '../../../lib/warehouseFarmChoices.js': farmChoices,
    '../../../lib/incomingRoundLabel.js': roundPolicy,
    '../../../lib/incomingApprovalPolicy.js': { approvalPermissions: () => ({ review: false }) },
    '../../../lib/warehouseDetailActions.js': { attachWarehouseRoundLabels: async (_, __, rows) => rows, recordWarehouseRoundLabel: async () => {} },
    '../../../lib/packingDuplicateCheck.js': { isMatchingDuplicateWarehouseRow: () => false },
  };
  new Function('require', 'module', 'exports', compiled)(k => mocks[k], out, out.exports);
  const handler = out.exports.default;

  const ss2User = { UserID: 'nenovaSS2', UserName: '설연주', DeptName: '', Authority: 2, isDeleted: false };

  // 1) GET ?manualOptions=1 succeeds for nenovaSS2 and caches for 5 minutes
  const optRes1 = mockResponse();
  await handler({ method: 'GET', query: { manualOptions: '1' }, user: ss2User }, optRes1);
  assert.equal(optRes1.statusCode, 200);
  assert.deepEqual(optRes1.payload.recentManualFarms, [{ farmName: 'HUB2', useCount: 2, lastWarehouseKey: 8257 }]);
  assert.equal(optRes1.payload.farms[0].CounName, '중국');
  const queriesAfterFirst = queryCount;
  assert.ok(queriesAfterFirst >= 2);

  const optRes2 = mockResponse();
  await handler({ method: 'GET', query: { manualOptions: '1' }, user: ss2User }, optRes2);
  assert.equal(optRes2.statusCode, 200);
  assert.equal(queryCount, queriesAfterFirst, 'second manualOptions call within 5m TTL must hit server cache');

  // 2) POST manual preview succeeds for nenovaSS2
  const manualPreviewRes = mockResponse();
  await handler({
    method: 'POST',
    user: ss2User,
    body: {
      source: 'manual',
      previewOnly: true,
      orderYear: '2026',
      orderWeek: '48-01',
      inputDate: '2026-11-27',
      farmName: 'HUB2',
      invoiceNo: '',
      awb: '',
      operationId: '58442b74-c6b2-4c7c-9e65-64e3f8162215',
      items: [{
        prodKey: 303,
        prodName: '수국 화이트',
        expectedOutUnit: '송이',
        expectedEstUnit: '송이',
        quantity: '150',
        quantityUnit: '송이',
        stemsPerBox: '',
        stemsPerBunch: '',
        amountMode: 'total',
        amount: '300',
      }],
    },
  }, manualPreviewRes);
  assert.equal(manualPreviewRes.statusCode, 200);
  assert.equal(manualPreviewRes.payload.manualPreview.length, 1);

  // 3) Non-manual packing upload is still 403 for nenovaSS2
  const nonManualRes = mockResponse();
  await handler({
    method: 'POST',
    user: ss2User,
    body: {
      orderYear: '2026',
      orderWeek: '48-01',
      inputDate: '2026-11-27',
      items: [{ prodName: '수국 화이트', boxQty: 1, bunchQty: 1, steamQty: 150 }],
    },
  }, nonManualRes);
  assert.equal(nonManualRes.statusCode, 403);
});

test('WarehouseManualUpload UI includes favorites registration and click-to-open farm combobox', () => {
  const uiSource = fs.readFileSync(new URL('../components/WarehouseManualUpload.js', import.meta.url), 'utf8');
  assert.match(uiSource, /즐겨찾기 등록/);
  assert.match(uiSource, /role="combobox"/);
  assert.match(uiSource, /aria-label="농장명"/);
  assert.match(uiSource, /onFocus=\{openDropdown\}/);
  assert.match(uiSource, /onClick=\{openDropdown\}/);
  assert.match(uiSource, /aria-label="농장명 연관 목록"/);
});
