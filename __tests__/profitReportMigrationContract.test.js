const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts', 'apply-profit-report-evidence-migrations.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');
const evidenceSql = fs.readFileSync(path.join(root, 'docs', 'migrations', '2026-08-13_profit_report_evidence_rag.sql'), 'utf8');
const rateSql = fs.readFileSync(path.join(root, 'docs', 'migrations', '2026-08-13_web_customs_rate_history.sql'), 'utf8');

assert.match(script, /process\.argv\.includes\('--apply'\)/, '기본 실행은 미리보기여야 합니다.');
assert.match(script, /2026-08-13_profit_report_evidence_rag\.sql/);
assert.match(script, /2026-08-13_web_customs_rate_history\.sql/);
assert.match(script, /WebStockPriceEvidence/);
assert.match(script, /WebCustomsRateHistory/);
assert.match(script, /ReportProvenance/);
assert.match(evidenceSql, /SET XACT_ABORT ON;[\s\S]*BEGIN TRANSACTION;[\s\S]*COMMIT TRANSACTION;/i);
assert.match(rateSql, /SET XACT_ABORT ON;[\s\S]*BEGIN TRANSACTION;[\s\S]*COMMIT TRANSACTION;/i);
assert.match(workflow, /npm ci --omit=dev[\s\S]*node scripts\/apply-profit-report-evidence-migrations\.mjs --apply[\s\S]*atomic build swap/,
  '명시 승인된 마이그레이션은 서버 의존성 설치 후·검증된 CI 산출물 교체 전에 실행해야 합니다.');

console.log('profit report deployment migration contract tests passed');
