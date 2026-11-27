import assert from 'node:assert/strict';
import {
  analyzeImportMessage,
  classifyImportFeed,
  normalizeLlmOrderParsed,
  parsePastedKakaoChat,
} from '../lib/importKakaoOrderText.js';
import {
  farmTotals,
  importItemView,
  resolveImportFeedRows,
  resolveMinusKind,
  summarizeUnitQuantities,
  buildFarmSummary,
  formatFarmCardText,
  formatFarmTransferText,
} from '../lib/importKakaoAdditions.js';
import {
  classifyKakaoItemErpStatus,
  buildKakaoOrderHandoffPayload,
} from '../lib/kakaoOrderErpStatus.js';

const msg = (text, id = 'm1', time = '2026년 11월 26일 오전 9:46', extra = {}) => ({
  id,
  time,
  text,
  sender: 'fixture',
  items: [],
  ...extra,
});

// 1. Boss core case ①: `** 48차 뉴질랜드 컨펌**` (11-26 09:46 & 11-27 09:52) excluded on both regex & cached LLM `addition`
{
  const nzConfirm1126 = [
    '** 48차 뉴질랜드 컨펌**',
    'CL2 ',
    '- Bowl of cream Super 320 stem ',
    '- Coral Sunet A 100 stems',
    '- Red Charm AAA Hy REd 225 stems',
    '- Red Charm Super Red 50 stems',
    '- Sarah Bernhardt AAA 200 stems ',
    'CLS ',
    '- Madame Claude Tain AAA 275 stems ',
  ].join('\n');

  const nzConfirm1127 = [
    '**48차 뉴질랜드 컨펌 **',
    'YCL2',
    'Bowl fo cream Super - 320st (4box)',
    'Sarah Bernhardt AAA - 200st (2box)',
    'Coral Sunset A - 100st (1box)',
    'Red Charm AAA Hy.Red - 270st (3box)',
    'CLS',
    'Madam Claude Tain AAA - 220st',
    'Madam Claude Tain SUPER - 40st (총 260st)',
  ].join('\n');

  for (const [idx, text] of [nzConfirm1126, nzConfirm1127].entries()) {
    const regexRes = analyzeImportMessage(msg(text, `nz-reg-${idx}`));
    assert.equal(regexRes.kind, 'excluded');
    assert.equal(regexRes.items.length, 0);
    assert.match(regexRes.cleanReason, /컨펌/);

    const staleLlmMsg = msg(text, `nz-llm-${idx}`, '2026년 11월 26일 오전 9:46', {
      order_parser_version: 2,
      order_parsed: {
        kind: 'addition',
        provider: 'claude-sub',
        country: '뉴질랜드',
        week: '48',
        category: '작약',
        items: [
          { product: 'Bowl of cream Super', quantity: 320, unit: '송이', customer: 'CL2' },
          { product: 'Sarah Bernhardt AAA', quantity: 200, unit: '송이', customer: 'CL2' },
        ],
      },
    });
    const feed = classifyImportFeed({ messages: [staleLlmMsg] });
    assert.equal(feed.messages.length, 0);
    assert.equal(feed.review.length, 0);
    assert.equal(feed.cleaned.length, 1);
    const { rows } = resolveImportFeedRows(feed);
    assert.equal(farmTotals(rows).length, 0);
  }
}

// 2. Mixed confirmation message: normal confirmed lines excluded (0 added), ONLY 미컨펌/쇼트/취소 minus lines extracted
{
  const mixedConfirmText = [
    '** 48차 뉴질랜드 컨펌 **',
    'CL2',
    '- Bowl of cream Super 320 stem',
    '- Sarah Bernhardt AAA 200 stems 컨펌',
    '- Red Charm AAA 50 stems 미컨펌',
    '- Coral Sunset A 20 stems 취소',
  ].join('\n');

  const regexMixed = analyzeImportMessage(msg(mixedConfirmText, 'mix-reg'));
  assert.equal(regexMixed.kind, 'review');
  assert.equal(regexMixed.items.length, 2);
  assert.ok(regexMixed.items.every(it => it.cancelled && it.sign === -1));
  assert.equal(regexMixed.items[0].product, 'Red Charm AAA');
  assert.equal(regexMixed.items[0].minusKind, '현지이슈');
  assert.equal(regexMixed.items[1].product, 'Coral Sunset A');
  assert.equal(regexMixed.items[1].minusKind, '취소');

  // Stale LLM cache that mistakenly put confirmed lines in `items`
  const llmMixedFeed = classifyImportFeed({
    messages: [
      msg(mixedConfirmText, 'mix-llm', '2026년 11월 26일 오전 10:00', {
        order_parsed: {
          kind: 'addition',
          provider: 'claude-sub',
          country: '뉴질랜드',
          week: '48',
          category: '작약',
          items: [
            { product: 'Bowl of cream Super', quantity: 320, unit: '송이' },
            { product: 'Sarah Bernhardt AAA', quantity: 200, unit: '송이', note: '컨펌' },
            { product: 'Red Charm AAA', quantity: 50, unit: '송이', note: '미컨펌' },
          ],
          cancelledItems: [
            { product: 'Coral Sunset A', quantity: 20, unit: '송이', reason: '취소' },
          ],
        },
      }),
    ],
  });
  const { rows } = resolveImportFeedRows(llmMixedFeed);
  const totals = farmTotals(rows);
  assert.deepEqual(
    totals.map(r => [r.product, r.quantity, r.unit, r.breakdownNote]),
    [
      ['Coral Sunset A', -20, '송이', '취소'],
      ['Red Charm AAA', -50, '송이', '현지이슈'],
    ],
  );
}

