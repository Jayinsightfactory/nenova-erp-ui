import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  stripKakaoLineEnvelope,
  isSummaryTotalLine,
  parseOrderItemLine,
  extractFarmHeader,
  normalizeLlmOrderParsed,
  analyzeImportMessage,
  classifyImportFeed,
  parsePastedKakaoChat,
  latestImportFeed,
} from '../lib/importKakaoOrderText.js';
import { readImportArchive } from '../lib/importKakaoArchive.js';
import {
  aggregateErpOrderRows,
  classifyKakaoItemErpStatus,
  indexFarmOrderEvidence,
  summarizeFarmOrderRegistration,
} from '../lib/kakaoOrderErpStatus.js';
import {
  normalizeFarmName,
  inferCountryFromFarm,
  normalizeOrderUnit,
  extractProductSpec,
  summarizeUnitQuantities,
  farmTotals,
  importItemView,
  matchesCountryOrderScope,
  matchesCleanedScope,
  formatCleanedSingleLine,
  buildFarmSummary,
  formatFarmCardText,
  formatFarmTransferText,
} from '../lib/importKakaoAdditions.js';

const msg = (text, id = 'm1', time = '2026년 11월 25일 오전 9:30') => ({ id, time, text, sender: 'fixture', items: [] });

// The farm transfer keeps its signed total and uses the original rows for registration status.
{
  const row = { year: '2026', week: '48-1', country: '콜롬비아', group: '장미', product: 'Mondial', unit: '단', checked: true, dbProdKey: 7 };
  const rows = [
    { ...row, key: 'registered', customer: '주광', quantity: '10' },
    { ...row, key: 'new', customer: '태림원예', quantity: '3' },
    { ...row, key: 'short', quantity: '-2', sign: -1, minusKind: '현지이슈' },
  ];
  const customers = [{ CustKey: 1, CustName: '주광' }, { CustKey: 2, CustName: '태림원예' }];
  const ledgerRow = { OrderYear: '2026', OrderWeek: '48-01', CustKey: 1, ProdKey: 7, OrderMasterKey: 100, ProdName: 'Mondial', FlowerName: '장미', CounName: '콜롬비아', BunchQuantity: 10 };
  const entriesFor = (orders, sourceRows = rows) => sourceRows.map(item => ({
    key: item.key,
    row: item,
    evaluation: classifyKakaoItemErpStatus(item, { customers, erpOrders: aggregateErpOrderRows(orders) }),
  }));
  const summary = buildFarmSummary(farmTotals(rows));
  const transferText = formatFarmTransferText(summary);
  const item = summary.cards[0].items[0];
  const index = new Map(rows.map(entry => [entry.key, entry]));
  const status = (entries, keys = item.sourceKeys, rowIndex = index, extra = {}) => summarizeFarmOrderRegistration(keys, rowIndex, {
    current: true,
    byKey: new Map(entries.map(entry => [entry.key, entry])),
    sourceKeysByEvidence: indexFarmOrderEvidence(entries),
    ...extra,
  });
  const entries = entriesFor([ledgerRow, { ...ledgerRow, OrderYear: '2025', CustKey: 2, OrderMasterKey: 99, BunchQuantity: 3 }]);
  assert.equal(status(entries).label, '주문등록 완료 1/2 · 미등록 1건');
  assert.equal(status(entries, ['registered']).label, '주문등록 완료');
  assert.equal(status(entries, ['registered', 'short']).label, '추가분 주문등록 완료');
  assert.equal(status(entries, ['short']), null);
  assert.equal(status(entries, ['registered'], index, { current: false, error: '조회 실패' }).label, '주문등록 대조 불가');
  assert.equal(status(entries, ['registered'], index, { current: false }).label, '주문등록 대조 중');
  assert.equal(status(entriesFor([{ ...ledgerRow, BunchQuantity: 9 }]), ['registered']).label, '수량차이 1건');
  const duplicate = { ...rows[0], key: 'other-original' };
  const shared = entriesFor([ledgerRow], [...rows, duplicate]);
  assert.equal(status(shared, ['registered']).label, '대조 필요 1건');
  assert.equal(item.quantity, 11);
  assert.equal(formatFarmTransferText(summary), transferText);
  assert.doesNotMatch(transferText, /주문등록|수량차이|대조 필요/);
  assert.match(fs.readFileSync('components/import-tools/KakaoAdditions.js', 'utf8'), /summarizeFarmOrderRegistration\(line\.sourceKeys,/);
}

// 1. Kakao PC & Mobile copy-paste headers, date dividers, media & greeting noise removal
{
  assert.equal(stripKakaoLineEnvelope('--------------- 2026년 11월 25일 수요일 ---------------').text, '');
  assert.equal(stripKakaoLineEnvelope('2026년 11월 25일 수요일').text, '');
  assert.equal(stripKakaoLineEnvelope('[정재훈] [오전 9:25] 화이트 10박스').text, '화이트 10박스');
  assert.equal(stripKakaoLineEnvelope('2026. 11. 25. 오후 2:10, 김대리 : 몬디알 60cm 5FB').text, '몬디알 60cm 5FB');
  for (const noise of ['[홍길동] [오전 10:00] 사진', '[홍길동] [오전 10:01] 이모티콘', '네 확인했습니다', '감사합니다', '수고하세요^^', 'ㅇㅋ']) {
    assert.equal(stripKakaoLineEnvelope(noise).text, '', noise);
  }
  const parsed = analyzeImportMessage(msg(
    '--- 2026년 11월 25일 수요일 ---\n[정재훈] [오전 9:25] 47-2 콜 수국 발주 추가\n[정재훈] [오전 9:25] 화이트 10박스\n[김대리] [오전 9:26] 네 확인했습니다\n[김대리] [오전 9:26] 이모티콘'
  ));
  assert.equal(parsed.kind, 'addition');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].product, '화이트');
  assert.equal(parsed.items[0].quantity, '10');
}

