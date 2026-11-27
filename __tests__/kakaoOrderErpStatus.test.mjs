import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  KAKAO_ORDER_HANDOFF_KEY,
  aggregateErpOrderRows,
  buildKakaoOrderHandoffPayload,
  classifyKakaoItemErpStatus,
  createKakaoOrderStatusHandler,
  extractScopesFromKakaoEntries,
  formatKakaoItemForSalesPaste,
  normalizeClCode,
  parseKakaoScopeQuery,
  resolveKakaoCustomerMatch,
  resolveKakaoItemOrderScope,
} from '../lib/kakaoOrderErpStatus.js';
import { analyzeImportMessage } from '../lib/importKakaoOrderText.js';
import { farmTotals, importItemView } from '../lib/importKakaoAdditions.js';
import {
  buildSalesPasteWeekChoices,
  countSalesPasteQuantityLines,
  mergeSalesPasteHandoffWeekChoices,
  resolveDetectedSalesPasteScope,
} from '../lib/salesPasteOrder.js';

// 1. Scope query validation & normalization
{
  assert.deepEqual(parseKakaoScopeQuery(undefined), { valid: true, scopes: [] });
  assert.deepEqual(parseKakaoScopeQuery(''), { valid: true, scopes: [] });
  const parsed = parseKakaoScopeQuery('2026:48, 2026:9,2026:48');
  assert.equal(parsed.valid, true);
  assert.deepEqual(
    parsed.scopes.map((s) => s.key),
    ['2026:48', '2026:09'],
  );
  assert.equal(parseKakaoScopeQuery('2026-48').valid, false);
  assert.equal(parseKakaoScopeQuery('1999:48').valid, false);
  assert.equal(parseKakaoScopeQuery('2026:00').valid, false);
  assert.equal(parseKakaoScopeQuery('2026:54').valid, false);
  const thirteen = Array.from({ length: 13 }, (_, i) => `2026:${String(i + 1).padStart(2, '0')}`).join(',');
  assert.equal(parseKakaoScopeQuery(thirteen).valid, false);
}

// 2. Subweek & major-only week resolution + LLM order_parsed compatibility
{
  const sub = resolveKakaoItemOrderScope({ year: '2026', week: '48-2' });
  assert.equal(sub.valid, true);
  assert.equal(sub.orderWeek, '48-02');
  assert.equal(sub.majorWeekOnly, false);

  const singleDigit = resolveKakaoItemOrderScope({ year: '2026', week: '9-1' });
  assert.equal(singleDigit.orderWeek, '09-01');
  assert.equal(singleDigit.majorWeek, '09');

  // Major-only heading ("49차 수국 발주 추가 (1차 선적분)") must keep majorWeekOnly=true and NOT mistake "1차 선적" for 49-1
  const majorOnly = resolveKakaoItemOrderScope(
    { year: '2026', week: '49' },
    { messageText: '49차 수국 발주 추가 (1차 선적분)\n주광 : 버건디 10박스(안티오퀴아)' },
  );
  assert.equal(majorOnly.valid, true);
  assert.equal(majorOnly.orderWeek, '49-01');
  assert.equal(majorOnly.majorWeekOnly, true);
  assert.equal(majorOnly.originalWeek, '49차');

  // When left matrix scope has exact subweek 49-02 selected, major-only item recommends 49-02 while keeping majorWeekOnly warning
  const scopedMajor = resolveKakaoItemOrderScope(
    { year: '2026', week: '49' },
    { orderScope: { year: 2026, majorWeek: '49', orderWeek: '49-02' } },
  );
  assert.equal(scopedMajor.orderWeek, '49-02');
  assert.equal(scopedMajor.majorWeekOnly, true);

  // LLM order_parsed item with major-only week="48" recovers explicit "48-2" from messageText
  const recovered = resolveKakaoItemOrderScope(
    { year: '2026', week: '48', product: '버건디', quantity: 5, unit: '박스' },
    { messageText: '48-2 콜 수국 추가\n주광 : 버건디 5박스' },
  );
  assert.equal(recovered.orderWeek, '48-02');
  assert.equal(recovered.majorWeekOnly, false);
}

