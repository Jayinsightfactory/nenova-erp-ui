import fs from 'node:fs/promises';
import path from 'node:path';
import {
  REPO_ROOT,
  acceptanceMarkdown,
  runProfitReportAcceptance,
} from '../__tests__/helpers/profitReportAcceptance.mjs';

const strict = process.argv.includes('--strict');
const outputDir = path.join(REPO_ROOT, '.verify', 'outputs');
const reportPath = path.join(REPO_ROOT, 'docs', 'work-reports', '2026-08-13_profit-report-weeks-22-28-acceptance.md');
const jsonPath = path.join(outputDir, 'profit-report-weeks-22-28-acceptance.json');
const result = await runProfitReportAcceptance();
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, acceptanceMarkdown(result), 'utf8');

console.log(`profit report acceptance: ${result.overallStatus}`);
console.log(`PASS ${result.summary.pass} / INPUT_REQUIRED ${result.summary.inputRequired} / UNVERIFIED ${result.summary.unverified} / FAIL ${result.summary.fail}`);
console.log(path.relative(REPO_ROOT, jsonPath));
console.log(path.relative(REPO_ROOT, reportPath));

if (result.summary.fail > 0) process.exitCode = 1;
else if (strict && (result.summary.inputRequired > 0 || result.summary.unverified > 0)) process.exitCode = 2;
