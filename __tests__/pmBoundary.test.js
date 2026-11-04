// 판매 예정(/pm) 코드 경계 검사. /pm 코드가 사내 전산 모듈을 직접 import 하면
// (동결 목록 외 신규 건에 한해) 실패한다. 선례: __tests__/mgmtBoundary.test.js
// 사용: node __tests__/pmBoundary.test.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPmOwned,
  isGenericAllowed,
  classifyImportTarget,
  extractRelativeImports,
  scanPmBoundary,
  loadAllowlist,
  findNewViolations,
  VIOLATION_GUIDE,
} from '../lib/pmSaleBoundary.js';

// 소유 판정
assert.equal(isPmOwned('pages/pm.js'), true);
assert.equal(isPmOwned('pages/pm/radar.js'), true);
assert.equal(isPmOwned('pages/api/pm/staff.js'), true);
assert.equal(isPmOwned('components/pm/IsoScene.js'), true);
assert.equal(isPmOwned('components/pm3d/Scene3D.js'), true);
assert.equal(isPmOwned('lib/pmAccount.js'), true);
assert.equal(isPmOwned('lib/pm3dLayout.js'), true);
assert.equal(isPmOwned('lib/preShipment.js'), false); // pm 접두사 아님
assert.equal(isPmOwned('pages/pre-shipment.js'), false);
assert.equal(isPmOwned('lib/db.js'), false);

// 범용 허용
assert.equal(isGenericAllowed('components/MenuBackButton'), true);
assert.equal(isGenericAllowed('lib/auth'), false);

// 대상 분류: 같은 판매군/범용은 ok, 사내 모듈은 violation
assert.equal(classifyImportTarget('lib/pmThemes'), 'ok');
assert.equal(classifyImportTarget('components/pm/ui'), 'ok');
assert.equal(classifyImportTarget('lib/pmSceneMaps.json'), 'ok');
assert.equal(classifyImportTarget('components/MenuBackButton'), 'ok');
assert.equal(classifyImportTarget('lib/db'), 'violation');
assert.equal(classifyImportTarget('lib/auth'), 'violation');
assert.equal(classifyImportTarget('lib/shipmentEstimateGuard'), 'violation');
assert.equal(classifyImportTarget('pages/api/shipment/distribute'), 'violation');

// import 추출(상대 경로만, 패키지는 무시)
assert.deepEqual(
  extractRelativeImports('pages/pm/radar.js', "import a from '../../lib/auth';\nimport React from 'react';\nconst b = require('../../lib/pmZoom');"),
  ['lib/auth', 'lib/pmZoom']
);

// 동결 목록 비교: 새 위반만 반환
assert.deepEqual(findNewViolations(['a -> b', 'c -> d'], ['a -> b']), ['c -> d']);

// 실제 저장소 전수 스캔: 동결 목록 외 새 위반 0이어야 함
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const violations = scanPmBoundary(repoRoot, files);
const allowlist = loadAllowlist(repoRoot);
const fresh = findNewViolations(violations, allowlist);
assert.equal(
  fresh.length,
  0,
  `새 /pm 경계 위반 ${fresh.length}건:\n${fresh.join('\n')}\n${VIOLATION_GUIDE}`
);

// 동결 목록이 고쳐진(사라진) 위반을 계속 품고 있으면 알려만 준다(실패 아님)
const stale = allowlist.filter((f) => !violations.includes(f));
if (stale.length) console.log(`(정리 가능) 더 이상 존재하지 않는 동결 항목 ${stale.length}건: ${stale.join(', ')}`);

console.log(`pm boundary tests passed (frozen ${allowlist.length}, current ${violations.length}, new 0)`);
