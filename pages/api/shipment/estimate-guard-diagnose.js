// pages/api/shipment/estimate-guard-diagnose.js — 출고→견적서/매출 누락 4경로 읽기 전용 진단 (관리자 화면용)
// GET ?view=orderlessFixed|detailDateMoneyMismatch|deletedMasterFixed|weekKeyMismatch|shipmentDateOutOfWeek|summary
//     &orderYear=2026 (기본: 올해) &weekMin=1 &limit=500
// GET ?view=deleteCheck&entity=customer|product&key=123  — 삭제 가능 여부(확정 출고 건수·차수)
// ⚠️ SELECT 만. 기존 데이터(주문 없는 출고 14줄, 금액 불일치 160줄 등)는 수정하지 않는다 — 사장님 판단 영역.
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { GUARD_DIAGNOSTIC_VIEWS, assertMasterDeletable } from '../../../lib/shipmentEstimateGuard.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only (read-only diagnostics)' });
  const view = String(req.query.view || 'summary');
  const orderYear = /^\d{4}$/.test(String(req.query.orderYear || '')) ? String(req.query.orderYear) : String(new Date().getFullYear());
  const weekMin = Math.max(1, parseInt(req.query.weekMin, 10) || 1);
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const params = { orderYear: { type: sql.NVarChar, value: orderYear } };

  try {
    if (view === 'deleteCheck') {
      const entity = String(req.query.entity || '');
      const key = Number(req.query.key);
      if (!['customer', 'product'].includes(entity) || !(key > 0)) return res.status(400).json({ success: false, error: 'entity=customer|product, key 필요' });
      try {
        const r = await assertMasterDeletable(query, sql, { entity, key });
        return res.status(200).json({ success: true, deletable: true, ...r });
      } catch (e) {
        if (e.code !== 'MASTER_HAS_FIXED_SHIPMENT') throw e;
        return res.status(200).json({ success: true, deletable: false, code: e.code, error: e.message, fixedCount: e.fixedCount, weeks: e.weeks });
      }
    }

    if (view === 'summary') {
      const out = {};
      for (const [name, def] of Object.entries(GUARD_DIAGNOSTIC_VIEWS)) {
        const r = await query(def.sql({ orderYear, weekMin }), params);
        const rows = r.recordset || [];
        out[name] = {
          label: def.label,
          count: rows.length,
          amount: Math.round(rows.reduce((s, x) => s + Number(x.Amount || 0), 0)),
        };
      }
      return res.status(200).json({ success: true, orderYear, weekMin, summary: out });
    }

    const def = GUARD_DIAGNOSTIC_VIEWS[view];
    if (!def) return res.status(400).json({ success: false, error: `unknown view '${view}'`, views: Object.keys(GUARD_DIAGNOSTIC_VIEWS) });
    const r = await query(def.sql({ orderYear, weekMin }), params);
    const rows = r.recordset || [];
    return res.status(200).json({
      success: true, view, label: def.label, orderYear, weekMin,
      count: rows.length, amount: Math.round(rows.reduce((s, x) => s + Number(x.Amount || 0), 0)),
      rows: rows.slice(0, limit),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