// 2. Multi-farm context block headers ([국가] 농장명, ■ 농장, ▶ 농장, 농장명:, <농장명>, uppercase)
{
  const blockText = [
    '47-2 발주 추가',
    '[콜롬비아] 플로렌스 농장',
    '몬디알 60cm 5FB',
    '■ Melody',
    '시네신스 화이트 20단',
    '▶ CLOUD',
    '안슬레이 15단',
    '농장명 : Apollo',
    '킹프로테아 40본',
    '<San Marino>',
    '문라이트 3HB',
    'BELLA ROSA',
    '익스플로러 60cm 2FB',
  ].join('\n');
  const parsed = analyzeImportMessage(msg(blockText));
  assert.equal(parsed.kind, 'addition');
  assert.deepEqual(
    parsed.items.map(i => [i.farm, i.product, i.quantity, i.unit]),
    [
      ['플로렌스', '몬디알 60cm', '5', 'FB'],
      ['Melody', '시네신스 화이트', '20', '단'],
      ['CLOUD', '안슬레이', '15', '단'],
      ['Apollo', '킹프로테아', '40', '송이'],
      ['San Marino', 'Moon Light', '3', 'HB'],
      ['Bella Rosa', '익스플로러 60cm', '2', 'FB'],
    ]
  );
  assert.equal(parsed.items[0].country, '콜롬비아');
}

// 3. Inline farm + product + spec + quantity patterns (preserving generic "(지정 농장)" as non-farm note)
{
  const inlineText = [
    '47-2 콜 장미 발주 추가',
    '[엘리떼] 몬디알 60cm 4FB',
    '티바 익스플로러 50cm 2HB',
    'Melody : 캐서린 30단',
    '주광 : 버건디 5박스(지정 농장)',
  ].join('\n');
  const parsed = analyzeImportMessage(msg(inlineText));
  assert.equal(parsed.kind, 'addition');
  assert.deepEqual(
    parsed.items.map(i => [i.farm, i.customer, i.product, i.quantity, i.unit]),
    [
      ['The Elite Flowers', '', '몬디알 60cm', '4', 'FB'],
      ['FLORES Tiba', '', '익스플로러 50cm', '2', 'HB'],
      ['Melody', '', '캐서린', '30', '단'],
      ['', '주광', '버건디', '5', '박스'],
    ]
  );
}

// 4. Fuzzy / normalized matching against screen-registered knownFarms prevents duplicate farm split
{
  const knownFarms = [
    { FarmName: 'The Elite Flowers', FarmCode: 'ELI' },
    { FarmName: 'San Marino Farms', FarmCode: 'SMF' },
    'Melody',
    'HUBFRESH',
  ];
  for (const variant of ['엘리떼', '엘리테 농장', 'ELITE', 'the elite flowers']) {
    assert.equal(normalizeFarmName(variant, knownFarms), 'The Elite Flowers', variant);
  }
  for (const variant of ['SAN MARINO', 'san marino 농장', 'San Marino']) {
    assert.equal(normalizeFarmName(variant, knownFarms), 'San Marino Farms', variant);
  }
  for (const variant of ['허브프레시', '허브프레쉬', 'hub fresh', 'HUBFRESH']) {
    assert.equal(normalizeFarmName(variant, knownFarms), 'HUBFRESH', variant);
  }
  const m1 = analyzeImportMessage(msg('47-2 콜 장미 발주 추가\n■ 엘리떼 농장\n몬디알 60cm 3FB'), new Map(), { knownFarms });
  const m2 = analyzeImportMessage(msg('47-2 콜 장미 발주 추가\n[ELITE]\n몬디알 60CM 2FB', 'm2'), new Map(), { knownFarms });
  const summed = farmTotals([...m1.items, ...m2.items].map(i => importItemView(i)), { knownFarms });
  assert.equal(summed.length, 1);
  assert.equal(summed[0].farm, 'The Elite Flowers');
  assert.equal(summed[0].quantity, 5);
  assert.equal(summed[0].unit, 'FB');
}

