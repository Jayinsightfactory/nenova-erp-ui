import assert from 'node:assert/strict';
import {
  buildImportKakaoDbCatalog,
  matchDbFarm,
  inferCountryAndGroupFromDb,
  isKnownCatalogProductLine,
} from '../lib/importKakaoDbCatalog.js';
import {
  normalizeFarmName,
  inferCountryFromFarm,
  farmTotals,
  importItemView,
  buildFarmSummary,
  formatFarmTransferText,
} from '../lib/importKakaoAdditions.js';
import {
  analyzeImportMessage,
  classifyImportFeed,
} from '../lib/importKakaoOrderText.js';

const fixtureCatalog = buildImportKakaoDbCatalog({
  farms: [
    { FarmKey: 18, FarmName: 'Antioquia', FarmCode: 'ANT', CounName: '콜롬비아' },
    { FarmKey: 21, FarmName: 'The Elite Flowers', FarmCode: 'ELI', CounName: '콜롬비아' },
    { FarmKey: 22, FarmName: 'FLORES Tiba', FarmCode: 'TIB', CounName: '콜롬비아' },
    { FarmKey: 25, FarmName: 'San Marino', FarmCode: 'SMR', CounName: '콜롬비아' },
    { FarmKey: 26, FarmName: 'Invos', FarmCode: 'INV', CounName: '콜롬비아' },
    { FarmKey: 27, FarmName: 'Florentina', FarmCode: 'FLT', CounName: '콜롬비아' },
    { FarmKey: 28, FarmName: 'Balverde', FarmCode: 'BAL', CounName: '콜롬비아' },
    { FarmKey: 29, FarmName: 'Natuflora', FarmCode: 'NAT', CounName: '콜롬비아' },
    { FarmKey: 32, FarmName: 'Matina', FarmCode: 'MAT', CounName: '콜롬비아' },
    { FarmKey: 30, FarmName: 'Grupo Valores', FarmCode: 'VAL', CounName: '콜롬비아' },
    { FarmKey: 31, FarmName: 'Florence', FarmCode: 'FLO', CounName: '콜롬비아' },
    { FarmKey: 40, FarmName: 'La Rosaleda', FarmCode: 'ROS', CounName: '에콰도르' },
    { FarmKey: 41, FarmName: 'Esmeralda', FarmCode: 'ESM', CounName: '에콰도르' },
    { FarmKey: 50, FarmName: 'Melody', FarmCode: 'MEL', CounName: '중국' },
    { FarmKey: 51, FarmName: 'CLOUD', FarmCode: 'CLD', CounName: '중국' },
    { FarmKey: 60, FarmName: 'Holex', FarmCode: 'HOL', CounName: '네덜란드' },
    { FarmKey: 70, FarmName: 'Super Fresh', FarmCode: 'SPF', CounName: '태국' },
    { FarmKey: 75, FarmName: 'Premium Greens', FarmCode: 'PMG', CounName: '호주' },
    { FarmKey: 80, FarmName: 'Hood Canal', FarmCode: 'HDC', CounName: '미국' },
    { FarmKey: 85, FarmName: 'NZ Blooms', FarmCode: 'NZB', CounName: '뉴질랜드' },
  ],
  warehouseFarms: [
    { FarmName: 'Lorzate', CounName: '콜롬비아', RecentCnt: 18 },
    { FarmName: 'Colibri', CounName: '콜롬비아', RecentCnt: 24 },
    { FarmName: 'Verdnatura', CounName: '콜롬비아', RecentCnt: 9 },
  ],
  products: [
    { ProdKey: 1001, ProdName: '뉴질랜드 작약 볼오브크림', FlowerName: '작약', CounName: '뉴질랜드', RecentSeasonOrders: 42, RecentOrders: 120, TotalOrders: 210 },
    { ProdKey: 1002, ProdName: '태국 덴파레 줄링', FlowerName: '덴파레', CounName: '태국', RecentSeasonOrders: 65, RecentOrders: 240, TotalOrders: 500 },
    { ProdKey: 1003, ProdName: '태국 덴파레 아지마', FlowerName: '덴파레', CounName: '태국', RecentSeasonOrders: 55, RecentOrders: 190, TotalOrders: 410 },
    { ProdKey: 1004, ProdName: '미국 상록수 더글라스', FlowerName: '상록수', CounName: '미국', RecentSeasonOrders: 90, RecentOrders: 398, TotalOrders: 820 },
    { ProdKey: 1005, ProdName: '국내 더글라스 운송료', FlowerName: '기타', CounName: '국내', RecentSeasonOrders: 50, RecentOrders: 200, TotalOrders: 400 },
    { ProdKey: 1006, ProdName: '[사용금지] 구형 줄링', FlowerName: '기타', CounName: '중국', RecentSeasonOrders: 99, RecentOrders: 999, TotalOrders: 999 },
    { ProdKey: 1007, ProdName: '호주 딩고펀', FlowerName: '펀', CounName: '호주', RecentSeasonOrders: 19, RecentOrders: 75, TotalOrders: 140 },
    { ProdKey: 1008, ProdName: '네덜란드 스키미아 레드', FlowerName: '스키미아', CounName: '네덜란드', RecentSeasonOrders: 48, RecentOrders: 160, TotalOrders: 310 },
    { ProdKey: 1009, ProdName: '네덜란드 카라 오데사', FlowerName: '카라', CounName: '네덜란드', RecentSeasonOrders: 31, RecentOrders: 110, TotalOrders: 220 },
    { ProdKey: 1010, ProdName: '중국 시네신스 화이트', FlowerName: '기타', CounName: '중국', RecentSeasonOrders: 60, RecentOrders: 220, TotalOrders: 460 },
    { ProdKey: 1011, ProdName: '중국 유칼리튭스_시네리아', FlowerName: '기타', CounName: '중국', RecentSeasonOrders: 45, RecentOrders: 180, TotalOrders: 350 },
    { ProdKey: 1012, ProdName: '중국 오니소갈룸 화이트', FlowerName: '오니소갈룸', CounName: '중국', RecentSeasonOrders: 22, RecentOrders: 88, TotalOrders: 150 },
    { ProdKey: 1013, ProdName: '콜롬비아 카네이션 카라멜', FlowerName: '카네이션', CounName: '콜롬비아', RecentSeasonOrders: 40, RecentOrders: 150, TotalOrders: 300 },
    { ProdKey: 1014, ProdName: '콜롬비아 장미 레드팬서', FlowerName: '장미', CounName: '콜롬비아', RecentSeasonOrders: 37, RecentOrders: 135, TotalOrders: 270 },
    { ProdKey: 1015, ProdName: '중국 보리사초', FlowerName: '기타', CounName: '중국', RecentSeasonOrders: 28, RecentOrders: 95, TotalOrders: 190 },
    { ProdKey: 1016, ProdName: '이스라엘 왁스플라워 화이트', FlowerName: '왁스', CounName: '이스라엘', RecentSeasonOrders: 12, RecentOrders: 40, TotalOrders: 90 },
  ],
});

