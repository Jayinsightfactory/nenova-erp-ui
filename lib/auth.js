// lib/auth.js — JWT 인증
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'nenova2026secretkey';

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
        return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
      }
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ success: false, error: '인증이 만료되었습니다. 다시 로그인하세요.' });
    }
    // ── 핸들러 실행 (예외 시 JSON 반환, HTML 500 방지)
    try {
      return await handler(req, res);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

export function createToken(user) {
  return jwt.sign(
    { userId: user.UserID, userName: user.UserName, authority: user.Authority, deptName: user.DeptName },
    SECRET,
    { expiresIn: '8h' }
  );
}
