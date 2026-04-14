// pages/api/auth/me.js — 현재 로그인 사용자 정보 반환
import { withAuth } from '../../../lib/auth';

async function handler(req, res) {
  // withAuth 가 req.user 채워줌 (JWT payload)
  return res.status(200).json({
    success: true,
    user: {
      userId:    req.user?.userId,
      userName:  req.user?.userName,
      authority: req.user?.authority,
      deptName:  req.user?.deptName,
    },
  });
}

export default withAuth(handler);
