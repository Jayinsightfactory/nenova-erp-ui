// pages/api/incoming/freight-calc.js — AWB 운임 계산기 결과 저장/조회(웹 전용 파일). 전산 DB 접근 없음.
//   GET  ?year=&week=                → { rows:[계산 결과…] }
//   POST { year, week, awb, inputs, groups, farms, checks } → 저장(같은 AWB 재저장은 덮어쓰기, 이전 건 history)
//   POST { year, week, awb, deleted:true } → 삭제
import { withAuth } from '../../../lib/auth';
import { readCalcs, writeCalcs, saveCalc, removeCalc, listCalcs } from '../../../lib/awbFreightCalc';

export default withAuth(async function handler(req, res) {
  const user = req.user || {};
  try {
    if (req.method === 'GET') return res.status(200).json({ success: true, rows: listCalcs(readCalcs(), { year: req.query.year, week: req.query.week }) });
    if (req.method === 'POST') {
      const b = req.body || {}; const db = readCalcs();
      if (!/^\d{4}$/.test(String(b.year || '')) || !b.week || !b.awb) return res.status(400).json({ success: false, error: 'year·week·awb 필요' });
      if (b.deleted) { const ok = removeCalc(db, b.year, b.week, b.awb); writeCalcs(db); return res.status(ok ? 200 : 404).json({ success: ok }); }
      if (!Array.isArray(b.farms) || !b.farms.length) return res.status(400).json({ success: false, error: 'farms 분배 결과 필요' });
      const row = saveCalc(db, b, user.userId || ''); writeCalcs(db);
      return res.status(200).json({ success: true, row });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
