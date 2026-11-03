// pages/pm.js
// PM 사무실 — AI 에이전트·직원을 픽셀 사무실 책상으로 보여주는 실시간 화면(20초 폴링).
// 데이터: GET /api/pm/office (사장님 PC 가 ~1분마다 name=pm-office 로 올리는 runtime JSON). 읽기 전용.
// 디자인 영감: pablodelucca/pixel-agents (픽셀 사무실 캐릭터). 에셋·코드는 가져오지 않고 CSS 박스 스프라이트로 직접 그렸다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STAGES, stageLabel, staffLinks, lineWidth } from '../lib/pmStages';
import { buildHandoffs, chainView, filterLog, logFacets, kstHM, kstDay, fmtGap, DEFAULT_WINDOW_H } from '../lib/pmWorkLog';
import MenuBackButton from '../components/MenuBackButton';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';

export async function getServerSideProps({ req, res, resolvedUrl }) {
  const user = await verifyReqUser(req, res);
  if (!user) return { redirect: { destination: '/login?next=' + encodeURIComponent(resolvedUrl || '/pm'), permanent: false } };
  if (!isOrbitReportViewer(user)) return { notFound: true };
  return { props: { userId: user.userId || '' } };
}

const POLL_MS = 20000;
const STALE_SEC = 300;
const STATUS_LABEL = { working: '작업중', idle: '대기', off: '꺼짐', error: '오류' };
const TASK_GROUPS = [
  { key: 'approval', label: '승인필요', match: (s) => /승인|approv|decision/i.test(s) },
  { key: 'day3', label: '3일째', match: (s, t) => /3일|stale|day3/i.test(s) || Number(t.days) >= 3 },
  { key: 'investigate', label: '조사예정', match: (s) => /조사|investig|todo|plan/i.test(s) },
  { key: 'verify', label: '검증중', match: (s) => /검증|verif|check/i.test(s) },
];
const DEFAULT_DEPT_ORDER = ['경영지원', '영업지원', '영업부', '수입부', '미배치'];
const ROSTER = {
  '경영지원': ['강명훈', '설연주'],
  '영업지원': ['임재용', '강현우', '김도준'],
  '영업부': ['김원영', '박성수', '정재훈', '조현욱', '송준호'],
  '수입부': ['김원빈', '김지니'],
};
const ROOM_FLOOR = {
  '경영지원': 'repeating-linear-gradient(90deg,#5a4634 0 14px,#523f2f 14px 28px)',
  '영업지원': 'repeating-conic-gradient(#33415c 0 25%,#2e3a52 0 50%) 0 0/20px 20px',
  '영업부': 'radial-gradient(#4a3550 1px,#3e2c44 1px) 0 0/6px 6px',
  '수입부': 'repeating-conic-gradient(#2f4a3e 0 25%,#2a4237 0 50%) 0 0/24px 24px',
  '미배치': '#2b2f3a',
};
const SHIRTS = ['#4f8cff', '#ff8a4f', '#3fbf7f', '#c26bff', '#ffcc3f', '#ff5f8f', '#3fc8d8', '#9a7b4f'];

function hashColor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SHIRTS[h % SHIRTS.length]; }
function ago(iso, now) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}초 전`; if (s < 3600) return `${Math.floor(s / 60)}분 전`; if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; return `${Math.floor(s / 86400)}일 전`;
}
function fmtAge(sec) { if (sec == null) return '없음'; if (sec < 60) return `${sec}초`; if (sec < 3600) return `${Math.floor(sec / 60)}분`; return `${Math.floor(sec / 3600)}시간`; }
const arr = (x) => (Array.isArray(x) ? x : []);

function Sprite({ status, color, robot }) {
  const st = STATUS_LABEL[status] ? status : 'off';
  return (
    <div className={`sprite st-${st}`} aria-hidden>
      <div className="head" style={{ background: robot ? '#b8c4d6' : '#f2c9a0' }}>
        {robot ? <div className="antenna" /> : <div className="hair" />}
        <div className="eyes" />
      </div>
      <div className="body" style={{ background: color }} />
      <div className="desk"><div className="monitor"><div className="screen" /></div><div className="kb"><i className="hand l" /><i className="hand r" /></div></div>
      {st === 'idle' && <div className="zzz">z<span>z</span><b>z</b></div>}
      {st === 'error' && <div className="bang">!</div>}
    </div>
  );
}

function Seat({ name, sub, status, activity, lastAt, now, robot, extra, empty, onOpen, deskId }) {
  const st = empty ? 'off' : (STATUS_LABEL[status] ? status : 'off');
  const tip = [name, STATUS_LABEL[st], sub, activity, ago(lastAt, now), extra].filter(Boolean).join(' · ');
  const showBubble = activity && st !== 'off';
  return (
    <div className={`seat d-${st} ${empty ? 'empty-seat' : ''} ${onOpen ? 'clickable' : ''}`} title={tip} data-desk={deskId || undefined}
      {...(onOpen ? { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } } : {})}>
      <div className={`bubble ${showBubble ? '' : 'none'}`}>{showBubble ? activity : ''}</div>
      {empty ? <div className="sprite st-off"><div className="desk"><div className="monitor"><div className="screen" /></div></div></div>
        : <Sprite status={st} color={hashColor(name)} robot={robot} />}
      <div className="nm">{name || '?'}</div>
      <div className={`chip chip-${empty ? 'empty' : st}`}>{empty ? '빈 자리' : STATUS_LABEL[st]}{!empty && lastAt ? ` · ${ago(lastAt, now)}` : ''}</div>
    </div>
  );
}

// 마주보는 2열 공유 책상(가운데 칸막이)
function Table({ seats, render }) {
  const half = Math.ceil(seats.length / 2);
  return (
    <div className="table">
      <div className="row">{seats.slice(0, half).map((x, i) => render(x, i))}</div>
      <div className="divider" />
      <div className="row">{seats.slice(half).map((x, i) => render(x, i + half))}</div>
    </div>
  );
}


const BASIS_LABEL = { 'erp-verified': '전산 확인', confirmed: '확정', estimated: '추정' };
const ANCHOR_LABEL = { anchored: '좌표 확보', none: '앵커 없음', erp: '전산(판독불가)' };
const PIPE = ['관찰', '절차 확정', '시험실행(dry-run)', '승인', '실행'];

function DryRunButton({ req, busy, onMake }) {
  const st = req?.status;
  const r = req?.result || {};
  const active = st === 'queued' || st === 'processing';
  let label = '시험 실행 만들기';
  if (st === 'queued') label = '대기 중…';
  else if (st === 'processing') label = '처리 중…';
  else if (st === 'done' || st === 'failed') label = '다시 만들기';
  return (
    <div className="dry">
      <button type="button" className="drybtn" disabled={busy || active} onClick={onMake}>{busy ? '요청 중…' : label}</button>
      {st === 'done' && (
        <div className="dryres ok">완료 · 시험 대본{r.draftId ? ` #${r.draftId}` : ''}{r.clicks != null ? ` · 클릭 ${r.clicks}` : ''}{r.humanStops != null ? ` · 사람확인 ${r.humanStops}` : ''} · <b>승인 대기</b>{r.message ? <div className="muted">{r.message}</div> : null}</div>
      )}
      {st === 'failed' && (
        <div className="dryres bad">{/좌표|coord/i.test(`${r.reason || ''}${r.message || ''}`) ? '좌표 부족' : '실패'}{r.reason ? ` — ${r.reason}` : ''}{r.message ? <div className="muted">{r.message}</div> : null}</div>
      )}
    </div>
  );
}

const TCOLORS = ['#2f6fe0', '#1f9d55', '#c26b00', '#8e44ad', '#d6336c', '#0b8a8a', '#6b7a1f', '#9a5b2e', '#5a6276'];
function HBars({ rows, unit = 'h' }) {
  const max = Math.max(1, ...rows.map((r) => r.h));
  return (
    <div className="hbars">{rows.map((r) => (
      <div key={r.name} className="hb"><span className="hbn" title={r.name}>{r.name}</span><span className="hbt"><i style={{ width: `${(r.h / max) * 100}%` }} /></span><span className="hbv">{r.h}{unit}</span></div>
    ))}</div>
  );
}

