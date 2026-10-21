// pages/api/auth/logout.js
import { deviceSessionStore } from '../../../lib/auth';
import deviceSession from '../../../lib/rememberDeviceSession.cjs';
export default function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({success:false}); }
  try { deviceSessionStore().revoke(req.cookies?.nenovaToken); }
  catch { return res.status(503).json({success:false,error:'로그아웃 처리를 완료하지 못했습니다. 다시 시도하세요.'}); }
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Set-Cookie', deviceSession.sessionCookie('',0));
  return res.status(200).json({ success: true });
}
