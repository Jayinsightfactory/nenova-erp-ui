import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExpectedPhysicalSnapshot,
  assertWeekdaySnapshotDigest,
  buildWeekdayChangePlan,
  canonicalWeekdaySnapshotDigestInput,
  canonicalPhysicalSnapshot,
  normalizeWeekdayApplyRequest,
  resolveNewTargetCosts,
  weekdaySnapshotDigest,
  weekdayRequestHash,
} from '../lib/weekdayDistributionPolicy.js';

const operationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function dateRow(overrides = {}) {
  return {
    sdateKey: 119701,
    sdetailKey: 89892,
    shipmentKey: 6266,
    date: '2026-09-10',
    timestamp: '2026-09-10 00:00:00.000',
    shipmentQuantity: 5,
    estimateQuantity: 150,
    detailFixed: true,
    cost: 2500.12345,
    amount: 340909,
    vat: 34091,
    ...overrides,
  };
}

function physical(overrides = {}) {
  const shipmentDates = overrides.shipmentDates || [
    dateRow(),
    dateRow({
      sdateKey: 119700,
      date: '2026-09-13',
      timestamp: '2026-09-13 00:00:00.000',
      shipmentQuantity: 20,
      estimateQuantity: 600,
      amount: 1363636,
      vat: 136364,
    }),
  ];
  return {
    detailRows: 1,
    shipmentOutQuantity: 25,
    shipmentDates,
    detail: {
      SdetailKey: 89892, ShipmentKey: 6266, CustKey: 533, ProdKey: 866,
      OutQuantity: 25, BoxQuantity: 25, BunchQuantity: 750, SteamQuantity: 750,
      EstQuantity: 750, DetailCost: 2500.12345, DetailAmount: 1704545,
      DetailVat: 170455, DetailIsFix: 1,
    },
    master: { ShipmentKey: 6266, MasterIsFix: 1, OrderYearWeek: '202637' },
    product: {
      ProdKey: 866,
      ProdName: '카네이션 fixture',
      OutUnit: '박스',
      EstUnit: '단',
      BunchOf1Box: 30,
      SteamOf1Bunch: 1,
      SteamOf1Box: 30,
    },
    ...overrides,
  };
}

function requestChange(overrides = {}) {
  const actual = overrides.actual || physical();
  const change = {
    year: '2026',
    orderWeek: '37-01',
    prodKey: 866,
    unit: '박스',
    dates: [{ date: '2026-09-10', quantity: 5 }],
    ...overrides,
    actual: undefined,
  };
  const expected = overrides.expected || canonicalPhysicalSnapshot(actual);
  change.expected = {
    ...expected,
    snapshotDigest: expected.snapshotDigest || weekdaySnapshotDigest({ ...change, custKey: 533 }, actual),
  };
  return change;
}

function normalizedChange(overrides = {}) {
  const change = requestChange(overrides);
  return normalizeWeekdayApplyRequest({
    operationId,
    reason: '요일별 배분 테스트',
    custKey: 533,
    changes: [change],
  }).changes[0];
}

function calendar(rows = {}) {
  return new Map(Object.entries({
    '2026-09-10': { timestamp: '2026-09-10 00:00:00.000', weekDay: 5 },
    '2026-09-13': { timestamp: '2026-09-13 00:00:00.000', weekDay: 1 },
    '2026-09-11': { timestamp: '2026-09-11 00:00:00.000', weekDay: 6 },
    ...rows,
  }));
}

test('실제 37-01 Prod866 물리 snapshot과 4자리 이상 단가를 축약하지 않는다', () => {
  const actual = physical();
  const canonical = canonicalPhysicalSnapshot(actual);
  assert.equal(canonical.shipmentDates.find((row) => row.sdateKey === 119700).estimateQuantity, 600);
  assert.equal(canonical.shipmentDates.find((row) => row.sdateKey === 119701).cost, 2500.12345);
  assert.deepEqual(assertExpectedPhysicalSnapshot(actual, canonical), canonical);
  assert.throws(() => assertExpectedPhysicalSnapshot(actual, {
    ...canonical,
    shipmentDates: canonical.shipmentDates.map((row, index) => index ? row : { ...row, cost: 2500.1234 }),
  }), { code: 'STALE_SNAPSHOT' });
});

