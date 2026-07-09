// ECOUNT 연동 데이터 — 4종(입출금·채권·채무·판매현황) 스크래핑 수집분 조회 + 무결성 신뢰도 대시보드.
// OAPI 로 못 가져오는 데이터를 Chrome/Playwright 로 수집 → 검증 → 여기서 확인.
import { useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑

const fmt = v => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Math.round(Number(v)).toLocaleString());
const STATUS = {
  GREEN: { dot: '🟢', label: '검증 통과', color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' },
  YELLOW: { dot: '🟡', label: '주의 필요', color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  RED: { dot: '🔴', label: '거부 (재수집)', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  GRAY: { dot: '⚪', label: '미검증', color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1' },
};
const DS_LABEL = { cash: '입출금계좌', ar: '거래처별채권', ap: '거래처별채무', sales: '판매현황' };

export default function EcountPage() {
  const [dataset, setDataset] = useState('sales');
  const [snapshots, setSnapshots] = useState([]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (ds) => {
    setLoading(true); setError(''); setDetail(null); setSel(null);
    try {
      const res = await fetch(`/api/ecount?dataset=${ds}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setSnapshots(d.snapshots || []);
      if ((d.snapshots || [])[0]) selectSnap(d.snapshots[0].SnapshotKey);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const selectSnap = async (key) => {
    setSel(key);
    try {
      const res = await fetch(`/api/ecount?snapshot=${key}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setDetail(d.snapshot);
    } catch { setDetail(null); }
  };
  useEffect(() => { load(dataset); /* eslint-disable-next-line */ }, [dataset]);

  const checks = detail?.VerifyDetail || [];
  const st = STATUS[detail?.VerifyStatus] || STATUS.GRAY;
  const crossCheck = checks.find(c => c.code === 'cross');

  const rowBg = (flag) => flag === 'err' ? '#fee2e2' : flag === 'warn' ? '#fef9c3' : '#fff';
  const maxCrossDiff = useMemo(() => Math.max(1, ...((crossCheck?.top || []).map(x => Math.abs(x.diff)))), [crossCheck]);

  return (
    <div style={s.page}>
      <h1 style={s.h1}>🔗 ECOUNT 연동 데이터</h1>
      <p style={s.desc}>
        ECOUNT OAPI 로 조회 불가한 4종 데이터를 화면에서 수집(Chrome/owner PC 자동)해 저장합니다.
        모든 수집분은 <b>4중 검증</b>(화면합계·행수 대조 · 내부 산술 · 시계열 급변 · nenovaweb 교차)을 거쳐 신뢰도로 표시됩니다.
      </p>

      <div style={s.tabs}>
        {Object.entries(DS_LABEL).map(([k, v]) => (
          <button key={k} style={dataset === k ? s.tabOn : s.tab} onClick={() => setDataset(k)}>{v}</button>
        ))}
      </div>
      {error && <div style={s.err}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, alignItems: 'start' }}>
        {/* 좌: 수집 이력 */}
        <div style={s.panel}>
          <div style={s.panelHead}><strong>수집 이력</strong>{loading && <span style={{ fontSize: 11, color: '#64748b' }}>불러오는 중…</span>}</div>
          <div style={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            {snapshots.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#64748b' }}>아직 수집된 데이터가 없습니다. Chrome/owner PC 스크래퍼로 수집하세요.</div>}
            {snapshots.map(sn => {
              const sst = STATUS[sn.VerifyStatus] || STATUS.GRAY;
              return (
                <div key={sn.SnapshotKey} onClick={() => selectSnap(sn.SnapshotKey)}
                  style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7', cursor: 'pointer', background: sel === sn.SnapshotKey ? '#f0f9ff' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{sst.dot}</span>
                    <b style={{ fontSize: 12 }}>#{sn.SnapshotKey}</b>
                    <span style={{ fontSize: 11, color: sst.color, fontWeight: 800 }}>{sst.label} {sn.VerifyScore != null ? `${sn.VerifyScore}점` : ''}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{sn.takenAt}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                    {sn.PeriodFrom}~{sn.PeriodTo} · {fmt(sn.ParsedTotal)}원 · {sn.RowCnt}행
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 우: 신뢰도 대시보드 + 데이터 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {detail && (
            <>
              {/* 신뢰도 배너 */}
              <div style={{ ...s.banner, background: st.bg, borderColor: st.border }}>
                <span style={{ fontSize: 22 }}>{st.dot}</span>
                <div>
                  <div style={{ fontWeight: 800, color: st.color, fontSize: 15 }}>{st.label} · 신뢰도 {detail.VerifyScore}점</div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    #{detail.SnapshotKey} · {DS_LABEL[detail.Dataset]} · {detail.PeriodFrom}~{detail.PeriodTo} · {detail.RowCnt}행 · 합계 {fmt(detail.ParsedTotal)}원
                  </div>
                </div>
              </div>

              {/* 검증 카드들 */}
              <div style={s.checkGrid}>
                {checks.map((c, i) => {
                  const cs = STATUS[c.status] || STATUS.GRAY;
                  return (
                    <div key={i} style={{ ...s.checkCard, borderColor: cs.border }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: cs.color }}>{cs.dot} {c.label}</div>
                      {c.code === 'total' && <div style={s.checkBody}>화면 {fmt(c.screen)} ⟷ 파싱 {fmt(c.parsed)} {c.ok ? '✓ 일치' : `✗ 차이 ${fmt(c.diff)}`}</div>}
                      {c.code === 'rowcnt' && <div style={s.checkBody}>화면 {c.screen}행 ⟷ 파싱 {c.parsed}행 {c.ok ? '✓' : '✗'}</div>}
                      {c.code === 'identity' && <div style={s.checkBody}>{c.ok ? '✓ 전 행 항등식 성립' : `✗ 불일치 ${c.badCount}행`}</div>}
                      {c.code === 'nullkey' && <div style={s.checkBody}>거래처 누락 {c.count}행</div>}
                      {c.code === 'drift' && <div style={s.checkBody}>직전 {fmt(c.prev)} → 현재 {fmt(c.now)} ({c.driftPct > 0 ? '+' : ''}{c.driftPct}%)</div>}
                      {c.code === 'cross' && <div style={s.checkBody}>대조 {c.compared}건 중 불일치 {c.mismatch}건</div>}
                    </div>
                  );
                })}
              </div>

              {/* 교차검증 오차 막대 */}
              {crossCheck && (crossCheck.top || []).length > 0 && (
                <div style={s.panel}>
                  <div style={s.panelHead}><strong>교차검증 오차 (ECOUNT 판매 ⟷ nenovaweb 출고매출)</strong></div>
                  <div style={{ padding: 10 }}>
                    {crossCheck.top.map((x, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 }}>
                        <span style={{ width: 130, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.custName}</span>
                        <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 16, position: 'relative' }}>
                          <div style={{ width: `${Math.min(100, Math.abs(x.diff) / maxCrossDiff * 100)}%`, height: '100%', background: x.diff > 0 ? '#f59e0b' : '#3b82f6', borderRadius: 4 }} />
                        </div>
                        <span style={{ width: 110, textAlign: 'right', color: x.diff > 0 ? '#b45309' : '#1d4ed8' }}>{x.diff > 0 ? '+' : ''}{fmt(x.diff)}</span>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>ECOUNT &gt; 우리(주황) / 우리 &gt; ECOUNT(파랑). 우리에 없는 거래처는 대조 제외.</div>
                  </div>
                </div>
              )}

              {/* 데이터 행 (검증 색상) */}
              <div style={s.panel}>
                <div style={s.panelHead}>
                  <strong>수집 데이터 ({detail.rows?.length || 0}행)</strong>
                  <span style={{ fontSize: 11, color: '#64748b' }}>흰색=정상 · 노랑=교차불일치 · 빨강=산술오류</span>
                </div>
                <div style={{ maxHeight: 'calc(100vh - 320px)', overflow: 'auto' }}>
                  <table style={s.table}>
                    <thead><tr>{colsFor(detail.Dataset).map((h, i) => <th key={i} style={s.th}>{h.label}</th>)}</tr></thead>
                    <tbody>
                      {(detail.rows || []).map((r, i) => {
                        const p = r.Payload || {};
                        return (
                          <tr key={i} style={{ background: r.IsSubtotal ? '#f8fafc' : rowBg(r.RowFlag), fontWeight: r.IsSubtotal ? 800 : 400 }}>
                            {colsFor(detail.Dataset).map((h, j) => (
                              <td key={j} style={{ ...s.td, textAlign: h.num ? 'right' : 'left' }}>{h.num ? fmt(p[h.key]) : (p[h.key] ?? '')}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {!detail && !loading && <div style={{ ...s.panel, padding: 20, color: '#64748b', fontSize: 13 }}>왼쪽에서 수집 이력을 선택하세요.</div>}
        </div>
      </div>
    </div>
  );
}

function colsFor(ds) {
  if (ds === 'cash') return [
    { key: 'refDate', label: '입출금일자' }, { key: 'flow', label: '구분' }, { key: 'account', label: '계좌' },
    { key: 'custName', label: '거래처' }, { key: 'amount', label: '금액', num: true }, { key: 'balance', label: '원화잔액', num: true },
    { key: 'counterBank', label: '상대은행' },
  ];
  if (ds === 'ar') return [
    { key: 'custName', label: '거래처명' }, { key: 'salesTotal', label: '매출합계', num: true }, { key: 'receiptTotal', label: '수급합계', num: true },
    { key: 'etcDiff', label: '기타차액', num: true }, { key: 'balance', label: '잔액(채권)', num: true }, { key: 'agingMonth', label: '미회수월' },
  ];
  if (ds === 'ap') return [
    { key: 'custCode', label: '거래처코드' }, { key: 'custName', label: '거래처명' }, { key: 'openingDebt', label: '기초채무', num: true },
    { key: 'stockBuy', label: '재고매입', num: true }, { key: 'acctBuy', label: '회계매입', num: true }, { key: 'payTotal', label: '지급합계', num: true },
    { key: 'balance', label: '잔액(채무)', num: true }, { key: 'unbilled', label: '미청구액', num: true },
  ];
  return [
    { key: 'refDate', label: '일자-No' }, { key: 'custName', label: '거래처명' }, { key: 'prodName', label: '품목명' },
    { key: 'qty', label: '수량', num: true }, { key: 'unitPrice', label: '단가(VAT포함)', num: true }, { key: 'supplyAmt', label: '공급가액', num: true },
    { key: 'vat', label: '부가세', num: true }, { key: 'total', label: '합계', num: true }, { key: 'memo', label: '적요' },
  ];
}

const s = {
  page: { padding: 16, maxWidth: 1600, margin: '0 auto' },
  h1: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' },
  desc: { fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 },
  tabs: { display: 'flex', gap: 6, marginBottom: 12 },
  tab: { background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#475569' },
  tabOn: { background: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', color: '#fff' },
  err: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 10, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 40, padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  banner: { display: 'flex', alignItems: 'center', gap: 12, border: '1px solid', borderRadius: 10, padding: '10px 14px' },
  checkGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 },
  checkCard: { border: '1px solid', borderRadius: 8, padding: '8px 10px', background: '#fff' },
  checkBody: { fontSize: 12, color: '#334155', marginTop: 3 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { position: 'sticky', top: 0, background: '#1e293b', color: '#fff', padding: '6px 8px', whiteSpace: 'nowrap', fontSize: 11, zIndex: 1 },
  td: { border: '1px solid #eef2f7', padding: '4px 8px', whiteSpace: 'nowrap' },
};
