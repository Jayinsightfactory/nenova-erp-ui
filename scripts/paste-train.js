#!/usr/bin/env node
/**
 * paste-train.js — Claude API 없이 터미널에서 매핑 학습
 *
 * 사용법:
 *   1) 첫 실행 시 품목 캐시 다운로드:
 *        node scripts/paste-train.js --sync
 *   2) 학습 시작 (붙여넣기 텍스트 처리):
 *        node scripts/paste-train.js
 *   3) 학습 완료 후:
 *        git add data/order-mappings.json && git commit -m "train: mappings" && git push
 *      → 배포되면 서버 파싱이 학습된 매핑을 1순위로 사용
 *
 * 환경변수 (선택):
 *   NENOVA_API_URL — 품목 리스트 가져올 서버 (기본 https://nenova-erp.com)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'data', 'order-mappings.json');
const PROD_CACHE = path.join(ROOT, 'data', '.product-cache.json');
const API_URL = process.env.NENOVA_API_URL || 'https://nenova-erp.com';

// ── 로드/세이브 ───────────────────────────────────────────────
function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── 간단 한글 유사도 (displayName.js 의 jamoSimilarity 대체) ────
function normalize(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

const KO_EN = {
  '장미': 'ROSE', '로즈': 'ROSE', '카네이션': 'CARNATION', '수국': 'HYDRANGEA',
  '튤립': 'TULIP', '거베라': 'GERBERA', '리시안': 'LISIANTHUS', '국화': 'CHRYSANTHEMUM',
  '안개': 'GYPSOPHILA', '해바라기': 'SUNFLOWER', '알스트로': 'ALSTROEMERIA',
  '스타티스': 'STATICE', '화이트': 'WHITE', '연핑크': 'LIGHT PINK', '블루': 'BLUE',
  '코랄리프': 'CORAL REEF', '캐롤라인': 'CAROLINE', '카라멜': 'CARAMEL',
  '사파리': 'SAFARI', '레드팬서': 'RED PANTHER', '팬서': 'PANTHER',
  '문라이트': 'MOON LIGHT', '핑크': 'PINK', '레드': 'RED', '옐로': 'YELLOW',
  '오렌지': 'ORANGE', '퍼플': 'PURPLE', '라벤더': 'LAVENDER', '그린': 'GREEN',
  '크림': 'CREAM', '살몬': 'SALMON', '버건디': 'BURGUNDY', '진그린': 'G/ ESMERAL',
  '진핑크': 'DARK PINK', '연그린': 'S/GN', '피치': 'PEACH', '루스커스': 'RUSCUS',
};

function score(inputName, prod) {
  const q = normalize(inputName);
  const toks = q.split(/\s+/).filter(Boolean);
  const haystack = normalize([prod.ProdName, prod.DisplayName, prod.FlowerName, prod.CounName].filter(Boolean).join(' '));
  let s = 0;
  for (const t of toks) {
    const en = KO_EN[t];
    if (en && haystack.includes(normalize(en))) s += 2;
    if (haystack.includes(t)) s += 1;
  }
  if (haystack.includes(q)) s += 3;
  return s;
}

function topCandidates(inputName, products, n = 10) {
  return products
    .map(p => ({ prod: p, sc: score(inputName, p) }))
    .filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, n);
}

// ── 품목 리스트 동기화 ─────────────────────────────────────────
function fetchProducts() {
  return new Promise((resolve, reject) => {
    const url = `${API_URL}/api/master?entity=products`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.success && j.data) resolve(j.data);
          else reject(new Error(j.error || '응답 오류'));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── 메인 인터랙티브 루프 ───────────────────────────────────────
async function syncProducts() {
  console.log(`📥 품목 리스트 다운로드: ${API_URL}/api/master?entity=products`);
  try {
    const products = await fetchProducts();
    saveJson(PROD_CACHE, products);
    console.log(`✅ ${products.length}건 저장: ${PROD_CACHE}`);
  } catch (e) {
    console.error('❌ 실패:', e.message);
    console.log('  (로그인 인증이 필요한 API는 다른 방식 필요 — 수동으로 data/.product-cache.json 에 넣어주세요)');
    process.exit(1);
  }
}

function extractTokens(text) {
  // Claude가 하던 일의 축약 버전: 줄 단위로 품목명 후보 추출
  // 패턴: "품목명 수량박스 추가/취소" 같은 줄에서 품목 부분만
  const tokens = new Set();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // 동작/수량/단위 제거 후 남는 텍스트
    const cleaned = t
      .replace(/\d+\s*(박스|단|송이|개|stems?)/gi, '')
      .replace(/\b(추가|취소|add|cancel)\b/gi, '')
      .replace(/[|:,]/g, ' ')
      .trim();
    if (cleaned && cleaned.length >= 2 && /[가-힣a-zA-Z]/.test(cleaned)) {
      tokens.add(cleaned);
    }
  }
  return [...tokens];
}

async function trainLoop() {
  const products = loadJson(PROD_CACHE, null);
  if (!products || !Array.isArray(products) || products.length === 0) {
    console.log('⚠️  품목 캐시 없음. 먼저 실행: node scripts/paste-train.js --sync');
    process.exit(1);
  }

  const mappings = loadJson(MAP_FILE, {});
  const initialCount = Object.keys(mappings).length;
  console.log(`📚 기존 학습 매핑 ${initialCount}건 로드됨`);
  console.log(`📦 품목 ${products.length}건 로드됨`);
  console.log('');
  console.log('==================================================');
  console.log('붙여넣기 학습 모드 (Claude API 미사용)');
  console.log('==================================================');
  console.log('텍스트를 붙여넣고 빈 줄 2번 엔터로 종료');
  console.log('취소: Ctrl+C / 매핑 건너뛰기: "s" / 종료 저장: "q"');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  while (true) {
    console.log('\n── 텍스트 입력 (빈 줄 2번으로 종료) ──');
    let text = '';
    let emptyCount = 0;
    const collect = () => new Promise((resolve) => {
      const onLine = (line) => {
        if (line.trim() === '') {
          emptyCount++;
          if (emptyCount >= 2) { rl.removeListener('line', onLine); resolve(); return; }
        } else { emptyCount = 0; }
        text += line + '\n';
      };
      rl.on('line', onLine);
    });
    await collect();

    if (text.trim().toLowerCase() === 'q') break;

    const tokens = extractTokens(text);
    console.log(`\n🔍 추출된 후보 품목명 ${tokens.length}개`);

    for (const token of tokens) {
      const key = normalize(token);
      if (mappings[key]) {
        const p = mappings[key];
        console.log(`  ✅ 이미 학습됨: "${token}" → ${p.displayName || p.prodName} (ProdKey ${p.prodKey})`);
        continue;
      }
      const cands = topCandidates(token, products, 10);
      if (cands.length === 0) {
        console.log(`  ❓ "${token}" — 후보 없음. 건너뜀.`);
        continue;
      }
      console.log(`\n  🔸 "${token}" 후보:`);
      cands.forEach(({ prod, sc }, i) => {
        console.log(`    ${i + 1}) [${sc}점] ${prod.DisplayName || prod.ProdName} (${prod.CounName || ''}/${prod.FlowerName || ''}) key=${prod.ProdKey}`);
      });
      const ans = (await ask('    번호 선택 (s: 건너뛰기, q: 저장하고 종료): ')).trim();
      if (ans.toLowerCase() === 'q') { break; }
      if (ans.toLowerCase() === 's' || !ans) continue;
      const idx = parseInt(ans) - 1;
      if (idx < 0 || idx >= cands.length) { console.log('    잘못된 번호. 건너뜀.'); continue; }
      const picked = cands[idx].prod;
      mappings[key] = {
        prodKey: picked.ProdKey,
        prodName: picked.ProdName,
        displayName: picked.DisplayName,
        flowerName: picked.FlowerName,
        counName: picked.CounName,
        savedAt: new Date().toISOString(),
      };
      console.log(`    ✅ 저장됨: "${token}" → ${picked.DisplayName || picked.ProdName}`);
    }

    saveJson(MAP_FILE, mappings);
    const addedCount = Object.keys(mappings).length - initialCount;
    console.log(`\n💾 저장 완료. 세션 중 추가 ${addedCount}건, 총 ${Object.keys(mappings).length}건.`);

    const more = (await ask('\n계속? (y/n): ')).trim().toLowerCase();
    if (more !== 'y' && more !== '') break;
  }

  rl.close();
  console.log('\n✅ 학습 종료.');
  console.log(`💡 배포하려면:`);
  console.log(`   git add data/order-mappings.json`);
  console.log(`   git commit -m "train: paste mappings"`);
  console.log(`   git push origin master`);
}

// ── 엔트리 ────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--sync')) { await syncProducts(); return; }
  if (args.includes('--help') || args.includes('-h')) {
    console.log('사용법:');
    console.log('  node scripts/paste-train.js --sync   (품목 캐시 다운로드, 최초 1회)');
    console.log('  node scripts/paste-train.js          (학습 시작)');
    return;
  }
  await trainLoop();
})();
