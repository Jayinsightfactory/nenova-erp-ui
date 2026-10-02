import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  allocateWeekdayShipmentDetailKey,
  assertExactProductConversion,
  assertWeekdayPricePreservation,
  insertWeekdayShipmentDate,
  readWeekdayChanges,
  readWeekdayOperation,
  readWeekdayCalendar,
  weekdayDistributionErrorResponse,
  weekdayRollbackAcknowledgement,
} from '../lib/weekdayDistributionApply.js';
import { materializeOverflowTargets } from '../lib/estimateOverflow.js';
import { buildWeekdayChangePlan } from '../lib/weekdayDistributionPolicy.js';

const types = {
  Int: 'Int', Float: 'Float', DateTime: 'DateTime', NVarChar: 'NVarChar',
  UniqueIdentifier: 'UniqueIdentifier', Char: (size) => `Char(${size})`, VarChar: (size) => `VarChar(${size})`,
};

function calendarFixture({ storage = 'nvarchar', anchorRows = 1, dayRows = {}, timestamp = '2026-10-04 00:00:00.000' } = {}) {
  const calls = [];
  const change = {
    year: '2026', orderWeek: '40-01', custKey: 533, prodKey: 866,
    dates: [{ date: '2026-10-01', quantity: 5 }, { date: '2026-10-04', quantity: 15 }],
  };
  const actual = {
    detailRows: 1, shipmentOutQuantity: 20,
    detail: { SdetailKey: 93742, DetailIsFix: 1 },
    master: { ShipmentKey: 1, MasterIsFix: 1 },
    shipmentDates: [{
      sdateKey: 124386, sdetailKey: 93742, shipmentKey: 1,
      date: '2026-10-04', timestamp, shipmentQuantity: 20,
      estimateQuantity: 600, detailFixed: true, cost: 2500, amount: 1363636, vat: 136364,
    }],
  };
  change.expected = {
    detailRows: actual.detailRows, shipmentOutQuantity: actual.shipmentOutQuantity,
    shipmentDates: actual.shipmentDates,
  };
  const executor = async (statement, params) => {
    calls.push({ statement, params });
    const anchor = Object.hasOwn(params, 'anchorYwk');
    const date = anchor ? '2026-10-01' : params.date.value;
    const rawRows = anchor
      ? Array.from({ length: anchorRows }, () => ({ BaseYmd: storage === 'nvarchar' ? date : `${date} 00:00:00.000`, WeekDay: 5 }))
      : dayRows[date] ?? [{ BaseYmd: storage === 'nvarchar' ? date : `${date} 00:00:00.000`, WeekDay: date.endsWith('01') ? 5 : 1 }];
    // Model SQL's type distinction without Date/timezone coercion. The fake
    // only canonicalizes when the production query explicitly converts first.
    const converted = /CONVERT\(nvarchar\(23\),CONVERT\(datetime,BaseYmd,121\),121\)/.test(statement);
    return { recordset: rawRows.map((row) => {
      const raw = row.BaseYmd;
      return {
        Date: raw.slice(0, 10), WeekDay: row.WeekDay,
        Timestamp: converted && raw.length === 10 ? `${raw} 00:00:00.000` : raw,
      };
    }) };
  };
  return { calls, change, actual, executor };
}

for (const storage of ['nvarchar', 'datetime']) {
  test(`${storage} 달력은 anchor/day 모두 SQL datetime 선변환으로 20→15+5를 허용한다`, async () => {
    const fixture = calendarFixture({ storage });
    const calendar = await readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual);
    const plan = buildWeekdayChangePlan(fixture.change, fixture.actual, calendar);
    assert.equal(plan.newTotal, 20);
    assert.equal(plan.delta, 0);
    assert.deepEqual(plan.finalDates.map((row) => [row.timestamp, row.shipmentQuantity]), [
      ['2026-10-01 00:00:00.000', 5], ['2026-10-04 00:00:00.000', 15],
    ]);
    assert.equal(fixture.calls[0].params.anchorYwk.value, '202640');
    assert.equal(fixture.calls.length, 3);
    for (const call of fixture.calls) {
      assert.match(call.statement, /CONVERT\(nvarchar\(10\),CONVERT\(datetime,BaseYmd,121\),120\)/);
      assert.match(call.statement, /CONVERT\(nvarchar\(23\),CONVERT\(datetime,BaseYmd,121\),121\)/);
      assert.match(call.statement, /WITH \(UPDLOCK,HOLDLOCK\)/);
    }
  });
}

