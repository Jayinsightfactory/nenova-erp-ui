// pages/my-work.js
// 내 작업 데이터 — nenovaSS3 전용(민감: 직원 관측데이터). pages/admin/orbit-report.js 와 같은 게이트(404 은닉).
// 탭1 업무 통합본: Orbit(/work-unified.html)을 iframe으로 띄워 항상 최신 통합본. Orbit 로그인은 그 안에서 1회.
// 탭2 기능 추가 후보: 관찰 데이터(매뉴얼·화면 해독·전산 기록)로 뽑은 nenovaweb 기능 후보 + 근거(data/work-feature-proposals.json, 파일만).
// 탭3 Orbit 전체: /my-work.html(작업 흐름·시간표·화면 타임라인 등).
import fs from 'fs';
import path from 'path';
import { useState } from 'react';
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';

const ORBIT = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';

export async function getServerSideProps({ req }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) return { notFound: true };
  let data = null;
  try { data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'work-feature-proposals.json'), 'utf8')); } catch { data = null; }
  return { props: { userId: user.userId, data, orbit: ORBIT } };
}

const STAGES = ['발주', '입고', '분배', '현장출고', '견적서', '거래처전달', '입금', '해외송금', '이익', '메신저', '엑셀', '기타'];
const sum = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);

function Bars({ m }) {
  const tot = sum(m); if (!tot) return <span className="dim">—</span>;
  return (
    <span className="bars" title={STAGES.filter((s) => m[s]).map((s) => `${s} ${m[s]}`).join(' · ')}>
      {STAGES.filter((s) => m[s]).map((s) => <i key={s} className={'s' + STAGES.indexOf(s)} style={{ width: (100 * m[s] / tot) + '%' }} />)}
    </span>
  );
}

