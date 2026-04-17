// pages/api/log.js — 프론트엔드에서 AppLog에 기록
import { query, sql } from '../../lib/db';
import { withAuth } from '../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { category = 'front', step = '', detail = '' } = req.body || {};
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError) VALUES (@cat, @step, @detail, 0)`,
      { cat: { type: sql.NVarChar, value: String(category) },
        step: { type: sql.NVarChar, value: String(step) },
        detail: { type: sql.NVarChar, value: String(detail) } }
    );
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
