import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyEffectiveWebAccess, effectiveAuthority, hasFullWebAccess, isAdminUser } from '../lib/userAccess.js';

assert.equal(hasFullWebAccess({ userId: 'nenovaSS3' }), true);
assert.equal(hasFullWebAccess({ UserID: 'NENOVASS3' }), true);
assert.equal(effectiveAuthority({ UserID: 'nenovaSS3', Authority: 6 }), 1);
assert.equal(effectiveAuthority({ UserID: 'sales01', Authority: 6 }), 6);
assert.equal(isAdminUser({ userId: 'nenovaSS3', authority: 6 }), true);
assert.equal(isAdminUser({ userId: 'sales01', authority: 6, deptName: '영업부' }), false);
assert.equal(applyEffectiveWebAccess({ userId: 'nenovaSS3', authority: 6 }).authority, 1);

const authSource = fs.readFileSync(new URL('../lib/auth.js', import.meta.url), 'utf8');
const loginSource = fs.readFileSync(new URL('../pages/api/auth/login.js', import.meta.url), 'utf8');
assert.match(authSource, /applyEffectiveWebAccess\(jwt\.verify/,
  '기존 로그인 토큰도 다음 API 요청부터 관리자 권한으로 승격해야 한다');
assert.match(authSource, /authority:\s*effectiveAuthority\(user\)/,
  '새 로그인 JWT도 관리자 권한이어야 한다');
assert.match(loginSource, /authority:\s*effectiveAuthority\(user\)/,
  '로그인 응답의 사용자 정보도 관리자 권한이어야 한다');

console.log('nenovaSS3 admin access tests passed');
