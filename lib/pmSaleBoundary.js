// /pm(PM 사무실) ↔ 사내 전산 코드 경계 선언. 선례: lib/mgmt/boundary.js
// 목적: /pm 코드는 나중에 별도 판매 제품 저장소(nowlink)로 이식 예정이라,
//       사내 전산 모듈을 직접 import 하면 이식 비용이 쌓인다. CI에서 새 위반을 차단한다.
// 검사: __tests__/pmBoundary.test.js (npm run test:pm-boundary)
// 동결 목록(기존 위반): config/pm-boundary-allowlist.json — 새 위반만 실패시킨다.

import fs from 'node:fs';
import path from 'node:path';

// 판매 예정(PM) 소유 경로 — 이 파일들의 import 가 검사 대상
export const PM_OWNED_PATTERNS = [
  /^pages\/pm(\.js|\/)/,
  /^pages\/api\/pm\//,
  /^components\/pm\//,
  /^components\/pm3d\//,
  /^lib\/pm[A-Z0-9]/, // lib/pmAccount.js, lib/pm3dLayout.js … (preShipment* 등은 제외)
  /^lib\/pmSaleBoundary\.js$/,
];

// PM 코드가 import 해도 되는 범용(제품과 함께 이식 가능하거나 무해한) 모듈
export const GENERIC_ALLOWED_PATTERNS = [
  /^components\/MenuBackButton(\.js)?$/,
  /^styles\//,
];

export function isPmOwned(file) {
  const f = String(file || '').replace(/\\/g, '/');
  return PM_OWNED_PATTERNS.some((re) => re.test(f));
}

export function isGenericAllowed(file) {
  const f = String(file || '').replace(/\\/g, '/');
  return GENERIC_ALLOWED_PATTERNS.some((re) => re.test(f));
}

// import 대상 분류: 'ok' | 'violation'
// target 은 저장소 루트 기준 경로(확장자 유무 무관)
export function classifyImportTarget(target) {
  const t = String(target || '').replace(/\\/g, '/').replace(/\.(js|cjs|mjs|json|jsx|ts|tsx)$/, '');
  const probe = (f) => isPmOwned(f) || isPmOwned(`${f}.js`) || isGenericAllowed(f) || isGenericAllowed(`${f}.js`);
  if (probe(t)) return 'ok';
  return 'violation';
}

const IMPORT_RE = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

// 소스 파일 하나에서 상대 import 를 저장소 루트 기준 경로로 추출
export function extractRelativeImports(file, source) {
  const dir = path.posix.dirname(String(file).replace(/\\/g, '/'));
  const out = [];
  let m;
  while ((m = IMPORT_RE.exec(String(source))) !== null) {
    const spec = m[1];
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue; // 패키지는 범용으로 간주
    out.push(path.posix.normalize(path.posix.join(dir, spec)));
  }
  return out;
}

// repoRoot 전체를 스캔해 "pmFile -> target" 위반 edge 목록을 돌려준다
export function scanPmBoundary(repoRoot, files) {
  const violations = [];
  for (const file of files) {
    if (!isPmOwned(file)) continue;
    if (!/\.(js|cjs|mjs|jsx|ts|tsx)$/.test(file)) continue;
    const abs = path.join(repoRoot, file);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const target of extractRelativeImports(file, src)) {
      if (classifyImportTarget(target) === 'violation') {
        violations.push(`${file} -> ${target}`);
      }
    }
  }
  return violations.sort();
}

export function loadAllowlist(repoRoot) {
  const p = path.join(repoRoot, 'config', 'pm-boundary-allowlist.json');
  if (!fs.existsSync(p)) return [];
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(data.frozen) ? data.frozen : [];
}

// 동결 목록에 없는 새 위반만 돌려준다
export function findNewViolations(violations, allowlist) {
  const frozen = new Set(allowlist);
  return violations.filter((v) => !frozen.has(v));
}

export const VIOLATION_GUIDE =
  '판매 예정 코드(/pm)는 사내 모듈 직접 import 금지, 서버 데이터는 API(fetch) 경유. ' +
  '기존 위반은 config/pm-boundary-allowlist.json 에 동결되어 있고, 새 위반은 추가할 수 없다. ' +
  '같은 판매군(lib/pm*, components/pm*, pages/pm*, pages/api/pm/*)과 범용 유틸만 import 가능.';
