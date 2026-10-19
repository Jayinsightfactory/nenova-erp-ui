// 출고→견적서/매출 누락 방지 보호장치 단위 검증 (DB 없음, 가짜 tQ)
// 실행: node __tests__/shipmentEstimateGuard.test.js

async function main() {
  const {
    GUARD_CODES, SHIPMENT_DATE_WEEK_TOLERANCE_DAYS,
    shipmentWeekKeys, validateShipmentWeek, assertShipmentWeekConsistent,
    assertShipmentLineHasOrder, assertNoOrderlessLinesBeforeFix,
    alignShipmentDetailMoneyToDates, alignShipmentDetailMoneyToDatesMany, assertMasterDeletable,
    sqlOrderlessFixedShipments, sqlDetailDateMoneyMismatch, sqlDeletedMasterFixedShipments,
    sqlWeekKeyMismatchMasters, sqlShipmentDateOutOfWeek, GUARD_DIAGNOSTIC_VIEWS,
  } = await import('../lib/shipmentEstimateGuard.js');

  let pass = 0, fail = 0;
  const assert = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${label}`); } };
  const sql = { Int: 'Int', NVarChar: 'NVarChar', Float: 'Float', Bit: 'Bit' };
  const rejects = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.code === code && e.statusCode === 409; } };

  console.log('=== shipmentWeekKeys ===');
  const k = shipmentWeekKeys('2026', '01-02');
  assert('parentWeek 01', k.parentWeek === '01');
  assert('OrderYearWeek = 연도+대차수 202601', k.orderYearWeek === '202601');
  assert('OrderYearWeek2 = 연도+세부차수 20260102', k.orderYearWeek2 === '20260102');
  assert('대차수만 입력 26 → 202626/202626', shipmentWeekKeys(2026, '26').orderYearWeek2 === '202626');

  console.log('\n=== validateShipmentWeek — ④ 차수 키 ===');
  assert('정상 202601', validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202601' }).ok);
  const yearBug = validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202501' });
  assert('2026년 1차가 202501 로 저장되려면 거부', !yearBug.ok && yearBug.code === GUARD_CODES.SHIPMENT_WEEK_KEY_MISMATCH);
  assert('거부 메시지에 기대값 202601', yearBug.expectedOrderYearWeek === '202601' && /202601/.test(yearBug.message));
  const subWeekBug = validateShipmentWeek({ orderYear: '2026', orderWeek: '16-01', orderYearWeek: '20261601' });
  assert('세부차수 포함 20261601 저장 거부(실DB 2건 유형)', !subWeekBug.ok);
  assert('OrderYearWeek 미지정이면 키 비교 생략', validateShipmentWeek({ orderYear: '2026', orderWeek: '16-01' }).ok);
  assert('형식 오류 거부', !validateShipmentWeek({ orderYear: '26', orderWeek: '1-1' }).ok);

  console.log('\n=== validateShipmentWeek — ④ 출고일 범위 (PeriodDay 실값: 202552=12/24~12/30, 202553=12/31, 202601=01/01~01/06) ===');
  const w52 = { weekStartYmd: '2025-12-24', weekEndYmd: '2025-12-30' };
  const w01 = { weekStartYmd: '2026-01-01', weekEndYmd: '2026-01-06' };
  assert('52차 출고일 2025-12-26 OK', validateShipmentWeek({ orderYear: '2025', orderWeek: '52-01', orderYearWeek: '202552', shipmentDtm: '2025-12-26', weekRange: w52 }).ok);
  assert('2026년 1차 출고일 2026-01-02 OK', validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202601', shipmentDtm: new Date(2026, 0, 2, 12), weekRange: w01 }).ok);
  const boundary = validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202601', shipmentDtm: '2025-01-03', weekRange: w01 });
  assert('연말→연초 버그: 2026년 1차에 2025-01-03 출고일 거부', !boundary.ok && boundary.code === GUARD_CODES.SHIPMENT_DATE_OUT_OF_WEEK);
  assert('허용오차 7일: 2025-12-25 는 1차 허용(조기출고)', validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', shipmentDtm: '2025-12-25', weekRange: w01 }).ok);
  assert('허용오차 밖: 2025-12-24 거부', !validateShipmentWeek({ orderYear: '2026', orderWeek: '01-01', shipmentDtm: '2025-12-24', weekRange: w01 }).ok);
  assert('허용오차 상수 7', SHIPMENT_DATE_WEEK_TOLERANCE_DAYS === 7);
  assert('PeriodDay 범위 없으면 날짜 검증 생략', validateShipmentWeek({ orderYear: '2039', orderWeek: '01-01', shipmentDtm: '2039-01-01', weekRange: null }).ok);
  assert('2026년 52차 vs 2027년 1차 경계: 2027-01-01 은 202652 범위(12/23~12/29) 밖이면 거부',
    !validateShipmentWeek({ orderYear: '2026', orderWeek: '52-01', shipmentDtm: '2027-01-08', weekRange: { weekStartYmd: '2026-12-23', weekEndYmd: '2026-12-29' } }).ok);

  console.log('\n=== assertShipmentWeekConsistent (가짜 tQ: PeriodDay) ===');
  const tQPeriod = async (q, p) => ({ recordset: /FROM PeriodDay/.test(q) && p.ywk.value === '202601' ? [{ weekStartYmd: '2026-01-01', weekEndYmd: '2026-01-06' }] : [{ weekStartYmd: null, weekEndYmd: null }] });
  assert('정상 통과', (await assertShipmentWeekConsistent(tQPeriod, sql, { orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202601', shipmentDtm: '2026-01-05' })).ok);
  assert('연도 버그 throw 409', await rejects(() => assertShipmentWeekConsistent(tQPeriod, sql, { orderYear: '2026', orderWeek: '01-01', orderYearWeek: '202501' }), GUARD_CODES.SHIPMENT_WEEK_KEY_MISMATCH));
  assert('출고일 2025-01-02 throw 409', await rejects(() => assertShipmentWeekConsistent(tQPeriod, sql, { orderYear: '2026', orderWeek: '01-01', shipmentDtm: '2025-01-02' }), GUARD_CODES.SHIPMENT_DATE_OUT_OF_WEEK));

  console.log('\n=== assertShipmentLineHasOrder — ① 주문 없는 출고 ===');
  const mkTQ = (row) => {
    const calls = [];
    const tQ = async (q, p) => { calls.push({ q, p }); return { recordset: [row] }; };
    tQ.calls = calls; return tQ;
  };
  const ok = mkTQ({ orderCount: 1 });
  assert('ViewOrder 에 있으면 통과', (await assertShipmentLineHasOrder(ok, sql, { orderYear: '2026', orderWeek: '26-02', custKey: 533, prodKey: 389 })).ok);
  assert('조인키 OrderYearWeek2 = 20262602 (세부차수 포함)', ok.calls[0].p.yw2.value === '20262602' && /ViewOrder vo/.test(ok.calls[0].q));
  const none = mkTQ({ orderCount: 0, custName: '동산', prodName: 'CARNATION Moon Light', custDeleted: 0, prodDeleted: 0, rawOrderCount: 0 });
  let err = null; try { await assertShipmentLineHasOrder(none, sql, { orderYear: '2026', orderWeek: '26-02', custKey: 1, prodKey: 2 }); } catch (e) { err = e; }
  assert('주문 없으면 409 SHIPMENT_WITHOUT_ORDER', err?.code === GUARD_CODES.SHIPMENT_WITHOUT_ORDER && err.statusCode === 409);
  assert('사유: 주문서에 품목 추가 안내', /주문서에 품목을 먼저 추가/.test(err?.message) && /동산/.test(err.message) && /Moon Light/.test(err.message));
  err = null; try { await assertShipmentLineHasOrder(mkTQ({ orderCount: 0, custDeleted: 1, custName: '신라호텔 발주용 코드' }), sql, { orderYear: '2026', orderWeek: '01-01', custKey: 1, prodKey: 2 }); } catch (e) { err = e; }
  assert('삭제 거래처 사유 구분', /삭제\(isDeleted=1\)/.test(err?.message) && /신라호텔/.test(err.message));
  err = null; try { await assertShipmentLineHasOrder(mkTQ({ orderCount: 0, rawOrderCount: 1 }), sql, { orderYear: '2026', orderWeek: '01-01', custKey: 1, prodKey: 2 }); } catch (e) { err = e; }
  assert('주문은 있는데 담당자 UserInfo 미매칭 사유 구분', /담당자/.test(err?.message));

  console.log('\n=== assertNoOrderlessLinesBeforeFix — 확정 전 ===');
  assert('없으면 통과', (await assertNoOrderlessLinesBeforeFix(async () => ({ recordset: [] }), sql, { orderYear: '2026', orderWeek: '42-01' })).ok);
  const fixTQ = mkTQ({ SdetailKey: 1, CustKey: 5, CustName: '아이엠', ProdKey: 7, ProdName: 'Rose', OutQuantity: 3 });
  assert('있으면 409 + 목록', await rejects(() => assertNoOrderlessLinesBeforeFix(fixTQ, sql, { orderYear: '2026', orderWeek: '42-01', custKey: 5, countryFlower: 'CO-Rose' }), GUARD_CODES.SHIPMENT_WITHOUT_ORDER));
  assert('범위 파라미터 custKey/countryFlower 적용', /sm.CustKey = @ck/.test(fixTQ.calls[0].q) && /p.CountryFlower = @cf/.test(fixTQ.calls[0].q) && /ISNULL\(sd.isFix,0\) = 0/.test(fixTQ.calls[0].q));

  console.log('\n=== alignShipmentDetailMoneyToDates — ② 금액 동기화 ===');
  const mkAlign = (row) => { const calls = []; const tQ = async (q, p) => { calls.push({ q, p }); return { recordset: /UPDATE/.test(q) ? [] : [row] }; }; tQ.calls = calls; return tQ; };
  // 조사 사례: 박스 수량으로 금액 계산된 Detail(1박스 단가 9,000 → 8,182) vs Date(15단 → 122,727)
  let t = mkAlign({ n: 1, priced: 1, detailEst: 1, detailCost: 9000, detailAmount: 8182, detailVat: 818, estSum: 15, amountSum: 122727, vatSum: 12273, minCost: 9000, maxCost: 9000 });
  let r = await alignShipmentDetailMoneyToDates(t, sql, 77);
  assert('금액 불일치 → UPDATE 1회', r.changed && t.calls.filter(c => /UPDATE ShipmentDetail/.test(c.q)).length === 1);
  const upd = t.calls.find(c => /UPDATE ShipmentDetail/.test(c.q)).p;
  assert('Amount/Vat ← Date 합', upd.amount.value === 122727 && upd.vat.value === 12273);
  assert('EstQuantity 는 기본 유지(박스 1)', !('est' in upd) && r.after.est === 1);
  assert('Cost 균일하면 복사', upd.cost.value === 9000);
  t = mkAlign({ n: 1, priced: 1, detailEst: 1, detailCost: 9000, detailAmount: 8182, detailVat: 818, estSum: 15, amountSum: 122727, vatSum: 12273, minCost: 9000, maxCost: 9000 });
  r = await alignShipmentDetailMoneyToDates(t, sql, 77, { alignEstQuantity: true });
  assert('옵션 켜면 EstQuantity ← Date 합 15', r.after.est === 15);
  t = mkAlign({ n: 2, priced: 2, detailEst: 11, detailCost: 9000, detailAmount: 990000, detailVat: 99000, estSum: 330, amountSum: 990000, vatSum: 99000, minCost: 9000, maxCost: 9000 });
  r = await alignShipmentDetailMoneyToDates(t, sql, 64448);
  assert('이미 일치(실DB 64448 유형: Est 11박스 vs Date 330송이, 금액 동일) → 변경 없음', !r.changed && r.reason === 'already-synced' && t.calls.length === 1);
  t = mkAlign({ n: 1, priced: 0, detailEst: 125, detailCost: 69000, detailAmount: 7840909, detailVat: 784090, estSum: 0, amountSum: 0, vatSum: 0, minCost: null, maxCost: null });
  r = await alignShipmentDetailMoneyToDates(t, sql, 51933);
  assert('출고일 금액 전부 NULL(실DB 51933 유형, exe 견적 미작성) → Detail 을 0 으로 밀지 않음', !r.changed && r.reason === 'dates-unpriced' && t.calls.length === 1);
  t = mkAlign({ n: 0, detailAmount: 500 });
  r = await alignShipmentDetailMoneyToDates(t, sql, 1);
  assert('ShipmentDate 없으면 Detail 을 0 으로 밀지 않음', !r.changed && r.reason === 'no-dates');
  t = mkAlign({ n: 2, priced: 2, detailEst: 10, detailCost: 1000, detailAmount: 100, detailVat: 10, estSum: 10, amountSum: 200, vatSum: 20, minCost: 1000, maxCost: 1200 });
  r = await alignShipmentDetailMoneyToDates(t, sql, 2);
  assert('혼합 단가면 Cost 는 Detail 유지', r.changed && r.after.cost === 1000 && r.after.amount === 200);
  t = mkAlign({ n: 2, priced: 2, detailEst: 1, detailCost: 1, detailAmount: 654545, detailVat: 65455, estSum: 1, amountSum: 654546, vatSum: 65454, minCost: 1, maxCost: 1 });
  assert('출고일 2건 분할 반올림 ±1원(실DB 53828 유형)은 불일치로 안 봄', !(await alignShipmentDetailMoneyToDates(t, sql, 3)).changed);
  t = mkAlign({ n: 1, priced: 1, detailEst: 1, detailCost: 1, detailAmount: 100, detailVat: 10, estSum: 1, amountSum: 102, vatSum: 10, minCost: 1, maxCost: 1 });
  assert('2원 차이는 동기화', (await alignShipmentDetailMoneyToDates(t, sql, 3)).changed);
  for (const option of [undefined, false, 0, 'true']) {
    t = mkAlign({ n: 2, priced: 2, detailEst: null, detailCost: null, detailAmount: 100, detailVat: 10, estSum: 5, amountSum: 200, vatSum: 20, minCost: 10, maxCost: 20 });
    r = await alignShipmentDetailMoneyToDates(t, sql, 4, { alignEstQuantity: option });
    const write = t.calls.find(c => /UPDATE ShipmentDetail/.test(c.q));
    assert('NULL 수량 및 혼합단가 보존: ' + option, r.changed && r.after.est === null && r.after.cost === null && !/EstQuantity=|Cost=/.test(write.q) && !('est' in write.p) && !('cost' in write.p));
  }
  const many = await alignShipmentDetailMoneyToDatesMany(mkAlign({ n: 0 }), sql, [1, 1, '2', 0, null]);
  assert('다중 키 중복·무효 제거 → 2건', many.length === 2);

  console.log('\n=== assertMasterDeletable — ③ 삭제 보호 ===');
  assert('확정 출고 없으면 삭제 가능', (await assertMasterDeletable(async () => ({ recordset: [] }), sql, { entity: 'customer', key: 9 })).ok);
  err = null; try { await assertMasterDeletable(async () => ({ recordset: [{ OrderYear: '2026', OrderWeek: '01-01', cnt: 12, amount: 8408880 }, { OrderYear: '2026', OrderWeek: '01-02', cnt: 3, amount: 1 }] }), sql, { entity: 'customer', key: 9 }); } catch (e) { err = e; }
  assert('확정 출고 있으면 409 + 건수 15 + 차수', err?.code === GUARD_CODES.MASTER_HAS_FIXED_SHIPMENT && err.fixedCount === 15 && /2026-01-01\(12\)/.test(err.message));
  const prodTQ = mkTQ(undefined); prodTQ.calls.length = 0;
  await assertMasterDeletable(async (q) => { prodTQ.calls.push({ q }); return { recordset: [] }; }, sql, { entity: 'product', key: 1 });
  assert('품목은 sd.ProdKey 기준', /sd.ProdKey = @key/.test(prodTQ.calls[0].q));
  let bad = false; try { await assertMasterDeletable(async () => ({ recordset: [] }), sql, { entity: 'flower', key: 1 }); } catch { bad = true; }
  assert('알 수 없는 entity 거부', bad);

  console.log('\n=== 진단 SQL (읽기 전용·exe 산식과 같은 조인키) ===');
  for (const [name, def] of Object.entries(GUARD_DIAGNOSTIC_VIEWS)) {
    const q = def.sql({ orderYear: '2026', weekMin: 1 });
    assert(`${name}: SELECT 만`, /^\s*SELECT/i.test(q) && !/\b(UPDATE|DELETE|INSERT|MERGE)\b/i.test(q));
    assert(`${name}: orderYear 파라미터`, /@orderYear/.test(q));
  }
  assert('G1 ViewOrder OrderYearWeek2 = 연도+REPLACE(OrderWeek)', /OrderYearWeek2 = sm.OrderYear \+ REPLACE\(sm.OrderWeek,'-',''\)/.test(sqlOrderlessFixedShipments()));
  assert('G1 살아있는 거래처·품목만(G3 과 분리)', /c.isDeleted,0\) = 0/.test(sqlOrderlessFixedShipments()) && /p.isDeleted,0\) = 0/.test(sqlOrderlessFixedShipments()));
  assert('G2 Amount/Vat 만 비교(EstQuantity 비교 없음)', /ABS\(ISNULL\(sd.Amount,0\) - x.amountSum\)/.test(sqlDetailDateMoneyMismatch()) && !/ABS\(ISNULL\(sd.EstQuantity/.test(sqlDetailDateMoneyMismatch()));
  assert('G2 fixedOnly=false 허용', !/sd.isFix,0\) = 1/.test(sqlDetailDateMoneyMismatch({ fixedOnly: false })));
  assert('G2 금액 기재된 출고일만(priced>0) / G2b 는 priced=0', /x.priced > 0/.test(sqlDetailDateMoneyMismatch()) && /x.priced = 0/.test(GUARD_DIAGNOSTIC_VIEWS.detailWithUnpricedDates.sql()));
  assert('G3 isDeleted=1 OR 매칭 없음', /c.isDeleted,0\) = 1 OR ISNULL\(p.isDeleted,0\) = 1/.test(sqlDeletedMasterFixedShipments()));
  assert('G4a 기대키 = OrderYear+대차수', /expectedOrderYearWeek/.test(sqlWeekKeyMismatchMasters()));
  assert('G4b 허용오차 7일', /DATEADD\(day, -7,/.test(sqlShipmentDateOutOfWeek()) && /DATEADD\(day, 7,/.test(sqlShipmentDateOutOfWeek()));
  assert('weekMin 숫자만 삽입', />= 3\b/.test(sqlOrderlessFixedShipments({ weekMin: '3; DROP' })) === false && />= 1\b/.test(sqlOrderlessFixedShipments({ weekMin: '3; DROP' })));

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
