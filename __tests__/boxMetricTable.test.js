// 박스당(콜롬비아)·단당(중국) 무게/CBM 단일 원천 표 + 중국 원가자료 엑셀 배분 규칙 회귀 테스트
const assert = require('assert');

(async () => {
  const T = await import('../lib/boxMetricTable.js');
  const { computeFreightCost } = await import('../lib/freightCalc.js');
  const { RATE_DEFAULTS } = await import('../lib/customsForwarding.js');

  // ── 콜롬비아: 원가자료 엑셀 AA7:AJ13 (288개 시트 동일) — 매출원가 양식(장미 7·카네이션 CBM 11) 아님
  assert.deepStrictEqual(T.colombiaBoxMetrics('장미'), { boxWeight: 8, boxCBM: 10 });
  assert.deepStrictEqual(T.colombiaBoxMetrics('CARNATION'), { boxWeight: 11, boxCBM: 9 });
  assert.deepStrictEqual(T.colombiaBoxMetrics('알스트로'), { boxWeight: 9.7, boxCBM: 7 });
  assert.deepStrictEqual(T.colombiaBoxMetrics('루스커스'), { boxWeight: 8, boxCBM: 9.6 });
  assert.deepStrictEqual(T.colombiaBoxMetrics('HYDRANGEA', '38-01'), { boxWeight: 5.5, boxCBM: 6.7 });
  assert.deepStrictEqual(T.colombiaBoxMetrics('수국', '17-02'), { boxWeight: 5.6, boxCBM: 7 }); // 17-2A 시트
  assert.strictEqual(T.colombiaBoxMetrics('아나나스'), null);
  // 매출이익 보고서 H·S 배분도 같은 표
  assert.strictEqual(RATE_DEFAULTS.BoxWeight_콜롬비아장미, 8);
  assert.strictEqual(RATE_DEFAULTS.BoxCBM_콜롬비아카네이션, 9);
  assert.strictEqual(RATE_DEFAULTS.BoxWeight_콜롬비아수국, 5.5);
  assert.strictEqual(T.colombiaRateDefaultKeys('17').BoxWeight_콜롬비아수국, 5.6);

  // ── 중국: 엑셀 G열 SEARCH 순서 (CARNATION → ROSE → LISIANTHUS → EUCALYPTUS → Sinensis → Gypsophila → 기타)
  assert.strictEqual(T.chinaSubcategory('ROSE CHINA / 아바란체(Avalanche) 40cm'), '장미');
  assert.strictEqual(T.chinaSubcategory('Carnation CHINA / 라이트 파우더'), '카네이션');
  assert.strictEqual(T.chinaSubcategory('CHINA / 리모늄 시네신스 화이트 (Sinensis white) 500g'), '시네신스');
  assert.strictEqual(T.chinaSubcategory('CHINA / 안개꽃 (Gypsophila white)'), '안개꽃');
  assert.strictEqual(T.chinaSubcategory('Amaranthus CHINA / 줄맨드라미'), '기타');
  assert.deepStrictEqual(T.chinaBunchMetrics('장미', '27-02'), { boxWeight: 0.75, boxCBM: 1, week: '27-02' });
  assert.strictEqual(T.chinaBunchMetrics('장미', '34-02', 474).boxWeight, 0.63);  // 34-2A
  assert.strictEqual(T.chinaBunchMetrics('장미', '34-02', 1035).boxWeight, 0.8); // 34-2B
  assert.strictEqual(T.chinaBunchMetrics('장미', '39-01').week, '35-02');         // 엑셀 없는 차수 = 최근 표
  assert.strictEqual(T.chinaBunchMetrics('기타', '33-01'), null);

  // ── 27-2 CLOUD 시트 재현: GW=CW=371, 항공료 4924.5, 통관 372660, 장미 300단·안개꽃 130단·기타 70단
  //    엑셀 M(단당 운임) 장미 9.955188679 · 안개꽃 13.273584906 · 기타 3.033962264, U(단당 통관) 장미 753.3557951
  const row = (prodKey, prodName, bunchQty) => ({ prodKey, prodName, flowerName: /ROSE/.test(prodName) ? '장미' : '기타', counName: '중국', farmName: 'Cloudland', bunchQty, steamQty: bunchQty * 10, stemsPerBunch: 10, fobUSD: 10, totalPriceUSD: 10 * bunchQty, outUnit: '단' });
  const r = computeFreightCost({
    master: { gw: 371, cw: 371, rateUSD: 0, docFeeUSD: 0, exchangeRate: 230, actualFreightUSD: 4924.5, itemCount: 3, orderWeek: '27-02' },
    basis: 'AUTO',
    customs: { handlingFee: 372660 },
    details: [row(1, 'ROSE CHINA / 아바란체(Avalanche)', 300), row(2, 'CHINA / 안개꽃 (Gypsophila white)', 130), row(3, 'Greens CHINA / 비짜루 500g', 70)],
    productMeta: { 3: { boxWeight: 0.5, boxCBM: 0.5 } }, // 마스터 '기타' 값은 무시(엑셀은 잔여 역산)
    flowerMeta: { '장미': { boxWeight: 8, boxCBM: 10 } }, // 콜롬비아 장미 마스터값이 중국에 새면 안 됨
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.prodKey, x]));
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
  assert.ok(near(by[1].displayFreightUSD, 9.955188679245282), `rose ${by[1].displayFreightUSD}`);
  assert.ok(near(by[2].displayFreightUSD, 13.273584905660377), `gyp ${by[2].displayFreightUSD}`);
  assert.ok(near(by[3].displayFreightUSD, 3.0339622641509436), `others ${by[3].displayFreightUSD}`);
  assert.ok(near(by[1].displayCustomsKRW, 753.355795148248, 1e-4), `rose customs ${by[1].displayCustomsKRW}`);

  // GW 미입력 AWB 에서도 '기타' 운임 0원 금지(수량가중 평균값)
  const r0 = computeFreightCost({
    master: { gw: 0, cw: 0, exchangeRate: 200, actualFreightUSD: 1000, itemCount: 2, orderWeek: '35-02' },
    customs: { handlingFee: 100000 },
    details: [row(1, 'ROSE CHINA / A', 100), row(3, 'Greens CHINA / B', 50)],
  });
  assert.ok(r0.rows.every((x) => x.displayFreightUSD > 0 && x.displayCustomsKRW > 0), 'no zero freight/customs for China');

  console.log('boxMetricTable: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
