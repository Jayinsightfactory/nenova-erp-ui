// autoForwardingByCountry() 실측 검증 — 22~26차 6개 반차수, 22-01/22-02/23-01/23-02/26-01/26-02.
// 미분류 0건 + 국가별 합계가 2026-07-10 수동 대조값과 일치하는지 확인 (읽기전용, DB 접속 필요).
import fs from 'fs';
import path from 'path';
for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const { autoForwardingByCountry } = await import('../lib/customsForwarding.js');

let pass = 0, fail = 0;
const check = (label, actual, expected, tol = 0.5) => {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual} vs ${expected}`);
  ok ? pass++ : fail++;
};

// major='26' → subweeks 26-01/26-02 합산. direct 값은 major 단위 합계, colombiaRest 는 반차수별.
const r26 = await autoForwardingByCountry('26', '2026');
console.log('26차 direct:', JSON.stringify(r26.direct));
console.log('26차 colombiaRest:', JSON.stringify(r26.colombiaRest));
check('26차 네덜란드', r26.direct['네덜란드'], 655.77 + 1620.52);
check('26차 중국', r26.direct['중국'], 7828 + 4718);
check('26차 콜롬비아수국', r26.direct['콜롬비아 수국'], 9568.3 + 4942.7);
check('26차 태국', r26.direct['태국'], 571.66);
check('26차 에콰도르', r26.direct['에콰도르'], 634.15);
check('26-01 콜롬비아나머지', r26.colombiaRest['26-01'], 18191.2);
check('26-02 콜롬비아나머지', r26.colombiaRest['26-02'], 1915.5);

const r23 = await autoForwardingByCountry('23', '2026');
check('23차 네덜란드', r23.direct['네덜란드'], 521.44 + 1776.39);
check('23-01 콜롬비아나머지', r23.colombiaRest['23-01'], 17698 + 15); // FREIGHTWISE(콜카장) + Flores De Funza 임베디드 15원(엑셀 누락분)
check('23-02 콜롬비아나머지', r23.colombiaRest['23-02'], 811.1 + 36.66 + 15); // FREIGHTWISE + Invos Flowers + Flores De Funza

console.log(`\n총 ${pass + fail}건 중 성공 ${pass} · 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
