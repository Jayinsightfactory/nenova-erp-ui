const assert = require('node:assert/strict');

async function main() {
  const {
    normalizeShillaHotelMatchText: normalize,
    shillaHotelMatchKey: key,
    applyShillaHotelAutoMatches: apply,
  } = await import('../lib/shillaPnlHotelMatch.js');

  assert.equal(normalize('  송이\u00a0\n  특  '), '송이 특');
  assert.equal(key({ ItemName: ' 송이  특 ', Unit: '  단 ', IsCustom: 0 }), '송이 특\u0000단');
  assert.equal(key({ ItemName: '송이 특', Unit: '단', IsCustom: 1 }), null, 'custom is never eligible');

  const activeSameHotel = [
    { ItemName: '송이  특', Unit: '단', IsCustom: 0, ProdKey: 181 },
    { ItemName: '송이 특', Unit: '박스', IsCustom: 0, ProdKey: 181 },
    { ItemName: '송이 특', Unit: '단', IsCustom: 0, ProdKey: 3170 },
  ];
  const output = apply([
    { name: ' 송이 특 ', unit: '단', isCustom: false, prodKey: null },
    { name: '송이 특', unit: '박스', isCustom: false, prodKey: null },
    { name: '송이 특', unit: '단', isCustom: true, prodKey: null },
    { name: '송이 특', unit: '단', isCustom: false, prodKey: 999 },
  ], activeSameHotel);
  assert.equal(output.items[0].prodKey, null, 'two active keys are a conflict, never a guess');
  assert.equal(output.items[1].prodKey, 181, 'exact normalized unit group is independently unique');
  assert.equal(output.items[2].prodKey, null, 'custom stays blank');
  assert.equal(output.items[3].prodKey, 999, 'an existing import key is preserved');
  assert.equal(output.autoMatchedCount, 1);

  // The DB candidate query removes other years/hotels and deleted Products before
  // this helper sees them. With only the allowed active candidate, a blank new
  // upload fills exactly once and source values other than ProdKey are untouched.
  const upload = { name: '송이 특', unit: '단', qty: 0, price: 0, supply: 0, isCustom: false, prodKey: null };
  const unique = apply([upload], [{ ItemName: '송이 특', Unit: '단', IsCustom: 0, ProdKey: 181 }]);
  assert.deepEqual(unique.items[0], { ...upload, prodKey: 181 });
  assert.equal(unique.autoMatchedCount, 1);
  assert.equal(apply([upload], []).items[0].prodKey, null, 'deleted/inactive or other-scope rows are not candidates');
  assert.equal(apply([upload], [{ ItemName: '송이 특', Unit: '단', IsCustom: 0, ProdKey: null }]).items[0].prodKey, null,
    'a missing active Product key is not inferred');
  console.log('Shilla same-hotel pure matching tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
