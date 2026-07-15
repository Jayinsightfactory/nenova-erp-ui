// pages/api/auth/login.js
import { query, sql } from '../../../lib/db';
import { createToken } from '../../../lib/auth';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const attempts = global.__nenovaLoginAttempts || new Map();
global.__nenovaLoginAttempts = attempts;

function loginAttemptKey(req, userId) {
  const forwardedFor = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  const ip = forwardedFor || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${String(userId || '').toLowerCase()}`;
}

function getAttempt(key) {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.expiresAt <= now) {
    const fresh = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
    attempts.set(key, fresh);
    return fresh;
  }
  return cur;
}

function recordFailure(key) {
  const cur = getAttempt(key);
  cur.count += 1;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // alias: userId(웹 표준) / username(외부 봇/에이전트) / id(레거시) 모두 허용
  const body = req.body || {};
  const userId   = body.userId || body.username || body.id || null;
  const password = body.password || body.pwd || null;
  if (!userId || !password) {
    return res.status(400).json({
      success: false,
      error: '아이디와 비밀번호를 입력하세요.',
      hint: 'POST { userId|username, password } 또는 { id, password }',
    });
  }
  const attemptKey = loginAttemptKey(req, userId);
  if (getAttempt(attemptKey).count >= LOGIN_MAX_FAILURES) {
    return res.status(429).json({ success: false, error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }

  try {
    const result = await query(
      `SELECT UserID, UserName, Password, Authority, DeptName, isDeleted
       FROM UserInfo WHERE UserID = @id`,
      { id: { type: sql.NVarChar, value: userId } }
    );

    const user = result.recordset[0];
    if (!user || user.isDeleted) {
      recordFailure(attemptKey);
      return res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    if (user.Password !== password) {
      recordFailure(attemptKey);
      return res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = createToken(user);
    attempts.delete(attemptKey);
    const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';

    res.setHeader('Set-Cookie',
      `nenovaToken=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict${secureCookie}`
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        userId: user.UserID,
        userName: user.UserName,
        authority: user.Authority,
        deptName: user.DeptName,
      },
    });
  } catch (err) {
    console.error('로그인 오류:', err);
    return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
}
