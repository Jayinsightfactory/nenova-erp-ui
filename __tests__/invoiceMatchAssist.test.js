import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInvoiceMatchSuggestion, detectInvoiceCountry, productCountryMismatch, rankProductSuggestions, scoreProductMatch } from '../lib/invoiceMatchAssist.js';

const products = [
  { ProdKey: 1, ProdName: 'ROSE CHINA / 만달라(Mandala) 65-75cm', country: 'CN', selectable: true },
  { ProdKey: 2, ProdName: 'ROSE CHINA / 만달라(Mandala) 75-80cm', country: 'CN', selectable: true },
  { ProdKey: 3, ProdName: 'ROSE CHINA / 만달라(Mandala) ', country: 'CN', selectable: true },
  { ProdKey: 4, ProdName: 'ROSE CHINA / 만달라(Mandala) MQ', country: 'CN', selectable: true },
  { ProdKey: 5, ProdName: 'CARNATION Mandalay', country: 'CO', selectable: true },
  { ProdKey: 6, ProdName: 'CARNATION Moon Light', country: 'CO', selectable: true },
  { ProdKey: 7, ProdName: 'CARNATION Moon Light', country: 'CO', selectable: false },
];

test('이름이 같으면 100, 다르면 99 이하', () => {
  assert.equal(scoreProductMatch('CARNATION Moon Light', products[5]), 100);
  assert.ok(scoreProductMatch('Mandala 75-80cm', products[1]) < 100);
});

test('후보는 같은 나라만, 점수 내림차순, 1순위가 가장 비슷한 것', () => {
  const ranked = rankProductSuggestions('Mandala 70-75cm', products, { country: 'CN' });
  assert.ok(ranked.items.length >= 2);
  assert.ok(ranked.items.every(item => item.product.country === 'CN'));
  assert.deepEqual(ranked.items.map(item => item.score), [...ranked.items.map(item => item.score)].sort((a, b) => b - a));
  assert.equal(ranked.exact, false);
});

test('길이가 다르면 같은 길이 품목이 앞선다', () => {
  const ranked = rankProductSuggestions('ROSE CHINA / 만달라(Mandala) 75-80cm', products, { country: 'CN' });
  assert.equal(ranked.items[0].product.ProdKey, 2);
});

test('이름이 정확히 같으면 exact (버튼 불필요)', () => {
  const ranked = rankProductSuggestions('CARNATION Moon Light', products, { country: 'CO' });
  assert.equal(ranked.exact, true);
  assert.equal(ranked.items[0].score, 100);
  assert.equal(ranked.items[0].product.ProdKey, 6);          // selectable=false 중복품목은 후보에서 제외
});

test('다른 나라 품목은 후보에 섞이지 않는다', () => {
  const ranked = rankProductSuggestions('Mandala', products, { country: 'CO' });
  assert.ok(ranked.items.every(item => item.product.country === 'CO'));
});

test('콜롬비아로 선택했는데 중국 인보이스로 보이면 불일치 경고', () => {
  const result = detectInvoiceCountry({ farmName: 'HUBFRESH', lineNames: ['ROSE CHINA / 만달라 65-75cm', 'ROSE CHINA / 레드니스'], currency: 'CNY', selectedCountry: 'CO' });
  assert.equal(result.suggested, 'CN');
  assert.equal(result.mismatch, true);
  assert.ok(result.signals.length >= 2);
});

test('반대로 중국으로 선택했는데 콜롬비아 인보이스', () => {
  const result = detectInvoiceCountry({ farmName: 'Ayura', lineNames: ['CARNATION CHAMPAGNE BRUT SELECT'], currency: 'USD', selectedCountry: 'CN' });
  assert.equal(result.suggested, 'CO');
  assert.equal(result.mismatch, true);
});

test('근거가 하나뿐이면 경고하지 않는다', () => {
  const result = detectInvoiceCountry({ farmName: '', lineNames: ['ROSE X'], currency: 'USD', selectedCountry: 'CN' });
  assert.equal(result.mismatch, false);
});

