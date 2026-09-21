// pages/my-work.js
// 내 작업 데이터 — nenovaSS3 전용(민감: 직원 관측데이터). pages/admin/orbit-report.js 와 같은 게이트(404 은닉).
// 탭1 업무 통합본: Orbit(/work-unified.html)을 iframe으로 띄워 항상 최신 통합본. Orbit 로그인은 그 안에서 1회.
// 탭2 기능 추가 후보: 관찰 데이터(매뉴얼·화면 해독·전산 기록)로 뽑은 nenovaweb 기능 후보 + 근거(data/work-feature-proposals.json, 파일만).
// 탭3 Orbit 전체: /my-work.html(작업 흐름·시간표·화면 타임라인 등).
import fs from 'fs';
import path from 'path';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';

const ORBIT = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';

// 스토리보드(10MB)는 프로세스 안에 한 번만 파싱해 두고 파일 수정 시각이 바뀌면 다시 읽는다
let _sb = { mtime: 0, data: null };
function readStoryboards() {
  const f = path.join(process.cwd(), 'data', 'work-feature-storyboards.json');
  try {
    const m = fs.statSync(f).mtimeMs;
    if (m !== _sb.mtime) _sb = { mtime: m, data: JSON.parse(fs.readFileSync(f, 'utf8')) };
    return _sb.data;
  } catch { return null; }
}

