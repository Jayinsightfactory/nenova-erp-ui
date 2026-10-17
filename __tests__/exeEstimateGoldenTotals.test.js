// exe 산식 총매출 골든 테스트 — 2026년 15·16·36차
// 1) lib/exeEstimateViewSql.js 가 스냅샷 당시와 바이트 동일(sha256)한지  — 산식 불변 증명 (DB 불필요)
// 2) .env.local 이 있으면 운영 DB SELECT 로 GetData 총매출이 스냅샷과 원 단위 동일한지 — 데이터 불변 증명 (읽기 전용)
// 실행: node __tests__/exeEstimateGoldenTotals.test.js   (DB 없으면 2)는 SKIP 으로 표시하고 통과)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixturePath = path.join(here, 'fixtures', 'exeEstimateGoldenTotals.json');
const sqlPath = path.join(root, 'lib', 'exeEstimateViewSql.js');

function loadEnv() {
  const p = path.join(root, '.env.local');
  if (!fs.existsSync(p)) return false;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
  return Boolean(process.env.DB_SERVER && process.env.DB_NAME);
}

async function main() {
  let pass = 0, fail = 0, skip = 0;
  const assert = (label, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`  ✗ ${label} ${detail}`); } };
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  console.log('=== 1) exe 산식 파일 불변 (sha256) ===');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(sqlPath)).digest('hex');
  assert(`lib/exeEstimateViewSql.js sha256 = ${fixture.sqlFileSha256.slice(0, 12)}…`, sha === fixture.sqlFileSha256, `(현재 ${sha.slice(0, 12)}… — 산식 파일이 바뀌면 골든 스냅샷을 다시 찍고 사유를 docs/exe-golden/FormEstimateView.md 에 기록)`);

  console.log('\n=== 2) 운영 DB 총매출 (GetData, 전 요일·전 거래처) ===');
  if (!loadEnv()) {
    skip++;
    console.log('  - SKIP: .env.local(DB_SERVER) 없음 — DB 비교 생략');
  } else {
    const sql = (await import('mssql')).default;
    const { sqlEstimateGetData } = await import('../lib/exeEstimateViewSql.js');
    const pool = await sql.connect({
      server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
      database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 180000 },
    });
    try {
      for (const [week, expected] of Object.entries(fixture.weeks)) {
        const q = sqlEstimateGetData({ orderYearWeek: week, custKey: null, weekDayIn: '1,2,3,4,5,6,7' });
        assert(`${week} 산식은 SELECT/WITH 만`, /^\s*WITH|^\s*SELECT/i.test(q) && !/\b(UPDATE|DELETE|INSERT|MERGE)\b/i.test(q));
        const r = await pool.request().input('orderYearWeek', sql.NVarChar, week).query(q);
        const total = Math.round(r.recordset.reduce((s, x) => s + Number(x.totalAmount || 0), 0));
        assert(`${week} 총매출 ${expected.totalAmount.toLocaleString('ko-KR')}원 동일`, total === expected.totalAmount, `(현재 ${total.toLocaleString('ko-KR')}원, 차이 ${(total - expected.totalAmount).toLocaleString('ko-KR')})`);
        assert(`${week} 거래처 수 ${expected.customers}`, r.recordset.length === expected.customers, `(현재 ${r.recordset.length})`);
      }
    } finally {
      await pool.close();
    }
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail / ${skip} skip`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
