// pages/my-work.js
// 내 작업 데이터 — nenovaSS3 전용(민감: 직원 관측데이터). pages/admin/orbit-report.js 와 같은 게이트(404 은닉).
// 탭1 업무 통합본: Orbit(/work-unified.html)을 iframe으로 띄워 항상 최신 통합본. Orbit 로그인은 그 안에서 1회.
// 탭2 기능 추가 후보: 관찰 데이터(매뉴얼·화면 해독·전산 기록)로 뽑은 nenovaweb 기능 후보 + 근거(data/work-feature-proposals.json, 파일만).
// 탭3 Orbit 전체: /my-work.html(작업 흐름·시간표·화면 타임라인 등).
import fs from 'fs';
import path from 'path';
import { useState } from 'react';
import { useRouter } from 'next/router';
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';

const ORBIT = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';

export async function getServerSideProps({ req, query }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) return { notFound: true };
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', f), 'utf8')); } catch { return null; } };
  // 스토리보드 파일은 3MB(장면마다 창 제목·입력·전산 융합) → 선택된 사람·제안·세션의 장면만 내려보내고 나머지는 목차만
  const full = readJson('work-feature-storyboards.json');
  let boards = null;
  if (full) {
    const who = full.people.find((p) => p.name === query.who) || full.people[0];
    const bi = Math.min(Math.max(parseInt(query.b, 10) || 0, 0), who.boards.length - 1);
    const si = Math.min(Math.max(parseInt(query.s, 10) || 0, 0), Math.max((who.boards[bi]?.sessions.length || 1) - 1, 0));
    boards = {
      generatedAt: full.generatedAt, note: full.note,
      people: full.people.map((p) => ({ name: p.name, events: p.events, sessions: p.sessions })),
      who: who.name, bi, si,
      boardList: who.boards.map((b) => ({ title: b.title, matchedSessions: b.matchedSessions })),
      board: who.boards[bi] ? { ...who.boards[bi], sessions: who.boards[bi].sessions.map(({ steps, narrative, ...meta }) => meta) } : null,
      session: who.boards[bi]?.sessions[si] || null,
    };
  }
  return { props: { userId: user.userId, data: readJson('work-feature-proposals.json'), boards, orbit: ORBIT, tab: query.tab || 'unified' } };
}

