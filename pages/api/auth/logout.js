// pages/api/auth/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie', 'nenovaToken=; HttpOnly; Path=/; Max-Age=0');
  return res.status(200).json({ success: true });
}