test('nvarchar에 저장된 실제 nonmidnight 시각은 보존하고 정확히 일치할 때만 허용한다', async () => {
  const timestamp = '2026-10-04 12:34:56.123';
  const fixture = calendarFixture({ timestamp, dayRows: {
    '2026-10-04': [{ BaseYmd: timestamp, WeekDay: 1 }],
  } });
  const calendar = await readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual);
  assert.equal(calendar.get('2026-10-04').timestamp, timestamp);
  fixture.actual.shipmentDates[0].timestamp = '2026-10-04 00:00:00.000';
  await assert.rejects(readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual), {
    code: 'CALENDAR_TIMESTAMP_MISMATCH',
  });
});

test('동일 날짜의 다른 ShipmentDate 시각도 계속 거부한다', async () => {
  const fixture = calendarFixture({ timestamp: '2026-10-04 12:00:00.000' });
  await assert.rejects(readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual), {
    code: 'CALENDAR_TIMESTAMP_MISMATCH',
  });
});

for (const count of [0, 2]) {
  test(`목요일 anchor ${count}건은 계속 거부한다`, async () => {
    const fixture = calendarFixture({ anchorRows: count });
    await assert.rejects(readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual), {
      code: 'CALENDAR_MISMATCH',
    });
  });
  test(`신규 날짜 달력 ${count}건은 계속 거부한다`, async () => {
    const fixture = calendarFixture({ dayRows: {
      '2026-10-01': Array.from({ length: count }, () => ({ BaseYmd: '2026-10-01', WeekDay: 5 })),
    } });
    const calendar = await readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual);
    assert.throws(() => buildWeekdayChangePlan(fixture.change, fixture.actual, calendar), {
      code: 'CALENDAR_MISMATCH',
    });
  });
  test(`기존 출고일 달력 ${count}건도 정확 시각 검증에서 거부한다`, async () => {
    const fixture = calendarFixture({ dayRows: {
      '2026-10-04': Array.from({ length: count }, () => ({ BaseYmd: '2026-10-04', WeekDay: 1 })),
    } });
    await assert.rejects(readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual), {
      code: 'CALENDAR_TIMESTAMP_MISMATCH',
    });
  });
}

test('업무주 밖 신규 날짜와 기존 출고일은 계속 거부한다', async () => {
  const fixture = calendarFixture();
  fixture.change.dates[0].date = '2026-10-08';
  const calendar = await readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual);
  assert.throws(() => buildWeekdayChangePlan(fixture.change, fixture.actual, calendar), {
    code: 'CALENDAR_MISMATCH',
  });
  fixture.actual.shipmentDates[0].date = '2026-10-08';
  await assert.rejects(readWeekdayCalendar(fixture.executor, types, fixture.change, fixture.actual), {
    code: 'CALENDAR_SCOPE_MISMATCH',
  });
});

function conversionPlan(overrides = {}) {
  return {
    identity: '2026/37-01/업체533/품목866',
    actual: { product: {
      OutUnit: '박스', EstUnit: '단', BunchOf1Box: 30,
      SteamOf1Bunch: 1, SteamOf1Box: 30,
      ...overrides,
    } },
  };
}

test('실제 박스→견적 30단 환산은 5박스=150단으로 왕복한다', () => {
  const converted = assertExactProductConversion(conversionPlan(), 5);
  assert.equal(converted.outQty, 5);
  assert.equal(converted.estQty, 150);
  assert.throws(() => assertExactProductConversion(conversionPlan({ BunchOf1Box: 0 }), 5), {
    code: 'UNIT_CONVERSION_UNSUPPORTED',
  });
});

test('legacy fractional total이 정수 견적단위로 왕복되지 않으면 명시 차단한다', () => {
  assert.throws(() => assertExactProductConversion(conversionPlan(), 0.2666666), {
    code: 'UNIT_CONVERSION_ROUNDTRIP_FAILED',
  });
});

test('30단/박스의 변경 날짜 0.05박스는 2단으로 반올림되어 정확 왕복되지 않으므로 차단한다', () => {
  assert.throws(() => assertExactProductConversion(conversionPlan(), 0.05), {
    code: 'UNIT_CONVERSION_ROUNDTRIP_FAILED',
  });
  assert.equal(assertExactProductConversion(conversionPlan(), 0.1).estQty, 3);
});

