// pages/my-work.js
// 내 작업 데이터 — nenovaSS3 전용(민감: 직원 관측데이터). pages/admin/orbit-report.js 와 같은 게이트(404 은닉).
// 탭0 업무 흐름(기본): data/work-feature-workflows.json — 직원별 흐름 카드 + 실제 캡처 썸네일(/api/work/orbit-thumbs) + 흐름 기준 인수인계 영상.
// 탭 기능 추가 후보: data/work-feature-simulations.json 이 있으면 지금↔적용 후 시뮬레이터, 없으면 텍스트 목록.
// 탭1 업무 통합본: Orbit(/work-unified.html)을 iframe으로 띄워 항상 최신 통합본. Orbit 로그인은 그 안에서 1회.
// 탭2 기능 추가 후보: 관찰 데이터(매뉴얼·화면 해독·전산 기록)로 뽑은 nenovaweb 기능 후보 + 근거(data/work-feature-proposals.json, 파일만).
// 탭3 Orbit 전체: /my-work.html(작업 흐름·시간표·화면 타임라인 등).
import fs from 'fs';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';
import { featureFilePath } from '../lib/workFeatureData';

const ORBIT = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';

// nenovaSS3 로그인만으로 Orbit 화면(통합본·작업 데이터)이 보이게: 서버가 ORBIT_OWNER_TOKEN 으로 12시간 열람 토큰을 받아
// iframe 주소(?token=)로 넘긴다. 토큰은 만료 1시간 전까지 프로세스에 캐시(발급 하루 2~3회). 실패하면 기존처럼 Orbit 로그인 화면.
let _viewer = { token: '', exp: 0 };
async function orbitViewerToken() {
  if (_viewer.token && Date.now() < _viewer.exp - 3600 * 1000) return _viewer.token;
  if (!process.env.ORBIT_OWNER_TOKEN) return '';
  try {
    const r = await fetch(ORBIT + '/api/auth/viewer-token', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.ORBIT_OWNER_TOKEN } });
    const j = await r.json();
    if (r.ok && j.token) _viewer = { token: j.token, exp: new Date(j.expiresAt).getTime() };
  } catch {}
  return _viewer.token;
}

// 스토리보드(16MB)는 프로세스 안에 한 번만 파싱해 두고 파일(경로·수정 시각)이 바뀌면 다시 읽는다.
// 경로는 매일 자동 갱신본(data/runtime) 우선 — lib/workFeatureData
let _sb = { key: '', data: null };
function readStoryboards() {
  const f = featureFilePath('storyboards');
  try {
    const key = f + '|' + fs.statSync(f).mtimeMs;
    if (key !== _sb.key) _sb = { key, data: JSON.parse(fs.readFileSync(f, 'utf8')) };
    return _sb.data;
  } catch { return null; }
}

export async function getServerSideProps({ req, query }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) return { notFound: true };
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
  let proposals = null; try { proposals = JSON.parse(fs.readFileSync(featureFilePath('proposals'), 'utf8')); } catch {}
  let workflows = null; try { workflows = JSON.parse(fs.readFileSync(featureFilePath('workflows'), 'utf8')); } catch {}
  let simulations = null; try { simulations = JSON.parse(fs.readFileSync(featureFilePath('simulations'), 'utf8')); } catch {}
  const viewerToken = await orbitViewerToken();
  return { props: { userId: user.userId, data: proposals, boards, workflows, simulations, orbit: ORBIT, orbitQs: viewerToken ? '?token=' + encodeURIComponent(viewerToken) : '', tab: query.tab || 'workflows' } };
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
        <HandoverVideo who={boards.who} title={board.title} steps={sess.steps} />
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

