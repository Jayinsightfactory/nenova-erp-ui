import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildImportKakaoDbCatalog,
  expandKoreanPhoneticKeys,
  matchDbEnglishProductName,
  searchCatalogProducts,
} from '../lib/importKakaoDbCatalog.js';
import {
  KAKAO_DB_PRODUCT_ALIASES_KEY,
  buildKakaoProductAliasId,
  mergeKakaoProductAliasMaps,
  resolveKakaoProductAlias,
  upsertKakaoProductAliasMap,
} from '../lib/importKakaoDbProductAliases.js';
import { classifyImportFeed } from '../lib/importKakaoOrderText.js';
import {
  buildFarmSummary,
  farmTotals,
  formatFarmCardText,
  formatFarmTransferText,
  importItemView,
} from '../lib/importKakaoAdditions.js';
import { listImportTeamHistory, readImportTeamRecord } from '../lib/importTeamStore.js';
import { handleKakaoProductAliasesRequest } from '../lib/importKakaoDbProductAliasesApi.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

const sampleCatalog = buildImportKakaoDbCatalog({
  farms: [
    { FarmKey: 101, FarmCode: 'SF', FarmName: 'Super Fresh', CounName: '태국' },
    { FarmKey: 102, FarmCode: 'EL', FarmName: 'The Elite Flowers', CounName: '콜롬비아' },
  ],
  products: [
    // Exact MSSQL dbo.Product rows from Thailand verified in production (#35)
    {
      ProdKey: 510,
      ProdCode: 'TH-ARAN-JL-XL',
      ProdName: 'ARAN.Juling Red XL',
      DisplayName: '태국 아란 줄링 레드 XL',
      FlowerName: '아란',
      CounName: '태국',
      RecentSeasonOrders: 18,
    },
    {
      ProdKey: 608,
      ProdCode: 'TH-DEN-WB-M',
      ProdName: 'Den. White Bom (화이트) M',
      DisplayName: 'DEN. 화이트 BOM (화이트) M',
      FlowerName: '화이트붐',
      CounName: '태국',
      RecentSeasonOrders: 12,
    },
    {
      ProdKey: 631,
      ProdCode: 'TH-DEN-WB-L',
      ProdName: 'Den. White Bom (화이트) L',
      DisplayName: 'DEN. 화이트 BOM (화이트) L',
      FlowerName: '화이트붐',
      CounName: '태국',
      RecentSeasonOrders: 20,
    },
    {
      ProdKey: 618,
      ProdCode: 'TH-DEN-WB-XL',
      ProdName: 'Den. White Bom (화이트) XL',
      DisplayName: 'DEN. 화이트 BOM (화이트) XL',
      FlowerName: '화이트붐',
      CounName: '태국',
      RecentSeasonOrders: 15,
    },
    // Pure English dbo.Product rows without Korean FlowerName (tests phonetic stem decomposition)
    {
      ProdKey: 701,
      ProdCode: 'TH-DEN-RS-XL',
      ProdName: 'Den. Red Star XL',
      DisplayName: 'Den. Red Star XL',
      FlowerName: '기타',
      CounName: '태국',
      RecentSeasonOrders: 5,
    },
    {
      ProdKey: 702,
      ProdCode: 'TH-DEN-PQ-M',
      ProdName: 'Den. Pink Queen M',
      DisplayName: 'Den. Pink Queen M',
      FlowerName: '덴파레',
      CounName: '태국',
      RecentSeasonOrders: 4,
    },
    {
      ProdKey: 801,
      ProdCode: 'NL-CAMP-WB-60',
      ProdName: 'Campanula White Bell 60cm',
      DisplayName: 'Campanula White Bell 60cm',
      FlowerName: '기타',
      CounName: '네덜란드',
      RecentSeasonOrders: 6,
    },
  ],
});