// 캡처식 워크플로우 — 제안 하나를 고르면 실제 관찰 세션을 시간순 장면 필름으로 보여준다. 선택은 URL(?tab=story&who=&b=&s=)로 서버에서 잘라온다.
// 장면 = 화면 해독(화면·행동·힌트 전문) + 그 장면 동안의 창 제목 흐름 + 업무 앱 입력 내용(메신저 제외) + 같은 시간대 전산 저장 기록.
function Storyboards({ boards, data }) {
  const router = useRouter();
  const [openAll, setOpenAll] = useState(true);
  if (!boards) return <p className="warn">data/work-feature-storyboards.json 이 없습니다.</p>;
  const go = (q) => router.push({ pathname: '/my-work', query: { tab: 'story', who: boards.who, b: boards.bi, s: 0, ...q } }, undefined, { scroll: false });
  const { board, session: sess } = boards;
  const prop = data?.people?.find((p) => p.name === boards.who)?.proposals?.rows?.[boards.bi];
  return (
    <div className="doc wide">
      <h1>캡처식 워크플로우 — 제안 근거 장면</h1>
      <p className="dim">{boards.note} · 생성 {String(boards.generatedAt).slice(0, 10)}</p>
      <div className="jump">{boards.people.map((p) => <a key={p.name} href="#" className={p.name === boards.who ? 'on' : ''} onClick={(e) => { e.preventDefault(); go({ who: p.name, b: 0 }); }}>{p.name} <em>{p.events}장면 · {p.sessions}세션</em></a>)}</div>
      <div className="jump">{boards.boardList.map((b, i) => <a key={i} href="#" className={i === boards.bi ? 'on' : ''} onClick={(e) => { e.preventDefault(); go({ b: i }); }}>{b.title} <em>{b.matchedSessions}</em></a>)}</div>
      {prop && <div className="prop"><div><b>관찰된 수작업</b> {prop.observed}</div><div><b>제안</b> {prop.proposal} <span className="chip">{prop.menu}</span></div></div>}
      {board && <div className="sum">
        <b>이 제안의 관찰 총량</b> 세션 {board.matchedSessions} · {board.summary.minutes}분 · 장면 {board.summary.frames} · 자동화 가능 판정 {board.summary.automatable}장면
        <div className="dim">앱별 시간: {board.summary.apps.join(' · ')}</div>
        <div className="dim">주로 나오는 시각: {board.summary.hours.join(' · ')} · 검출 키워드: {board.keywords.join(', ')}</div>
      </div>}
      {!sess ? <p className="warn">이 제안에 맞는 관찰 세션이 없습니다(키워드 미검출). 매뉴얼·전산 기록 근거만 있음.</p> : <>
        <div className="jump">{board.sessions.map((s, i) => <a key={i} href="#" className={i === boards.si ? 'on' : ''} onClick={(e) => { e.preventDefault(); go({ s: i }); }}>{s.from} ~ {s.to.slice(6)} <em>{s.minutes}분 · {s.frames}장면 · 해당 {s.hits}</em></a>)}</div>
        <div className="sum">
          <b>세션 요약</b> {sess.day} {sess.from.slice(6)}~{sess.to.slice(6)} ({sess.minutes}분) · 장면 {sess.frames} · 캡처 {sess.captures}장 · 클릭 {sess.clicksTotal}회 · 업무앱 입력 {sess.typedTotal}건 · 자동화 가능 {sess.automatable}장면
          {Object.keys(sess.erp || {}).length > 0 && <span> · 같은 시간대 전산 저장: {Object.entries(sess.erp).map(([k, v]) => `${k} ${v}건`).join(', ')}</span>}
          <div className="dim">앱별 체류: {sess.apps.join(' · ')}</div>
        </div>
        <h3 className="tog" onClick={() => setOpenAll((v) => !v)}>{openAll ? '▾' : '▸'} 세션 서사(장면 {sess.frames}개를 순서대로 이어 쓴 설명)</h3>
        {openAll && <pre className="narr">{sess.narrative}</pre>}
        <h3>장면 카드 — 시각 · 앱 · 화면 · 행동 · 창 흐름 · 입력 · 전산 · 힌트</h3>
        <div className="filmv">{sess.steps.map((st, i) => (
          <div key={i} className={'framev' + (st.hit ? ' hit' : '')}>
            <div className="fhead"><span className="no">{i + 1}</span><span className="t">{st.t}</span>{st.dur > 0 && <span className="dim">{st.dur}분 체류</span>}<span className="app">{st.app}</span>{st.trig && <span className="chip">{st.trig}</span>}{st.hit && <span className="dot">● 제안 관련</span>}{st.auto && <span className="chip auto">자동화 가능</span>}</div>
            <div className="screen">{st.screen || '(화면 제목 없음)'}</div>
            <div className="act">{st.act}</div>
            {st.titles.length > 0 && <div className="sub"><b>창 흐름 ({st.titles.length})</b><ol>{st.titles.map((x, j) => <li key={j}><span className="t2">{x.t}</span> {x.lab}{x.trig ? <em> · {x.trig}</em> : null}</li>)}</ol></div>}
            {st.typed.length > 0 && <div className="sub"><b>업무 앱 입력 ({st.typed.length})</b><ol>{st.typed.map((x, j) => <li key={j}><span className="t2">{x.t}</span> <em>{x.app}</em> “{x.text}”</li>)}</ol></div>}
            {(st.erp.length > 0 || st.clicks > 0) && <div className="sub dim">{st.erp.length > 0 && <span>전산 저장(같은 시각): {st.erp.join(', ')} · </span>}클릭 {st.clicks}회</div>}
            {st.hint && <div className={'hint' + (st.auto ? ' auto' : '')}>{st.hint}</div>}
          </div>
        ))}</div>
      </>}
    </div>
  );
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

export default function MyWorkPage({ userId, data, boards, orbit, tab: tab0 }) {
  const [tab, setTab] = useState(tab0);
  const TABS = [
    { id: 'unified', label: '업무 통합본 (최신)' },
    { id: 'proposals', label: '기능 추가 후보 (조사)' },
    { id: 'story', label: '캡처식 워크플로우' },
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
        {tab === 'story' && <Storyboards boards={boards} data={data} />}
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
        /* 전역 CSS의 짝수행 흰 배경(글씨 안 보임) 차단 — 이 화면은 어두운 배경 고정 */
        .doc .tbl tbody tr,.doc .tbl tbody tr:nth-child(even),.doc .tbl tbody tr:hover{background:#0e1016!important}
        .doc .tbl td{background:transparent!important;color:#e7eaf0!important}
        .pri{color:#e3b341;white-space:nowrap}
        .manual{border:1px solid #262b35;border-radius:8px;padding:8px 12px;margin:6px 0;background:#12151c}
        .manual ol{margin:4px 0 0;padding-left:20px}.manual li{margin:2px 0}
        .shared li{margin:6px 0}
        .jump{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.jump a{color:#58a6ff;border:1px solid #2c3340;border-radius:6px;padding:3px 10px;text-decoration:none}
        .person{margin-top:28px;padding-top:6px}
        .jump a.on{background:#1c2633;border-color:#58a6ff;color:#fff}.jump a em{color:#98a1b2;font-style:normal;font-size:11px;margin-left:4px}
        .prop{border:1px solid #2c3340;border-radius:8px;padding:8px 12px;margin:8px 0 12px;background:#12151c}.prop div{margin:3px 0}
        .film{display:flex;gap:10px;overflow-x:auto;padding:8px 0 14px;scroll-snap-type:x proximity}
        .frame{flex:0 0 250px;scroll-snap-align:start;border:1px solid #2c3340;border-radius:10px;background:#12151c;padding:8px 10px;display:flex;flex-direction:column;gap:5px;min-height:170px}
        .frame.hit{border-color:#e3b341;box-shadow:0 0 0 1px #e3b34155}
        .fhead{display:flex;gap:6px;align-items:center;font-size:11px;color:#98a1b2}.fhead .t{font-weight:700;color:#e7eaf0}.fhead .app{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.fhead .dot{color:#e3b341}
        .screen{font-weight:600;font-size:12px;line-height:1.35;border-bottom:1px dashed #262b35;padding-bottom:4px}
        .act{font-size:11.5px;line-height:1.4;color:#c9d1d9}
        .hint{font-size:10.5px;color:#8b949e;margin-top:auto;padding-top:4px;border-top:1px dashed #262b35}.hint.auto{color:#3fb950}
        .doc.wide{max-width:1500px}
        .sum{border:1px solid #2c3340;border-radius:8px;padding:8px 12px;margin:8px 0;background:#12151c;font-size:12.5px}.sum div{margin-top:3px}
        .narr{white-space:pre-wrap;font:12.5px/1.55 inherit;background:#0b0d12;border:1px solid #262b35;border-radius:8px;padding:12px 14px;color:#c9d1d9;max-height:520px;overflow:auto}
        .filmv{display:flex;flex-direction:column;gap:10px;padding:6px 0 30px}
        .framev{border:1px solid #2c3340;border-radius:10px;background:#12151c;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
        .framev.hit{border-color:#e3b341;box-shadow:0 0 0 1px #e3b34155}
        .framev .fhead{font-size:12px;flex-wrap:wrap}.framev .no{background:#1f2430;border-radius:999px;padding:0 8px;font-weight:700}
        .framev .screen{font-size:13.5px}.framev .act{font-size:12.5px}
        .framev .sub{font-size:11.5px;color:#c9d1d9;border-top:1px dashed #262b35;padding-top:5px}.framev .sub ol{margin:3px 0 0;padding-left:20px}.framev .sub li{margin:1px 0}.framev .sub em{color:#8b949e;font-style:normal}
        .t2{color:#8b949e;font-variant-numeric:tabular-nums;margin-right:4px}
        .chip.auto{color:#3fb950;border-color:#3fb95066}
        .framev .hint{margin-top:2px;font-size:11.5px}
        .bars{display:inline-flex;width:180px;height:10px;border-radius:3px;overflow:hidden;vertical-align:middle;background:#1f2430}
        .bars i{display:block;height:100%}
        .s0{background:#58a6ff}.s1{background:#3fb950}.s2{background:#d29922}.s3{background:#f778ba}.s4{background:#a371f7}.s5{background:#79c0ff}.s6{background:#56d364}.s7{background:#ffa657}.s8{background:#ff7b72}.s9{background:#8b949e}.s10{background:#6e7681}.s11{background:#484f58}
      `}</style>
    </div>
  );
}