const knownFarms = fixtureCatalog.knownFarms;
const opts = { dbCatalog: fixtureCatalog, knownFarms, inheritContext: true };
const msg = (text, id = 'm1', time = '2026년 11월 25일 오전 10:00', sender = '수입담당') => ({
  id,
  time,
  text,
  sender,
  items: [],
});

// Axis A: DB Farm Master canonical matching & false-farm repair (no '농장 미지정' on normal orders)
{
  const farmExpectations = [
    ['안티오퀴아', 'Antioquia', '콜롬비아'],
    ['산 마리노', 'San Marino', '콜롬비아'],
    ['인보스 농장', 'Invos', '콜롬비아'],
    ['로살레다', 'La Rosaleda', '에콰도르'],
    ['로사레다', 'La Rosaleda', '에콰도르'],
    ['BA', 'Balverde', '콜롬비아'],
    ['FL', 'Florentina', '콜롬비아'],
    ['플로렌티나', 'Florentina', '콜롬비아'],
    ['네추럴', 'Natuflora', '콜롬비아'],
    ['발로레스', 'Grupo Valores', '콜롬비아'],
    ['Lorzate', 'Lorzate', '콜롬비아'],
    ['Colibri', 'Colibri', '콜롬비아'],
    ['Verdnatura', 'Verdnatura', '콜롬비아'],
    ['PREMIUM GREEN', 'Premium Greens', '호주'],
    ['클라우드', 'CLOUD', '중국'],
    ['Flora Concept', 'The Elite Flowers', '콜롬비아'],
    ['플로라컨셉', 'The Elite Flowers', '콜롬비아'],
    ['Zelecta', 'Matina', '콜롬비아'],
    ['아구아클라라', 'Matina', '콜롬비아'],
  ];
  for (const [raw, expectedFarm, expectedCountry] of farmExpectations) {
    const matched = matchDbFarm(raw, fixtureCatalog);
    assert.equal(matched.matched, true, `Expected DB match for ${raw}`);
    assert.equal(matched.farmName, expectedFarm, raw);
    assert.equal(matched.country, expectedCountry, raw);
    assert.equal(normalizeFarmName(raw, knownFarms), expectedFarm, raw);
    assert.equal(inferCountryFromFarm(raw, knownFarms), expectedCountry, raw);
  }

  // False-farm repairs: cultivar '아지마' in farm -> product '아지마 XL', CL code '[CLR]' -> customer 'CLR', '(지정 농장)' -> note
  const falseFarmMsg = analyzeImportMessage(
    msg('49-1 발주 추가\n[아지마] XL 100스팀\n[CLR] 줄링 20단\n주광 : 버건디 10박스(지정 농장)', 'ff1'),
    new Map(),
    opts
  );
  assert.equal(falseFarmMsg.kind, 'addition');
  assert.equal(falseFarmMsg.items[0].farm, '');
  assert.equal(falseFarmMsg.items[0].product, '아지마 XL');
  assert.equal(falseFarmMsg.items[0].country, '태국');
  assert.equal(falseFarmMsg.items[1].farm, '');
  assert.equal(falseFarmMsg.items[1].customer, 'CLR');
  assert.equal(falseFarmMsg.items[1].country, '태국');
  assert.equal(falseFarmMsg.items[2].farm, '');

  // PR #2024 invariant: ordinary orders without farm keep farm === '' and never output '농장 미지정' / 'Farm TBD'
  const summary = buildFarmSummary(farmTotals(falseFarmMsg.items.map(i => importItemView(i)), { knownFarms }));
  const transferKo = formatFarmTransferText(summary, { format: 'concise', lang: 'ko' });
  const transferEn = formatFarmTransferText(summary, { format: 'concise', lang: 'en' });
  assert.doesNotMatch(transferKo, /농장\s*미지정|Farm\s*TBD/i);
  assert.doesNotMatch(transferEn, /농장\s*미지정|Farm\s*TBD/i);
}

