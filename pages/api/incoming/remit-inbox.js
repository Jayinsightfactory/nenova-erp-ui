// pages/api/incoming/remit-inbox.js
// 송금 자동 인식 대기함 API (수입부/경영지원/사장)
//   GET                      → { rows:[PENDING…], farms:[원장 농장명] }
//   POST { action:'confirm', key, farmName, weeks?, amountUSD? } → 확정(정산 잔액 반영)
//   POST { action:'reject', key }                                → 거절
//   POST { action:'rescan' }  (사장만) → 드라이브의 송금신청 파일 전부 다시 읽어 대기함 채움(과거 24개 파일 소급)
import fs from 'fs';
import path from 'path';
import { query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { listInbox, confirmInbox, rejectInbox, importRemitFile } from '../../../lib/farmRemitInbox';
import { REMIT_FILE_RE } from '../../../lib/farmRemitImport';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [rows, farms] = await Promise.all([listInbox({ status: String(req.query.status || 'PENDING') }), query(`SELECT DISTINCT FarmName FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 AND FarmName<>N'' ORDER BY FarmName`)]);
      return res.status(200).json({ success: true, rows, farms: farms.recordset.map((x) => x.FarmName) });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'confirm') return res.status(200).json({ success: true, ...(await confirmInbox({ key: b.key, farmName: b.farmName, weeks: b.weeks, amountUSD: b.amountUSD, user: req.user })) });
      if (b.action === 'reject') return res.status(200).json({ success: true, ...(await rejectInbox({ key: b.key, user: req.user })) });
      if (b.action === 'rescan') {
        if (!isOrbitReportViewer(req.user)) return res.status(403).json({ success: false, error: '사장만 실행할 수 있습니다' });
        // 업무 드라이브 색인에서 송금신청 파일만 골라 최신 버전 기준으로 처리
        const root = path.join(process.cwd(), 'data', 'drive');
        let idx = []; try { idx = fs.readFileSync(path.join(root, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
        const latest = new Map(); for (const r of idx) if (r.type !== 'download' && r.id) latest.set(r.id, r);
        const files = [...latest.values()].filter((r) => !r.deleted && REMIT_FILE_RE.test(r.filename || '') && /\.xlsx?$/i.test(r.filename || ''));
        const out = { files: files.length, parsed: 0, inserted: 0, updated: 0, skipped: 0, unmatched: 0, errors: [] };
        for (const f of files) {
          try { const abs = path.join(root, f.rel); if (!abs.startsWith(root) || !fs.existsSync(abs)) continue; const r = await importRemitFile({ buffer: fs.readFileSync(abs), fileId: f.id, fileName: f.filename, by: 'rescan:' + (req.user?.userId || '') }); for (const k of ['parsed', 'inserted', 'updated', 'skipped', 'unmatched']) out[k] += r[k]; }
          catch (e) { out.errors.push(`${f.filename}: ${e.message}`); }
        }
        return res.status(200).json({ success: true, ...out });
      }
      return res.status(400).json({ success: false, error: 'action 필요' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
