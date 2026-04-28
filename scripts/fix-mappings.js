// 1순위 — order-mappings.json 정정 스크립트
// (1) 17개 사용자 입력 매핑 추가
// (2) Alhambra(338) 로 잘못 학습된 카네이션 항목 ≈ 20+건 정정
// (3) 추가로 DB 매칭 가능한 것 자동 정정

const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const FILE = path.join(__dirname, '..', 'data', 'order-mappings.json');

// 17개 사용자 입력 → DB ProdKey 정확 매핑 (이번 세션 합의)
const USER_17_FIX = {
  // 키 형식: "콜롬비아 카네이션 <한글 입력>" + 입력 그대로도 추가
  '콜롬비아 카네이션 캐롤라인': { prodKey: 364, prodName: 'CARNATION Caroline', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 돈셀':     { prodKey: 389, prodName: 'CARNATION Doncel',   flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 돈페드로':   { prodKey: 390, prodName: 'CARNATION Don pedro (Red)', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 노비아':    { prodKey: 456, prodName: 'CARNATION Novia',    flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 문라이트':   { prodKey: 447, prodName: 'CARNATION Moon Light', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 헤르메스오렌지': { prodKey: 409, prodName: 'CARNATION Hermes Orange', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 라이온킹':   { prodKey: 429, prodName: 'CARNATION Lion King', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 메건':     { prodKey: 522, prodName: 'CARNATION Megan',    flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 헤르메스':   { prodKey: 408, prodName: 'CARNATION Hermes',  flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 웨딩':     { prodKey: 511, prodName: 'CARNATION Wedding',  flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 체리오':    { prodKey: 368, prodName: 'CARNATION Cherrio', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 사파리':    { prodKey: 3066, prodName: 'CARNATION Safari', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 프론테라':   { prodKey: 471, prodName: 'CARNATION Red Frontera', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 클리아워터':  { prodKey: 423, prodName: 'CARNATION Clear Water', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 클리어워터':  { prodKey: 423, prodName: 'CARNATION Clear Water', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 만달레이':   { prodKey: 433, prodName: 'CARNATION Mandalay', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 코마치':    { prodKey: 420, prodName: 'CARNATION Komachi',  flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 믹스 b':   { prodKey: 2516, prodName: 'CARNATION MIx Box B (Megan. Hermes, Ikebana)', flowerName: '카네이션', counName: '콜롬비아' },
  '콜롬비아 카네이션 믹스b':    { prodKey: 2516, prodName: 'CARNATION MIx Box B (Megan. Hermes, Ikebana)', flowerName: '카네이션', counName: '콜롬비아' },
  // 짧은 키 (꽃종류 prefix 없이)
  '카네이션 캐롤라인':       { prodKey: 364, prodName: 'CARNATION Caroline', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 돈셀':          { prodKey: 389, prodName: 'CARNATION Doncel',   flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 돈페드로':       { prodKey: 390, prodName: 'CARNATION Don pedro (Red)', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 노비아':         { prodKey: 456, prodName: 'CARNATION Novia',    flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 문라이트':       { prodKey: 447, prodName: 'CARNATION Moon Light', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 헤르메스오렌지':   { prodKey: 409, prodName: 'CARNATION Hermes Orange', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 헤르메스 오렌지':  { prodKey: 409, prodName: 'CARNATION Hermes Orange', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 라이온킹':       { prodKey: 429, prodName: 'CARNATION Lion King', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 메건':          { prodKey: 522, prodName: 'CARNATION Megan',    flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 헤르메스':       { prodKey: 408, prodName: 'CARNATION Hermes',  flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 웨딩':          { prodKey: 511, prodName: 'CARNATION Wedding',  flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 체리오':         { prodKey: 368, prodName: 'CARNATION Cherrio', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 사파리':         { prodKey: 3066, prodName: 'CARNATION Safari', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 프론테라':       { prodKey: 471, prodName: 'CARNATION Red Frontera', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 클리아워터':      { prodKey: 423, prodName: 'CARNATION Clear Water', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 클리어워터':      { prodKey: 423, prodName: 'CARNATION Clear Water', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 만달레이':       { prodKey: 433, prodName: 'CARNATION Mandalay', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 코마치':         { prodKey: 420, prodName: 'CARNATION Komachi',  flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 믹스 b':        { prodKey: 2516, prodName: 'CARNATION MIx Box B (Megan. Hermes, Ikebana)', flowerName: '카네이션', counName: '콜롬비아' },
  '카네이션 믹스b':         { prodKey: 2516, prodName: 'CARNATION MIx Box B (Megan. Hermes, Ikebana)', flowerName: '카네이션', counName: '콜롬비아' },
};

(async () => {
  // DB 카네이션 전체 로드 — 자동 정정에 사용
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT||'1433'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt:false, trustServerCertificate:true, enableArithAbort:true, connectTimeout:30000, requestTimeout:60000 },
  });
  const dbCarn = (await pool.request().query(`
    SELECT ProdKey, ProdName, FlowerName, CounName
    FROM Product WHERE isDeleted=0 AND FlowerName=N'카네이션'
    ORDER BY ProdName
  `)).recordset;

  // 자동 매칭 함수: 키 안의 한글 마지막 단어를 ProdName 영문에 매칭
  // 예: '콜롬비아 카네이션 라이온킹' → 'Lion King'
  const KO_EN = {
    '캐롤라인':'CAROLINE','캐롤라인골드':'CAROLINE GOLD','캐롤라인 골드':'CAROLINE GOLD',
    '돈셀':'DONCEL','돈페드로':'DON PEDRO',
    '노비아':'NOVIA','문라이트':'MOON LIGHT','문라이트 (남대문 중앙)':'MOON LIGHT',
    '헤르메스':'HERMES','헤르메스오렌지':'HERMES ORANGE','헤르메스 오렌지':'HERMES ORANGE','오렌지헤르메스':'HERMES ORANGE',
    '라이온킹':'LION KING','라이언킹':'LION KING',
    '메건':'MEGAN','웨딩':'WEDDING','체리오':'CHERRIO','사파리':'SAFARI',
    '프론테라':'FRONTERA','클리어워터':'CLEAR WATER','클리아워터':'CLEAR WATER',
    '만달레이':'MANDALAY','코마치':'KOMACHI','마루치':'MARUCHI',
    '카라멜':'CARAMEL','카오리':'KAORI','이케바나':'IKEBANA',
    '폴림니아':'POLIMNIA','폴립니아':'POLIMNIA','마제스타':'MAJESTA','마리포사':'MARIPOSA',
    '지오지아':'GIOGIA','애플티':'APPLE TEA','립스틱':'LIPS','일루션':'ILUSION','일루젼':'ILUSION',
    '브루트':'BRUT','브르트':'BRUT','로다스':'RODAS','로시타':'ROSITA',
    '쥬리고':'ZURIGO','아틱':'ARCTIC','네스':'NES','딜리타옐로우':'DILETTA YELLOW',
    '유카리체리':'YUKARI CHERRY',
  };

  const findInDb = (token) => {
    if (!token) return null;
    const en = KO_EN[token.replace(/\s+/g,'').toLowerCase()] || KO_EN[token] ||
               KO_EN[Object.keys(KO_EN).find(k => k === token || k.replace(/\s+/g,'') === token.replace(/\s+/g,''))];
    if (!en) return null;
    // 1) 정확 일치 우선
    const upper = en.toUpperCase();
    const exact = dbCarn.find(p => (p.ProdName||'').toUpperCase().endsWith(upper) || (p.ProdName||'').toUpperCase().includes(' '+upper));
    if (exact) return exact;
    // 2) 부분 포함
    const partial = dbCarn.find(p => (p.ProdName||'').toUpperCase().includes(upper));
    return partial || null;
  };

  // 학습 매핑 로드
  const mappings = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log(`로드: ${Object.keys(mappings).length}개 매핑`);

  let added = 0, fixed = 0, kept = 0;
  const fixLog = [];

  // (1) 17개 USER_17_FIX 추가
  for (const [k, v] of Object.entries(USER_17_FIX)) {
    const before = mappings[k];
    if (!before || before.prodKey !== v.prodKey) {
      mappings[k] = { ...v, savedAt: new Date().toISOString() };
      if (before) {
        fixed++;
        fixLog.push(`FIX  "${k}" : ${before.prodKey} → ${v.prodKey} (${v.prodName})`);
      } else {
        added++;
        fixLog.push(`ADD  "${k}" → ${v.prodKey} (${v.prodName})`);
      }
    } else kept++;
  }

  // (2) Alhambra(338) 로 잘못 학습된 카네이션 매핑 자동 정정
  for (const [k, v] of Object.entries(mappings)) {
    if (v.prodKey !== 338) continue;  // Alhambra 매핑만
    if (!/카네/i.test(k)) continue;     // 카네이션 매핑만
    if (USER_17_FIX[k]) continue;       // 위에서 이미 처리

    // 키의 마지막 토큰들을 한글로 추출
    const last = k.replace(/^.*카네이션\s*/, '').trim();
    const dbHit = findInDb(last);
    if (dbHit) {
      mappings[k] = {
        prodKey: dbHit.ProdKey,
        prodName: dbHit.ProdName,
        flowerName: dbHit.FlowerName,
        counName: dbHit.CounName,
        savedAt: new Date().toISOString(),
      };
      fixed++;
      fixLog.push(`AUTO "${k}" : 338(Alhambra) → ${dbHit.ProdKey} (${dbHit.ProdName})`);
    }
  }

  // 백업
  const backupPath = FILE.replace(/\.json$/, `.backup-${new Date().toISOString().slice(0,10)}.json`);
  fs.copyFileSync(FILE, backupPath);
  console.log(`\n백업: ${path.basename(backupPath)}`);

  // 저장
  fs.writeFileSync(FILE, JSON.stringify(mappings, null, 2), 'utf8');

  console.log(`\n📊 결과: 추가 ${added}, 정정 ${fixed}, 유지 ${kept}`);
  console.log(`   총 매핑: ${Object.keys(mappings).length}개\n`);
  console.log('### 변경 내역:');
  for (const log of fixLog) console.log(`  ${log}`);

  await pool.close();
})().catch(e => { console.error('ERR:', e.stack || e.message); process.exit(1); });
