// scripts/classify-unknown-flowers.mjs
// 미지정 카테고리 (FlowerName='기타' or 빈) ProdKey 를 ProdName 키워드로 자동 분류.
// DB 는 안 건드리고 data/category-overrides.json 시드 후보만 생성.
// 사용자가 검토 후 채택 (--apply 옵션으로 category-overrides.json 에 병합).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlImport from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}
const sql = sqlImport;

const APPLY = process.argv.includes('--apply');
const OVERRIDE_FILE = path.join(__dirname, '..', 'data', 'category-overrides.json');

// 한글 카테고리 ↔ ProdName 키워드 매칭 룰
// (Flower 마스터 한글값 기준 — 영문 라벨이 들어와도 한글로 매핑)
const KEYWORD_MAP = [
  { category: '안개꽃',     keywords: ['Gypsophila', '안개꽃', 'gypso'] },
  { category: '리시안서스', keywords: ['Lisianthus', 'Eustoma', '리시안서스', '유스토마'] },
  { category: '유칼립투스', keywords: ['Eucalyptus', '유칼립투스', '블랙잭', '베이비 블루', 'Baby Blue'] },
  { category: '리모늄',     keywords: ['Limonium', 'Sinensis', '리모늄', '시네신스', '미스티 블루', 'Statice', '스타티스'] },
  { category: '달리아',     keywords: ['Dahlia', 'DAHLIA', '달리아'] },
  { category: '라넌큘러스', keywords: ['Ranunculus', '라넌큘러스', 'ranunculus'] },
  { category: '델피니움',   keywords: ['Delphinium', '델피니움'] },
  { category: '아마란투스', keywords: ['Amaranthus', '줄맨드라미', 'amaranthus'] },
  { category: '튤립',       keywords: ['Tulip', '튤립', 'tulip'] },
  { category: '히아신스',   keywords: ['Hyacinth', '히아신스'] },
  { category: '왁스플라워', keywords: ['Wax', '왁스', 'waxflower'] },
  { category: '안시리움',   keywords: ['Anthurium', '안시리움', '안수리움'] },
  { category: '카라',       keywords: ['Calla', '카라'] },
  { category: '아스틸베',   keywords: ['Astilbe', '아스틸베'] },
  { category: '아가판서스', keywords: ['Agapanthus', '아가판서스'] },
  { category: '나르시스',   keywords: ['Narcissus', '나르시스', '수선화'] },
  { category: '깜바눌라',   keywords: ['Campanula', '깜바눌라', '캠퍼눌라'] },
  { category: '에린지움',   keywords: ['Eryngium', '에린지움', '에린기움'] },
  { category: '아마릴리스', keywords: ['Amaryllis', '아마릴리스'] },
  { category: '온시디움',   keywords: ['Oncidium', '온시디움'] },
  { category: '호접난',     keywords: ['Phalaenopsis', '호접', 'Orchid'] },
  { category: '모카라',     keywords: ['Mokara', '모카라'] },
  { category: '작약',       keywords: ['Peony', '작약', 'peony'] },
  { category: '레몬잎',     keywords: ['Lemon', '레몬잎'] },
  { category: '루스커스',   keywords: ['Ruscus', '루스커스'] },
  { category: '아카시아',   keywords: ['Acacia', '아카시아'] },
  { category: '스키미아',   keywords: ['Skimmia', '스키미아'] },
  { category: '알륨',       keywords: ['Allium', '알륨'] },
  { category: '무스카리',   keywords: ['Muscari', '무스카리'] },
  { category: '은방울꽃',   keywords: ['Lily of the Valley', 'Convallaria', '은방울'] },
  { category: '수국',       keywords: ['Hydrangea', '수국'] },
  { category: '네리네',     keywords: ['Nerine', '네리네'] },
  { category: '솔리다고',   keywords: ['Solidago', '솔리다고'] },
  { category: '글라디올러스', keywords: ['Gladiolus', '라스라지', '글라디올러스'] },
  { category: '클레마티스', keywords: ['Clematis', '클레마티스', 'CLEMATIS'] },
  { category: '백합',       keywords: ['Oriental white', 'Oriental Lily', '백합', '오리엔탈'] },
  { category: '조팝',       keywords: ['Spiraea', '조팝', 'Bridal wreath'] },
  { category: '아스파라거스', keywords: ['Asparagus', 'ASPARAGUS', '아스파라거스', '미디오'] },
  { category: '코디라인',   keywords: ['Cordyline', '코디라인'] },
  { category: '폴리고나텀', keywords: ['Polygonatum', '폴리고나텀'] },
  { category: '세루리아',   keywords: ['Serruria', '블러싱 브라이드', '세루리아'] },
  { category: '에리카',     keywords: ['Melaleuca', '에리카', '골든와트리', 'GoldenWatree'] },
  // freight 행 — 분류 제외
  { category: '__SKIP__',   keywords: ['Gross weig', 'Chargeable weig', '운송료', '운송비', '항공료', '항공비', '서류', 'FREIGHT', 'SHIPPING'] },
];