function Person({ p }) {
  const [open, setOpen] = useState({ manuals: false, samples: false, farms: false });
  const t = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const months = Object.keys(p.month).sort();
  return (
    <section className="person" id={'p-' + p.name}>
      <h2>{p.name} <small>{p.dept}</small></h2>
      <div className="stats">
        <div><b>전산 기록</b> {p.erpTotal.toLocaleString()}건 {months.map((m) => <span key={m} className="chip">{m.slice(5)}월 {STAGES.filter((s) => p.month[m][s]).map((s) => `${s} ${p.month[m][s]}`).join('·')}</span>)}</div>
        {p.vis
          ? <div><b>화면 해독</b> {p.vis.events}건 <Bars m={p.vis.stages} /> <span className="dim">{Object.entries(p.vis.countries).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c} ${n}`).join(' · ')}</span></div>
          : <div><b>화면 해독</b> <span className="warn">없음 (PC 미연결)</span></div>}
        {Object.keys(p.country).length > 0 && <div><b>입고 국가(월별)</b> {Object.keys(p.country).sort().map((m) => <span key={m} className="chip">{m.slice(5)}월 {Object.entries(p.country[m]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join('·')}</span>)}</div>}
      </div>

      <h3>추가할 수 있는 네노바웹 기능</h3>
      <table className="tbl">
        <thead><tr><th style={{ width: '40%' }}>관찰된 수작업 (근거)</th><th>추가 가능한 기능</th><th style={{ width: 150 }}>메뉴</th><th style={{ width: 54 }}>우선</th></tr></thead>
        <tbody>{p.proposals.rows.map((r, i) => (
          <tr key={i}><td>{r.observed}</td><td>{r.proposal}</td><td className="dim">{r.menu}</td><td><span className={'pri p' + r.priority}>{'★'.repeat(r.priority)}</span></td></tr>
        ))}</tbody>
      </table>
      {p.proposals.note && <p className="warn">{p.proposals.note}</p>}

      {p.manuals.length > 0 && <>
        <h3 className="tog" onClick={() => t('manuals')}>{open.manuals ? '▾' : '▸'} 근거 1 · 관찰로 복원한 업무 매뉴얼 {p.manuals.length}건</h3>
        {open.manuals && p.manuals.map((m, i) => (
          <div className="manual" key={i}>
            <b>{m.title}</b> <span className="dim">{m.frequency}</span>
            <div className="dim">도구: {(m.tools || []).join(', ')}</div>
            <ol>{(m.steps || []).map((s, j) => <li key={j}>{s}</li>)}</ol>
          </div>
        ))}
      </>}
      {p.samples.length > 0 && <>
        <h3 className="tog" onClick={() => t('samples')}>{open.samples ? '▾' : '▸'} 근거 2 · 화면 해독 샘플(요일·시각별 최다 장면) {p.samples.length}건</h3>
        {open.samples && <table className="tbl small"><thead><tr><th>요일</th><th>시</th><th>단계</th><th>건</th><th>장면</th></tr></thead>
          <tbody>{p.samples.map((s, i) => <tr key={i}><td>{s.day}</td><td>{s.hour}</td><td>{s.stage}</td><td>{s.n}</td><td>{s.sample}</td></tr>)}</tbody></table>}
      </>}
      {p.farms.length > 0 && <>
        <h3 className="tog" onClick={() => t('farms')}>{open.farms ? '▾' : '▸'} 근거 3 · 전산 입고 농장 {p.farms.length}곳</h3>
        {open.farms && <div className="chips">{p.farms.map((f, i) => <span key={i} className="chip">{f.farm} <em>{f.country}</em> {f.n}</span>)}</div>}
      </>}
    </section>
  );
}

function Proposals({ data }) {
  if (!data) return <p className="warn">data/work-feature-proposals.json 이 없습니다.</p>;
  return (
    <div className="doc">
      <h1>관찰 데이터로 뽑은 네노바웹 기능 추가 후보</h1>
      <p className="dim">전산 기록 {data.period?.start} ~ {data.period?.end} · 화면 해독 {data.visPeriod?.from} ~ {data.visPeriod?.to} · 생성 {String(data.generatedAt).slice(0, 10)} · AI 초안(직원 확인 전)</p>
      <p>{data.basis}</p>
      <h2>우선순위 (여러 사람이 같이 쓰는 것부터)</h2>
      <ol className="shared">{data.shared.map((s) => <li key={s.rank}><b>{s.title}</b> <span className="chip">{s.people.join(' · ')}</span><div className="dim">{s.why}</div></li>)}</ol>
      <div className="jump">{data.people.map((p) => <a key={p.name} href={'#p-' + p.name}>{p.name}</a>)}</div>
      {data.people.map((p) => <Person key={p.name} p={p} />)}
    </div>
  );
}

export default function MyWorkPage({ userId, data, orbit }) {
  const [tab, setTab] = useState('unified');
  const TABS = [
    { id: 'unified', label: '업무 통합본 (최신)' },
    { id: 'proposals', label: '기능 추가 후보 (조사)' },
    { id: 'orbit', label: 'Orbit 작업 데이터 전체' },
  ];
  return (
    <div className="wrap">
      <div className="bar">
        <MenuBackButton />
        <b>내 작업 데이터</b>
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        <span className="dim" style={{ marginLeft: 'auto' }}>{userId} 전용 · Orbit 통합본은 Orbit 관리자 로그인 1회 필요</span>
        <a href={orbit + '/my-work.html'} target="_blank" rel="noreferrer">새 창</a>
      </div>
      <div className="stage">
        {tab === 'unified' && <iframe title="업무 통합본" src={orbit + '/work-unified.html'} />}
        {tab === 'orbit' && <iframe title="Orbit 작업 데이터" src={orbit + '/my-work.html'} />}
        {tab === 'proposals' && <Proposals data={data} />}
      </div>
      <style jsx global>{`
        html,body{margin:0;height:100%}
        .wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#0e1016;color:#e7eaf0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;font-size:13px}
        .bar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 14px;background:#171a21;border-bottom:1px solid #262b35;flex-wrap:wrap}
        .bar button{background:#1f2430;color:#98a1b2;border:1px solid #2c3340;border-radius:6px;padding:5px 11px;cursor:pointer;font:inherit}
        .bar button.on{color:#fff;border-color:#58a6ff;background:#1c2633}
        .bar a{color:#98a1b2;border:1px solid #2c3340;border-radius:6px;padding:4px 9px;text-decoration:none;font-size:12px}
        .stage{flex:1 1 auto;min-height:0;position:relative;overflow:auto}
        .stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0e1016}
        .doc{max-width:1200px;margin:0 auto;padding:18px 22px 60px}
        .doc h1{font-size:20px;margin:0 0 6px}.doc h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #262b35;padding-bottom:4px}
        .doc h2 small{color:#98a1b2;font-weight:400;font-size:12px;margin-left:8px}
        .doc h3{font-size:13.5px;margin:16px 0 6px;color:#c9d1d9}.tog{cursor:pointer;user-select:none}.tog:hover{color:#58a6ff}
        .dim{color:#98a1b2}.warn{color:#e3b341}
        .chip{display:inline-block;background:#1f2430;border:1px solid #2c3340;border-radius:999px;padding:1px 8px;margin:2px 3px 2px 0;font-size:11.5px}
        .chip em{color:#98a1b2;font-style:normal}
        .chips{display:flex;flex-wrap:wrap}
        .stats div{margin:3px 0}
        .tbl{width:100%;border-collapse:collapse;font-size:12.5px}.tbl th,.tbl td{border:1px solid #262b35;padding:6px 8px;vertical-align:top;text-align:left}
        .tbl th{background:#171a21;color:#98a1b2;font-weight:600}.tbl.small{font-size:11.5px}
        .pri{color:#e3b341;white-space:nowrap}
        .manual{border:1px solid #262b35;border-radius:8px;padding:8px 12px;margin:6px 0;background:#12151c}
        .manual ol{margin:4px 0 0;padding-left:20px}.manual li{margin:2px 0}
        .shared li{margin:6px 0}
        .jump{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.jump a{color:#58a6ff;border:1px solid #2c3340;border-radius:6px;padding:3px 10px;text-decoration:none}
        .person{margin-top:28px;padding-top:6px}
        .bars{display:inline-flex;width:180px;height:10px;border-radius:3px;overflow:hidden;vertical-align:middle;background:#1f2430}
        .bars i{display:block;height:100%}
        .s0{background:#58a6ff}.s1{background:#3fb950}.s2{background:#d29922}.s3{background:#f778ba}.s4{background:#a371f7}.s5{background:#79c0ff}.s6{background:#56d364}.s7{background:#ffa657}.s8{background:#ff7b72}.s9{background:#8b949e}.s10{background:#6e7681}.s11{background:#484f58}
      `}</style>
    </div>
  );
}