test('나라가 맞으면 경고 없음', () => {
  const result = detectInvoiceCountry({ farmName: 'Cloudland', lineNames: ['ROSE CHINA / A'], currency: 'CNY', selectedCountry: 'CN' });
  assert.equal(result.mismatch, false);
});

test('선택한 전산 품목의 원산지가 문서 나라와 다르면 불일치', () => {
  assert.equal(productCountryMismatch({ country: 'CN' }, 'CO'), true);
  assert.equal(productCountryMismatch({ country: 'CO' }, 'CO'), false);
  assert.equal(productCountryMismatch({}, 'CO'), false);
});

import { historyKey, loadDriveMatchHistory } from '../lib/driveMatchHistory.js';

test('업무드라이브에서 이미 연결된 품명이면 그 품목이 1순위로 올라온다', () => {
  const history = { [historyKey('Mandala MQ special')]: [{ prodKey: 4, count: 3, lastWeek: '41-1' }] };
  const without = rankProductSuggestions('Mandala MQ special', products, { country: 'CN' });
  const withHist = rankProductSuggestions('Mandala MQ special', products, { country: 'CN', history });
  assert.equal(withHist.items[0].product.ProdKey, 4);
  assert.equal(withHist.items[0].history.count, 3);
  assert.ok(withHist.items[0].score >= 94 && withHist.items[0].score <= 99);
  assert.ok(withHist.items[0].score >= (without.items.find(item => item.product.ProdKey === 4)?.score ?? 0));
});

test('기본 선택은 90 이상 단독 1위의 실제 이름 유사도, 정확한 국가와 선택 가능한 품목만 사용한다', () => {
  const candidate = { ProdKey: 8, ProdName: 'Moon Light 50cm', country: 'CO', selectable: true };
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light', [candidate], 'CO')?.score, 90);
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light', [candidate, {...candidate, ProdKey: 9}], 'CO'), null);
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light', [candidate, {...candidate, ProdKey: 9, country: 'CN'}], 'CO')?.product.ProdKey, 8);
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light', [{...candidate, selectable: false}], 'CO'), null);
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light', [{...candidate, country: undefined}], 'CO'), null);
  assert.equal(defaultInvoiceMatchSuggestion('Mandala MQ special', products, 'CN'), null);
  assert.equal(defaultInvoiceMatchSuggestion('Moon Light 60cm', [candidate], 'CO'), null);
});

test('이력의 품목이 다른 나라라 후보에 없으면 끼어들지 않는다', () => {
  const history = { [historyKey('Mandala')]: [{ prodKey: 5, count: 9, lastWeek: '40-1' }] };   // 5 = 콜롬비아 품목
  const ranked = rankProductSuggestions('Mandala', products, { country: 'CN', history });
  assert.ok(ranked.items.every(item => item.product.country === 'CN'));
});

test('이력 조회는 같은 나라 연결만 SELECT 한다', async () => {
  let sqlText = '', params;
  const fake = async (text, p) => { sqlText = text; params = p; return { recordset: [{ raw: 'ROSE CHINA / 만달라(Mandala) ', prodKey: 3, n: 4, lastWeek: '45-2' }] }; };
  const result = await loadDriveMatchHistory({ queryFn: fake, types: { NVarChar: () => 'nv' }, country: 'CN' });
  assert.match(sqlText, /SELECT/); assert.doesNotMatch(sqlText, /\b(UPDATE|INSERT|DELETE|MERGE)\b/i);
  assert.match(sqlText, /p\.CounName=@country/);
  assert.equal(params.country.value, '중국');
  assert.deepEqual(result.byName[historyKey('ROSE CHINA / 만달라(Mandala) ')], [{ prodKey: 3, count: 4, lastWeek: '45-2' }]);
  await assert.rejects(() => loadDriveMatchHistory({ queryFn: fake, types: {}, country: 'ZZ' }), /나라/);
});