// 3. CL leading-zero normalization & multi-customer message isolation
const sampleCustomers = [
  { CustKey: 10, CustName: '(주)주광꽃백화점', CustCode: 'C010', OrderCode: '', Descr: '주광', ManagerName: '김영업' },
  { CustKey: 20, CustName: '화성플라워', CustCode: 'C020', OrderCode: 'KCL1', Descr: '', ManagerName: '이영업' },
  { CustKey: 30, CustName: '와이앤제이', CustCode: 'C030', OrderCode: 'YCL06', Descr: '', ManagerName: '박영업' },
  { CustKey: 41, CustName: '동명A화원', CustCode: 'C041', OrderCode: 'CL99', Descr: '', ManagerName: '김영업' },
  { CustKey: 42, CustName: '동명B화원', CustCode: 'C042', OrderCode: 'CL99', Descr: '', ManagerName: '최영업' },
];

{
  assert.equal(normalizeClCode('KCL01'), 'KCL1');
  assert.equal(normalizeClCode('kcl001'), 'KCL1');
  assert.equal(normalizeClCode('YCL6'), 'YCL6');
  assert.equal(normalizeClCode('YCLS'), 'YCLS');

  const multiCustomerMsg = '48-2 콜 수국 추가\n주광 : 버건디 10박스\n화성 KCL01 : 화이트 5박스';
  const m1 = resolveKakaoCustomerMatch('주광', sampleCustomers, { messageText: multiCustomerMsg });
  assert.equal(m1.status, 'MATCHED');
  assert.equal(m1.customer.CustKey, 10);

  const m2 = resolveKakaoCustomerMatch('화성 KCL01', sampleCustomers, { messageText: multiCustomerMsg });
  assert.equal(m2.status, 'MATCHED');
  assert.equal(m2.customer.CustKey, 20);

  const m3 = resolveKakaoCustomerMatch('YCL6', sampleCustomers);
  assert.equal(m3.status, 'MATCHED');
  assert.equal(m3.customer.CustKey, 30);

  // Duplicate OrderCode without disambiguating name returns AMBIGUOUS instead of guessing
  const dup = resolveKakaoCustomerMatch('CL99', sampleCustomers);
  assert.equal(dup.status, 'AMBIGUOUS');
  assert.equal(dup.candidates.length, 2);

  // Unknown standalone CL code (e.g. CL3) must NOT substring-match CL30/CL31
  const clPrefixMiss = resolveKakaoCustomerMatch('CL3', [
    { CustKey: 91, CustName: '선미원예', CustCode: 'C91', OrderCode: 'CL30', Descr: 'CL30' },
    { CustKey: 92, CustName: '코코도르팜', CustCode: 'C92', OrderCode: 'CL31', Descr: 'CL31' },
  ]);
  assert.equal(clPrefixMiss.status, 'UNRESOLVED');
  assert.equal(clPrefixMiss.candidates.length, 0);

  // Flower/season/stock tokens are treated as NO_CUSTOMER (NONE) rather than domestic customer names
  for (const nonCust of ['장미', '크리스마스', '재고']) {
    assert.equal(resolveKakaoCustomerMatch(nonCust, sampleCustomers).status, 'NONE', nonCust);
  }
}