export async function getServerSideProps({ req, query }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) return { notFound: true };
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', f), 'utf8')); } catch { return null; } };
  // 스토리보드 파일은 10MB(장면마다 창 제목·입력·전산 융합) → 선택된 사람·제안·세션의 장면만 내려보내고 나머지는 목차만
  const full = readStoryboards();
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
        {board.summary.products?.length > 0 && <div className="dim">화면에 자주 보인 품목: {board.summary.products.join(' · ')}</div>}
        {board.summary.customers?.length > 0 && <div className="dim">화면에 자주 보인 거래처: {board.summary.customers.join(' · ')}</div>}
        {board.summary.autoAreas?.length > 0 && <div><b>해독기가 반복해서 자동화 가능이라 본 영역:</b> {board.summary.autoAreas.join(' · ')}</div>}
        <div className="dim">읽힌 화면 필드값 {board.summary.fieldsWithValue ?? 0}개 · 읽힌 표 {board.summary.tables ?? 0}개</div>
      </div>}
      {!sess ? <p className="warn">이 제안에 맞는 관찰 세션이 없습니다(키워드 미검출). 매뉴얼·전산 기록 근거만 있음.</p> : <>
        <div className="jump">{board.sessions.map((s, i) => <a key={i} href="#" className={i === boards.si ? 'on' : ''} onClick={(e) => { e.preventDefault(); go({ s: i }); }}>{s.from} ~ {s.to.slice(6)} <em>{s.minutes}분 · {s.frames}장면 · 해당 {s.hits}</em></a>)}</div>
        <div className="sum">
          <b>세션 요약</b> {sess.day} {sess.from.slice(6)}~{sess.to.slice(6)} ({sess.minutes}분) · 장면 {sess.frames} · 캡처 {sess.captures}장 · 클릭 {sess.clicksTotal}회 · 업무앱 입력 {sess.typedTotal}건 · 자동화 가능 {sess.automatable}장면
          {Object.keys(sess.erp || {}).length > 0 && <span> · 같은 시간대 전산 저장: {Object.entries(sess.erp).map(([k, v]) => `${k} ${v}건`).join(', ')}</span>}
          <div className="dim">앱별 체류: {sess.apps.join(' · ')}</div>
          {sess.stages && Object.keys(sess.stages).length > 0 && <div className="dim">사업 단계(장면 수): {Object.entries(sess.stages).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
          {(sess.cycles?.length > 0 || sess.products?.length > 0 || sess.customers?.length > 0) && <div className="dim">{sess.cycles?.length > 0 && <span>차수 {sess.cycles.join(', ')} · </span>}{sess.customers?.length > 0 && <span>거래처 {sess.customers.join(', ')} · </span>}{sess.products?.length > 0 && <span>품목 {sess.products.join(', ')}</span>}</div>}
          <div className="dim">읽힌 필드값 {sess.fieldsWithValue ?? 0}개 · 표 {sess.tablesTotal ?? 0}개</div>
        </div>
        <h3 className="tog" onClick={() => setOpenAll((v) => !v)}>{openAll ? '▾' : '▸'} 세션 서사(장면 {sess.frames}개를 순서대로 이어 쓴 설명)</h3>
        {openAll && <pre className="narr">{sess.narrative}</pre>}
        <h3>장면 카드 — 시각 · 앱 · 화면 · 행동 · 창 흐름 · 입력 · 전산 · 힌트</h3>
        <div className="filmv">{sess.steps.map((st, i) => (
          <div key={i} className={'framev' + (st.hit ? ' hit' : '')}>
            <div className="fhead"><span className="no">{i + 1}</span><span className="t">{st.t}</span>{st.dur > 0 && <span className="dim">{st.dur}분 체류</span>}<span className="app">{st.app}</span>{st.trig && <span className="chip">{st.trig}</span>}{st.hit && <span className="dot">● 제안 관련</span>}{st.auto && <span className="chip auto">자동화 가능</span>}</div>
            <div className="screen">{st.screen || '(화면 제목 없음)'}</div>
            <div className="act">{st.act}</div>
            {(st.stage || st.purpose || st.from || st.to || st.output) && <div className="sub kv">
              {st.stage && <span><b>단계</b> {st.stage}</span>}{st.purpose && <span><b>목적</b> {st.purpose}</span>}{st.from && <span><b>입력 출처</b> {st.from}</span>}{st.to && <span><b>전달처</b> {st.to}</span>}{st.output && <span><b>결과물</b> {st.output}</span>}
            </div>}
            {(st.cycle || st.farm || st.customers?.length > 0 || st.products?.length > 0 || st.qty?.length > 0 || st.amounts?.length > 0) && <div className="sub kv">
              <b>화면에 보인 것</b>{st.cycle && <span>차수 {st.cycle}</span>}{st.farm && <span>농장 {st.farm}</span>}{st.customers?.length > 0 && <span>거래처 {st.customers.join(', ')}</span>}{st.products?.length > 0 && <span>품목 {st.products.join(', ')}</span>}{st.qty?.length > 0 && <span>수량 {st.qty.join(', ')}</span>}{st.amounts?.length > 0 && <span>금액 {st.amounts.join(', ')}</span>}
            </div>}
            {st.fields?.length > 0 && <div className="sub"><b>화면 필드 ({st.fields.length})</b><table className="ft"><tbody>{st.fields.map((f, j) => <tr key={j}><td className="dim">{f.type}</td><td>{f.name}</td><td className="val">{f.value || <span className="dim">—</span>}</td><td className="dim">{f.src}{f.xy ? ` · 클릭(${f.xy})` : ''}</td><td className="dim">{f.human ? '사람: ' + (f.why || '판단 필요') : '자동 가능'}</td></tr>)}</tbody></table></div>}
            {st.tables?.length > 0 && st.tables.map((tb, j) => <div className="sub" key={j}><b>표 {tb.name}</b>{tb.truncated && <span className="dim"> (일부)</span>}<div className="tw"><table className="ft"><thead><tr>{tb.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead><tbody>{tb.rows.map((r, k) => <tr key={k}>{r.map((c, m) => <td key={m}>{c}</td>)}</tr>)}</tbody></table></div></div>)}
            {(st.done || st.change || st.next) && <div className="sub kv">{st.done && <span><b>완료 동작</b> {st.done}</span>}{st.change && <span><b>직전 대비 변화</b> {st.change}</span>}{st.next && <span><b>다음 예상</b> {st.next}</span>}</div>}
            {(st.autoAreas?.length > 0 || st.humanAreas?.length > 0) && <div className="sub kv">{st.autoAreas?.length > 0 && <span className="ok"><b>자동화 가능</b> {st.autoAreas.join(' · ')}</span>}{st.humanAreas?.length > 0 && <span><b>사람 판단</b> {st.humanAreas.join(' · ')}</span>}</div>}
            {st.nenovaAction && <div className="sub dim">전산 동작: {st.nenovaAction}{st.inputMap?.length > 0 ? ' · 입력맵 ' + st.inputMap.join(' | ') : ''}</div>}
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

// nenovaweb 화면 재생 — rrweb 기록(화면 구조+클릭·입력·이동)을 그대로 재생. 화면 해독이 아니라 실제 기록이라 값이 정확하다.
// 왼쪽: 세션 목록 → 재생기, 오른쪽: 단계 목록(이동·클릭·입력값). 단계를 누르면 그 시각으로 이동.
function Replay() {
  const [sessions, setSessions] = useState(null);
  const [cur, setCur] = useState(null);
  const [msg, setMsg] = useState('');
  const boxRef = useRef(null), playerRef = useRef(null);
  useEffect(() => { fetch('/api/work/replay?list=1').then((r) => r.json()).then((j) => setSessions(j.sessions || [])).catch(() => setSessions([])); }, []);
  const fmt = (t) => new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const open = async (s) => {
    setMsg('불러오는 중…'); setCur(null);
    try {
      const j = await (await fetch(`/api/work/replay?user=${encodeURIComponent(s.userId)}&session=${encodeURIComponent(s.sessionId)}`)).json();
      if (!j.success) throw new Error(j.error || '실패');
      // 큰 화면·메모리 부족 구간은 lite(단계만)로 기록된다 → 화면 구조(전체 스냅샷)가 있는 지점부터만 재생기에 넣는다
      const start = j.events.findIndex((e) => e.type === 4);
      const playable = start >= 0 && j.events.some((e) => e.type === 2) ? j.events.slice(start) : [];
      if (boxRef.current) boxRef.current.innerHTML = '';
      if (playable.length < 2) { setCur({ ...s, steps: j.meta?.steps || [], t0: j.events[0]?.timestamp || s.from }); setMsg('이 세션은 단계만 기록됐습니다(화면이 크거나 PC 메모리 여유가 적어 화면 구조 기록을 생략). 오른쪽 단계 목록을 보세요.'); return; }
      const [{ default: Player }] = await Promise.all([import('rrweb-player'), import('rrweb-player/dist/style.css')]);
      const w = Math.min(1100, (boxRef.current?.clientWidth || 1000));
      playerRef.current = new Player({ target: boxRef.current, props: { events: playable, width: w, height: Math.round(w * 0.56), autoPlay: false, showController: true, speedOption: [1, 2, 4, 8], skipInactive: true } });
      setCur({ ...s, steps: j.meta?.steps || [], t0: playable[0].timestamp }); setMsg('');
    } catch (e) { setMsg('불러오기 실패: ' + e.message); }
  };
  const seek = (t) => { try { playerRef.current?.goto(Math.max(0, t - cur.t0 - 500), false); } catch {} };
  const KIND = { route: '이동', click: '클릭', input: '입력', mode: '기록 방식' };
  return (
    <div className="doc wide">
      <h1>nenovaweb 화면 재생</h1>
      <p className="dim">네노바웹에서 한 작업을 화면 구조와 클릭·입력·이동 이벤트로 기록해 그대로 재생합니다(영상·화면 해독 아님, 값이 정확). 기록 대상: 직원 계정 전부(사장님·관리 계정 제외). 비밀번호 입력은 항상 가립니다. 보관 14일.</p>
      {sessions === null ? <p className="dim">목록 불러오는 중…</p> : sessions.length === 0 ? <p className="warn">아직 기록된 세션이 없습니다. 네노바웹의 다른 메뉴에서 작업한 뒤 다시 열어 보세요(이 화면과 로그인 화면은 기록하지 않습니다).</p> :
        <div className="jump">{sessions.map((s) => <a key={s.userId + s.sessionId} href="#" className={cur?.sessionId === s.sessionId ? 'on' : ''} onClick={(e) => { e.preventDefault(); open(s); }}>{fmt(s.from)} <em>{s.userName || s.userId} · {Math.max(1, Math.round((s.to - s.from) / 60000))}분 · 단계 {s.stepCount} · {(s.size / 1024 / 1024).toFixed(1)}MB · {s.routes.slice(0, 4).join(' → ')}{s.routes.length > 4 ? ' …' : ''}</em></a>)}</div>}
      {msg && <p className="warn">{msg}</p>}
      <div className="rp">
        <div className="rpl" ref={boxRef} />
        {cur && <div className="rpr"><b>단계 {cur.steps.length}</b>
          <ol>{cur.steps.map((st, i) => <li key={i} onClick={() => seek(st.t)} className={'k-' + st.kind}><span className="t2">{fmt(st.t).slice(-8)}</span><span className="chip">{KIND[st.kind] || st.kind}</span> {st.kind === 'route' ? st.path : <>{st.label || <span className="dim">({st.tag})</span>}{st.kind === 'input' && <span className="val"> = {st.value}</span>}<span className="dim"> · {st.path}</span></>}</li>)}</ol>
        </div>}
      </div>
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
    { id: 'replay', label: 'nenovaweb 화면 재생' },
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
        {tab === 'replay' && <Replay />}
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
        .rp{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-top:10px}.rpl{flex:1 1 640px;min-width:0}
        .rpr{flex:0 0 380px;max-height:720px;overflow:auto;border:1px solid #2c3340;border-radius:8px;background:#12151c;padding:8px 10px;font-size:12px}
        .rpr ol{margin:6px 0 0;padding-left:22px}.rpr li{margin:3px 0;cursor:pointer;line-height:1.45}.rpr li:hover{color:#58a6ff}.rpr .val{color:#e3b341}.rpr li.k-route{color:#79c0ff}
        .kv span{display:block;margin:2px 0}.kv b{color:#98a1b2;font-weight:600;margin-right:6px}.kv .ok{color:#3fb950}
        .ft{border-collapse:collapse;font-size:11px;margin-top:4px}.ft th,.ft td{border:1px solid #262b35;padding:2px 6px;text-align:left;vertical-align:top}.ft th{background:#171a21;color:#98a1b2}
        .ft .val{color:#e3b341;max-width:320px;word-break:break-all}.tw{overflow-x:auto}
        .doc .ft tbody tr,.doc .ft tbody tr:nth-child(even){background:#0e1016!important}.doc .ft td{background:transparent!important;color:#e7eaf0!important}
        .bars{display:inline-flex;width:180px;height:10px;border-radius:3px;overflow:hidden;vertical-align:middle;background:#1f2430}
        .bars i{display:block;height:100%}
        .s0{background:#58a6ff}.s1{background:#3fb950}.s2{background:#d29922}.s3{background:#f778ba}.s4{background:#a371f7}.s5{background:#79c0ff}.s6{background:#56d364}.s7{background:#ffa657}.s8{background:#ff7b72}.s9{background:#8b949e}.s10{background:#6e7681}.s11{background:#484f58}
      `}</style>
    </div>
  );
}
