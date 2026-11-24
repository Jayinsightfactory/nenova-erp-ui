// 자동 주문 실행기 requestId 원장. 웹 전용 테이블(ERP 원장 무관). 멱등(IF NOT EXISTS), 다른 DDL 없음.
// 기본은 DRY RUN. 실제 적용은 --apply (사용자 승인 후에만).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATION_SQL = `
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.WebOrderExecLedger') AND type = N'U')
BEGIN
  CREATE TABLE dbo.WebOrderExecLedger (
    LedgerKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebOrderExecLedger PRIMARY KEY,
    RequestId NVARCHAR(120) NOT NULL CONSTRAINT UQ_WebOrderExecLedger_RequestId UNIQUE,
    Kind NVARCHAR(10) NOT NULL,
    CustKey INT NOT NULL,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    Status NVARCHAR(20) NOT NULL,
    PlanJson NVARCHAR(MAX) NULL,
    ResultJson NVARCHAR(MAX) NULL,
    ErrorText NVARCHAR(1000) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebOrderExecLedger_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 NULL
  );
END
`;
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  if (!process.argv.includes('--apply')) { console.log('DRY RUN: dbo.WebOrderExecLedger\n' + MIGRATION_SQL); process.exit(0); }
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]; }
  for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!process.env[key]) throw new Error(`${key}가 없어 적용을 중단했습니다.`);
  const { getPool } = await import('../lib/db.js');
  const pool = await getPool();
  try {
    await pool.request().batch(MIGRATION_SQL);
    const r = await pool.request().query("SELECT OBJECT_ID(N'dbo.WebOrderExecLedger',N'U') Id");
    if (!r.recordset?.[0]?.Id) throw new Error('WebOrderExecLedger migration verification failed');
    console.log('WebOrderExecLedger schema ready');
  } finally { await pool.close(); }
}