// 인수인계 영상 — 세션 장면을 슬라이드로 그려 한국어 음성 해설과 함께 자동 재생, webm 파일로 저장.
// 키 입력 내용(st.typed)은 개인 대화가 섞일 수 있어 영상에 넣지 않는다.
const wrapText = (ctx, text, maxW) => {
  const lines = []; let cur = '';
  for (const ch of String(text || '')) { if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
  if (cur) lines.push(cur); return lines;
};
function handoverScript(st) {
  return [st.screen && `화면은 ${st.screen}입니다.`, st.act && st.act + '.', st.purpose && `목적은 ${st.purpose}.`, st.from && `입력은 ${st.from}에서 받습니다.`, st.to && `결과는 ${st.to}로 넘어갑니다.`]
    .filter(Boolean).join(' ');
}
function drawSlide(ctx, W, H, who, title, st, i, n) {
  ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#7fb3ff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`${who} 인수인계 · ${title}`, 40, 50);
  ctx.fillStyle = '#9aa4b2'; ctx.font = '18px sans-serif'; ctx.fillText(`${i + 1} / ${n}  ·  ${st.t}${st.dur ? ` · ${st.dur}분` : ''}  ·  ${st.app || ''}${st.stage ? '  ·  단계 ' + st.stage : ''}`, 40, 84);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px sans-serif';
  let y = 150; for (const l of wrapText(ctx, st.screen || '(화면 제목 없음)', W - 80).slice(0, 2)) { ctx.fillText(l, 40, y); y += 46; }
  ctx.font = '26px sans-serif'; ctx.fillStyle = '#e6e9ee'; y += 10;
  for (const l of wrapText(ctx, st.act, W - 80).slice(0, 4)) { ctx.fillText(l, 40, y); y += 38; }
  ctx.font = '21px sans-serif'; y += 14;
  const rows = [['목적', st.purpose], ['입력 출처', st.from], ['전달처', st.to], ['결과물', st.output], ['화면에 보인 것', [st.cycle && '차수 ' + st.cycle, st.customers?.length && '거래처 ' + st.customers.slice(0, 4).join(', '), st.products?.length && '품목 ' + st.products.slice(0, 3).join(', ')].filter(Boolean).join(' · ')]];
  for (const [k, v] of rows) { if (!v || y > H - 110) continue; ctx.fillStyle = '#7fb3ff'; ctx.fillText(k, 40, y); ctx.fillStyle = '#c9ced6'; for (const l of wrapText(ctx, v, W - 240).slice(0, 2)) { ctx.fillText(l, 200, y); y += 30; } y += 6; }
  if (st.hint) { ctx.fillStyle = st.auto ? '#1f3d2a' : '#2a2f38'; ctx.fillRect(0, H - 76, W, 76); ctx.fillStyle = st.auto ? '#8fe0a8' : '#c9ced6'; ctx.font = '19px sans-serif'; ctx.fillText((st.auto ? '자동화 가능 · ' : '팁 · ') + wrapText(ctx, st.hint, W - 200)[0], 40, H - 32); }
  ctx.fillStyle = '#7fb3ff'; ctx.fillRect(0, H - 4, W * (i + 1) / n, 4);
}
function HandoverVideo({ who, title, steps }) {
  const cv = useRef(null); const run = useRef({ id: 0 });
  const [i, setI] = useState(0); const [state, setState] = useState('idle'); const [voice, setVoice] = useState(true); const [msg, setMsg] = useState('');
  const W = 1280, H = 720, n = steps.length;
  const draw = (k) => { const c = cv.current; if (c) drawSlide(c.getContext('2d'), W, H, who, title, steps[k], k, n); };
  useEffect(() => { draw(0); setI(0); stop(); }, [steps]);
  function stop() { run.current.id++; if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); setState('idle'); }
  const say = (text, id) => new Promise((res) => {
    const ms = Math.min(Math.max(text.length * 110, 4000), 15000);
    if (!voice || !window.speechSynthesis) return setTimeout(res, ms);
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.05;
    const t = setTimeout(res, ms + 8000); u.onend = u.onerror = () => { clearTimeout(t); res(); };
    if (run.current.id === id) window.speechSynthesis.speak(u); else res();
  });
  async function play(from = i) {
    stop(); const id = ++run.current.id; setState('play');
    for (let k = from; k < n; k++) { if (run.current.id !== id) return; setI(k); draw(k); await say(handoverScript(steps[k]), id); }
    if (run.current.id === id) setState('idle');
  }
  async function record() {
    stop(); const c = cv.current; if (!c.captureStream || !window.MediaRecorder) { setMsg('이 브라우저는 영상 저장을 지원하지 않습니다(크롬/엣지 사용).'); return; }
    const id = ++run.current.id; setState('rec'); setMsg('영상 만드는 중… 장면마다 약 6초');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }); const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.start();
    // 캔버스는 다시 그릴 때만 프레임이 나온다 → 녹화 중엔 0.2초마다 현재 장면을 다시 그려 영상 길이를 채운다
    let cur = 0; const tick = setInterval(() => draw(cur), 200);
    for (let k = 0; k < n; k++) { if (run.current.id !== id) break; cur = k; setI(k); draw(k); await new Promise((r) => setTimeout(r, 6000)); }
    clearInterval(tick);
    rec.onstop = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); a.download = `인수인계_${who}_${title}.webm`.replace(/[\\/:*?"<>|]/g, '_'); a.click(); setMsg(run.current.id === id ? '저장 완료(음성 없는 자막 영상)' : '중단됨'); setState('idle'); };
    rec.stop();
  }
  const jump = (d) => { stop(); const k = Math.min(Math.max(i + d, 0), n - 1); setI(k); draw(k); };
  if (!n) return null;
  return (
    <div className="sum">
      <b>인수인계 영상</b> <span className="dim">장면 {n}개 · 음성 해설 자동 재생 · 키 입력 내용은 제외</span>
      <canvas ref={cv} width={W} height={H} style={{ width: '100%', maxWidth: 960, display: 'block', margin: '8px 0', borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => jump(-1)} disabled={state === 'rec'}>◀ 이전</button>
        {state === 'play' ? <button type="button" onClick={stop}>■ 멈춤</button> : <button type="button" onClick={() => play()} disabled={state === 'rec'}>▶ 재생</button>}
        <button type="button" onClick={() => jump(1)} disabled={state === 'rec'}>다음 ▶</button>
        <label><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> 음성 해설</label>
        {state === 'rec' ? <button type="button" onClick={stop}>녹화 중단</button> : <button type="button" onClick={record}>영상 파일로 저장(.webm)</button>}
        <span className="dim">{i + 1}/{n} {msg}</span>
      </div>
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

// ───────────────────────── 탭 '업무 흐름' ─────────────────────────
// data/work-feature-workflows.json — 직원별 역할·주간 리듬·업무 흐름 카드(계기→받는 것→단계→판단→결과물)·확인 필요 질문.
const BIZ9 = ['발주', '입고', '분배', '현장출고', '견적서', '거래처전달', '입금', '해외송금', '이익'];
const confScore = (c) => (typeof c === 'number' ? c : typeof c === 'string' ? ({ high: 0.85, medium: 0.6, mid: 0.6, low: 0.3 }[c.toLowerCase()] ?? parseFloat(c)) : NaN);
const pct = (v) => { const n = confScore(v); return Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : null; };
function ConfBadge({ v, label }) {
  const p = pct(v); if (p == null) return null;
  return <span className={'conf ' + (p >= 70 ? 'hi' : p >= 40 ? 'mid' : 'lo')} title={label || '신뢰도'}>{p}%</span>;
}
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const fmtTs = (t) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t || '') : d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); };

