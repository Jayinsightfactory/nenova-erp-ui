// 17개 사용자 입력에 대해 정정된 매핑이 정확히 적용되는지 검증
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMappings, findMappingFuzzy, detectFallbackProdKey } from '../lib/parseMappings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const USER_INPUT = [
  { input: '캐롤라인',    expected: 364, expectedName: 'CARNATION Caroline' },
  { input: '돈셀',        expected: 389, expectedName: 'CARNATION Doncel' },
  { input: '돈페드로',    expected: 390, expectedName: 'CARNATION Don pedro (Red)' },
  { input: '노비아',      expected: 456, expectedName: 'CARNATION Novia' },
  { input: '문라이트',    expected: 447, expectedName: 'CARNATION Moon Light' },
  { input: '헤르메스오렌지', expected: 409, expectedName: 'CARNATION Hermes Orange' },
  { input: '라이온킹',    expected: 429, expectedName: 'CARNATION Lion King' },
  { input: '메건',        expected: 522, expectedName: 'CARNATION Megan' },
  { input: '헤르메스',    expected: 408, expectedName: 'CARNATION Hermes' },
  { input: '웨딩',        expected: 511, expectedName: 'CARNATION Wedding' },
  { input: '체리오',      expected: 368, expectedName: 'CARNATION Cherrio' },
  { input: '사파리',      expected: 3066, expectedName: 'CARNATION Safari' },
  { input: '프론테라',    expected: 471, expectedName: 'CARNATION Red Frontera' },
  { input: '클리아워터',  expected: 423, expectedName: 'CARNATION Clear Water' },
  { input: '만달레이',    expected: 433, expectedName: 'CARNATION Mandalay' },
  { input: '코마치',      expected: 420, expectedName: 'CARNATION Komachi' },
  { input: '믹스 B',     expected: 2516, expectedName: 'CARNATION MIx Box B' },
];

const mappings = loadMappings(true);
console.log(`# 학습 매핑 ${Object.keys(mappings).length}개 로드\n`);

console.log('# 17개 사용자 입력 매칭 검증 (꽃종류 prefix "카네이션" 추가 시뮬)\n');

let okCount = 0, lowConfCount = 0, fallbackCount = 0;
for (const { input, expected, expectedName } of USER_INPUT) {
  // 사용자 입력은 paste 텍스트 ↔ Claude API 가 inputName 으로 만들어 보내는 형태가 "카네이션 캐롤라인" 같은 식
  const inputName = `카네이션 ${input}`;
  const fuzzy = findMappingFuzzy(inputName, mappings);

  if (!fuzzy) {
    console.log(`  ❌ "${input}" → 매핑 없음 (LLM 으로 fallback 됨)`);
    continue;
  }

  const ok = fuzzy.value.prodKey === expected;
  const fallbackInfo = detectFallbackProdKey(fuzzy.value.prodKey);
  const conf = fuzzy.matchType === 'exact' ? 'high' : 'medium';
  const lowConf = fallbackInfo.isFallback;

  if (ok) okCount++;
  if (lowConf) { lowConfCount++; fallbackCount++; }

  const mark = ok ? '✅' : '❌';
  const confTag = lowConf ? ` ⚠fallback의심(${fallbackInfo.count})` : (conf === 'high' ? ' ✓exact' : ' ~fuzzy');
  console.log(`  ${mark} "${input.padEnd(10)}" → [${fuzzy.value.prodKey}] ${fuzzy.value.prodName?.substring(0, 50)}${confTag}`);
  if (!ok) console.log(`              기대값: [${expected}] ${expectedName}`);
}

console.log(`\n## 결과: ${okCount}/${USER_INPUT.length} 정확 매칭 (${(okCount/USER_INPUT.length*100).toFixed(0)}%)`);
console.log(`         fallback 의심 표시: ${fallbackCount}건`);

// LLM 안 거치고 학습매핑만으로 매칭률 향상 확인 — 이전 47% (8/17) 가 얼마로 향상?
if (okCount === USER_INPUT.length) {
  console.log('\n🎉 17/17 = 100% 매칭! LLM 호출 없이도 모두 정확 매칭됨.');
} else {
  console.log(`\n⚠ ${USER_INPUT.length - okCount}건 미매칭 — LLM 으로 시도 가능 (Claude Haiku 비용 발생)`);
}
