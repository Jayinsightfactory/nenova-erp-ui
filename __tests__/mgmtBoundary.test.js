// mgmt ↔ ECOUNT 이관 경계 검사. 변경 파일(origin/master 또는 HEAD^ 기준)에 이관 소유 경로가 있으면 실패.
// 사용: node __tests__/mgmtBoundary.test.js [--changed-from origin/master]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isEcountOwned, isMgmtOwned, violatesEcountBoundary, assertMgmtSqlReadOnlyOutsideSchema } from '../lib/mgmt/boundary.js';

assert.equal(isEcountOwned('lib/ecountWorkbench.cjs'), true);
assert.equal(isEcountOwned('pages/api/ecount/workspace.js'), true);
assert.equal(isEcountOwned('components/EcountPreviewShell.js'), true);
assert.equal(isEcountOwned('docs/ecount-migration/parity-contract.md'), true);
assert.equal(isEcountOwned('__tests__/ecountParity.test.cjs'), true);
assert.equal(isEcountOwned('lib/mgmt/schema.js'), false);
assert.equal(isEcountOwned('docs/ERP_GAP_ANALYSIS_2026-10.md'), false);
assert.equal(isMgmtOwned('pages/api/mgmt/approvals.js'), true);
assert.equal(isMgmtOwned('docs/contracts/management-controls.json'), true);

assert.deepEqual(violatesEcountBoundary(['lib/mgmt/a.js', 'lib/ecount.js', 'components/Layout.js']), ['lib/ecount.js']);

assert.throws(() => assertMgmtSqlReadOnlyOutsideSchema('UPDATE ecount_work.Head SET x=1'), /ecount_work/);
assert.throws(() => assertMgmtSqlReadOnlyOutsideSchema('INSERT INTO dbo.ShipmentDetail (a) VALUES (1)'), /ERP 원장/);
assert.throws(() => assertMgmtSqlReadOnlyOutsideSchema('DELETE FROM Estimate WHERE 1=1'), /ERP 원장/);
assert.ok(assertMgmtSqlReadOnlyOutsideSchema('SELECT * FROM ecount_work.Head; INSERT INTO web_mgmt.ApprovalAudit (RequestId, ToStatus) VALUES (1, \'draft\')'));

// 실제 diff 검사(옵션)
const at = process.argv.indexOf('--changed-from');
if (at >= 0) {
  const base = process.argv[at + 1];
  const names = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const touchedMgmt = names.some((f) => isMgmtOwned(f));
  if (touchedMgmt) {
    const bad = violatesEcountBoundary(names);
    assert.equal(bad.length, 0, `mgmt 변경이 ECOUNT 이관 소유 파일을 건드렸습니다: ${bad.join(', ')}`);
  }
}
console.log('mgmt boundary tests passed');
