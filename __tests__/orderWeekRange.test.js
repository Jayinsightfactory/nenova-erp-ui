// node __tests__/orderWeekRange.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};

async function main() {
  const {
    shiftOrderWeek,
    listOrderWeeksInRange,
    buildOrderYearWeek,
  } = await import('../lib/orderUtils.js');

  assert('04-01 +1 → 04-02', shiftOrderWeek('04-01', 1) === '04-02');
  assert('04-04 +1 → 05-01', shiftOrderWeek('04-04', 1) === '05-01');
  assert('04-01 ~ 04-03 = 3', listOrderWeeksInRange('04-01', '04-03', '2026').length === 3);
  assert('04-01 ~ 05-01 = 5', listOrderWeeksInRange('04-01', '05-01', '2026').length === 5);
  assert('24-01 > 23-02 throws', (() => {
    try { listOrderWeeksInRange('24-01', '23-02', '2026'); return false; } catch { return true; }
  })());
  assert('yws order', buildOrderYearWeek('2026', '04-01') < buildOrderYearWeek('2026', '24-02'));
}

main();
