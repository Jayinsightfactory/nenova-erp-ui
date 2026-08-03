import { forward } from './_proxy';
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({message: 'Method not allowed'});
  return forward(req, res, '/integrations/nenovaweb/recipients', 'PUT', req.body || {});
}
