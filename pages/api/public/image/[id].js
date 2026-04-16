// pages/api/public/image/[id].js
// 공개 이미지 엔드포인트 — 인증 없이 접근 가능 (워크 프리뷰용)
import { getPool } from '../../../../lib/db';
import sql from 'mssql';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || !/^[a-f0-9]{24}$/.test(id)) {
    return res.status(400).end('invalid id');
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(40), id)
      .query(`SELECT mime, data FROM _agent_images WHERE id = @id`);

    if (result.recordset.length === 0) {
      return res.status(404).end('not found');
    }

    const { mime, data } = result.recordset[0];
    res.setHeader('Content-Type', mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(Buffer.from(data));
  } catch (e) {
    return res.status(500).end(e.message);
  }
}
