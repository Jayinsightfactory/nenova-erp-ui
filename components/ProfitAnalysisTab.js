// components/ProfitAnalysisTab.js — 주차별 매출이익 보고서의 "원인분석" 탭.
//
// 카테고리(품종)별 이익률이 왜 높거나 낮은지: 결정론 근거(단가·판매비중·환율·재고시차·원가)를
// 카드로 보여주고, [🤖 AI 소견] 버튼을 눌렀을 때만 LLM 서술을 생성한다(자동 호출 없음 — 비용).
// 데이터 원천: GET /api/sales/profit-analysis?detail=category (읽기 전용, 본표와 동일 계산),
// AI 소견: POST /api/sales/profit-analysis-opinion (근거팩 해시 캐시 — 데이터가 같으면 재호출 없음).
import { useCallback, useEffect, useState } from 'react';

const ALL_CATEGORY = '(전체)';
const fmt = (v) => (v == null || Number.isNaN(Number(v)) ? '-' : Math.round(Number(v)).toLocaleString());
const pct = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? '-' : `${(Number(v) * 100).toFixed(digits)}%`);
const DRIVER_LABEL = { C: '매출액', E: '기초재고', F: '기말재고', P: '상품매입', H: '그외통관비', T: '포워딩' };

const st = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  note: { background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3730a3', lineHeight: 1.6 },
  topBar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  aiAllBtn: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  card: { border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: '#f8fafc' },
  cardTitle: { fontWeight: 800, fontSize: 14, color: '#0f172a' },
  kBadge: (k) => ({
    padding: '2px 10px', borderRadius: 999, fontWeight: 800, fontSize: 12,
    background: k == null ? '#e2e8f0' : k < 0 ? '#fee2e2' : k < 0.05 ? '#fef3c7' : '#dcfce7',
    color: k == null ? '#475569' : k < 0 ? '#b91c1c' : k < 0.05 ? '#92400e' : '#166534',
  }),
  tag: { fontSize: 11, color: '#64748b', background: '#f1f5f9', borderRadius: 6, padding: '2px 6px' },
  body: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  secTitle: { fontWeight: 700, fontSize: 12.5, color: '#334155', marginBottom: 4 },
  table: { borderCollapse: 'collapse', fontSize: 12.5, width: '100%' },
  th: { textAlign: 'left', padding: '4px 8px', background: '#f1f5f9', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' },
  td: { padding: '4px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  aiBtn: { padding: '6px 12px', borderRadius: 8, border: '1px solid #c4b5fd', background: '#f5f3ff', color: '#6d28d9', fontWeight: 700, cursor: 'pointer', fontSize: 12.5 },
  aiBox: { whiteSpace: 'pre-wrap', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#3b0764', lineHeight: 1.7 },
  aiMeta: { fontSize: 11, color: '#7c3aed', marginTop: 4 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', fontSize: 13 },
  message: { background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1', borderRadius: 8, padding: '10px 14px', fontSize: 13 },
};

export default function ProfitAnalysisTab({ weekValue, year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openCat, setOpenCat] = useState(null);
  const [opinions, setOpinions] = useState({}); // category → { busy, text, model, createdAt, cached, error }
  const [yearLag, setYearLag] = useState(null); // { total, byWeek, rows } — 연간 재고시차 전수
  const [yearLagBusy, setYearLagBusy] = useState(false);
  const [yearLagError, setYearLagError] = useState('');
  const [flowLag, setFlowLag] = useState(null); // 흐름 재구성 전수 (조정 가림 포함)
  const [flowLagBusy, setFlowLagBusy] = useState(false);
  const [flowLagError, setFlowLagError] = useState('');

  const loadFlowLag = async () => {
    if (flowLagBusy) return;
    if (flowLag) { setFlowLag(null); return; }
    setFlowLagBusy(true); setFlowLagError('');
    try {
      const res = await fetch(`/api/sales/profit-analysis?detail=stockLagFlow&year=${encodeURIComponent(year)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.ok) throw new Error(d.message || '흐름 재구성 조회 실패');
      setFlowLag(d);
    } catch (e) {
      setFlowLagError(e.message);
    } finally {
      setFlowLagBusy(false);
    }
  };

  const loadYearLag = async () => {
    if (yearLagBusy) return;
    if (yearLag) { setYearLag(null); return; } // 토글 닫기
    setYearLagBusy(true); setYearLagError('');
    try {
      const res = await fetch(`/api/sales/profit-analysis?detail=stockLagYear&year=${encodeURIComponent(year)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.ok) throw new Error(d.message || '연간 재고시차 조회 실패');
      setYearLag(d);
    } catch (e) {
      setYearLagError(e.message);
    } finally {
      setYearLagBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!weekValue) return;
    setLoading(true); setError(''); setData(null); setOpinions({});
    try {
      const res = await fetch(`/api/sales/profit-analysis?week=${encodeURIComponent(weekValue)}&year=${encodeURIComponent(year)}&detail=category`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.ok) throw new Error(d.message || '원인분석 조회 실패');
      setData(d);
      if (d.categories?.length) setOpenCat(d.categories[0].category); // 이익률 최저 카테고리 자동 펼침
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [weekValue, year]);

  useEffect(() => { load(); }, [load]);

  const runOpinion = async (category, force = false) => {
    setOpinions((cur) => ({ ...cur, [category]: { ...(cur[category] || {}), busy: true, error: null } }));
    try {
      const res = await fetch('/api/sales/profit-analysis-opinion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ week: weekValue, year, category, force }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.message || 'AI 소견 생성 실패');
      setOpinions((cur) => ({ ...cur, [category]: { busy: false, text: d.opinion, model: d.model, createdAt: d.createdAt, cached: d.cached } }));
    } catch (e) {
      setOpinions((cur) => ({ ...cur, [category]: { ...(cur[category] || {}), busy: false, error: e.message } }));
    }
  };

  const OpinionBlock = ({ category }) => {
    const op = opinions[category];
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={st.aiBtn} onClick={() => runOpinion(category)} disabled={op?.busy}
            title="화면의 결정론 근거(단가·비중·환율·재고시차·원가)를 AI가 사람 말로 종합 설명합니다. 데이터가 안 바뀌었으면 저장된 소견을 재사용합니다">
            {op?.busy ? '🤖 분석 중…' : op?.text ? '🤖 AI 소견 다시 보기' : '🤖 AI 소견'}
          </button>
          {op?.text && (
            <button style={{ ...st.aiBtn, background: '#fff' }} onClick={() => runOpinion(category, true)} disabled={op?.busy}
              title="캐시를 무시하고 새로 생성">↻ 새로 분석</button>
          )}
        </div>
        {op?.error && <div style={{ ...st.error, marginTop: 6 }}>{op.error}</div>}
        {op?.text && (
          <div style={{ marginTop: 8 }}>
            <div style={st.aiBox}>{op.text}</div>
            <div style={st.aiMeta}>{op.model === 'rule-fallback' ? '규칙 기반 요약 (AI 키 미설정)' : `AI 소견 · ${op.model}`}{op.cached ? ' · 저장본' : ''}{op.createdAt ? ` · ${String(op.createdAt).slice(0, 16).replace('T', ' ')}` : ''}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={st.wrap}>
      <div style={st.note}>
        <b>이익률 원인분석</b> — 카테고리(품종)별로 이익률이 왜 높거나 낮은지 원인을 분해합니다:
        ① 거래처 판매단가(카테고리 평균 대비) ② 저가 거래처 판매비중 변화 ③ 환율 ④ <b>재고 시차</b>(기말 잔량 음수 = 다음 차수 입고분 선판매) ⑤ 매입·통관비·포워딩 변동.
        표의 숫자는 본표와 같은 전산 계산이고, AI 소견은 이 숫자만으로 서술합니다(버튼 눌렀을 때만 실행).
      </div>
      <div style={st.topBar}>
        <span style={{ fontSize: 13, color: '#475569' }}>{data ? `${data.orderYear}년 ${Number(data.major)}차 (직전 ${Number(data.prevMajor)}차 대비)` : ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={{ ...st.aiAllBtn, background: '#0f766e' }} onClick={loadFlowLag} disabled={flowLagBusy}
            title="스냅샷 잔량과 무관하게 (전차수 기말+입고-출고)를 직접 계산해 음수가 나온 차수·품목을 전수 검출합니다 — 재고조정으로 음수가 가려진 선판매까지 잡습니다">
            {flowLagBusy ? '🔍 재구성 중…' : flowLag ? '🔍 흐름 재구성 닫기' : '🔍 흐름 재구성 전수'}
          </button>
          <button style={{ ...st.aiAllBtn, background: '#b45309' }} onClick={loadYearLag} disabled={yearLagBusy}
            title="올해 모든 세부차수 재고 스냅샷에서 잔량이 음수인 품목(다음 차수 입고분 선판매 흔적)을 전수 조회합니다">
            {yearLagBusy ? '📦 전수 조회 중…' : yearLag ? '📦 연간 재고시차 닫기' : '📦 연간 재고시차 전체'}
          </button>
          <button style={st.aiAllBtn} onClick={() => runOpinion(ALL_CATEGORY)} disabled={!data || opinions[ALL_CATEGORY]?.busy}>
            {opinions[ALL_CATEGORY]?.busy ? '🤖 전체 분석 중…' : '🤖 전체 AI 소견'}
          </button>
        </div>
      </div>
      {opinions[ALL_CATEGORY]?.text || opinions[ALL_CATEGORY]?.error ? (
        <div style={st.card}><div style={st.body}><OpinionBlock category={ALL_CATEGORY} /></div></div>
      ) : null}
      {flowLagError && <div style={st.error}>{flowLagError}</div>}
      {flowLag && (
        <div style={st.card}>
          <div style={{ ...st.cardHead, cursor: 'default' }}>
            <span style={st.cardTitle}>🔍 {flowLag.orderYear}년 흐름 재구성 전수 — 총 {flowLag.total}건 (조정으로 가려진 {flowLag.maskedCount}건 포함)</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>계산잔량 = 전차수 기말 + 입고 − 출고(확정). 음수 = 다음 차수 입고분 선판매</span>
          </div>
          <div style={st.body}>
            {flowLag.total === 0 ? <div style={st.message}>흐름상 잔량 음수가 없습니다.</div> : (
              <table style={st.table}>
                <thead><tr><th style={st.th}>차수</th><th style={st.th}>카테고리</th><th style={st.th}>품목</th><th style={{ ...st.th, ...st.num }}>기초</th><th style={{ ...st.th, ...st.num }}>입고</th><th style={{ ...st.th, ...st.num }}>출고</th><th style={{ ...st.th, ...st.num }}>계산잔량</th><th style={{ ...st.th, ...st.num }}>스냅샷</th><th style={st.th}>상태</th></tr></thead>
                <tbody>{flowLag.rows.map((x, i) => (
                  <tr key={i}>
                    <td style={st.td}>{Number(x.major)}차</td>
                    <td style={st.td}>{x.category || '-'}</td>
                    <td style={st.td}>{x.productName}</td>
                    <td style={{ ...st.td, ...st.num }}>{fmt(x.begin)}</td>
                    <td style={{ ...st.td, ...st.num }}>{fmt(x.arrivals)}</td>
                    <td style={{ ...st.td, ...st.num }}>{fmt(x.shipments)}</td>
                    <td style={{ ...st.td, ...st.num, color: '#b91c1c', fontWeight: 700 }}>{x.impliedEnd}</td>
                    <td style={{ ...st.td, ...st.num }}>{x.snapshotEnd == null ? '-' : fmt(x.snapshotEnd)}</td>
                    <td style={st.td}>{x.masked ? `⚠ 조정 가림 (+${x.adjustment})` : x.nextWeekArrival ? `✅ ${Number(x.nextMajor)}차 입고` : '입고 미확인'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {yearLagError && <div style={st.error}>{yearLagError}</div>}
      {yearLag && (
        <div style={st.card}>
          <div style={{ ...st.cardHead, cursor: 'default' }}>
            <span style={st.cardTitle}>📦 {yearLag.orderYear}년 재고시차 전수 — 총 {yearLag.total}건</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>세부차수 스냅샷 잔량 음수 = 다음 차수 입고분을 그 차수에 선판매</span>
          </div>
          <div style={st.body}>
            {yearLag.total === 0 ? <div style={st.message}>올해 잔량 음수 품목이 없습니다.</div> : (
              <table style={st.table}>
                <thead><tr><th style={st.th}>세부차수</th><th style={st.th}>카테고리</th><th style={st.th}>품목</th><th style={{ ...st.th, ...st.num }}>잔량</th><th style={st.th}>다음 차수 입고</th></tr></thead>
                <tbody>{yearLag.rows.map((x, i) => (
                  <tr key={i}>
                    <td style={st.td}>{x.orderWeek}</td>
                    <td style={st.td}>{x.category || '-'}</td>
                    <td style={st.td}>{x.productName}</td>
                    <td style={{ ...st.td, ...st.num, color: '#b91c1c', fontWeight: 700 }}>{fmt(x.endStock)}</td>
                    <td style={st.td}>{x.nextWeekArrival ? `✅ ${Number(x.nextMajor)}차 입고 확인` : '입고 미확인'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {loading && <div style={st.message}>이번 차수와 직전 차수 원장을 읽어 카테고리별 원인을 분해하는 중… (수십 초 걸릴 수 있습니다)</div>}
      {error && <div style={st.error}>{error} <button style={{ ...st.aiBtn, marginLeft: 8 }} onClick={load}>다시 시도</button></div>}
      {data?.categories?.map((c) => {
        const open = openCat === c.category;
        const lowCusts = (c.customerPrices || []).filter((x) => (x.vsCategoryAvgPct ?? 0) < -0.03);
        return (
          <div key={c.category} style={st.card}>
            <div style={st.cardHead} onClick={() => setOpenCat(open ? null : c.category)} role="button" aria-expanded={open}>
              <span style={{ fontSize: 13 }}>{open ? '▾' : '▸'}</span>
              <span style={st.cardTitle}>{c.category}</span>
              <span style={st.kBadge(c.K)}>이익률 {pct(c.K)}</span>
              {c.prevK != null && <span style={st.tag}>직전 {pct(c.prevK)}</span>}
              {c.cnf && <span style={st.tag} title="운임이 매입단가에 포함(CNF) — 포워딩 없음이 정상">CNF</span>}
              {c.stockLag?.length ? <span style={{ ...st.tag, background: '#fef3c7', color: '#92400e' }}>재고시차 {c.stockLag.length}건</span> : null}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>매출 {fmt(c.C)} · 이익 {fmt(c.J)}</span>
            </div>
            {open && (
              <div style={st.body}>
                <div>
                  <div style={st.secTitle}>변동요인 (직전 차수 대비 이익 영향액)</div>
                  <table style={st.table}><thead><tr><th style={st.th}>항목</th><th style={{ ...st.th, ...st.num }}>이번</th><th style={{ ...st.th, ...st.num }}>직전</th><th style={{ ...st.th, ...st.num }}>이익영향</th></tr></thead>
                    <tbody>
                      {(c.drivers || []).map((d) => (
                        <tr key={d.column}>
                          <td style={st.td}>{DRIVER_LABEL[d.column] || d.column}</td>
                          <td style={{ ...st.td, ...st.num }}>{fmt(d.currentValue)}</td>
                          <td style={{ ...st.td, ...st.num }}>{fmt(d.priorAvgValue)}</td>
                          <td style={{ ...st.td, ...st.num, color: (d.profitImpact || 0) < 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{d.profitImpact > 0 ? '+' : ''}{fmt(d.profitImpact)}</td>
                        </tr>
                      ))}
                      {c.rate && c.rate.current != null && (
                        <tr>
                          <td style={st.td}>환율 (R)</td>
                          <td style={{ ...st.td, ...st.num }}>{Number(c.rate.current).toFixed(2)}</td>
                          <td style={{ ...st.td, ...st.num }}>{c.rate.prev == null ? '-' : Number(c.rate.prev).toFixed(2)}</td>
                          <td style={{ ...st.td, ...st.num, color: (c.rate.effect || 0) < 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{c.rate.effect == null ? '-' : `${c.rate.effect > 0 ? '+' : ''}${fmt(c.rate.effect)}`}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {lowCusts.length > 0 && (
                  <div>
                    <div style={st.secTitle}>카테고리 평균보다 낮은 단가로 나가는 거래처 (부가세 포함 분배단가)</div>
                    <table style={st.table}><thead><tr><th style={st.th}>거래처</th><th style={{ ...st.th, ...st.num }}>단가</th><th style={{ ...st.th, ...st.num }}>평균 대비</th><th style={{ ...st.th, ...st.num }}>매출 비중</th></tr></thead>
                      <tbody>{lowCusts.map((x, i) => (
                        <tr key={i}><td style={st.td}>{x.custName}</td><td style={{ ...st.td, ...st.num }}>{fmt(x.unitPrice)}</td>
                          <td style={{ ...st.td, ...st.num, color: '#b91c1c' }}>{pct(x.vsCategoryAvgPct)}</td>
                          <td style={{ ...st.td, ...st.num }}>{pct(x.amountShare, 0)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {(c.priceDrops || []).length > 0 && (
                  <div>
                    <div style={st.secTitle}>직전 차수보다 단가가 내려간 거래처×품목 (3%↑ 하락)</div>
                    <table style={st.table}><thead><tr><th style={st.th}>거래처</th><th style={st.th}>품목</th><th style={{ ...st.th, ...st.num }}>이번</th><th style={{ ...st.th, ...st.num }}>직전</th><th style={{ ...st.th, ...st.num }}>변화</th></tr></thead>
                      <tbody>{c.priceDrops.map((x, i) => (
                        <tr key={i}><td style={st.td}>{x.custName}</td><td style={st.td}>{x.productName}</td>
                          <td style={{ ...st.td, ...st.num }}>{fmt(x.currentPrice)}</td><td style={{ ...st.td, ...st.num }}>{fmt(x.priorPrice)}</td>
                          <td style={{ ...st.td, ...st.num, color: '#b91c1c' }}>{pct(x.pctChange)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {(c.mixCandidates || []).length > 0 && (
                  <div>
                    <div style={st.secTitle}>저단가 거래처의 판매비중 확대 (품목 평균단가 5%↓ + 비중 2%p↑)</div>
                    <table style={st.table}><thead><tr><th style={st.th}>거래처</th><th style={st.th}>품목</th><th style={{ ...st.th, ...st.num }}>단가</th><th style={{ ...st.th, ...st.num }}>품목 평균</th><th style={{ ...st.th, ...st.num }}>비중 변화</th></tr></thead>
                      <tbody>{c.mixCandidates.map((x, i) => (
                        <tr key={i}><td style={st.td}>{x.custName}</td><td style={st.td}>{x.productName}</td>
                          <td style={{ ...st.td, ...st.num }}>{fmt(x.currentPrice)}</td><td style={{ ...st.td, ...st.num }}>{fmt(x.peerWeightedAvg)}</td>
                          <td style={{ ...st.td, ...st.num, color: '#b45309' }}>+{x.shareDeltaPp}%p</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {(c.stockLag || []).length > 0 && (
                  <div>
                    <div style={st.secTitle}>재고 시차 — 기말 잔량이 음수인 품목 (다음 차수 입고분을 이번 차수에 선판매)</div>
                    <table style={st.table}><thead><tr><th style={st.th}>품목</th><th style={{ ...st.th, ...st.num }}>기말 잔량</th><th style={st.th}>다음 차수 입고</th></tr></thead>
                      <tbody>{c.stockLag.map((x, i) => (
                        <tr key={i}><td style={st.td}>{x.productName}</td>
                          <td style={{ ...st.td, ...st.num, color: '#b91c1c', fontWeight: 700 }}>{fmt(x.endStock)}</td>
                          <td style={st.td}>{x.nextWeekArrival ? `✅ ${Number(x.nextMajor)}차 입고 확인` : '입고 미확인 — 원장 확인 필요'}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <OpinionBlock category={c.category} />
              </div>
            )}
          </div>
        );
      })}
      {data && !data.categories?.length && <div style={st.message}>이 차수에 분석할 카테고리 데이터가 없습니다.</div>}
    </div>
  );
}