// 4. 2-Axis separation + ERP Status Classification + Duplicate/Cancel Prevention + Cross-Year Isolation
{
  const erpOrders = aggregateErpOrderRows([
    // 2025 same week 48-02 must NEVER falsely mark 2026 item as registered!
    {
      OrderMasterKey: 31000,
      OrderYear: '2025',
      OrderWeek: '48-02',
      CustKey: 10,
      ProdKey: 501,
      BoxQuantity: 10,
      OutQuantity: 10,
      OutUnit: '박스',
      ProdName: 'HYDRANGEA BURGUNDY',
      DisplayName: '콜롬비아 수국 버건디',
      FlowerName: '수국',
      CounName: '콜롬비아',
    },
    // 2026 48-01 registered for CustKey 10 (must NOT match 48-02!)
    {
      OrderMasterKey: 48100,
      OrderYear: '2026',
      OrderWeek: '48-01',
      CustKey: 10,
      ProdKey: 501,
      BoxQuantity: 10,
      OutQuantity: 10,
      OutUnit: '박스',
      ProdName: 'HYDRANGEA BURGUNDY',
      DisplayName: '콜롬비아 수국 버건디',
      FlowerName: '수국',
      CounName: '콜롬비아',
    },
    // 2026 48-02 exact qty match for CustKey 20 (split across 2 OrderDetail rows: 2 + 3 = 5 boxes)
    {
      OrderMasterKey: 48210,
      OrderYear: '2026',
      OrderWeek: '48-02',
      CustKey: 20,
      ProdKey: 502,
      BoxQuantity: 2,
      OutQuantity: 2,
      OutUnit: '박스',
      ProdName: 'HYDRANGEA WHITE',
      DisplayName: '콜롬비아 수국 화이트',
      FlowerName: '수국',
      CounName: '콜롬비아',
    },
    {
      OrderMasterKey: 48210,
      OrderYear: '2026',
      OrderWeek: '48-02',
      CustKey: 20,
      ProdKey: 502,
      BoxQuantity: 3,
      OutQuantity: 3,
      OutUnit: '박스',
      ProdName: 'HYDRANGEA WHITE',
      DisplayName: '콜롬비아 수국 화이트',
      FlowerName: '수국',
      CounName: '콜롬비아',
    },
    // 2026 48-02 qty diff for CustKey 30 (ERP has 4 boxes, Kakao has 7 boxes)
    {
      OrderMasterKey: 48299,
      OrderYear: '2026',
      OrderWeek: '48-02',
      CustKey: 30,
      ProdKey: 503,
      BoxQuantity: 4,
      OutQuantity: 4,
      OutUnit: '박스',
      ProdName: 'ROSE MONDIAL 60CM',
      DisplayName: '콜롬비아 장미 몬디알 60cm',
      FlowerName: '장미',
      CounName: '콜롬비아',
    },
  ]);

  const rawMsg = {
    id: 'archive:suip-1',
    time: '2026년 11월 25일 오전 10:15',
    text: [
      '48-2 콜 발주 추가',
      '주광 : 수국 버건디 10박스(안티오퀴아)',
      '화성 KCL01 : 수국 화이트 5박스(안티오퀴아)',
      '와이앤제이 YCL6 : 장미 몬디알 60cm 7FB(엘리떼)',
      '수국 블루 8박스(안티오퀴아)',
      '~주광 : 수국 그린 3박스~',
    ].join('\n'),
    items: [],
  };
  const analyzed = analyzeImportMessage(rawMsg);
  const views = analyzed.items.map((it) => importItemView(it));

  // Axis 1: Farm PO totals STILL aggregate all 4 valid items (both customer-named and unnamed stock additions)
  const totals = farmTotals(views);
  assert.equal(totals.length, 4);
  assert.equal(
    totals.reduce((sum, r) => sum + r.quantity, 0),
    10 + 5 + 7 + 8,
  );

  // Axis 2: Domestic Customer ERP Order Status
  const evaluations = views.map((row) => ({
    row,
    evaluation: classifyKakaoItemErpStatus(row, {
      messageType: '추가',
      messageKind: analyzed.kind,
      messageText: analyzed.text,
      customers: sampleCustomers,
      erpOrders,
    }),
    message: analyzed,
  }));

  // 1) 주광 2026/48-02 버건디 10박스 -> UNREGISTERED (2025/48-02 and 2026/48-01 ignored!)
  assert.equal(evaluations[0].evaluation.status, 'UNREGISTERED');
  assert.equal(evaluations[0].evaluation.eligible, true);
  assert.equal(evaluations[0].evaluation.autoSelectable, true);

  // 2) 화성 KCL01 2026/48-02 화이트 5박스 -> REGISTERED (#48210, 2+3=5박스) & blocked from duplicate selection
  assert.equal(evaluations[1].evaluation.status, 'REGISTERED');
  assert.match(evaluations[1].evaluation.badgeLabel, /ERP 등록완료 #48210/);
  assert.equal(evaluations[1].evaluation.eligible, false);
  assert.equal(evaluations[1].evaluation.autoSelectable, false);

  // 3) 와이앤제이 2026/48-02 몬디알 7FB -> DIFF_QTY (ERP 4박스 vs 카톡 7박스) & blocked from auto duplicate add
  assert.equal(evaluations[2].evaluation.status, 'DIFF_QTY');
  assert.match(evaluations[2].evaluation.badgeLabel, /수량차이 #48299/);
  assert.equal(evaluations[2].evaluation.eligible, false);
  assert.equal(evaluations[2].evaluation.autoSelectable, false);

  // 4) Unnamed stock item (수국 블루 8박스) -> NO_CUSTOMER & blocked from customer order handoff
  assert.equal(evaluations[3].evaluation.status, 'NO_CUSTOMER');
  assert.equal(evaluations[3].evaluation.eligible, false);

  // Cancelled / 0-qty / unverified review items are strictly blocked
  const cancelledEval = classifyKakaoItemErpStatus(
    { ...views[0], cancelled: true },
    { messageType: '추가', customers: sampleCustomers, erpOrders },
  );
  assert.equal(cancelledEval.status, 'CANCELLED');
  assert.equal(cancelledEval.eligible, false);

  const signedCancelEval = classifyKakaoItemErpStatus(
    { ...views[0], isCancel: true, sign: -1, signedQty: -10 },
    { messageType: '취소', customers: sampleCustomers, erpOrders },
  );
  assert.equal(signedCancelEval.status, 'CANCELLED');
  assert.equal(signedCancelEval.eligible, false);
  assert.equal(signedCancelEval.autoSelectable, false);

  // Even if eligible were tampered, negative/cancel rows never enter handoff payload
  const tamperedPayload = buildKakaoOrderHandoffPayload([
    {
      row: { ...views[0], isCancel: true, sign: -1, quantity: -10 },
      evaluation: { ...evaluations[0].evaluation, eligible: true },
      message: analyzed,
    },
  ]);
  assert.equal(tamperedPayload.groups.length, 0);

  const zeroQtyEval = classifyKakaoItemErpStatus(
    { ...views[0], quantity: '0' },
    { messageType: '추가', customers: sampleCustomers, erpOrders },
  );
  assert.equal(zeroQtyEval.status, 'CANCELLED');
  assert.equal(zeroQtyEval.eligible, false);

  const unverifiedReview = classifyKakaoItemErpStatus(
    { ...views[0], checked: false },
    { messageType: '검토', messageKind: 'review', customers: sampleCustomers, erpOrders },
  );
  assert.equal(unverifiedReview.status, 'REVIEW_HOLD');
  assert.equal(unverifiedReview.eligible, false);

  // Handoff payload filters out any non-eligible entries even if passed accidentally
  const payload = buildKakaoOrderHandoffPayload(evaluations);
  assert.equal(payload.groups.length, 1);
  assert.equal(payload.groups[0].custKey, 10);
  assert.equal(payload.groups[0].year, '2026');
  assert.equal(payload.groups[0].week, '48-02');
  assert.equal(payload.groups[0].managerName, '김영업');
  assert.equal(countSalesPasteQuantityLines(payload.groups[0].pasteText), 1);
  assert.match(payload.groups[0].pasteText, /^2026년 48-02차\n콜롬비아 수국 버건디 10박스$/);
}

// 5. FB/HB unit normalization & historical out-of-range week choice support in salesPasteOrder
{
  assert.equal(
    formatKakaoItemForSalesPaste({
      country: '콜롬비아',
      group: '장미',
      product: '몬디알 60cm',
      quantity: '5',
      unit: 'FB',
    }),
    '콜롬비아 장미 몬디알 60cm 5박스',
  );

  const baseChoices = buildSalesPasteWeekChoices(new Date('2026-11-25T09:00:00+09:00'));
  assert.equal(baseChoices.length, 12);
  assert.equal(mergeSalesPasteHandoffWeekChoices(baseChoices, null).length, 12);

  const mergedWithPast = mergeSalesPasteHandoffWeekChoices(baseChoices, { year: '2026', week: '47-02' });
  assert.equal(mergedWithPast.length, 13);
  assert.deepEqual(resolveDetectedSalesPasteScope('2026년 47-02차', mergedWithPast), {
    year: '2026',
    week: '47-02',
  });
}

// 6. API Handler unit verification (GET-only, auth check, scope validation, cross-year SQL params)
{
  const executedSql = [];
  const handler = createKakaoOrderStatusHandler({
    types: { NVarChar: 'NVarChar' },
    queryFn: async (sqlText, params) => {
      executedSql.push({ sqlText, params });
      if (/FROM dbo\.Customer/i.test(sqlText)) {
        return { recordset: sampleCustomers };
      }
      return {
        recordset: [
          {
            OrderMasterKey: 49001,
            OrderYear: '2026',
            OrderWeek: '49-01',
            CustKey: 10,
            OrderDetailKey: 1,
            ProdKey: 501,
            BoxQuantity: 10,
            BunchQuantity: 0,
            SteamQuantity: 0,
            OutQuantity: 10,
            ProdName: 'HYDRANGEA BURGUNDY',
            DisplayName: '콜롬비아 수국 버건디',
            FlowerName: '수국',
            CounName: '콜롬비아',
            OutUnit: '박스',
          },
        ],
      };
    },
  });

  const makeRes = () => ({
    statusCode: 200,
    headers: {},
    body: null,
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
      return this;
    },
  });

  // Non-GET -> 405
  const res405 = makeRes();
  await handler({ method: 'POST', user: { userId: 'imp1', deptName: '수입부' }, query: {} }, res405);
  assert.equal(res405.statusCode, 405);

  // Unauthorized role -> 403
  const res403 = makeRes();
  await handler({ method: 'GET', user: { userId: 'v1', deptName: '기타', role: 'viewer' }, query: {} }, res403);
  assert.equal(res403.statusCode, 403);

  // Invalid scope -> 400
  const res400 = makeRes();
  await handler({ method: 'GET', user: { userId: 'imp1', deptName: '수입부' }, query: { scopes: 'invalid' } }, res400);
  assert.equal(res400.statusCode, 400);

  // Valid scoped GET -> 200 + explicit OrderYear & OrderWeek predicates + zero write SQL
  const res200 = makeRes();
  await handler(
    { method: 'GET', user: { userId: 'imp1', deptName: '수입부' }, query: { scopes: '2026:49' } },
    res200,
  );
  assert.equal(res200.statusCode, 200);
  assert.deepEqual(res200.body.scopes, ['2026:49']);
  assert.equal(res200.body.erpOrders.length, 1);
  assert.equal(res200.body.erpOrders[0].OrderMasterKey, 49001);
  assert.equal(executedSql.length, 2);
  assert.match(executedSql[1].sqlText, /om\.OrderYear\s*=\s*@yr0/);
  assert.match(executedSql[1].sqlText, /om\.OrderWeek\s*=\s*@maj0\s+OR\s+om\.OrderWeek\s+LIKE\s+@pfx0/);
  for (const call of executedSql) {
    assert.doesNotMatch(call.sqlText, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|EXEC)\b/i);
  }
}