function useThumbs(uid, on) {
  const [st, setSt] = useState({ loading: false, items: null, error: '' });
  useEffect(() => {
    if (!on || !uid) return undefined;
    let dead = false; setSt({ loading: true, items: null, error: '' });
    fetch(`/api/work/orbit-thumbs?user=${encodeURIComponent(uid)}&hours=168&limit=60`).then((r) => r.json())
      .then((j) => { if (!dead) setSt({ loading: false, items: j.items || [], error: j.success ? '' : (j.error || '실패') }); })
      .catch((e) => { if (!dead) setSt({ loading: false, items: [], error: e.message }); });
    return () => { dead = true; };
  }, [uid, on]);
  return st;
}

function CaptureGrid({ uid, thumbs }) {
  if (!uid) return <p className="warn">이 직원은 Orbit 계정(uid)이 연결되지 않아 캡처 화면을 불러올 수 없습니다.</p>;
  if (thumbs.loading) return <p className="dim">캡처 화면 불러오는 중…</p>;
  if (thumbs.error && !thumbs.items?.length) return <p className="warn">캡처 화면을 불러오지 못했습니다({thumbs.error}). 캡처는 있으나 해독 안 됨이거나 Orbit 인증이 필요할 수 있습니다.</p>;
  if (!thumbs.items?.length) return <p className="warn">최근 7일 캡처는 있으나 해독 안 됨 — 해독된 화면이 0건입니다(분석 큐 대기 또는 PC 미연결).</p>;
  const byDay = {};
  for (const t of thumbs.items) { const d = String(t.timestamp).slice(0, 10); (byDay[d] = byDay[d] || []).push(t); }
  return Object.entries(byDay).map(([d, list]) => (
    <div key={d}><div className="dim" style={{ margin: '6px 0 4px' }}>{d} · {list.length}장</div>
      <div className="thumbs">{list.map((t) => (
        <figure key={t.id} className="thumb" title={[t.screen, t.activity, t.hint].filter(Boolean).join('\n')}>
          <img loading="lazy" src={`/api/work/orbit-thumbs?img=${encodeURIComponent(t.id)}`} alt={t.screen || t.app} />
          <figcaption><span className="t2">{fmtTs(t.timestamp).slice(-5)}</span>{t.app} · {t.screen || t.activity}</figcaption>
        </figure>))}</div>
    </div>));
}