function classify(prodName) {
  const text = String(prodName || '');
  for (const { category, keywords } of KEYWORD_MAP) {
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (re.test(text)) return category;
    }
  }
  return null;
}

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  console.log(`# 미지정 카테고리 자동 분류 ${APPLY ? '(APPLY)' : '(DRY-RUN)'}\n`);

  // FlowerName 이 '기타' 또는 빈 + 최근 사용 ProdKey
  const r = await pool.request().query(`
    SELECT p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
        ISNULL(usage.UseCount, 0) AS UseCount
    FROM Product p
    LEFT JOIN (
      SELECT wd.ProdKey, COUNT(*) AS UseCount
      FROM WarehouseDetail wd
      INNER JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
      WHERE wm.isDeleted=0 AND wm.InputDate >= DATEADD(DAY, -90, GETDATE())
        AND wd.ProdKey IS NOT NULL
      GROUP BY wd.ProdKey
    ) usage ON p.ProdKey = usage.ProdKey
    WHERE p.isDeleted=0
      AND (p.FlowerName IS NULL OR LTRIM(RTRIM(p.FlowerName)) IN (N'', N'기타', N'others', N'OTHERS'))
      AND ISNULL(usage.UseCount, 0) > 0
    ORDER BY usage.UseCount DESC
  `);

  const targets = r.recordset;
  console.log(`미지정 ProdKey (최근 90일 사용): ${targets.length}건\n`);

  const classified = [];
  const skipped = [];
  const unmatched = [];
  const byCategory = new Map();

  for (const p of targets) {
    const cat = classify(p.ProdName);
    if (cat === '__SKIP__') {
      skipped.push(p);
    } else if (cat) {
      classified.push({ ...p, suggestedCategory: cat });
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    } else {
      unmatched.push(p);
    }
  }

  console.log(`✅ 키워드 매칭 성공: ${classified.length}건`);
  console.log(`⏭ Freight 행 (분류 제외): ${skipped.length}건`);
  console.log(`❓ 매칭 실패 (수동 분류 필요): ${unmatched.length}건\n`);

  console.log(`## 분류 결과 (카테고리별)\n`);
  for (const [cat, count] of [...byCategory.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${cat}: ${count}건`);
  }

  console.log(`\n## 샘플 분류 (Top 20)\n`);
  for (const c of classified.slice(0, 20)) {
    console.log(`  ${c.ProdKey} → "${c.suggestedCategory}" | ${(c.ProdName||'').substring(0,55)} [사용 ${c.UseCount}회]`);
  }

  if (unmatched.length > 0) {
    console.log(`\n## ❓ 매칭 실패 (수동 분류 필요)\n`);
    for (const p of unmatched) {
      console.log(`  ${p.ProdKey} | ${(p.ProdName||'').substring(0,55)} | ${p.CounName||''} [사용 ${p.UseCount}회]`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n## ⏭ Freight 행 (분류 제외, 정상)\n`);
    for (const p of skipped) {
      console.log(`  ${p.ProdKey} | ${(p.ProdName||'').substring(0,40)}`);
    }
  }

  await pool.close();

  if (!APPLY) {
    console.log(`\n[DRY-RUN] category-overrides.json 변경 없음. --apply 추가 시 시드 병합.`);
    return;
  }

  // APPLY — category-overrides.json 에 병합
  let existing = {};
  if (fs.existsSync(OVERRIDE_FILE)) {
    existing = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
  }
  // 백업
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = OVERRIDE_FILE.replace('.json', `.backup-${ts}.json`);
  if (fs.existsSync(OVERRIDE_FILE)) fs.copyFileSync(OVERRIDE_FILE, backup);

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const c of classified) {
    if (existing[c.ProdKey]) continue;  // 기존 시드는 보존
    existing[c.ProdKey] = {
      category: c.suggestedCategory,
      note: `[자동분류] ${c.ProdName?.substring(0, 40)} (키워드 매칭, ${today})`,
      savedAt: new Date().toISOString(),
      auto: true,
    };
    added++;
  }
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(existing, null, 2));
  console.log(`\n✅ category-overrides.json 갱신 — ${added}건 추가 (총 ${Object.keys(existing).length}건)`);
  console.log(`✅ 백업: ${path.basename(backup)}`);
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