function TimeTab({ t }) {
  const segs = [...t.workflows.filter((w) => w.measuredHoursPerWeek > 0).map((w) => ({ name: w.name, h: w.measuredHoursPerWeek, kind: 'wf' })), ...t.other.map((o) => ({ name: `미특정 · ${o.name}`, h: o.h, kind: 'other' }))];
  const total = segs.reduce((a, x) => a + x.h, 0) || 1;
  return (
    <div>
      <div className="sum">
        <div><b>{t.activeHoursPerWeek}h</b><span>활성/주</span></div>
        <div><b>{t.assignedHoursPerWeek}h</b><span>업무 특정/주</span></div>
        <div><b>{t.saveHoursPerWeek}h</b><span>절감 가능/주</span></div>
      </div>
      <p className="muted" title={t.method}>추정치 · {t.workDays != null ? `근무 ${t.workDays}일 관찰 · ` : ''}방법 보기(마우스)</p>
      <h3>시간 구성(주)</h3>
      <div className="stack" aria-label="업무별 시간 구성">{segs.map((x, i) => (
        <i key={x.name} title={`${x.name} ${x.h}h`} style={{ width: `${(x.h / total) * 100}%`, background: x.kind === 'wf' ? TCOLORS[i % 8] : '#b8bfcc' }} />
      ))}</div>
      <ul className="legend">{segs.map((x, i) => (
        <li key={x.name}><span className="sw" style={{ background: x.kind === 'wf' ? TCOLORS[i % 8] : '#b8bfcc' }} />{x.name} <b>{x.h}h</b></li>
      ))}</ul>
      {t.workflows.length > 0 && <><h3>업무별 실측·절감</h3><HBars rows={t.workflows.map((w) => ({ name: `${w.name}${w.saveHoursPerWeek ? ` (−${w.saveHoursPerWeek}h)` : ''}`, h: w.measuredHoursPerWeek }))} /></>}
      {t.kakaoRooms.length > 0 && <><h3>카톡 시간 · 방별</h3><HBars rows={t.kakaoRooms} /></>}
      {t.kakaoTypes.length > 0 && <><h3>카톡 시간 · 유형별</h3><HBars rows={t.kakaoTypes} /></>}
      {t.erpScreens.length > 0 && <><h3>전산 시간 · 화면별</h3><HBars rows={t.erpScreens} /></>}
    </div>
  );
}

