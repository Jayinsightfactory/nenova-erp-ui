// DB 의 모든 카네이션 품목 + 사용자 입력한 17개 품종이 매칭 가능한지 확인
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const USER_INPUT = [
  '캐롤라인', '돈셀', '돈페드로', '노비아', '문라이트', '헤르메스오렌지',
  '라이온킹', '메건', '헤르메스', '웨딩', '체리오', '사파리',
  '프론테라', '클리아워터', '만달레이', '코마치', '믹스 B'
];

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });

  console.log('## DB 의 카네이션 품목 전체:');
  const all = await pool.request().query(`
    SELECT ProdKey, ProdName, DisplayName, FlowerName, CounName
    FROM Product
    WHERE isDeleted=0 AND (FlowerName LIKE '%CARNATION%' OR FlowerName LIKE '%카네%' OR ProdName LIKE '%CARNATION%')
    ORDER BY ProdName
  `);
  console.log(`총 ${all.recordset.length}개\n`);
  for (const r of all.recordset) {
    console.log(`  [${r.ProdKey}] ${r.ProdName.padEnd(45)} | DN=${(r.DisplayName||'').padEnd(20)} | Flower=${r.FlowerName} | Country=${r.CounName}`);
  }

  console.log('\n## 사용자 입력 17개 → DB 매칭 확인:');
  for (const ko of USER_INPUT) {
    // 한글 → 영문 추정 키워드
    const guesses = {
      '캐롤라인': ['CAROLINE'],
      '돈셀': ['DONCEL', 'DONSEL'],
      '돈페드로': ['DON PEDRO', 'DONPEDRO', 'PEDRO'],
      '노비아': ['NOVIA'],
      '문라이트': ['MOON', 'MOONLIGHT'],
      '헤르메스오렌지': ['HERMES', 'ORANGE'],
      '라이온킹': ['LION', 'LION KING'],
      '메건': ['MEGAN'],
      '헤르메스': ['HERMES'],
      '웨딩': ['WEDDING'],
      '체리오': ['CHERIO', 'CHEERIO'],
      '사파리': ['SAFARI'],
      '프론테라': ['FRONTERA'],
      '클리아워터': ['CLEAR WATER', 'CLEARWATER'],
      '만달레이': ['MANDALAY'],
      '코마치': ['KOMACHI'],
      '믹스 B': ['MIX', 'MIX B', 'MIXED'],
    }[ko] || [ko];

    const hits = [];
    for (const g of guesses) {
      const found = all.recordset.filter(r =>
        (r.ProdName||'').toUpperCase().includes(g.toUpperCase()) ||
        (r.DisplayName||'').toUpperCase().includes(g.toUpperCase())
      );
      for (const f of found) if (!hits.find(h => h.ProdKey === f.ProdKey)) hits.push(f);
    }

    if (hits.length === 0) {
      console.log(`  ❌ ${ko.padEnd(10)} → DB에 일치 품목 없음 (검색어: ${guesses.join(', ')})`);
    } else if (hits.length === 1) {
      console.log(`  ✅ ${ko.padEnd(10)} → [${hits[0].ProdKey}] ${hits[0].ProdName}`);
    } else {
      console.log(`  ⚠ ${ko.padEnd(10)} → ${hits.length}개 후보:`);
      for (const h of hits) console.log(`              [${h.ProdKey}] ${h.ProdName}`);
    }
  }

  // 학습 매핑 파일에 카네이션 매핑 있는지
  console.log('\n## 학습 매핑 (data/order-mappings.json) 의 카네이션 관련:');
  const mapPath = path.join(__dirname, '..', 'data', 'order-mappings.json');
  if (fs.existsSync(mapPath)) {
    const mappings = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    let cnt = 0;
    for (const [k, v] of Object.entries(mappings)) {
      if (/카네|carnation/i.test(k) || /CARNATION/i.test(v.flowerName||'') || /카네/.test(v.flowerName||'')) {
        console.log(`  "${k}" → ${v.prodName} (ProdKey=${v.prodKey})`);
        cnt++;
        if (cnt >= 50) { console.log(`  ... 외 다수 (${Object.keys(mappings).length}개 전체)`); break; }
      }
    }
    console.log(`총 학습 매핑 ${Object.keys(mappings).length}개`);
  } else {
    console.log('  파일 없음');
  }

  await pool.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
