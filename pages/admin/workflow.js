// pages/admin/workflow.js
// 직원간 업무플로우 분석 대시보드 — 카카오(nenovakakao) 대화 + nenova.exe(ViewOrder) 매칭.
//   탭: 요약 / 요청→처리 / 직원 네트워크 / 이슈흐름. (읽기 전용)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();
const PALETTE = ['#1d4ed8', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#dc2626', '#ca8a04', '#4f46e5'];

// 가로 막대 차트 (SVG 없이 div 바)
function BarChart({ data, label, valueKey = 'count', max }) {
  const top = (data || []).slice(0, 12);
  const mx = max || Math.max(1, ...top.map(d => Math.abs(d[valueKey] || 0)));
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 8 }}>{label}</div>
      {top.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>데이터 없음</div>}
      {top.map((d, i) => (
        <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 70px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.key}>{d.key}</span>
          <div style={{ background: '#f1f5f9', borderRadius: 4, height: 16, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, (Math.abs(d[valueKey]) / mx) * 100)}%`, height: '100%', background: PALETTE[i % PALETTE.length], borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 11, textAlign: 'right', fontFamily: 'monospace', color: '#1e293b' }}>{fmt(d[valueKey])}{valueKey === 'qty' ? '' : '건'}</span>
        </div>
      ))}
    </div>
  );
}

// 발신자→처리담당자 흐름 (bipartite SVG)
function FlowGraph({ flow }) {
  const froms = [...new Set((flow || []).map(f => f.from))];
  const tos = [...new Set((flow || []).map(f => f.to))];
  if (!flow?.length) return <div style={{ color: '#94a3b8', fontSize: 12, padding: 20 }}>매칭된 요청→처리 흐름이 없습니다. (카카오 시트/매칭 필요)</div>;
  const W = 640, rowH = 34, H = Math.max(froms.length, tos.length) * rowH + 40;
  const yL = i => 30 + i * rowH, yR = i => 30 + i * rowH;
  const maxC = Math.max(1, ...flow.map(f => f.count));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <text x="90" y="18" fontSize="11" fontWeight="700" fill="#64748b" textAnchor="middle">요청(영업/카톡)</text>
      <text x={W - 90} y="18" fontSize="11" fontWeight="700" fill="#64748b" textAnchor="middle">처리(전산 담당)</text>
      {flow.map((f, i) => {
        const li = froms.indexOf(f.from), ri = tos.indexOf(f.to);
        return <line key={i} x1="160" y1={yL(li) + 5} x2={W - 160} y2={yR(ri) + 5}
          stroke="#94a3b8" strokeWidth={1 + (f.count / maxC) * 5} strokeOpacity="0.5" />;
      })}
      {froms.map((s, i) => (
        <g key={s}><rect x="20" y={yL(i) - 6} width="140" height="22" rx="11" fill="#dbeafe" stroke="#1d4ed8" />
          <text x="90" y={yL(i) + 9} fontSize="11" fill="#1e3a8a" textAnchor="middle">{s.slice(0, 12)}</text></g>
      ))}
      {tos.map((s, i) => (
        <g key={s}><rect x={W - 160} y={yR(i) - 6} width="140" height="22" rx="11" fill="#dcfce7" stroke="#16a34a" />
          <text x={W - 90} y={yR(i) + 9} fontSize="11" fill="#14532d" textAnchor="middle">{s.slice(0, 12)}</text></g>
      ))}
    </svg>
  );
}

// 직원 공동참여 네트워크 (원형 SVG)
function CoworkGraph({ cowork }) {
  const nodes = [...new Set((cowork || []).flatMap(e => [e.a, e.b]))];
  if (!nodes.length) return <div style={{ color: '#94a3b8', fontSize: 12, padding: 20 }}>공동 참여 데이터가 없습니다.</div>;
  const W = 520, cx = W / 2, cy = 230, R = 170;
  const pos = {}; nodes.forEach((n, i) => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; pos[n] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
  const maxC = Math.max(1, ...cowork.map(e => e.count));
  return (
    <svg width="100%" viewBox={`0 0 ${W} 470`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      {cowork.map((e, i) => (
        <line key={i} x1={pos[e.a].x} y1={pos[e.a].y} x2={pos[e.b].x} y2={pos[e.b].y}
          stroke="#a78bfa" strokeWidth={1 + (e.count / maxC) * 5} strokeOpacity="0.45" />
      ))}
      {nodes.map((n, i) => (
        <g key={n}>
          <circle cx={pos[n].x} cy={pos[n].y} r="9" fill={PALETTE[i % PALETTE.length]} />
          <text x={pos[n].x} y={pos[n].y - 13} fontSize="10" fill="#334155" textAnchor="middle">{n.slice(0, 10)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function WorkflowAnalysis() {
  const [tab, setTab] = useState('summary');
  const [week, setWeek] = useState('');
  const [room, setRoom] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d = await apiGet('/api/admin/workflow', { week, room });
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
    } catch (e) { setErr(e.message); setData(null); }
    finally { setLoading(false); }
  }, [week, room]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals || {};
  const rate = t.requests ? Math.round((t.processed / t.requests) * 100) : 0;

  return (
    <div style={{ padding: 16, maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>📊 직원간 업무플로우 분석</h1>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        카카오(nenovakakao) 대화 이벤트 ↔ nenova.exe(ViewOrder) 매칭 기반. 읽기 전용.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>차수</span>
        <input value={week} onChange={e => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} placeholder="전체" style={inp} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>카톡방</span>
        <input value={room} onChange={e => setRoom(e.target.value)} placeholder="전체 (예: 수입)" style={{ ...inp, width: 120 }} />
        <button onClick={load} disabled={loading} style={btnPrimary}>{loading ? '조회중…' : '조회'}</button>
      </div>

      {err && <div style={banner('#fef2f2', '#b91c1c')}>오류: {err}</div>}
      {data && !data.kakaoAvailable && (
        <div style={banner('#fffbeb', '#92400e')}>
          ⚠️ 카카오 Google Sheet 미연동 — 서버 환경변수 <b>GOOGLE_SERVICE_ACCOUNT_JSON</b>, <b>KAKAO_SHEET_ID</b> 설정 필요. ({data.kakaoError})
        </div>
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        <Kpi label="카톡 이벤트" v={t.events} />
        <Kpi label="업무 요청" v={t.requests} />
        <Kpi label="처리됨(매칭)" v={t.processed} tone="ok" />
        <Kpi label="미처리/미매칭" v={t.unprocessed} tone="warn" />
        <Kpi label="처리율" v={`${rate}%`} tone={rate >= 70 ? 'ok' : 'warn'} />
        <Kpi label="참여 직원" v={t.senders} />
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[['summary', '요약 대시보드'], ['tracking', '요청→처리 추적'], ['network', '직원 네트워크'], ['issues', '이슈 흐름']].map(([k, lab]) => (
          <button key={k} onClick={() => setTab(k)} style={tab === k ? tabOn : tabOff}>{lab}</button>
        ))}
      </div>

      {tab === 'summary' && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          <BarChart data={data.bySender} label="① 직원별 업무 활동 (발신자, 건수)" />
          <BarChart data={data.byWeek} label="② 차수별 이벤트 (건수)" />
          <BarChart data={data.byRoom} label="③ 카톡방별 (건수)" />
          <BarChart data={data.byType} label="④ 이벤트 유형별 (건수)" />
        </div>
      )}

      {tab === 'tracking' && data && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'auto', maxHeight: 560 }}>
          <table style={tbl}>
            <thead><tr>{['시각', '발신자', '차수', '품목', '수량', '방향', '거래처', '매칭', '처리담당자'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {(data.tracking || []).length === 0 && <tr><td colSpan="9" style={empty}>요청 데이터가 없습니다.</td></tr>}
              {(data.tracking || []).map((r, i) => (
                <tr key={i} style={{ background: r.processed ? '#fff' : '#fffaf0' }}>
                  <td style={td}>{(r.time || '').slice(5, 16)}</td>
                  <td style={td}>{r.sender}</td>
                  <td style={td}>{r.week}</td>
                  <td style={td}>{r.product}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{r.quantity}{r.unit}</td>
                  <td style={{ ...td, color: r.direction === '-' ? '#dc2626' : '#16a34a' }}>{r.direction === '-' ? '취소' : '추가'}</td>
                  <td style={td}>{r.supplier}</td>
                  <td style={td}>{r.processed
                    ? <span style={chip('#dcfce7', '#166534')}>처리 {r.matchScore}</span>
                    : <span style={chip('#fee2e2', '#991b1b')}>미매칭</span>}</td>
                  <td style={td}>{r.processedBy || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'network' && data && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={secTitle}>요청 → 처리 흐름 (영업/카톡 발신자 → 전산 처리담당자)</div>
            <FlowGraph flow={data.network?.flow} />
          </div>
          <div>
            <div style={secTitle}>직원 공동참여 네트워크 (같은 대화 thread 참여 = 연결)</div>
            <CoworkGraph cowork={data.network?.cowork} />
          </div>
        </div>
      )}

      {tab === 'issues' && data && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'auto', maxHeight: 560 }}>
          {(data.decisions || []).length === 0
            ? <div style={empty}>의사결정/이슈 추적 데이터가 없습니다. (카카오 시트 의사결정추적 탭)</div>
            : (
              <table style={tbl}>
                <thead><tr>{Object.keys(data.decisions[0]).slice(0, 9).map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.decisions.map((d, i) => (
                    <tr key={i}>{Object.keys(data.decisions[0]).slice(0, 9).map(h => <td key={h} style={td} title={d[h]}>{String(d[h] || '').slice(0, 40)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, v, tone }) {
  const c = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#ea580c' : '#1e293b';
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v == null ? '-' : v}</div>
    </div>
  );
}

const inp = { width: 70, minHeight: 32, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 13, textAlign: 'center' };
const btnPrimary = { minHeight: 32, padding: '0 16px', background: '#1d4ed8', color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer' };
const tabOn = { padding: '6px 14px', borderRadius: 16, border: '1px solid #1d4ed8', background: '#1d4ed8', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const tabOff = { padding: '6px 14px', borderRadius: 16, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th = { position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontWeight: 800, color: '#475569', whiteSpace: 'nowrap' };
const td = { borderBottom: '1px solid #f1f5f9', padding: '5px 8px', color: '#1e293b', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' };
const empty = { padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 };
const secTitle = { fontSize: 13, fontWeight: 800, color: '#334155', margin: '0 0 6px' };
const chip = (bg, c) => ({ fontSize: 11, fontWeight: 800, background: bg, color: c, borderRadius: 6, padding: '1px 7px' });
const banner = (bg, c) => ({ background: bg, color: c, border: `1px solid ${c}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 });
