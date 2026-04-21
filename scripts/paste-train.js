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
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'data', 'order-mappings.json');
const PROD_CACHE = path.join(ROOT, 'data', '.product-cache.json');
const QUEUE_FILE = path.join(ROOT, 'data', '.train-queue.json');
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
  // 품종
  '장미': 'ROSE', '로즈': 'ROSE', '카네이션': 'CARNATION', '수국': 'HYDRANGEA',
  '튤립': 'TULIP', '거베라': 'GERBERA', '리시안': 'LISIANTHUS', '국화': 'CHRYSANTHEMUM',
  '안개': 'GYPSOPHILA', '해바라기': 'SUNFLOWER', '알스트로': 'ALSTROEMERIA',
  '스타티스': 'STATICE', '루스커스': 'RUSCUS',
  // 스프레이(미니카네이션)
  '스프레이': 'MINICARNATION',
  // 색상
  '화이트': 'WHITE', '연핑크': 'LIGHT PINK', '블루': 'BLUE', '핑크': 'PINK',
  '레드': 'RED', '옐로': 'YELLOW', '오렌지': 'ORANGE', '퍼플': 'PURPLE',
  '라벤더': 'LAVENDER', '그린': 'GREEN', '크림': 'CREAM', '살몬': 'SALMON',
  '버건디': 'BURGUNDY', '진그린': 'G/ ESMERAL', '진핑크': 'DARK PINK',
  '연그린': 'S/GN', '피치': 'PEACH',
  // 품목명
  '코랄리프': 'CORAL REEF', '캐롤라인': 'CAROLINE', '카라멜': 'CARAMEL',
  '사파리': 'SAFARI', '레드팬서': 'RED PANTHER', '팬서': 'PANTHER',
  '문라이트': 'MOON LIGHT', '몬디알': 'MONDIAL', '퀵샌드': 'QUICKSAND',
  '틴티드': 'TINTED', '웨딩': 'WEDDING', '노비아': 'NOVIA', '돈셀': 'DONCEL',
  '체리오': 'CHEERIO', '마제스타': 'MAJESTA', '폴림니아': 'POLIMNIA',
  '이케바나': 'IKEBANA', '리찌': 'LIZZY', '만달라': 'MANDALA',
  '하마다': 'HAMADA', '아틱': 'ARCTIC', '아테나': 'ATHENA',
  '라이언킹': 'LION KING', '크리미아': 'CRIMEA', '크리마아': 'CRIMEA',
  '헤르메스': 'HERMES', '레게': 'REGE', '로다스': 'RODAS',
  '핑크몬디알': 'PINK MONDIAL',
};

// 복합어 분리: "몬디알화이트" → "몬디알 화이트", "핑크몬디알" → "핑크 몬디알"
const COMPOUND_WORDS = [
  '몬디알화이트', '몬디알핑크', '몬디알', '핑크몬디알',
  '로다스크림', '레게핑크',
];
function splitCompound(token) {
  let t = token;
  // 알려진 복합어 분리
  t = t.replace(/몬디알화이트/g, '몬디알 화이트');
  t = t.replace(/핑크몬디알/g, '핑크 몬디알');
  t = t.replace(/로다스크림/g, '로다스 크림');
  t = t.replace(/레게핑크/g, '레게 핑크');
  return t;
}

// 국가명 매핑
const COUNTRY_KO = {
  '콜롬비아': 'colombia', '에콰도르': 'ecuador', '네덜란드': 'netherlands',
  '중국': 'china', '케냐': 'kenya', '인도': 'india',
};

function score(inputName, prod) {
  const q = normalize(splitCompound(inputName));
  const toks = q.split(/\s+/).filter(Boolean);
  const haystack = normalize([prod.ProdName, prod.DisplayName, prod.FlowerName, prod.CounName].filter(Boolean).join(' '));
  let s = 0;

  for (const t of toks) {
    const en = KO_EN[t];
    if (en && haystack.includes(normalize(en))) s += 2;
    if (haystack.includes(t)) s += 1;
  }
  if (haystack.includes(q)) s += 3;

  // 국가 가중치: 토큰에 국가명이 있으면 해당 국가 제품 우선
  for (const [ko, en] of Object.entries(COUNTRY_KO)) {
    if (q.includes(ko)) {
      const prodCountry = normalize(prod.CounName || '');
      if (prodCountry.includes(ko) || prodCountry.includes(en)) s += 3;
      else s -= 2; // 다른 국가 페널티
      break;
    }
  }

  // Mix Box 페널티: 단품이 우선
  if (/mix\s*box/i.test(prod.ProdName || '') || /mix\s*box/i.test(prod.DisplayName || '')) {
    s -= 1;
  }

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
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
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

// ── 품목 리스트 동기화 (DB 직접) ──────────────────────────────
function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local 없음');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function fetchProductsDb() {
  loadEnvLocal();
  let sql;
  try { sql = require('mssql'); }
  catch { throw new Error('mssql 패키지 필요: npm i mssql'); }
  const config = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 30000,
  };
  const pool = await sql.connect(config);
  const r = await pool.request().query(
    `SELECT ProdKey, ProdName, DisplayName, FlowerName, CounName, OutUnit
     FROM Product WHERE isDeleted=0 ORDER BY ProdName`
  );
  await pool.close();
  return r.recordset;
}