test('거래 종료 거래처([MEL], [오경]) 품목은 후보에서 빠지고, 현행 품목이 위로 온다', () => {
  const list = [
    { ProdKey: 10, ProdName: '[MEL] ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)', country: 'CN', selectable: true },
    { ProdKey: 11, ProdName: 'ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)', country: 'CN', selectable: true },
    { ProdKey: 12, ProdName: '[오경] ROSE CHINA / 리바이벌 (Revival)', country: 'CN', selectable: true },
  ];
  const ranked = rankProductSuggestions('ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)', list, { country: 'CN' });
  assert.deepEqual(ranked.items.map(item => item.product.ProdKey), [11]);
  assert.equal(ranked.exact, true);
  assert.equal(rankProductSuggestions('ROSE CHINA / 리바이벌 (Revival)', list, { country: 'CN' }).items.length, 0);
  assert.equal(rankProductSuggestions('[오경] ROSE CHINA / 리바이벌 (Revival)', list, { country: 'CN' }).items[0].product.ProdKey, 12); // 원문에 같은 표식이 있으면 허용
});

test('ROSE CHINA(중국장미)와 ROSE(콜롬비아장미)는 서로 후보가 되지 않는다', () => {
  const list = [
    { ProdKey: 1211, ProdName: 'ROSE', country: 'CO', selectable: true },
    { ProdKey: 3251, ProdName: 'ROSE CHINA / 로맨틱 비치(Romantic Beach) 70cm-75cm', country: 'CN', selectable: true },
  ];
  assert.ok(rankProductSuggestions('ROSE CHINA / 로맨틱 비치(Romantic Beach) 40cm', list, { country: 'CN' }).items.every(item => item.product.country === 'CN'));
  assert.ok(rankProductSuggestions('ROSE / Candlelight 50cm', list, { country: 'CO' }).items.every(item => item.product.country === 'CO'));
});