// 업무 흐름 → 슬라이드(역할/계기/단계별/판단/결과물) + 캡처 썸네일을 그려 넣은 인수인계 영상
function workflowSlides(person, wf, thumbs) {
  const s = [{ kicker: '역할', title: `${person.name} · ${person.dept || ''}`, lines: [person.roleSummary] },
    { kicker: '계기 · 받는 것', title: wf.name, lines: [`계기: ${wf.trigger || '확인되지 않음'}`, `받는 것: ${arr(wf.inputs).join(', ') || '—'}`, wf.why && `왜: ${wf.why}`].filter(Boolean) }];
  arr(wf.steps).forEach((st, i) => s.push({ kicker: `단계 ${i + 1} / ${arr(wf.steps).length}`, title: wf.name, lines: [st] }));
  if (arr(wf.decisions).length) s.push({ kicker: '판단', title: wf.name, lines: arr(wf.decisions) });
  s.push({ kicker: '결과물 · 넘기는 곳', title: wf.name, lines: [...arr(wf.outputs), ...arr(wf.pitfalls).map((p) => '주의: ' + p)] });
  const imgs = thumbs || [];
  if (imgs.length) s.forEach((x, i) => { x.img = imgs[Math.floor(i * imgs.length / s.length)]; });
  return s;
}
function drawWfSlide(ctx, W, H, sl, i, n, img) {
  ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
  const textW = img ? W * 0.52 : W - 80;
  ctx.fillStyle = '#7fb3ff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(sl.kicker, 40, 54);
  ctx.fillStyle = '#9aa4b2'; ctx.font = '18px sans-serif'; ctx.fillText(`${i + 1} / ${n}`, W - 110, 54);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif';
  let y = 116; for (const l of wrapText(ctx, sl.title, textW).slice(0, 2)) { ctx.fillText(l, 40, y); y += 44; }
  ctx.font = '23px sans-serif'; ctx.fillStyle = '#e6e9ee'; y += 12;
  for (const line of sl.lines) { for (const l of wrapText(ctx, line, textW).slice(0, 5)) { if (y > H - 50) break; ctx.fillText(l, 40, y); y += 34; } y += 10; }
  if (img && img.complete && img.naturalWidth) {
    const bx = W * 0.58, bw = W * 0.39, bh = Math.min(H - 180, bw * img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, bx, 100, bw, bh);
    ctx.strokeStyle = '#2c3340'; ctx.strokeRect(bx, 100, bw, bh);
    ctx.fillStyle = '#9aa4b2'; ctx.font = '16px sans-serif';
    ctx.fillText(wrapText(ctx, `실제 화면 ${fmtTs(sl.img.timestamp)} · ${sl.img.screen || sl.img.app}`, bw)[0], bx, 100 + bh + 26);
  }
  ctx.fillStyle = '#7fb3ff'; ctx.fillRect(0, H - 4, W * (i + 1) / n, 4);
}
function WorkflowVideo({ person, wf, thumbs, onClose }) {
  const cv = useRef(null); const run = useRef({ id: 0 }); const imgs = useRef({});
  const slides = workflowSlides(person, wf, thumbs);
  const n = slides.length; const W = 1280, H = 720;
  const [i, setI] = useState(0); const [playing, setPlaying] = useState(false);
  const imgFor = (sl) => {
    if (!sl.img) return null;
    let im = imgs.current[sl.img.id];
    if (!im) { im = new Image(); im.src = `/api/work/orbit-thumbs?img=${encodeURIComponent(sl.img.id)}`; im.onload = () => draw(iRef.current); imgs.current[sl.img.id] = im; }
    return im;
  };
  const iRef = useRef(0);
  const draw = (k) => { const c = cv.current; if (c) drawWfSlide(c.getContext('2d'), W, H, slides[k], k, n, imgFor(slides[k])); };
  useEffect(() => { iRef.current = 0; draw(0); return () => { run.current.id++; window.speechSynthesis?.cancel(); }; }, [wf]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (k) => { iRef.current = k; setI(k); draw(k); };
  const stop = () => { run.current.id++; window.speechSynthesis?.cancel(); setPlaying(false); };
  const say = (text, id) => new Promise((res) => {
    const ms = Math.min(Math.max(text.length * 110, 3500), 15000);
    if (!window.speechSynthesis) return setTimeout(res, ms);
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.05;
    const t = setTimeout(res, ms + 8000); u.onend = u.onerror = () => { clearTimeout(t); res(); };
    if (run.current.id === id) window.speechSynthesis.speak(u); else res();
  });
  async function play() {
    stop(); const id = ++run.current.id; setPlaying(true);
    for (let k = i; k < n; k++) { if (run.current.id !== id) return; go(k); await say(`${slides[k].kicker}. ${slides[k].lines.join(' ')}`, id); }
    if (run.current.id === id) setPlaying(false);
  }
  return (
    <div className="sum">
      <b>영상으로 인수인계 — {wf.name}</b> <span className="dim">슬라이드 {n}장 · 캡처 화면 {thumbs?.length || 0}장 삽입 · 음성 해설</span>
      <canvas ref={cv} width={W} height={H} style={{ width: '100%', maxWidth: 960, display: 'block', margin: '8px 0', borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => { stop(); go(Math.max(i - 1, 0)); }}>◀ 이전</button>
        {playing ? <button type="button" onClick={stop}>■ 멈춤</button> : <button type="button" onClick={play}>▶ 재생</button>}
        <button type="button" onClick={() => { stop(); go(Math.min(i + 1, n - 1)); }}>다음 ▶</button>
        <button type="button" onClick={() => { stop(); onClose(); }}>닫기</button>
        <span className="dim">{i + 1}/{n}</span>
      </div>
    </div>
  );
}

function WorkflowCard({ person, wf }) {
  const [open, setOpen] = useState(false); const [video, setVideo] = useState(false);
  const thumbs = useThumbs(person.uid, open || video);
  const col = (label, items, cls) => (
    <div className={'fcol ' + (cls || '')}><div className="fl">{label}</div>{arr(items).length ? arr(items).map((x, k) => <div key={k} className="fi">{x}</div>) : <div className="fi dim">—</div>}</div>);
  return (
    <div className="wfc">
      <div className="wfh">
        <b className="tog" onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▸'} {wf.name}</b>
        <ConfBadge v={wf.confidence} />
        {arr(wf.stage).map((s) => <span key={s} className={'chip st s' + BIZ9.indexOf(s)}>{s}</span>)}
        <span className="dim">{wf.frequency}</span>
        <button type="button" className="sm" style={{ marginLeft: 'auto' }} onClick={() => setVideo((v) => !v)}>▶ 영상으로 인수인계</button>
      </div>
      <div className="flow">
        {col('계기', [wf.trigger], 'trg')}<span className="arw">→</span>
        {col('받는 것', wf.inputs)}<span className="arw">→</span>
        <div className="fcol steps"><div className="fl">단계</div><ol>{arr(wf.steps).map((s, k) => <li key={k}>{s}</li>)}</ol></div><span className="arw">→</span>
        {col('판단', wf.decisions, 'dec')}<span className="arw">→</span>
        {col('결과물 / 넘기는 곳', wf.outputs, 'out')}
      </div>
      {video && <WorkflowVideo person={person} wf={wf} thumbs={thumbs.items} onClose={() => setVideo(false)} />}
      {open && <div className="wfd">
        {wf.why && <div><b>왜 필요한가</b> {wf.why}</div>}
        {arr(wf.tools).length > 0 && <div><b>도구</b> {arr(wf.tools).join(' · ')}</div>}
        {arr(wf.pitfalls).length > 0 && <div><b>주의할 점</b><ul>{arr(wf.pitfalls).map((p, k) => <li key={k}>{p}</li>)}</ul></div>}
        {wf.evidence && <div className="dim"><b>근거</b> {typeof wf.evidence === 'string' ? wf.evidence : JSON.stringify(wf.evidence)}</div>}
        <h3>실제 캡처 화면 (최근 7일, 시간순)</h3>
        <CaptureGrid uid={person.uid} thumbs={thumbs} />
      </div>}
    </div>
  );
}

function Workflows({ wf }) {
  const [sel, setSel] = useState(wf?.people?.[0]?.name || '');
  if (!wf?.people?.length) return <p className="warn" style={{ padding: 20 }}>data/work-feature-workflows.json 이 없습니다(매일 07:00 자동 업로드 대기).</p>;
  const depts = {};
  for (const p of wf.people) (depts[p.dept || '미확인'] = depts[p.dept || '미확인'] || []).push(p);
  const p = wf.people.find((x) => x.name === sel) || wf.people[0];
  const c = p.confidence || {};
  return (
    <div className="wfwrap">
      <aside className="wfl">
        <div className="dim" style={{ padding: '4px 6px 8px' }}>생성 {String(wf.generatedAt).slice(0, 10)}{wf.cutoff ? ` · 기준 ${String(wf.cutoff).slice(0, 10)}` : ''}</div>
        {Object.entries(depts).map(([d, list]) => <div key={d}><div className="dept">{d}</div>
          {list.map((x) => <button type="button" key={x.name} className={'pp' + (x.name === p.name ? ' on' : '')} onClick={() => setSel(x.name)}>
            <span>{x.name}</span><span className="cc"><ConfBadge v={x.confidence?.before} label="관찰 개선 전" /><span className="dim">→</span><ConfBadge v={x.confidence?.after} label="관찰 개선 후" /></span></button>)}
        </div>)}
      </aside>
      <main className="wfm">
        <h1>{p.name} <small className="dim">{p.dept}</small></h1>
        <div className="sum">{p.roleSummary}
          <div className="dim">신뢰도 {pct(c.before) ?? '—'}% → {pct(c.after) ?? '—'}%{Array.isArray(c.scenesPerDay) ? ` · 하루 해독 장면 ${c.scenesPerDay[0]} → ${c.scenesPerDay[1]}` : ''}{c.fieldFill != null ? ` · 필드 채움 ${pct(c.fieldFill)}%` : ''}{c.erp != null ? ` · 전산 ${c.erp}` : ''}</div></div>
        {arr(p.weekRhythm).length > 0 && <><h3>주간 리듬</h3><div className="tl">{p.weekRhythm.map((r, k) => <div key={k} className="tlr"><span className="tlw">{r.when}</span><span className="tld" /><span>{r.what}</span></div>)}</div></>}
        <h3>업무 흐름 {arr(p.workflows).length}개</h3>
        {arr(p.workflows).map((w, k) => <WorkflowCard key={p.name + k} person={p} wf={w} />)}
        {arr(p.unknowns).length > 0 && <><h3>확인 필요 질문</h3><ol className="unk">{p.unknowns.map((u, k) => <li key={k}>{typeof u === 'string' ? u : u.q || JSON.stringify(u)}</li>)}</ol></>}
      </main>
    </div>
  );
}

// ───────────────────────── 탭 '기능 추가 후보' 시뮬레이터 ─────────────────────────
// data/work-feature-simulations.json — 지금(수작업) 단계 재생 vs 기능 적용 후 목업 화면, 주간 절감.
function BeforeRun({ before, k }) {
  const steps = arr(before?.steps);
  const elapsed = steps.slice(0, k).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  return (
    <div className="simp">
      <div className="simh"><b>지금 (수작업)</b><span className="timer">{elapsed.toFixed(1)}분</span><span className="dim">/ {before?.totalMinutes ?? '—'}분 · 주 {before?.perWeek ?? '—'}회</span></div>
      <ol className="simsteps">{steps.map((s, i) => (
        <li key={i} className={(i < k ? 'done' : i === k ? 'cur' : 'todo') + (s.pain ? ' pain' : '')}>
          <div><span className="chip">{s.who}</span><span className="chip">{s.app}</span><b>{s.action}</b><span className="dim"> · {s.minutes}분</span></div>
          {s.pain && i < k && <div className="painx">⚠ {s.pain}</div>}
        </li>))}</ol>
    </div>
  );
}
function AfterRun({ after, k }) {
  const [modal, setModal] = useState(null);
  const steps = arr(after?.steps); const sc = after?.screen || {};
  const elapsed = steps.slice(0, k).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  const hl = (r, c) => arr(sc.highlights).find((h) => h.row === r && (h.col === c || h.col == null));
  return (
    <div className="simp">
      <div className="simh"><b>기능 적용 후</b><span className="timer ok">{elapsed.toFixed(1)}분</span><span className="dim">/ {after?.totalMinutes ?? '—'}분</span></div>
      <div className="mock">
        <div className="mockt">nenovaweb · {sc.title}</div>
        {arr(sc.filters).length > 0 && <div className="mockf">{sc.filters.map((f, i) => <label key={i}>{f.label}<span className="inp">{f.value}</span></label>)}</div>}
        {sc.table && <div className="tw"><table className="mtb"><thead><tr>{arr(sc.table.columns).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{arr(sc.table.rows).map((r, ri) => <tr key={ri}>{arr(r).map((c, ci) => { const h = hl(ri, ci); return <td key={ci} className={h ? 'hl' : ''} title={h?.note}>{c}{h && ci === (h.col ?? 0) && <span className="hln">{h.note}</span>}</td>; })}</tr>)}</tbody></table></div>}
        {arr(sc.buttons).length > 0 && <div className="mockb">{sc.buttons.map((b, i) => <button type="button" key={i} onClick={() => setModal(b)}>{b.label}</button>)}</div>}
      </div>
      <ol className="simsteps">{steps.map((s, i) => <li key={i} className={i < k ? 'done' : i === k ? 'cur' : 'todo'}><b>{s.action}</b><span className="dim"> · {s.minutes}분</span>{s.auto && <span className="chip auto">자동</span>}</li>)}</ol>
      {modal && <div className="modal" onClick={() => setModal(null)}><div className="modalb" onClick={(e) => e.stopPropagation()}>
        <b>{modal.label}</b> 결과<textarea readOnly value={String(modal.result || '')} rows={10} />
        <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={() => navigator.clipboard?.writeText(String(modal.result || ''))}>복사</button><button type="button" onClick={() => setModal(null)}>닫기</button></div>
      </div></div>}
    </div>
  );
}
function Simulator({ sims, fallback }) {
  const people = arr(sims?.people).filter((p) => arr(p.items).length);
  const [pi, setPi] = useState(0); const [ii, setIi] = useState(0);
  const [kb, setKb] = useState(0); const [ka, setKa] = useState(0); const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  if (!people.length) return fallback;
  const p = people[Math.min(pi, people.length - 1)]; const it = p.items[Math.min(ii, p.items.length - 1)];
  const nb = arr(it.before?.steps).length, na = arr(it.after?.steps).length;
  const reset = () => { clearInterval(timer.current); setKb(0); setKa(0); };
  const play = (which) => {
    reset(); let b = 0, a = 0;
    timer.current = setInterval(() => {
      if (which !== 'after' && b < nb) setKb(++b);
      if (which !== 'before' && a < na) setKa(++a);
      if ((which === 'after' || b >= nb) && (which === 'before' || a >= na)) clearInterval(timer.current);
    }, 1200);
  };
  const saveH = (Number(it.savingPerWeekMin) || 0) / 60;
  const beforeW = (Number(it.before?.totalMinutes) || 0) * (Number(it.before?.perWeek) || 0);
  const afterW = (Number(it.after?.totalMinutes) || 0) * (Number(it.before?.perWeek) || 0);
  const maxW = Math.max(beforeW, afterW, 1);
  return (
    <div className="doc wide">
      <h1>기능 추가 후보 — 시뮬레이터</h1>
      <p className="dim">지금 수작업을 한 단계씩 재생하고, 같은 일을 기능 적용 후 화면으로 비교합니다. 생성 {String(sims.generatedAt).slice(0, 10)} · AI 초안(직원 확인 전)</p>
      <div className="jump">{people.map((x, i) => <a key={x.name} href="#" className={i === pi ? 'on' : ''} onClick={(e) => { e.preventDefault(); setPi(i); setIi(0); reset(); }}>{x.name} <em>{x.items.length}</em></a>)}</div>
      <div className="jump">{p.items.map((x, i) => <a key={i} href="#" className={i === ii ? 'on' : ''} onClick={(e) => { e.preventDefault(); setIi(i); reset(); }}>{x.title} <em>{x.menu}</em></a>)}</div>
      <div className="prop"><div><b>관찰된 수작업</b> {it.observed}</div><div><b>제안</b> {it.proposal} <span className="chip">{it.menu}</span></div></div>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button type="button" className="sm pri2" onClick={() => play('both')}>▶ 비교 재생</button>
        <button type="button" className="sm" onClick={() => play('before')}>▶ 지금만</button>
        <button type="button" className="sm" onClick={() => play('after')}>▶ 적용 후만</button>
        <button type="button" className="sm" onClick={() => { clearInterval(timer.current); setKb((v) => Math.min(v + 1, nb)); setKa((v) => Math.min(v + 1, na)); }}>한 단계 ▶</button>
        <button type="button" className="sm" onClick={reset}>처음으로</button>
      </div>
      <div className="sim"><BeforeRun before={it.before} k={kb} /><AfterRun after={it.after} k={ka} /></div>
      <h3>주간 소요 시간</h3>
      <div className="wbar"><span className="wl">지금</span><i className="b1" style={{ width: (100 * beforeW / maxW) + '%' }} /><span>{Math.round(beforeW)}분</span></div>
      <div className="wbar"><span className="wl">적용 후</span><i className="b2" style={{ width: (100 * afterW / maxW) + '%' }} /><span>{Math.round(afterW)}분</span></div>
      <p><b>주간 절감 약 {saveH.toFixed(1)}시간</b> ({it.savingPerWeekMin ?? 0}분/주)</p>
      {arr(it.assumptions).length > 0 && <div className="dim"><b>가정</b><ul>{it.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      {it.evidence && <p className="dim"><b>근거</b> {typeof it.evidence === 'string' ? it.evidence : JSON.stringify(it.evidence)}</p>}
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

export default function MyWorkPage({ userId, data, boards, workflows, simulations, orbit, orbitQs = '', tab: tab0 }) {
  const [tab, setTab] = useState(tab0);
  const TABS = [
    { id: 'workflows', label: '업무 흐름' },
    { id: 'proposals', label: '기능 추가 후보 (시뮬레이션)' },
    { id: 'unified', label: '업무 통합본 (최신)' },
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
        <span className="dim" style={{ marginLeft: 'auto' }}>{userId} 전용</span>
        <a href={orbit + '/my-work.html' + orbitQs} target="_blank" rel="noreferrer">새 창</a>
      </div>
      <div className="stage">
        {tab === 'unified' && <iframe title="업무 통합본" src={orbit + '/work-unified.html' + orbitQs} />}
        {tab === 'orbit' && <iframe title="Orbit 작업 데이터" src={orbit + '/my-work.html' + orbitQs} />}
        {tab === 'workflows' && <Workflows wf={workflows} />}
        {tab === 'proposals' && <Simulator sims={simulations} fallback={<Proposals data={data} />} />}
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
        .conf{display:inline-block;border-radius:999px;padding:0 7px;font-size:11px;font-weight:700;border:1px solid}.conf.hi{color:#3fb950;border-color:#3fb95066}.conf.mid{color:#e3b341;border-color:#e3b34166}.conf.lo{color:#ff7b72;border-color:#ff7b7266}
        .wfwrap{display:flex;min-height:100%}.wfl{flex:0 0 230px;border-right:1px solid #262b35;padding:10px 8px;background:#12151c;overflow:auto}
        .dept{color:#98a1b2;font-size:11.5px;margin:10px 6px 4px;font-weight:600}
        .pp{display:flex;justify-content:space-between;align-items:center;width:100%;background:none;border:1px solid transparent;color:#e7eaf0;border-radius:6px;padding:5px 8px;cursor:pointer;font:inherit;text-align:left}
        .pp.on{background:#1c2633;border-color:#58a6ff}.pp .cc{display:flex;gap:3px;align-items:center}
        .wfm{flex:1;min-width:0;padding:16px 22px 60px;max-width:1300px}.wfm h1{font-size:20px;margin:0 0 6px}.wfm h3{font-size:13.5px;margin:18px 0 6px}
        .tl{border-left:2px solid #2c3340;margin-left:6px;padding-left:12px}.tlr{position:relative;margin:6px 0;display:flex;gap:10px}.tlw{flex:0 0 190px;color:#79c0ff;font-weight:600}
        .tld{position:absolute;left:-18px;top:5px;width:10px;height:10px;border-radius:50%;background:#58a6ff}
        .wfc{border:1px solid #2c3340;border-radius:10px;background:#12151c;padding:10px 12px;margin:10px 0}
        .wfh{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
        .flow{display:flex;gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:4px}.arw{align-self:center;color:#58a6ff;font-size:18px}
        .fcol{flex:1 1 160px;min-width:150px;background:#0e1016;border:1px solid #262b35;border-radius:8px;padding:6px 8px;font-size:12px}.fcol.steps{flex:2 1 280px}
        .fcol .fl{color:#98a1b2;font-size:11px;font-weight:700;margin-bottom:3px}.fcol .fi{margin:2px 0;line-height:1.4}.fcol ol{margin:0;padding-left:18px}.fcol li{margin:2px 0;line-height:1.4}
        .fcol.trg{border-color:#58a6ff55}.fcol.dec{border-color:#e3b34155}.fcol.out{border-color:#3fb95055}
        .wfd{margin-top:8px;font-size:12.5px}.wfd>div{margin:4px 0}.wfd ul{margin:2px 0;padding-left:20px}
        .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
        .thumb{margin:0;border:1px solid #262b35;border-radius:6px;overflow:hidden;background:#0b0d12}.thumb img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;background:#1f2430}
        .thumb figcaption{font-size:11px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9d1d9}
        .unk li{margin:4px 0}
        button.sm{background:#1f2430;color:#c9d1d9;border:1px solid #2c3340;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12px}button.sm.pri2{border-color:#58a6ff;color:#fff;background:#1c2633}
        .sim{display:flex;gap:14px;flex-wrap:wrap}.simp{flex:1 1 480px;min-width:0;border:1px solid #2c3340;border-radius:10px;background:#12151c;padding:10px 12px}
        .simh{display:flex;gap:10px;align-items:baseline;margin-bottom:8px}.timer{font-size:22px;font-weight:700;color:#ff7b72;font-variant-numeric:tabular-nums}.timer.ok{color:#3fb950}
        .simsteps{margin:0;padding-left:22px}.simsteps li{margin:6px 0;transition:opacity .3s}.simsteps li.todo{opacity:.35}.simsteps li.cur{opacity:.7}.simsteps li.done{opacity:1}
        .simsteps li.pain.done{border-left:3px solid #ff7b72;padding-left:6px}.painx{color:#ff7b72;font-size:12px;margin-top:2px}
        .mock{border:1px solid #3a4150;border-radius:8px;background:#f6f7f9;color:#1f2328;margin-bottom:10px;overflow:hidden}
        .mockt{background:#2f5fa7;color:#fff;padding:6px 10px;font-weight:700;font-size:12.5px}.mockf{display:flex;gap:10px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid #d0d7de}
        .mockf label{font-size:11.5px;color:#57606a;display:flex;gap:4px;align-items:center}.mockf .inp{background:#fff;border:1px solid #d0d7de;border-radius:4px;padding:2px 8px;color:#1f2328}
        .mtb{width:100%;border-collapse:collapse;font-size:12px}.mtb th,.mtb td{border:1px solid #d0d7de;padding:4px 7px;text-align:left}.mtb th{background:#eaeef2}
        .doc .mtb tbody tr,.doc .mtb tbody tr:nth-child(even){background:#fff!important}.doc .mtb td{color:#1f2328!important}
        .doc .mtb td.hl{background:#fff4c2!important;font-weight:700}.hln{display:block;font-size:10.5px;color:#9a6700;font-weight:400}
        .mockb{display:flex;gap:8px;padding:8px 10px}.mockb button{background:#2f5fa7;color:#fff;border:0;border-radius:5px;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px}
        .modal{position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:50}.modalb{background:#171a21;border:1px solid #2c3340;border-radius:10px;padding:14px;width:min(640px,92vw);display:flex;flex-direction:column;gap:8px}
        .modalb textarea{width:100%;background:#0b0d12;color:#e7eaf0;border:1px solid #2c3340;border-radius:6px;font:12px/1.5 monospace;padding:8px;box-sizing:border-box}
        .wbar{display:flex;align-items:center;gap:8px;margin:4px 0}.wbar .wl{flex:0 0 56px;color:#98a1b2}.wbar i{display:block;height:14px;border-radius:3px;min-width:2px}.wbar .b1{background:#ff7b72}.wbar .b2{background:#3fb950}
        .st.s0{border-color:#58a6ff}.st.s1{border-color:#3fb950}.st.s2{border-color:#d29922}.st.s3{border-color:#f778ba}.st.s4{border-color:#a371f7}.st.s5{border-color:#79c0ff}.st.s6{border-color:#56d364}.st.s7{border-color:#ffa657}.st.s8{border-color:#ff7b72}
        @media (max-width:760px){.wfwrap{flex-direction:column}.wfl{flex:none;border-right:0;border-bottom:1px solid #262b35}.tlr{flex-direction:column;gap:2px}.tlw{flex:none}}
      `}</style>
    </div>
  );
}