// ── 메인 인터랙티브 루프 ───────────────────────────────────────
async function syncProducts(useDb = false) {
  try {
    let products;
    if (useDb) {
      console.log(`📥 DB 직접 조회 (.env.local)`);
      products = await fetchProductsDb();
    } else {
      console.log(`📥 품목 리스트 다운로드: ${API_URL}/api/master?entity=products`);
      products = await fetchProducts();
    }
    saveJson(PROD_CACHE, products);
    console.log(`✅ ${products.length}건 저장: ${PROD_CACHE}`);
  } catch (e) {
    console.error('❌ 실패:', e.message);
    if (!useDb) {
      console.log('  → DB 직접 모드 시도: node scripts/paste-train.js --sync-db');
    }
    process.exit(1);
  }
}

// 국가 접두사 매핑 (접두사 → 국가명)
const COUNTRY_PREFIX = {
  '콜': '콜롬비아', '에콰': '에콰도르', '네덜': '네덜란드',
  '중국': '중국', '케냐': '케냐', '인도': '인도',
};

// 헤더행 패턴: "16-1 수국 변경", "16-1차 카네이션 변경사항", "16차 콜 카네이션 변경사항"
const HEADER_RE = /\d+(?:-\d+)?차?\s+(.+?)\s*(?:변경\s*사항|변경\s*요청|변경|추가|취소)\s*$/;

function parseHeader(line) {
  const m = line.trim().match(HEADER_RE);
  if (!m) return null;
  let raw = m[1].trim();
  let country = '콜롬비아'; // 기본값
  for (const [prefix, name] of Object.entries(COUNTRY_PREFIX)) {
    if (raw.startsWith(prefix)) {
      country = name;
      raw = raw.slice(prefix.length).trim();
      break;
    }
  }
  return { flower: raw, country };
}

// 줄바꿈 없이 헤더가 붙어있는 경우 분리
// "로다스크림 1박스 추가16-1차 카네이션 변경사항" → 두 줄로
function splitLines(text) {
  return text.replace(/(\d+(?:-\d+)?차?\s+(?:콜\s*|에콰\s*|네덜\s*|중국\s*)?[가-힣]+\s*(?:변경\s*사항|변경\s*요청|변경|추가|취소))/g, '\n$1').split('\n');
}

// "서부꽃집 - 크리미아 1박스 추가" → 거래처 제거, 품목 부분만
// "[남대문 중앙] - 폴림니아 1박스 취소" → 거래처 제거
// "주광 : 만달라 10단 취소" → 거래처 제거
function stripCustomer(line) {
  // "[거래처] - 품목" 또는 "거래처 - 품목" 패턴
  const dashMatch = line.match(/^(?:\[.*?\]|.+?)\s*[-–]\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();
  // "거래처 : 품목" 패턴
  const colonMatch = line.match(/^.+?\s*[:：]\s*(.+)$/);
  if (colonMatch) return colonMatch[1].trim();
  return line;
}

function extractTokens(text) {
  const results = [];
  let currentFlower = null;
  let currentCountry = '콜롬비아';
  const lines = splitLines(text);

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t) continue;
    // 구분선, 안내 문구 건너뜀
    if (/^[ㅡ\-=_]{4,}$/.test(t)) continue;
    if (/출고건|출고분|입니다/.test(t) && !/\d+\s*(박스|단|송이|개)/.test(t)) continue;
    if (t.startsWith('>')) continue;

    // 헤더행 감지
    const header = parseHeader(t);
    if (header) {
      currentFlower = header.flower;
      currentCountry = header.country;
      continue;
    }

    // 품목 라인: 수량(+단위) + 동작 키워드가 있는 줄
    const hasQty = /\d+\s*(박스|단|송이|개|stems?)/i.test(t);
    const hasAction = /(추가|취소)/.test(t);
    if (hasQty || (hasAction && /\d+/.test(t))) {
      const stripped = stripCustomer(t);
      const action = /취소/.test(stripped) ? 'cancel' : 'add';
      const cleaned = stripped
        .replace(/\d+\s*(박스|단|송이|개|stems?|cm)?/gi, '')
        .replace(/(추가|취소|add|cancel)/gi, '')
        .replace(/[|:,]/g, ' ')
        .trim();
      if (cleaned && cleaned.length >= 1) {
        const prefix = currentFlower ? `${currentCountry} ${currentFlower} ` : '';
        results.push({ token: `${prefix}${cleaned}`.trim(), action });
      }
      continue;
    }
    // 그 외 = 거래처명 → 건너뜀
  }
  return results;
}