// 5. Practical flower import units (FB/HB/QB/EB/B/박스/상자, 단/속/bunch/bd, 본/개/송이/st/stems) never mix
{
  assert.equal(normalizeOrderUnit('FB'), 'FB');
  assert.equal(normalizeOrderUnit('hb'), 'HB');
  assert.equal(normalizeOrderUnit('QB'), 'QB');
  assert.equal(normalizeOrderUnit('EB'), 'EB');
  for (const u of ['B', 'box', 'boxes', '박스', '상자']) assert.equal(normalizeOrderUnit(u), '박스', u);
  for (const u of ['단', '속', 'bunch', 'bunches', 'bd']) assert.equal(normalizeOrderUnit(u), '단', u);
  for (const u of ['송이', '본', '개', '스팀', '스템', '대', 'st', 'stem', 'stems']) assert.equal(normalizeOrderUnit(u), '송이', u);

  const mixed = analyzeImportMessage(msg(
    '47-2 콜 장미 발주 추가\n■ 엘리떼\n몬디알 3FB\n몬디알 2HB\n몬디알 4B\n몬디알 10속\n몬디알 50본'
  ));
  const rows = farmTotals(mixed.items.map(i => importItemView(i)));
  assert.equal(rows.length, 5);
  const unitSummary = summarizeUnitQuantities(rows);
  assert.equal(unitSummary.totalLine, '9박스 (3FB · 2HB · 4박스), 10단, 50송이');
}

// 6. Spec (length cm + grade) & multiplication expressions (`50cm * 3B`, `2박스 x 10단`, `100본*5`)
{
  const p1 = parseOrderItemLine('몬디알 Select 50cm * 3B');
  assert.equal(p1.quantity, '3');
  assert.equal(p1.unit, '박스');
  const spec1 = extractProductSpec(p1.product);
  assert.equal(spec1.grade, 'Select');
  assert.equal(spec1.lengthCm, '50cm');

  const p2 = parseOrderItemLine('시네신스 화이트 2박스 x 10단');
  assert.equal(p2.quantity, '2');
  assert.equal(p2.unit, '박스');
  assert.equal(p2.packSpec, '1박스당 10단');

  const p3 = parseOrderItemLine('튤립 화이트 100본*5');
  assert.equal(p3.quantity, '500');
  assert.equal(p3.unit, '송이');
  assert.equal(p3.packSpec, '100송이×5');
}

// 7. Summary / total lines (`합계 15B`, `총 20박스`, `Total 10 HB`, `계: 5박스`) never double-count
{
  for (const totalText of ['합계 15B', '총 20박스', 'Total 10 HB', '계: 5박스', '소계 8단', '총 합계 : 25박스']) {
    assert.equal(isSummaryTotalLine(totalText), true, totalText);
    assert.equal(parseOrderItemLine(totalText), null, totalText);
  }
  const withTotals = analyzeImportMessage(msg(
    '47-2 콜 카네이션 발주 추가\n■ 아유라\n돈셀 5B\n문라이트 10B\n합계 15B\n총 15박스\nTotal 15 B'
  ));
  assert.equal(withTotals.kind, 'addition');
  const summed = farmTotals(withTotals.items.map(i => importItemView(i)));
  assert.equal(summed.reduce((acc, r) => acc + r.quantity, 0), 15);
  assert.equal(withTotals.ignoredTotals.length, 3);
}

// 8. Arrow quantity changes (`3B -> 5B`, `3박스에서 5박스로 변경`), `+2B 추가`, and cross-message superseding
{
  const rev = analyzeImportMessage(msg(
    '47-2 콜 수국 발주 추가\n■ 플로렌스 농장\n화이트 3B -> 5B\n블루 3박스에서 5박스로 변경\n그린 +2B 추가'
  ));
  assert.equal(rev.kind, 'addition');
  assert.deepEqual(
    rev.items.map(i => [i.product, i.quantity, i.unit, i.revisionNote]),
    [
      ['화이트', '5', '박스', '3→5 변경'],
      ['블루', '5', '박스', '3→5 변경'],
      ['그린', '2', '박스', ''],
    ]
  );

  // Feed-level: newer arrow revision supersedes older initial 3B message so total is 5, not 8
  const feed = classifyImportFeed({
    messages: [
      msg('47-2 콜 수국 발주 추가\n화이트 3B -> 5B', 'later', '2026년 11월 25일 오전 10:00'),
      msg('47-2 콜 수국 발주 추가\n화이트 3박스', 'earlier', '2026년 11월 25일 오전 9:00'),
    ],
  });
  const feedTotals = farmTotals(feed.messages.flatMap(m => m.items.map(i => importItemView(i))));
  assert.equal(feedTotals.length, 1);
  assert.equal(feedTotals[0].quantity, 5);
}