// 3. Boss core case ②: Real 31-day 현지이슈 (소트/쇼트/미컨펌/없음/감량) & 취소 minus normalization
{
  // 3a. 49-1 콜롬비아 이슈 (11-27 09:47): explicit units (-2 박스, 10단) auto-check as minus; missing-unit rows stay unchecked
  const colIssue = msg([
    '49-1 콜롬비아 이슈',
    '-Alstro',
    'Posh pink - 2 박스',
    'whistler -4 HIMAYALA, WINTERFELL 대체 찾는중',
    'dubai -2',
    'fifi -4',
    '-장미',
    'proud 10단',
    'red panther 30',
  ].join('\n'), 'col-issue-49', '2026년 11월 27일 오전 9:47');

  const feedCol = classifyImportFeed({ messages: [colIssue] });
  const { rows: colRows } = resolveImportFeedRows(feedCol);
  const colTotals = farmTotals(colRows);
  assert.deepEqual(
    colTotals.map(r => [r.group, r.product, r.quantity, r.unit, r.breakdownNote]),
    [
      ['알스트로', 'Posh pink', -2, '박스', '현지이슈'],
      ['장미', 'proud', -10, '단', '현지이슈'],
    ],
  );
  // Missing-unit rows remain unchecked (`단위 확인 필요`)
  const whistlerRow = colRows.find(r => r.product === 'whistler');
  assert.equal(whistlerRow.checked, false);
  assert.equal(whistlerRow.reviewReason, '단위 확인 필요');

  // 3b. Stale v2 LLM cache on ** 중국 48-1 이슈 ** (was `cleaned`) rescued immediately into minus totals
  const cnShortMsg = msg([
    '** 중국 48-1 이슈 **',
    '미디오 버건디 2박스를 뒤에 더 찾아서 쇼트는 3박스랍니다',
    'Solomio Rose pink 1박스 쇼트',
    'Fairy-lola 3박스 쇼트',
    '미모사 2박스 쇼트',
  ].join('\n'), 'cn-48', '2026년 11월 24일 오전 11:47', {
    order_parser_version: 2,
    order_parsed: { kind: 'cleaned', provider: 'claude-sub', cleanReason: '구버전 이슈 제외' },
  });
  const cnFeed = classifyImportFeed({ messages: [cnShortMsg] });
  const { rows: cnRows } = resolveImportFeedRows(cnFeed);
  const cnTotals = farmTotals(cnRows);
  assert.deepEqual(
    cnTotals.map(r => [r.product, r.quantity, r.unit, r.breakdownNote]),
    [
      ['미디오 버건디', -3, '박스', '현지이슈'],
      ['미모사', -2, '박스', '현지이슈'],
      ['Fairy-lola', -3, '박스', '현지이슈'],
      ['Solomio Rose pink', -1, '박스', '현지이슈'],
    ],
  );

  // 3c. Chinese numbered list `1、Dahlia Orange Stone 10bunch 없음` & standing order reduction `4박스 → 0박스 (4박스 감량)`, `4박스 → 2박스 감량`
  const cnNone = analyzeImportMessage(msg('46-2 중국 이슈\n1、Dahlia Orange Stone 10bunch 없음\n2、Black beauty 10bunch 없음', 'cn-none'));
  assert.deepEqual(
    cnNone.items.map(i => [i.product, i.quantity, i.unit, i.cancelled, i.minusKind]),
    [
      ['Dahlia Orange Stone', '10', '단', true, '현지이슈'],
      ['Black beauty', '10', '단', true, '현지이슈'],
    ],
  );

  const reduction = analyzeImportMessage(msg('46-2 콜 카네이션 고정 발주 변경 사항\n- Bizet: 4박스 → 0박스 (4박스 감량)\n- Kaori: 4박스 → 2박스 감량', 'red-46'));
  assert.deepEqual(
    reduction.items.map(i => [i.product, i.quantity, i.unit, i.cancelled, i.minusKind]),
    [
      ['Bizet', '4', '박스', true, '현지이슈'],
      ['Kaori', '2', '박스', true, '현지이슈'],
    ],
  );

  // 3d. Narrative local issue without quantities stays in review (unchecked, 0 totals)
  const narrativeIssue = analyzeImportMessage(msg('47-1 호주 이슈\n-스터링기아 레드, 내추럴(화이트) 전량 미컨펌\n곰팡이 이슈로 배송 불가합니다.', 'nar-1'));
  assert.equal(narrativeIssue.kind, 'review');
  assert.equal(narrativeIssue.items.length, 0);

  // 3e. Question-form cancel ("나머지 5박스는 취소할까요?") does NOT auto-subtract
  const questionFeed = classifyImportFeed({
    messages: [msg('48-1 콜 수국\n화이트 5박스 취소할까요?', 'q-1')],
  });
  const { rows: qRows } = resolveImportFeedRows(questionFeed);
  assert.equal(qRows[0].checked, false);
  assert.equal(farmTotals(qRows).length, 0);

  // 3f. Supplier cancel-completion echo ("100stem 취소 해줬습니다") within 3h does NOT double-subtract -200
  const echoFeed = classifyImportFeed({
    messages: [
      msg('46-2 네덜란드 Amarylis Mont blanc 100stem 취소 해줬습니다', 'echo-reply', '2026년 11월 13일 오후 3:35'),
      msg('46-2 네덜란드\nBCL16 Amarylis Mont blanc 100스템 취소', 'echo-req', '2026년 11월 13일 오후 3:05'),
    ],
  });
  const { rows: echoRows } = resolveImportFeedRows(echoFeed);
  const echoTotals = farmTotals(echoRows);
  assert.equal(echoTotals.length, 1);
  assert.equal(echoTotals[0].quantity, -100);
}