// ── 카카오톡 파일에서 "변경사항" 블록 추출 ────────────────────
// 메시지 시작: "[이름] [오전 9:21] 내용"
const KAKAO_MSG_RE = /^\[[^\]]+\]\s*\[(?:오전|오후)\s*\d{1,2}:\d{2}\]\s*(.*)$/;

function extractChangeBlocks(rawText) {
  const lines = rawText.split(/\r?\n/);
  const blocks = [];
  let current = null;

  const flush = () => {
    if (current && /변경\s*사항/.test(current.header)) blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    const m = line.match(KAKAO_MSG_RE);
    if (m) {
      flush();
      current = { header: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();
  return blocks;
}

async function extractMode(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 파일 없음: ${filePath}`);
    process.exit(1);
  }
  const products = loadJson(PROD_CACHE, null);
  if (!products || !Array.isArray(products) || products.length === 0) {
    console.error('❌ 품목 캐시 없음. 먼저: node scripts/paste-train.js --sync-db');
    process.exit(1);
  }
  const mappings = loadJson(MAP_FILE, {});
  const raw = fs.readFileSync(filePath, 'utf8');
  const blocks = extractChangeBlocks(raw);
  console.log(`📑 블록 ${blocks.length}개 발견 ("변경사항" 헤더 포함)`);

  const items = [];
  const seen = new Set();
  let dup = 0, learned = 0;

  for (const b of blocks) {
    const blockText = [b.header, ...b.body].join('\n');
    const extracted = extractTokens(blockText);
    for (const { token, action } of extracted) {
      const key = normalize(token);
      if (!key) continue;
      if (mappings[key]) { learned++; continue; }
      if (seen.has(key + '|' + action)) { dup++; continue; }
      seen.add(key + '|' + action);
      const cands = topCandidates(token, products, 5).map(({ prod, sc }) => ({
        score: sc,
        prodKey: prod.ProdKey,
        prodName: prod.ProdName,
        displayName: prod.DisplayName,
        flowerName: prod.FlowerName,
        counName: prod.CounName,
      }));
      items.push({
        id: items.length,
        token,
        action,
        header: b.header,
        candidates: cands,
        processed: false,
        selected: null,
      });
    }
  }

  const queue = {
    createdAt: new Date().toISOString(),
    source: path.basename(filePath),
    totalBlocks: blocks.length,
    items,
  };
  saveJson(QUEUE_FILE, queue);
  console.log(`✅ 큐 저장: ${QUEUE_FILE}`);
  console.log(`   총 토큰 ${items.length}개 (이미 학습 ${learned} / 중복 ${dup} 제외)`);
  const zero = items.filter(x => x.candidates.length === 0).length;
  console.log(`   후보 없음: ${zero}개 (매칭 어려울 수 있음)`);
  console.log(`\n▶ 학습 시작: node scripts/paste-train.js --queue`);
}

// ── 저장된 큐 순차 처리 ──────────────────────────────────────
async function queueMode() {
  const queue = loadJson(QUEUE_FILE, null);
  if (!queue || !Array.isArray(queue.items)) {
    console.error(`❌ 큐 없음. 먼저: node scripts/paste-train.js --extract <파일>`);
    process.exit(1);
  }
  const mappings = loadJson(MAP_FILE, {});
  const initialCount = Object.keys(mappings).length;
  const pending = queue.items.filter(x => !x.processed);
  const doneCount = queue.items.length - pending.length;
  console.log(`📚 기존 매핑 ${initialCount}건 / 큐 ${queue.items.length}건 (완료 ${doneCount}, 남음 ${pending.length})`);
  console.log(`📦 출처: ${queue.source}`);
  console.log('');
  console.log('==================================================');
  console.log('큐 학습 모드');
  console.log('==================================================');
  console.log('번호 선택 / s: 건너뛰기 / q: 저장 후 종료 / b: 뒤로');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  let savedCount = 0;
  let aborted = false;

  for (let i = 0; i < queue.items.length; i++) {
    const item = queue.items[i];
    if (item.processed) continue;
    const actionLabel = item.action === 'cancel' ? '취소' : '추가';
    const key = normalize(item.token);
    if (mappings[key]) {
      item.processed = true;
      item.selected = mappings[key].prodKey;
      continue;
    }
    const progress = `[${i + 1}/${queue.items.length}]`;
    console.log(`\n${progress} 🔸 "${item.token}" [${actionLabel}]`);
    console.log(`    (헤더: ${item.header})`);
    if (item.candidates.length === 0) {
      console.log('    ❓ 후보 없음 — 건너뜀');
      item.processed = true;
      continue;
    }
    item.candidates.forEach((c, idx) => {
      console.log(`    ${idx + 1}) [${c.score}점] ${c.displayName || c.prodName} (${c.counName || ''}/${c.flowerName || ''}) key=${c.prodKey}`);
    });
    const ans = (await ask('    선택: ')).trim();
    if (ans.toLowerCase() === 'q') { aborted = true; break; }
    if (ans.toLowerCase() === 's' || !ans) { item.processed = true; continue; }
    const idx = parseInt(ans) - 1;
    if (isNaN(idx) || idx < 0 || idx >= item.candidates.length) {
      console.log('    잘못된 번호 — 건너뜀');
      item.processed = true;
      continue;
    }
    const picked = item.candidates[idx];
    mappings[key] = {
      prodKey: picked.prodKey,
      prodName: picked.prodName,
      displayName: picked.displayName,
      flowerName: picked.flowerName,
      counName: picked.counName,
      savedAt: new Date().toISOString(),
    };
    item.processed = true;
    item.selected = picked.prodKey;
    savedCount++;
    console.log(`    ✅ 저장: ${picked.displayName || picked.prodName}`);

    if (savedCount > 0 && savedCount % 10 === 0) {
      saveJson(MAP_FILE, mappings);
      saveJson(QUEUE_FILE, queue);
      console.log(`    💾 중간 저장 (${savedCount}건)`);
    }
  }

  saveJson(MAP_FILE, mappings);
  saveJson(QUEUE_FILE, queue);
  rl.close();
  const remaining = queue.items.filter(x => !x.processed).length;
  console.log(`\n✅ ${aborted ? '중단' : '완료'}. 이번 세션 ${savedCount}건 저장.`);
  console.log(`   전체 매핑 ${Object.keys(mappings).length}건 / 큐 남음 ${remaining}건`);
  if (remaining > 0) console.log(`▶ 이어서: node scripts/paste-train.js --queue`);
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

    const items = extractTokens(text);
    console.log(`\n🔍 추출된 후보 품목명 ${items.length}개`);

    for (const { token, action } of items) {
      const actionLabel = action === 'cancel' ? '취소' : '추가';
      const key = normalize(token);
      if (mappings[key]) {
        const p = mappings[key];
        console.log(`  ✅ 이미 학습됨: "${token}" [${actionLabel}] → ${p.displayName || p.prodName} (ProdKey ${p.prodKey})`);
        continue;
      }
      const cands = topCandidates(token, products, 10);
      if (cands.length === 0) {
        console.log(`  ❓ "${token}" [${actionLabel}] — 후보 없음. 건너뜀.`);
        continue;
      }
      console.log(`\n  🔸 "${token}" [${actionLabel}] 후보:`);
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
  if (args.includes('--sync'))    { await syncProducts(false); return; }
  if (args.includes('--sync-db')) { await syncProducts(true);  return; }
  const extractIdx = args.indexOf('--extract');
  if (extractIdx >= 0) {
    const fp = args[extractIdx + 1];
    if (!fp) { console.error('❌ 파일 경로 필요: --extract <파일>'); process.exit(1); }
    await extractMode(fp);
    return;
  }
  if (args.includes('--queue')) { await queueMode(); return; }
  if (args.includes('--help') || args.includes('-h')) {
    console.log('사용법:');
    console.log('  --sync                  (API 통해 다운, 인증 필요)');
    console.log('  --sync-db               (.env.local DB 직접, 추천)');
    console.log('  --extract <파일>        (카카오톡 등 텍스트 → 큐 생성)');
    console.log('  --queue                 (저장된 큐 순차 학습)');
    console.log('  (인자 없음)             (붙여넣기 학습)');
    return;
  }
  await trainLoop();
})();
