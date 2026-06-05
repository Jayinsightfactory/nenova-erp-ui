// pages/admin/workflow.js
// 직원간 업무플로우 분석 — nenovakakao 기획(파이프라인+흐름+라이프사이클+이슈) 풀반영.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();
const P = ['#1d4ed8', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#dc2626', '#ca8a04', '#4f46e5'];

function Bar({ data, label, vk = 'count', unit = '건' }) {
  const top = (data || []).slice(0, 12);
  const mx = Math.max(1, ...top.map(d => Math.abs(d[vk] || 0)));
  return (
    <div style={card}>
      <div style={cardTitle}>{label}</div>
      {top.length === 0 && <div style={muted}>데이터 없음</div>}
      {top.map((d, i) => (
        <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 64px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={lbl} title={d.key}>{d.key}</span>
          <div style={track}><div style={{ width: `${Math.max(2, (Math.abs(d[vk]) / mx) * 100)}%`, height: '100%', background: P[i % P.length], borderRadius: 4 }} /></div>
          <span style={numS}>{fmt(d[vk])}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function FlowGraph({ flow }) {
  const froms = [...new Set((flow || []).map(f => f.from))], tos = [...new Set((flow || []).map(f => f.to))];
  if (!flow?.length) return <div style={muted}>매칭된 요청→처리 흐름이 없습니다.</div>;
  const W = 640, rh = 34, H = Math.max(froms.length, tos.length) * rh + 40, y = i => 30 + i * rh, maxC = Math.max(1, ...flow.map(f => f.count));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgBox}>
      <text x="90" y="16" fontSize="11" fontWeight="700" fill="#64748b" textAnchor="middle">요청(영업/카톡)</text>
      <text x={W - 90} y="16" fontSize="11" fontWeight="700" fill="#64748b" textAnchor="middle">처리(전산 담당)</text>
      {flow.map((f, i) => <line key={i} x1="160" y1={y(froms.indexOf(f.from)) + 5} x2={W - 160} y2={y(tos.indexOf(f.to)) + 5} stroke="#94a3b8" strokeWidth={1 + (f.count / maxC) * 5} strokeOpacity="0.5" />)}
      {froms.map((s, i) => <g key={s}><rect x="20" y={y(i) - 6} width="140" height="22" rx="11" fill="#dbeafe" stroke="#1d4ed8" /><text x="90" y={y(i) + 9} fontSize="11" fill="#1e3a8a" textAnchor="middle">{s.slice(0, 12)}</text></g>)}
      {tos.map((s, i) => <g key={s}><rect x={W - 160} y={y(i) - 6} width="140" height="22" rx="11" fill="#dcfce7" stroke="#16a34a" /><text x={W - 90} y={y(i) + 9} fontSize="11" fill="#14532d" textAnchor="middle">{s.slice(0, 12)}</text></g>)}
    </svg>
  );
}

function CoworkGraph({ cowork }) {
  const nodes = [...new Set((cowork || []).flatMap(e => [e.a, e.b]))];
  if (!nodes.length) return <div style={muted}>공동 참여 데이터가 없습니다.</div>;
  const W = 520, cx = W / 2, cy = 230, R = 170, pos = {};
  nodes.forEach((n, i) => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; pos[n] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
  const maxC = Math.max(1, ...cowork.map(e => e.count));
  return (
    <svg width="100%" viewBox={`0 0 ${W} 470`} style={svgBox}>
      {cowork.map((e, i) => <line key={i} x1={pos[e.a].x} y1={pos[e.a].y} x2={pos[e.b].x} y2={pos[e.b].y} stroke="#a78bfa" strokeWidth={1 + (e.count / maxC) * 5} strokeOpacity="0.45" />)}
      {nodes.map((n, i) => <g key={n}><circle cx={pos[n].x} cy={pos[n].y} r="9" fill={P[i % P.length]} /><text x={pos[n].x} y={pos[n].y - 13} fontSize="10" fill="#334155" textAnchor="middle">{n.slice(0, 10)}</text></g>)}
    </svg>
  );
}

function Table({ cols, rows, render, empty = '데이터 없음', max = 520 }) {
  return (
    <div style={{ ...card, overflow: 'auto', maxHeight: max, padding: 0 }}>
      <table style={tbl}><thead><tr>{cols.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>{(!rows || rows.length === 0) ? <tr><td colSpan={cols.length} style={emptyTd}>{empty}</td></tr> : rows.map((r, i) => <tr key={i}>{render(r, i)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const TABS = [['pipeline', '🏭 파이프라인'], ['summary', '📊 요약'], ['flow', '🔄 흐름분석'], ['lifecycle', '♻ 라이프사이클'], ['issues', '⚠ 이슈'], ['people', '👥 직원·네트워크'], ['sql', '🔗 요청→처리(전산)']];

export default function WorkflowAnalysis() {
  const [tab, setTab] = useState('pipeline');
  const [week, setWeek] = useState(''); const [room, setRoom] = useState(''); const [stage, setStage] = useState('');
  const [d, setD] = useState(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0); const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setProgress(4);
    if (timer.current) clearInterval(timer.current);
    // 경과시간 기반 추정 진행률(서버가 실시간 %를 주지 않으므로 95%까지 점근, 완료 시 100%)
    timer.current = setInterval(() => setProgress(p => Math.min(95, p + Math.max(0.5, (95 - p) * 0.05))), 200);
    try { const r = await apiGet('/api/admin/workflow', { week, room, stage }); if (!r.success) throw new Error(r.error); setD(r); }
    catch (e) { setErr(e.message); setD(null); }
    finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      setProgress(100); setLoading(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, [week, room, stage]);
  useEffect(() => { load(); return () => { if (timer.current) clearInterval(timer.current); }; }, [load]);

  const stageMsg = progress < 30 ? '① 카카오 대화 시트 읽는 중…' : progress < 65 ? '② 주문(ViewOrder) 매칭 중…' : progress < 100 ? '③ 업무플로우 분석 중…' : '완료';

  const t = d?.totals || {};
  const pRate = t.requests ? Math.round((t.processed / t.requests) * 100) : 0;
  const iRate = t.issues ? Math.round((t.resolved / t.issues) * 100) : 0;

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>📊 직원간 업무플로우 분석</h1>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>nenovakakao 대화(이벤트/이슈) + nenova.exe(ViewOrder) 매칭 · 파이프라인 IMPORT→QC→재고→발주→출고→현장. 읽기 전용.</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={flbl}>차수</span><input value={week} onChange={e => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} placeholder="전체" style={inp} />
        <span style={flbl}>카톡방</span><input value={room} onChange={e => setRoom(e.target.value)} placeholder="전체" style={{ ...inp, width: 110 }} />
        <span style={flbl}>단계</span>
        <select value={stage} onChange={e => setStage(e.target.value)} style={{ ...inp, width: 120 }}>
          <option value="">전체</option>
          {['IMPORT', 'QC', 'INVENTORY', 'ORDER', 'DISTRIBUTE', 'FIELD', 'SYSTEM'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} disabled={loading} style={btn}>{loading ? `조회중 ${Math.round(progress)}%` : '조회'}</button>
      </div>

      {loading && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
            <span>{stageMsg}</span><b style={{ color: '#1d4ed8' }}>{Math.round(progress)}%</b>
          </div>
          <div style={{ height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg,#1d4ed8,#3b82f6)', borderRadius: 5, transition: 'width .2s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>카톡 데이터량·주문 매칭에 따라 수 초~수십 초 걸릴 수 있습니다.</div>
        </div>
      )}

      {err && <div style={banner('#fef2f2', '#b91c1c')}>오류: {err}</div>}
      {d && !d.kakaoAvailable && <div style={banner('#fffbeb', '#92400e')}>⚠️ 카카오 Google Sheet 미연동 — 서버 env <b>GOOGLE_SERVICE_ACCOUNT_JSON</b>, <b>KAKAO_SHEET_ID</b> 설정 필요. ({d.kakaoError})</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
        <Kpi label="대화 로그" v={t.logs} /><Kpi label="업무 이벤트" v={t.events} /><Kpi label="업무 요청" v={t.requests} />
        <Kpi label="전산 처리율" v={`${pRate}%`} tone={pRate >= 70 ? 'ok' : 'warn'} /><Kpi label="참여 직원" v={t.senders} />
        <Kpi label="미해결 이슈" v={t.unresolved} tone={t.unresolved ? 'warn' : 'ok'} /><Kpi label="이슈 해결율" v={`${iRate}%`} tone={iRate >= 70 ? 'ok' : 'warn'} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {TABS.map(([k, lab]) => <button key={k} onClick={() => setTab(k)} style={tab === k ? tabOn : tabOff}>{lab}</button>)}
      </div>

      {!d ? null : (<>
        {tab === 'pipeline' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {(d.stageBoard || []).map((s, i) => (
                <div key={s.key} style={{ ...card, borderTop: `3px solid ${P[i % P.length]}` }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{s.name}<span style={{ color: '#94a3b8', fontWeight: 600 }}> · {s.key}</span></div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', margin: '2px 0' }}>{fmt(s.events)}<span style={{ fontSize: 12, color: '#64748b' }}> 이벤트</span></div>
                  <div style={{ fontSize: 11, color: '#475569' }}>변경 {s.change} · <span style={{ color: '#dc2626' }}>불량 {s.defect}</span> · <span style={{ color: '#ea580c' }}>미해결 {s.unresolved}</span></div>
                </div>
              ))}
            </div>
            <div style={{ ...muted, marginTop: 10 }}>단계는 카톡방→파이프라인 매핑(pipeline_config) 기준. 단계 필터로 좁혀보세요.</div>
          </div>
        )}

        {tab === 'summary' && (
          <div style={grid2}>
            <Bar data={d.bySender} label="① 직원별 업무 활동 (발신자)" />
            <Bar data={d.byStage} label="② 파이프라인 단계별" />
            <Bar data={d.byWeek} label="③ 차수별" />
            <Bar data={d.byType} label="④ 이벤트 유형별" />
            <Bar data={d.byRoom} label="⑤ 카톡방별" />
          </div>
        )}

        {tab === 'flow' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div><div style={secT}>① 발신자쌍 응답시간 (누가 누구에게, 평균 분)</div>
              <Table cols={['발신자', '→응답자', '전환', '평균(분)', '최대(분)']} rows={d.flow?.responsePairs}
                render={r => [<td key="1" style={td}>{r.from}</td>, <td key="2" style={td}>{r.to}</td>, <td key="3" style={tdR}>{r.turns}</td>, <td key="4" style={tdR}>{r.avgMin}</td>, <td key="5" style={tdR}>{r.maxMin}</td>]} max={300} />
            </div>
            <div><div style={secT}>② 대화 스레드 (방+차수+품목 · 참여자·지속)</div>
              <Table cols={['방', '차수', '품목', '메시지', '참여자', '지속(분)']} rows={d.flow?.threads}
                render={r => [<td key="1" style={td}>{r.room}</td>, <td key="2" style={td}>{r.week}</td>, <td key="3" style={td}>{r.product}</td>, <td key="4" style={tdR}>{r.msgs}</td>, <td key="5" style={td}>{(r.participants || []).join(', ')}</td>, <td key="6" style={tdR}>{r.durationMin ?? '-'}</td>]} max={300} />
            </div>
            <div><div style={secT}>③ 방간 정보전달 (출발방→도착방 소요)</div>
              <Table cols={['차수', '품목', '출발방', '최초발신자', '전달경로']} rows={d.flow?.crossRoom}
                render={r => [<td key="1" style={td}>{r.week}</td>, <td key="2" style={td}>{r.product}</td>, <td key="3" style={td}>{r.fromRoom}</td>, <td key="4" style={td}>{r.firstSender}</td>, <td key="5" style={td}>{(r.transfers || []).map(t => `${t.toRoom}(${t.delayMin}분/${t.by})`).join(' → ')}</td>]} max={300} />
            </div>
            <div><div style={secT}>④ 무응답 구간 (문의 후 5분+ 또는 무응답)</div>
              <Table cols={['방', '문의자', '시각', '대기(분)', '응답자', '내용']} rows={d.flow?.noResponse}
                render={r => [<td key="1" style={td}>{r.room}</td>, <td key="2" style={td}>{r.asker}</td>, <td key="3" style={td}>{r.time}</td>, <td key="4" style={{ ...tdR, color: r.waitMin === '무응답' ? '#dc2626' : '#ea580c', fontWeight: 700 }}>{r.waitMin}</td>, <td key="5" style={td}>{r.responder || '-'}</td>, <td key="6" style={td} title={r.summary}>{(r.summary || '').slice(0, 30)}</td>]} max={300} />
            </div>
          </div>
        )}

        {tab === 'lifecycle' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Bar data={(d.lifecycle?.byChasu || []).map(c => ({ key: `${c.week}차`, count: c.defect }))} label="차수별 불량(DEFECT) 건수" />
            <div><div style={secT}>차수별 라이프사이클 (변경/불량)</div>
              <Table cols={['차수', '총이벤트', '발주변경', '불량']} rows={d.lifecycle?.byChasu}
                render={r => [<td key="1" style={td}>{r.week}차</td>, <td key="2" style={tdR}>{r.total}</td>, <td key="3" style={tdR}>{r.change}</td>, <td key="4" style={{ ...tdR, color: r.defect ? '#dc2626' : '#475569' }}>{r.defect}</td>]} max={260} />
            </div>
            <div><div style={secT}>품목별 불량률</div>
              <Table cols={['품목', '언급', '불량', '불량률%', '거래처별 불량']} rows={d.lifecycle?.itemDefects}
                render={r => [<td key="1" style={td}>{r.item}</td>, <td key="2" style={tdR}>{r.mentions}</td>, <td key="3" style={tdR}>{r.defects}</td>, <td key="4" style={{ ...tdR, color: r.rate > 20 ? '#dc2626' : '#475569' }}>{r.rate}%</td>, <td key="5" style={td}>{Object.entries(r.byTrader || {}).map(([k, v]) => `${k}:${v}`).join(', ')}</td>]} max={220} />
            </div>
            <div style={card}>
              <div style={cardTitle}>주문변경 → 불량 전환율</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: (d.lifecycle?.conversion?.rate || 0) > 30 ? '#dc2626' : '#16a34a' }}>{d.lifecycle?.conversion?.rate || 0}%</div>
              <div style={muted}>변경 차수·품목 조합 {d.lifecycle?.conversion?.total || 0}건 중 {d.lifecycle?.conversion?.withDefect || 0}건에서 이후 불량 발생</div>
            </div>
          </div>
        )}

        {tab === 'issues' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={grid2}><Bar data={d.issues?.byStage} label="미해결 이슈 — 단계별" /><Bar data={d.issues?.byRoom} label="미해결 이슈 — 방별" /></div>
            <div><div style={secT}>미해결 이슈 체인 ({d.issues?.unresolved || 0} / 전체 {d.issues?.total || 0})</div>
              <Table cols={['시각', '발생방', '단계', '이슈내용', '대응자', '결과']} rows={d.issues?.list}
                render={r => [<td key="1" style={td}>{r.time}</td>, <td key="2" style={td}>{r.room}</td>, <td key="3" style={td}>{r.pipeline}</td>, <td key="4" style={td} title={r.content}>{(r.content || '').slice(0, 40)}</td>, <td key="5" style={td}>{r.responder || '-'}</td>, <td key="6" style={{ ...td, color: '#dc2626' }}>{r.result}</td>]} />
            </div>
          </div>
        )}

        {tab === 'people' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div><div style={secT}>직원별 업무 (역할/단계 · 활동·요청·불량보고·응답)</div>
              <Table cols={['이름', '역할', '단계', '이벤트', '요청', '불량보고', '이슈응답']} rows={d.people}
                render={r => [<td key="1" style={{ ...td, fontWeight: 700 }}>{r.name}</td>, <td key="2" style={td}>{r.role || '-'}</td>, <td key="3" style={td}>{r.stage || '-'}</td>, <td key="4" style={tdR}>{r.events}</td>, <td key="5" style={tdR}>{r.requests}</td>, <td key="6" style={{ ...tdR, color: r.defectsReported ? '#dc2626' : '#475569' }}>{r.defectsReported}</td>, <td key="7" style={tdR}>{r.responses}</td>]} max={320} />
            </div>
            <div><div style={secT}>요청 → 처리 흐름 (영업/카톡 → 전산 담당)</div><FlowGraph flow={d.network?.flow} /></div>
            <div><div style={secT}>직원 공동참여 네트워크 (같은 스레드 참여)</div><CoworkGraph cowork={d.network?.cowork} /></div>
          </div>
        )}

        {tab === 'sql' && (<>
          {d.sqlSkipped && <div style={banner('#eff6ff', '#1d4ed8')}>전산(ViewOrder) 매칭은 무거워서 <b>차수를 선택</b>해야 조회됩니다. 위 "차수"에 숫자(예: 23) 입력 후 조회하세요.</div>}
          <Table cols={['시각', '발신자', '차수', '품목', '수량', '방향', '거래처', '매칭', '처리담당자']} rows={d.tracking}
            render={r => [
              <td key="1" style={td}>{(r.time || '').slice(0, 16)}</td>, <td key="2" style={td}>{r.sender}</td>, <td key="3" style={td}>{r.week}</td>,
              <td key="4" style={td}>{r.product}</td>, <td key="5" style={tdR}>{r.quantity}{r.unit}</td>,
              <td key="6" style={{ ...td, color: r.direction === '-' ? '#dc2626' : '#16a34a' }}>{r.direction === '-' ? '취소' : '추가'}</td>,
              <td key="7" style={td}>{r.customer}</td>,
              <td key="8" style={td}>{r.processed ? <span style={chip('#dcfce7', '#166534')}>처리 {r.matchScore}</span> : <span style={chip('#fee2e2', '#991b1b')}>미매칭</span>}</td>,
              <td key="9" style={td}>{r.processedBy || '-'}</td>]} />
        </>)}
      </>)}
    </div>
  );
}

function Kpi({ label, v, tone }) {
  const c = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#ea580c' : '#1e293b';
  return <div style={card}><div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v == null ? '-' : v}</div></div>;
}

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' };
const cardTitle = { fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 8 };
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 };
const muted = { color: '#94a3b8', fontSize: 12, padding: 8 };
const lbl = { fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const track = { background: '#f1f5f9', borderRadius: 4, height: 16, overflow: 'hidden' };
const numS = { fontSize: 11, textAlign: 'right', fontFamily: 'monospace', color: '#1e293b' };
const inp = { width: 70, minHeight: 32, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 13, textAlign: 'center' };
const flbl = { fontSize: 12, fontWeight: 700, color: '#475569' };
const btn = { minHeight: 32, padding: '0 16px', background: '#1d4ed8', color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer' };
const tabOn = { padding: '6px 12px', borderRadius: 16, border: '1px solid #1d4ed8', background: '#1d4ed8', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const tabOff = { padding: '6px 12px', borderRadius: 16, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th = { position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontWeight: 800, color: '#475569', whiteSpace: 'nowrap' };
const td = { borderBottom: '1px solid #f1f5f9', padding: '5px 8px', color: '#1e293b', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' };
const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' };
const emptyTd = { padding: 22, textAlign: 'center', color: '#94a3b8', fontSize: 13 };
const secT = { fontSize: 13, fontWeight: 800, color: '#334155', margin: '0 0 6px' };
const svgBox = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const chip = (bg, c) => ({ fontSize: 11, fontWeight: 800, background: bg, color: c, borderRadius: 6, padding: '1px 7px' });
const banner = (bg, c) => ({ background: bg, color: c, border: `1px solid ${c}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 });
