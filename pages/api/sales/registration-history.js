// 판매등록 히스토리 API — 스냅샷 조회/수동생성/변경검사. 스냅샷 수정·삭제 경로 없음(불변).
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear, normalizeOrderWeek } from '../../../lib/orderUtils';
import {
  listSnapshots, getSnapshotRows, captureCurrentRows, diffRowSets,
  takeSnapshot, detectAndRecordChange, startSalesSnapshotScheduler,
} from '../../../lib/salesSnapshot';

export default withAuth(async function handler(req, res) {
  startSalesSnapshotScheduler(); // instrumentation 미지원 환경 폴백 — 첫 API 호출 시 기동
  try {
    if (req.method === 'GET') {
      const rawWeek = String(req.query.week || '').trim();
      if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
      const week = normalizeOrderWeek(rawWeek);
      const orderYear = resolveActiveOrderYear(rawWeek, req.query.year);

      // 스냅샷 상세 행
      if (req.query.rows) {
        const rows = await getSnapshotRows(req.query.rows);
        return res.status(200).json({ success: true, rows });
      }

      // diff: from 스냅샷 → to(스냅샷키 또는 'current')
      if (req.query.diffFrom) {
        const baseRows = await getSnapshotRows(req.query.diffFrom);
        const toRows = req.query.diffTo === 'current' || !req.query.diffTo
          ? await captureCurrentRows(week)
          : await getSnapshotRows(req.query.diffTo);
        const diff = diffRowSets(baseRows, toRows);
        return res.status(200).json({ success: true, diff });
      }

      // 변경 주체 추적 — 기준 스냅샷 이후 ShipmentHistory (누가/언제/얼마→얼마)
      if (req.query.changeLog) {
        const snaps = await listSnapshots(week, orderYear);
        const baseline = snaps.find(s => s.SnapshotType === 'TUE_FINAL');
        if (!baseline) return res.status(200).json({ success: true, entries: [], noBaseline: true });
        const r = await query(
          `SELECT TOP 200 sh.SdetailKey, CONVERT(varchar(19), sh.ChangeDtm, 120) AS changeDtm,
                  sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr, sh.ChangeID,
                  c.CustName, p.ProdName
             FROM ShipmentHistory sh
             LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
             LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
             LEFT JOIN Customer c ON sm.CustKey = c.CustKey
             LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
            WHERE sm.OrderWeek = @week AND sh.ChangeDtm >= @since
            ORDER BY sh.ChangeDtm DESC`,
          { week: { type: sql.NVarChar, value: week }, since: { type: sql.DateTime, value: new Date(baseline.takenAt) } }
        );
        return res.status(200).json({ success: true, entries: r.recordset, baselineAt: baseline.takenAt });
      }

      // 기본: 스냅샷 목록 + 현재 라이브 합계
      const [snapshots, currRows] = await Promise.all([listSnapshots(week, orderYear), captureCurrentRows(week)]);
      const liveAmount = currRows.reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0);
      return res.status(200).json({
        success: true, week, orderYear, snapshots,
        live: { rowCnt: currRows.length, total: liveAmount },
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      const rawWeek = String(req.body?.week || '').trim();
      if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
      const week = normalizeOrderWeek(rawWeek);
      const orderYear = resolveActiveOrderYear(rawWeek, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';

      if (action === 'manual') {
        const r = await takeSnapshot({ week, orderYear, type: 'MANUAL', actor, note: req.body?.note || '수동 스냅샷' });
        return res.status(200).json({ success: true, ...r });
      }
      if (action === 'checkNow') {
        const r = await detectAndRecordChange(week, orderYear, actor);
        return res.status(200).json({ success: true, ...r });
      }
      return res.status(400).json({ success: false, error: '알 수 없는 action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
