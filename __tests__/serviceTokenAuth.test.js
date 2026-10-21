// 서비스 토큰(NENOVAWEB_SERVICE_TOKEN) — 로그인 JWT 없이 사장님 대행(MOYI FDE)으로 인증되는지
// lib/auth.js 는 확장자 없는 Next 스타일 import 라 소스를 읽어 의존성을 주입해 평가한다(저장소 관례).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import deviceSession from '../lib/rememberDeviceSession.cjs';

const src = fs.readFileSync(new URL('../lib/auth.js', import.meta.url), 'utf8');
const body = src
  .replace(/^import .*$/gm, '')
  .replace(/^export \{.*$/gm, '')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ')
  .replace(/^export async function /gm, 'async function ')
  + '\nreturn { resolveServiceUser, verifyReqUser, withAuth, SERVICE_USER_ID };';
const jwt = { verify: (t) => { if (t === 'good-jwt') return { userId: 'sales01', authority: 6 }; throw new Error('bad jwt'); } };
const load = () => new Function('jwt', 'crypto', 'trackApiCall', 'activityHttp', 'applyEffectiveWebAccess', 'effectiveAuthority', 'deviceSession', body)(
  jwt, crypto, () => {}, { attachRequestAudit() {} }, (u) => ({ ...u, authority: u.authority }), (u) => u.authority, deviceSession);

process.env.NENOVAWEB_SERVICE_TOKEN = 'test-service-token-abc';
process.env.JWT_SECRET = 'test-jwt-secret';
const { resolveServiceUser, verifyReqUser, withAuth, SERVICE_USER_ID } = load();

// 1) 토큰 일치 → 사장님 계정(권한1)·service 표시
const u = resolveServiceUser('test-service-token-abc');
assert.equal(u.userId, SERVICE_USER_ID);
assert.equal(SERVICE_USER_ID, 'nenovaSS3');
assert.equal(u.authority, 1);
assert.equal(u.service, true);
assert.equal(u.userName, 'MOYI FDE');

// 2) 불일치·빈값·미설정 → null
assert.equal(resolveServiceUser('test-service-token-abd'), null);
assert.equal(resolveServiceUser(''), null);
delete process.env.NENOVAWEB_SERVICE_TOKEN;
assert.equal(resolveServiceUser('test-service-token-abc'), null, '서버 미설정이면 서비스 토큰 경로 없음');
process.env.NENOVAWEB_SERVICE_TOKEN = 'test-service-token-abc';

// 3) verifyReqUser: Bearer 서비스 토큰이면 JWT 검증 없이 통과, 기존 JWT 경로 보존, 엉뚱한 Bearer 는 null
assert.equal((await verifyReqUser({ headers: { authorization: 'Bearer test-service-token-abc' } })).userId, SERVICE_USER_ID);
assert.equal((await verifyReqUser({ headers: { authorization: 'Bearer good-jwt' } })).userId, 'sales01');
assert.equal(await verifyReqUser({ headers: { authorization: 'Bearer not-a-jwt' } }), null);
assert.equal(await verifyReqUser({ headers: {} }), null);

// 4) withAuth: 서비스 토큰 요청은 핸들러에 사장님 대행 사용자로 전달, 쿠키 JWT 경로도 그대로
const res = () => { const r = { code: 200, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const seen = [];
const h = withAuth(async (req, rs) => { seen.push(req.user); return rs.status(200).json({ ok: true }); });
let r = res(); await h({ headers: { authorization: 'Bearer test-service-token-abc' }, url: '/api/x' }, r);
assert.equal(r.code, 200); assert.equal(seen[0].userId, SERVICE_USER_ID); assert.equal(seen[0].service, true);
r = res(); await h({ cookies: { nenovaToken: 'good-jwt' }, headers: {}, url: '/api/x' }, r);
assert.equal(r.code, 200); assert.equal(seen[1].userId, 'sales01');
r = res(); await h({ headers: { authorization: 'Bearer not-a-jwt' }, url: '/api/x' }, r);
assert.equal(r.code, 401);
console.log('service token auth tests passed');