// Axis B: ERP DB Product + OrderDetail 12-country & flower-group inference ('국가 미상' elimination)
{
  const multiCountryOrder = analyzeImportMessage(
    msg([
      '49-1 발주 추가',
      '볼오브크림 80스팀',
      '줄링 10단',
      '아지마 XL 100스팀',
      '더글라스 50박스',
      '딩고펀 1박스',
      '스키미아 60단',
      '오데사 400송이',
      '시네신스 화이트 20단',
      '시네리아 100단',
      '오니소갈룸 화이트 20단',
      '카라멜 10박스',
      '레드팬서 20단',
      '왁스플라워 화이트 5박스',
    ].join('\n'), 'mc1'),
    new Map(),
    opts
  );
  assert.equal(multiCountryOrder.kind, 'addition');
  const byProd = new Map(multiCountryOrder.items.map(i => [i.product, i]));
  assert.equal(byProd.get('볼오브크림').country, '뉴질랜드');
  assert.equal(byProd.get('볼오브크림').group, '작약');
  assert.equal(byProd.get('줄링').country, '태국');
  assert.equal(byProd.get('아지마 XL').country, '태국');
  // Domestic '더글라스 운송료' and '[사용금지]' must never pollute US Douglas or Thai Juling!
  assert.equal(byProd.get('더글라스').country, '미국');
  assert.equal(byProd.get('더글라스').group, '상록수');
  assert.equal(byProd.get('딩고펀').country, '호주');
  assert.equal(byProd.get('스키미아').country, '네덜란드');
  assert.equal(byProd.get('스키미아').group, '스키미아');
  assert.equal(byProd.get('오데사').country, '네덜란드');
  assert.equal(byProd.get('오데사').group, '카라');
  // Verified group aliases ('시네신스 화이트' -> '리모늄', '시네리아' -> '기타') remain authoritative
  assert.equal(byProd.get('시네신스 화이트').country, '중국');
  assert.equal(byProd.get('시네신스 화이트').group, '리모늄');
  assert.equal(byProd.get('시네리아').country, '중국');
  assert.equal(byProd.get('시네리아').group, '기타');
  assert.equal(byProd.get('화이트').country, '중국');
  assert.equal(byProd.get('화이트').group, '오니소갈룸');
  // '카라멜' must NOT match '카라' -> resolves to Colombia Carnation!
  assert.equal(byProd.get('카라멜').country, '콜롬비아');
  assert.equal(byProd.get('카라멜').group, '카네이션');
  assert.equal(byProd.get('레드팬서').country, '콜롬비아');
  assert.equal(byProd.get('레드팬서').group, '장미');
  assert.equal(byProd.get('왁스플라워 화이트').country, '이스라엘');
  assert(multiCountryOrder.items.every(i => Boolean(i.country)));
}

