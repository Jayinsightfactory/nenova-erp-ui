const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
  const source = read('lib/raumPnl.js');
  const api = read('pages/api/raum/pnl.js');

  // Re-importing source quantities must never erase a user-entered cost, a
  // manual-row bit, or an ERP item match.  Matching must be scoped to year+week;
  // the same major week in another year is a different business record.
  for (const field of ['CostPrice', 'IsCustom', 'ProdKey']) {
    assert.match(source, new RegExp(field), `${field} 보존 계약이 저장 계층에 있어야 합니다.`);
  }
  assert.match(source, /OrderYear=@yr[\s\S]{0,160}MajorWeek=@mj|OrderYear\s*=\s*@yr[\s\S]{0,160}MajorWeek\s*=\s*@mj/,
    '재업로드 대상은 OrderYear+MajorWeek로 한정되어야 합니다.');
  assert.match(source, /PartnerCode=@pc/,
    '라움과 초이문 같은 차수는 PartnerCode로 분리되어야 합니다.');
  assert.match(source, /preserv(?:e|ation)|기존.*(?:단가|수기|매칭)|CostPrice[\s\S]{0,180}ProdKey/s,
    '재업로드 시 수기단가·IsCustom·ProdKey를 병합 보존하는 명시적 경로가 필요합니다.');
  assert.match(api, /verification[\s\S]{0,500}(?:ok|fail|검증)/i,
    'API는 검증 결과를 받아 실패한 배치를 저장 전에 차단해야 합니다.');
  console.log('Raum P&L preservation contract tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
