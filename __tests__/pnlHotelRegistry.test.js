const assert = require('node:assert/strict');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function value(params, name) {
  return params?.[name]?.value;
}

function registryDb({ ready = true, rows = [], raceName = null } = {}) {
  const state = { rows: clone(rows), calls: [], raceThrown: false };
  const tQuery = async (statement, parameters = {}) => {
    state.calls.push({ statement, parameters: clone(parameters) });
    if (statement.includes('OBJECT_ID')) return { recordset: [{ Ready: ready ? 1 : 0 }] };
    if (statement.includes('WHERE NormalizedName=@normalizedName')) {
      const normalizedName = value(parameters, 'normalizedName');
      return { recordset: state.rows.filter(row => row.NormalizedName === normalizedName) };
    }
    if (statement.includes('WHERE PartnerCode=@code')) {
      const code = value(parameters, 'code');
      const activeOnly = /IsActive=1/.test(statement);
      return { recordset: state.rows.filter(row => row.PartnerCode === code && (!activeOnly || row.IsActive)) };
    }
    if (statement.includes('FROM dbo.WebPnlHotel') && statement.includes('ORDER BY NormalizedName')) {
      return { recordset: state.rows.filter(row => row.IsActive).sort((a, b) => a.NormalizedName.localeCompare(b.NormalizedName)) };
    }
    if (statement.includes('INSERT INTO dbo.WebPnlHotel')) {
      const row = {
        PartnerCode: value(parameters, 'code'),
        Name: value(parameters, 'name'),
        NormalizedName: value(parameters, 'normalizedName'),
        IsActive: true,
        CreatedBy: value(parameters, 'actor'),
      };
      if (raceName === row.NormalizedName && !state.raceThrown) {
        state.raceThrown = true;
        state.rows.push(row);
        const error = new Error('duplicate key');
        error.number = 2601;
        throw error;
      }
      if (state.rows.some(existing => existing.PartnerCode === row.PartnerCode || existing.NormalizedName === row.NormalizedName)) {
        const error = new Error('duplicate key');
        error.number = 2627;
        throw error;
      }
      state.rows.push(row);
      return { rowsAffected: [1], recordset: [] };
    }
    throw new Error(`unexpected SQL: ${statement}`);
  };
  return { state, tQuery };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

async function main() {
  const registry = await import('../lib/pnlHotelRegistry.js');
  const partners = await import('../lib/raumPnlPartner.js');
  const {
    PnlHotelRegistryError,
    createPnlHotel,
    listPnlHotels,
    normalizePnlHotelName,
    pnlHotelCodeForName,
    requirePnlPartner,
  } = registry;

  assert.equal(normalizePnlHotelName('  ＡＢＣ\u00a0 호텔  '), 'ABC 호텔');
  assert.equal(pnlHotelCodeForName('ABC 호텔'), pnlHotelCodeForName('  ＡＢＣ\u00a0 호텔  '));
  assert.notEqual(pnlHotelCodeForName('Hotel'), pnlHotelCodeForName('hotel'), '정규화 뒤에도 다른 canonical name은 같은 키가 아니어야 한다.');
  await expectCode(Promise.resolve().then(() => normalizePnlHotelName('')), 'PNL_HOTEL_NAME_REQUIRED');
  await expectCode(Promise.resolve().then(() => normalizePnlHotelName('a\u0000b')), 'PNL_HOTEL_NAME_INVALID');
  await expectCode(Promise.resolve().then(() => normalizePnlHotelName('a\nb')), 'PNL_HOTEL_NAME_INVALID');
  await expectCode(Promise.resolve().then(() => normalizePnlHotelName('가'.repeat(81))), 'PNL_HOTEL_NAME_TOO_LONG');
  for (const reserved of ['신라', '신라호텔', '라움', '트라움', '초이문']) {
    await expectCode(Promise.resolve().then(() => normalizePnlHotelName(reserved)), 'PNL_HOTEL_NAME_RESERVED');
  }

  const empty = registryDb();
  const created = await createPnlHotel('  센트럴\u00a0호텔 ', 'tester', { tQuery: empty.tQuery });
  assert.equal(created.created, true);
  assert.equal(created.hotel.kind, 'custom-hotel');
  assert.equal(created.hotel.code, pnlHotelCodeForName('센트럴 호텔'));
  assert.equal(partners.resolvePnlPartner(created.hotel.code, created.hotel).label, '센트럴 호텔', 'API descriptor는 UI의 resolvePnlPartner에 그대로 전달 가능해야 한다.');
  assert.throws(() => partners.resolvePnlPartner(created.hotel.code, { ...created.hotel, code: 'hotel_aaaaaaaaaaaa' }), /등록된 호텔/);
  assert.throws(() => partners.resolvePnlPartner(created.hotel.code, { ...created.hotel, kind: 'other' }), /등록된 호텔/);
  assert.throws(() => partners.resolvePnlPartner(created.hotel.code, { ...created.hotel, label: '신라' }), /등록된 호텔/);
  assert.equal(empty.state.rows[0].CreatedBy, 'tester');
  const insert = empty.state.calls.find(call => call.statement.includes('INSERT INTO dbo.WebPnlHotel'));
  assert.ok(insert, '호텔 등록은 파라미터 INSERT여야 한다.');
  assert.ok(!insert.statement.includes('센트럴 호텔'));
  assert.equal(value(insert.parameters, 'name'), '센트럴 호텔');

  const again = await createPnlHotel('센트럴 호텔', 'other-user', { tQuery: empty.tQuery });
  assert.deepEqual(again, { hotel: created.hotel, created: false }, '같은 정규화 이름은 기존 등록을 재사용해야 한다.');
  assert.equal(empty.state.rows.length, 1);

  const raced = registryDb({ raceName: '동시 호텔' });
  const racedResult = await createPnlHotel('동시 호텔', 'tester', { tQuery: raced.tQuery });
  assert.equal(racedResult.created, false, 'unique 제약의 동시 등록은 같은 행을 idempotent하게 반환해야 한다.');
  assert.equal(raced.state.rows.length, 1);

  const collisionName = '충돌 호텔';
  const collisionCode = pnlHotelCodeForName(collisionName);
  const collision = registryDb({ rows: [{ PartnerCode: collisionCode, Name: '다른 호텔', NormalizedName: '다른 호텔', IsActive: true, CreatedBy: 'seed' }] });
  await expectCode(createPnlHotel(collisionName, 'tester', { tQuery: collision.tQuery }), 'PNL_HOTEL_HASH_COLLISION');

  const inactiveDuplicate = registryDb({ rows: [{ PartnerCode: pnlHotelCodeForName('휴면 중복'), Name: '휴면 중복', NormalizedName: '휴면 중복', IsActive: false, CreatedBy: 'seed' }] });
  await expectCode(createPnlHotel('휴면 중복', 'tester', { tQuery: inactiveDuplicate.tQuery }), 'PNL_HOTEL_NAME_INACTIVE');

  const nameIdentityConflict = registryDb({ rows: [{ PartnerCode: pnlHotelCodeForName('정확한 이름'), Name: '정확한 이름', NormalizedName: '다른 canonical 이름', IsActive: true, CreatedBy: 'seed' }] });
  // The mock returns this row for the requested name to prove the post-query
  // guard does not trust a non-binary or corrupt database comparison.
  const wrongNameQuery = async (statement, parameters) => {
    if (statement.includes('WHERE NormalizedName=@normalizedName')) return { recordset: nameIdentityConflict.state.rows };
    return nameIdentityConflict.tQuery(statement, parameters);
  };
  await expectCode(createPnlHotel('정확한 이름', 'tester', { tQuery: wrongNameQuery }), 'PNL_HOTEL_NAME_IDENTITY_CONFLICT');

  const activeCode = pnlHotelCodeForName('그랜드 호텔');
  const inactiveCode = pnlHotelCodeForName('휴면 호텔');
  const loaded = registryDb({ rows: [
    { PartnerCode: activeCode, Name: '그랜드 호텔', NormalizedName: '그랜드 호텔', IsActive: true, CreatedBy: 'seed' },
    { PartnerCode: inactiveCode, Name: '휴면 호텔', NormalizedName: '휴면 호텔', IsActive: false, CreatedBy: 'seed' },
  ] });
  const list = await listPnlHotels(loaded.tQuery);
  assert.deepEqual(list.slice(0, 3).map(partner => partner.code), ['shilla', 'raum', 'choimun']);
  assert.deepEqual(list.slice(3).map(partner => partner.code), [activeCode]);
  assert.equal(list[3].erpSync, false);
  assert.equal(list[3].sheetMode, 'single');
  assert.equal(list[3].defaultBranch, '그랜드 호텔');
  const custom = await requirePnlPartner(activeCode, loaded.tQuery);
  assert.equal(custom.customHotel, true);
  assert.equal(custom.custLikeSql, '1=0');
  await expectCode(requirePnlPartner(inactiveCode, loaded.tQuery), 'PNL_HOTEL_INACTIVE_OR_UNKNOWN');
  await expectCode(requirePnlPartner('hotel_ffffffffffff', loaded.tQuery), 'PNL_HOTEL_INACTIVE_OR_UNKNOWN');
  await expectCode(requirePnlPartner('not-a-hotel', loaded.tQuery), 'PNL_PARTNER_UNKNOWN');
  for (const invalidCode of ['__proto__', 'constructor', 'toString']) {
    await expectCode(requirePnlPartner(invalidCode, loaded.tQuery), 'PNL_PARTNER_UNKNOWN');
    assert.throws(() => partners.resolvePnlPartner(invalidCode));
  }

  let builtinDbTouched = false;
  const builtIn = await requirePnlPartner('RAUM', async () => { builtinDbTouched = true; throw new Error('must not query'); });
  assert.equal(builtIn.code, 'raum');
  assert.equal(builtinDbTouched, false, '기본 거래처 해석은 DB를 읽지 않아야 한다.');
  const firstBuiltin = partners.resolvePnlPartner('raum');
  firstBuiltin.label = 'mutated';
  assert.equal(partners.resolvePnlPartner('raum').label, '라움', '전역 built-in descriptor는 호출자가 변경할 수 없어야 한다.');

  assert.equal(partners.defaultPnlTitle(activeCode, 12, '', custom), '그랜드 호텔 12차');
  assert.equal(partners.canAutoCommitRaumPnlImport([{ partnerCode: 'raum', verification: [{ ok: true }] }]), true);
  assert.equal(partners.canAutoCommitRaumPnlImport([{ partnerCode: 'choimun', verification: [{ ok: true }] }]), true);
  assert.equal(partners.canAutoCommitRaumPnlImport([{ partnerCode: 'shilla', verification: [{ ok: true }] }]), false);
  assert.equal(partners.canAutoCommitRaumPnlImport([{ partnerCode: activeCode, verification: [{ ok: true }] }]), false);

  const missingSchema = registryDb({ ready: false });
  await assert.rejects(listPnlHotels(missingSchema.tQuery), error => error instanceof PnlHotelRegistryError && error.code === 'PNL_HOTEL_SCHEMA_MISSING' && error.statusCode === 503);
  console.log('P&L hotel registry tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