// Axis C: Compound cancel+add splitting, Hard Recall guards, v1 LLM cache rescue, non-order shields & context inheritance
{
  // C1. Arrow cultivar replacement: 줄링 --> 아지마 대체 300단
  const rep = analyzeImportMessage(msg('49-1 줄링 --> 아지마 대체 300단', 'c1'), new Map(), opts);
  assert.equal(rep.kind, 'review');
  const repLive = rep.items.filter(i => !i.cancelled);
  assert.equal(repLive.length, 1);
  assert.equal(repLive[0].product, '아지마');
  assert.equal(repLive[0].quantity, '300');
  assert.equal(repLive[0].country, '태국');
  assert.equal(rep.excludedItems.length, 1);
  assert.equal(rep.excludedItems[0].product, '줄링');
  assert.equal(rep.excludedItems[0].quantity, '300');

  // C2. Remainder cancel + send to CL1: 보리사초 나머지 수량은 취소 하고 48-2차 1박스(30단) CL1에 보내주세요
  const conj = analyzeImportMessage(
    msg('보리사초 나머지 수량은 취소 하고 48-2차 1박스(30단) CL1에 보내주세요', 'c2'),
    new Map(),
    opts
  );
  assert.equal(conj.kind, 'review');
  const conjLive = conj.items.filter(i => !i.cancelled);
  assert.equal(conjLive.length, 1);
  assert.equal(conjLive[0].product, '보리사초');
  assert.equal(conjLive[0].customer, 'CL1');
  assert.equal(conjLive[0].quantity, '1');
  assert.equal(conjLive[0].unit, '박스');
  assert.equal(conjLive[0].week, '48-02');
  assert.equal(conjLive[0].country, '중국');
  assert.equal(conj.excludedItems.length, 1);
  assert.equal(conj.excludedItems[0].product, '보리사초');

  // C3. Multi-CL comma cancellation: 줄링 CL52 40단, CL10 30단 모두 취소
  const multiCl = analyzeImportMessage(msg('49-1 줄링 CL52 40단, CL10 30단 모두 취소', 'c3'), new Map(), opts);
  assert.equal(multiCl.kind, 'review');
  assert.equal(multiCl.excludedItems.length, 2);
  assert.deepEqual(
    multiCl.items.map(i => [i.customer, i.product, i.quantity, i.unit, i.cancelled, i.country]),
    [
      ['CL52', '줄링', '40', '단', true, '태국'],
      ['CL10', '줄링', '30', '단', true, '태국'],
    ]
  );

  // C4. Hard Recall on quantity + cancel/modify prose & stale v1 LLM cleaned cache rescue
  for (const recallText of [
    'CLS 480단은 취소되어야합니다',
    '아스파라거스 350단으로 줄인다고 해서 확인중입니다',
    '중복입니다. 총 40단만 들어오면 됩니다',
    '노비아는 420 로얄다마스커스는 빼주세요',
    '체리오 > 700 마제스타 > 250 으로 수정후 보내주시면 감사하겠습니다',
    '퀵샌드 75~80cm로 변경',
  ]) {
    const res = analyzeImportMessage(
      { ...msg(recallText, 'hr'), order_parsed: { kind: 'cleaned', provider: 'claude-sub', cleanReason: 'v1 오분류' } },
      new Map(),
      opts
    );
    assert.notEqual(res.kind, 'excluded', `Must rescue from excluded: ${recallText}`);
  }

  // C5. Non-order logistics / AWB / box dimension / price inquiry / complaint shields stay excluded
  for (const nonOrder of [
    'AWB 784-69519262 KE412 선적 완료',
    '100*30*20',
    '카라 오데사 400스팀 필요합니다. 가격 네고 가능한지 문의드립니다.',
    '이번에 온 더글라스 3박스가 포장 불량입니다',
    '47차 미국 더글라스 ETA 11월19일 도착 일정 확인',
  ]) {
    const res = analyzeImportMessage(msg(nonOrder, 'no'), new Map(), opts);
    assert.equal(res.kind, 'excluded', `Must keep non-order excluded: ${nonOrder}`);
  }

  // C6. Conversational context inheritance (same sender/close timestamp inherits week & country; cross-year stays isolated)
  const feed = classifyImportFeed(
    {
      messages: [
        msg('화이트 15단 취소해주세요', 'f3', '2026년 11월 25일 오전 10:04', '김대리'),
        msg('볼오브크림 80스팀 추가해주세요', 'f2', '2026년 11월 25일 오전 10:02', '김대리'),
        msg('49-1 네덜란드 스키미아 발주 추가\n화이트 15단\n레드 20단', 'f1', '2026년 11월 25일 오전 10:00', '김대리'),
        msg('볼오브크림 50스팀 추가해주세요', 'fOld', '2025년 11월 25일 오전 10:01', '김대리'),
      ],
    },
    new Map(),
    opts
  );
  // f2 inherited week '49-01' from f1, while keeping DB-inferred country '뉴질랜드' (not overwritten by '네덜란드'!)
  const mF2 = feed.messages.find(m => m.id === 'f2');
  assert.ok(mF2, 'f2 promoted to addition after week inheritance');
  assert.equal(mF2.items[0].week, '49-01');
  assert.equal(mF2.items[0].country, '뉴질랜드');
  assert.equal(mF2.items[0].group, '작약');

  // f3 ('화이트 15단 취소해주세요') inherited week '49-01' + country '네덜란드' from f1 and triggered cancellation review on f1!
  const mF1InReview = feed.review.find(m => m.id === 'f1');
  assert.ok(mF1InReview, 'f1 moved to review due to matching follow-up cancellation f3');

  // fOld (2025) never inherited 2026 week
  const mFOld = feed.review.find(m => m.id === 'fOld');
  assert.ok(mFOld);
  assert.equal(mFOld.items[0].week, '');
}

console.log('PASS Axis A (DB Farm Master), Axis B (12-country ERP Product inference), Axis C (Compound split, Hard Recall & Context Inheritance)');