// 9. Item-level cancellation (`취소`, `제외`, `빼주세요`, `패스`, `0박스`, `~취소선~`) excluded while keeping valid items
{
  const partial = analyzeImportMessage(msg([
    '47-2 콜 수국 발주 추가',
    '■ 플로렌스 농장',
    '화이트 6B',
    '핑크 4B',
    '~블루 3B~',
    '퍼플 2B 취소',
    '그린 1B 빼주세요',
    '옐로우 0박스',
    '레드는 패스',
  ].join('\n')));
  assert.equal(partial.kind, 'addition');
  const summed = farmTotals(partial.items.map(i => importItemView(i)));
  assert.deepEqual(summed.map(r => [r.product, r.quantity, r.unit]), [
    ['핑크', 4, '박스'],
    ['화이트', 6, '박스'],
  ]);
  assert.equal(partial.excludedItems.length, 5);
}

// 10. Operational memos (`수요일 선적분`, `색상 진한걸로 부탁`) separated cleanly without breaking customer or items
{
  const withMemo = analyzeImportMessage(msg([
    '47-2 콜 장미 발주 추가',
    '[콜롬비아] 엘리떼',
    '몬디알 60cm 5FB',
    '수요일 선적분으로 부탁드립니다',
    '색상 진한걸로 부탁',
  ].join('\n')));
  assert.equal(withMemo.kind, 'addition');
  assert.equal(withMemo.unparsed.length, 0);
  assert.equal(withMemo.items[0].customer, '');
  assert.deepEqual(withMemo.memos.map(m => m.text), ['수요일 선적분으로 부탁드립니다', '색상 진한걸로 부탁']);
}

// 11. Full pasted KakaoTalk chat -> buildFarmSummary & formatFarmTransferText (Concise / Detailed / KO / EN)
{
  const rawChat = [
    '--------------- 2026년 11월 25일 수요일 ---------------',
    '[정재훈] [오전 9:15] 47-2 콜롬비아 장미 발주 추가',
    '[정재훈] [오전 9:15] [콜롬비아] 엘리떼 농장',
    '몬디알 Select 70cm 4FB',
    '몬디알 Select 60cm 6FB',
    '익스플로러 Fancy 60cm 3HB',
    '합계 13박스',
    '수요일 선적분 부탁',
    '[김대리] [오전 9:16] 네 확인했습니다!',
    '[정재훈] [오전 9:20] 47-2 중국 발주 추가',
    '[정재훈] [오전 9:20] ■ Melody',
    '시네신스 화이트 10단 -> 15단',
    '~시네신스 옐로우 5단~',
    '색상 선명한 걸로 부탁',
  ].join('\n');

  const pasted = parsePastedKakaoChat(rawChat, { year: '2026', week: '47-02' });
  const rows = pasted.messages.flatMap(m => m.items.map(i => importItemView(i)));
  const totals = farmTotals(rows);
  const summary = buildFarmSummary(totals, {
    excludedItems: pasted.messages.flatMap(m => m.excludedItems || []),
    ignoredTotals: pasted.messages.flatMap(m => m.ignoredTotals || []),
    memos: pasted.messages.flatMap(m => m.memos || []),
  });

  assert.equal(summary.farmCount, 2);
  assert.equal(summary.itemCount, 4);
  assert.equal(summary.excludedItems.length, 1);
  assert.equal(summary.ignoredTotals.length, 1);

  const koText = formatFarmTransferText(summary, { format: 'concise', lang: 'ko' });
  assert.match(koText, /\[중국 · Melody\] 2026\/47-02차/);
  assert.match(koText, /1\. 시네신스 화이트 - 15단/);
  assert.match(koText, /\[콜롬비아 · The Elite Flowers\] 2026\/47-02차/);
  // Sorted: 몬디알 60cm before 몬디알 70cm, followed by 익스플로러
  assert.match(koText, /1\. 몬디알 \(Select · 60cm\) - 6FB\n2\. 몬디알 \(Select · 70cm\) - 4FB\n3\. 익스플로러 \(Fancy · 60cm\) - 3HB/);
  assert.match(koText, /합계: 13박스 \(10FB · 3HB\)/);
  assert.match(koText, /전달 메모: 수요일 선적분 부탁/);

  const singleEn = formatFarmCardText(summary.cards.find(c => c.farm === 'The Elite Flowers'), { format: 'concise', lang: 'en' });
  assert.match(singleEn, /^\[The Elite Flowers\] 2026\/47-02차/m);
  assert.match(singleEn, /1\. 몬디알 Select 60cm - 6 box \(FB\)/);
  assert.match(singleEn, /Total: 13 box \(10 FB · 3 HB\)/);
  assert.match(singleEn, /Note: 수요일 선적분 부탁/);
}

