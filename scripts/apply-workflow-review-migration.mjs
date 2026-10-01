// 직원 본인 업무흐름 확인(맞다/틀리다/수정) 저장 테이블. 웹 전용 테이블(ERP 원장 무관). 멱등.
// 기본은 DRY RUN. 실제 적용은 --apply (사용자 승인 후에만).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATION_SQL = `
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.WebWorkflowReview') AND type = N'U')
BEGIN
  CREATE TABLE dbo.WebWorkflowReview (
    ReviewKey INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WebWorkflowReview PRIMARY KEY,
    ErpUserId NVARCHAR(50) NOT NULL,
    OrbitUid NVARCHAR(100) NULL,
    PersonName NVARCHAR(100) NOT NULL,
    WorkflowName NVARCHAR(300) NOT NULL,
    Verdict NVARCHAR(10) NOT NULL CONSTRAINT CK_WebWorkflowReview_Verdict CHECK (Verdict IN (N'ok', N'fix', N'reject')),
    CorrectedSteps NVARCHAR(MAX) NULL,
    Comment NVARCHAR(1000) NULL,
    WorkflowGeneratedAt NVARCHAR(40) NULL,
    ReviewedAt DATETIME2 NOT NULL CONSTRAINT DF_WebWorkflowReview_ReviewedAt DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_WebWorkflowReview_User_Workflow UNIQUE (ErpUserId, WorkflowName)
  );
END
`;
if (!process.argv.includes('--apply')) { console.log('DRY RUN: dbo.WebWorkflowReview\n' + MIGRATION_SQL); process.exit(0); }
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]; }
for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!process.env[key]) throw new Error(`${key}가 없어 적용을 중단했습니다.`);
const { getPool } = await import('../lib/db.js');
const pool = await getPool();
try {
  await pool.request().batch(MIGRATION_SQL);
  const r = await pool.request().query("SELECT OBJECT_ID(N'dbo.WebWorkflowReview',N'U') Id");
  if (!r.recordset?.[0]?.Id) throw new Error('WebWorkflowReview migration verification failed');
  console.log('WebWorkflowReview schema ready');
} finally { await pool.close(); }