// 1. Korean phonetic stem decomposition & exact Thailand '화이트붐 M' -> 'Den. White Bom M' (ProdKey 608) auto-match
{
  const phon = expandKoreanPhoneticKeys('화이트붐 M');
  assert.ok(phon.compoundKeys.includes('whiteboom'));
  assert.ok(phon.compoundKeys.includes('whitebom'));

  // Exact boss screenshot scenario: 태국 2026/46차 줄링 XL + 화이트붐 M
  const feed = classifyImportFeed(
    {
      messages: [
        {
          id: 'th-46-1',
          time: '2026년 11월 12일 오전 11:10',
          sender: '수입팀',
          text: ['태국 46차 선발주 추가', '줄링 XL 20단', '화이트붐 M 110단 선발주'].join('\n'),
        },
      ],
    },
    new Map(),
    { dbCatalog: sampleCatalog, knownFarms: sampleCatalog.knownFarms },
  );

  assert.equal(feed.messages.length, 1);
  const viewed = feed.messages[0].items.map((it) => importItemView(it));
  const totals = farmTotals(viewed, { knownFarms: sampleCatalog.knownFarms });
  const summary = buildFarmSummary(totals, { knownFarms: sampleCatalog.knownFarms });
  assert.equal(summary.cards.length, 1);

  const juling = summary.cards[0].items.find((r) => r.product.includes('줄링'));
  const whiteBoom = summary.cards[0].items.find((r) => r.product.includes('화이트붐'));
  assert.equal(juling.dbProdName, 'ARAN.Juling Red XL');
  assert.equal(whiteBoom.dbProdName, 'Den. White Bom M');
  assert.equal(whiteBoom.dbProdKey, 608);

  // Even when item.group is explicitly '덴파레' while dbo.Product.FlowerName was '화이트붐', it still matches ProdKey 608!
  const withGroup = matchDbEnglishProductName(
    { country: '태국', group: '덴파레', product: '화이트붐 M' },
    sampleCatalog,
  );
  assert.equal(withGroup.dbProdName, 'Den. White Bom M');
  assert.equal(withGroup.dbProdKey, 608);

  // Pure phonetic compounds without Korean in dbo.Product
  assert.equal(
    matchDbEnglishProductName({ country: '태국', product: '레드스타 XL' }, sampleCatalog).dbProdName,
    'Den. Red Star XL',
  );
  assert.equal(
    matchDbEnglishProductName({ country: '태국', product: '핑크퀸 M' }, sampleCatalog).dbProdName,
    'Den. Pink Queen M',
  );
  assert.equal(
    matchDbEnglishProductName({ country: '네덜란드', product: '화이트벨 60cm' }, sampleCatalog).dbProdName,
    'Campanula White Bell 60cm',
  );
}

// 2. Real-time dbo.Product search prioritization (country-first + allCountries toggle)
{
  const thaiResults = searchCatalogProducts(sampleCatalog, {
    query: '화이트붐',
    country: '태국',
    allCountries: false,
  });
  assert.ok(thaiResults.length >= 3);
  assert.ok(thaiResults.every((r) => r.country === '태국'));
  assert.ok(thaiResults.some((r) => r.prodKey === 608 && r.englishName === 'Den. White Bom M'));

  const crossResults = searchCatalogProducts(sampleCatalog, {
    query: 'White Bell',
    country: '태국',
    allCountries: true,
  });
  assert.ok(crossResults.some((r) => r.prodKey === 801 && r.country === '네덜란드'));
}

