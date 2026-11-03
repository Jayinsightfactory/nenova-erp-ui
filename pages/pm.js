// pages/pm.js
// PM 사무실 — AI 에이전트·직원을 픽셀 사무실 책상으로 보여주는 실시간 화면(20초 폴링).
// 데이터: GET /api/pm/office (사장님 PC 가 ~1분마다 name=pm-office 로 올리는 runtime JSON). 읽기 전용.
// 디자인 영감: pablodelucca/pixel-agents (픽셀 사무실 캐릭터). 에셋·코드는 가져오지 않고 CSS 박스 스프라이트로 직접 그렸다.
import { useCallback, useEffect, useState } from 'react';
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

function Seat({ name, sub, status, activity, lastAt, now, robot, extra, empty, onOpen }) {
  const st = empty ? 'off' : (STATUS_LABEL[status] ? status : 'off');
  const tip = [name, STATUS_LABEL[st], sub, activity, ago(lastAt, now), extra].filter(Boolean).join(' · ');
  const showBubble = activity && st !== 'off';
  return (
    <div className={`seat d-${st} ${empty ? 'empty-seat' : ''} ${onOpen ? 'clickable' : ''}`} title={tip}
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

function StaffDrawer({ name, live, now, onClose }) {
  const [tab, setTab] = useState('auto');
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
    let alive = true; setRes(null); setErr(''); setTab('auto'); setOpen({});
    fetch('/api/pm/staff?name=' + encodeURIComponent(name), { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ r, j })))
      .then(({ r, j }) => { if (!alive) return; if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`); setRes(j.data); })
      .catch((e) => alive && setErr(String(e.message || e)));
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { alive = false; window.removeEventListener('keydown', esc); };
  }, [name, onClose]);
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
          {[['auto', '자동화'], ['time', '시간'], ['role', '역할'], ['now', '지금']].map(([k, l]) => (
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
          {tab === 'now' && (
            live ? (
              <div className="card">
                <div className="kv">상태: <span className={`chip chip-${STATUS_LABEL[live.status] ? live.status : 'off'}`}>{STATUS_LABEL[live.status] || '꺼짐'}</span></div>
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

export default function PmOffice() {
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState(null);
  const [ts, setTs] = useState(null);
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
        <main className="floor">
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
          <div className="hall">복도</div>
          <div className="wing">
            {visibleRooms.map((r) => (
              <section key={r.dept} className="room dept" style={{ background: ROOM_FLOOR[r.dept] || ROOM_FLOOR['미배치'] }}>
                <div className="plate">{r.dept} <small>{r.seats.filter((x) => !x.empty).length}</small></div>
                <Table seats={r.seats} render={(x, i) => (
                  <Seat key={(x.name || '') + i} empty={x.empty} name={x.name} sub={x.app} status={x.status} onOpen={x.empty ? undefined : () => setSel(x.name)}
                    activity={x.app ? `${x.app} 사용 중` : ''} lastAt={x.lastAt} now={now} extra={x.events15m != null ? `15분 ${x.events15m}건` : ''} />
                )} />
              </section>
            ))}
          </div>
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
      {sel && <StaffDrawer name={sel} live={staff.find((x) => x.name === sel) || null} now={now} onClose={closeSel} />}
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
