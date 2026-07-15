// pages/api/auth/logout.js
export default function handler(req, res) {
  const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `nenovaToken=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secureCookie}`);
  return res.status(200).json({ success: true });
}