function StaffDrawer({ name, live, now, onClose, initialTab = 'auto', workLog = [] }) {
  const [tab, setTab] = useState(initialTab);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [reqs, setReqs] = useState([]);
  const [busy, setBusy] = useState({});
  const loadReqs = useCallback(() => {
    fetch('/api/pm/request?person=' + encodeURIComponent(name), { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (j.success) setReqs(j.requests || []); }).catch(() => {});
  }, [name]);
  useEffect(() => { loadReqs(); const t = setInterval(loadReqs, POLL_MS); return () => clearInterval(t); }, [loadReqs]);
  const makeDryRun = async (wf) => {
    setBusy((b) => ({ ...b, [wf]: true }));
    try {
      await fetch('/api/pm/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'dry-run', person: name, dataName: res?.dataName || name, workflow: wf }) });
      loadReqs();
    } finally { setBusy((b) => ({ ...b, [wf]: false })); }
  };
  const lastReq = (wf) => reqs.filter((r) => r.workflow === wf).slice(-1)[0] || null;
  useEffect(() => {
    let alive = true; setRes(null); setErr(''); setTab(initialTab); setOpen({});
    fetch('/api/pm/staff?name=' + encodeURIComponent(name), { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ r, j })))
      .then(({ r, j }) => { if (!alive) return; if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`); setRes(j.data); })
      .catch((e) => alive && setErr(String(e.message || e)));
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { alive = false; window.removeEventListener('keydown', esc); };
  }, [name, onClose, initialTab]);
  const d = res;
  const noData = d && !d.hasData;
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`${name} 직원 상세`} onClick={(e) => e.stopPropagation()}>
        <div className="dh">
          <h2>직원 상세 · {name}{d?.dataName && d.dataName !== name ? <small> ({d.dataName})</small> : null}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="tabs" role="tablist">
          {[['auto', '자동화'], ['time', '시간'], ['role', '역할'], ['now', '지금'], ['log', '작업 로그']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="db">
          {err && <p className="warn">불러오기 실패: {err}</p>}
          {!d && !err && <p className="muted">불러오는 중…</p>}
          {noData && tab !== 'now' && tab !== 'time' && <p className="muted">관찰 데이터 없음</p>}
          {d && !noData && tab === 'auto' && (
            <div>
              <div className="sum">
                <div><b>{d.summary.workflowCount}</b><span>반복 업무</span></div>
                <div><b>{d.summary.confirmedRatio}%</b><span>확정 단계 ({d.summary.confSteps}/{d.summary.totalSteps})</span></div>
                <div><b>{d.summary.savedPerWeekMin != null ? `${d.summary.savedPerWeekMin}분` : '–'}</b><span>예상 절감/주</span></div>
              </div>
              {d.summary.candidates.length > 0 && (
                <div className="card">
                  <h3>자동화 후보 TOP {d.summary.candidates.length}</h3>
                  <ol className="cand">{d.summary.candidates.map((c) => (
                    <li key={c.name}><b>{c.name}</b> <span className="muted">확정 {c.ratio}% · 주 {c.perWeek}회({c.freqLabel}){c.savedPerCase ? ` · 건당 ${c.savedPerCase}분 절감` : ''}{c.linkBasis === 'estimated' ? ' · 추정 연결' : ''}</span></li>
                  ))}</ol>
                </div>
              )}
              <h3>반복 업무</h3>
              {d.workflows.map((w, wi) => {
                const r = w.readiness; const pi = PIPE.indexOf(w.pipelineStage);
                return (
                  <div key={wi} className="card">
                    <div className="wt"><b>{w.name}</b>{w.confidence && <span className="pill">{w.confidence}</span>}</div>
                    <div className="pipe">{PIPE.map((p, i) => <span key={p} className={i <= pi ? 'done' : ''}>{p}</span>)}</div>
                    <div className="bar" aria-label={`준비도 ${r.score}%`}><i style={{ width: `${r.score}%` }} /></div>
                    <div className="kv">단계 {r.total} · 확정 {r.confirmed} · 전산확인 {r.erpVerified} · 실행대상(전산/네노바웹) {r.executable} · 추정 {r.estimated}</div>
                    {w.anchorCoverage && <div className="kv"><b>실행 앵커 {w.anchorCoverage.anchored}/{w.anchorCoverage.eligible}단계</b>{w.anchorCoverage.erpSteps ? <span className="muted"> (전산 {w.anchorCoverage.erpSteps}단계는 화면 판독 불가)</span> : null} · 준비도 {r.score}%</div>}
                    {(w.stage?.length ? <div className="kv">단계: {[].concat(w.stage).join(' / ')}</div> : null)}
                    {w.why && <div className="kv">이유: {w.why}</div>}
                    {w.trigger && <div className="kv">시작: {w.trigger}</div>}
                    {w.frequency && <div className="kv">빈도: {w.frequency}</div>}
                    {w.observed && <div className="kv">근거 확인 {w.observed.days}일 / 관찰 {w.observed.weeks}주 <span className="muted">(표본 수집이라 최소치)</span></div>}
                    {w.freq && <div className="kv" title={w.freq.assumptions?.length ? '가정: ' + w.freq.assumptions.join(' / ') : ''}>주 {w.freq.perWeek}회 <span className="muted">(추정 근거: {w.freq.label}{w.freq.assumptions?.length ? ' · 가정 보기' : ''})</span></div>}
                    {(() => { const tw = d.timesave?.workflows?.find((x) => x.name === w.name); return tw ? <div className="kv"><b>실측 {tw.measuredHoursPerWeek}h/주</b> · 절감 {tw.saveHoursPerWeek}h/주 <span className="muted">(추정치)</span></div> : null; })()}
                    {w.link && <div className="kv">개선안: {w.link.title}{w.link.basis === 'estimated' ? <span className="pill est">추정 연결</span> : null}</div>}
                    <DryRunButton req={lastReq(w.name)} busy={!!busy[w.name]} onMake={() => makeDryRun(w.name)} />
                    {w.tools?.length ? <div className="kv">도구: {[].concat(w.tools).join(', ')}</div> : null}
                    {w.steps.length > 0 && (
                      <button type="button" className="lnk" onClick={() => setOpen((o) => ({ ...o, [wi]: !o[wi] }))}>{open[wi] ? '단계 접기' : `단계 ${w.steps.length}개 보기`}</button>
                    )}
                    {open[wi] && (
                      <ol className="steps">{w.steps.map((st, si) => (
                        <li key={si}>
                          <div>{st.no != null ? `${st.no}. ` : ''}{st.text} <span className={`basis b-${st.basis}`}>{BASIS_LABEL[st.basis] || st.basis || '–'}</span> <span className={`basis a-${st.anchorState}`}>{ANCHOR_LABEL[st.anchorState]}</span></div>
                          <div className="muted">{[st.source?.app, st.source?.screen, st.source?.field].filter(Boolean).join(' › ') || '?'}{st.destination ? ` → ${[st.destination.app, st.destination.screen, st.destination.field].filter(Boolean).join(' › ')}` : ''}{st.action ? ` · ${st.action}` : ''}</div>
                          {st.example && <div className="ex">예: {st.example}</div>}
                        </li>
                      ))}</ol>
                    )}
                    {w.pitfalls.length > 0 && <div className="kv"><b>함정</b><ul>{w.pitfalls.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul></div>}
                    {w.decisions.length > 0 && <div className="kv"><b>판단</b><ul>{w.decisions.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul></div>}
                  </div>
                );
              })}
              {d.simulations.length > 0 && <h3>개선안</h3>}
              {d.simulations.map((sm, i) => (
                <div key={i} className="card sim">
                  <div className="wt"><b>{sm.title}</b>{sm.savedPerCase > 0 && <span className="save">건당 −{sm.savedPerCase}분</span>}</div>
                  {sm.menu && <div className="kv">메뉴: {sm.menu}</div>}
                  {sm.observed && <div className="kv">관찰: {sm.observed}</div>}
                  {sm.proposal && <div className="kv">제안: {sm.proposal}</div>}
                  <div className="kv">지금 {sm.beforeMin}분 → 개선 후 {sm.afterMin}분{sm.savingPerWeekMin ? ` · 주 ${sm.savingPerWeekMin}분 절감` : ''}</div>
                </div>
              ))}
            </div>
          )}
          {d && !noData && tab === 'role' && (
            d.role ? (
              <div>
                {d.role.dept && <div className="kv">부서: {d.role.dept}</div>}
                {d.role.roleSummary && <div className="card">{d.role.roleSummary}</div>}
                {d.role.weekRhythm && <div className="card"><h3>주간 리듬</h3>{typeof d.role.weekRhythm === 'string' ? d.role.weekRhythm : <ul>{Object.entries(d.role.weekRhythm).map(([k, v]) => <li key={k}><b>{k}</b> {typeof v === 'string' ? v : JSON.stringify(v)}</li>)}</ul>}</div>}
                {d.role.unknowns?.length > 0 && <div className="card"><h3>아직 모르는 것</h3><ul>{d.role.unknowns.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul></div>}
                {d.role.dataStrength && <div className="card"><h3>데이터 강도</h3>{typeof d.role.dataStrength === 'string' ? d.role.dataStrength : <ul>{Object.entries(d.role.dataStrength).map(([k, v]) => <li key={k}><b>{k}</b> {typeof v === 'string' ? v : JSON.stringify(v)}</li>)}</ul>}</div>}
              </div>
            ) : <p className="muted">역할 요약 없음</p>
          )}
          {d && tab === 'time' && (d.timesave ? <TimeTab t={d.timesave} /> : <p className="muted">시간 측정 데이터 없음</p>)}
          {tab === 'log' && <WorkLogList rows={filterLog(workLog, { name })} light empty="이 직원의 작업 로그 없음(라벨이 바뀔 때만 한 줄 쌓임)" />}
          {tab === 'now' && (
            live ? (
              <div className="card">
                <div className="kv">상태: <span className={`chip chip-${STATUS_LABEL[live.status] ? live.status : 'off'}`}>{STATUS_LABEL[live.status] || '꺼짐'}</span></div>
                {live.workLabel && <div className="kv">작업: <b>{live.workLabel}</b></div>}
                {live.app && <div className="kv">사용 앱: {live.app}</div>}
                <div className="kv">마지막: {ago(live.lastAt, now) || '–'}</div>
                {live.events15m != null && <div className="kv">최근 15분 이벤트: {live.events15m}건</div>}
              </div>
            ) : <p className="muted">실시간 데이터 없음</p>
          )}
        </div>
      </aside>
      <style jsx global>{`
        .drawer-back { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; justify-content: flex-end; }
        .pm .drawer-back .drawer { width: min(560px, 100%); height: 100%; background: #f6f7fa; color: #1b1f2a; display: flex; flex-direction: column; box-shadow: -6px 0 18px rgba(0,0,0,.35); }
        .pm .drawer-back .dh { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #262b3c; color: #fff; }
        .pm .drawer-back .dh h2 { margin: 0; font-size: 16px; } .pm .drawer-back .dh small { color: #c7cde0; font-weight: normal; }
        .pm .drawer-back .x { background: none; border: 0; color: #fff; font-size: 24px; cursor: pointer; min-width: 44px; min-height: 44px; }
        .pm .drawer-back .tabs { display: flex; border-bottom: 1px solid #d0d4de; background: #fff; }
        .pm .drawer-back .tabs button { flex: 1; padding: 10px; border: 0; background: none; font-size: 14px; color: #4a5164; cursor: pointer; border-bottom: 3px solid transparent; }
        .pm .drawer-back .tabs .on { color: #1b1f2a; font-weight: bold; border-bottom-color: #3f7fff; }
        .pm .drawer-back .db { flex: 1; overflow-y: auto; padding: 12px 16px 24px; font-size: 13px; line-height: 1.5; }
        .pm .drawer-back h3 { font-size: 13px; margin: 12px 0 6px; color: #1b1f2a; }
        .pm .drawer-back .muted { color: #5a6276; } .pm .drawer-back .warn { color: #a3260f; }
        .pm .drawer-back .sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .pm .drawer-back .sum div { background: #fff; border: 1px solid #d0d4de; border-radius: 6px; padding: 8px; text-align: center; }
        .pm .drawer-back .sum b { display: block; font-size: 20px; } .pm .drawer-back .sum span { font-size: 11px; color: #4a5164; }
        .pm .drawer-back .card { background: #fff; border: 1px solid #d0d4de; border-radius: 6px; padding: 10px; margin-top: 8px; }
        .pm .drawer-back .wt { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .pm .drawer-back .pill { font-size: 11px; background: #e3e7f0; border-radius: 8px; padding: 0 6px; }
        .pm .drawer-back .save { font-size: 12px; font-weight: bold; background: #b9f5cf; color: #0b3d1f; border-radius: 8px; padding: 0 7px; }
        .pm .drawer-back .pipe { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0; }
        .pm .drawer-back .pipe span { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: #e3e7f0; color: #5a6276; }
        .pm .drawer-back .pipe span.done { background: #2f6fe0; color: #fff; }
        .pm .drawer-back .bar { height: 8px; background: #e3e7f0; border-radius: 4px; overflow: hidden; } .pm .drawer-back .bar i { display: block; height: 100%; background: #1f9d55; }
        .pm .drawer-back .kv { margin-top: 4px; } .pm .drawer-back .kv ul { margin: 2px 0 0 18px; padding: 0; }
        .pm .drawer-back .lnk { margin-top: 6px; background: none; border: 0; color: #2f6fe0; cursor: pointer; padding: 4px 0; font-size: 13px; }
        .pm .drawer-back .steps { margin: 6px 0 0 0; padding-left: 0; list-style: none; } .pm .drawer-back .steps li { border-top: 1px solid #eceef3; padding: 6px 0; }
        .pm .drawer-back .ex { font-size: 12px; color: #3a4152; background: #f1f3f8; padding: 2px 6px; border-radius: 4px; margin-top: 2px; word-break: break-word; }
        .pm .drawer-back .basis { font-size: 10px; padding: 0 5px; border-radius: 6px; background: #e3e7f0; color: #1f2430; }
        .pm .drawer-back .a-anchored { background: #b9f5cf; color: #0b3d1f; } .a-none { background: #e3e7f0; color: #1f2430; } .a-erp { background: #ffd8b0; color: #4a2300; }
        .b-erp-verified { background: #b9f5cf; color: #0b3d1f; } .pm .drawer-back .b-confirmed { background: #cfe0ff; color: #0c2a63; } .pm .drawer-back .b-estimated { background: #ffe7a3; color: #4a3200; }
        .pm .drawer-back .cand { margin: 0; padding-left: 20px; }
        .pm .drawer-back .stack { display: flex; height: 18px; border-radius: 4px; overflow: hidden; background: #e3e7f0; }
        .pm .drawer-back .stack i { display: block; height: 100%; min-width: 2px; }
        .pm .drawer-back .legend { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
        .pm .drawer-back .sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: middle; }
        .pm .drawer-back .hbars { display: grid; gap: 4px; }
        .pm .drawer-back .hb { display: grid; grid-template-columns: minmax(0, 40%) 1fr 48px; gap: 6px; align-items: center; font-size: 12px; }
        .pm .drawer-back .hbn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .drawer-back .hbt { height: 10px; background: #e3e7f0; border-radius: 3px; overflow: hidden; } .pm .drawer-back .hbt i { display: block; height: 100%; background: #2f6fe0; }
        .pm .drawer-back .hbv { text-align: right; font-weight: bold; }
        .pm .drawer-back .pill.est { background: #ffe7a3; color: #4a3200; margin-left: 6px; }
        .pm .drawer-back .dry { margin-top: 8px; }
        .pm .drawer-back .drybtn { background: #2f6fe0; color: #fff; border: 0; border-radius: 6px; padding: 8px 12px; font-size: 13px; cursor: pointer; min-height: 36px; }
        .pm .drawer-back .drybtn:disabled { background: #8a93a8; cursor: default; }
        .pm .drawer-back .dryres { margin-top: 6px; padding: 6px 8px; border-radius: 6px; font-size: 12px; }
        .pm .drawer-back .dryres.ok { background: #e3f8eb; color: #0b3d1f; } .pm .drawer-back .dryres.bad { background: #ffe9e5; color: #5c0d05; }
        .pm .drawer-back .chip { display: inline-block; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 1px 7px; }
        .pm .drawer-back .chip-working { background: #b9f5cf; color: #0b3d1f; } .pm .drawer-back .chip-idle { background: #ffe7a3; color: #4a3200; } .pm .drawer-back .chip-off { background: #d7dbe3; color: #1f2430; } .pm .drawer-back .chip-error { background: #ffc9c2; color: #5c0d05; }
        @media (max-width: 640px) { .pm .drawer-back .drawer { width: 100%; } .pm .drawer-back .sum b { font-size: 16px; } }
      `}</style>
    </div>
  );
}

// ── 복도 = 업무 파이프라인 9단계 ──────────────────────────────
// 단계 색(어두운 칸 #1e2230 위 대비 4.5 이상)
const STAGE_COLOR = { 1: '#6fa8ff', 2: '#4fd1c5', 3: '#7ee2a2', 4: '#c3e66e', 5: '#ffd166', 6: '#ffa36b', 7: '#ff8fa3', 8: '#d6a2ff', 9: '#f2f2f2' };
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

function Corridor({ corridor, liveByStage, selStage, onPick }) {
  const stages = corridor?.stages || STAGES.map((x) => ({ ...x, h: null, people: [] }));
  return (
    <div className="corridor" aria-label="업무 파이프라인 9단계 복도">
      {stages.map((st) => {
        const live = liveByStage[st.no] || 0;
        return (
          <button key={st.no} type="button" data-stage={st.no} className={`cell ${selStage === st.no ? 'on' : ''}`}
            style={{ '--sc': STAGE_COLOR[st.no] }} onClick={() => onPick(selStage === st.no ? null : st.no)}
            aria-label={`${st.no}단계 ${st.label} 이번 주 ${st.h ?? '?'}시간, 지금 ${live}명`}>
            <span className="ch">{st.h == null ? '–' : `${st.h}h`}</span>
            <span className="cl">{CIRCLED[st.no]} {st.label}</span>
            {live > 0 && <span className="cn">지금 {live}</span>}
          </button>
        );
      })}
      <div className="cell unk" title="업무 이름이 단계 규칙에 안 걸린 시간">
        <span className="ch">{corridor ? `${corridor.unknownH}h` : '–'}</span><span className="cl">미확인</span>
      </div>
    </div>
  );
}

function StagePanel({ no, corridor, liveRows, onClose, onOpenPerson }) {
  const st = corridor?.stages?.find((x) => x.no === no);
  return (
    <div className="spanel" role="region" aria-label={`${stageLabel(no)} 단계 담당자`}>
      <div className="sph"><b style={{ color: STAGE_COLOR[no] }}>{CIRCLED[no]} {stageLabel(no)}</b> 이번 주 {st ? `${st.h}h` : '–'} <span className="muted">(업무 이름 규칙 매핑 · 추정치)</span>
        <button type="button" className="spx" onClick={onClose} aria-label="닫기">×</button></div>
      {liveRows.length > 0 && <div className="spl">지금: {liveRows.map((r) => <button key={r.name} type="button" className="pp" onClick={() => onOpenPerson(r.name)}>{r.name}{r.text ? ` · ${r.text}` : ''}</button>)}</div>}
      {st?.people?.length ? (
        <ul className="spu">{st.people.map((p) => (
          <li key={p.name}><button type="button" className="pp" onClick={() => onOpenPerson(p.name)}>{p.name}</button> <b>{p.h}h/주</b></li>
        ))}</ul>
      ) : <p className="muted">이 단계로 매핑된 업무 시간 없음</p>}
    </div>
  );
}

// 책상→단계 곡선 + 흐르는 점. 좌표는 실제 DOM(data-desk / data-stage) 위치에서 계산. 데이터 없으면 안 그림.
function FlowLines({ hostRef, links, onPick, reduced }) {
  const [geo, setGeo] = useState({ w: 0, h: 0, paths: [] });
  const key = links.map((l) => `${l.name}:${l.stage}:${l.kind}:${l.dir}:${l.width}`).join('|');
  useLayoutEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    const calc = () => {
      const hb = host.getBoundingClientRect();
      const paths = [];
      for (const l of links) {
        const desk = host.querySelector(`[data-desk="${CSS.escape(l.name)}"]`);
        const cell = host.querySelector(`[data-stage="${l.stage}"]`);
        if (!desk || !cell) continue;
        const a = desk.getBoundingClientRect(); const b = cell.getBoundingClientRect();
        const ax = a.left + a.width / 2 - hb.left; const bx = b.left + b.width / 2 - hb.left;
        const below = a.top > b.bottom;
        const ay = (below ? a.top : a.bottom) - hb.top; const by = (below ? b.bottom : b.top) - hb.top;
        const dy = (by - ay) * 0.55;
        paths.push({ ...l, d: `M${ax.toFixed(1)},${ay.toFixed(1)} C${ax.toFixed(1)},${(ay + dy).toFixed(1)} ${bx.toFixed(1)},${(by - dy).toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}` });
      }
      setGeo({ w: hb.width, h: hb.height, paths });
    };
    calc();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calc) : null;
    if (ro) ro.observe(host);
    window.addEventListener('resize', calc);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [hostRef, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!geo.paths.length) return null;
  return (
    <svg className="flows" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} role="group" aria-label="직원→업무 단계 연결선">
      {geo.paths.map((p, i) => {
        const id = `pmfl-${i}`; const cur = p.kind === 'current';
        const kp = p.dir === 'toDesk' ? '1;0' : '0;1';
        const dur = p.dir === 'none' ? '7s' : '2.4s';
        return (
          <g key={id + p.name} className={`fl ${cur ? 'cur' : 'rec'}`} data-flow={`${p.name}:${p.stage}:${p.kind}:${p.dir}`} onClick={() => onPick(p.name)}>
            <title>{`${p.name} → ${CIRCLED[p.stage]} ${stageLabel(p.stage)}${p.text ? ` (${p.text})` : ''}${cur ? ' · 지금' : ' · 최근 1시간'} — 클릭: 시간 탭`}</title>
            <path id={id} d={p.d} fill="none" stroke={STAGE_COLOR[p.stage]} strokeWidth={p.width} strokeOpacity={cur ? 0.95 : 0.35} strokeLinecap="round" />
            <path d={p.d} fill="none" stroke="transparent" strokeWidth={14} className="hit" />
            {!reduced && (
              <circle r={cur ? 4 : 3} fill={STAGE_COLOR[p.stage]} stroke="#0e1018" strokeWidth="1" opacity={cur ? 1 : 0.6}>
                <animateMotion dur={dur} repeatCount="indefinite" keyPoints={kp} keyTimes="0;1" calcMode="linear"><mpath href={`#${id}`} /></animateMotion>
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── 작업 로그 · 부서간 넘김 사슬 ─────────────────────────────
// 색은 새로 만들지 않는다: 단계=STAGE_COLOR(복도와 같은 번호·색), 부서=ROOM_FLOOR(사무실 방 바닥색), 외부=복도 미확인 칸(unk)·chip-off 회색.
const wlStageNo = (st) => STAGES.find((x) => x.label === st || (st === '견적서' && x.no === 5))?.no || 0;
function DeptSw({ dept }) { return <i className="dsw" style={{ background: ROOM_FLOOR[dept] || ROOM_FLOOR['미배치'] }} title={dept || ''} aria-hidden />; }

function WorkLogList({ rows, onOpenPerson, light, empty, max = 300 }) {
  if (!rows.length) return <p className="muted">{empty || '작업 로그 없음'}</p>;
  let day = '';
  return (
    <ol className={`wlog ${light ? 'light' : ''}`}>
      {rows.slice(0, max).map((r, i) => {
        const d = kstDay(r.at); const head = d !== day; day = d; const no = wlStageNo(r.stage);
        return (
          <li key={r.at + r.name + i} title={r.screen || ''}>
            {head && <div className="wday">{d}</div>}
            <div className="wrow">
              <span className="wt">{kstHM(r.at)}</span>
              <DeptSw dept={r.dept} />
              {onOpenPerson ? <button type="button" className="wn" onClick={() => onOpenPerson(r.name)}>{r.name}</button> : <b className="wn">{r.name}</b>}
              <span className="wl">{no ? <b style={light ? undefined : { color: STAGE_COLOR[no] }}>{CIRCLED[no]} </b> : null}{r.label || r.stage || '–'}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FilterChips({ label, items, value, onChange }) {
  if (!items.length) return null;
  return (
    <div className="fchips" role="group" aria-label={`${label} 필터`}>
      <span className="muted">{label}</span>
      <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} onClick={() => onChange('')}>전체</button>
      {items.map((x) => <button key={x} type="button" className={value === x ? 'on' : ''} aria-pressed={value === x} onClick={() => onChange(value === x ? '' : x)}>{x}</button>)}
    </div>
  );
}

function WorkLogPanel({ workLog, onOpenPerson }) {
  const [f, setF] = useState({ dept: '', country: '', stage: '' });
  const facets = logFacets(workLog);
  const rows = filterLog(workLog, f);
  return (
    <details className="panel wlpanel" open>
      <summary><h2>작업 로그 <small>{rows.length}/{workLog.length} · 라벨 바뀔 때만 한 줄 · KST</small></h2></summary>
      <FilterChips label="부서" items={facets.dept} value={f.dept} onChange={(v) => setF({ ...f, dept: v })} />
      <FilterChips label="국가" items={facets.country} value={f.country} onChange={(v) => setF({ ...f, country: v })} />
      <FilterChips label="단계" items={facets.stage} value={f.stage} onChange={(v) => setF({ ...f, stage: v })} />
      <div className="wlscroll"><WorkLogList rows={rows} onOpenPerson={onOpenPerson} empty={workLog.length ? '조건에 맞는 로그 없음' : '아직 작업 로그 없음'} /></div>
    </details>
  );
}

// 사슬 노드 사이 연결선: 복도 연결선과 같은 선·흐르는 점(reduced-motion 시 점 없음). 굵기=lineWidth(넘김 수).
function ChainLink({ link, toStage, maxN, reduced }) {
  const n = link.items.length;
  const c = link.external ? '#9aa3b8' : STAGE_COLOR[toStage];
  const tip = link.external ? '현장팀은 PC 데이터 없음 — 넘김 확인 불가'
    : n ? `넘김 ${n}건 (추정 · 같은 국가 · ${DEFAULT_WINDOW_H}시간 이내 · 확정 아님)\n` + link.items.slice(0, 6).map((h) => `${h.a.name} ${kstHM(h.a.at)} → ${h.b.name} ${kstHM(h.b.at)} (${h.country}, ${fmtGap(h.gapMin)})`).join('\n')
      : `넘김 없음 (같은 국가 ${DEFAULT_WINDOW_H}시간 이내 짝 없음)`;
  return (
    <div className={`clink ${n ? 'has' : ''} ${link.external ? 'ext' : ''}`} title={tip} data-link={`${link.from}>${link.to}`}>
      <svg height="14" viewBox="0 0 40 14" preserveAspectRatio="none" aria-hidden>
        <path d="M1,7 L33,7" fill="none" stroke={c} strokeWidth={n ? lineWidth(n, maxN) : 2} strokeOpacity={n ? 0.95 : 0.35} strokeDasharray={link.external ? '3 3' : undefined} strokeLinecap="round" />
        <path d="M32,2 L39,7 L32,12" fill="none" stroke={c} strokeWidth="2" strokeOpacity={n ? 0.95 : 0.5} />
        {n > 0 && !reduced && <circle r="2.6" fill={c} stroke="#0e1018" strokeWidth="1"><animateMotion dur="2.4s" repeatCount="indefinite" path="M1,7 L33,7" /></circle>}
      </svg>
      {n > 0 && <span className="cn" style={{ '--sc': c }}><i>넘김 </i>{n}</span>}
    </div>
  );
}

function HandoffChains({ workLog, handoffs, reduced, onOpenPerson }) {
  const chains = chainView(workLog, handoffs);
  const maxN = Math.max(1, ...chains.flatMap((c) => c.links.map((l) => l.items.length)));
  return (
    <div className="chains" aria-label="부서간 넘김 사슬">
      <div className="hall-t">부서간 넘김 사슬 <small>같은 국가 · 앞 부서 뒤 {DEFAULT_WINDOW_H}시간 이내 = 넘김(추정, 확정 아님) · 번호·색 = 위 복도 단계 · 윗줄 색 = 부서 방</small></div>
      {chains.map((ch) => (
        <div key={ch.key} className="chain">
          <div className="chl">{ch.label}</div>
          <div className="chrow">
            {ch.nodes.map((nd, i) => (
              <div key={nd.key} className="chseg">
                <div className={`cell cnode ${nd.external ? 'unk ext' : ''}`} style={nd.external ? undefined : { '--sc': STAGE_COLOR[nd.stageNo] }} data-chain-node={nd.key}
                  title={nd.external ? `${nd.title} · ${nd.desc} · PC 데이터 없음` : `${nd.title} · ${nd.desc} · 작업 로그 ${nd.count}줄 (${nd.stages.join('/')})`}>
                  {!nd.external && <span className="dstrip" style={{ background: ROOM_FLOOR[nd.dept] || ROOM_FLOOR['미배치'] }} aria-hidden />}
                  <span className="cl">{nd.external ? '' : `${CIRCLED[nd.stageNo]} `}{nd.title}</span>
                  <span className="cd">{nd.desc}</span>
                  {nd.external ? <span className="chip chip-off">데이터 없음</span> : <span className="cd2">로그 {nd.count}</span>}
                </div>
                {i < ch.links.length && <ChainLink link={ch.links[i]} toStage={ch.nodes[i + 1].stageNo} maxN={maxN} reduced={reduced} />}
              </div>
            ))}
          </div>
        </div>
      ))}
      {handoffs.length > 0 ? (
        <ul className="hlist">{handoffs.slice(0, 6).map((h, i) => (
          <li key={i} title={h.basis}>
            <span className="est">추정</span>
            <button type="button" className="pp" onClick={() => onOpenPerson(h.a.name)}>{h.a.name} {h.country} {h.a.stage} {kstHM(h.a.at)}</button>
            <span aria-hidden>→</span>
            <button type="button" className="pp" onClick={() => onOpenPerson(h.b.name)}>{h.b.name} {h.country} {h.b.stage} {kstHM(h.b.at)}</button>
            <span className="muted">{fmtGap(h.gapMin)} 뒤</span>
          </li>
        ))}</ul>
      ) : <p className="hnone">아직 묶인 넘김 없음 (같은 국가로 {DEFAULT_WINDOW_H}시간 안에 다음 부서 작업이 나오면 표시)</p>}
    </div>
  );
}

export default function PmOffice() {
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState(null);
  const [ts, setTs] = useState(null);
  const [selTab, setSelTab] = useState('auto');
  const [selStage, setSelStage] = useState(null);
  const [reduced, setReduced] = useState(false);
  const floorRef = useRef(null);
  useEffect(() => { const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)'); if (!mq) return undefined; const f = () => setReduced(mq.matches); f(); mq.addEventListener?.('change', f); return () => mq.removeEventListener?.('change', f); }, []);
  const openPerson = useCallback((n, tab = 'auto') => { setSelTab(tab); setSel(n); }, []);
  const closeSel = useCallback(() => setSel(null), []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/pm/office', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
        setResp(j); setErr('');
        fetch('/api/pm/timesave', { cache: 'no-store' }).then((r) => r.json()).then((t) => { if (alive && t.success) setTs(t); }).catch(() => {});
      } catch (e) { if (alive) setErr(String(e.message || e)); }
    };
    load(); setNow(Date.now());
    const a = setInterval(load, POLL_MS); const b = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);

  const d = resp?.data || {};
  const agents = arr(d.agents); const staff = arr(d.staff); const tasks = arr(d.tasks); const board = arr(d.board);
  const fetchedAgo = resp?.serverNow && now ? Math.max(0, Math.round((now - Date.parse(resp.serverNow)) / 1000)) : 0;
  const ageSec = resp?.ageSec == null ? null : resp.ageSec + fetchedAgo;
  const stale = ageSec == null || ageSec > STALE_SEC;
  const mode = d.mode === 'live' ? 'live' : 'shadow';
  const deptOrder = arr(d.deptOrder).length ? arr(d.deptOrder) : DEFAULT_DEPT_ORDER;
  const byName = new Map(staff.map((x) => [x.name, x]));
  const placed = new Set();
  const rooms = deptOrder.map((dept) => ({
    dept,
    seats: (ROSTER[dept] || []).map((m) => {
      if (typeof m === 'object') return { empty: true, name: m.empty };
      placed.add(m); return byName.get(m) || { name: m, dept, status: 'off' };
    }),
  }));
  for (const x of staff) {
    if (placed.has(x.name)) continue;
    let r = rooms.find((rm) => rm.dept === x.dept) || rooms.find((rm) => rm.dept === '미배치');
    if (!r) { r = { dept: '미배치', seats: [] }; rooms.push(r); }
    r.seats.push(x);
  }
  const visibleRooms = rooms.filter((r) => r.dept !== '미배치' || r.seats.length);
  const pmAgent = agents.find((a) => a.id === 'pm');
  const labAgents = agents.filter((a) => a !== pmAgent);
  const grouped = TASK_GROUPS.map((g) => ({ ...g, items: [] }));
  const other = [];
  for (const t of tasks) { const s = `${t.state || ''}`; const g = grouped.find((x) => x.match(s, t)); (g ? g.items : other).push(t); }
  const corridor = ts?.data?.corridor || null;
  const links = []; const liveByStage = {}; const liveRowsByStage = {};
  const maxPersonH = Math.max(0, ...Object.values(corridor?.perPerson || {}).flatMap((o) => Object.values(o)));
  for (const x of staff) {
    const L = staffLinks(x, now || Date.now());
    const hOf = (st) => corridor?.perPerson?.[x.name]?.[st] || 0;
    if (L.current) {
      liveByStage[L.current.stage] = (liveByStage[L.current.stage] || 0) + 1;
      (liveRowsByStage[L.current.stage] = liveRowsByStage[L.current.stage] || []).push({ name: x.name, text: L.current.text });
      links.push({ name: x.name, kind: 'current', stage: L.current.stage, dir: L.current.dir, text: L.current.text, width: lineWidth(hOf(L.current.stage), maxPersonH) });
    }
    for (const r of L.recent) links.push({ name: x.name, kind: 'recent', stage: r.stage, dir: r.dir, text: r.text, width: Math.max(1.5, lineWidth(hOf(r.stage), maxPersonH) * 0.6) });
  }
  const workLog = arr(d.workLog);
  const handoffs = buildHandoffs(workLog, { windowH: DEFAULT_WINDOW_H });
  const working = agents.filter((a) => a.status === 'working').length + staff.filter((s) => s.status === 'working').length;

  return (
    <div className="pm">
      <header className="top">
        <MenuBackButton />
        <h1>PM 사무실</h1>
        <span className={`badge ${mode}`}>{mode === 'live' ? '실행' : '그림자'}</span>
        <span className={`badge age ${stale ? 'warn' : ''}`}>데이터 {fmtAge(ageSec)} 전{stale ? ' · 갱신 끊김?' : ''}</span>
        <span className="badge plain">작업중 {working}</span>
        {err && <span className="badge warn">불러오기 실패: {err}</span>}
      </header>
      {ts?.data && (
        <div className="tstrip" title={ts.data.method || ''}>
          <b>업무 시간 계기판</b>
          <span>전 직원 활성 <b>{ts.data.totals.activeHoursPerWeek}h/주</b></span>
          <span>업무 특정 <b>{ts.data.totals.assignedHoursPerWeek}h</b></span>
          <span>절감 가능 <b className="g">{ts.data.totals.saveHoursPerWeek}h/주</b></span>
          <span className="est">추정치</span>
          <span className="muted">데이터 {fmtAge(ts.ageSec)} 전{ts.data.days ? ` · ${ts.data.days}일 관찰` : ''}</span>
        </div>
      )}
      {!resp && !err && <p className="muted">불러오는 중…</p>}
      {resp && !resp.data && <p className="muted">아직 올라온 pm-office 데이터가 없습니다.</p>}
      <div className="wrap">
        <main className="floor" ref={floorRef}>
          <div className="topwing">
            <section className="room lab">
              <div className="plate">AI 연구실 · 서버실 <small>{labAgents.length}</small></div>
              <div className="rows">
                {labAgents.map((a) => (
                  <Seat key={a.id || a.name} robot name={a.name || a.id} sub={a.role} status={a.status} activity={a.activity} lastAt={a.lastAt} now={now}
                    extra={a.today?.done != null ? `오늘 ${a.today.done}건` : ''} />
                ))}
                {!labAgents.length && <p className="muted">에이전트 없음</p>}
              </div>
            </section>
            <section className="room mgr">
              <div className="plate">PM 실</div>
              <div className="rows">
                {pmAgent ? <Seat robot name={pmAgent.name || 'PM'} sub={pmAgent.role} status={pmAgent.status} activity={pmAgent.activity} lastAt={pmAgent.lastAt} now={now}
                  extra={pmAgent.today?.done != null ? `오늘 ${pmAgent.today.done}건` : ''} /> : <Seat empty name="PM" />}
              </div>
            </section>
          </div>
          <div className="hallwrap">
            <div className="hall-t">복도 · 업무 파이프라인 <small>이번 주 사람시간(h) · 칸 클릭=담당자 · 선 클릭=직원 시간</small></div>
            <Corridor corridor={corridor} liveByStage={liveByStage} selStage={selStage} onPick={setSelStage} />
            {selStage && <StagePanel no={selStage} corridor={corridor} liveRows={liveRowsByStage[selStage] || []} onClose={() => setSelStage(null)} onOpenPerson={(n) => openPerson(n, 'time')} />}
            <HandoffChains workLog={workLog} handoffs={handoffs} reduced={reduced} onOpenPerson={(n) => openPerson(n, 'log')} />
          </div>
          <div className="wing">
            {visibleRooms.map((r) => (
              <section key={r.dept} className="room dept" style={{ background: ROOM_FLOOR[r.dept] || ROOM_FLOOR['미배치'] }}>
                <div className="plate">{r.dept} <small>{r.seats.filter((x) => !x.empty).length}</small></div>
                <Table seats={r.seats} render={(x, i) => (
                  <Seat key={(x.name || '') + i} empty={x.empty} name={x.name} sub={x.app} status={x.status} deskId={x.empty ? undefined : x.name} onOpen={x.empty ? undefined : () => openPerson(x.name)}
                    activity={x.workLabel || (x.app ? `${x.app} 사용 중` : '')} lastAt={x.lastAt} now={now} extra={x.events15m != null ? `15분 ${x.events15m}건` : ''} />
                )} />
              </section>
            ))}
          </div>
          <FlowLines hostRef={floorRef} links={links} reduced={reduced} onPick={(n) => openPerson(n, 'time')} />
        </main>
        <aside className="side">
          {ts?.data && (
            <details className="panel" open>
              <summary><h2>네노바웹 기능 후보 <small>실측 절감순</small></h2></summary>
              <ol className="feat">{ts.data.features.slice(0, 12).map((f, i) => (
                <li key={f.title + i}>
                  <div className="ft"><b>{f.title}</b><span className="fh">−{f.saveHoursPerWeek}h/주</span></div>
                  {f.menu && <div className="muted">메뉴: {f.menu}</div>}
                  <div className="pchips">{f.people.map((p) => <span key={p}>{p}</span>)}</div>
                </li>
              ))}</ol>
              {!ts.data.features.length && <p className="muted">후보 없음</p>}
              {ts.data.unproposed.length > 0 && <>
                <h3>개선안 없는 큰 업무</h3>
                <ul className="unp">{ts.data.unproposed.slice(0, 10).map((u, i) => (
                  <li key={u.person + u.name + i}><b>{u.name}</b> <span className="muted">{u.person} · 실측 {u.measuredHoursPerWeek}h/주</span></li>
                ))}</ul>
              </>}
            </details>
          )}
          <WorkLogPanel workLog={workLog} onOpenPerson={(n) => openPerson(n, 'log')} />
          <section className="panel">
            <h2>PM 업무 대장 <small>{tasks.length}</small></h2>
            {[...grouped, { key: 'other', label: '기타', items: other }].filter((g) => g.items.length).map((g) => (
              <div key={g.key} className="tg">
                <h3 className={`tg-${g.key}`}>{g.label} <small>{g.items.length}</small></h3>
                {g.items.map((t, i) => (
                  <div key={(t.key || '') + i} className="task">
                    <div className="tk">{t.key}{t.days != null ? <span className="days">{t.days}일</span> : null}</div>
                    {t.msg && <div>{t.msg}</div>}
                    {t.decision && <div className="dec">결정: {t.decision}</div>}
                    {t.owner && <div className="muted">담당 {t.owner}</div>}
                  </div>
                ))}
              </div>
            ))}
            {!tasks.length && <p className="muted">열린 업무 없음</p>}
          </section>
          <section className="panel">
            <h2>에이전트 대화</h2>
            <div className="feed">
              {board.slice(0, 60).map((m, i) => (
                <div key={i} className="msg">
                  <div className="mh"><b style={{ color: hashColor(m.from) }}>{m.from}</b> → <b>{m.to}</b>{m.type ? <span className="mt">{m.type}</span> : null}<span className="muted"> {ago(m.at, now)}</span></div>
                  <div className="mb">{m.text}</div>
                </div>
              ))}
              {!board.length && <p className="muted">대화 없음</p>}
            </div>
          </section>
        </aside>
      </div>
      {sel && <StaffDrawer key={sel + selTab} initialTab={selTab} name={sel} workLog={workLog} live={staff.find((x) => x.name === sel) || null} now={now} onClose={closeSel} />}
      <p className="credit">픽셀 사무실 아이디어: pablodelucca/pixel-agents (그림은 직접 제작)</p>
      <style jsx global>{`
        .pm { min-height: 100vh; background: #1e2230; color: #e8ebf2; padding: 12px 16px 24px; font-size: 13px; }
        .pm .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
        .pm h1 { font-size: 18px; margin: 0 6px 0 0; }
        .pm .badge { padding: 3px 9px; border-radius: 10px; font-size: 12px; background: #2f3548; }
        .pm .badge.shadow { background: #4b4f63; } .pm .badge.live { background: #1f8f4f; }
        .pm .badge.warn { background: #b8452f; }
        .pm .muted { color: #9aa3b8; }
        .pm .wrap { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; }
        .pm .floor { background: repeating-conic-gradient(#2a3042 0 25%, #262b3c 0 50%) 0 0 / 32px 32px; border: 4px solid #3a4158; border-radius: 6px; padding: 12px; }
        .pm .zone + .zone { margin-top: 16px; border-top: 4px dashed #3a4158; padding-top: 12px; }
        .pm h2 { font-size: 14px; margin: 0 0 8px; } .pm h3 { font-size: 12px; margin: 8px 0 6px; color: #c7cde0; }
        .pm small { color: #9aa3b8; font-weight: normal; }
        .pm .floor { background: #3a3f4f !important; padding: 10px !important; }
        .pm .topwing { display: flex; gap: 10px; flex-wrap: wrap; }
        .pm .room { position: relative; border: 6px solid #8d93a6; border-radius: 2px; padding: 26px 10px 10px; box-shadow: inset 0 0 0 2px #23273a; }
        .pm .plate { position: absolute; top: -6px; left: 14px; background: #d9c08a; color: #2b2214; font-weight: bold; font-size: 12px; padding: 2px 10px; border: 2px solid #6b5a33; }
        .pm .lab { flex: 1 1 520px; background: repeating-linear-gradient(0deg,#1d2b36 0 1px,transparent 1px 16px), repeating-linear-gradient(90deg,#1d2b36 0 1px,#22323f 1px 16px); border-color: #9fd8ff; border-style: double; box-shadow: 0 0 12px rgba(120,200,255,.35) inset; }
        .pm .mgr { flex: 0 0 150px; background: repeating-linear-gradient(45deg,#6b4a2e 0 6px,#5f4128 6px 12px); }
        .pm .rows { display: grid; grid-template-columns: repeat(auto-fill, 120px); gap: 8px; justify-content: start; }
        .pm .hall { margin: 10px 0; height: 26px; line-height: 26px; text-align: center; color: #8d93a6; letter-spacing: 8px; font-size: 11px; background: repeating-linear-gradient(90deg,#4a5064 0 30px,#454b5e 30px 60px); border-top: 2px dashed #6b7186; border-bottom: 2px dashed #6b7186; }
        .pm .wing { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
        .pm .table { display: inline-flex; flex-direction: column; max-width: 100%; overflow-x: auto; background: rgba(0,0,0,.18); padding: 6px; border-radius: 3px; }
        .pm .row { display: flex; gap: 6px; }
        .pm .divider { height: 4px; margin: 3px 0; background: #c9ced9; box-shadow: 0 1px 0 #6b7186; }
        .pm .seat { width: 120px; height: 148px; flex: 0 0 120px; box-sizing: border-box; background: rgba(15,18,28,.55); border: 2px solid #3a4158; border-radius: 3px; padding: 4px; text-align: center; overflow: hidden; }
        .pm .seat.d-off .sprite { filter: grayscale(.85) brightness(.55); } .pm .seat.d-off { background: rgba(10,12,18,.7); }
        .pm .seat.clickable { cursor: pointer; } .pm .seat.clickable:hover, .pm .seat.clickable:focus-visible { outline: 2px solid #ffd76a; outline-offset: 1px; }
        .pm .seat.d-error { border-color: #e0483a; } .pm .seat.d-working { border-color: #3fbf7f; }
        .pm .empty-seat { border-style: dashed; }
        .pm .chip { display: inline-block; max-width: 100%; font-size: 11px; font-weight: bold; border-radius: 8px; padding: 1px 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .deskcard { background: rgba(20, 23, 34, .75); border: 2px solid #3a4158; border-radius: 4px; padding: 6px; text-align: center; position: relative; }
        .pm .deskcard.d-off { opacity: .45; filter: grayscale(.8); }
        .pm .deskcard.d-error { border-color: #e0483a; }
        .pm .deskcard.d-working { border-color: #3fbf7f; }
        .pm .bubble { background: #fff; color: #111; max-height: 28px; overflow: hidden; overflow-wrap: anywhere; white-space: normal; border-radius: 6px; padding: 2px 5px; font-size: 10px; height: 28px; box-sizing: border-box; word-break: break-all; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-align: left; position: relative; margin-bottom: 6px; line-height: 12px; }
        .pm .bubble:after { content: ''; position: absolute; left: 50%; bottom: -5px; border: 5px solid transparent; border-top-color: #fff; border-bottom: 0; }
        .pm .bubble.none { visibility: hidden; }
        .pm .chip-working { background: #b9f5cf; color: #0b3d1f; } .pm .chip-idle { background: #ffe7a3; color: #4a3200; } .pm .chip-off { background: #d7dbe3; color: #1f2430; } .pm .chip-error { background: #ffc9c2; color: #5c0d05; } .pm .chip-empty { background: #3a4158; color: #f0f2f7; }
        .pm .nm { color: #fff; font-weight: bold; margin-top: 2px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .meta { font-size: 11px; color: #d5dae6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .dot { display: inline-block; width: 7px; height: 7px; margin-right: 4px; background: #666; }
        .pm .dot-working { background: #3fbf7f; } .pm .dot-idle { background: #ffcc3f; } .pm .dot-error { background: #e0483a; }
        .pm .wrap > *, .pm .floor, .pm .room, .pm .topwing > * { min-width: 0; }
        .pm .tstrip { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; background: #262b3c; border: 2px solid #3a4158; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; color: #e8ebf2; }
        .pm .tstrip b.g { color: #7ee2a2; }
        .pm .tstrip .est { background: #ffe7a3; color: #4a3200; border-radius: 8px; padding: 0 7px; font-size: 11px; font-weight: bold; }
        .pm details.panel > summary { cursor: pointer; list-style: none; } .pm details.panel > summary h2 { display: inline; }
        .pm .feat { margin: 8px 0 0; padding-left: 20px; } .pm .feat li { margin-bottom: 8px; }
        .pm .ft { display: flex; justify-content: space-between; gap: 6px; } .pm .fh { color: #7ee2a2; font-weight: bold; white-space: nowrap; }
        .pm .pchips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; } .pm .pchips span { background: #3a4158; color: #f0f2f7; border-radius: 8px; padding: 0 6px; font-size: 11px; }
        .pm .unp { margin: 4px 0 0; padding-left: 18px; font-size: 12px; }
        .pm .panel { background: #262b3c; border: 2px solid #3a4158; border-radius: 4px; padding: 10px; margin-bottom: 12px; }
        .pm .tg h3 { border-left: 4px solid #666; padding-left: 6px; }
        .pm .tg-approval { border-color: #e0483a !important; } .pm .tg-day3 { border-color: #ff8a4f !important; } .pm .tg-investigate { border-color: #4f8cff !important; } .pm .tg-verify { border-color: #3fbf7f !important; }
        .pm .task { background: #1e2230; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; line-height: 1.4; }
        .pm .tk { font-weight: bold; word-break: break-all; } .pm .days { margin-left: 6px; background: #b8452f; padding: 0 5px; border-radius: 6px; font-size: 11px; }
        .pm .dec { color: #ffcc3f; }
        .pm .feed { max-height: 60vh; overflow-y: auto; }
        .pm .msg { background: #1e2230; border-radius: 10px 10px 10px 2px; padding: 6px 9px; margin-bottom: 6px; }
        .pm .mh { font-size: 11px; } .pm .mt { margin-left: 6px; background: #3a4158; padding: 0 5px; border-radius: 6px; }
        .pm .mb { margin-top: 2px; line-height: 1.4; word-break: break-word; }
        .pm .credit { margin-top: 12px; font-size: 11px; color: #6f7890; }
        /* 2.5D: 방 바닥판만 살짝 눕히고(rotateX) 두께를 그림. 글씨·선·점은 평면 레이어라 또렷함 */
        .pm .floor { position: relative; }
        .pm .room > .table, .pm .room > .rows { position: relative; }
        .pm .room { box-shadow: inset 0 0 0 2px #23273a, 0 8px 0 #23273a, 0 10px 14px rgba(0,0,0,.45) !important; }
        .pm .room::before { content: ''; position: absolute; inset: 0; background: inherit; transform: perspective(900px) rotateX(14deg); transform-origin: 50% 100%; filter: brightness(.9); pointer-events: none; }
        .pm .seat { box-shadow: 0 5px 0 #151823, 4px 5px 0 #151823; }
        .pm .hallwrap { margin: 14px 0; padding: 8px; background: linear-gradient(180deg,#4a5064,#3f4558); border-top: 2px dashed #6b7186; border-bottom: 2px dashed #6b7186; box-shadow: 0 6px 0 #2a2e3d; }
        .pm .hall-t { color: #f0f2f7; font-weight: bold; font-size: 12px; margin-bottom: 6px; } .pm .hall-t small { color: #e3e7ef; }
        .pm .corridor { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 6px; }
        .pm .cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; padding: 6px 2px; background: #1e2230; color: #f0f2f7; border: 2px solid var(--sc, #6b7186); border-radius: 4px; cursor: pointer; font: inherit; box-shadow: 0 5px 0 #151823; }
        .pm .cell:hover, .pm .cell:focus-visible, .pm .cell.on { outline: 2px solid #ffd76a; outline-offset: 1px; }
        .pm .cell .ch { font-size: 15px; font-weight: bold; color: var(--sc, #f0f2f7); }
        .pm .cell .cl { font-size: 12px; color: #f0f2f7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .pm .cell .cn { white-space: nowrap; font-size: 10px; background: var(--sc); color: #10131c; border-radius: 6px; padding: 0 5px; font-weight: bold; }
        .pm .cell.unk { --sc: #9aa3b8; cursor: default; border-style: dashed; } .pm .cell.unk .ch { color: #c4cad6; }
        .pm .spanel { margin-top: 8px; background: #1e2230; border: 2px solid #3a4158; border-radius: 4px; padding: 8px 10px; color: #e8ebf2; }
        .pm .sph { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; } .pm .spx { margin-left: auto; background: none; border: 0; color: #fff; font-size: 20px; min-width: 36px; min-height: 36px; cursor: pointer; }
        .pm .spu { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; } .pm .spl { margin-top: 4px; }
        .pm .pp { background: #3a4158; color: #f0f2f7; border: 0; border-radius: 8px; padding: 2px 8px; margin: 2px 4px 2px 0; cursor: pointer; font: inherit; font-size: 12px; }
        .pm .flows { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 5; }
        /* 칸·책상은 선 위에 올려 글씨를 가리지 않게(선은 사이 공간에서 보임) */
        .pm .corridor .cell, .pm .seat, .pm .plate, .pm .hall-t, .pm .spanel { position: relative; z-index: 6; }
        .pm .plate { position: absolute; }
        .pm .flows .fl, .pm .flows .hit { pointer-events: stroke; cursor: pointer; }
        .pm .chains { margin-top: 10px; padding-top: 8px; border-top: 2px dashed #6b7186; }
        .pm .chain { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px; align-items: center; margin-bottom: 8px; }
        .pm .chl { color: #f0f2f7; font-weight: bold; font-size: 12px; }
        .pm .chrow { display: flex; align-items: stretch; min-width: 0; }
        .pm .chseg { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
        .pm .cnode { flex: 1 1 0; min-width: 0; cursor: default; overflow: hidden; padding-top: 10px; }
        .pm .cnode .dstrip { position: absolute; left: 0; right: 0; top: 0; height: 6px; border-bottom: 1px solid #151823; }
        .pm .cnode .cd, .pm .cnode .cd2 { font-size: 10px; color: #e3e7ef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .pm .cnode.ext .cl { color: #f0f2f7; }
        .pm .clink { position: relative; flex: 0 0 34px; display: flex; flex-direction: column; align-items: center; }
        .pm .clink svg { display: block; width: 34px; }
        .pm .clink .cn i { font-style: normal; } .pm .clink .cn { position: relative; z-index: 7; white-space: nowrap; font-size: 10px; background: var(--sc); color: #10131c; border-radius: 6px; padding: 0 4px; font-weight: bold; }
        .pm .hlist { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; }
        .pm .hlist li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; color: #f0f2f7; font-size: 12px; }
        .pm .hlist .muted { color: #e3e7ef; }
        .pm .est { background: #ffe7a3; color: #4a3200; border-radius: 8px; padding: 0 7px; font-size: 11px; font-weight: bold; }
        .pm .hnone { margin: 4px 0 0; font-size: 12px; color: #e3e7ef; }
        .pm .dsw { display: inline-block; width: 10px; height: 10px; flex: 0 0 10px; border: 1px solid #8d93a6; }
        .pm .fchips { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin: 4px 0; }
        .pm .fchips button { background: #3a4158; color: #f0f2f7; border: 0; border-radius: 8px; padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; min-height: 24px; }
        .pm .fchips button.on { background: #ffd76a; color: #2b2214; font-weight: bold; }
        .pm .wlscroll { max-height: 46vh; overflow-y: auto; margin-top: 4px; }
        .pm .wlog { list-style: none; margin: 0; padding: 0; }
        .pm .wday { font-size: 11px; color: #c7cde0; margin: 6px 0 2px; border-bottom: 1px solid #3a4158; }
        .pm .wrow { display: flex; align-items: center; gap: 6px; padding: 3px 0; min-width: 0; font-size: 12px; }
        .pm .wt { font-variant-numeric: tabular-nums; color: #c7cde0; flex: 0 0 auto; }
        .pm .wn { flex: 0 0 auto; background: none; border: 0; padding: 0; color: #fff; font: inherit; font-weight: bold; cursor: pointer; }
        .pm button.wn:hover, .pm button.wn:focus-visible { text-decoration: underline; }
        .pm .wl { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .drawer-back .wlog.light .wt { color: #4a5164; } .pm .drawer-back .wlog.light .wn { color: #1b1f2a; } .pm .drawer-back .wlog.light .wday { color: #4a5164; border-color: #d0d4de; }
        @media (max-width: 640px) { .pm .chain { grid-template-columns: 1fr; gap: 2px; } .pm .clink { flex-basis: 22px; } .pm .clink svg { width: 22px; } .pm .cnode .cd { display: none; } .pm .chrow { flex-wrap: wrap; row-gap: 6px; } .pm .chseg { flex: 0 0 50%; } .pm .clink .cn i { display: none; } }
        @media (max-width: 640px) { .pm .corridor { grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); } .pm .room::before { transform: none; } .pm { padding: 10px 8px 20px; } .pm .seat { width: 104px; flex-basis: 104px; } }
        @media (prefers-reduced-motion: reduce) { .pm .flows circle { display: none; } }
        @media (max-width: 860px) { .pm .wrap { grid-template-columns: 1fr; } .pm .wing { grid-template-columns: 1fr; } .pm .mgr, .pm .lab { flex: 1 1 100%; } .pm .feed { max-height: none; } }
      `}</style>
      <style jsx global>{`
        .sprite { position: relative; width: 64px; height: 64px; margin: 0 auto; image-rendering: pixelated; }
        .sprite .head { position: absolute; left: 22px; top: 4px; width: 20px; height: 18px; }
        .sprite .hair { position: absolute; left: 0; top: -2px; width: 20px; height: 6px; background: #3b2a20; }
        .sprite .antenna { position: absolute; left: 9px; top: -6px; width: 2px; height: 6px; background: #8894aa; }
        .sprite .antenna:after { content: ''; position: absolute; left: -2px; top: -4px; width: 6px; height: 4px; background: #ff5f5f; }
        .sprite .eyes { position: absolute; left: 4px; top: 8px; width: 3px; height: 3px; background: #222; box-shadow: 9px 0 0 #222; }
        .sprite .body { position: absolute; left: 18px; top: 22px; width: 28px; height: 18px; }
        .sprite .desk { position: absolute; left: 0; top: 38px; width: 64px; height: 26px; background: #8a5a34; border-top: 4px solid #a8724a; }
        .sprite .monitor { position: absolute; left: 4px; top: -22px; width: 18px; height: 14px; background: #2b2f3a; padding: 2px; }
        .sprite .screen { width: 100%; height: 100%; background: #1c2a3a; }
        .sprite .kb { position: absolute; left: 24px; top: 2px; width: 20px; height: 4px; background: #d6d9e0; }
        .sprite .hand { position: absolute; top: -3px; width: 5px; height: 4px; background: #f2c9a0; }
        .sprite .hand.l { left: 2px; } .sprite .hand.r { left: 13px; }
        .sprite.st-working .screen { background: #3fbf7f; animation: pmscr 1.2s steps(2) infinite; }
        .sprite.st-working .hand.l { animation: pmtype .3s steps(2) infinite; }
        .sprite.st-working .hand.r { animation: pmtype .3s steps(2) infinite .15s; }
        .sprite.st-idle .head { top: 8px; } .sprite.st-idle .eyes { height: 1px; }
        .sprite.st-off .head, .sprite.st-off .body, .sprite.st-off .hand { visibility: hidden; }
        .sprite.st-off .screen { background: #111; }
        .sprite.st-error .screen { background: #e0483a; animation: pmscr .6s steps(2) infinite; }
        .sprite .zzz { position: absolute; right: 2px; top: -4px; color: #9fc2ff; font: bold 10px monospace; animation: pmz 2s ease-in-out infinite; }
        .sprite .zzz span { font-size: 12px; } .sprite .zzz b { font-size: 14px; }
        .sprite .bang { position: absolute; right: 4px; top: -6px; width: 14px; height: 18px; background: #e0483a; color: #fff; font: bold 14px monospace; line-height: 18px; animation: pmbang .8s steps(2) infinite; }
        @keyframes pmtype { 50% { transform: translateY(-2px); } }
        @keyframes pmscr { 50% { filter: brightness(1.4); } }
        @keyframes pmz { 0% { opacity: 0; transform: translateY(4px); } 50% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
        @keyframes pmbang { 50% { opacity: .3; } }
        @media (prefers-reduced-motion: reduce) { .sprite * { animation: none !important; } }
      `}</style>
    </div>
  );
}