// 4. Same farm+product+unit netting (+30 and -10 -> 20 bunches with `+30 / -10 (...)` breakdown) & Standalone minus (`-10 bunches`, `-5 box`, `-100 stems`)
{
  const netFeed = classifyImportFeed({
    messages: [
      msg('49-1 중국 이슈\n■ Melody\n시네신스 화이트 5단 쇼트', 'm-issue', '2026년 11월 27일 오전 11:00'),
      msg('49-1 중국 발주 취소\n■ Melody\n시네신스 화이트 5단 취소', 'm-cancel', '2026년 11월 27일 오전 10:30'),
      msg('49-1 중국 발주 추가\n■ Melody\n시네신스 화이트 30단', 'm-add', '2026년 11월 27일 오전 9:30'),
      // Standalone minus items across 3 unit families (bunches, box, stems)
      msg('49-1 중국 이슈\n■ Melody\n미모사 10단 쇼트', 'm-solo-bunch', '2026년 11월 27일 오전 11:10'),
      msg('49-1 콜롬비아 발주 취소\n버건디 5박스 취소', 'm-solo-box', '2026년 11월 27일 오전 11:15'),
      msg('49-1 뉴질랜드 이슈\n볼오브크림 100스팀 미컨펌', 'm-solo-stem', '2026년 11월 27일 오전 11:20'),
    ],
  });

  const { rows } = resolveImportFeedRows(netFeed);
  const totals = farmTotals(rows);
  const summary = buildFarmSummary(totals);

  const melodyCard = summary.cards.find(c => c.farm === 'Melody');
  assert.ok(melodyCard);
  const whiteItem = melodyCard.items.find(i => i.product === '시네신스 화이트');
  assert.equal(whiteItem.quantity, 20);
  assert.equal(whiteItem.addedQuantity, 30);
  assert.equal(whiteItem.cancelledQuantity, 10);
  assert.equal(whiteItem.breakdownNote, '+30 / -10 (취소·현지이슈)');

  const mimosaItem = melodyCard.items.find(i => i.product === '미모사');
  assert.equal(mimosaItem.quantity, -10);
  assert.equal(mimosaItem.breakdownNote, '현지이슈');
  // Melody card has +20 bunches (시네신스 화이트) and -10 bunches (미모사) -> net 10 bunches (+20 / -10)
  assert.equal(melodyCard.unitsEn.totalLine, '10 bunches (+20 / -10)');

  const copyEn = formatFarmTransferText(summary, { format: 'concise', lang: 'en' });
  assert.match(copyEn, /시네신스 화이트 - 20 bunches \/ \+30 \/ -10 \(취소·현지이슈\)/);
  assert.match(copyEn, /미모사 - -10 bunches \(현지이슈\)/);
  assert.match(copyEn, /버건디 - -5 box \(취소\)/);
  assert.match(copyEn, /볼오브크림 - -100 stems \(현지이슈\)/);

  const copyKo = formatFarmCardText(melodyCard, { format: 'concise', lang: 'ko' });
  assert.match(copyKo, /시네신스 화이트 - 20단 \/ \+30 \/ -10 \(취소·현지이슈\)/);
  assert.match(copyKo, /미모사 - -10단 \(현지이슈\)/);

  // Pasted chat mode preserves local-issue minus without turning it into `발주 추가`
  const pasted = parsePastedKakaoChat(
    '[정재훈] [오전 9:00] ** 48차 뉴질랜드 컨펌**\n볼오브크림 320st\n[정재훈] [오전 9:05] 49-1 중국 이슈\n시네신스 화이트 10단 쇼트',
    { year: '2026', week: '49-01' },
  );
  assert.equal(pasted.cleaned.length, 1);
  const { rows: pastedRows } = resolveImportFeedRows(pasted);
  const pastedTotals = farmTotals(pastedRows);
  assert.equal(pastedTotals.length, 1);
  assert.equal(pastedTotals[0].quantity, -10);
  assert.equal(summarizeUnitQuantities(pastedTotals, { lang: 'en' }).totalLine, '-10 bunches');
}