// 12. Cross-year same-week isolation in buildFarmSummary
{
  const m2025 = analyzeImportMessage(msg('47-2 콜 장미 발주 추가\n■ 엘리떼\n몬디알 60cm 5FB', 'y25', '2025년 11월 25일 오전 9:00'));
  const m2026 = analyzeImportMessage(msg('47-2 콜 장미 발주 추가\n■ 엘리떼\n몬디알 60cm 7FB', 'y26', '2026년 11월 25일 오전 9:00'));
  const totals = farmTotals([...m2025.items, ...m2026.items].map(i => importItemView(i)));
  const summary = buildFarmSummary(totals);
  assert.equal(summary.cards.length, 2);
  assert.deepEqual(summary.cards.map(c => [c.cycle, c.items[0].quantity]), [
    ['2025/47-02차', 5],
    ['2026/47-02차', 7],
  ]);
}

// 13. Boss follow-up case: "49차 수국 발주 추가\n주광 : 버건디 10박스(안티오퀴아)" + trailing farm brackets + origin->country inference
{
  const bossMsg = msg('49차 수국 발주 추가\n주광 : 버건디 10박스(안티오퀴아)', 'boss-49', '2026년 11월 25일 오전 10:12');
  const parsed = analyzeImportMessage(bossMsg);
  assert.equal(parsed.kind, 'addition');
  assert.equal(parsed.items.length, 1);
  const item = parsed.items[0];
  assert.equal(item.country, '콜롬비아');
  assert.equal(item.group, '수국');
  assert.equal(item.week, '49');
  assert.equal(item.customer, '주광');
  assert.equal(item.product, '버건디');
  assert.equal(item.quantity, '10');
  assert.equal(item.unit, '박스');
  assert.equal(item.farm, '안티오퀴아');
  assert.equal(item.note, '');
  // Must match Colombia 49-01 subweek scope without vanishing!
  assert.equal(matchesCountryOrderScope(item, { country: 'Colombia', year: 2026, majorWeek: '49', orderWeek: '49-01' }), true);
  assert.equal(matchesCountryOrderScope(item, { country: 'China', year: 2026, majorWeek: '49', orderWeek: '49-01' }), false);
  assert.equal(matchesCountryOrderScope(item, { country: 'Colombia', year: 2026, majorWeek: '48', orderWeek: '48-01' }), false);

  const summary = buildFarmSummary(farmTotals([importItemView(item)]));
  assert.equal(summary.cards.length, 1);
  assert.equal(summary.cards[0].title, '콜롬비아 · 안티오퀴아');
  assert.equal(summary.cards[0].cycle, '2026/49차');
  const cardText = formatFarmCardText(summary.cards[0], { format: 'concise', lang: 'ko' });
  assert.match(cardText, /^\[콜롬비아 · 안티오퀴아\] 2026\/49차 · 수국/m);
  assert.match(cardText, /1\. 버건디 - 10박스/);

  // Non-colombia-default flower group still infers country from origin/farm bracket
  const callaMsg = analyzeImportMessage(msg('49차 카라 발주 추가\n주광 - 화이트 5HB (Melody)\n일신 : 그린 10B[플로렌스]\n미우 : 핑크 8박스(안티오퀴아)'));
  assert.equal(callaMsg.kind, 'addition');
  assert.deepEqual(
    callaMsg.items.map(i => [i.customer, i.product, i.quantity, i.unit, i.farm, i.country]),
    [
      ['주광', '화이트', '5', 'HB', 'Melody', '중국'],
      ['일신', '그린', '10', '박스', '플로렌스', '콜롬비아'],
      ['미우', '핑크', '8', '박스', '안티오퀴아', '콜롬비아'],
    ]
  );
  assert.equal(inferCountryFromFarm('쿤밍'), '중국');
  assert.equal(inferCountryFromFarm('보고타'), '콜롬비아');
  assert.equal(inferCountryFromFarm('메데진'), '콜롬비아');
  assert.equal(inferCountryFromFarm('UnknownFarm', [{ FarmName: 'UnknownFarm', CounName: '에콰도르' }]), '에콰도르');

  // Shipment-batch "1차 선적" must not clobber actual week "49차"
  const batchMsg = analyzeImportMessage(msg('49차 수국 발주 추가 (1차 선적분)\n화이트 6박스(안티오퀴아)'));
  assert.equal(batchMsg.items[0].week, '49');
}

