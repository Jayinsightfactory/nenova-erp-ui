#!/usr/bin/env node
// 라움 손익 — 원가자료 엑셀(28-1 콜롬비아/수국, 28-2 NL, CHINA, 덴파레) 기반 매입단가 시드
// 도착원가 엔진이 못 채우는(전산 미매칭) 품목만 WebRaumCostPrice 학습테이블에 저장.
// 매칭 근거: 27차 라움 분배수량 교차검증(레드=Nadya 430송이 등) + 원가파일 도착원가(단/송이) 100원 반올림.
// 실행: node scripts/seed-raum-cost-from-files.mjs
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

// 품목명(견적서 표기 그대로) → { cost: 100원 반올림 도착원가, src: 출처 }
const SEED = [
  ['장미 몬디알 연핑크', 9700, '콜롬비아 28-1 Pink Mondial 50cm 9,689.9/단'],
  ['장미 하츠', 11400, '콜롬비아 28-1 Hearts 50cm 11,394.9/단'],
  ['장미 코랄리프', 7200, '콜롬비아 28-1 Coral Reef 50cm 7,209.9/단'],
  ['장미 딥실버', 8900, '콜롬비아 28-1 Deep Silver 50cm 8,914.9/단'],
  ['장미 만달라', 9200, '콜롬비아 28-1 Mandala 50cm 9,224.9/단'],
  ['장미 카하라', 11800, '콜롬비아 27-2 Kahala 11,797.6/단'],
  ['알스트로메리아 레드', 5800, '콜롬비아 27-2 Nadya 5,837.4/단 (27차 분배 430송이=43단 일치)'],
  ['알스트로메리아 연보라', 5400, '콜롬비아 27-1 Lavender 5,385.1/단'],
  ['알스트로메리아 피피', 5600, '콜롬비아 28-1 Fifi 5,552.1/단'],
  ['알스트로메리아 화이트', 6500, '콜롬비아 28-1 Whistler 6,482.1/단 (분배 160송이=16단 일치)'],
  ['알스트로메리아 연핑크', 6500, '콜롬비아 28-1 Dubai 6,482.1/단 (분배 110송이=11단 일치)'],
  ['카네이션 연그린', 9500, '콜롬비아 28-1 Prado Mint 9,541.1/단 (분배 9단 일치)'],
  ['카네이션 연보라', 11400, '콜롬비아 28-1 Electric Purple 11,401.1/단 (분배 8단 일치)'],
  ['카네이션 부르트', 9500, '콜롬비아 28-1 Brut 9,541.1/단'],
  ['수국 피치', 2300, '수국 28-1 Peach(Florentina) 2,291.3/송이'],
  ['수국 피치핑크', 2300, '수국 28-1 Peach(Florentina) 2,291.3/송이'],
  ['튤립 연핑크', 18300, 'NL 28-2 Single Dynasty L/Pink 18,258.4/단'],
  ['튤립 오렌지주스', 11800, 'NL 28-2 Single Orange Juice 11,755.4/단'],
  ['안개꽃', 8900, 'CHINA 26-1 CLOUD Gypsophila white 8,902.9/단'],
];

// 근거 부족으로 제외: 제임스스토리(태국 아란 — 파일에 없음), 피오니 화이트(베트남 — 파일에 없음),
// 흰장미/스텔링/버터플라이/다빈치(이월 품종 특정 불가), 꽃잎용 장미 화이트(40cm 등급 — 파일은 65-75cm뿐)

const costKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

for (const [name, cost, src] of SEED) {
  const key = costKey(name);
  await pool.request()
    .input('n', sql.NVarChar, key)
    .input('c', sql.Float, cost)
    .input('by', sql.NVarChar, '원가자료 2026-07-14')
    .query(`MERGE WebRaumCostPrice AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
            WHEN MATCHED THEN UPDATE SET CostPrice=@c, UpdatedBy=@by, UpdatedAt=GETDATE()
            WHEN NOT MATCHED THEN INSERT (ItemName, CostPrice, UpdatedBy) VALUES (@n, @c, @by);`);
  console.log(`저장: ${name} = ${cost.toLocaleString()}원  ← ${src}`);
}

const chk = await pool.request().query(`SELECT ItemName, CostPrice FROM WebRaumCostPrice ORDER BY ItemName`);
console.log(`\nWebRaumCostPrice 총 ${chk.recordset.length}건`);
await pool.close();