// 7. Source code guardrails & Desktop policy URL compatibility
{
  const bridgeSrc = fs.readFileSync(
    new URL('../components/import-tools/KakaoOrderRegisterBridge.js', import.meta.url),
    'utf8',
  );
  const apiSrc = fs.readFileSync(
    new URL('../pages/api/import/tools/kakao-order-status.js', import.meta.url),
    'utf8',
  );
  assert.equal(KAKAO_ORDER_HANDOFF_KEY, 'nenova.kakao-order-handoff.v1');
  assert.match(bridgeSrc, /'Pretendard Variable',\s*'Pretendard'/);
  assert.match(bridgeSrc, /font-variant-numeric:\s*tabular-nums/);
  assert.match(bridgeSrc, /mode:\s*'kakao-import'/);
  assert.doesNotMatch(bridgeSrc, /\bmonospace\b|JetBrains\s+Mono/i);
  assert.doesNotMatch(bridgeSrc, /[🚀✨🔥💡]/u);
  assert.doesNotMatch(bridgeSrc, /감시|추적|모니터링|절감시간/);
  assert.doesNotMatch(bridgeSrc, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(apiSrc, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|EXEC)\b/i);

  const extracted = extractScopesFromKakaoEntries(
    [{ row: { year: '2026', week: '48-02' } }, { row: { year: '2026', week: '49' } }],
    { year: 2026, majorWeek: '48' },
  );
  assert.deepEqual(extracted, ['2026:48', '2026:49']);
}

console.log('PASS Kakao ERP order status reconciliation, 2-axis separation, cross-year isolation, and sales-paste handoff');