// 5. Boss core case ③: Domestic customer semi-auto ERP registration safety guard (`KakaoOrderRegisterBridge` / `classifyKakaoItemErpStatus`)
{
  const customers = [
    { CustKey: 10, CustName: '(주)주광꽃백화점', CustCode: 'C010', OrderCode: 'YCL2', Descr: '주광', ManagerName: '김영업' },
  ];

  // 5a. Positive addition -> eligible: true, autoSelectable: true
  const posItem = importItemView({
    key: 'pos-1',
    year: '2026',
    week: '49-01',
    country: '콜롬비아',
    group: '수국',
    product: '버건디',
    quantity: '10',
    unit: '박스',
    customer: '주광',
  });
  const posEval = classifyKakaoItemErpStatus(posItem, {
    messageType: '추가',
    messageKind: 'addition',
    messageText: '49-1 콜 수국 발주 추가\n주광 : 버건디 10박스',
    customers,
    erpOrders: [],
  });
  assert.equal(posEval.status, 'UNREGISTERED');
  assert.equal(posEval.eligible, true);
  assert.equal(posEval.autoSelectable, true);

  // 5b. Minus cancellation & minus local-issue -> eligible: false, autoSelectable: false, badgeLabel: '취소·현지이슈 (-)'
  for (const [mType, mKind, minusKind] of [
    ['취소', 'review', '취소'],
    ['현지이슈', 'review', '현지이슈'],
  ]) {
    const minusView = importItemView(
      {
        key: `min-${minusKind}`,
        year: '2026',
        week: '49-01',
        country: '콜롬비아',
        group: '알스트로',
        product: '노라',
        quantity: '2',
        unit: '박스',
        customer: '주광',
        cancelled: true,
        minusKind,
      },
      {},
      { autoCheckCancel: true },
    );
    assert.equal(minusView.checked, true);
    assert.equal(resolveMinusKind(minusView), minusKind);
    const minEval = classifyKakaoItemErpStatus(minusView, {
      messageType: mType,
      messageKind: mKind,
      messageText: `49-1 알스트로 ${mType}\n주광 : 노라 2박스`,
      customers,
      erpOrders: [],
    });
    assert.equal(minEval.status, 'CANCELLED');
    assert.equal(minEval.badgeLabel, '취소·현지이슈 (-)');
    assert.equal(minEval.eligible, false);
    assert.equal(minEval.autoSelectable, false);
  }

  // 5c. Confirmation notice -> strictly blocked even if passed to classifyKakaoItemErpStatus
  const confirmEval = classifyKakaoItemErpStatus(posItem, {
    messageType: '추가',
    messageKind: 'addition',
    messageText: '** 48차 뉴질랜드 컨펌**\nYCL2\nBowl of cream 320st',
    customers,
    erpOrders: [],
  });
  assert.equal(confirmEval.status, 'CANCELLED');
  assert.equal(confirmEval.eligible, false);
  assert.equal(confirmEval.autoSelectable, false);

  // 5d. Handoff payload strictly keeps only positive eligible additions
  const handoff = buildKakaoOrderHandoffPayload([
    { row: posItem, evaluation: posEval, message: { id: 'm-pos', time: '2026-11-27 10:00' } },
    { row: { ...posItem, key: 'min-1', cancelled: true, sign: -1 }, evaluation: { ...posEval, eligible: true }, message: { id: 'm-min', time: '2026-11-27 10:01' } },
  ]);
  assert.equal(handoff.groups.length, 1);
  assert.equal(handoff.groups[0].items.length, 1);
  assert.equal(handoff.groups[0].items[0].itemKey, 'pos-1');
}

console.log('PASS Kakao confirm exclusion, mixed confirm minus-only extraction, local-issue/cancel (-) netting & standalone retention, and ERP ADD guard');
