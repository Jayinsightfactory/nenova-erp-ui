// pages/api/raum/pnl.js — 라움 손익계산서 저장/조회 (웹 전용 WebRaumPnl/WebRaumPnlItem)
// GET  ?view=list        → 차수별 결산 목록
// GET  ?key=N            → 상세 (마스터+품목)
// POST { action:'save', orderYear, major, ... items }   → 차수 upsert(품목 전체 교체)
// POST { action:'delete', key }                          → soft delete
import { withAuth } from '../../../lib/auth';
import { saveRaumPnl, loadRaumPnlList, loadRaumPnlDetail, deleteRaumPnl, assignRaumPnlMonth } from '../../../lib/raumPnl';
import { defaultPnlTitle } from '../../../lib/raumPnlPartner';
import { requirePnlPartner } from '../../../lib/pnlHotelRegistry';
import { evaluateRaumPnlImportReview, raumPnlImportSaveError } from '../../../lib/raumPnlImportReview';
import { loadRaumPnlCostComparisonRows } from '../../../lib/raumPnlCostComparisonServer';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query.view === 'cost-history') {
        const orderYear = String(req.query.year || '').trim();
        if (!/^\d{4}$/.test(orderYear)) return res.status(400).json({ success: false, error: '유효한 연도(year)가 필요합니다.' });
        const partner = await requirePnlPartner(req.query.partner);
        const rows = await loadRaumPnlCostComparisonRows({ orderYear, partnerCode: partner.code });
        return res.status(200).json({ success: true, rows });
      }
      // 엑셀 다운로드 — 저장된 전체 차수(오름차순) 시트 + 결산 시트, 수식 포함
      if (req.query.excel === '1') {
        const partner = await requirePnlPartner(req.query.partner);
        const list = await loadRaumPnlList(partner.code);
        if (!list.length) return res.status(400).json({ success: false, error: '저장된 손익계산서가 없습니다.' });
        const asc = [...list].sort((a, b) => (a.OrderYear + a.MajorWeek).localeCompare(b.OrderYear + b.MajorWeek));
        const records = [];
        for (const m of asc) {
          const d = await loadRaumPnlDetail(m.PnlKey, { partnerCode: partner.code });
          if (d) records.push(d);
        }
        const { buildRaumPnlWorkbook } = await import('../../../lib/raumPnlExcel');
        const buf = await buildRaumPnlWorkbook(records, { partnerLabel: partner.label });
        const filename = `${partner.label} 손익계산서-${records[records.length - 1].master.OrderYear}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="raum-pnl.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.status(200).send(buf);
      }
      if (req.query.key) {
        const partner = await requirePnlPartner(req.query.partner);
        const detail = await loadRaumPnlDetail(req.query.key, { partnerCode: partner.code });
        if (!detail) return res.status(404).json({ success: false, error: '해당 손익계산서가 없습니다.' });
        return res.status(200).json({ success: true, ...detail });
      }
      const partner = await requirePnlPartner(req.query.partner);
      const list = await loadRaumPnlList(partner.code);
      return res.status(200).json({ success: true, list });
    }

    if (req.method === 'POST') {
      const actor = req.user?.userName || req.user?.userId || 'user';
      const action = req.body?.action || 'save';

      if (action === 'delete') {
        const key = Number(req.body?.key);
        if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
        const partner = await requirePnlPartner(req.body?.partnerCode);
        await deleteRaumPnl(key, actor, { partnerCode: partner.code });
        return res.status(200).json({ success: true });
      }

      if (action === 'assign-month') {
        const key = Number(req.body?.key);
        if (!Number.isInteger(key) || key <= 0) return res.status(400).json({ success: false, error: '유효한 key가 필요합니다.' });
        const partner = await requirePnlPartner(req.body?.partnerCode);
        const result = await assignRaumPnlMonth(key, req.body?.assignedMonth, actor, { partnerCode: partner.code });
        return res.status(200).json({ success: true, ...result });
      }

      if (action === 'save') {
        const { orderYear, major, title, quoteDate, nenovaPct, note, sourceFile, images, verification, partnerCode } = req.body || {};
        const items = req.body?.items;
        const mj = String(major || '').replace(/[^0-9]/g, '');
        if (!mj || !orderYear) return res.status(400).json({ success: false, error: '차수(major)와 연도(orderYear) 필요' });
        const partner = await requirePnlPartner(partnerCode);
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ success: false, error: '품목이 없습니다.' });
        }
        const confirmGangnamMerge = req.body?.confirmGangnamMerge === true;
        const decision = evaluateRaumPnlImportReview([{ partnerCode: partner.code, verification }], confirmGangnamMerge);
        const reviewError = raumPnlImportSaveError(decision);
        if (reviewError) return res.status(400).json({ success: false, error: reviewError });
        const pct = Number(nenovaPct);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ success: false, error: '네노바 비율은 0~100 사이여야 합니다.' });
        }
        const pnlKey = await saveRaumPnl({
          orderYear, major: mj, partnerCode: partner.code,
          // Custom-hotel metadata is registry-owned; the core ignores a client
          // title for it and re-reads the active descriptor before writing.
          title: partner.customHotel === true ? defaultPnlTitle(partner.code, mj, '', partner) : (title || defaultPnlTitle(partner.code, mj, '', partner)), quoteDate, nenovaPct: pct, note, sourceFile, images, items,
          verification: Array.isArray(verification) ? verification : null, actor, confirmGangnamMerge,
        });
        return res.status(200).json({ success: true, pnlKey });
      }

      return res.status(400).json({ success: false, error: `알 수 없는 action: ${action}` });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});
