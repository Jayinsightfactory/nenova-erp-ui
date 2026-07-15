// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 셀 구조.
// 자동(SQL): N순수매출·L불량·O그외매출·Q구매외화·S포워딩USD(추정) / 수기: E기초·F기말·H통관비·R환율·S수정·비고
// 계산열은 엑셀 수식 그대로: C=N+L+O, G=P+T, P=Q×R, T=S×R, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, D=C/ΣC, U=P/ΣP
// (이스라엘·뉴질랜드·일본: I=E+G+H, J=C−I+F, K=J/(C+F) — 원본 수식 변형 유지)
import { useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';
import { computeProfitRow, computeProfitTotals } from '../../lib/profitReportCalc';
import CustomsClearancePanel from '../../components/CustomsClearancePanel';
import ForwardingClearancePanel from '../../components/ForwardingClearancePanel';

function getDefaultMajor() {
  const m = String(getCurrentWeek() || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[2] : '';
}
const fmt = v => (v == null || Number.isNaN(v) ? '' : Math.round(v).toLocaleString());
const pct = v => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(1)}%`);

export default function ProfitReportPage() {
  const weekInput = useWeekInput(getDefaultMajor());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});   // { category: { colKey: 'value' } }
  const [note, setNote] = useState('');
  const [showCustoms, setShowCustoms] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);

  const load = async () => {
    setLoading(true); setError(''); setMessage(''); setEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      setNote(d.note || '');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const values = {};
      for (const row of data?.rows || []) {
        const e = edits[row.category] || {};
        const out = {};
        for (const col of ['E', 'F', 'H', 'R', 'S']) {
          if (e[col] !== undefined) out[col] = e[col] === '' ? null : Number(e[col]);
          else if (row.manual[col] != null) out[col] = row.manual[col];
        }
        if (Object.keys(out).length) values[row.category] = out;
      }
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekInput.value, values, note }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      setMessage('저장 완료 — 수기값(기초/기말/통관비/환율/포워딩)과 비고가 보관되었습니다.');
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const rowsCalc = useMemo(() => {
    const rows = (data?.rows || []).map(r => ({ ...r, calc: computeProfitRow(r, edits) }));
    return { rows, totals: computeProfitTotals(rows) };
  }, [data, edits]);

  const downloadExcel = async () => {
    if (Object.keys(edits).length > 0) await save();  // 수정 중이던 값을 먼저 저장해 파일에 반영
    window.location.href = `/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&excel=1`;
  };

  // ── 재고 평가단가표 모달
  const [priceModal, setPriceModal] = useState(null);   // { beginWeek, endWeek, rows }
  const [priceEdits, setPriceEdits] = useState({});
  const openPriceModal = async () => {
    setPriceEdits({});
    try {
      const res = await fetch(`/api/sales/profit-report?week=${encodeURIComponent(weekInput.value)}&stockPrices=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '단가표 조회 실패');
      setPriceModal(d);
    } catch (e) { setError(e.message); }
  };
  const savePrices = async () => {
    try {
      const res = await fetch('/api/sales/profit-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'stockPrices', week: weekInput.value, prices: priceEdits }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      setPriceModal(null);
      setMessage('재고단가표 저장 — 기초/기말 자동 평가액이 갱신되었습니다.');
      await load();
    } catch (e) { setError(e.message); }
  };

  const setEdit = (cat, col, val) => setEdits(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [col]: val } }));
  const dirty = Object.keys(edits).length > 0;

  const EditCell = ({ row, col, width = 86, autoValue }) => {
    const e = edits[row.category]?.[col];
    const base = row.manual[col];
    const auto = autoValue !== undefined ? autoValue
      : col === 'S' ? row.auto.S : col === 'E' ? row.auto.E : col === 'F' ? row.auto.F : col === 'R' ? row.auto.R : col === 'H' ? row.auto.H : null;
    const displayedAuto = auto == null ? '' : (col === 'R' || col === 'S' ? String(auto) : String(Math.round(auto)));
    // 파생 자동값은 DB에 복제 저장하지 않고 매 조회 때 다시 계산하되, 셀에는 실제 값으로 표시한다.
    const val = e !== undefined ? e : (base != null ? base : displayedAuto);
    const placeholder = e === '' ? displayedAuto : '';
    const titles = {
      R: `비우면 기본환율(${row.currency || '-'} · CurrencyMaster) 적용 — 청구서 환율과 다르면 입력`,
      S: '비우면 입고관리 자동감지(운송료/SERVICE FEE 라인) 사용 — [🚢 포워딩 입력]에서 확인/override 가능, 입력하면 수기값 우선',
      H: '비우면 [📦 그외통관비 입력] 화면 저장값 사용(백상창고료+관세+선율+월드운송료+한국방역, 콜롬비아 4품목은 무게비율 자동배분), 입력하면 수기값 우선',
      E: row.inheritedE ? '전차수 저장 기말재고에서 이월됨 (비우면 전차수 자동계산값 사용)' : '전차수 기말재고 이월 — 비우면 전차수 F를 같은 공식으로 자동계산',
      F: `${row.stock?.week || '해당 차수 마지막 세부차수'} 재고수량 기준 자동: (구매금액×환율+포워딩×환율+그외통관비)÷매입총수량×기말재고수량 — 직접 입력하면 수기값 우선`,
    };
    return (
      <input
        style={{ ...st.cellInput, width, background: e !== undefined ? '#fef9c3' : (base != null ? '#ecfdf5' : '#fff') }}
        value={val}
        placeholder={placeholder}
        title={titles[col] || ''}
        onChange={ev => setEdit(row.category, col, ev.target.value.replace(/[^0-9.\-]/g, ''))}
      />
    );
  };

  const { rows, totals } = rowsCalc;

  return (
    <div style={st.page}>
      <div style={st.bar}>
        <h1 style={st.h1}>📈 주차별 매출이익 보고서{data ? ` — ${data.major}차 (${data.orderYear})` : ''}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <label style={st.label}>차수</label>
          <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="27" />
          <button style={st.primaryBtn} onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
          <button style={{ ...st.primaryBtn, background: dirty ? '#16a34a' : '#94a3b8' }} onClick={save} disabled={saving || !data}>
            {saving ? '저장 중…' : `저장${dirty ? ' *' : ''}`}
          </button>
          <button style={{ ...st.primaryBtn, background: '#0f766e' }} onClick={downloadExcel} disabled={!data || saving}
            title="원본 양식과 100% 동일한 셀 구성으로 다운로드 (수정 중이면 저장 후)">
            📥 엑셀 다운로드
          </button>
          <button style={st.secondaryBtn} onClick={openPriceModal} disabled={!data}
            title="재고가 있는 품목의 평가단가를 관리합니다 (지정 > 수국표 > 품목Cost 순 적용)">
            🏷 재고단가표
          </button>
          <button style={showCustoms ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowCustoms(v => !v)} disabled={!data}
            title="백상창고료·관세·선율·월드운송료·한국방역·콜롬비아 무게배분 입력 — H(그외통관비) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다">
            📦 그외통관비 입력{showCustoms ? ' ▲' : ' ▼'}
          </button>
          <button style={showForwarding ? st.toggleBtnOn : st.secondaryBtn} onClick={() => setShowForwarding(v => !v)} disabled={!data}
            title="네덜란드·중국·콜롬비아·에콰도르·태국 항공/포워딩 비용 입력 — S(포워딩) 자동값의 소스, 저장하면 아래 표가 바로 재계산됩니다">
            🚢 포워딩 입력{showForwarding ? ' ▲' : ' ▼'}
          </button>
        </div>
      </div>
      <div style={st.hint}>
        자동(파랑): 순수매출·불량·그외매출·구매금액 = 전산 DB / <b>기말재고(F) = 엑셀 원본 공식: (구매금액×환율+포워딩×환율+그외통관비) ÷ 매입총수량 × 기말재고수량</b>
        (매입 없는 주는 품목별 최근 매입단가×환율, 그것도 없으면 [🏷 재고단가표] 평가 · 기초(E)=전차수 기말 이월) — 회색 자동값이 계산에 쓰이며, 셀에 직접 입력하면 그 값이 우선. H·R·S를 고치면 자동 F도 즉시 재계산.
        환율(R)은 참고용 현재환율 자동 적용(USD 기본 · 네덜란드=EUR · 호주=AUD · 중국=CNY · 일본=JPY)되며, 확정 보고서에는 해당 차수 청구서 환율 입력이 필요합니다.
        포워딩(USD)은 입고관리(운송료/SERVICE FEE 라인)에서 자동감지(노랑=수정중·초록=저장됨).
        {data?.stockWeeks?.end ? ` · 재고 스냅샷: 기말=${data.stockWeeks.end}${data.stockWeeks.begin ? `, 기초=${data.stockWeeks.begin}말` : ''}` : ''}
        {data?.rates?.length ? ` · 참고 환율: ${data.rates.map(r => `${r.CurrencyCode} ${Number(r.ExchangeRate).toLocaleString()}`).join(' · ')}` : ''}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}
      {data?.audit?.issues?.length > 0 && (
        <div style={data.audit.status === 'needs_input' ? st.auditError : st.auditWarning}>
          <strong>검증 필요: 오류 {data.audit.errorCount}건 · 확인 {data.audit.warningCount}건</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {data.audit.issues.slice(0, 10).map((issue, i) => (
              <li key={`${issue.code}-${issue.category}-${i}`}>
                <b>{issue.category}</b> [{issue.columns.join('/')}] {issue.message}
              </li>
            ))}
          </ul>
          {data.audit.issues.length > 10 && <div style={{ marginTop: 4 }}>외 {data.audit.issues.length - 10}건 — API audit.issues에서 전체 확인</div>}
        </div>
      )}

      {data && showCustoms && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>📦 그외통관비 입력 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowCustoms(false)}>접기 ▲</button>
          </div>
          <div style={st.embedPanelBody}>
            <CustomsClearancePanel week={weekInput.value} onSaved={load} />
          </div>
        </div>
      )}
      {data && showForwarding && (
        <div style={st.embedPanel}>
          <div style={st.embedPanelHead}>
            <strong>🚢 포워딩 입력 — {data.major}차</strong>
            <button style={st.tinyCloseBtn} onClick={() => setShowForwarding(false)}>접기 ▲</button>
          </div>
          <div style={st.embedPanelBody}>
            <ForwardingClearancePanel week={weekInput.value} onSaved={load} />
          </div>
        </div>
      )}

      {data && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                {['품명', '매출액', '매출비율', '기초상품재고액', '기말상품재고액', '매입액(상품+포워딩)', '그외통관비', '매출원가', '매출이익', '이익률', '불량금액', '불량율', '순수매출액', '그 외 매출액', '상품 금액(구매)', '구매금액(외화)', '환율', '포워딩(USD)', '포워딩 원화환산', '상품구매비율']
                  .map((h, i) => <th key={i} style={{ ...st.th, ...(i === 0 ? { ...st.stickyCol, background: '#1e293b', zIndex: 3 } : {}) }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const c = row.calc;
                const D = totals.C !== 0 ? c.C / totals.C : null;
                const U = totals.P !== 0 ? c.P / totals.P : null;
                return (
                  <tr key={row.category} style={row.category === '기타(미분류)' ? { background: '#fffbeb' } : undefined}>
                    <td style={{ ...st.td, ...st.stickyCol, fontWeight: 700 }}>{row.category}</td>
                    <td style={st.tdNum}>{fmt(c.C)}</td>
                    <td style={st.tdNum}>{pct(D)}</td>
                    <td style={st.tdNum}><EditCell row={row} col="E" /></td>
                    <td style={st.tdNum}><EditCell row={row} col="F" autoValue={c.F} /></td>
                    <td style={st.tdNum}>{fmt(c.G)}</td>
                    <td style={st.tdNum}><EditCell row={row} col="H" width={74} /></td>
                    <td style={{ ...st.tdNum, fontWeight: 700 }}>{fmt(c.I)}</td>
                    <td style={{ ...st.tdNum, fontWeight: 700, color: c.J < 0 ? '#dc2626' : '#166534' }}>{fmt(c.J)}</td>
                    <td style={st.tdNum}>{pct(c.K)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.L)}</td>
                    <td style={st.tdNum}>{pct(c.M)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.N)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{fmt(c.O)}</td>
                    <td style={st.tdNum}>{fmt(c.P)}</td>
                    <td style={{ ...st.tdNum, color: '#1d4ed8' }}>{c.Q ? Number(c.Q).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                    <td style={st.tdNum}><EditCell row={row} col="R" width={70} /></td>
                    <td style={st.tdNum}><EditCell row={row} col="S" width={86} /></td>
                    <td style={st.tdNum}>{fmt(c.T)}</td>
                    <td style={st.tdNum}>{pct(U)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
                <td style={{ ...st.td, ...st.stickyCol, background: '#e2e8f0' }}>합계</td>
                <td style={st.tdNum}>{fmt(totals.C)}</td>
                <td style={st.tdNum}>{pct(1)}</td>
                <td style={st.tdNum}>{fmt(totals.E)}</td>
                <td style={st.tdNum}>{fmt(totals.F)}</td>
                <td style={st.tdNum}>{fmt(totals.G)}</td>
                <td style={st.tdNum}>{fmt(totals.H)}</td>
                <td style={st.tdNum}>{fmt(totals.I)}</td>
                <td style={{ ...st.tdNum, color: totals.J < 0 ? '#dc2626' : '#166534' }}>{fmt(totals.J)}</td>
                <td style={st.tdNum}>{pct(totals.K)}</td>
                <td style={st.tdNum}>{fmt(totals.L)}</td>
                <td style={st.tdNum}>{pct(totals.M)}</td>
                <td style={st.tdNum}>{fmt(totals.N)}</td>
                <td style={st.tdNum}>{fmt(totals.O)}</td>
                <td style={st.tdNum}>{fmt(totals.P)}</td>
                <td style={st.tdNum}>{totals.Q ? Number(totals.Q).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                <td style={st.tdNum}></td>
                <td style={st.tdNum}>{totals.S ? Number(totals.S).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                <td style={st.tdNum}>{fmt(totals.T)}</td>
                <td style={st.tdNum}>{pct(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>비고사항</div>
          <textarea
            style={st.noteArea}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="예: 콜롬비아 수국: 냉해 21박스 (약 1,644,545원) …"
          />
        </div>
      )}

      {priceModal && (
        <div style={st.modalOverlay}>
          <div style={st.modalCard}>
            <div style={st.panelHead}>
              <strong>🏷 재고 평가단가표 — 기초({priceModal.beginWeek || '-'}말) · 기말({priceModal.endWeek || '-'}말)에 재고 있는 품목</strong>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', padding: '6px 12px' }}>
              단가를 입력하면 <b>지정단가</b>로 저장되어 이후 매주 자동 적용됩니다. 비우면 지정 해제(수국표/품목Cost로 복귀).
              평가액 = ProductStock 재고수량(출고단위) × 적용단가 ÷ 1.1
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={st.table}>
                <thead>
                  <tr><th>품종</th><th>품목</th><th style={{ textAlign: 'right' }}>기초수량</th><th style={{ textAlign: 'right' }}>기말수량</th><th style={{ textAlign: 'right' }}>박스당</th><th style={{ textAlign: 'right' }}>품목Cost</th><th>적용단가(출처)</th><th style={{ textAlign: 'right' }}>지정단가 입력</th></tr>
                </thead>
                <tbody>
                  {(priceModal.rows || []).map(r => {
                    const edit = priceEdits[r.ProdKey];
                    const shown = edit !== undefined ? edit : (r.SetPrice ?? '');
                    return (
                      <tr key={r.ProdKey}>
                        <td>{r.Category}</td>
                        <td>{r.ProdName}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.StockBegin)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.StockEnd)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.UnitPerBox)}</td>
                        <td style={{ textAlign: 'right', color: r.Cost ? undefined : '#dc2626' }}>{fmt(r.Cost)}</td>
                        <td>
                          {fmt(r.AppliedPrice)}
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: r.AppliedSource === '지정' ? '#166534' : r.AppliedSource === '수국표' ? '#1d4ed8' : '#64748b' }}>
                            {r.AppliedSource}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            style={{ ...st.cellInput, width: 90, background: edit !== undefined ? '#fef9c3' : (r.SetPrice != null ? '#ecfdf5' : '#fff') }}
                            value={shown}
                            onChange={e => setPriceEdits(prev => ({ ...prev, [r.ProdKey]: e.target.value.replace(/[^0-9.]/g, '') }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={st.secondaryBtn} onClick={() => setPriceModal(null)}>취소</button>
              <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={savePrices} disabled={Object.keys(priceEdits).length === 0}>
                단가 저장 ({Object.keys(priceEdits).length}건)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  page: { padding: 14, maxWidth: 1900, margin: '0 auto' },
  bar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  h1: { fontSize: 18, fontWeight: 800, margin: 0 },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', fontSize: 14, width: 70 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  toggleBtnOn: { background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  embedPanel: { border: '2px solid #1d4ed8', borderRadius: 10, marginBottom: 12, overflow: 'hidden', background: '#fff' },
  embedPanelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#1d4ed8', color: '#fff' },
  embedPanelBody: { padding: 12, maxHeight: '46vh', overflow: 'auto' },
  tinyCloseBtn: { background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' },
  hint: { fontSize: 11.5, color: '#64748b', marginBottom: 10, lineHeight: 1.6 },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  message: { background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 },
  auditError: { background: '#fff7ed', border: '1px solid #f97316', color: '#9a3412', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 },
  auditWarning: { background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 },
  tableWrap: { overflow: 'auto', maxHeight: 'calc(100vh - 220px)', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' },
  table: { borderCollapse: 'collapse', fontSize: 12, minWidth: 1800 },
  th: { position: 'sticky', top: 0, background: '#1e293b', color: '#fff', padding: '7px 8px', fontSize: 11, whiteSpace: 'nowrap', zIndex: 2 },
  stickyCol: { position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1, minWidth: 130 },
  td: { border: '1px solid #e2e8f0', padding: '5px 8px', whiteSpace: 'nowrap' },
  tdNum: { border: '1px solid #e2e8f0', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' },
  cellInput: { border: '1px solid #cbd5e1', borderRadius: 5, padding: '3px 6px', fontSize: 12, textAlign: 'right' },
  noteArea: { width: '100%', minHeight: 90, border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 13, boxSizing: 'border-box' },
  panelHead: { minHeight: 44, padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: 'min(1000px, 96vw)', maxHeight: '86vh', background: '#fff', borderRadius: 12, boxShadow: '0 24px 80px rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