test('request hash는 정렬된 동일 payload에 안정적이고 operationId는 hash에서 제외된다', () => {
  const one = normalizeWeekdayApplyRequest({ operationId, reason: 'r', custKey: 533, changes: [requestChange()] });
  const two = normalizeWeekdayApplyRequest({ ...one, operationId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' });
  assert.equal(weekdayRequestHash(one), weekdayRequestHash(two));
});

test('snapshot digest는 상세 금액·마스터 확정·제품 환산 변경을 stale로 차단한다', () => {
  const actual = physical();
  const change = normalizedChange({ actual });
  assert.equal(assertWeekdaySnapshotDigest(change, actual), change.expected.snapshotDigest);
  assert.equal(canonicalWeekdaySnapshotDigestInput(change, actual).detail.cost, '2500.12345');
  assert.throws(() => assertWeekdaySnapshotDigest(change, physical({
    detail: { ...actual.detail, DetailAmount: actual.detail.DetailAmount + 1 },
  })), { code: 'STALE_SNAPSHOT' });
  assert.throws(() => assertWeekdaySnapshotDigest(change, physical({
    master: { ...actual.master, MasterIsFix: 0 },
  })), { code: 'STALE_SNAPSHOT' });
  assert.throws(() => assertWeekdaySnapshotDigest(change, physical({
    product: { ...actual.product, BunchOf1Box: 20 },
  })), { code: 'STALE_SNAPSHOT' });
});

test('snapshot digest가 없는 legacy payload는 fallback 없이 차단한다', () => {
  const actual = physical();
  assert.throws(() => normalizeWeekdayApplyRequest({
    operationId,
    reason: 'digest required',
    custKey: 533,
    changes: [{
      year: '2026', orderWeek: '37-01', prodKey: 866, unit: '박스',
      expected: canonicalPhysicalSnapshot(actual),
      dates: [{ date: '2026-09-10', quantity: 5 }],
    }],
  }), { code: 'EXPECTED_SNAPSHOT_DIGEST_REQUIRED' });
});

test('118품목 x 6차수의 708 digest는 DB N+1 없이 순수 bulk row 자료에서 결정된다', () => {
  const weeks = ['37-01','37-02','38-01','38-02','39-01','39-02'];
  const digests = [];
  for (const orderWeek of weeks) for (let prodKey = 1; prodKey <= 118; prodKey += 1) {
    const actual = physical({
      master: { ShipmentKey: 6000 + Number(orderWeek.slice(0,2)), MasterIsFix: 1, OrderYearWeek: `2026${orderWeek.slice(0,2)}` },
      detail: { ...physical().detail, ProdKey: prodKey },
      product: { ...physical().product, ProdKey: prodKey },
    });
    digests.push(weekdaySnapshotDigest({ year:'2026',orderWeek,custKey:533,prodKey }, actual));
  }
  assert.equal(digests.length,708);
  assert.equal(new Set(digests).size,708);
  assert.ok(digests.every((value)=>/^[0-9a-f]{64}$/.test(value)));
});

test('기존 일요일 legacy 날짜는 38-02에서도 수정과 0 삭제 source로 허용한다', () => {
  const legacy = physical({
    shipmentOutQuantity: 3,
    shipmentDates: [dateRow({
      sdateKey: 119353,
      sdetailKey: 89893,
      date: '2026-09-20',
      timestamp: '2026-09-20 00:00:00.000',
      shipmentQuantity: 3,
      estimateQuantity: 90,
      cost: 3400,
    })],
    detail: { SdetailKey: 89893, DetailCost: 3400, DetailIsFix: 1 },
  });
  const changed = normalizedChange({
    actual: legacy,
    orderWeek: '38-02',
    prodKey: 3124,
    expected: canonicalPhysicalSnapshot(legacy),
    dates: [{ date: '2026-09-20', quantity: 0 }],
  });
  const plan = buildWeekdayChangePlan(changed, legacy, new Map([
    ['2026-09-20', { timestamp: '2026-09-20 00:00:00.000', weekDay: 1 }],
  ]));
  assert.equal(plan.newTotal, 0);
  assert.equal(plan.purged, true);
});

test('새 양수 날짜만 suffix canonical 요일을 요구한다', () => {
  const actual = physical();
  const invalid = normalizedChange({
    expected: canonicalPhysicalSnapshot(actual),
    dates: [{ date: '2026-09-14', quantity: 1 }],
  });
  assert.throws(() => buildWeekdayChangePlan(invalid, actual, calendar({
    '2026-09-14': { timestamp: '2026-09-14 00:00:00.000', weekDay: 2 },
  })), { code: 'CALENDAR_MISMATCH' });
  const valid = normalizedChange({
    expected: canonicalPhysicalSnapshot(actual),
    dates: [{ date: '2026-09-11', quantity: 2 }],
  });
  assert.equal(buildWeekdayChangePlan(valid, actual, calendar()).newTotal, 27);
});

test('same-total 날짜 이동은 생략 날짜를 보존하고 기존 미변경 정밀 수량을 유지한다', () => {
  const legacyQuantity = 0.2666666;
  const actual = physical({
    shipmentOutQuantity: 5,
    shipmentDates: [
      dateRow({ shipmentQuantity: legacyQuantity, estimateQuantity: 8, cost: 2500.12345 }),
      dateRow({ sdateKey: 2, date: '2026-09-11', timestamp: '2026-09-11 00:00:00.000', shipmentQuantity: 4.7333334, estimateQuantity: 142 }),
    ],
  });
  const change = normalizedChange({
    actual,
    expected: canonicalPhysicalSnapshot(actual),
    dates: [
      { date: '2026-09-10', quantity: 0 },
      { date: '2026-09-11', quantity: 5 },
    ],
  });
  const plan = buildWeekdayChangePlan(change, actual, calendar());
  assert.equal(plan.newTotal, 5);
  assert.equal(plan.delta, 0);
  assert.equal(plan.finalDates[0].shipmentQuantity, 5);
});

test('신규 existing-master target은 fixed same-total source와 유일한 양수 단가만 상속한다', () => {
  const sourceActual = physical();
  const source = buildWeekdayChangePlan(normalizedChange({
    actual: sourceActual,
    expected: canonicalPhysicalSnapshot(sourceActual),
    dates: [{ date: '2026-09-13', quantity: 15 }],
  }), sourceActual, calendar());
  const targetActual = physical({
    detailRows: 0,
    shipmentOutQuantity: null,
    shipmentDates: [],
    detail: null,
    master: { ShipmentKey: 7000, MasterIsFix: 1 },
  });
  const target = buildWeekdayChangePlan(normalizedChange({
    actual: targetActual,
    orderWeek: '37-02',
    expected: canonicalPhysicalSnapshot(targetActual),
    dates: [{ date: '2026-09-15', quantity: 5 }],
  }), targetActual, new Map([
    ['2026-09-15', { timestamp: '2026-09-15 00:00:00.000', weekDay: 2 }],
  ]));
  resolveNewTargetCosts([source, target]);
  assert.equal(target.inheritedCost, 2500.12345);
  source.fixed = false;
  assert.throws(() => resolveNewTargetCosts([source, target]), { code: 'NEEDS_REDESIGN' });
});

test('신규 target은 양수 단가와 NULL/0 원천을 섞어 유일 단가로 오인하지 않는다', () => {
  const base = { change:{prodKey:866}, newDetail:false, fixed:true, delta:-5 };
  const validSource = {
    ...base,
    actual:{detail:{DetailCost:2500}},
  };
  const invalidSource = {
    ...base,
    change:{prodKey:866,orderWeek:'38-01'},
    actual:{detail:{DetailCost:null}},
  };
  const target = {
    change:{prodKey:866,orderWeek:'38-02'},newDetail:true,fixed:true,delta:10,
    actual:{master:{MasterIsFix:true}},
  };
  assert.throws(() => resolveNewTargetCosts([validSource,invalidSource,target]), (error) => (
    error.code === 'NEEDS_REDESIGN' && error.missingScope?.includes('new-target-price')
  ));
});
