// pages/incoming-price/ledger.js — 송금 기록 + 크레딧 차감 통합 내역 (팝업/단독)
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';

const fmtUSD = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDtm = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function RemitLedgerPage() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [remits, setRemits] = useState([]);
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | remit | credit
  const [farmSearch, setFarmSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    // 둘 중 하나가 실패해도 나머지는 표시 (부분 오류만 안내)
    Promise.allSettled([
      fetch(`/api/incoming-price/remit?year=${year}`, { credentials: 'same-origin' }).then(r => r.json()),
      fetch('/api/incoming-price/credit-history', { credentials: 'same-origin' }).then(r => r.json()),
    ])
      .then(([rm, cr]) => {
        const errs = [];
        if (rm.status === 'fulfilled' && rm.value.success) setRemits(rm.value.remits || []);
        else errs.push(`송금 기록: ${rm.value?.error || rm.reason?.message || '조회 실패'}`);
        if (cr.status === 'fulfilled' && cr.value.success) {
          setCredits((cr.value.history || []).filter(h => !h.isDeleted && (Number(h.CreditUSD) || 0) !== 0));
        } else errs.push(`크레딧 이력: ${cr.value?.error || cr.reason?.message || '조회 실패'}`);
        setError(errs.join(' / '));
      })
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const deleteRemit = async (key) => {
    if (!confirm('이 송금 기록을 삭제하시겠습니까?')) return;
    const res = await fetch('/api/incoming-price/remit', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key }),
    });
    const d = await res.json();
    if (d.success) load();
    else alert(d.error || '삭제 실패');
  };

  // 통합 행: 송금(remit) + 크레딧(credit) — 일자 내림차순
  // ⚠ FarmCredit 에는 연도 컬럼이 없어 크레딧은 전 기간 표시 (차수 라벨로 구분)
  const rows = [
    ...remits.map(r => ({
      type: 'remit', key: `r${r.key}`, remitKey: r.key,
      date: r.remitDate || (r.createDtm || '').slice(0, 10),
      farm: r.farmName, weeks: r.weeks, amount: Number(r.amountUSD) || 0,
      memo: r.memo, by: r.createId,
    })),
    ...credits.map((c, i) => ({
      type: 'credit', key: `c${i}`,
      date: fmtDtm(c.ChangeDtm),
      farm: c.FarmName, weeks: c.OrderWeek, amount: Number(c.CreditUSD) || 0,
      memo: c.Memo, by: '',
    })),
  ]
    .filter(x => typeFilter === 'all' || x.type === typeFilter)
    .filter(x => !farmSearch.trim() || String(x.farm || '').toLowerCase().includes(farmSearch.trim().toLowerCase()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.key).localeCompare(String(a.key)));

  const remitTotal = rows.filter(x => x.type === 'remit').reduce((s, x) => s + x.amount, 0);
  const creditTotal = rows.filter(x => x.type === 'credit').reduce((s, x) => s + x.amount, 0);
  const farmCount = new Set(rows.map(x => x.farm)).size;

  return (
    <>
      <Head><title>송금/크레딧 내역 — nenova ERP</title></Head>
      <div style={{ fontFamily: 'Arial, sans-serif', background: '#f8f9fa', minHeight: '100vh', padding: '0 0 40px' }}>
        {/* 헤더 */}
        <div style={{
          background: 'linear-gradient(to right, #000080, #1084d0)',
          color: '#fff', padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>📒 송금 기록 / 크레딧 차감 내역</span>
          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>nenova ERP</span>
          <button onClick={() => window.close()}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 3 }}>
            닫기
          </button>
        </div>

        <div style={{ padding: '16px 20px', maxWidth: 1100, margin: '0 auto' }}>
          {/* 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div style={{ background: '#e8f5e9', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1b5e20' }}>💸 총 송금액 ({year}년)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#1b5e20' }}>{fmtUSD(remitTotal)}</div>
            </div>
            <div style={{ background: '#fff3e0', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e65100' }}>크레딧 차감 합계</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e65100' }}>- {fmtUSD(creditTotal)}</div>
            </div>
            <div style={{ background: '#e3f2fd', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0d47a1' }}>농장 수</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0d47a1' }}>{farmCount}</div>
            </div>
          </div>

          {/* 필터 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={year} onChange={e => setYear(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid #bbb', borderRadius: 4, fontSize: 13 }}>
              {[0, 1, 2].map(i => {
                const y = String(new Date().getFullYear() - i);
                return <option key={y} value={y}>{y}년 송금</option>;
              })}
            </select>
            {[['all', '전체'], ['remit', '💸 송금만'], ['credit', '크레딧만']].map(([v, label]) => (
              <button key={v} onClick={() => setTypeFilter(v)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                  border: typeFilter === v ? '2px solid #1a237e' : '1px solid #bbb',
                  background: typeFilter === v ? '#1a237e' : '#fff',
                  color: typeFilter === v ? '#fff' : '#333', fontWeight: typeFilter === v ? 700 : 400,
                }}>
                {label}
              </button>
            ))}
            <input value={farmSearch} onChange={e => setFarmSearch(e.target.value)} placeholder="농장 검색…"
              style={{ padding: '5px 10px', border: '1px solid #bbb', borderRadius: 4, fontSize: 13, width: 180 }} />
            <button onClick={load}
              style={{ padding: '5px 12px', borderRadius: 4, border: '1px solid #1a237e', background: '#fff', color: '#1a237e', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              🔄 새로고침
            </button>
          </div>

          {error && <div style={{ padding: 12, background: '#ffebee', color: '#b71c1c', borderRadius: 6, marginBottom: 10 }}>{error}</div>}
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>로딩 중…</div>}

          {!loading && (
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#1a237e', color: '#fff' }}>
                    <th style={th(90)}>일자</th>
                    <th style={th(70)}>구분</th>
                    <th style={th(200, 'left')}>농장</th>
                    <th style={th(90)}>차수</th>
                    <th style={th(110, 'right')}>금액(USD)</th>
                    <th style={th(null, 'left')}>비고</th>
                    <th style={th(70)}>작성</th>
                    <th style={th(40)}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#999' }}>표시할 내역이 없습니다.</td></tr>
                  )}
                  {rows.map(x => (
                    <tr key={x.key} style={{ borderBottom: '1px solid #f0f0f0', background: x.type === 'remit' ? '#fbfffb' : '#fffaf3' }}>
                      <td style={td('center', { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })}>{x.date || '—'}</td>
                      <td style={td('center')}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: x.type === 'remit' ? '#e8f5e9' : '#fff3e0',
                          color: x.type === 'remit' ? '#1b5e20' : '#e65100',
                        }}>
                          {x.type === 'remit' ? '💸 송금' : '크레딧'}
                        </span>
                      </td>
                      <td style={td('left', { fontWeight: 600 })}>{x.farm}</td>
                      <td style={td('center', { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })}>{x.weeks || '—'}</td>
                      <td style={td('right', {
                        fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                        color: x.type === 'remit' ? '#1b5e20' : '#e65100',
                      })}>
                        {x.type === 'credit' ? '- ' : ''}{fmtUSD(x.amount)}
                      </td>
                      <td style={td('left', { color: '#555', whiteSpace: 'pre-wrap' })}>{x.memo || ''}</td>
                      <td style={td('center', { fontSize: 11, color: '#999' })}>{x.by || ''}</td>
                      <td style={td('center')}>
                        {x.type === 'remit' && (
                          <button onClick={() => deleteRemit(x.remitKey)} title="송금 기록 삭제"
                            style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 13 }}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11, color: '#999' }}>
            💸 송금 기록은 [입고단가/농장송금] 화면의 송금 필요 패널에서 추가합니다. 크레딧 차감은 같은 화면의 크레딧 입력칸에서 관리하며, 여기서는 조회만 됩니다.
          </div>
        </div>
      </div>
    </>
  );
}

function th(w, align = 'center') {
  return { ...(w ? { width: w, minWidth: w } : {}), padding: '8px 8px', textAlign: align, fontSize: 12, fontWeight: 700 };
}
function td(align = 'center', extra = {}) {
  return { padding: '7px 8px', textAlign: align, ...extra };
}
