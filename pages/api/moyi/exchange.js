import { moyiBase } from './_proxy';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({message: 'Method not allowed'});
  const upstream = await fetch(`${moyiBase()}/integrations/nenovaweb/exchange`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(req.body || {})
  });
  const data = await upstream.json().catch(() => ({}));
  if (upstream.ok && data.access_token) {
    res.setHeader('Set-Cookie', `moyiNenovaToken=${encodeURIComponent(data.access_token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    delete data.access_token;
  }
  res.status(upstream.status).json(data);
}