// 14. 14-day window retention (resolving 37-message 2-day slice cutoff) & auto '정리처리됨' 1-line classification
{
  const multiDayMessages = [
    msg('49차 수국 발주 추가\n주광 : 버건디 10박스(안티오퀴아)', 'd1', '2026년 11월 25일 오전 10:00'),
    msg('네 확인했습니다\n감사합니다', 'c1', '2026년 11월 25일 오전 10:05'),
    msg('49-1 콜 장미 발주 추가\n몬디알 5FB(엘리떼)', 'd2', '2026년 11월 23일 오전 11:00'),
    msg('48-2 중국 발주 추가\n시네신스 화이트 20단(Melody)', 'd3', '2026년 11월 19일 오후 2:00'),
    msg('48-1 콜 카네이션 발주 추가\n돈셀 4박스(아유라)', 'd4', '2026년 11월 14일 오전 9:30'),
    msg('47-1 중국 단가 문의드립니다\n시네신스 얼마인가요?', 'c2', '2026년 11월 13일 오후 4:00'),
  ];
  const fullWindow = latestImportFeed(multiDayMessages, '2026-11-25', new Map(), {
    maxOrderDays: 31,
    windowFrom: '2026-11-12',
  });
  // Retains all 4 order days across 14 days instead of slicing to 2 days!
  assert.equal(fullWindow.orderDays.length, 4);
  assert.equal(fullWindow.messages.length, 4);
  assert.equal(fullWindow.cleaned.length, 2);
  assert(fullWindow.cleaned.every(c => !('sender' in c)));
  assert.equal(formatCleanedSingleLine('네 확인했습니다\n\n감사합니다'), '네 확인했습니다 · 감사합니다');
  // Scope filter keeps general cleaned items for Colombia 49 while filtering out explicit China 47 inquiry
  const col49Scope = { country: 'Colombia', year: 2026, majorWeek: '49', orderWeek: '49-01' };
  assert.equal(matchesCleanedScope(fullWindow.cleaned.find(c => c.id === 'c1'), col49Scope), true);
  assert.equal(matchesCleanedScope(fullWindow.cleaned.find(c => c.id === 'c2'), col49Scope), false);
}

