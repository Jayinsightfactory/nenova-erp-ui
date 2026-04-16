// pages/api/freight/[freightKey].js — 저장된 스냅샷 조회/삭제
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  const { freightKey } = req.query;
  const fk = parseInt(freightKey);
  if (!fk) return res.status(400).json({ success:false, error:'freightKey 필수' });

  try {
    if (req.method === 'GET') {
      const [h, d] = await Promise.all([
        query(`SELECT * FROM FreightCost WHERE FreightKey=@fk AND isDeleted=0`, { fk: { type: sql.Int, value: fk } }),
        query(`SELECT * FROM FreightCostDetail WHERE FreightKey=@fk ORDER BY SortOrder`, { fk: { type: sql.Int, value: fk } }),
      ]);
      if (h.recordset.length === 0) return res.status(404).json({ success:false, error:'스냅샷 없음' });
      return res.status(200).json({ success: true, header: h.recordset[0], details: d.recordset });
    }
    if (req.method === 'DELETE') {
      await query(
        `UPDATE FreightCost SET isDeleted=1, UpdateID=@uid, UpdateDtm=GETDATE() WHERE FreightKey=@fk`,
        { fk: { type: sql.Int, value: fk }, uid: { type: sql.NVarChar, value: req.user.userId } }
      );
      return res.status(200).json({ success: true });
    }
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success:false, error: err.message });
  }
});
