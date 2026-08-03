export function moyiBase() {
  return (process.env.MOYI_API_BASE || 'https://api.nowlink.kr').replace(/\/$/, '');
}

export function tokenFrom(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith('moyiNenovaToken='));
  return match ? decodeURIComponent(match.slice('moyiNenovaToken='.length)) : '';
}

export async function forward(req, res, path, method = 'GET', body = undefined) {
  const token = tokenFrom(req);
  const headers = {'Content-Type': 'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;
  const upstream = await fetch(`${moyiBase()}${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await upstream.json().catch(() => ({}));
  res.status(upstream.status).json(data);
}