// 15. 3-tier Subscription LLM `order_parsed` priority + `replacesMessageId` + regex fallback + archive reception
{
  const priorToken = process.env.ORBIT_OWNER_TOKEN;
  process.env.ORBIT_OWNER_TOKEN = 'fixture-only';
  try {
    const archiveRows = [
      {
        id: 501,
        external_message_id: 'ext-501',
        source: 'nenovakakao',
        chatroom: '수입방',
        created_at: '2026-11-25T01:00:00.000Z',
        sender: 'fixture-a',
        message: '49차 수국 주광 버건디 열박스 안티오퀴아로 먼저 넣을게요',
        order_parsed: {
          kind: 'addition',
          provider: 'claude-sub',
          country: '콜롬비아',
          week: '49',
          group: '',
          category: '수국',
          farm: '안티오퀴아',
          customer: '주광',
          items: [
            { product: '버건디', category: '수국', farm: '안티오퀴아', country: '콜롬비아', customer: '주광', spec: '', quantity: 10, unit: '박스', rawUnit: '박스', note: '' },
          ],
          cancelledItems: [],
          memos: [],
          replacesMessageId: null,
          reviewReason: '',
          cleanReason: '',
        },
        order_parsed_at: '2026-11-25T01:02:00.000Z',
        order_parser_version: 1,
      },
      {
        id: 502,
        external_message_id: 'ext-502',
        source: 'nenovakakao',
        chatroom: '수입방',
        created_at: '2026-11-25T01:10:00.000Z',
        sender: 'fixture-a',
        message: '방금 주광 버건디 15박스로 수정 진행합니다 (안티오퀴아)',
        order_parsed: {
          kind: 'addition',
          provider: 'codex-sub',
          country: 'Colombia',
          week: '2026/49',
          group: '',
          category: '수국',
          farm: 'Antioquia',
          customer: '주광',
          items: [
            { product: '버건디', category: '수국', farm: 'Antioquia', country: '', customer: '주광', spec: 'Select · 60cm', quantity: 15, unit: 'box', rawUnit: 'box', note: '' },
            { product: '합계 15박스', quantity: 15, unit: '박스' },
          ],
          cancelledItems: [{ product: '에린지움', quantity: 2, unit: '박스', reason: '품목 제외' }],
          memos: ['수요일 선적분'],
          replacesMessageId: 'ext-501',
          reviewReason: '',
          cleanReason: '',
        },
        order_parsed_at: '2026-11-25T01:12:00.000Z',
        order_parser_version: 1,
      },
      {
        id: 503,
        external_message_id: 'ext-503',
        source: 'nenovakakao',
        chatroom: '수입방',
        created_at: '2026-11-25T01:15:00.000Z',
        sender: 'fixture-b',
        message: '네 수요일 항공편 스케줄 확인했습니다 감사합니다',
        order_parsed: {
          kind: 'cleaned',
          provider: 'antigravity-sub',
          country: '',
          week: '',
          items: [],
          cancelledItems: [],
          memos: [],
          replacesMessageId: null,
          cleanReason: '항공편 일정 확인 인사 (비발주)',
        },
        order_parsed_at: '2026-11-25T01:16:00.000Z',
        order_parser_version: 1,
      },
      {
        id: 504,
        external_message_id: 'ext-504',
        source: 'nenovakakao',
        chatroom: '수입방',
        created_at: '2026-11-25T01:20:00.000Z',
        sender: 'fixture-c',
        message: '49-1 중국 발주 추가\n시네신스 화이트 20단(Melody)',
        order_parsed: null,
        order_parsed_at: null,
      },
    ];
    const loaded = await readImportArchive('2026-11-25', '2026-11-25', async () => ({
      ok: true,
      json: async () => ({ ok: true, total: 4, messages: archiveRows }),
    }));
    assert.equal(loaded.length, 4);
    // Newest-first: ext-504 (null order_parsed), ext-503 (cleaned), ext-502 (replaces ext-501), ext-501
    const m501 = loaded.find(m => m.text.includes('열박스'));
    const m502 = loaded.find(m => m.text.includes('15박스로 수정'));
    assert.equal(m502.order_parsed.replacesMessageId, m501.id);

    const classified = classifyImportFeed({ messages: loaded });
    assert.deepEqual(classified.llmStats, {
      parsed: 3,
      pending: 1,
      providers: ['antigravity-sub', 'codex-sub', 'claude-sub'],
    });
    // Exact stats invariant: scanned === selected + review + excluded + duplicates
    assert.equal(
      classified.stats.scanned,
      classified.stats.selected + classified.stats.review + classified.stats.excluded + classified.stats.duplicates
    );
    // m501 was superseded by m502 via replacesMessageId -> moved to review (unchecked), so Colombia total is 15, NOT 25!
    assert.equal(classified.messages.length, 2); // m504 (regex fallback) + m502 (LLM)
    assert.equal(classified.review.length, 1); // m501 superseded
    assert.equal(classified.review[0].id, m501.id);
    assert.equal(classified.cleaned.length, 1); // m503 (LLM cleaned)
    assert.equal(classified.cleaned[0].analysisSource, 'llm');
    assert.equal(classified.cleaned[0].reason, '항공편 일정 확인 인사 (비발주)');
    assert(!('sender' in classified.messages[0]) && !('order_parsed' in classified.messages[0]));
    assert(!('sender' in classified.cleaned[0]));

    // Verify unparsed new message fell back to regex seamlessly
    const fallbackMsg = classified.messages.find(m => m.text.includes('시네신스 화이트'));
    assert.equal(fallbackMsg.analysisSource, 'regex');
    assert.equal(fallbackMsg.items[0].farm, 'Melody');
    assert.equal(fallbackMsg.items[0].quantity, '20');

    // Verify LLM message normalized product+spec, ignored summary total item, and extracted cancelledItems + memos
    const llmMsg = classified.messages.find(m => m.id === m502.id);
    assert.equal(llmMsg.analysisSource, 'llm');
    assert.equal(llmMsg.items.length, 1);
    assert.equal(llmMsg.items[0].country, '콜롬비아');
    assert.equal(llmMsg.items[0].farm, '안티오퀴아');
    assert.equal(llmMsg.items[0].spec, 'Select · 60cm');
    assert.equal(llmMsg.ignoredTotals.length, 1);
    assert.equal(llmMsg.excludedItems.length, 1);
    assert.equal(llmMsg.memos[0].text, '수요일 선적분');

    const summed = farmTotals(
      [...classified.messages, ...classified.review].flatMap(m => m.items.map(i => importItemView(i)))
    );
    const colombiaRows = summed.filter(r => r.country === '콜롬비아');
    assert.equal(colombiaRows.length, 1);
    assert.equal(colombiaRows[0].quantity, 15);

    // Malformed order_parsed gracefully falls back to regex instead of throwing
    assert.equal(normalizeLlmOrderParsed({ text: '49차 수국 발주 추가\n화이트 5박스', order_parsed: { kind: 'unknown_kind' } }), null);
    const recoveredByRegex = analyzeImportMessage({ id: 'mal', time: '2026년 11월 25일 오전 9:00', text: '49차 수국 발주 추가\n화이트 5박스', order_parsed: 'not-json' });
    assert.equal(recoveredByRegex.analysisSource, 'regex');
    assert.equal(recoveredByRegex.items[0].quantity, '5');
  } finally {
    if (priorToken === undefined) delete process.env.ORBIT_OWNER_TOKEN;
    else process.env.ORBIT_OWNER_TOKEN = priorToken;
  }
}

