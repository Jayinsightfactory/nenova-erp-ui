// 영업수입불량차감 — 견적서 등록 전후 검토/수정/재조회 검증 창

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import { apiGet, apiPost } from '../../lib/useApi';

const fmt = (value) => Number(value || 0).toLocaleString();
const dateText = (value) => value ? String(value).slice(0, 19).replace('T', ' ') : '-';

function adjustedAfter(row) {
  if (!row.after) return null;
  const quantity = -Math.abs(Number(row.editQuantity || 0));
  const cost = Number(row.after.Cost || 0);
  const amount = Math.round(quantity * cost / 1.1);
  return {
    ...row.after,
    Quantity: quantity,
    Amount: amount,
    Vat: quantity * cost - amount,
    Descr: row.editNote || '',
  };
}

export default function SalesDefectDeductionRegisterReviewPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const ids = useMemo(() => {
    const raw = router.query.ids;
    return (Array.isArray(raw) ? raw.join(',') : String(raw || '')).split(',').map(Number).filter((item) => item > 0);
  }, [router.query.ids]);
  const year = String(router.query.year || '');
  const week = String(router.query.week || '');
  const deductionType = String(router.query.type || '불량차감');

  const load = useCallback(async () => {
    if (!router.isReady || !ids.length || !year || !week) return;
    setLoading(true); setError('');
    try {
      const data = await apiGet('/api/sales/defect-deductions', {
        view: 'registration-preview', year, week, ids: ids.join(','), type: deductionType,
      });
      setRows((data.rows || []).map((row) => ({
        ...row,
        editQuantity: row.quantity,
        editNote: row.note || '',
      })));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [router.isReady, ids, year, week, deductionType]);

  useEffect(() => { load(); }, [load]);

  const updateRow = (index, patch) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));

  const apply = async () => {
    const invalid = rows.filter((row) => row.error || !row.after || !(Number(row.editQuantity) > 0));
    if (invalid.length) {
      setError('오류가 있는 행과 수량이 없는 행을 먼저 수정하세요.');
      return;
    }
    setApplying(true); setError(''); setMessage(''); setVerified(false);
    try {
      const overrides = Object.fromEntries(rows.map((row) => [String(row.deductionKey), {
        quantity: Number(row.editQuantity),
        note: row.editNote || '',
        sourceUnit: row.sourceUnit || '',
      }]));
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'register', year, week, ids, deductionType, overrides,
      });
      setMessage(`${data.registered || 0}건 적용 완료. 기존 견적서를 다시 불러와 검증 중입니다.`);
      await load();
      setVerified(true);
      try { window.opener?.postMessage({ type: 'sales-defect-register-complete', registered: data.registered || 0 }, window.location.origin); } catch { /* ignore */ }
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  };

  return (
    <Layout title="견적서 등록 검토">
      <div className="review-page">
        <div className="review-head">
          <div>
            <h2>견적서 등록 검토</h2>
            <div className="sub">{year}년 {week}차 · {deductionType} · 기존 견적서와 적용 후 값을 비교한 뒤 등록합니다.</div>
          </div>
          <div className="head-actions"><button className="btn btn-primary" onClick={apply} disabled={applying || loading || !rows.length}>수정 적용 및 등록</button><button className="btn" onClick={load} disabled={loading || applying}>새로 불러오기</button><button className="btn" onClick={() => window.close()}>닫기</button></div>
        </div>
        {message && <div className="notice ok">{message}{verified && ' 재조회 검증 완료.'}</div>}
        {error && <div className="notice error">{error}</div>}
        <div className="notice info">단가는 같은 연도의 이전 차수 분배단가를 사용합니다. 차감수량은 등록 시 음수로 적용됩니다. 수정 이력은 원장에 남습니다.</div>
        <div className="review-list">
          {rows.map((row, index) => {
            const after = adjustedAfter(row);
            return <div className={`review-card ${row.error ? 'has-error' : ''}`} key={row.deductionKey || index}>
              <div className="row-title"><strong>{index + 1}. {row.customerName || '-'}</strong><span>{row.productName || '-'} / {row.colorName || '-'}</span><span>원장키 #{row.deductionKey}</span></div>
              {row.error && <div className="row-error">{row.error}</div>}
              <div className="compare-grid">
                <section className="compare-pane before"><h3>기존 견적서 내용</h3>{row.before ? <>
                  <div><b>견적서 키</b> #{row.before.EstimateKey}</div><div><b>일자</b> {dateText(row.before.EstimateDtm)}</div><div><b>수량</b> {fmt(row.before.Quantity)} {row.before.Unit || ''}</div><div><b>단가</b> {fmt(row.before.Cost)}원</div><div><b>금액</b> {fmt(row.before.Amount)}원 / 부가세 {fmt(row.before.Vat)}원</div><div><b>적요</b> {row.before.Descr || '-'}</div>
                </> : <div className="empty">기존 견적서 미등록 — 신규 등록 예정</div>}</section>
                <section className="compare-pane after"><h3>적용 후 내용</h3>{after ? <>
                  <div className="edit-line"><b>차감수량</b><input type="number" min="1" value={row.editQuantity} onChange={(e) => updateRow(index, { editQuantity: e.target.value })} /> {after.Unit || row.sourceUnit || ''}</div>
                  <div><b>일자</b> {dateText(after.EstimateDtm)} · 출고키 #{after.ShipmentKey}</div><div><b>이전차수 단가</b> {fmt(after.Cost)}원 <small>({after.CostOrderWeek || '타임라인 자동매칭'})</small></div><div><b>금액</b> {fmt(after.Amount)}원 / 부가세 {fmt(after.Vat)}원</div>
                  <div className="edit-line"><b>적요</b><input value={row.editNote} onChange={(e) => updateRow(index, { editNote: e.target.value })} /></div>
                </> : <div className="empty">적용값을 계산할 수 없습니다.</div>}</section>
              </div>
            </div>;
          })}
          {!loading && !rows.length && <div className="empty-block">검토할 견적서 등록 행이 없습니다.</div>}
        </div>
        <style jsx>{`
          .review-page { min-width: 0; padding: 4px; color: #0f172a; }
          .review-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 12px; border: 1px solid #94a3b8; background: #f8fafc; }
          h2 { margin: 0; font-size: 19px; } .sub { margin-top: 4px; color: #64748b; font-size: 12px; }
          .head-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
          .notice { margin-top: 8px; padding: 8px 10px; border: 1px solid; font-size: 12px; } .notice.ok { color: #166534; background: #f0fdf4; border-color: #86efac; } .notice.error { color: #991b1b; background: #fef2f2; border-color: #fca5a5; white-space: pre-wrap; } .notice.info { color: #1e3a8a; background: #eff6ff; border-color: #93c5fd; }
          .review-list { margin-top: 8px; display: grid; gap: 8px; }
          .review-card { border: 1px solid #94a3b8; background: #fff; } .review-card.has-error { border-color: #ef4444; }
          .row-title { display: flex; gap: 14px; align-items: center; padding: 7px 10px; background: #e2e8f0; border-bottom: 1px solid #cbd5e1; font-size: 13px; } .row-title span:last-child { margin-left: auto; color: #64748b; font-size: 11px; }
          .row-error { padding: 7px 10px; color: #991b1b; background: #fef2f2; font-size: 12px; }
          .compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; } .compare-pane { padding: 9px 12px; min-height: 150px; font-size: 12px; line-height: 1.8; } .compare-pane + .compare-pane { border-left: 1px solid #cbd5e1; } .compare-pane.before { background: #f8fafc; } .compare-pane.after { background: #fff; } h3 { margin: 0 0 5px; font-size: 13px; color: #1e3a8a; }
          .compare-pane b { display: inline-block; min-width: 94px; color: #475569; } .compare-pane small { color: #64748b; }
          .edit-line { display: flex; align-items: center; gap: 7px; } .edit-line input { flex: 1; min-width: 100px; min-height: 27px; border: 1px solid #94a3b8; padding: 3px 6px; font: inherit; }
          .empty { color: #64748b; padding-top: 20px; } .empty-block { padding: 40px; text-align: center; color: #64748b; border: 1px solid #cbd5e1; }
          @media (max-width: 900px) { .review-head, .row-title { align-items: flex-start; flex-direction: column; } .row-title span:last-child { margin-left: 0; } .compare-grid { grid-template-columns: 1fr; } .compare-pane + .compare-pane { border-left: 0; border-top: 1px solid #cbd5e1; } }
        `}</style>
      </div>
    </Layout>
  );
}
