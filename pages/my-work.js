// pages/my-work.js
// 내 작업 데이터 — nenovaSS3 전용(민감: 직원 관측데이터). pages/admin/orbit-report.js 와 같은 게이트(404 은닉).
// 탭0 업무 흐름(기본): data/work-feature-workflows.json — 직원별 흐름 카드 + 실제 캡처 썸네일(/api/work/orbit-thumbs) + 흐름 기준 인수인계 영상.
// 탭 기능 추가 후보: data/work-feature-simulations.json 이 있으면 지금↔적용 후 시뮬레이터, 없으면 텍스트 목록.
// 탭1 업무 통합본: Orbit(/work-unified.html)을 iframe으로 띄워 항상 최신 통합본. Orbit 로그인은 그 안에서 1회.
// 탭2 기능 추가 후보: 관찰 데이터(매뉴얼·화면 해독·전산 기록)로 뽑은 nenovaweb 기능 후보 + 근거(data/work-feature-proposals.json, 파일만).
// 탭 전산 실제 처리: Orbit(/erp-work.html) iframe — 직원별 nenova 저장 동작과 실제 전산 주문·출고 변경 일치율·거래처·직접 입력 확인.
// 탭3 Orbit 전체: /my-work.html(작업 흐름·시간표·화면 타임라인 등).
// 탭 도입 레이더(관리자 전용): data/runtime/adoption-ledger.json(사장님 PC 장부 업로드) — 레이더 4링·추이·실험·후보·결정·문제 등록부. mineOnly 에는 없음.
import fs from 'fs';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import MenuBackButton from '../components/MenuBackButton';
import ArchFlowChart from '../components/pm/ArchFlowChart';
import TechRadarWorkbench from '../components/pm/TechRadarWorkbench';
import ImportCostAgiWorkbench from '../components/import-tools/ImportCostAgiWorkbench';
import SolutionSuiteSimulator from '../components/work/SolutionSuiteSimulator';
import DeviceHubConsole from '../components/work/DeviceHubConsole';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';
import { workflowOwnerOf } from '../lib/workFlowOwners';
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

export async function getServerSideProps({ req, res, query }) {
  const user = await verifyReqUser(req, res);
  if (!isOrbitReportViewer(user)) {
    // 관리자가 아닌 직원: 매핑된 본인 1명분 텍스트(캡처 썸네일 제외)만 내려준다.
    const owner = workflowOwnerOf(user);
    if (!owner) return { notFound: true };
    let wfAll = null; try { wfAll = JSON.parse(fs.readFileSync(featureFilePath('workflows'), 'utf8')); } catch {}
    const me = wfAll?.people?.find((x) => x.name === owner.name) || null;
    const mine = me
      ? { generatedAt: wfAll.generatedAt || null, person: { name: me.name, dept: me.dept || '', roleSummary: me.roleSummary || '', workflows: (me.workflows || []).map((w) => ({ name: w.name, stage: w.stage || [], frequency: w.frequency || '', trigger: w.trigger || '', inputs: w.inputs || [], steps: w.steps || [], stepsDetail: (w.stepsDetail || []).map((d) => ({ text: d.text })), decisions: w.decisions || [], outputs: w.outputs || [] })) } }
      : { generatedAt: null, person: null };
    return { props: { userId: user.userId, mine, mineOnly: true, data: null, boards: null, workflows: null, simulations: null, orbit: '', orbitQs: '', tab: 'mine' } };
  }
  // 탭 데이터(제안·스토리보드·흐름·시뮬레이션)는 SSR props 에 싣지 않고 탭을 열 때 /api/my-work/feature 로 받는다(초기 HTML·하이드레이션 경량화).
  const viewerToken = await orbitViewerToken();
  return { props: { userId: user.userId, orbit: ORBIT, orbitQs: viewerToken ? '?token=' + encodeURIComponent(viewerToken) : '', tab: query.tab || 'pipeline' } };
}

