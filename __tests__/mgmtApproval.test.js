import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APPROVAL_TRANSITIONS, canTransition, assertTransition, assertSeparationOfDuty, APPROVAL_STATUS } from '../lib/mgmt/approvalPolicy.js';
import { MGMT_TABLES, mgmtMigrationPath, qualified } from '../lib/mgmt/schemaMeta.js';

// 상태기계: 역행 금지, 종결 상태 전환 없음
assert.deepEqual(Object.keys(APPROVAL_TRANSITIONS).sort(), [...APPROVAL_STATUS].sort());
assert.equal(canTransition('draft', 'requested'), true);
assert.equal(canTransition('requested', 'approved'), true);
assert.equal(canTransition('approved', 'applied'), true);
assert.equal(canTransition('approved', 'requested'), false);
assert.equal(canTransition('applied', 'cancelled'), false);
assert.equal(canTransition('rejected', 'approved'), false);
assert.throws(() => assertTransition('applied', 'draft'), /전환 불가/);

// 이중승인 최소 규칙: 요청자 본인 승인 금지
assert.throws(() => assertSeparationOfDuty({ RequestedBy: 'u1' }, 'u1', 'approved'), /본인/);
assert.doesNotThrow(() => assertSeparationOfDuty({ RequestedBy: 'u1' }, 'u2', 'approved'));
assert.doesNotThrow(() => assertSeparationOfDuty({ RequestedBy: 'u1' }, 'u1', 'cancelled'));

// DDL 파일과 테이블 목록 일치, web_mgmt 외 접근 차단
const ddl = fs.readFileSync(mgmtMigrationPath(), 'utf8');
for (const t of MGMT_TABLES) assert.match(ddl, new RegExp(`web_mgmt\\.${t}\\b`), `DDL에 ${t} 없음`);
assert.doesNotMatch(ddl, /\bdbo\.(OrderDetail|ShipmentDetail|Estimate|ProductStock)\b/, 'DDL이 ERP 원장을 참조');
assert.doesNotMatch(ddl, /ecount_work\./, 'DDL이 ecount_work 를 참조');
assert.match(ddl, /ApprovalRequest_NoHardDelete/);
assert.match(ddl, /ApprovalAudit_Immutable/);
assert.equal(qualified('ApprovalRequest'), 'web_mgmt.ApprovalRequest');
assert.throws(() => qualified('ShipmentDetail'), /금지/);
console.log('mgmt approval tests passed');
