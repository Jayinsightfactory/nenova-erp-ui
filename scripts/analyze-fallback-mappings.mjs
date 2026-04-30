// scripts/analyze-fallback-mappings.mjs
// fallback 의심 매핑 자동 분류 (DRY-RUN — 파일 변경 없음)
//
// 판정 룰:
//   1. 한 ProdKey 에 5+ 개 키가 매핑되어 있으면 의심 후보
//   2. 매핑 키들에서 "마지막 한글 토큰" (품종명 추정) 추출
//   3. unique 토큰 수 / 매핑 키 수
//      - <= 2 (단일 품종 변형): 정상 (예: 447 Moon Light 11키 모두 "문라이트")
//      - >= 3 (다른 품종 섞임): fallback (예: 338 Alhambra 49키에 "라이언킹/노비아/딜리타...")
//
// 출력: 정상 ProdKey / fallback ProdKey / 분리할 키 후보 리스트

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'order-mappings.json');

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// ProdKey → 매핑 키 그룹화
const byProd = new Map();
for (const [k, v] of Object.entries(data)) {
  if (!v || typeof v !== 'object') continue;
  const pk = v.prodKey || v.ProdKey;
  if (!pk) continue;
  if (!byProd.has(pk)) byProd.set(pk, { prodName: v.prodName || v.ProdName || '', keys: [] });
  byProd.get(pk).keys.push(k);
}

// 마지막 한글 토큰 추출 (ALL 한글로 된 토큰들 중 마지막 1-2개)
function lastKoToken(key) {
  // 괄호/기호 제거
  const clean = key.replace(/[()<>\[\]{}~!@#$%^&*+=|\/\\:;'"`?,.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(/\s+/).filter(t => /[가-힣]/.test(t));
  // 마지막 한글 토큰 — 단, 일반어 (재고, 출고, 보관, 박스, 단, 번 등) 는 제외
  const SKIP = /^(재고|출고|보관|박스|박스단|단|번|일|월|화|수|목|금|토|총|콜|콜롬비아|중국|에콰도르|태국|호주|체|유차|예|샘플|불량|대체|확인|부탁|중앙|남대문|회수|사무실|창고|창고보관|창고분|창고보관분|창고보관요청|남|일출고|일출고분|화요일|월요일|목요일|금요일|일요일|수요일|화요일출고|월요일총|총출고|오늘|오늘출고|오늘출고분|남은|일|총출고입니다|콜카네이션|박스로다스|박스로다스크림|차|차장미|차수국|차카네이션|차콜카네이션|차콜롬비아|차콜)$/;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!SKIP.test(tokens[i])) return tokens[i];
  }
  return null;
}

const results = [];
for (const [pk, { prodName, keys }] of byProd.entries()) {
  if (keys.length < 5) continue;
  const tokens = keys.map(k => lastKoToken(k)).filter(Boolean);
  const unique = [...new Set(tokens)];
  results.push({
    prodKey: pk,
    prodName,
    keyCount: keys.length,
    uniqueTokens: unique.length,
    tokens: unique,
    sampleKeys: keys.slice(0, 5),
    allKeys: keys,
    classification: unique.length <= 2 ? 'NORMAL' : 'SUSPECT',
  });
}

results.sort((a, b) => b.keyCount - a.keyCount);

console.log('# Fallback 매핑 분석 (DRY-RUN, 파일 변경 없음)\n');
console.log(`총 의심 후보: ${results.length} ProdKey (5+ 키 매핑)`);
console.log(`정상 (단일 품종 변형, unique 토큰 ≤ 2): ${results.filter(r=>r.classification==='NORMAL').length}`);
console.log(`fallback 의심 (unique 토큰 ≥ 3): ${results.filter(r=>r.classification==='SUSPECT').length}\n`);

console.log('## 🟢 정상 ProdKey (단일 품종 키 변형)\n');
for (const r of results.filter(r => r.classification === 'NORMAL')) {
  console.log(`- ProdKey ${r.prodKey} (${r.prodName}) — ${r.keyCount}키, 토큰 [${r.tokens.join(', ')}]`);
}

console.log('\n## 🔴 fallback 의심 ProdKey (다른 품종 섞임)\n');
let totalSuspectKeys = 0;
for (const r of results.filter(r => r.classification === 'SUSPECT')) {
  totalSuspectKeys += r.keyCount;
  console.log(`\n### ProdKey ${r.prodKey} (${r.prodName}) — ${r.keyCount}키, ${r.uniqueTokens} 다른 토큰`);
  console.log(`   토큰: [${r.tokens.slice(0, 12).join(', ')}${r.tokens.length > 12 ? ', +' + (r.tokens.length - 12) : ''}]`);
  console.log(`   샘플 키:`);
  for (const k of r.sampleKeys) console.log(`     - "${k}"`);
}

console.log(`\n## 요약`);
console.log(`정정 후보 매핑 수: ${totalSuspectKeys} 건`);
console.log(`적용 시 다음 붙여넣기에서 해당 키들은 LLM 재학습 트리거 (정확 매핑으로 재출발)`);
console.log(`\n실제 정정하려면 별도 명령으로:`);
console.log(`  node scripts/clean-fallback-mappings.mjs --apply  (백업 자동 생성)`);