// 3. Shared server persistence (importTeamStore kakao.db-product-aliases), custom direct input, sync, delete & cross-week reuse
{
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'nenova-kakao-prod-alias-'));
  try {
    const importUser = { userId: 'imp01', userName: '김수입', deptName: '수입부', authority: 4 };
    const salesUser = { userId: 'sal01', userName: '박영업', deptName: '영업부', authority: 2 };

    // 3a. Unauthorized user rejected with 403
    {
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        { method: 'GET', user: salesUser, query: {} },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 403);
    }

    // 3b. Save DB-registered match via POST upsert
    {
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        {
          method: 'POST',
          user: importUser,
          body: {
            action: 'upsert',
            country: '태국',
            product: '화이트붐 스페셜 M',
            dbProdName: 'Den. White Bom M',
            dbProdKey: 608,
          },
        },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.revision, 1);
      assert.equal(res.body.saved.dbProdKey, 608);
    }

    // 3c. Save DB-unregistered brand-new variety via direct English input (dbProdKey: null)
    {
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        {
          method: 'POST',
          user: importUser,
          body: {
            action: 'upsert',
            country: '태국',
            product: '뉴골든붐 XL',
            dbProdName: 'Den. New Golden Boom XL',
            dbProdKey: null,
            isCustom: true,
          },
        },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.revision, 2);
      assert.equal(res.body.saved.isCustom, true);
      assert.equal(res.body.saved.dbProdName, 'Den. New Golden Boom XL');
    }

    // 3d. Sync browser localStorage backup entries via POST action='sync'
    {
      const localMap = upsertKakaoProductAliasMap(
        {},
        {
          country: '콜롬비아',
          product: '신품종장미 60cm',
          dbProdName: 'Rose Aurora Pink 60cm',
          dbProdKey: null,
          isCustom: true,
          updatedAt: '2026-11-27T07:00:00.000Z',
        },
      );
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        {
          method: 'POST',
          user: importUser,
          body: { action: 'sync', aliases: localMap },
        },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.synced, true);
      assert.equal(res.body.revision, 3);
      assert.ok(res.body.aliases[buildKakaoProductAliasId('콜롬비아', '신품종장미 60cm')]);
    }

    // 3e. Verify persisted record & audit history in importTeamStore, plus cross-week automatic reuse in week 47!
    const stored = await readImportTeamRecord(KAKAO_DB_PRODUCT_ALIASES_KEY, { root: tempRoot });
    assert.equal(stored.revision, 3);
    const history = await listImportTeamHistory({ root: tempRoot });
    assert.equal(history.length, 3);
    assert.ok(history.every((h) => h.userId === 'imp01'));

    const nextWeekFeed = classifyImportFeed(
      {
        messages: [
          {
            id: 'th-47-next',
            time: '2026년 11월 19일 오전 10:00',
            sender: '수입팀',
            text: ['태국 47차 선발주 추가', '뉴골든붐 XL 45단 선발주'].join('\n'),
          },
        ],
      },
      new Map(),
      {
        dbCatalog: sampleCatalog,
        knownFarms: sampleCatalog.knownFarms,
        productAliases: stored.value,
      },
    );
    const nextViewed = nextWeekFeed.messages[0].items.map((it) => importItemView(it));
    assert.equal(nextViewed[0].dbProdName, 'Den. New Golden Boom XL');
    assert.equal(nextViewed[0].isManualDbAlias, true);

    // 3f. Immediate reflection in farmTotals, buildFarmSummary, formatFarmCardText & formatFarmTransferText
    const totals = farmTotals(nextViewed, {
      knownFarms: sampleCatalog.knownFarms,
      productAliases: stored.value,
    });
    const summary = buildFarmSummary(totals, {
      knownFarms: sampleCatalog.knownFarms,
      productAliases: stored.value,
    });
    const cardText = formatFarmCardText(summary.cards[0], { format: 'concise', lang: 'en' });
    const allTransferText = formatFarmTransferText(summary, { format: 'concise', lang: 'en' });
    assert.match(cardText, /1\. Den\. New Golden Boom XL - 45 bunches \/ 선발주/);
    assert.match(allTransferText, /1\. Den\. New Golden Boom XL - 45 bunches \/ 선발주/);

    // 3g. DELETE resets manual alias cleanly
    {
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        {
          method: 'DELETE',
          user: importUser,
          body: { country: '태국', product: '뉴골든붐 XL' },
        },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.revision, 4);
      assert.equal(resolveKakaoProductAlias(res.body.aliases, { country: '태국', product: '뉴골든붐 XL' }), null);
    }

    // 3h. GET with search=1 returns both current aliases and ranked dbo.Product candidates
    {
      const res = createMockRes();
      await handleKakaoProductAliasesRequest(
        {
          method: 'GET',
          user: importUser,
          query: { search: '1', q: '줄링', country: '태국' },
        },
        res,
        { root: tempRoot, loadCatalog: async () => sampleCatalog },
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.revision, 4);
      assert.ok(Array.isArray(res.body.products));
      assert.equal(res.body.products[0].englishName, 'ARAN.Juling Red XL');
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

// 4. Local-server merge conflict resolution (newer timestamp wins)
{
  const older = upsertKakaoProductAliasMap(
    {},
    {
      country: '태국',
      product: '화이트붐 M',
      dbProdName: 'Den. Old Name M',
      updatedAt: '2026-11-27T01:00:00.000Z',
    },
  );
  const newer = upsertKakaoProductAliasMap(
    {},
    {
      country: '태국',
      product: '화이트붐 M',
      dbProdName: 'Den. White Bom M',
      dbProdKey: 608,
      updatedAt: '2026-11-27T06:00:00.000Z',
    },
  );
  const merged = mergeKakaoProductAliasMaps(older, newer);
  assert.equal(merged.changed, true);
  assert.equal(
    resolveKakaoProductAlias(merged.merged, { country: '태국', product: '화이트붐 M' })?.dbProdName,
    'Den. White Bom M',
  );
}

// 5. Zero-Lag single-row editor mount & Anti-AI Slop / Read-Only ERP invariants
{
  const uiSource = fs.readFileSync(new URL('../components/import-tools/KakaoAdditions.js', import.meta.url), 'utf8');
  const editorSource = fs.readFileSync(
    new URL('../components/import-tools/KakaoDbProdEditor.js', import.meta.url),
    'utf8',
  );
  const apiSource =
    fs.readFileSync(new URL('../pages/api/import/tools/kakao-product-aliases.js', import.meta.url), 'utf8') +
    '\n' +
    fs.readFileSync(new URL('../lib/importKakaoDbProductAliasesApi.js', import.meta.url), 'utf8');

  // Single-row conditional mount only on editingDbProdKey === item.key
  assert.match(uiSource, /editingDbProdKey\s*===\s*item\.key\s*\?\s*\(\s*<KakaoDbProdInlineEditor/);
  assert.equal((uiSource.match(/<KakaoDbProdInlineEditor\b/g) || []).length, 1);
  assert.match(uiSource, /DB 품목 지정/);
  assert.match(uiSource, /kakao-db-matched-btn/);
  assert.match(editorSource, /수동지정 초기화/);
  assert.match(editorSource, /전체 국가 검색/);

  // Zero standalone monospace, zero decorative emojis, zero slop phrases, zero SQL writes
  for (const src of [uiSource, editorSource]) {
    assert.doesNotMatch(src, /\bmonospace\b|JetBrains\s+Mono/i);
    assert.doesNotMatch(src, /[🚀✨🔥💡🤖]/u);
    assert.doesNotMatch(src, /감시|추적|모니터링|절감시간/);
  }
  assert.doesNotMatch(apiSource, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s+INTO\b/i);
}

console.log('PASS Kakao DB English product transliteration auto-match, inline search/custom alias editor & shared persistence');
