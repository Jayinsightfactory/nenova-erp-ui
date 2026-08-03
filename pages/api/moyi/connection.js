import { forward } from './_proxy';
export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({message: 'Method not allowed'});
  const result = await forward(req, res, '/integrations/nenovaweb/connection', 'DELETE');
  res.setHeader('Set-Cookie', 'moyiNenovaToken=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return result;
}
