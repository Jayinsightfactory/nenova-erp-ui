import {
  buildProdGroupWhere,
  parseProdGroupKey,
  prodGroupKey,
  prodGroupLabel,
  parseShipDayConfigKey,
} from '../lib/shipmentProdGroups.js';

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`  ok ${name}`);
}

console.log('=== shipmentProdGroups ===');

assert('prodGroupKey', prodGroupKey('네덜란드', '튤립') === '네덜란드::튤립');
assert('prodGroupLabel', prodGroupLabel('네덜란드', '튤립') === '네덜란드튤립');

const parsed = parseProdGroupKey('네덜란드::튤립');
assert('parse coun+flower', parsed.country === '네덜란드' && parsed.flower === '튤립');

const legacy = parseProdGroupKey('콜롬비아카네이션');
assert('parse legacy CF', legacy.countryFlower === '콜롬비아카네이션');

const where = buildProdGroupWhere('네덜란드::튤립');
assert('where clause', where.clause.includes('CounName') && where.clause.includes('FlowerName'));
assert('where params', where.params.pgCountry?.value === '네덜란드');

const shipKey = parseShipDayConfigKey('네덜란드::튤립|-01');
assert('ship day parse', shipKey.prodGroup === '네덜란드::튤립' && shipKey.weekSuffix === '-01');

console.log('\nAll passed');