// 탭 데이터 지연 로딩 — /api/my-work/feature (같은 게이트). key 가 바뀔 때만 다시 받는다. 응답은 탭 전환 사이 메모리 캐시.
const _featCache = {};
function useFeature(name, params = null, enabled = true) {
  const qs = new URLSearchParams({ name, ...(params || {}) }).toString();
  const [st, setSt] = useState(() => (_featCache[qs] ? { loading: false, data: _featCache[qs], error: '' } : { loading: true, data: null, error: '' }));
  useEffect(() => {
    if (!enabled) return undefined;
    if (_featCache[qs]) { setSt({ loading: false, data: _featCache[qs], error: '' }); return undefined; }
    let alive = true;
    setSt((p) => ({ ...p, loading: true, error: '' }));
    fetch('/api/my-work/feature?' + qs, { credentials: 'same-origin' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (!ok || !j.success) throw new Error(j.error || 'load failed'); _featCache[qs] = j.data; setSt({ loading: false, data: j.data, error: '' }); })
      .catch((e) => { if (alive) setSt({ loading: false, data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [qs, enabled]);
  return st;
}
function Loading({ st, children }) {
  if (st.loading) return <p className="dim" style={{ padding: 20 }}>불러오는 중…</p>;
  if (st.error) return <p className="warn">데이터를 불러오지 못했습니다: {st.error}</p>;
  return children;
}

// 캡처식 워크플로우 — 제안 하나를 고르면 실제 관찰 세션을 시간순 장면 필름으로 보여준다. 선택은 URL(?tab=story&who=&b=&s=)로 서버에서 잘라온다.
// 장면 = 화면 해독(화면·행동·힌트 전문) + 그 장면 동안의 창 제목 흐름 + 업무 앱 입력 내용(메신저 제외) + 같은 시간대 전산 저장 기록.
function StoryTab() {
  const router = useRouter();
  const q = router.query;
  const params = { who: String(q.who || ''), b: String(q.b || 0), s: String(q.s || 0) };
  const sb = useFeature('storyboards', params, router.isReady);
  const pr = useFeature('proposals');
  return <Loading st={sb}><Storyboards boards={sb.data} data={pr.data} /></Loading>;
}

function Storyboards({ boards, data }) {
  const router = useRouter();
  const [openAll, setOpenAll] = useState(true);
  if (!boards) return <p className="warn">data/work-feature-storyboards.json 이 없습니다.</p>;
  const go = (q) => router.push({ pathname: '/my-work', query: { tab: 'story', who: boards.who, b: boards.bi, s: 0, ...q } }, undefined, { scroll: false, shallow: true });
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

// 관찰 절차(stepsDetail): 어디서 보고 → 한 일 → 어디에 넣음. 비어 있는 칸은 생략.
const ACTION_KO = { read: '확인', type: '입력', copy: '복사', calc: '계산', send: '전달' };
const place = (p) => (p ? [p.app, p.screen, p.field].filter(Boolean).join(' · ') : '');
function StepRoute({ d }) {
  const src = place(d.source), dst = place(d.destination);
  if (!src && !dst) return null;
  return <div className="sroute">{src && <span><i>어디서 보고</i> {src}</span>}{src && ' → '}<span><i>한 일</i> {ACTION_KO[d.action] || d.action || '-'}</span>{dst && <> → <span><i>어디에 넣음</i> {dst}</span></>}{d.example && <span className="dim"> (예: {String(d.example).slice(0, 40)})</span>}</div>;
}
function WorkflowCard({ person, wf, review }) {
  const [open, setOpen] = useState(false); const [video, setVideo] = useState(false);
  const thumbs = useThumbs(person.uid, !review && (open || video));
  const col = (label, items, cls) => (
    <div className={'fcol ' + (cls || '')}><div className="fl">{label}</div>{arr(items).length ? arr(items).map((x, k) => <div key={k} className="fi">{x}</div>) : <div className="fi dim">—</div>}</div>);
  return (
    <div className="wfc">
      <div className="wfh">
        <b className="tog" onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▸'} {wf.name}</b>
        <ConfBadge v={wf.confidence} />
        {arr(wf.stage).map((s) => <span key={s} className={'chip st s' + BIZ9.indexOf(s)}>{s}</span>)}
        <span className="dim">{wf.frequency}</span>
        {review ? <ReviewButtons wf={wf} review={review} /> : <button type="button" className="sm" style={{ marginLeft: 'auto' }} onClick={() => setVideo((v) => !v)}>▶ 영상으로 인수인계</button>}
      </div>
      <div className="flow">
        {col('계기', [wf.trigger], 'trg')}<span className="arw">→</span>
        {col('받는 것', wf.inputs)}<span className="arw">→</span>
        <div className="fcol steps"><div className="fl">단계</div><ol>{arr(wf.stepsDetail).length > 0
          ? arr(wf.stepsDetail).map((d, k) => <li key={k}>{d.text}<StepRoute d={d} /></li>)
          : arr(wf.steps).map((s, k) => <li key={k}>{s}</li>)}</ol></div><span className="arw">→</span>
        {col('판단', wf.decisions, 'dec')}<span className="arw">→</span>
        {col('결과물 / 넘기는 곳', wf.outputs, 'out')}
      </div>
      {video && <WorkflowVideo person={person} wf={wf} thumbs={thumbs.items} onClose={() => setVideo(false)} />}
      {open && <div className="wfd">
        {wf.why && <div><b>왜 필요한가</b> {wf.why}</div>}
        {arr(wf.tools).length > 0 && <div><b>도구</b> {arr(wf.tools).join(' · ')}</div>}
        {arr(wf.pitfalls).length > 0 && <div><b>주의할 점</b><ul>{arr(wf.pitfalls).map((p, k) => <li key={k}>{p}</li>)}</ul></div>}
        {wf.evidence && <div className="dim"><b>근거</b> {typeof wf.evidence === 'string' ? wf.evidence : JSON.stringify(wf.evidence)}</div>}
        {!review && <><h3>실제 캡처 화면 (최근 7일, 시간순)</h3>
        <CaptureGrid uid={person.uid} thumbs={thumbs} /></>}
      </div>}
    </div>
  );
}

// 직원 본인 확인: [맞다][틀리다][수정]. review = { saved, save(wf, verdict, steps) }
const VERDICT_KO = { ok: '맞다고 확인함', reject: '틀리다고 알려줌', fix: '수정해서 알려줌' };
function ReviewButtons({ wf, review }) {
  const saved = review.saved[wf.name];
  const base = arr(wf.stepsDetail).length ? arr(wf.stepsDetail).map((d) => d.text) : arr(wf.steps);
  const [edit, setEdit] = useState(false); const [steps, setSteps] = useState(saved?.correctedSteps || base);
  const [busy, setBusy] = useState(false);
  const send = async (v, st) => { setBusy(true); await review.save(wf, v, st); setBusy(false); if (v === 'fix') setEdit(false); };
  const setAt = (i, val) => setSteps((a) => a.map((x, k) => (k === i ? val : x)));
  return (
    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {saved && <span className="dim">{VERDICT_KO[saved.verdict]}</span>}
      <button type="button" className={'sm' + (saved?.verdict === 'ok' ? ' pri2' : '')} disabled={busy} onClick={() => send('ok')}>맞다</button>
      <button type="button" className={'sm' + (saved?.verdict === 'reject' ? ' pri2' : '')} disabled={busy} onClick={() => send('reject')}>틀리다</button>
      <button type="button" className={'sm' + (saved?.verdict === 'fix' ? ' pri2' : '')} disabled={busy} onClick={() => setEdit((v) => !v)}>수정</button>
      {edit && <div style={{ flexBasis: '100%', marginTop: 6 }}>
        <div className="dim">실제 순서대로 고쳐 주세요. 필요 없는 단계는 삭제하고, 빠진 단계는 아래에서 추가하세요.</div>
        {steps.map((t, i) => <div key={i} style={{ display: 'flex', gap: 4, margin: '4px 0' }}>
          <span className="dim">{i + 1}.</span>
          <input style={{ flex: 1, background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: 4, padding: '4px 8px', font: 'inherit' }} value={t} onChange={(e) => setAt(i, e.target.value)} />
          <button type="button" className="sm" onClick={() => setSteps((a) => a.filter((_, k) => k !== i))}>삭제</button>
        </div>)}
        <button type="button" className="sm" onClick={() => setSteps((a) => [...a, ''])}>+ 단계 추가</button>{' '}
        <button type="button" className="sm pri2" disabled={busy || !steps.some((x) => x.trim())} onClick={() => send('fix', steps.filter((x) => x.trim()))}>수정 내용 보내기</button>
      </div>}
    </span>
  );
}

// '내 업무흐름' — 직원 본인이 자기 업무흐름을 읽고 맞다/틀리다/수정으로 알려 주는 탭(본인 것만).
function MyFlowTab({ mine }) {
  const [saved, setSaved] = useState({}); const [err, setErr] = useState('');
  useEffect(() => {
    fetch('/api/work/workflow-review').then((r) => r.json()).then((j) => {
      if (j.success) setSaved(Object.fromEntries(j.reviews.map((x) => [x.workflowName, x]))); else setErr(j.error || '불러오지 못했습니다.');
    }).catch(() => setErr('불러오지 못했습니다.'));
  }, []);
  const save = async (wf, verdict, correctedSteps) => {
    setErr('');
    try {
      const r = await fetch('/api/work/workflow-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowName: wf.name, verdict, correctedSteps, generatedAt: mine?.generatedAt || '' }) });
      const j = await r.json();
      if (!j.success) { setErr(j.error || '저장하지 못했습니다.'); return; }
      setSaved((s) => ({ ...s, [wf.name]: { workflowName: wf.name, verdict, correctedSteps: correctedSteps || null } }));
    } catch { setErr('저장하지 못했습니다.'); }
  };
  const p = mine?.person;
  if (!p) return <p className="warn" style={{ padding: 20 }}>아직 정리된 업무흐름이 없습니다.</p>;
  return (
    <div className="wfm" style={{ padding: 16 }}>
      <h1>{p.name}님의 업무흐름 <small className="dim">{p.dept}</small></h1>
      <div className="sum">정리된 내 업무 순서가 실제와 맞는지 알려 주세요. 알려 주신 내용은 더 정확한 업무 정리에 쓰입니다.</div>
      {p.roleSummary && <div className="dim" style={{ margin: '8px 0' }}>{p.roleSummary}</div>}
      {err && <p className="warn">{err}</p>}
      {arr(p.workflows).map((w, k) => <WorkflowCard key={k} person={p} wf={w} review={{ saved, save }} />)}
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
          {s.pain && i < k && <div className="painx">[병목] {s.pain}</div>}
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
          <tr key={i}><td>{r.observed}</td><td>{r.proposal}</td><td className="dim">{r.menu}</td><td><span className={'pri p' + r.priority}>P{r.priority}</span></td></tr>
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

// 직원이 엑셀로 되풀이해 만드는 자료 → 웹으로 옮길 후보 (nenova-work-features/build-excel-candidates.js 가 매일 만든다, 2026-11-22 사장님 지시)
// 주어는 업무 자료(엑셀 파일 종류)다. 부서만 적고 사람 이름은 싣지 않는다.
function ExcelCandidates({ x }) {
  const [open, setOpen] = useState(null);
  if (!x || !Array.isArray(x.rows) || !x.rows.length) return null;
  const tone = { '웹 없음': 'xneed', '웹 있는데 엑셀': 'xgap', '짝 미정': 'xask', '웹으로 넘어가는 중': 'xok' };
  const by = x.totals?.byStatus || {};
  return (
    <section className="xcand">
      <h2>엑셀로 되풀이해 만드는 자료 <small>{x.from} ~ {x.to} · {x.rows.length}종 · 생성 {String(x.generatedAt).slice(0, 10)}</small></h2>
      <p className="xpurpose"><b>목적</b> 직원이 엑셀로 매주 되풀이해 만드는 자료를 먼저 찾아 웹으로 옮기고, 웹 화면을 만든 뒤에는 그 엑셀이 실제로 줄었는지 확인한다.</p>
      <p className="dim">웹 없음 {by['웹 없음'] || 0} · 웹 있는데 엑셀 {by['웹 있는데 엑셀'] || 0} · 짝 미정 {by['짝 미정'] || 0} · 웹으로 넘어가는 중 {by['웹으로 넘어가는 중'] || 0}. {x.basis}</p>
      <table className="tbl xtbl">
        <thead><tr><th>상태</th><th>엑셀 자료</th><th>부서</th><th className="num">엑셀 화면</th><th className="num">주당(추정)</th><th>같은 일의 웹 화면</th><th className="num">웹 화면</th><th>제안</th></tr></thead>
        <tbody>{x.rows.map((r, i) => (
          <Fragment key={r.name}>
            <tr className="xrow" onClick={() => setOpen(open === i ? null : i)} title="누르면 주별 건수와 파일 이름을 봅니다">
              <td><span className={'xst ' + (tone[r.status] || '')}>{r.status}</span></td>
              <td><b>{r.name}</b></td>
              <td>{(r.depts || []).join(' · ')}</td>
              <td className="num">{r.excelCount}건 · {r.weeks}주</td>
              <td className="num">약 {r.minutesPerWeek}분</td>
              <td>{r.web ? <a href={r.web} onClick={(e) => e.stopPropagation()}>{r.webName}</a> : <span className="dim">없음</span>}</td>
              <td className="num">{r.web ? r.webCount + '건' : '-'}</td>
              <td>{r.proposal}</td>
            </tr>
            {open === i && <tr><td colSpan={8} className="xmore">
              <div><b>주별 건수</b> {(r.weekly || []).map((w) => <span key={w.week} className="chip">{w.week.slice(5)} 엑셀 {w.excel}{r.web ? ' · 웹 ' + w.web : ''}</span>)}</div>
              <div><b>많이 열린 파일</b> {(r.files || []).map((f) => <span key={f} className="chip">{f}</span>)}</div>
              <div className="dim">처음 {r.first} · 마지막 {r.last} · 기록된 날 {r.days}일</div>
            </td></tr>}
          </Fragment>))}</tbody>
      </table>
      {x.rows.some((r) => (r.shared || []).length >= 2) && <>
        <h2>여러 부서가 같이 만지는 자료 <small>한 화면에 부서별 영역으로 묶을 후보 · 본보기 「영업수입불량차감」</small></h2>
        <p className="dim">{x.sharedNote}</p>
        <table className="tbl xtbl">
          <thead><tr><th>자료</th><th>부서별로 하는 일(건수 · 주로 보는 시트 · 주로 하는 요일)</th><th>지금 웹 화면</th><th>한 화면 설계 초안</th></tr></thead>
          <tbody>{x.rows.filter((r) => (r.shared || []).length >= 2).map((r) => (
            <tr key={r.name}>
              <td><b>{r.name}</b></td>
              <td>{r.shared.map((d) => <div key={d.dept} className="xdept"><b>{d.dept}</b> <span className="num">{d.count}건 · {d.share}%</span>{d.days.length > 0 && <span className="chip">{d.days.join(' · ')}요일</span>}<div className="dim">{d.sheets.join(' / ') || '시트 이름이 읽히지 않음'}</div></div>)}</td>
              <td>{r.web ? <a href={r.web}>{r.webName}</a> : <span className="dim">없음</span>}</td>
              <td>{r.sharedProposal}</td>
            </tr>))}</tbody>
        </table>
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
      <ExcelCandidates x={data.excel} />
      <h2>우선순위 (여러 사람이 같이 쓰는 것부터)</h2>
      <ol className="shared">{data.shared.map((s) => <li key={s.rank}><b>{s.title}</b> <span className="chip">{s.people.join(' · ')}</span><div className="dim">{s.why}</div></li>)}</ol>
      <div className="jump">{data.people.map((p) => <a key={p.name} href={'#p-' + p.name}>{p.name}</a>)}</div>
      {data.people.map((p) => <Person key={p.name} p={p} />)}
    </div>
  );
}

// ───────────────────────── 탭 '업무 파이프라인' ─────────────────────────
// 프로세스 마이닝(Celonis·Disco)식 흐름 지도 + 업무 절차도식 스윔레인. 숫자 통계 없이 "누가 어느 단계에서 무엇을" 만 보인다.
// 업무를 누르면 계기→받는 것→하는 일→판단→결과물 흐름, 주고받는 사람 강조, 실제 캡처·영상 인수인계.
const PL_STAGES = [...BIZ9, '기타'];
const plStage = (s) => { s = String(s || '').replace(/\(.*?\)/g, '').trim(); s = ({ 견적: '견적서', 출고: '현장출고', 송금: '해외송금', 영업이익: '이익' })[s] || s; return BIZ9.includes(s) ? s : '기타'; };
const plConf = (c) => { const n = confScore(c); return !Number.isFinite(n) ? 'lo' : (n <= 1 ? n : n / 100) >= 0.7 ? 'hi' : (n <= 1 ? n : n / 100) >= 0.4 ? 'mid' : 'lo'; };
// 업무별 실제 작업 기록 — 해독기가 이 업무로 표시한 화면(없으면 같은 단계 화면)을 시간순으로:
// 어느 화면에서 무엇을 했고, 어느 칸에 무슨 값이 있었고, 어디를 눌렀고, 무엇을 판단했는지.
function WorkRecords({ uid, wfName, stage }) {
  const [st, setSt] = useState({ loading: true, recs: [], by: '' });
  const [big, setBig] = useState(null);
  useEffect(() => {
    if (!uid) { setSt({ loading: false, recs: [], by: '' }); return undefined; }
    let dead = false; setSt({ loading: true, recs: [], by: '' });
    const get = (q) => fetch(`/api/work/orbit-thumbs?user=${encodeURIComponent(uid)}&records=1&${q}`).then((r) => r.json()).then((j) => j.records || []).catch(() => []);
    (async () => {
      let recs = await get('wf=' + encodeURIComponent(wfName)); let by = 'wf';
      if (!recs.length && stage) { recs = await get('stage=' + encodeURIComponent(stage)); by = 'stage'; }
      if (!dead) setSt({ loading: false, recs: recs.slice().reverse(), by });
    })();
    return () => { dead = true; };
  }, [uid, wfName, stage]);
  if (!uid) return <p className="dim">이 직원은 화면 기록이 연결되지 않았습니다.</p>;
  if (st.loading) return <p className="dim">작업 기록 불러오는 중…</p>;
  if (!st.recs.length) return <p className="dim">아직 이 업무로 읽힌 화면이 없습니다.</p>;
  const ent = (e) => {
    if (!e) return [];
    const out = [];
    if (e.orderCycle) out.push('차수 ' + e.orderCycle);
    if (arr(e.customers).length) out.push('거래처 ' + arr(e.customers).join(', '));
    if (arr(e.quantities).length) out.push(arr(e.quantities).slice(0, 8).map((q) => `${q.item} ${q.qty}${q.unit || ''}`).join(', '));
    else if (arr(e.products).length) out.push('품목 ' + arr(e.products).slice(0, 8).join(', '));
    return out;
  };
  // 화면마다 작업 순서: order 가 있으면 그 순서, 없으면 클릭한 칸 → 값이 있는 칸 순서
  const steps = (r) => {
    const fs2 = arr(r.fields).filter((f) => f.order || f.click); // 실제로 다룬 칸만 번호
    return fs2.slice().sort((a, b) => (a.order || 99) - (b.order || 99) || (b.click ? 1 : 0) - (a.click ? 1 : 0)).map((f, k) => ({ ...f, no: f.order || k + 1 }));
  };
  const Shot = ({ r, size }) => {
    const ss = steps(r);
    return (
      <div className={'ann ' + size} onClick={() => setBig(big === r.id ? null : r.id)} title="누르면 크게/작게">
        <img loading="lazy" src={`/api/work/orbit-thumbs?img=${encodeURIComponent(r.id)}`} alt={r.screen || ''} />
        {ss.filter((x) => x.box).map((x, k) => {
          const [x0, y0, x1, y1] = x.box;
          return <span key={k}><span className="annbox" style={{ left: x0 / 10 + '%', top: y0 / 10 + '%', width: Math.max(1, (x1 - x0) / 10) + '%', height: Math.max(1, (y1 - y0) / 10) + '%' }} />
            <span className="annno" style={{ left: x0 / 10 + '%', top: y0 / 10 + '%' }}>{x.no}</span></span>;
        })}
      </div>);
  };
  const flow = st.recs.filter((r) => r.thumb);
  return (
    <div className="plrec">
      {st.by === 'stage' && <p className="dim">이 업무로 표시된 화면이 아직 없어, 같은 단계({stage})에서 읽힌 화면을 보여줍니다.</p>}
      {flow.length > 1 && <>
        <div className="pll">작업 순서 한눈에 (왼쪽부터 시간순 · 빨간 번호 = 그 화면에서 다룬 순서)</div>
        <div className="annflow">{flow.map((r, k) => (
          <div key={r.id} className="annstep">
            <div className="annhead"><b>{k + 1}</b> {r.workflow?.step ? `${r.workflow.step}단계 · ` : ''}{(r.screen || r.app || '').slice(0, 24)}</div>
            <Shot r={r} size="sm" />
            <div className="anncap">{(r.done || r.activity || '').slice(0, 50)}</div>
          </div>))}</div>
      </>}
      {st.recs.map((r) => {
        const ss = steps(r);
        const rest = arr(r.fields).filter((f) => f.value && !ss.includes(f) && !ss.some((x) => x.name === f.name));
        return (
          <div key={r.id} className="plr">
            <div className="plrh2"><span className="plt">{fmtTs(r.timestamp)}</span><b>{r.screen || r.app}</b></div>
            {r.workflow && (r.workflow.step || r.workflow.caseKey) && <div className="dim">{r.workflow.step ? `${r.workflow.step}번째 단계` : ''}{r.workflow.caseKey ? ` · 건: ${r.workflow.caseKey}` : ''}</div>}
            {r.activity && <div>{r.activity}</div>}
            {r.thumb && <Shot r={r} size={big === r.id ? 'lg' : 'md'} />}
            {ss.length > 0 && <ol className="annlist">{ss.map((x, k) => <li key={k}><span className="annno inl">{x.no}</span><b>{x.name}</b>{x.click ? ' 누름' : ''}{x.value ? ` — ${String(x.value).slice(0, 70)}` : ''}{x.human ? ' (사람 판단)' : ''}</li>)}</ol>}
            {r.done && <div><span className="plk">마친 동작</span>{r.done}</div>}
            {rest.length > 0 && <div><span className="plk">화면의 값</span><ul>{rest.slice(0, 5).map((f, k) => <li key={k}>{f.name}: {String(f.value).slice(0, 80)}</li>)}</ul></div>}
            {ent(r.entities).length > 0 && <div><span className="plk">보인 것</span>{ent(r.entities).join(' · ')}</div>}
            {r.workflow?.decision && <div><span className="plk">판단</span>{r.workflow.decision}</div>}
            {r.next && <div className="dim"><span className="plk">다음</span>{r.next}</div>}
          </div>);
      })}
    </div>
  );
}

function Pipeline({ wf }) {
  const [stage, setStage] = useState(null);
  const [sel, setSel] = useState(null); // { p, w } 또는 { p }
  const [show, setShow] = useState(''); // '' | 'cap' | 'video'
  const people = wf?.people || [];
  const names = people.map((p) => p.name);
  const sp = sel ? people[sel.p] : null; const sw = sel && sel.w != null ? arr(sp?.workflows)[sel.w] : null;
  const thumbs = useThumbs(sp?.uid, !!sw && show !== '');
  if (!people.length) return <p className="warn" style={{ padding: 20 }}>data/work-feature-workflows.json 이 없습니다.</p>;
  const stagesOf = (w) => [...new Set(arr(w.stage).map(plStage))];
  const links = sw ? names.filter((n) => n !== sp.name && JSON.stringify([sw.inputs, sw.outputs, sw.trigger]).includes(n)) : [];
  const used = new Set(people.flatMap((p) => arr(p.workflows).flatMap(stagesOf)));
  const pick = (p, w) => { setSel({ p, w }); setShow(''); };
  let dept = null;
  const list = (a, ol) => { const xs = arr(a); if (!xs.length) return <span className="dim">기록 없음</span>; const L = ol ? 'ol' : 'ul'; return <L>{xs.map((x, k) => <li key={k}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</L>; };
  return (
    <div className="plwrap">
      <main className="plm">
        <p className="pllede">위는 회사 흐름(발주부터 이익까지), 아래는 단계마다 누가 어떤 업무를 하는지입니다. 단계를 누르면 그 단계 업무만 남고, 업무를 누르면 오른쪽에 흐름이 나옵니다.</p>
        <div className="plmap">{PL_STAGES.map((s) => (
          <button type="button" key={s} className={'plstg' + (stage === s ? ' on' : '') + (used.has(s) ? '' : ' none')} onClick={() => setStage(stage === s ? null : s)}>{s}</button>))}</div>
        <div className="pllegend"><span><i className="hi" />근거 충분</span><span><i className="mid" />근거 보통</span><span><i className="lo" />근거 부족</span><span><i className="none" />업무가 잡히지 않은 단계</span></div>
        <div className="pllanes"><table>
          <thead><tr><th className="plwho">직원</th>{PL_STAGES.map((s) => <th key={s} className={stage === s ? 'hl' : ''}>{s}</th>)}</tr></thead>
          <tbody>{people.map((p, pi) => {
            const rows = [];
            if (p.dept !== dept) { dept = p.dept; rows.push(<tr key={'d' + pi} className="pldept"><td colSpan={PL_STAGES.length + 1}>{dept || '미정'}</td></tr>); }
            rows.push(<tr key={pi} className={links.includes(p.name) ? 'link' : ''}>
              <td className="plwho"><button type="button" className="plname" onClick={() => { setSel({ p: pi }); setShow(''); }}>{p.name}</button></td>
              {PL_STAGES.map((s) => <td key={s} className={stage === s ? 'hl' : ''}>{arr(p.workflows).map((w, wi) => ({ w, wi })).filter(({ w }) => stagesOf(w)[0] === s).map(({ w, wi }) => (
                <button type="button" key={wi} className={'plchip ' + plConf(w.confidence) + (sel && sel.p === pi && sel.w === wi ? ' on' : '') + (stage && !stagesOf(w).includes(stage) ? ' dim' : '')} onClick={() => pick(pi, wi)}>{w.name}</button>))}</td>)}
            </tr>);
            return rows;
          })}</tbody>
        </table></div>
      </main>
      <aside className="plside">
        {!sel && <p className="dim">업무나 직원 이름을 누르세요.</p>}
        {sel && !sw && sp && <>
          <div className="dim">{sp.dept}</div><h2>{sp.name}</h2>
          <p>{sp.roleSummary}</p>
          {arr(sp.weekRhythm).length > 0 && <><div className="pll">한 주의 리듬</div><dl className="plrh">{sp.weekRhythm.flatMap((r, k) => [<dt key={'t' + k}>{r.when}</dt>, <dd key={'d' + k}>{r.what}</dd>])}</dl></>}
          <div className="pll">하는 업무</div><div className="plppl">{arr(sp.workflows).map((w, wi) => <button type="button" key={wi} onClick={() => pick(sel.p, wi)}>{w.name}</button>)}</div>
          {arr(sp.unknowns).length > 0 && <><div className="pll">아직 확인이 필요한 것</div>{list(arr(sp.unknowns).map((u) => (typeof u === 'string' ? u : u.q || '')))}</>}
        </>}
        {sw && <>
          <div className="dim">{sp.dept} · {sp.name}</div><h2>{sw.name}</h2>
          <div className="pltags"><span className={'plbadge ' + plConf(sw.confidence)}>{({ hi: '근거 충분', mid: '근거 보통', lo: '근거 부족' })[plConf(sw.confidence)]}</span>{stagesOf(sw).map((s) => <span key={s} className="pltag">{s}</span>)}</div>
          {sw.why && <p className="plwhy">{sw.why}</p>}
          <div className="plflow">
            {[['시작 계기', sw.trigger ? [sw.trigger] : []], ['받는 것', sw.inputs], ['하는 일', sw.steps, true], ['사람이 판단하는 곳', sw.decisions], ['결과물 · 넘기는 곳', sw.outputs]].map(([t, v, ol], k) => (
              <div key={k} className="plfs"><span className="pldot">{k + 1}</span><div><div className="pll">{t}</div>{list(v, ol)}</div></div>))}
          </div>
          {arr(sw.tools).length > 0 && <div className="pltags">{arr(sw.tools).map((t) => <span key={t} className="pltag">{t}</span>)}</div>}
          {arr(sw.pitfalls).length > 0 && <><div className="pll">주의할 점</div>{list(sw.pitfalls)}</>}
          {links.length > 0 && <><div className="pll">주고받는 사람 (표에 노랗게 표시)</div><div className="plppl">{links.map((n) => <button type="button" key={n} onClick={() => { setSel({ p: names.indexOf(n) }); setShow(''); }}>{n}</button>)}</div></>}
          <div className="plact">
            <button type="button" className={show === 'cap' ? 'on' : ''} onClick={() => setShow(show === 'cap' ? '' : 'cap')}>실제 화면 보기</button>
            <button type="button" className={show === 'video' ? 'on' : ''} onClick={() => setShow(show === 'video' ? '' : 'video')}>▶ 영상으로 인수인계</button>
          </div>
          {show === 'video' && <WorkflowVideo person={sp} wf={sw} thumbs={thumbs.items} onClose={() => setShow('')} />}
          {show === 'cap' && <CaptureGrid uid={sp.uid} thumbs={thumbs} />}
          <div className="pll" style={{ marginTop: 14 }}>실제 작업 기록 (최근 2주, 시간순 · 사진을 누르면 크게)</div>
          <WorkRecords uid={sp.uid} wfName={sw.name} stage={stagesOf(sw)[0] !== '기타' ? stagesOf(sw)[0] : ''} />
        </>}
      </aside>
    </div>
  );
}

// ───────────────────────── 탭 '도입 레이더' (관리자 전용) ─────────────────────────
// 사장님 PC ~/.orbit/adoption-ledger.json(nenova-work-features/adoption-ledger.js 가 매일 1줄 누적) 을 upload-adoption.js 가
// data/runtime/adoption-ledger.json 으로 올린다. 읽기는 /api/my-work/feature?name=adoption-ledger (isOrbitReportViewer 게이트, 캐시 5분).
// 탭 자체는 TABS 에서 mineOnly(관리자 아님)일 때 목록에 넣지 않아 노출되지 않는다. 새 권한 체계 없음.
const RADAR_RINGS = [['adopt', '도입'], ['trial', '시험'], ['assess', '평가'], ['hold', '보류']];
const PROBLEM_LABELS = {
  p1_lowestStaffConfirmedPct: 'p1 최저 직원 확증률(%)', p2_kimwonbinErpPct: 'p2 김원빈 전산 대조율(%)', p3_importHubScreensPerSettlement: 'p3 정산 1건당 화면 수',
  p4_kakaoRulesPromoted: 'p4 카톡 규칙 승격 건', p5_matchingSuggestions: 'p5 주문매칭 제안 건', p6_screenReadability: 'p6 화면 가독성', p7_quotaHold: 'p7 사용량 홀드',
};
const dash = (v) => (v === null || v === undefined || v === '' ? '-' : typeof v === 'boolean' ? (v ? '예' : '아니오') : typeof v === 'object' ? JSON.stringify(v) : String(v));
// 의존성 없이 SVG 폴리라인 — 두 지표(%·건수)는 축이 달라 각각 0~최댓값으로 정규화해 겹쳐 그린다.
function TrendChart({ days }) {
  const rows = arr(days).filter((d) => d?.date).slice(-60);
  if (!rows.length) return <p className="dim">추이 데이터 없음</p>;
  const W = 720, H = 180, L = 36, R = 36, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
  const series = [
    { key: 'pct', label: '평균 확증률(%)', color: '#1d4ed8', vals: rows.map((d) => Number(d.staffConfidence?.avgConfirmedPct)) },
    { key: 'conf', label: '확증 기록(건)', color: '#15803d', vals: rows.map((d) => Number(d.evidenceRecords?.confirmed)) },
  ];
  const x = (i) => L + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const drawn = series.map((s) => {
    const max = Math.max(1, ...s.vals.filter(Number.isFinite));
    return { ...s, max, pts: s.vals.map((v, i) => (Number.isFinite(v) ? [x(i), T + ih - (v / max) * ih, v] : null)) };
  });
  const every = Math.max(1, Math.ceil(rows.length / 12));
  return (
    <div className="tw">
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="확증률·확증기록 추이">
        {[0, 0.5, 1].map((f) => <line key={f} x1={L} x2={W - R} y1={T + ih - f * ih} y2={T + ih - f * ih} stroke="#e2e8f0" />)}
        {drawn.map((s, si) => <g key={s.key}>
          <text x={si === 0 ? L - 4 : W - R + 4} y={T + 4} textAnchor={si === 0 ? 'end' : 'start'} fill={s.color} fontSize="10" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.max}</text>
          <text x={si === 0 ? L - 4 : W - R + 4} y={T + ih} textAnchor={si === 0 ? 'end' : 'start'} fill={s.color} fontSize="10" style={{ fontVariantNumeric: 'tabular-nums' }}>0</text>
          <polyline fill="none" stroke={s.color} strokeWidth="2" points={s.pts.filter(Boolean).map((p) => p[0] + ',' + p[1]).join(' ')} />
          {s.pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={s.color}><title>{rows[i].date} {s.label} {p[2]}</title></circle>)}
        </g>)}
        {rows.map((d, i) => (i % every === 0 || i === rows.length - 1) && <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fill="#64748b" fontSize="10" style={{ fontVariantNumeric: 'tabular-nums' }}>{String(d.date).slice(5)}</text>)}
      </svg>
      <div className="chips">{drawn.map((s) => <span key={s.key} className="chip"><i className="sw" style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}
let _pmRadarCache = null;
function RadarTab() {
  const router = useRouter();
  const st = useFeature('adoption-ledger');
  const rep = useFeature('self-tune-report');
  const proc = useFeature('process-chains');
  const [techRadar, setTechRadar] = useState(_pmRadarCache);
  useEffect(() => {
    if (_pmRadarCache) { setTechRadar(_pmRadarCache); return undefined; }
    let alive = true;
    fetch('/api/pm/radar', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.success || !j?.data) return;
        _pmRadarCache = j.data;
        setTechRadar(j.data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const onOpenSuiteSim = () => router.push({ pathname: '/my-work', query: { tab: 'suite-sim' } }, undefined, { shallow: true });
  return (
    <>
      <ProcessReliability st={proc} />
      <Radar
        data={st.data}
        ledgerLoading={st.loading}
        ledgerError={st.error}
        rep={rep}
        techRadar={techRadar}
        onOpenSuiteSim={onOpenSuiteSim}
      />
    </>
  );
}
// 과정 신뢰도(2026-10-14 사장님: "인보이스→AI변환→전산 업로드→도착원가→전달 같은 과정 단위 분석과 신뢰도, 전 직원 동일").
//   process-chains.js 가 매일 올린 직원별 반복 과정(단계 체인)과 신뢰도 4요소(근거·이름·조작·일관), 자동화 힌트. 70점↑ 과정이 자동화 명세 후보.
function ProcessReliability({ st }) {
  if (st.loading || !st.data || !st.data.employees) return null;
  const rows = Object.entries(st.data.employees).map(([name, e]) => ({ name, ...e })).sort((a, b) => b.avgScore - a.avgScore);
  const regs = arr(st.data.regressions);
  return (
    <div className="doc radar">
      <h1>과정 신뢰도 <small>{String(st.data.generatedAt || '').slice(0, 10)} · 직원 {rows.length}명 · 과정 {rows.reduce((a, r) => a + (r.processes || 0), 0)}개</small></h1>
      <p className="dim">{dash(st.data.rule)}</p>
      {regs.length ? <ul>{regs.map((l, i) => <li key={i} className="warn">⚠ {l}</li>)}</ul> : null}
      <div className="tw"><table className="tbl small"><thead><tr><th>직원</th><th>과정</th><th>평균</th><th>대표 과정</th><th>반복</th><th>근거/이름/조작/일관</th><th>약점</th><th>자동화 힌트</th></tr></thead>
        <tbody>{rows.map((r) => { const t = arr(r.top)[0]; const rl = t?.reliability || {}; return (
          <tr key={r.name} className={rl.score >= 70 ? 'ok' : ''}><td>{r.name}</td><td>{r.processes}</td><td><b>{r.avgScore}</b></td>
            <td>{t ? t.sig : '-'}</td><td>{t ? `${t.episodes}회/${t.days}일 · ${t.medianMinutes}분` : '-'}</td>
            <td>{t ? `${rl.evidence}/${rl.name}/${rl.ops}/${rl.consistency}` : '-'}</td><td>{dash(rl.weakest)}</td>
            <td className="dim">{t ? arr(t.hints).map((h) => h.split(' → ')[0]).join(' · ') : '-'}</td></tr>); })}</tbody></table></div>
      <details><summary>과정별 절차(대표 에피소드)</summary>
        {rows.map((r) => arr(r.top).slice(0, 2).map((t, i) => (
          <div key={r.name + i}><h3>{r.name} · {t.sig} <small>신뢰도 {t.reliability?.score} · {t.episodes}회</small></h3>
            <ol>{arr(t.procedure).map((p, j) => <li key={j} className={/\[AI변환\]|\[전산업로드\]|\[전달\]/.test(p) ? 'warn' : ''}>{p}</li>)}</ol></div>)))}
      </details>
    </div>
  );
}
// 자가수정 일일 보고(2026-10-09 사장님: "자가수정 로직은 도는데 보고가 없다"). self-tune-report.js 가 매일 올린 사람 문장 요약 + 직원별 확증 증감 + 채택 임박 별칭.
function SelfTuneReport({ st }) {
  if (st.loading || !st.data) return null; // 아직 안 올라왔으면 조용히 생략(레이더는 그대로)
  const days = arr(st.data.days); const t = days[days.length - 1]; if (!t) return null;
  const conf = arr(t.confidence), nearly = arr(t.aliases?.nearly), hints = arr(t.hintChanges);
  const sign = (d) => (d === null || d === undefined ? '-' : (d > 0 ? '+' : '') + d);
  // 2026-11-24: 메시지 근거를 출처별로(카톡 업무방 / 왓츠앱·위챗). 분석 쪽이 출처별 건수를 올린 날부터만 넷째 숫자를 보인다.
  const hasSrc = conf.some((c) => c.msgMessenger !== undefined);
  const srcTotal = conf.reduce((a, c) => a + (Number(c.msgMessenger) || 0), 0);
  return (
    <div className="radar-selftune">
      <h2>자가수정 보고 <small className="num">{dash(t.date)} · 누적 {days.length}일</small></h2>
      <ul>{arr(t.summary).map((l, i) => <li key={i} className={/^⚠/.test(l) ? 'warn' : ''}>{l}</li>)}</ul>
      <h3>직원별 확증 <small>어제 대비{hasSrc ? ` · 해외 메신저(왓츠앱·위챗) 근거 ${srcTotal}건` : ''}</small></h3>
      <div className="tw"><table className="tbl small num-tbl"><thead><tr><th>직원</th><th>기록</th><th>확증</th><th>%</th><th>어제 대비</th><th>{hasSrc ? '전산/파일/카톡/해외 메신저' : '전산/파일/카톡'}</th></tr></thead>
        <tbody>{conf.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.records}</td><td>{c.confirmed}</td><td>{c.pct}</td><td>{sign(c.delta)}</td><td>{hasSrc ? `${c.erp}/${c.file}/${c.msgKakao ?? c.msg}/${c.msgMessenger ?? 0}` : `${c.erp}/${c.file}/${c.msg}`}</td></tr>)}</tbody></table></div>
      <h3>채택 임박 별칭 <small className="num">후보 {dash(t.aliases?.candidates)} · 채택 {arr(t.aliases?.active).length}</small></h3>
      {nearly.length ? <ul>{nearly.map((p, i) => <li key={i}>{p.nick} → {p.canonical} <span className="dim num">({p.count}회·{p.days}일, {p.need})</span></li>)}</ul> : <p className="dim">없음</p>}
      {hints.length ? <><h3>해독 요령 변화 <small className="num">{hints.length}명</small></h3><ul>{hints.map((h, i) => <li key={i}><b>{h.name}</b><br /><span className="dim">전: {h.before}</span><br />후: {h.after}</li>)}</ul></> : null}
      {t.experiment ? <p className="dim num">실험 {dash(t.experiment.id)}: {dash(t.experiment.progress)} · 목표 {dash(t.experiment.target)}</p> : null}
    </div>
  );
}
function Radar({ data, ledgerLoading = false, ledgerError = '', rep = { loading: false, data: null }, techRadar, onOpenSuiteSim }) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const days = arr(data?.days);
  const last = days[days.length - 1] || null;
  const cands = arr(data?.candidates);
  const decisions = data?.decisions && typeof data.decisions === 'object' ? Object.entries(data.decisions) : [];
  const problems = last?.problemRegister && typeof last.problemRegister === 'object' ? last.problemRegister : null;
  return (
    <div className="doc wide radar">
      <TechRadarWorkbench
        ledger={data}
        techRadar={techRadar}
        isAdmin={true}
        mode="clear"
        standaloneUiStyles={true}
        onOpenSuiteSim={onOpenSuiteSim}
        initialPlanMode="A"
        title="도입 · 기술 레이더 & 실설계 도입 시뮬레이터"
        subtitle="adoption-ledger 도입 장부와 tech-radar(GitHub 파일럿 실측)를 통합하고, 인수인계된 nenovakakao 6대 실설계 표면 기준으로 도입 전/후 변화를 시뮬레이션합니다."
      />
      <section className="radar-archive" data-testid="radar-ledger-archive" aria-label="원장 로우데이터 및 일별 자가조율 로그">
        <div className="radar-archive-bar">
          <div className="radar-archive-meta">
            <b>원장 로우데이터 및 일별 자가조율 로그</b>
            <span className="dim num">
              {data
                ? `기준일 ${dash(data.baselineDate)} · 갱신 ${data.updatedAt ? fmtTs(data.updatedAt) : '-'} · 누적 ${days.length}일${data.note ? ' · ' + data.note : ''}`
                : ledgerLoading
                  ? 'adoption-ledger 불러오는 중…'
                  : 'adoption-ledger 미업로드 (시뮬레이터 프리셋 동작 중)'}
            </span>
          </div>
          <button
            type="button"
            className="sm"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen((v) => !v)}
          >
            {archiveOpen ? '원장 로우데이터 및 일별 자가조율 로그 닫기' : '원장 로우데이터 및 일별 자가조율 로그 열람'}
          </button>
        </div>

        {archiveOpen && (
          <div className="radar-archive-body">
            <SelfTuneReport st={rep} />
            {!data && (
              <p className="warn" style={{ margin: 0 }}>
                {ledgerError ? `adoption-ledger 불러오기 안내: ${ledgerError}` : 'adoption-ledger.json 이 아직 올라오지 않았습니다 (사장님 PC run-all.sh → upload-adoption.js).'}
              </p>
            )}
            {data && <>
              <h2>도입 장부 상세 원장 <small className="num">기준일 {dash(data.baselineDate)} · 누적 {days.length}일</small></h2>
              <h3>레이더 4단계 <small>도입 · 시험 · 평가 · 보류</small></h3>
              <div className="rings">{RADAR_RINGS.map(([k, label]) => <div className="ring" key={k}>
                <h4>{label} <span className="dim num">{arr(data.radar?.[k]).length}</span></h4>
                {arr(data.radar?.[k]).length ? <ul>{arr(data.radar[k]).map((it, i) => <li key={i}>{dash(it)}</li>)}</ul> : <p className="dim">-</p>}
              </div>)}</div>
              <h3>추이 <small>평균 확증률 · 확증 기록(일별)</small></h3>
              <TrendChart days={days} />
              <h3>실험 <small className="num">{arr(data.experiments).length}건</small></h3>
              {arr(data.experiments).length ? <div className="tw"><table className="tbl num-tbl"><thead><tr><th>ID</th><th>이름</th><th>지표</th><th>기준일</th><th>기준값</th><th>목표</th><th>상태</th></tr></thead>
                <tbody>{arr(data.experiments).map((e, i) => <tr key={e.id || i}><td>{dash(e.id)}</td><td>{dash(e.name)}</td><td>{dash(e.metric)}</td><td>{dash(e.baselineDate)}</td>
                  <td>{e.baseline && typeof e.baseline === 'object' ? Object.entries(e.baseline).map(([k, v]) => <span key={k} className="chip">{k} <em>{dash(v)}</em></span>) : dash(e.baseline)}</td>
                  <td>{dash(e.target)}</td><td>{dash(e.status)}</td></tr>)}</tbody></table></div> : <p className="dim">실험 없음</p>}
              <h3>후보 <small className="num">탐색 결과 {cands.length}건</small></h3>
              {cands.length ? <div className="tw"><table className="tbl small num-tbl"><thead><tr><th>제목</th><th>출처</th><th>적합도</th><th>문제</th><th>이유</th><th>조치</th></tr></thead>
                <tbody>{cands.map((c, i) => <tr key={i}><td>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{dash(c.title)}</a> : dash(c.title)}</td><td>{dash(c.source)}</td><td>{dash(c.fit)}</td><td>{dash(c.problem)}</td><td>{dash(c.why)}</td><td>{dash(c.action)}</td></tr>)}</tbody></table></div>
                : <p className="dim">탐색 결과 없음</p>}
              <h3>결정</h3>
              {decisions.length ? <div className="kv">{decisions.map(([k, v]) => <span key={k}><b>{k}</b>{dash(v)}</span>)}</div> : <p className="dim">-</p>}
              <h3>문제 등록부 <small className="num">{last ? last.date : '-'}</small></h3>
              {problems ? <div className="tw"><table className="tbl small num-tbl"><thead><tr><th>항목</th><th>값</th></tr></thead>
                <tbody>{Object.keys(PROBLEM_LABELS).map((k) => <tr key={k}><td>{PROBLEM_LABELS[k]}</td><td>{dash(problems[k])}</td></tr>)}
                  {Object.keys(problems).filter((k) => !PROBLEM_LABELS[k]).map((k) => <tr key={k}><td>{k}</td><td>{dash(problems[k])}</td></tr>)}</tbody></table></div> : <p className="dim">-</p>}
              {last?.staffConfidence?.byEmployee && <>
                <h3>직원별 확증률 <small className="num">{dash(last.staffConfidence.accuracyDate)} · 최저 {dash(last.staffConfidence.lowest?.name)} {dash(last.staffConfidence.lowest?.confirmedPct)}%</small></h3>
                <div className="tw"><table className="tbl small num-tbl"><thead><tr><th>직원</th><th>확증(%)</th><th>전산(%)</th><th>파일(%)</th><th>메시지(%)</th><th>단계</th></tr></thead>
                  <tbody>{Object.entries(last.staffConfidence.byEmployee).map(([n, v]) => <tr key={n}><td>{n}</td><td>{dash(v?.confirmedPct)}</td><td>{dash(v?.erpPct)}</td><td>{dash(v?.filePct)}</td><td>{dash(v?.msgPct)}</td><td>{dash(v?.steps)}</td></tr>)}</tbody></table></div>
              </>}
            </>}
          </div>
        )}
      </section>
    </div>
  );
}

function FeatureTab({ name, render }) {
  const st = useFeature(name);
  return <Loading st={st}>{render(st.data)}</Loading>;
}
function ProposalsTab() {
  const sims = useFeature('simulations');
  const pr = useFeature('proposals'); // 엑셀 되풀이 자료 표(excel 칸)를 항상 맨 위에 보이려고 늘 불러온다
  if (sims.loading) return <Loading st={sims} />;
  const hasSim = arr(sims.data?.people).some((p) => arr(p.items).length);
  return (<>
    {hasSim && pr.data?.excel && <div className="doc xtop"><ExcelCandidates x={pr.data.excel} /></div>}
    <Simulator sims={sims.data} fallback={<Loading st={pr}><Proposals data={pr.data} /></Loading>} />
  </>);
}

export default function MyWorkPage({ userId, orbit, orbitQs = '', tab: tab0, mine = null, mineOnly = false }) {
  const router = useRouter();
  const [tab, setTab] = useState(tab0);
  const TABS = mineOnly ? [
    { id: 'mine', label: '내 업무흐름' },
    { id: 'arch', label: '아키텍처 흐름도' },
  ] : [
    { id: 'pipeline', label: '업무 파이프라인' },
    { id: 'arch', label: '아키텍처 흐름도' },
    { id: 'suite-sim', label: '통합 솔루션 시뮬레이션' },
    { id: 'devices', label: '디바이스 허브 관제' },
    { id: 'workflows', label: '업무 흐름' },
    { id: 'proposals', label: '기능 추가 후보 (시뮬레이션)' },
    { id: 'unified', label: '업무 통합본 (최신)' },
    { id: 'erp', label: '전산 실제 처리' }, // Orbit /erp-work.html — nenova 저장 동작 ↔ 실제 전산 변경 대조(직원별)
    { id: 'story', label: '캡처식 워크플로우' },
    { id: 'replay', label: 'nenovaweb 화면 재생' },
    { id: 'orbit', label: 'Orbit 작업 데이터 전체' },
    { id: 'radar', label: '도입 레이더' }, // 관리자(isOrbitReportViewer) 전용 — mineOnly 목록에는 없음
    { id: 'cost-agi', label: '수입 원가·이익 AGI' },
  ];
  useEffect(() => {
    const rawTab = typeof router.query?.tab === 'string' ? router.query.tab : '';
    const qt = rawTab === 'gabriel-agi' ? 'cost-agi' : rawTab; // 옛 탭 주소(2026-11-21 이름 변경) 호환
    if (qt && TABS.some((t) => t.id === qt)) setTab(qt);
  }, [router.query?.tab, mineOnly]);
  return (
    <div className="wrap" data-my-work>
      <header className="bar">
        <div className="bar-top">
          <MenuBackButton />
          <div className="bar-brand">
            <b data-desktop-chrome>내 작업 데이터</b>
            <span className="bar-sub">NENOVA EDITORIAL WORKBENCH</span>
          </div>
          <div className="bar-right">
            <span className="acct-badge">{userId} 전용</span>
            {!mineOnly && <a href={orbit + '/my-work.html' + orbitQs} target="_blank" rel="noreferrer">Orbit 새 창 ↗</a>}
          </div>
        </div>
        <nav className="bar-tabs" aria-label="작업 데이터 메뉴 탭">
          {TABS.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </nav>
      </header>
      <div className="stage">
        {tab === 'mine' && <MyFlowTab mine={mine} />}
        {tab === 'arch' && <ArchFlowChart onSelectTab={setTab} mineOnly={mineOnly} />}
        {tab === 'suite-sim' && !mineOnly && <SolutionSuiteSimulator orbit={orbit} orbitQs={orbitQs} onSelectTab={setTab} />}
        {tab === 'devices' && !mineOnly && <DeviceHubConsole onSelectTab={setTab} />}
        {tab === 'unified' && <iframe title="업무 통합본" src={orbit + '/work-unified.html' + orbitQs} />}
        {tab === 'erp' && <iframe title="전산 실제 처리" src={orbit + '/erp-work.html' + orbitQs} />}
        {tab === 'orbit' && <iframe title="Orbit 작업 데이터" src={orbit + '/my-work.html' + orbitQs} />}
        {tab === 'pipeline' && <FeatureTab name="workflows" render={(wf) => <Pipeline wf={wf} />} />}
        {tab === 'workflows' && <FeatureTab name="workflows" render={(wf) => <Workflows wf={wf} />} />}
        {tab === 'proposals' && <ProposalsTab />}
        {tab === 'story' && <StoryTab />}
        {tab === 'replay' && <Replay />}
        {tab === 'radar' && !mineOnly && <RadarTab />}
        {tab === 'cost-agi' && !mineOnly && (
          <div className="doc wide">
            <ImportCostAgiWorkbench userId={userId} embedded={true} showGuide={false} />
          </div>
        )}
      </div>
      <style jsx global>{`
        html,body{margin:0;height:100%}
        .wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#f8fafc;color:#0f172a;font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif;font-size:13.5px}
        .bar{flex:0 0 auto;position:relative;z-index:20;display:flex;flex-direction:column;background:#ffffff;border-bottom:1px solid #cbd5e1;box-shadow:none}
        .bar-top{display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid #e2e8f0;flex-wrap:nowrap;background:#ffffff}
        .bar-brand{display:flex;align-items:baseline;gap:8px;min-width:0}
        .bar-brand b{font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;white-space:nowrap}
        .bar-sub{font-size:11.5px;font-weight:700;letter-spacing:0.05em;color:#475569;white-space:nowrap}
        .bar-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0}
        .acct-badge{font-size:12.5px;font-weight:600;color:#1e293b;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:3px 9px;font-variant-numeric:tabular-nums;white-space:nowrap}
        .bar-tabs{display:flex;align-items:center;gap:1px;padding:0 12px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;background:#ffffff}
        .bar button:not(.nv-back){flex:0 0 auto;white-space:nowrap;background:transparent;color:#334155;border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 6px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;transition:color .12s,border-color .12s}
        .bar button:not(.nv-back):hover{color:#0f172a;border-bottom-color:#cbd5e1}
        .bar button:not(.nv-back).on{color:#1d4ed8;border-bottom-color:#1d4ed8;font-weight:700}
        .bar button:not(.nv-back):focus-visible,.bar a:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px}
        .bar a{color:#1e293b;background:#ffffff;border:1px solid #cbd5e1;border-radius:4px;padding:4px 10px;text-decoration:none;font-size:12.5px;font-weight:600;white-space:nowrap}
        .bar a:hover{background:#f1f5f9;color:#0f172a}
        .stage{flex:1 1 auto;min-height:0;position:relative;overflow:auto;background:#f8fafc;color:#0f172a}
        .stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#ffffff}
        [data-my-work] .stage .dhc-root{background:#0f172a;border:1px solid #cbd5e1;border-radius:6px;margin-top:14px;margin-bottom:24px}
        .num{font-variant-numeric:tabular-nums}
        .num-tbl td,.num-tbl th{font-variant-numeric:tabular-nums}
        .plwrap{display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:14px;padding:16px 18px;align-items:start}
        @media(max-width:1100px){.plwrap{grid-template-columns:1fr}}
        .pllede{color:#475569;margin:0 0 10px;max-width:80ch}
        .plmap{display:grid;grid-template-columns:repeat(10,minmax(84px,1fr));gap:3px;overflow-x:auto}
        .plstg{font:inherit;font-weight:700;color:#0f172a;background:#ffffff;border:1px solid #cbd5e1;padding:10px 12px 10px 18px;cursor:pointer;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%,10px 50%)}
        .plstg:first-child{clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%);padding-left:12px}
        .plstg.none{background:#f1f5f9;color:#94a3b8}.plstg.on{background:#1d4ed8;color:#ffffff}
        .plstg:focus-visible,.plchip:focus-visible,.plname:focus-visible{outline:2px solid #1d4ed8;outline-offset:1px}
        .pllegend{display:flex;gap:14px;flex-wrap:wrap;color:#475569;font-size:12px;margin:8px 0 12px}
        .pllegend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
        .pllegend i.hi{background:#15803d}.pllegend i.mid{background:#b45309}.pllegend i.lo{background:#94a3b8}.pllegend i.none{background:#f1f5f9;border:1px solid #cbd5e1}
        .pllanes{border:1px solid #e2e8f0;border-radius:6px;overflow:auto;max-height:calc(100vh - 230px);background:#ffffff}
        .pllanes table{border-collapse:separate;border-spacing:0;min-width:1150px;width:100%}
        .pllanes th,.pllanes td{border-bottom:1px solid #e2e8f0;vertical-align:top;padding:6px}
        .pllanes thead th{position:sticky;top:0;background:#f1f5f9;z-index:2;color:#334155;font-weight:700;text-align:left;white-space:nowrap;border-bottom:1px solid #cbd5e1}
        .pllanes th.hl,.pllanes td.hl{background:#eff6ff}
        .plwho{position:sticky;left:0;background:#ffffff;z-index:1;width:92px;border-right:1px solid #e2e8f0}
        thead .plwho{z-index:3;background:#f1f5f9}
        .pldept td{background:#f8fafc;color:#475569;font-weight:700;font-size:11.5px;padding:4px 8px}
        tr.link td{background:#fef9c3}
        .plname{font:inherit;font-weight:700;font-size:13.5px;color:#0f172a;background:none;border:0;padding:2px 0;cursor:pointer;text-align:left}
        .plname:hover{color:#1d4ed8}
        .plchip{display:block;width:100%;min-width:96px;text-align:left;font:inherit;font-size:12px;line-height:1.35;color:#0f172a;background:#ffffff;border:1px solid #cbd5e1;border-left:3px solid #94a3b8;border-radius:4px;padding:5px 7px;margin-bottom:4px;cursor:pointer}
        .plchip.hi{border-left-color:#15803d}.plchip.mid{border-left-color:#b45309}
        .plchip:hover{border-color:#1d4ed8}.plchip.on{background:#eff6ff;border-color:#1d4ed8;color:#0f172a}.plchip.dim{opacity:.38}
        .plside{position:sticky;top:0;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;max-height:calc(100vh - 80px);overflow:auto;color:#0f172a}
        /* PC pipeline content follows the main stage scroll. Horizontal table
           overflow stays available; neither lane rows nor detail text is clipped. */
        @media screen {
          html[data-nenova-desktop="true"] [data-my-work] .plm{min-width:0}
          html[data-nenova-desktop="true"] [data-my-work] .pllanes{max-height:none;overflow-x:auto;overflow-y:visible}
          html[data-nenova-desktop="true"] [data-my-work] .plside{position:static;max-height:none;overflow:visible;overflow-wrap:anywhere;min-width:0}
        }
        .plside h2{margin:2px 0 6px;font-size:16px;color:#0f172a}
        .plwhy{color:#334155}
        .pll{color:#64748b;font-size:11.5px;font-weight:700;letter-spacing:.03em;margin:10px 0 3px}
        .pltags{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
        .pltag{font-size:11px;border:1px solid #cbd5e1;border-radius:4px;padding:0 6px;color:#475569;background:#f8fafc}
        .plbadge{font-size:11px;font-weight:700;border-radius:4px;padding:1px 7px;border:1px solid transparent}
        .plbadge.hi{background:#dcfce7;color:#15803d;border-color:#bbf7d0}.plbadge.mid{background:#fef3c7;color:#b45309;border-color:#fde68a}.plbadge.lo{background:#f1f5f9;color:#475569;border-color:#cbd5e1}
        .plflow{margin-top:8px}
        .plfs{display:grid;grid-template-columns:22px 1fr;gap:8px;position:relative;padding-bottom:10px}
        .plfs::before{content:"";position:absolute;left:10px;top:22px;bottom:0;width:2px;background:#e2e8f0}
        .plfs:last-child::before{display:none}
        .pldot{width:22px;height:22px;border-radius:4px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:11px;font-weight:700;display:grid;place-items:center;font-variant-numeric:tabular-nums}
        .plfs .pll{margin-top:2px}.plfs ul,.plfs ol,.plside ul{margin:2px 0 0;padding-left:18px}
        .plrh{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;margin:4px 0}.plrh dt{color:#1d4ed8;font-weight:700}.plrh dd{margin:0}
        .plppl{display:flex;flex-wrap:wrap;gap:4px}
        .plppl button,.plact button{font:inherit;font-size:12px;color:#0f172a;background:#ffffff;border:1px solid #cbd5e1;border-radius:4px;padding:3px 10px;cursor:pointer}
        .plppl button:hover,.plact button:hover{background:#f1f5f9;border-color:#94a3b8}
        .plrec{display:grid;gap:8px}
        .plr{border:1px solid #e2e8f0;border-radius:6px;padding:9px 11px;display:grid;gap:3px;font-size:12.5px;background:#ffffff}
        .plrh2{display:flex;gap:8px;align-items:baseline}.plt{color:#1d4ed8;font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
        .plk{display:inline-block;min-width:58px;color:#64748b;font-size:11px;font-weight:700;margin-right:6px}
        .plr ul{margin:0;padding-left:18px}
        .ann{position:relative;display:block;cursor:zoom-in;margin-top:4px;line-height:0}
        .ann img{width:100%;display:block;border-radius:4px;border:1px solid #cbd5e1}
        .ann.sm{width:240px}.ann.md{width:100%;max-width:520px}.ann.lg{width:100%;cursor:zoom-out}
        .annbox{position:absolute;border:2px solid #dc2626;border-radius:3px;background:rgba(220,38,38,.10);pointer-events:none}
        .annno{position:absolute;transform:translate(-45%,-45%);min-width:18px;height:18px;padding:0 4px;border-radius:4px;background:#dc2626;color:#ffffff;font:700 11px/16px sans-serif;text-align:center;border:2px solid #ffffff;pointer-events:none;font-variant-numeric:tabular-nums}
        .annno.inl{position:static;display:inline-block;transform:none;margin-right:6px;border:0}
        .annlist{list-style:none;margin:6px 0 2px;padding:0;display:grid;gap:3px}
        .annflow{display:flex;gap:18px;overflow-x:auto;padding:4px 2px 10px}
        .annstep{flex:0 0 240px;position:relative}
        .annstep:not(:last-child)::after{content:'→';position:absolute;right:-15px;top:70px;color:#dc2626;font-weight:700}
        .annhead{font-size:11.5px;color:#334155;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.annhead b{color:#dc2626}
        .anncap{font-size:11px;color:#64748b;margin-top:3px}
        .plimg{max-width:160px;border-radius:4px;border:1px solid #cbd5e1;cursor:zoom-in;margin-top:4px}
        .plimg.big{max-width:100%;cursor:zoom-out}
        .plact{display:flex;gap:6px;margin:12px 0 8px}.plact button.on{border-color:#1d4ed8;background:#1d4ed8;color:#ffffff}

        .doc{max-width:1200px;margin:0 auto;padding:18px 22px 60px;color:#0f172a}
        .doc h1{font-size:20px;margin:0 0 6px;color:#0f172a}.doc > h2,.radar-archive h2,.person h2{font-size:15.5px;margin:22px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:5px;color:#0f172a}
        .doc h2 small,.doc h3 small{color:#64748b;font-weight:400;font-size:12px;margin-left:8px}
        .doc h3{font-size:13.5px;margin:14px 0 6px;color:#1e293b}.tog{cursor:pointer;user-select:none}.tog:hover{color:#1d4ed8}
        .dim{color:#475569}.warn{color:#b45309}
        .chip{display:inline-block;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:1px 7px;margin:2px 3px 2px 0;font-size:11.5px;color:#334155}
        .chip em{color:#64748b;font-style:normal}
        .doc.xtop{padding-bottom:0}.xcand{margin:14px 0 26px}.xcand h2{font-size:15.5px;margin:18px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:5px;color:#0f172a}
        .xpurpose{font-size:14px;color:#0f172a;border-left:4px solid #334155;padding:6px 10px;background:#f8fafc;margin:8px 0}
        .xtbl{font-size:13.5px}.xtbl .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.xrow{cursor:pointer}
        .xst{display:inline-block;white-space:nowrap;border-radius:4px;padding:2px 8px;font-size:12.5px;font-weight:700;border:1px solid #cbd5e1;color:#334155;background:#f1f5f9}
        .xst.xneed{color:#9f1239;border-color:#fda4af;background:#fff1f2}.xst.xgap{color:#92400e;border-color:#fcd34d;background:#fffbeb}.xst.xok{color:#166534;border-color:#86efac;background:#f0fdf4}
        .xdept{margin:0 0 6px}.xdept .num{font-variant-numeric:tabular-nums;color:#334155;margin:0 6px}
        .xmore{background:#f8fafc!important}.xmore div{margin:3px 0}.xmore .chip{font-size:12.5px}
        .chips{display:flex;flex-wrap:wrap}
        .stats div{margin:3px 0}
        .tbl{width:100%;border-collapse:collapse;font-size:12.5px;background:#ffffff}.tbl th,.tbl td{border:1px solid #e2e8f0;padding:7px 9px;vertical-align:top;text-align:left;color:#0f172a}
        .tbl th{background:#f1f5f9;color:#334155;font-weight:700}.tbl.small{font-size:11.5px}
        .doc .tbl tbody tr,.doc .tbl tbody tr:nth-child(even){background:#ffffff!important}
        .doc .tbl tbody tr:hover{background:#f8fafc!important}
        .doc .tbl td{background:transparent!important;color:#0f172a!important}
        .pri{color:#b45309;white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums}
        .manual{border:1px solid #e2e8f0;border-radius:6px;padding:9px 12px;margin:6px 0;background:#ffffff}
        .manual ol{margin:4px 0 0;padding-left:20px}.manual li{margin:2px 0}
        .shared li{margin:6px 0}
        .jump{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.jump a{color:#1d4ed8;background:#ffffff;border:1px solid #cbd5e1;border-radius:4px;padding:3px 10px;text-decoration:none;font-weight:600}
        .jump a:hover{background:#f1f5f9}
        .person{margin-top:24px;padding-top:6px}
        .radar-archive{margin-top:14px;border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;overflow:hidden}
        .radar-archive-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:#ffffff}
        .radar-archive-meta{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
        .radar-archive-meta b{font-size:13px;color:#0f172a}
        .radar-archive-body{border-top:1px solid #e2e8f0;padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px;background:#f8fafc}
        .radar-selftune{background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px}
        .radar-selftune h2{margin-top:0}
        .radar .rings{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #e2e8f0;border-radius:4px;background:#ffffff;overflow:hidden}
        @media(max-width:900px){.radar .rings{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .radar .ring{border-right:1px solid #e2e8f0;padding:10px 12px;background:#ffffff}
        .radar .ring:last-child{border-right:0}
        .radar .ring h4{margin:0 0 6px;font-size:13px;color:#0f172a}.radar .ring ul{margin:0;padding-left:18px}.radar .ring li{margin:3px 0}
        .radar .trend{width:100%;max-width:760px;height:auto;display:block;background:#ffffff;border:1px solid #e2e8f0;border-radius:4px}
        .radar .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
        .radar .tw{overflow-x:auto}.radar .kv span{display:block;margin:3px 0}
        .jump a.on{background:#1d4ed8;border-color:#1d4ed8;color:#ffffff}.jump a em{color:inherit;opacity:.75;font-style:normal;font-size:11px;margin-left:4px;font-variant-numeric:tabular-nums}
        .prop{border:1px solid #e2e8f0;border-radius:6px;padding:9px 12px;margin:8px 0 12px;background:#ffffff}.prop div{margin:3px 0}
        .film{display:flex;gap:10px;overflow-x:auto;padding:8px 0 14px;scroll-snap-type:x proximity}
        .frame{flex:0 0 250px;scroll-snap-align:start;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;padding:8px 10px;display:flex;flex-direction:column;gap:5px;min-height:170px}
        .frame.hit{border-color:#b45309;border-left:3px solid #b45309}
        .fhead{display:flex;gap:6px;align-items:center;font-size:11px;color:#64748b}.fhead .t{font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}.fhead .app{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.fhead .dot{color:#b45309}
        .screen{font-weight:600;font-size:12px;line-height:1.35;border-bottom:1px dashed #e2e8f0;padding-bottom:4px;color:#0f172a}
        .act{font-size:11.5px;line-height:1.4;color:#334155}
        .hint{font-size:10.5px;color:#64748b;margin-top:auto;padding-top:4px;border-top:1px dashed #e2e8f0}.hint.auto{color:#15803d}
        .doc.wide{max-width:1500px}
        .sum{border:1px solid #e2e8f0;border-radius:6px;padding:9px 12px;margin:8px 0;background:#ffffff;font-size:12.5px;color:#0f172a}.sum div{margin-top:3px}
        .narr{white-space:pre-wrap;font:12.5px/1.55 inherit;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;color:#0f172a;max-height:520px;overflow:auto}
        .filmv{display:flex;flex-direction:column;gap:10px;padding:6px 0 30px}
        .framev{border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
        .framev.hit{border-color:#b45309;border-left:3px solid #b45309}
        .framev .fhead{font-size:12px;flex-wrap:wrap}.framev .no{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:0 7px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}
        .framev .screen{font-size:13.5px}.framev .act{font-size:12.5px}
        .framev .sub{font-size:11.5px;color:#334155;border-top:1px dashed #e2e8f0;padding-top:5px}.framev .sub ol{margin:3px 0 0;padding-left:20px}.framev .sub li{margin:1px 0}.framev .sub em{color:#64748b;font-style:normal}
        .t2{color:#64748b;font-variant-numeric:tabular-nums;margin-right:4px}
        .chip.auto{color:#15803d;border-color:#bbf7d0;background:#dcfce7}
        .framev .hint{margin-top:2px;font-size:11.5px}
        .rp{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-top:10px}.rpl{flex:1 1 640px;min-width:0}
        .rpr{flex:0 0 380px;max-height:720px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:8px 10px;font-size:12px}
        .rpr ol{margin:6px 0 0;padding-left:22px}.rpr li{margin:3px 0;cursor:pointer;line-height:1.45}.rpr li:hover{color:#1d4ed8}.rpr .val{color:#b45309}.rpr li.k-route{color:#1d4ed8}
        .kv span{display:block;margin:2px 0}.kv b{color:#475569;font-weight:600;margin-right:6px}.kv .ok{color:#15803d}
        .ft{border-collapse:collapse;font-size:11px;margin-top:4px;background:#ffffff}.ft th,.ft td{border:1px solid #e2e8f0;padding:3px 7px;text-align:left;vertical-align:top}.ft th{background:#f1f5f9;color:#334155}
        .ft .val{color:#b45309;max-width:320px;word-break:break-all}.tw{overflow-x:auto}
        .doc .ft tbody tr,.doc .ft tbody tr:nth-child(even){background:#ffffff!important}.doc .ft td{background:transparent!important;color:#0f172a!important}
        .bars{display:inline-flex;width:180px;height:10px;border-radius:3px;overflow:hidden;vertical-align:middle;background:#e2e8f0}
        .bars i{display:block;height:100%}
        .s0{background:#1d4ed8}.s1{background:#15803d}.s2{background:#b45309}.s3{background:#db2777}.s4{background:#6d28d9}.s5{background:#0284c7}.s6{background:#059669}.s7{background:#d97706}.s8{background:#dc2626}.s9{background:#64748b}.s10{background:#94a3b8}.s11{background:#cbd5e1}
        .conf{display:inline-block;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;border:1px solid;font-variant-numeric:tabular-nums}.conf.hi{color:#15803d;background:#dcfce7;border-color:#bbf7d0}.conf.mid{color:#b45309;background:#fef3c7;border-color:#fde68a}.conf.lo{color:#b91c1c;background:#fee2e2;border-color:#fecaca}
        .wfwrap{display:flex;min-height:100%}.wfl{flex:0 0 230px;border-right:1px solid #e2e8f0;padding:10px 8px;background:#ffffff;overflow:auto}
        .dept{color:#64748b;font-size:11.5px;margin:10px 6px 4px;font-weight:700}
        .pp{display:flex;justify-content:space-between;align-items:center;width:100%;background:none;border:1px solid transparent;color:#0f172a;border-radius:4px;padding:5px 8px;cursor:pointer;font:inherit;text-align:left}
        .pp:hover{background:#f8fafc}
        .pp.on{background:#eff6ff;border-color:#1d4ed8;color:#1d4ed8;font-weight:600}.pp .cc{display:flex;gap:3px;align-items:center}
        .wfm{flex:1;min-width:0;padding:16px 22px 60px;max-width:1300px}.wfm h1{font-size:20px;margin:0 0 6px;color:#0f172a}.wfm h3{font-size:13.5px;margin:18px 0 6px;color:#0f172a}
        .tl{border-left:2px solid #cbd5e1;margin-left:6px;padding-left:12px}.tlr{position:relative;margin:6px 0;display:flex;gap:10px}.tlw{flex:0 0 190px;color:#1d4ed8;font-weight:600;font-variant-numeric:tabular-nums}
        .tld{position:absolute;left:-18px;top:5px;width:10px;height:10px;border-radius:50%;background:#1d4ed8}
        .wfc{border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px;margin:10px 0}
        .wfh{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
        .flow{display:flex;gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:4px}.arw{align-self:center;color:#1d4ed8;font-size:18px}
        .fcol{flex:1 1 160px;min-width:150px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px;font-size:12px}.fcol.steps{flex:2 1 280px}
        .fcol .fl{color:#475569;font-size:11px;font-weight:700;margin-bottom:3px}.fcol .fi{margin:2px 0;line-height:1.4}.fcol ol{margin:0;padding-left:18px}.fcol li{margin:2px 0;line-height:1.4}
        .sroute{font-size:11px;color:#475569;margin:1px 0 4px}.sroute i{font-style:normal;color:#64748b;margin-right:2px}.fcol.trg{border-left:3px solid #1d4ed8}.fcol.dec{border-left:3px solid #b45309}.fcol.out{border-left:3px solid #15803d}
        .wfd{margin-top:8px;font-size:12.5px}.wfd>div{margin:4px 0}.wfd ul{margin:2px 0;padding-left:20px}
        .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
        .thumb{margin:0;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden;background:#ffffff}.thumb img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;background:#f1f5f9}
        .thumb figcaption{font-size:11px;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155}
        .unk li{margin:4px 0}
        button.sm{background:#ffffff;color:#0f172a;border:1px solid #cbd5e1;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12px;font-weight:600}
        button.sm:hover{background:#f1f5f9;border-color:#94a3b8}
        button.sm.pri2{border-color:#1d4ed8;color:#ffffff;background:#1d4ed8}
        .sim{display:flex;gap:14px;flex-wrap:wrap}.simp{flex:1 1 480px;min-width:0;border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px}
        .simh{display:flex;gap:10px;align-items:baseline;margin-bottom:8px}.timer{font-size:22px;font-weight:700;color:#b91c1c;font-variant-numeric:tabular-nums}.timer.ok{color:#15803d}
        .simsteps{margin:0;padding-left:22px}.simsteps li{margin:6px 0;transition:opacity .3s}.simsteps li.todo{opacity:.4}.simsteps li.cur{opacity:.75}.simsteps li.done{opacity:1}
        .simsteps li.pain.done{border-left:3px solid #b91c1c;padding-left:6px}.painx{color:#b91c1c;font-size:12px;margin-top:2px}
        .mock{border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#0f172a;margin-bottom:10px;overflow:hidden}
        .mockt{background:#1d4ed8;color:#ffffff;padding:6px 10px;font-weight:700;font-size:12.5px}.mockf{display:flex;gap:10px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#ffffff}
        .mockf label{font-size:11.5px;color:#475569;display:flex;gap:4px;align-items:center}.mockf .inp{background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;padding:2px 8px;color:#0f172a}
        .mtb{width:100%;border-collapse:collapse;font-size:12px}.mtb th,.mtb td{border:1px solid #e2e8f0;padding:4px 7px;text-align:left}.mtb th{background:#f1f5f9;color:#334155}
        .doc .mtb tbody tr,.doc .mtb tbody tr:nth-child(even){background:#ffffff!important}.doc .mtb td{color:#0f172a!important}
        .doc .mtb td.hl{background:#fef3c7!important;font-weight:700}.hln{display:block;font-size:10.5px;color:#92400e;font-weight:400}
        .mockb{display:flex;gap:8px;padding:8px 10px;background:#ffffff}.mockb button{background:#1d4ed8;color:#ffffff;border:0;border-radius:4px;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px;font-weight:600}
        .modal{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:50}.modalb{background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;padding:14px;width:min(640px,92vw);display:flex;flex-direction:column;gap:8px;color:#0f172a}
        .modalb textarea{width:100%;background:#f8fafc;color:#0f172a;border:1px solid #cbd5e1;border-radius:4px;font:13px/1.55 'Pretendard Variable','Pretendard','Malgun Gothic','맑은 고딕',sans-serif;font-variant-numeric:tabular-nums;padding:8px;box-sizing:border-box}
        .wbar{display:flex;align-items:center;gap:8px;margin:4px 0}.wbar .wl{flex:0 0 56px;color:#475569}.wbar i{display:block;height:14px;border-radius:2px;min-width:2px}.wbar .b1{background:#dc2626}.wbar .b2{background:#15803d}
        .st.s0{border-color:#1d4ed8}.st.s1{border-color:#15803d}.st.s2{border-color:#b45309}.st.s3{border-color:#db2777}.st.s4{border-color:#6d28d9}.st.s5{border-color:#0284c7}.st.s6{border-color:#059669}.st.s7{border-color:#d97706}.st.s8{border-color:#dc2626}
        @media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
        @media (max-width:760px){.wfwrap{flex-direction:column}.wfl{flex:none;border-right:0;border-bottom:1px solid #e2e8f0}.tlr{flex-direction:column;gap:2px}.tlw{flex:none}.bar-top{padding:7px 12px;flex-wrap:wrap}.bar-tabs{padding:0 12px}}
      `}</style>
    </div>
  );
}
