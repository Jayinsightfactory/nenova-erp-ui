// ECOUNT 자동 대사 — 웹 순매출(확정일 기준) vs ECOUNT 판매현황을 거래처·품목별로 대조.
// 매달 차이 큰 항목만 자동으로 뜬다(수입품 전표 타이밍 등 잔차 추적).
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지.
import { useState, useEffect, useCallback, Fragment } from 'react';

const fmt = (n) => Number(n || 0).toLocaleString();
const won = (n) => `${fmt(Math.round(n))}`;

function defaultMonth() {
  // 기본 = 지난달(마감 대사 대상). 브라우저 로컬 날짜 기준.
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const diffColor = (d) => (Math.abs(d) < 1000 ? '#16a34a' : d > 0 ? '#dc2626' : '#2563eb');

export default function EcountReconcilePage() {
  const [month, setMonth] = useState(defaultMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // 펼친 거래처 (normalized name index)
  const [onlyDiff, setOnlyDiff] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setOpen(null);
    try {
      const res = await fetch(`/api/ecount/reconcile?month=${encodeURIComponent(month)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const s = data?.summary;
  const rows = (data?.byCust || []).filter((c) => (onlyDiff ? Math.abs(c.diff) >= 1000 : true));

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>🔁 ECOUNT 자동 대사</h1>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
        웹 <b>순매출(확정일 기준 = ECOUNT 전표일자, 정상출고 − 차감)</b> vs <b>ECOUNT 판매현황(스크랩)</b>을 거래처·품목별로 대조합니다.
        차이 큰 항목만 위로 뜨므로, 월 마감 대사 시 "이번 달 차이가 어디서 났는지" 바로 확인됩니다.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>대상 월</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 10px', fontSize: 14 }} />
        <button onClick={load} disabled={loading}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {loading ? '대사 중…' : '대사 실행'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569', marginLeft: 6 }}>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          차이 있는 거래처만
        </label>
        {data?.snapshotKey && <span style={{ fontSize: 11, color: '#94a3b8' }}>ECOUNT 스냅샷 #{data.snapshotKey}</span>}
      </div>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>⚠️ {err}</div>}
      {data?.noEcount && <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>스크랩된 ECOUNT 판매 데이터가 없습니다. ECOUNT 수집 데몬을 먼저 실행하세요.</div>}

      {s && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: '웹 순매출(공급가)', value: won(s.web) },
            { label: 'ECOUNT 공급가', value: won(s.ecount) },
            { label: '총 차이', value: `${s.diff > 0 ? '+' : ''}${won(s.diff)}`, color: diffColor(s.diff) },
            { label: '일치 거래처', value: fmt(s.matchedCustCount) },
            { label: '차이 거래처', value: fmt(s.diffCustCount), color: s.diffCustCount ? '#dc2626' : '#16a34a' },
          ].map((c) => (
            <div key={c.label} style={{ flex: '1 1 130px', minWidth: 120, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: c.color || '#0f172a', fontFamily: 'ui-monospace,monospace' }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {data && !data.noEcount && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '6px 12px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #eef2f7', background: '#f8fafc' }}>
            거래처를 클릭하면 <b>품목별 웹 vs ECOUNT 차이</b>가 펼쳐집니다. (차이 큰 순 · 초록=일치)
          </div>
          <div style={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: '7px 12px' }}>거래처</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px' }}>웹 순매출</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px' }}>ECOUNT</th>
                  <th style={{ textAlign: 'right', padding: '7px 12px' }}>차이</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>✓ 차이 있는 거래처가 없습니다 — 완전 일치</td></tr>
                )}
                {rows.map((c, i) => {
                  const isOpen = open === i;
                  return (
                    <Fragment key={i}>
                      <tr onClick={() => setOpen(isOpen ? null : i)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #eef2f7', background: isOpen ? '#eff6ff' : undefined }}>
                        <td style={{ padding: '7px 12px', fontWeight: 700 }}>
                          <span style={{ color: '#94a3b8', marginRight: 6 }}>{isOpen ? '▾' : '▸'}</span>{c.name}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{won(c.web)}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{won(c.ecount)}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, fontFamily: 'ui-monospace,monospace', color: diffColor(c.diff) }}>
                          {c.diff > 0 ? '+' : ''}{won(c.diff)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0, background: '#f8fafc' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ color: '#64748b' }}>
                                  <th style={{ textAlign: 'left', padding: '4px 12px 4px 34px' }}>품목</th>
                                  <th style={{ textAlign: 'right', padding: '4px 12px' }}>웹</th>
                                  <th style={{ textAlign: 'right', padding: '4px 12px' }}>ECOUNT</th>
                                  <th style={{ textAlign: 'right', padding: '4px 12px' }}>차이</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.items.length === 0 && (
                                  <tr><td colSpan={4} style={{ padding: '6px 34px', color: '#94a3b8' }}>품목 단위 차이 없음(총액만 차이 — 전표 타이밍 등)</td></tr>
                                )}
                                {c.items.map((it, j) => (
                                  <tr key={j} style={{ borderTop: '1px solid #eef2f7' }}>
                                    <td style={{ padding: '4px 12px 4px 34px' }}>{it.name}</td>
                                    <td style={{ padding: '4px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{won(it.web)}</td>
                                    <td style={{ padding: '4px 12px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{won(it.ecount)}</td>
                                    <td style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace,monospace', color: diffColor(it.diff) }}>
                                      {it.diff > 0 ? '+' : ''}{won(it.diff)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, lineHeight: 1.6 }}>
        · 웹은 <b>확정일(=ECOUNT 전표일자, 차수 확정 화요일)</b> 기준이라 날짜가 ECOUNT와 정렬됩니다.
        남는 차이는 대개 <b>수입품(호접란 등)의 ECOUNT 전표 타이밍</b>(출고차수와 다른 결제·정산일)입니다 — 웹 데이터 오류가 아니라 ECOUNT 계상 시점 차이입니다.
        · 정확한 금액 대사는 <b>차수 기준</b>이 기준값(웹=전산 일치).
      </p>
    </div>
  );
}
