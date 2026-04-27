// pages/api/auth/login.js
import { query, sql } from '../../../lib/db';
import { createToken } from '../../../lib/auth';

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

  try {
    const result = await query(
      `SELECT UserID, UserName, Password, Authority, DeptName, isDeleted
       FROM UserInfo WHERE UserID = @id`,
      { id: { type: sql.NVarChar, value: userId } }
    );

    const user = result.recordset[0];
    if (!user || user.isDeleted) {
      return res.status(401).json({ success: false, error: '존재하지 않는 계정입니다.' });
    }
    if (user.Password !== password) {
      return res.status(401).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
    }

    const token = createToken(user);

    res.setHeader('Set-Cookie',
      `nenovaToken=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict`
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
    return res.status(500).json({ success: false, error: 'DB 연결 오류: ' + err.message });
  }
}
