// lib/auth.js — JWT 인증
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { trackApiCall } from './apiLogger';
import activityHttp from './userActivityHttp.cjs';
import { applyEffectiveWebAccess, effectiveAuthority } from './userAccess';
import deviceSession from './rememberDeviceSession.cjs';

const DEV_ONLY_JWT_SECRET = 'nenova-dev-only-secret-change-me';

export function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return DEV_ONLY_JWT_SECRET;
}


export function withAuth(handler) {
  return async (req, res) => {
    // ── 인증 검사
    try {
      let token = req.cookies?.nenovaToken;
      if (!token) {
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ')) token = auth.slice(7);
      }
      if (!token) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="nenovaweb"');
        return res.status(401).json({
          success: false,
          error: '로그인이 필요합니다.',
          hint: 'Cookie: nenovaToken=<JWT> 또는 Authorization: Bearer <JWT>. 토큰은 POST /api/auth/login 으로 발급.',
        });
      }
      const svc = resolveServiceUser(bearerOf(req));
      req.user = svc || (deviceSession.isDeviceToken(token)
        ? await verifyDeviceCookie(req, res, token)
        : applyEffectiveWebAccess(jwt.verify(token, getJwtSecret())));
      if (!req.user) throw new Error('Invalid session');
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer realm="nenovaweb", error="invalid_token"');
      return res.status(401).json({
        success: false,
        error: '인증이 만료되었습니다. 다시 로그인하세요.',
        hint: 'POST /api/auth/login 으로 새 토큰 발급 후 재시도.',
      });
    }
    // ── API 호출 추적 (챗봇 학습용)
    trackApiCall(req.user?.userId, req.url);
    activityHttp.attachRequestAudit(req, res, req.user);
    // ── 핸들러 실행 (예외 시 JSON 반환, HTML 500 방지)
    try {
      return await handler(req, res);
    } catch (err) {
      console.error('[withAuth] handler error:', req.url, err);
      return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
  };
}

// (아래 두 helper 는 withAuth 뒤·getServerSideProps 주석 앞에 둔다: weekdayPageNote 테스트가 그 구간만 잘라 평가한다)
// ── 서비스 토큰(MOYI FDE 등 사장님 대행 자동화) ───────────────────────────
// 로그인 JWT 대신 서버 env NENOVAWEB_SERVICE_TOKEN 과 같은 값을 Bearer 로 보내면
// 사장님 계정(nenovaSS3, 권한 1)으로 동작한다. 사람이 매번 로그인해 토큰을 발급할 필요가 없다.
// 감사 구분: userName='MOYI FDE', service=true. 토큰은 서버 env 에만 둔다(코드/로그 노출 금지).
const SERVICE_USER_ID = 'nenovaSS3';
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  if (!x.length || x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}
function resolveServiceUser(token) {
  const expected = process.env.NENOVAWEB_SERVICE_TOKEN;
  if (!expected || !token || !safeEqual(token, expected)) return null;
  return { userId: SERVICE_USER_ID, userName: 'MOYI FDE', authority: 1, deptName: '대표', accountActive: true, service: true };
}
function bearerOf(req) {
  const auth = req?.headers?.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

// getServerSideProps 등 페이지 서버측에서 쓰는 토큰 검증 (withAuth 의 페이지판).
// 성공 시 JWT payload({ userId, userName, authority, deptName }) 반환, 실패 시 null.
export async function verifyReqUser(req, res) {
  try {
    let token = req?.cookies?.nenovaToken;
    if (!token) {
      const auth = req?.headers?.authorization;
      if (auth?.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token && req?.headers?.cookie) {
      const m = req.headers.cookie.match(/(?:^|;\s*)nenovaToken=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (!token) return null;
    return resolveServiceUser(bearerOf(req)) || (deviceSession.isDeviceToken(token)
      ? await verifyDeviceCookie(req, res, token)
      : applyEffectiveWebAccess(jwt.verify(token, getJwtSecret())));
  } catch {
    return null;
  }
}

export { resolveServiceUser, SERVICE_USER_ID };

export function deviceSessionStore() {
  return deviceSession.createStore({ secret: getJwtSecret() });
}

async function verifyDeviceCookie(req, res, token) {
  // Persistent credentials are browser cookies, never a replacement automation Bearer token.
  const cookie = req.cookies?.nenovaToken || (req.headers?.cookie || '').match(/(?:^|;\s*)nenovaToken=([^;]+)/)?.[1];
  if (cookie !== token) return null;
  // Existing desktop cookie-change listener stops/hides work views. Keep its
  // original 400-day cookie fixed instead of interrupting work with renewal.
  const desktop = /(?:^|\s)NenovaDesktop\//.test(req.headers?.['user-agent'] || '');
  const result = await deviceSessionStore().authenticate(token, async userId => {
    const { query, sql } = await import('./db');
    const rows = await query('SELECT UserID, UserName, Password, Authority, DeptName, isDeleted FROM UserInfo WHERE UserID=@id', {id:{type:sql.NVarChar,value:userId}});
    return rows.recordset?.[0];
  }, {renew: !desktop});
  if (!result) return null;
  if (result.renewed && res?.setHeader) {
    const previous = res.getHeader?.('Set-Cookie');
    res.setHeader('Set-Cookie', [...(previous ? (Array.isArray(previous) ? previous : [previous]) : []), deviceSession.sessionCookie(token, deviceSession.MAX_AGE)]);
  }
  const user = result.user;
  return {userId:user.UserID,userName:user.UserName,authority:effectiveAuthority(user),deptName:user.DeptName,accountActive:true};
}

export function createToken(user) {
  return jwt.sign(
    { userId: user.UserID, userName: user.UserName, authority: effectiveAuthority(user), deptName: user.DeptName, accountActive: user.isDeleted !== true },
    getJwtSecret(),
    { expiresIn: '8h' }
  );
}