test('자동 우선매칭은 supplier 농장 약어(+7점), history(94~99점), 85점+격차10점 규칙을 반영하고 85점 미만·근접·화종 불일치를 차단한다', () => {
  // 1) 농장 약어 (BA) 보너스: 발베르데 공급자 전달 시 (BA) 품목이 자동 우선 선택
  const baList = [
    { ProdKey: 101, ProdName: 'HYDRANGEA White Premium (BA)', country: 'CO', selectable: true },
    { ProdKey: 102, ProdName: 'HYDRANGEA White Premium (GL)', country: 'CO', selectable: true },
  ];
  assert.equal(defaultInvoiceMatchSuggestion('HYDRANGEA WHITE PREMIUM', baList, 'CO'), null);
  const baPicked = defaultInvoiceMatchSuggestion('HYDRANGEA WHITE PREMIUM', baList, 'CO', { supplier: 'CI FLORES BALVERDE SAS' });
  assert.equal(baPicked?.product.ProdKey, 101);

  // 2) 과거 입고 이력(history) 1순위 자동매칭
  const hist = { [historyKey('Mandala MQ special')]: [{ prodKey: 4, count: 3, lastWeek: '48-01' }] };
  const histPicked = defaultInvoiceMatchSuggestion('Mandala MQ special', products, 'CN', { history: hist });
  assert.equal(histPicked?.product.ProdKey, 4);
  assert.equal(histPicked?.history?.count, 3);

  // 3) 85~89점 구간: 2위 격차 >= 10점 자동 선택 vs 근접(격차 < 10) 및 85점 미만 미자동화
  const gapList = [
    { ProdKey: 201, ProdName: 'CARNATION Moon Light Select', country: 'CO', selectable: true }, // 86점
    { ProdKey: 202, ProdName: 'CARNATION Moon Glow Pink', country: 'CO', selectable: true },    // 50점
  ];
  const score1 = scoreProductMatch('CARNATION MOON LIGHT WHITE', gapList[0]);
  const score2 = scoreProductMatch('CARNATION MOON LIGHT WHITE', gapList[1]);
  assert.ok(score1 >= 85 && score1 < 90, `expected 85..89, got ${score1}`);
  assert.ok(score1 - score2 >= 10, `expected gap>=10, got ${score1 - score2}`);
  const pickedByGap = defaultInvoiceMatchSuggestion('CARNATION MOON LIGHT WHITE', gapList, 'CO');
  assert.equal(pickedByGap?.product.ProdKey, 201);
  assert.equal(pickedByGap?.score, score1);

  const nearTieList = [
    { ProdKey: 201, ProdName: 'CARNATION Moon Light Select', country: 'CO', selectable: true },    // 86점
    { ProdKey: 203, ProdName: 'CARNATION Moon Light White Extra', country: 'CO', selectable: true }, // 89점 (격차 3점 < 10)
  ];
  const sA = scoreProductMatch('CARNATION MOON LIGHT WHITE', nearTieList[0]);
  const sB = scoreProductMatch('CARNATION MOON LIGHT WHITE', nearTieList[1]);
  assert.ok(Math.max(sA, sB) < 90 && Math.abs(sA - sB) < 10, `expected near tie in 85..89, got ${sA} vs ${sB}`);
  assert.equal(defaultInvoiceMatchSuggestion('CARNATION MOON LIGHT WHITE', nearTieList, 'CO'), null);

  // 85점 미만은 단독 후보라도 미자동화
  const lowCandidate = [{ ProdKey: 204, ProdName: 'CARNATION Moon Bright Extra Special', country: 'CO', selectable: true }];
  assert.ok(scoreProductMatch('CARNATION MOON LIGHT WHITE', lowCandidate[0]) < 85);
  assert.equal(defaultInvoiceMatchSuggestion('CARNATION MOON LIGHT WHITE', lowCandidate, 'CO'), null);

  // 4) 화종 불일치(ROSE vs CARNATION)는 farmProdKeys가 있어도 0점 유지(자동매칭 불가)
  const wrongFamily = [{ ProdKey: 301, ProdName: 'ROSE / Moon Light', country: 'CO', selectable: true }];
  assert.equal(defaultInvoiceMatchSuggestion('CARNATION MOON LIGHT', wrongFamily, 'CO', { farmProdKeys: new Set([301]) }), null);
});

test('loadDriveMatchHistory(includeWarehouse:true)는 최근 180일 입고 농장별 품목을 읽기 전용 SELECT하고 실패 시 fail-open한다', async () => {
  const queries = [];
  const fake = async text => {
    queries.push(text);
    if (text.includes('WarehouseMaster')) {
      return { recordset: [{ farmName: 'Flores El Zorro', prodKey: 555, n: 6, lastWeek: '48-02' }] };
    }
    return { recordset: [{ raw: 'CARNATION MOON LIGHT WHITE', prodKey: 555, n: 4, lastWeek: '48-02' }] };
  };
  const res = await loadDriveMatchHistory({ queryFn: fake, types: { NVarChar: () => 'nv' }, country: 'CO', includeWarehouse: true });
  assert.equal(queries.length, 2);
  for (const q of queries) assert.doesNotMatch(q, /\b(UPDATE|INSERT|DELETE|MERGE)\b/i);
  assert.deepEqual(res.byFarm[historyKey('Flores El Zorro')], [555]);

  // 원장 보조 조회 실패 시에도 byName 유지(fail-open)
  const failWarehouse = async text => {
    if (text.includes('WarehouseMaster')) throw new Error('timeout');
    return { recordset: [{ raw: 'CARNATION MOON LIGHT WHITE', prodKey: 555, n: 4, lastWeek: '48-02' }] };
  };
  const fallback = await loadDriveMatchHistory({ queryFn: failWarehouse, types: { NVarChar: () => 'nv' }, country: 'CO', includeWarehouse: true });
  assert.equal(fallback.names, 1);
  assert.deepEqual(fallback.byFarm, {});
});