test('OutUnit 단은 SteamOf1Bunch로 박스 수를 재분할하지 않고 30단=1박스·300송이로 저장한다', () => {
  const converted = assertExactProductConversion(conversionPlan({
    OutUnit:'단',EstUnit:'단',BunchOf1Box:30,SteamOf1Bunch:10,SteamOf1Box:300,
  }), 30);
  assert.equal(converted.outQty,30);
  assert.equal(converted.box,1);
  assert.equal(converted.bunch,30);
  assert.equal(converted.steam,300);
  assert.equal(converted.estQty,30);
});

function pricePreservationPlan({ sourceCost = 2000, targetCost = 2000 } = {}) {
  return {
    identity:'2026/37-01/업체533/품목866',
    change:{year:'2026',orderWeek:'37-01',custKey:533,prodKey:866},
    delta:0,
    before:{shipmentDates:[{
      date:'2026-09-10',shipmentQuantity:10,estimateQuantity:300,
      cost:sourceCost,amount:Math.round(sourceCost * 300 / 1.1),
      vat:(sourceCost * 300) - Math.round(sourceCost * 300 / 1.1),
    }]},
    finalDates:[{
      date:'2026-09-11',timestamp:'2026-09-11 00:00:00.000',
      shipmentQuantity:10,cost:null,
    }],
    actual:{
      detail:{DetailCost:targetCost},
      product:{OutUnit:'박스',EstUnit:'단',BunchOf1Box:30,SteamOf1Bunch:1,SteamOf1Box:30},
    },
  };
}

test('same-total 날짜 이동은 실제 DateCost별 견적수량과 Amount+Vat을 보존한다', () => {
  assert.doesNotThrow(() => assertWeekdayPricePreservation([pricePreservationPlan()]));
  assert.throws(() => assertWeekdayPricePreservation([pricePreservationPlan({
    sourceCost:2000,targetCost:2500,
  })]), (error) => error.code === 'NEEDS_REDESIGN'
    && error.missingScope?.includes('date-price-transfer-policy'));
});

test('순증가가 있어도 감소·증가 날짜의 유효 단가 bucket이 다르면 암묵적 재가격을 차단한다', () => {
  const incompatible = pricePreservationPlan({sourceCost:2000,targetCost:2500});
  incompatible.delta = 1;
  incompatible.finalDates[0].shipmentQuantity = 11;
  assert.throws(() => assertWeekdayPricePreservation([incompatible]), (error) => (
    error.code === 'NEEDS_REDESIGN' && error.missingScope?.includes('date-price-transfer-policy')
  ));

  const singlePrice = pricePreservationPlan({sourceCost:2000,targetCost:2000});
  singlePrice.delta = 1;
  singlePrice.finalDates[0].shipmentQuantity = 11;
  assert.doesNotThrow(() => assertWeekdayPricePreservation([singlePrice]));
});

test('weekday 신규 상세키는 active/history/KeyNumbering 상한보다 크게 예약한다', async () => {
  const calls = [];
  const key = await allocateWeekdayShipmentDetailKey(async (statement, params = {}) => {
    calls.push({ statement, params });
    if (/AS ActiveMax/.test(statement)) {
      return { recordset: [{ ActiveMax:89892,HistoryMax:89893,NumberingMax:90000 }] };
    }
    return { rowsAffected:[1] };
  }, types);
  assert.equal(key, 90001);
  assert.equal(calls.length,2);
  assert.match(calls[0].statement, /dbo\.ShipmentHistory h WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[0].statement, /dbo\.KeyNumbering kn WITH \(UPDLOCK,HOLDLOCK\)/);
});

test('weekday shared materializer는 주문 자동생성을 끄고 NULL isDeleted를 active로 조회한다', async () => {
  let statement = '';
  const target = {
    row: { OrderYear:'2026',OrderWeek:'37-02',CustKey:533,ProdKey:866 },
    customer: {}, newDetail:false, newDate:false, changes:[], confirmedDelta:5,
  };
  await assert.rejects(materializeOverflowTargets(async (sqlText) => {
    statement = String(sqlText);
    return { recordset: [] };
  }, types, [target], 'fixture-user', { allowOrderCreate:false }), {
    code: 'OVERFLOW_ACTIVE_ORDER_REQUIRED',
  });
  assert.match(statement, /ISNULL\(od\.isDeleted,0\)=0/);
  assert.match(statement, /ISNULL\(om\.isDeleted,0\)=0/);
});

const insertRow = {
  sdetailKey: 10,
  timestamp: '2026-09-10 00:00:00.000',
  shipmentQuantity: 5,
  estimateQuantity: 150,
  cost: 2500.12345,
  amount: 340909,
  vat: 34091,
  descr: '',
};