// 16. Standard normal orders (no farm = normal default) never emit '농장 미지정' / 'Farm TBD'; designated farms stay explicit
{
  const normalCarnation = analyzeImportMessage(msg('51-1 콜 카네이션 발주 추가\n돈셀 5박스\n문라이트 3박스', 'std1'));
  const normalNoGroup = {
    key: 'std2',
    year: '2026',
    week: '51-01',
    country: '콜롬비아',
    group: '',
    farm: '',
    product: '특수신품종',
    quantity: '4',
    unit: '박스',
    checked: true,
  };
  const designated = analyzeImportMessage(msg('51-1 콜 수국 발주 추가\n주광 : 버건디 10박스(안티오퀴아)', 'des1'));
  const rows = [
    ...normalCarnation.items.map(i => importItemView(i)),
    normalNoGroup,
    ...designated.items.map(i => importItemView(i)),
  ];
  const summary = buildFarmSummary(farmTotals(rows));
  assert.equal(summary.bundleCount, 3);
  assert.equal(summary.standardCount, 2);
  assert.equal(summary.farmCount, 1);

  const koAll = formatFarmTransferText(summary, { format: 'concise', lang: 'ko' });
  const enAll = formatFarmTransferText(summary, { format: 'concise', lang: 'en' });
  assert.doesNotMatch(koAll, /농장\s*미지정|품목군\s*미상|Farm\s*TBD/i);
  assert.doesNotMatch(enAll, /농장\s*미지정|품목군\s*미상|Farm\s*TBD/i);
  assert.match(koAll, /^\[콜롬비아\] 2026\/51-01차/m);
  assert.match(koAll, /^\[콜롬비아 · 카네이션\] 2026\/51-01차/m);
  assert.match(koAll, /^\[콜롬비아 · 안티오퀴아\] 2026\/51-01차 · 수국/m);
  assert.match(enAll, /^\[Colombia\] 2026\/51-01차/m);
  assert.match(enAll, /^\[Colombia · Carnation\] 2026\/51-01차/m);
  assert.match(enAll, /^\[안티오퀴아\] 2026\/51-01차/m);
}

// 17. UI Anti-AI Slop, Typography, 1-Line 정리처리됨 Ellipsis, AI Badges, Normal/Designated Labels & Read-Only ERP Contract assertions
{
  const uiSource = fs.readFileSync(new URL('../components/import-tools/KakaoAdditions.js', import.meta.url), 'utf8');
  const libSource = fs.readFileSync(new URL('../lib/importKakaoAdditions.js', import.meta.url), 'utf8');
  assert.match(uiSource, /'Pretendard Variable',\s*'Pretendard'/);
  assert.match(uiSource, /font-variant-numeric:\s*tabular-nums/);
  assert.match(uiSource, /정리처리됨/);
  assert.match(uiSource, /AI 정밀분류/);
  assert.match(uiSource, /AI분류/);
  assert.match(uiSource, /임시분류/);
  assert.match(uiSource, /지정농장/);
  assert.match(uiSource, /이 묶음 복사/);
  assert.match(uiSource, /이 농장 복사/);
  assert.match(uiSource, /발주 묶음/);
  assert.doesNotMatch(uiSource, /농장\s*미지정|Farm\s*TBD|미지정\s*\$\{/i);
  assert.doesNotMatch(libSource, /농장\s*미지정|Farm\s*TBD/i);
  assert.match(uiSource, /\.kakao-cleaned-text\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/);
  assert.match(uiSource, /복원/);
  assert.doesNotMatch(uiSource, /\bmonospace\b|JetBrains\s+Mono/i);
  assert.doesNotMatch(uiSource, /[🚀✨🔥💡🤖]/u);
  assert.doesNotMatch(uiSource, /감시|추적|모니터링|절감시간/);
  assert.doesNotMatch(uiSource, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);

  // 18. Zero-Lag UI invariants, clickable 합계 반영 reverse match, DB 품목명 (영문) column & lowercase English unit defaults
  assert.match(uiSource, /DB 품목명 \(영문\)/);
  assert.doesNotMatch(uiSource, /<th scope="col">규격 · 포장<\/th>/);
  assert.match(uiSource, /useState\('en'\)/);
  assert.match(uiSource, /button\.kakao-source-included/);
  assert.match(uiSource, /kakao-source-split-wrap/);
  assert.match(uiSource, /@container\s*\(min-width:\s*420px\)/);
  assert.match(uiSource, /kakao-source-raw-pane/);
  assert.match(uiSource, /kakao-source-db-pane/);
  assert.match(uiSource, /매칭값\(DB\)/);
  assert.match(uiSource, /- 합계 차감/);
  assert.doesNotMatch(uiSource, /kakao-source-contributions/);
  assert.doesNotMatch(uiSource, /취소 수량은 합산 제외/);
  assert.match(uiSource, /data-farm-line-key=/);
  assert.match(uiSource, /content-visibility:\s*auto/);
  assert.doesNotMatch(uiSource, /effectiveLimit\s*=\s*Math\.max/);
}

console.log('PASS Kakao farm classification, noise/total dedup, units/specs/revisions, farm cards, copy formatter and Anti-AI Slop');
