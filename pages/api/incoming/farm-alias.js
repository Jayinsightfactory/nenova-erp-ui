// pages/api/incoming/farm-alias.js — 농장명 별칭 사전(웹 전용 파일). 전산 테이블은 읽기만(WarehouseMaster.FarmName 목록).
//   GET                         → { aliases:[{alias,canonical,by,at}], suggestions:[{key,canonical,names[]}], farms:[...] }
//   POST { alias, canonical }   → 별칭 등록/변경     POST { alias, deleted:true } → 삭제
//   POST { group:[names...], canonical } → 그룹 한 번에 등록(제안 수락)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { readAliases, writeAliases, setAlias, removeAlias, suggestGroups } from '../../../lib/farmAlias';

export default withAuth(async function handler(req, res) {
  const user = req.user || {};
  try {
    if (req.method === 'GET') {
      const r = await query(`SELECT FarmName, COUNT(*) AS n, MAX(CONVERT(NVARCHAR(10), InputDate, 120)) AS lastInput FROM WarehouseMaster
                              WHERE ISNULL(isDeleted,0)=0 AND FarmName IS NOT NULL AND FarmName<>N'' AND InputDate >= @since GROUP BY FarmName ORDER BY MAX(InputDate) DESC`,
        { since: { type: sql.Date, value: new Date(Date.now() - 730 * 86400e3) } });
      const map = readAliases();
      const farms = r.recordset.map((x) => ({ farm: x.FarmName, n: x.n, lastInput: x.lastInput }));
      return res.status(200).json({ success: true, aliases: Object.values(map).sort((a, b) => a.canonical.localeCompare(b.canonical) || a.alias.localeCompare(b.alias)), suggestions: suggestGroups(farms.map((f) => f.farm), map), farms });
    }
    if (req.method === 'POST') {
      const b = req.body || {}; const map = readAliases(); const by = user.userId || '';
      if (b.alias && b.deleted) { removeAlias(map, b.alias); writeAliases(map); return res.status(200).json({ success: true }); }
      if (Array.isArray(b.group) && b.canonical) { for (const n of b.group) setAlias(map, n, b.canonical, by); writeAliases(map); return res.status(200).json({ success: true, n: b.group.length }); }
      if (b.alias && b.canonical) { setAlias(map, b.alias, b.canonical, by); writeAliases(map); return res.status(200).json({ success: true }); }
      return res.status(400).json({ success: false, error: 'alias·canonical 필요' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