test('IDENTITY ShipmentDate는 trigger-safe OUTPUT INTO로 키를 받는다', async () => {
  const calls = [];
  const key = await insertWeekdayShipmentDate(async (statement, params) => {
    calls.push({ statement, params });
    return { recordset: [{ SdateKey: 119702 }] };
  }, types, 'identity', insertRow);
  assert.equal(key, 119702);
  assert.match(calls[0].statement, /OUTPUT INSERTED\.SdateKey INTO @Inserted/);
  assert.match(calls[0].statement, /CONVERT\(datetime,@dt,121\)/);
});

test('비-IDENTITY fixture는 잠긴 MAX+1 명시 키를 사용한다', async () => {
  const statements = [];
  const key = await insertWeekdayShipmentDate(async (statement, params) => {
    statements.push(statement);
    if (/SELECT ISNULL\(MAX\(SdateKey\)/.test(statement)) return { recordset: [{ nk: 41 }] };
    assert.equal(params.dateKey.value, 41);
    return { rowsAffected: [1] };
  }, types, 'manual', insertRow);
  assert.equal(key, 41);
  assert.match(statements[1], /INSERT INTO ShipmentDate\s+\(SdateKey/);
});

test('GET status missing은 unknown(null)이고 rollback으로 주장하지 않는다', async () => {
  const result = await readWeekdayOperation(async () => ({ recordset: [] }), types, {
    operationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    custKey: 533,
  });
  assert.equal(result, null);
  const error = weekdayDistributionErrorResponse(Object.assign(new Error('busy'), {
    code: 'STOCK_GATE_BUSY', preWriteGateBusy: true,
  }));
  assert.equal(error.body.saved, false);
  const later = weekdayDistributionErrorResponse(Object.assign(new Error('failed'), {
    code: 'WEEKDAY_VERIFY_FAILED', statusCode: 500,
  }));
  assert.equal(Object.hasOwn(later.body, 'saved'), false);
  assert.equal(Object.hasOwn(later.body, 'rolledBack'), false);
  const deterministic = weekdayDistributionErrorResponse(Object.assign(new Error('native failed'), {
    code: 'WEEKDAY_VERIFY_FAILED', statusCode: 500, weekdayTransactionBodyFailed: true,
  }));
  assert.equal(deterministic.body.rolledBack, true);
  assert.deepEqual(weekdayRollbackAcknowledgement(Object.assign(new Error('socket timeout'), {
    code: 'ETIMEOUT', weekdayTransactionBodyFailed: true,
  })), {});
  assert.deepEqual(weekdayRollbackAcknowledgement(Object.assign(new Error('commit outcome unknown'), {
    code: 'COMMIT_OUTCOME_UNKNOWN', weekdayTransactionBodyFailed: true,
  })), {});
});

test('scope history는 flat change 목록과 limit/truncated를 반환한다', async () => {
  let captured;
  const rows = [1, 2, 3].map((index) => ({
    UUID: `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, '0')}`,
    User: 'fixture-user', Reason: `reason-${index}`, Created: new Date(`2026-10-0${index}T00:00:00Z`),
    Year: '2026', Week: '38-02', CustKey: 533, ProdKey: 800 + index,
    BeforeJson: JSON.stringify({ detailRows: 1, shipmentOutQuantity: index, shipmentDates: [] }),
    AfterJson: JSON.stringify({ detailRows: 1, shipmentOutQuantity: index + 1, shipmentDates: [] }),
    StockValuesIfKnown: null,
  }));
  const history = await readWeekdayChanges(async (statement, params) => {
    captured = { statement, params };
    return { recordset: rows };
  }, types, { year: '2026', majorWeek: '38', custKey: 533, limit: 2 });
  assert.equal(history.changes.length, 2);
  assert.equal(history.truncated, true);
  assert.equal(history.limit, 2);
  assert.deepEqual(history.scope, { year: '2026', majorWeek: '38', custKey: 533, limit: 2 });
  assert.match(captured.statement, /c\.\[Week\] LIKE @weekLike/);
  assert.equal(captured.params.take.value, 3);
});

test('compare digest 조회는 고정 bulk query이며 행별 locked read/DDL을 사용하지 않는다', () => {
  const source = fs.readFileSync(new URL('../pages/api/estimate/weekday-compare.js', import.meta.url), 'utf8');
  assert.equal((source.match(/^\s{6}query\(/gm) || []).length, 7);
  assert.match(source, /weekdaySnapshotDigest/);
  assert.doesNotMatch(source, /readActualScope|UPDLOCK|HOLDLOCK|CREATE\s+TABLE|ALTER\s+TABLE/i);
});
