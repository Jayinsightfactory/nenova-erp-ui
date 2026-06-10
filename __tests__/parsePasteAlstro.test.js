// 붙여넣기 알스트로메리아/휘슬러 매칭 회귀 테스트
// 실행: node __tests__/parsePasteAlstro.test.js

const SAMPLE = `24-2차 알스트로메리아 발주 추가
주광
화이트(휘슬러) 2박스 추가`;

async function main() {
  const { scoreMatch, tokenizeForMatch } = await import('../lib/displayName.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== 토큰화: 알스트로 화이트(휘슬러) ===');
  const toks = tokenizeForMatch('알스트로 화이트(휘슬러)');
  assert('알스트로 토큰', toks.includes('알스트로'));
  assert('화이트 토큰', toks.includes('화이트'));
  assert('휘슬러 토큰', toks.includes('휘슬러'));

  console.log('\n=== scoreMatch: Whistler vs 무관 White 품목 ===');
  const whistler = {
    ProdName: 'ALSTROMERIA Whistler',
    DisplayName: '콜롬비아 알스트로 화이트 휘슬러',
    FlowerName: '알스트로',
    CounName: '콜롬비아',
  };
  const wrongWhite = {
    ProdName: 'Anthurium White Angel M',
    DisplayName: '안시리움 화이트',
    FlowerName: '안시리움',
    CounName: '태국',
  };
  const inputName = '알스트로 화이트(휘슬러)';
  const scoreWhistler = scoreMatch(inputName, whistler, '');
  const scoreWrong = scoreMatch(inputName, wrongWhite, '');
  assert('Whistler 점수>70', scoreWhistler >= 70, `score=${scoreWhistler}`);
  assert('무관 White=0', scoreWrong === 0, `score=${scoreWrong}`);
  assert('Whistler>White', scoreWhistler > scoreWrong);

  console.log('\n=== KO 키워드 부분문자열 (알스트로메리아) ===');
  const KO = { 알스트로: 'ALSTROEMERIA', 알스트로메리아: 'ALSTROEMERIA', 화이트: 'WHITE', 휘슬러: 'WHISTLER' };
  const detected = [];
  const keys = Object.keys(KO).sort((a, b) => b.length - a.length);
  for (const ko of keys) {
    if (SAMPLE.includes(ko)) detected.push(KO[ko]);
  }
  assert('ALSTROEMERIA 감지', detected.includes('ALSTROEMERIA'));
  assert('WHISTLER 감지', detected.includes('WHISTLER'));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
