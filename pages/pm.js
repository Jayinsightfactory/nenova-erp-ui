// pages/pm.js
// PM 사무실 — AI 에이전트·직원을 픽셀 사무실 책상으로 보여주는 실시간 화면(20초 폴링).
// 데이터: GET /api/pm/office (사장님 PC 가 ~1분마다 name=pm-office 로 올리는 runtime JSON). 읽기 전용.
// 디자인 영감: pablodelucca/pixel-agents (픽셀 사무실 캐릭터). 에셋·코드는 가져오지 않고 CSS 박스 스프라이트로 직접 그렸다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton, LinkButton, PersonChip, PmUiStyles, SelectCard, Tabs, ToggleChip } from '../components/pm/ui';
import { Avatar, PmThemeCtx, ShopPanel, ThemePicker, TokenBadge, usePmTheme, usePmThemeState, useWallet } from '../components/pm/PmTheme';
import { CHART_COLORS, SHIRTS, STAGE_COLOR } from '../lib/pmThemes';
import { LEVELS, levelOf } from '../lib/pmBonus';
import { STAGES, stageLabel, staffLinks, lineWidth, linkTaskText, linkTipText, stageNowRows } from '../lib/pmStages';
import { normalizePlaybooks, playbookSummary, sortPlaybookCards, kstDateTime } from '../lib/pmPlaybooks';
import { pmUnresolved } from '../lib/pmUnresolved';
import { buildHandoffs, chainView, filterLog, logFacets, kstHM, kstDay, fmtGap, DEFAULT_WINDOW_H } from '../lib/pmWorkLog';
import MenuBackButton from '../components/MenuBackButton';
import IsoScene, { ISO_CSS } from '../components/pm/IsoScene';
import BgScene, { BG_CSS } from '../components/pm/BgScene';
import { hasSceneMap } from '../lib/pmSceneMap';
import { themeById } from '../lib/pmThemes';
import { GrowProvider, DeskPot, GrowTab, GardenStrip } from '../components/pm/grow/Grow';
import { verifyReqUser } from '../lib/auth';
import { isOrbitReportViewer } from '../lib/orbitReportAccess';
import { staffOfUser } from '../lib/pmAccount';
import { PM_ROSTER } from '../lib/pmRoster';
import StaffRequests, { StaffRequestsButton } from '../components/pm/StaffRequests';
import dynamic from 'next/dynamic';
const Scene3D = dynamic(() => import('../components/pm3d/Scene3D'), { ssr: false, loading: () => <p className="muted">3D 장면 불러오는 중…</p> });

export async function getServerSideProps({ req, res, resolvedUrl, query }) {
  const user = await verifyReqUser(req, res);
  if (!user) return { redirect: { destination: '/login?next=' + encodeURIComponent(resolvedUrl || '/pm'), permanent: false } };
  // 보기는 로그인 직원 전체 허용. 쓰기 동작은 API 가 관리자만 허용(isAdmin=UI 힌트).
  return { props: { requestMode:['list','new'].includes(query?.requests)?query.requests:null, requestFocus:typeof query?.requestId==='string'&&/^[a-f0-9]{12}$/.test(query.requestId)?query.requestId:null, userId: user.userId || '', isAdmin: isOrbitReportViewer(user), myStaff: staffOfUser(user) } };
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
const ROSTER = PM_ROSTER;
const ROOM_FLOOR = { '경영지원': 'var(--pm-dept-1)', '영업지원': 'var(--pm-dept-2)', '영업부': 'var(--pm-dept-3)', '수입부': 'var(--pm-dept-4)', '미배치': 'var(--pm-off-bg)' };

function hashColor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SHIRTS[h % SHIRTS.length]; }
function ago(iso, now) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}초 전`; if (s < 3600) return `${Math.floor(s / 60)}분 전`; if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; return `${Math.floor(s / 86400)}일 전`;
}
function fmtAge(sec) { if (sec == null) return '없음'; if (sec < 60) return `${sec}초`; if (sec < 3600) return `${Math.floor(sec / 60)}분`; return `${Math.floor(sec / 3600)}시간`; }
const arr = (x) => (Array.isArray(x) ? x : []);

function Sprite({ status, color, robot, avatar }) {
  const st = STATUS_LABEL[status] ? status : 'off';
  return (
    <div className={`sprite st-${st}`} aria-hidden>
      {avatar ? <Avatar cfg={avatar} state={st} size={40} className="sav" /> : <>
        <div className="head" style={{ background: robot ? 'var(--pm-robot)' : 'var(--pm-skin)' }}>
          {robot ? <div className="antenna" /> : <div className="hair" />}
          <div className="eyes" />
        </div>
        <div className="body" style={{ background: color }} />
      </>}
      <div className="desk"><div className="monitor"><div className="screen" /></div><div className="kb"><i className="hand l" /><i className="hand r" /></div></div>
      {st === 'idle' && <div className="zzz">z<span>z</span><b>z</b></div>}
      {st === 'error' && <div className="bang">!</div>}
    </div>
  );
}

function Seat({ name, sub, status, activity, lastAt, now, robot, extra, empty, onOpen, deskId }) {
  const { avatars } = usePmTheme();
  const st = empty ? 'off' : (STATUS_LABEL[status] ? status : 'off');
  const tip = [name, STATUS_LABEL[st], sub, activity, ago(lastAt, now), extra].filter(Boolean).join(' · ');
  const showBubble = activity && st !== 'off';
  return (
    <div className={`seat d-${st} ${empty ? 'empty-seat' : ''} ${onOpen ? 'clickable' : ''}`} title={tip} data-desk={deskId || undefined}
      {...(onOpen ? { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } } : {})}>
      <div className={`bubble ${showBubble ? '' : 'none'}`}>{showBubble ? activity : ''}</div>
      {empty ? <div className="sprite st-off"><div className="desk"><div className="monitor"><div className="screen" /></div></div></div>
        : <Sprite status={st} color={hashColor(name)} robot={robot} avatar={robot ? null : avatars[name]} />}
      {!empty && !robot && <DeskPot name={name} />}
      <div className="nm">{name || '?'}{!robot && !empty && <TokenBadge name={name} />}</div>
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
      <Button variant="primary" loading={busy} disabled={active} onClick={onMake}>{busy ? '요청 중…' : label}</Button>
      {st === 'done' && (
        <div className="dryres ok">완료 · 시험 대본{r.draftId ? ` #${r.draftId}` : ''}{r.clicks != null ? ` · 클릭 ${r.clicks}` : ''}{r.humanStops != null ? ` · 사람확인 ${r.humanStops}` : ''} · <b>승인 대기</b>{r.message ? <div className="muted">{r.message}</div> : null}</div>
      )}
      {st === 'failed' && (
        <div className="dryres bad">{/좌표|coord/i.test(`${r.reason || ''}${r.message || ''}`) ? '좌표 부족' : '실패'}{r.reason ? ` — ${r.reason}` : ''}{r.message ? <div className="muted">{r.message}</div> : null}</div>
      )}
    </div>
  );
}

const TCOLORS = CHART_COLORS;
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
        <i key={x.name} title={`${x.name} ${x.h}h`} style={{ width: `${(x.h / total) * 100}%`, background: x.kind === 'wf' ? TCOLORS[i % 8] : 'var(--pm-off-bg)' }} />
      ))}</div>
      <ul className="legend">{segs.map((x, i) => (
        <li key={x.name}><span className="sw" style={{ background: x.kind === 'wf' ? TCOLORS[i % 8] : 'var(--pm-off-bg)' }} />{x.name} <b>{x.h}h</b></li>
      ))}</ul>
      {t.workflows.length > 0 && <><h3>업무별 실측·절감</h3><HBars rows={t.workflows.map((w) => ({ name: `${w.name}${w.saveHoursPerWeek ? ` (−${w.saveHoursPerWeek}h)` : ''}`, h: w.measuredHoursPerWeek }))} /></>}
      {t.kakaoRooms.length > 0 && <><h3>카톡 시간 · 방별</h3><HBars rows={t.kakaoRooms} /></>}
      {t.kakaoTypes.length > 0 && <><h3>카톡 시간 · 유형별</h3><HBars rows={t.kakaoTypes} /></>}
      {t.erpScreens.length > 0 && <><h3>전산 시간 · 화면별</h3><HBars rows={t.erpScreens} /></>}
    </div>
  );
}

// 직원 상세(시안 page-staff-detail): 왼쪽 아바타 카드(레벨·토큰) / 위 탭 / 9단계 타임라인 / 탭 내용 / 오른쪽 효율 보너스·상점·꾸미기 큰 버튼.
//   상점·꾸미기는 같은 화면 안에서 ShopPanel 로 바뀐다(본인 또는 관리자 대리만 구매·저장).
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HM_HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 07~19시
function heatOf(rows) {
  const m = WEEKDAYS.map(() => HM_HOURS.map(() => 0));
  for (const r of rows) {
    const t = Date.parse(r.at || ''); if (!Number.isFinite(t)) continue;
    const k = new Date(t + 9 * 3600e3); const wd = (k.getUTCDay() + 6) % 7; const hi = HM_HOURS.indexOf(k.getUTCHours());
    if (hi >= 0) m[wd][hi] += 1;
  }
  return m;
}
function Heatmap({ rows }) {
  const m = heatOf(rows);
  const max = Math.max(1, ...m.flat());
  const days = WEEKDAYS.map((d, i) => [d, i]).filter(([, i]) => i < 5 || m[i].some(Boolean));
  return (
    <div className="heat" role="table" aria-label="요일×시간 작업 로그 히트맵">
      <div className="hrow hhead" role="row"><span />{HM_HOURS.map((h) => <span key={h} role="columnheader">{h % 3 === 1 ? h : ''}</span>)}</div>
      {days.map(([d, i]) => (
        <div key={d} className="hrow" role="row"><span className="hd" role="rowheader">{d}요일</span>
          {m[i].map((v, j) => <i key={j} role="cell" title={`${d} ${HM_HOURS[j]}시 · ${v}줄`} style={{ '--hv': v ? 0.18 + 0.82 * (v / max) : 0 }} />)}
        </div>
      ))}
      <p className="muted">작업 로그 줄 수 기준(라벨 바뀔 때 1줄) · 진할수록 많음</p>
    </div>
  );
}

function StageTimeline({ rows, currentStage }) {
  const cnt = {}; for (const r of rows) { const n = wlStageNo(r.stage); if (n) cnt[n] = (cnt[n] || 0) + 1; }
  return (
    <ol className="tline" aria-label="업무 9단계 진행">
      {STAGES.map((s) => (
        <li key={s.no} className={`${cnt[s.no] ? 'has' : ''} ${currentStage === s.no ? 'cur' : ''}`} style={{ '--sc': STAGE_COLOR[s.no] }} title={`${s.label} · 로그 ${cnt[s.no] || 0}줄${currentStage === s.no ? ' · 지금' : ''}`}>
          <span className="dotn">{s.no}</span><span className="tl">{s.label}</span>{cnt[s.no] ? <small>{cnt[s.no]}</small> : null}
        </li>
      ))}
    </ol>
  );
}

function BonusCard({ name }) {
  const [b, setB] = useState(null);
  useEffect(() => { let alive = true; fetch('/api/pm/bonus', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive && j.success) setB(j.data); }).catch(() => {}); return () => { alive = false; }; }, []);
  const p = b?.people?.find((x) => x.name === name);
  const fast = p?.verdicts?.['빠름'] || 0;
  return (
    <section className="pcard bonus">
      <h3>효율 보너스 {b && <small>{b.mode === 'live' ? '지급 중' : '기록만'}</small>}</h3>
      {!b ? <p className="muted">불러오는 중…</p> : <>
        <div className="bitem"><span className="bic" aria-hidden>⚡</span><div><b>{p ? `+${p.points}` : '0'}</b> 효율 점수<div className="muted">{p ? `판정 ${p.cases}건 · 빠름 ${fast}` : '판정할 기록 없음'}</div></div></div>
        <div className="bitem"><span className="bic" aria-hidden>🔥</span><div><b>팀 퀘스트 {b.teamQuest.done}/{b.teamQuest.goal}</b><div className="muted">{b.teamQuest.complete ? '오늘 달성' : '같은 국가 넘김 이어가기'}</div></div></div>
      </>}
    </section>
  );
}

function StaffDrawer({ name, live, now, onClose, initialTab = 'now', workLog = [], isAdmin = false, myStaff = null }) {
  const canEdit = isAdmin || (!!myStaff && myStaff === name);
  const editNote = canEdit ? '' : (myStaff ? '본인 캐릭터에서만 사고 꾸밀 수 있습니다' : '계정 연결 필요 — 관리자에게 PM 계정 연결을 요청하세요');
  const startShop = initialTab === 'look' || initialTab === 'wallet';
  const [tab, setTab] = useState(startShop ? 'now' : (initialTab === 'auto' ? 'now' : initialTab === 'time' ? 'rhythm' : initialTab));
  const [view, setView] = useState(startShop ? 'shop' : 'detail');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [reqs, setReqs] = useState([]);
  const [busy, setBusy] = useState({});
  const { avatars } = usePmTheme();
  const [wallet] = useWallet(name);
  const loadReqs = useCallback(() => {
    // PM 요청(시험 실행) 목록은 관리자 기능 — 관리자만 조회
    if (!isAdmin) return;
    fetch('/api/pm/request?person=' + encodeURIComponent(name), { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (j.success) setReqs(j.requests || []); }).catch(() => {});
  }, [name, isAdmin]);
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
    let alive = true; setRes(null); setErr(''); setOpen({});
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
  const mine = filterLog(workLog, { name });
  const cur = live ? staffLinks(live, now || Date.now()).current : null;
  const lv = wallet ? levelOf(wallet.earned) : null;
  const lvFrom = lv ? (LEVELS[lv.level - 1] || 0) : 0;
  const lvPct = lv ? (lv.next == null ? 100 : Math.round(((wallet.earned - lvFrom) / Math.max(1, lv.next - lvFrom)) * 100)) : 0;
  const st = STATUS_LABEL[live?.status] ? live.status : 'off';
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="sdpage" role="dialog" aria-label={`${name} 직원 상세`} onClick={(e) => e.stopPropagation()}>
        <div className="sdh">
          <h2>{view === 'shop' ? '상점 · 꾸미기' : '직원 상세'}</h2>
          {view === 'detail' && <Tabs className="sdtabs" label="직원 상세 탭" value={tab} onChange={setTab}
            items={[['now', '지금'], ['flow', '업무흐름'], ['log', '작업로그'], ['rhythm', '주간리듬'], ['role', '역할'], ['grow', '키우기']]} />}
          <IconButton className="x" label="닫기" onClick={onClose} />
        </div>
        {view === 'shop' ? (
          <div className="sdbody"><ShopPanel name={name} canEdit={canEdit} editNote={editNote} isAdmin={isAdmin} myStaff={myStaff} onBack={() => setView('detail')} /></div>
        ) : (
          <div className="sdbody sdgrid">
            <aside className="pcard who">
              <div className="avbox">{avatars[name] ? <Avatar cfg={avatars[name]} state={st} size={150} name={name} /> : <span className="avph" aria-hidden>{(name || '?').slice(0, 1)}</span>}</div>
              <div className="wname">{name}</div>
              <div className="muted">{d?.role?.dept || live?.dept || ''}{d?.dataName && d.dataName !== name ? ` · ${d.dataName}` : ''}</div>
              <div className="lv"><b>Lv. {lv ? lv.level : '–'}</b><span className="gauge" aria-label={`다음 레벨까지 ${lvPct}%`}><i style={{ width: `${lvPct}%` }} /><em>{lvPct}%</em></span></div>
              <div className="tok">🪙 <b>{wallet ? wallet.balance.toLocaleString() : '–'}</b> TOKENS</div>
              <span className={`chip chip-${st}`}>{STATUS_LABEL[st]}{live?.lastAt ? ` · ${ago(live.lastAt, now)}` : ''}</span>
            </aside>
            <div className="sdmain">
              <section className="pcard"><h3>업무 9단계 진행 타임라인 <small>작업 로그 기준</small></h3><StageTimeline rows={mine} currentStage={cur?.stage} /></section>
              <section className="pcard sdtab">
                {err && <p className="warn">불러오기 실패: {err}</p>}
                {tab === 'now' && (
                  <div className="nowgrid">
                    <div>
                      <h3>지금</h3>
                      {live ? (<>
                        {live.workLabel && <div className="kv">작업: <b>{live.workLabel}</b></div>}
                        {live.app && <div className="kv">사용 앱: {live.app}</div>}
                        <div className="kv">마지막: {ago(live.lastAt, now) || '–'}</div>
                        {live.events15m != null && <div className="kv">최근 15분 이벤트: {live.events15m}건</div>}
                      </>) : <p className="muted">실시간 데이터 없음</p>}
                      <h3>작업로그</h3>
                      <WorkLogList rows={mine} light max={6} empty="이 직원의 작업 로그 없음" />
                    </div>
                    <div><h3>주간 시간대 히트맵</h3><Heatmap rows={mine} /></div>
                  </div>
                )}
                {tab === 'log' && <WorkLogList rows={mine} light empty="이 직원의 작업 로그 없음(라벨이 바뀔 때만 한 줄 쌓임)" />}
                {tab === 'grow' && <GrowTab name={name} />}
                {tab === 'rhythm' && (<>
                  <h3>주간 시간대 히트맵</h3><Heatmap rows={mine} />
                  {d?.role?.weekRhythm && <div className="card"><h3>주간 리듬</h3>{typeof d.role.weekRhythm === 'string' ? d.role.weekRhythm : <ul>{Object.entries(d.role.weekRhythm).map(([k, v]) => <li key={k}><b>{k}</b> {typeof v === 'string' ? v : JSON.stringify(v)}</li>)}</ul>}</div>}
                  {d?.timesave ? <TimeTab t={d.timesave} /> : d && <p className="muted">시간 측정 데이터 없음</p>}
                </>)}
                {!d && !err && (tab === 'flow' || tab === 'role') && <p className="muted">불러오는 중…</p>}
                {noData && (tab === 'flow' || tab === 'role') && <p className="muted">관찰 데이터 없음</p>}
                {d && !noData && tab === 'flow' && <FlowTab d={d} isAdmin={isAdmin} open={open} setOpen={setOpen} lastReq={lastReq} busy={busy} makeDryRun={makeDryRun} />}
                {d && !noData && tab === 'role' && (
                  d.role ? (
                    <div>
                      {d.role.dept && <div className="kv">부서: {d.role.dept}</div>}
                      {d.role.roleSummary && <div className="card">{d.role.roleSummary}</div>}
                      {d.role.unknowns?.length > 0 && <div className="card"><h3>아직 모르는 것</h3><ul>{d.role.unknowns.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul></div>}
                      {d.role.dataStrength && <div className="card"><h3>데이터 강도</h3>{typeof d.role.dataStrength === 'string' ? d.role.dataStrength : <ul>{Object.entries(d.role.dataStrength).map(([k, v]) => <li key={k}><b>{k}</b> {typeof v === 'string' ? v : JSON.stringify(v)}</li>)}</ul>}</div>}
                    </div>
                  ) : <p className="muted">역할 요약 없음</p>
                )}
              </section>
            </div>
            <aside className="sdside">
              <BonusCard name={name} />
              <Button className="bigbtn shopb" onClick={() => setView('shop')}><span aria-hidden>🎁</span> 상점</Button>
              <Button className="bigbtn lookb" onClick={() => setView('shop')}><span aria-hidden>👕</span> 꾸미기</Button>
              {!canEdit && <p className="muted small">{editNote}</p>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function FlowTab({ d, isAdmin, open, setOpen, lastReq, busy, makeDryRun }) {
  return (
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
            {isAdmin && <DryRunButton req={lastReq(w.name)} busy={!!busy[w.name]} onMake={() => makeDryRun(w.name)} />}
            {w.tools?.length ? <div className="kv">도구: {[].concat(w.tools).join(', ')}</div> : null}
            {w.steps.length > 0 && (
              <LinkButton onClick={() => setOpen((o) => ({ ...o, [wi]: !o[wi] }))}>{open[wi] ? '단계 접기' : `단계 ${w.steps.length}개 보기`}</LinkButton>
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
  );
}

// ── 복도 = 업무 파이프라인 9단계 ──────────────────────────────
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

const CHIP_MAX = 6;
function Corridor({ corridor, links, selStage, onPick, onTip }) {
  const stages = corridor?.stages || STAGES.map((x) => ({ ...x, h: null, people: [] }));
  return (
    <div className="corridor" aria-label="업무 파이프라인 9단계 복도">
      {stages.map((st) => {
        const nowR = stageNowRows(links, st.no, 3);
        const mine = links.filter((l) => l.stage === st.no);
        return (
          <div key={st.no} className="ccol">
            <SelectCard data-stage={st.no} className="cell" on={selStage === st.no} pressed={selStage === st.no}
              style={{ '--sc': STAGE_COLOR[st.no] }} onClick={() => onPick(selStage === st.no ? null : st.no)}
              aria-label={`${st.no}단계 ${st.label} 이번 주 ${st.h ?? '?'}시간, 지금 ${nowR.rows.length + nowR.more}명`}>
              <span className="ch">{st.h == null ? '–' : `${st.h}h`}</span>
              <span className="cl">{CIRCLED[st.no]} {st.label}</span>
              {nowR.rows.length > 0 && (
                <span className="cnow">
                  {nowR.rows.map((r) => <span key={r.name} className={`cn ${r.kind === 'current' ? '' : 'dim'}`}>{r.name}{r.country ? <><br />{r.country}</> : ''}</span>)}
                  {nowR.more > 0 && <span className="cn dim">+{nowR.more}</span>}
                </span>
              )}
            </SelectCard>
            {mine.length > 0 && (
              <div className="lchips" style={{ '--sc': STAGE_COLOR[st.no] }}>
                {mine.slice(0, CHIP_MAX).map((l) => (
                  <span key={l.name + l.kind} role="button" tabIndex={0} data-chip={`${l.name}:${l.stage}`} className={`lchip ${l.kind === 'current' ? 'cur' : 'rec'}`}
                    title={linkTipText(l.name, l)} onMouseEnter={() => onTip(l)} onClick={() => onTip(l, true)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTip(l, true); } }}>
                    <b>{l.name}</b>{' '}<span>{linkTaskText(l)}{l.kind !== 'current' && l.hm ? ` ${l.hm}` : ''}</span>
                  </span>
                ))}
                {mine.length > CHIP_MAX && <span className="lchip rec">+{mine.length - CHIP_MAX}</span>}
              </div>
            )}
          </div>
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
        <IconButton className="spx" label="닫기" onClick={onClose} /></div>
      {liveRows.length > 0 && <div className="spl">지금: {liveRows.map((r) => <PersonChip key={r.name} onClick={() => onOpenPerson(r.name)}>{r.name}{r.text ? ` · ${r.text}` : ''}</PersonChip>)}</div>}
      {st?.people?.length ? (
        <ul className="spu">{st.people.map((p) => (
          <li key={p.name}><PersonChip onClick={() => onOpenPerson(p.name)}>{p.name}</PersonChip> <b>{p.h}h/주</b></li>
        ))}</ul>
      ) : <p className="muted">이 단계로 매핑된 업무 시간 없음</p>}
    </div>
  );
}

// 책상→단계 곡선 + 흐르는 점. 좌표는 실제 DOM(data-desk / data-stage) 위치에서 계산. 데이터 없으면 안 그림.
function FlowLines({ hostRef, links, onPick, onTip, reduced }) {
  const [geo, setGeo] = useState({ w: 0, h: 0, paths: [] });
  const key = links.map((l) => `${l.name}:${l.stage}:${l.kind}:${l.dir}:${l.width}:${l.hm || ''}`).join('|');
  useLayoutEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    const calc = () => {
      const hb = host.getBoundingClientRect();
      const paths = [];
      for (const l of links) {
        const desk = host.querySelector(`[data-desk="${CSS.escape(l.name)}"]`);
        const cell = host.querySelector(`[data-chip="${CSS.escape(`${l.name}:${l.stage}`)}"]`) || host.querySelector(`[data-stage="${l.stage}"]`);
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
          <g key={id + p.name} className={`fl ${cur ? 'cur' : 'rec'}`} data-flow={`${p.name}:${p.stage}:${p.kind}:${p.dir}`} onClick={() => onPick(p.name)} onMouseEnter={() => onTip && onTip(p)}>
            <title>{`${linkTipText(p.name, p)} → ${CIRCLED[p.stage]} ${stageLabel(p.stage)} — 클릭: 시간 탭`}</title>
            <path id={id} d={p.d} fill="none" stroke={STAGE_COLOR[p.stage]} strokeWidth={p.width} strokeOpacity={cur ? 0.95 : p.kind === 'today' ? 0.22 : 0.35} strokeDasharray={p.kind === 'today' ? '4 4' : undefined} strokeLinecap="round" />
            <path d={p.d} fill="none" stroke="transparent" strokeWidth={14} className="hit" />
            {!reduced && (
              <circle r={cur ? 4 : 3} fill={STAGE_COLOR[p.stage]} style={{ stroke: 'var(--pm-surface)' }} strokeWidth="1" opacity={cur ? 1 : 0.6}>
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
              {onOpenPerson ? <PersonChip plain className="wn" onClick={() => onOpenPerson(r.name)}>{r.name}</PersonChip> : <b className="wn">{r.name}</b>}
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
      <ToggleChip on={!value} onClick={() => onChange('')}>전체</ToggleChip>
      {items.map((x) => <ToggleChip key={x} on={value === x} onClick={() => onChange(value === x ? '' : x)}>{x}</ToggleChip>)}
    </div>
  );
}

// PM 일지 팝오버: PM 로봇(목록 보기 자리 클릭 또는 상단 버튼) — 지금 하는 일·오늘 한 일·대기 큐·승인 대기.
// 데이터: 피드 pmDetail { now, doneToday:[{at,text}], queueCount, approvals } (사장님 PC office-feed.js 가 pm-status·ledger 에서 만든다). 없으면 구버전 호환으로 탭 설명만.
// 3D 장면 연결 인터페이스: docs/PM_AGENT_ACTIVITY_INTERFACE.md (3D 는 별도 작업 중 — 여기서는 데이터 필드·2D 만).
function PmPopover({ pmAgent, detail, tasks, now, onClose, onOpenGoals }) {
  const doneToday = arr(detail?.doneToday);
  const open = tasks.filter((t) => t.state !== 'done');
  const approvals = detail?.approvals ?? open.filter((t) => /승인|approval/i.test(`${t.state} ${t.decision || ''}`)).length;
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="pmpop" role="dialog" aria-label="PM 일지" onClick={(e) => e.stopPropagation()}>
        <div className="sdh"><h2>PM 일지</h2><IconButton className="x" label="닫기" onClick={onClose} /></div>
        <div className="pmpop-b">
          <div className="kv">지금: <b>{detail?.now || pmAgent?.activity || '대기'}</b>{pmAgent?.lastAt ? <span className="muted"> · {ago(pmAgent.lastAt, now)}</span> : null}</div>
          <div className="kv">대기 큐 <b>{detail?.queueCount ?? open.length}</b>건 · 승인 대기 <b>{approvals}</b>건</div>
          <Button size="sm" onClick={onOpenGoals}>제품 목표 보드 보기</Button>
          <h3>오늘 PM이 한 일 <small>{doneToday.length}건</small></h3>
          {doneToday.length ? (
            <ol className="pmlog">{doneToday.slice(0, 30).map((x, i) => <li key={i}><span className="wt">{kstHM(x.at)}</span> {x.text}</li>)}</ol>
          ) : <p className="muted">오늘 기록 없음</p>}
          <h3>대기 중인 할 일</h3>
          {open.length ? (
            <ol className="pmlog">{open.slice(0, 20).map((t, i) => <li key={(t.key || '') + i}><b>{t.key}</b> <span className="muted">{t.state}</span>{t.decision ? ` — ${t.decision}` : ''}</li>)}</ol>
          ) : <p className="muted">열린 업무 없음</p>}
        </div>
      </div>
    </div>
  );
}

// 제품 목표(판매 솔루션 비전 P0): 사장님 PC pm-vision.js 가 goals.json 을 pm-office 피드의 vision 으로 올린다. 없으면 숨김(구버전 호환).
const GOAL_STATE = { done: ['완료', 'ok'], 'needs-approval': ['승인대기', 'warn'], stalled: ['정체', 'warn'], investigating: ['추진중', 'ok'], open: ['진행', ''] };
function VisionPanel({ vision }) {
  const goals = arr(vision?.goals);
  if (!goals.length) return null;
  const gate = vision?.gate || null;
  const weekly = vision?.weekly || null;
  return (
    <details className="panel vispanel" open>
      <summary><h2>제품 목표 <small>판매 솔루션 P0 · 분기 10개</small></h2></summary>
      {gate && (
        <div className="vgate" title={gate.measure || ''}>
          <b>P0 관문</b> {gate.title || '직원 70% 주2회 자발 접속 · 4주'}
          <div className="vgw">
            {arr(gate.weeks).slice(-4).map((w) => (
              <span key={w.week} className={`vwk ${w.pass ? 'ok' : ''}`} title={`${w.week} 주 · 접속률 ${w.rate}%`}>{w.week.slice(5)} {w.rate}%</span>
            ))}
            {!arr(gate.weeks).length && <span className="muted">{gate.status || '측정 장치 준비 중'}</span>}
          </div>
        </div>
      )}
      <ol className="vgoals">
        {goals.map((g) => {
          const [lab, tone] = GOAL_STATE[g.state] || GOAL_STATE.open;
          const p = Math.max(0, Math.min(100, Math.round(+g.progress || 0)));
          return (
            <li key={g.id} title={[g.done ? `완료조건: ${g.done}` : '', g.note || ''].filter(Boolean).join(' · ')}>
              <div className="vgt"><b>{g.title}</b><span className={`vst ${tone}`}>{lab}</span></div>
              <div className="vbar" role="img" aria-label={`진행율 ${p}%`}><i style={{ width: `${p}%` }} /><em>{p}%</em></div>
              <div className="muted vbs">{g.basis === 'measured' ? '실측' : '보고 기준'}{g.note ? ` · ${g.note}` : ''}</div>
            </li>
          );
        })}
      </ol>
      {weekly && arr(weekly.items).length > 0 && (
        <div className="vweek"><h3>이번 주 PM이 한 일</h3><ul>{arr(weekly.items).slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      )}
    </details>
  );
}

// 재발 학습 카드: 피드 playbooks 없으면 패널 숨김(구버전 호환). 카드 클릭=전체 펼침.
function PlaybookPanel({ playbooks }) {
  const [open, setOpen] = useState('');
  const pb = normalizePlaybooks(playbooks);
  if (!pb) return null;
  const s = playbookSummary(pb);
  const cards = sortPlaybookCards(pb.cards);
  return (
    <section className="panel pbpanel">
      <h2>재발 학습 카드 <small>{s.total}</small></h2>
      <div className="pbsum">카드 {s.total}장 · 새로 학습 {s.learned} · 재발 적중 {s.hits} · 자동 해결 {s.auto} · 조사 완료 {s.investigated} · 사장님 확인 {s.escalated}</div>
      {cards.map((c, i) => {
        const id = c.id || String(i); const on = open === id;
        return (
          <SelectCard key={id} className="task pbcard" on={on} expanded={on} onClick={() => setOpen(on ? '' : id)}>
            <div className="tk pbh"><span>{c.title || c.id}</span><span className={`chip ${Number(c.hits) > 0 ? 'chip-error' : 'chip-off'}`}>적중 {Number(c.hits) || 0}</span></div>
            {c.learnedAt && <div className="pblearn"><span className="chip chip-working">학습됨{c.learnedFrom ? ` · ${c.learnedFrom}` : ''} · {kstDateTime(c.learnedAt)}</span></div>}
            {c.signature && <div className={on ? '' : 'pbl'}><span className="muted">증상</span> {c.signature}</div>}
            {c.fix && <div className={on ? '' : 'pbl'}><span className="muted">조치</span> {c.fix}</div>}
            <div className="muted">마지막 적중 {c.lastHit ? `${kstDateTime(c.lastHit)} KST` : '없음'}</div>
            {on && c.keys && <div className="muted pbk">작업키 {c.keys}</div>}
          </SelectCard>
        );
      })}
      {!cards.length && <p className="muted">카드 없음</p>}
    </section>
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
  const c = link.external ? 'var(--pm-muted)' : STAGE_COLOR[toStage];
  const tip = link.external ? '현장팀은 PC 데이터 없음 — 넘김 확인 불가'
    : n ? `넘김 ${n}건 (추정 · 같은 국가 · ${DEFAULT_WINDOW_H}시간 이내 · 확정 아님)\n` + link.items.slice(0, 6).map((h) => `${h.a.name} ${kstHM(h.a.at)} → ${h.b.name} ${kstHM(h.b.at)} (${h.country}, ${fmtGap(h.gapMin)})`).join('\n')
      : `넘김 없음 (같은 국가 ${DEFAULT_WINDOW_H}시간 이내 짝 없음)`;
  return (
    <div className={`clink ${n ? 'has' : ''} ${link.external ? 'ext' : ''}`} title={tip} data-link={`${link.from}>${link.to}`}>
      <svg height="14" viewBox="0 0 40 14" preserveAspectRatio="none" aria-hidden>
        <path d="M1,7 L33,7" fill="none" stroke={c} strokeWidth={n ? lineWidth(n, maxN) : 2} strokeOpacity={n ? 0.95 : 0.35} strokeDasharray={link.external ? '3 3' : undefined} strokeLinecap="round" />
        <path d="M32,2 L39,7 L32,12" fill="none" stroke={c} strokeWidth="2" strokeOpacity={n ? 0.95 : 0.5} />
        {n > 0 && !reduced && <circle r="2.6" fill={c} style={{ stroke: 'var(--pm-surface)' }} strokeWidth="1"><animateMotion dur="2.4s" repeatCount="indefinite" path="M1,7 L33,7" /></circle>}
      </svg>
      {n > 0 && <span className="cn" style={{ '--sc': c }}><i>넘김 </i>{n}</span>}
    </div>
  );
}

function HandoffChains({ workLog, handoffs, reduced, onOpenPerson }) {
  const { avatars } = usePmTheme();
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
            {avatars[h.a.name] && <Avatar cfg={avatars[h.a.name]} state={reduced ? 'idle' : 'handoff'} size={22} />}
            <PersonChip onClick={() => onOpenPerson(h.a.name)}>{h.a.name} {h.country} {h.a.stage} {kstHM(h.a.at)}</PersonChip>
            <span aria-hidden>→</span>
            <PersonChip onClick={() => onOpenPerson(h.b.name)}>{h.b.name} {h.country} {h.b.stage} {kstHM(h.b.at)}</PersonChip>
            <span className="muted">{fmtGap(h.gapMin)} 뒤</span>
          </li>
        ))}</ul>
      ) : <p className="hnone">아직 묶인 넘김 없음 (같은 국가로 {DEFAULT_WINDOW_H}시간 안에 다음 부서 작업이 나오면 표시)</p>}
    </div>
  );
}

export default function PmOffice({ isAdmin = false, myStaff = null,requestMode=null,requestFocus=null }) {
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState(null);
  const [ts, setTs] = useState(null);
  const [selTab, setSelTab] = useState('auto');
  const [selStage, setSelStage] = useState(null);
  const [tip, setTip] = useState(null);
  const onTip = useCallback((l, toggle) => setTip((cur) => (toggle && cur && cur.name === l.name && cur.stage === l.stage ? null : l)), []);
  const [reduced, setReduced] = useState(false);
  const pmTheme = usePmThemeState(myStaff || '');
  const [reqOpen, setReqOpen] = useState(!!requestMode);
  const [pmOpen, setPmOpen] = useState(false);
  const floorRef = useRef(null);
  // 장면(아이소메트릭) / 목록(예전 카드 격자) 보기 — 이 PC 편의 설정
  // 게임 장면은 직접 선택할 때만 켠다. 이전 자동 장면 설정은 새 기본값에 이월하지 않는다.
  const [view, setView] = useState('list');
  useEffect(() => { try { const v = window.localStorage.getItem('pm.view.v2'); if (v === 'list' || v === 'scene' || v === '3d') setView(v); } catch { /* 무시 */ } }, []);
  const [sideOpen, setSideOpen] = useState(false);
  const [fb3d, setFb3d] = useState('');
  useEffect(() => { try { if (window.localStorage.getItem('pm.side') === '1') setSideOpen(true); } catch { /* 무시 */ } }, []);
  const toggleSide = () => setSideOpen((v) => { try { window.localStorage.setItem('pm.side', v ? '0' : '1'); } catch { /* 무시 */ } return !v; });
  const pickView = (v) => { setView(v); try { window.localStorage.setItem('pm.view.v2', v); } catch { /* 무시 */ } };
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
  const unresolved = pmUnresolved(tasks);
  const grouped = TASK_GROUPS.map((g) => ({ ...g, items: [] }));
  const other = [];
  for (const t of tasks) { const s = `${t.state || ''}`; const g = grouped.find((x) => x.match(s, t)); (g ? g.items : other).push(t); }
  const corridor = ts?.data?.corridor || null;
  const links = []; const liveRowsByStage = {};
  const maxPersonH = Math.max(0, ...Object.values(corridor?.perPerson || {}).flatMap((o) => Object.values(o)));
  for (const x of staff) {
    const L = staffLinks(x, now || Date.now());
    const hOf = (st) => corridor?.perPerson?.[x.name]?.[st] || 0;
    if (L.current) {
      (liveRowsByStage[L.current.stage] = liveRowsByStage[L.current.stage] || []).push({ name: x.name, text: L.current.text });
      links.push({ ...L.current, name: x.name, kind: 'current', screen: L.current.screen || '', width: lineWidth(hOf(L.current.stage), maxPersonH) });
    }
    for (const r of L.recent) links.push({ ...r, name: x.name, kind: r.kind || 'recent', width: Math.max(1.5, lineWidth(hOf(r.stage), maxPersonH) * (r.kind === 'today' ? 0.45 : 0.6)) });
  }
  const workLog = arr(d.workLog);
  const handoffs = buildHandoffs(workLog, { windowH: DEFAULT_WINDOW_H });
  const working = agents.filter((a) => a.status === 'working').length + staff.filter((s) => s.status === 'working').length;

  return (
    <PmThemeCtx.Provider value={pmTheme.ctx}>
    <GrowProvider>
    <div className="pm" data-theme={pmTheme.themeId}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: pmTheme.css }} />
      <header className="top">
        <MenuBackButton />
        <h1>PM 사무실</h1>
        <span className={`badge ${mode}`}>{mode === 'live' ? '실행' : '그림자'}</span>
        <span className={`badge age ${stale ? 'warn' : ''}`}>데이터 {fmtAge(ageSec)} 전{stale ? ' · 갱신 끊김?' : ''}</span>
        <span className="badge plain">작업중 {working}</span>
        <StaffRequestsButton onClick={() => setReqOpen(true)} />
        <Button size="sm" onClick={() => setPmOpen(true)}>🤖 PM 일지</Button>
        <ThemePicker value={pmTheme.themeId} onChange={pmTheme.pick} />
        {err && <span className="badge warn">불러오기 실패: {err}</span>}
      </header>
      <StaffRequests startWriting={requestMode==='new'} focusId={requestFocus} open={reqOpen} onClose={() => setReqOpen(false)} />
      {pmOpen && <PmPopover pmAgent={pmAgent} detail={d.pmDetail} tasks={tasks} now={now} onClose={() => setPmOpen(false)}
        onOpenGoals={() => { setPmOpen(false); const el = document.querySelector('.vispanel'); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }} />}
      <GardenStrip />
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
      <div className={`wrap ${sideOpen ? 'open' : 'wide'}`}>
        {view === 'scene' || view === '3d' ? (
        <main className="floor scene">
          <div className="scene-h">
            <b>사무실 장면</b><small>스테이션·캐릭터에 마우스 = 자세히 · 클릭 = 고정 · 라벨칩 클릭 = 직원 시간</small>
            <Tabs className="vtab" label="보기 방식" value={view} onChange={pickView} items={[['scene', '장면'], ['3d', '3D(베타)'], ['list', '목록 보기']]} />
          </div>
          {view === '3d' && fb3d && <p className="muted">3D 장면을 쓸 수 없어 2D 장면으로 보여 줍니다({fb3d}).</p>}
          {view === '3d' && !fb3d ? (
            <Scene3D themeId={pmTheme.themeId === 'B' ? 'B' : 'I'} agents={agents} rooms={visibleRooms} links={links} reduced={reduced}
              onOpenPerson={openPerson} onPickStage={setSelStage} onFallback={setFb3d} />
          ) : (() => {
            const iso = <IsoScene theme={themeById(pmTheme.themeId)} agents={agents} rooms={visibleRooms} links={links} corridor={corridor} now={now}
            selStage={selStage} onPickStage={setSelStage} onOpenPerson={openPerson} reduced={reduced} isAdmin={isAdmin} myStaff={myStaff} />;
            return hasSceneMap(pmTheme.themeId) ? (
              <BgScene themeId={pmTheme.themeId} agents={agents} rooms={visibleRooms} links={links} corridor={corridor} now={now} fallback={iso}
                selStage={selStage} onPickStage={setSelStage} onOpenPerson={openPerson} reduced={reduced} isAdmin={isAdmin} myStaff={myStaff} />
            ) : iso;
          })()}
          {selStage && <StagePanel no={selStage} corridor={corridor} liveRows={liveRowsByStage[selStage] || []} onClose={() => setSelStage(null)} onOpenPerson={(n) => openPerson(n, 'time')} />}
          <details className="chainbox"><summary>부서간 넘김 사슬 보기</summary>
            <HandoffChains workLog={workLog} handoffs={handoffs} reduced={reduced} onOpenPerson={(n) => openPerson(n, 'log')} />
          </details>
        </main>
        ) : (
        <main className="floor" ref={floorRef}>
          <div className="scene-h"><b>목록 보기</b><Tabs className="vtab" label="보기 방식" value={view} onChange={pickView} items={[['scene', '장면'], ['3d', '3D(베타)'], ['list', '목록 보기']]} /></div>
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
                  onOpen={() => setPmOpen(true)} extra={pmAgent.today?.done != null ? `오늘 ${pmAgent.today.done}건` : ''} /> : <Seat empty name="PM" />}
              </div>
            </section>
          </div>
          <div className="hallwrap">
            <div className="hall-t">복도 · 업무 파이프라인 <small>이번 주 사람시간(h) · 칸 클릭=담당자 · 선 클릭=직원 시간</small></div>
            <Corridor corridor={corridor} links={links} selStage={selStage} onPick={setSelStage} onTip={onTip} />
            {tip && <div className="spanel ltip" role="status">{linkTipText(tip.name, tip)} <IconButton className="spx" label="닫기" onClick={() => setTip(null)} /></div>}
            {selStage && <StagePanel no={selStage} corridor={corridor} liveRows={liveRowsByStage[selStage] || []} onClose={() => setSelStage(null)} onOpenPerson={(n) => openPerson(n, 'time')} />}
            <HandoffChains workLog={workLog} handoffs={handoffs} reduced={reduced} onOpenPerson={(n) => openPerson(n, 'log')} />
          </div>
          <div className="wing">
            {visibleRooms.map((r) => (
              <section key={r.dept} className="room dept" data-dept={r.dept} style={{ '--dc': ROOM_FLOOR[r.dept] || ROOM_FLOOR['미배치'] }}>
                <div className="plate">{r.dept} <small>{r.seats.filter((x) => !x.empty).length}</small></div>
                <Table seats={r.seats} render={(x, i) => (
                  <Seat key={(x.name || '') + i} empty={x.empty} name={x.name} sub={x.app} status={x.status} deskId={x.empty ? undefined : x.name} onOpen={x.empty ? undefined : () => openPerson(x.name)}
                    activity={x.workLabel || arr(x.recent).find((r) => r?.label)?.label || (x.app ? `${x.app} 사용 중` : '')} lastAt={x.lastAt} now={now} extra={x.events15m != null ? `15분 ${x.events15m}건` : ''} />
                )} />
              </section>
            ))}
          </div>
          <FlowLines hostRef={floorRef} links={links} reduced={reduced} onTip={onTip} onPick={(n) => openPerson(n, 'time')} />
        </main>
        )}
        <aside className="side" aria-label="작업로그·업무 대장 패널">
          <Button size="sm" className="sidetog" aria-expanded={sideOpen} onClick={toggleSide}>{sideOpen ? '패널 접기 (장면 아래로)' : '작업로그 패널을 옆으로 펼치기'}</Button>
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
          <VisionPanel vision={d.vision} />
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
          <PlaybookPanel playbooks={d.playbooks} />
          <section className="panel">
            <h2>PM이 스스로 해결 못 한 일 <small>{unresolved.length}</small></h2>
            {unresolved.length ? (
              <ul className="unres">{unresolved.map((u) => (
                <li key={u.id}>
                  <div><b>{u.title}</b>{u.since ? <span className="muted"> · {u.since}</span> : null}</div>
                  {u.todo && <div className="dec">{u.todo}</div>}
                </li>
              ))}</ul>
            ) : <p className="muted">지금 사장님이 보실 것 없음</p>}
            <details className="rawtalk">
              <summary>에이전트 대화 원문 보기 <small>{board.length}</small></summary>
              <div className="feed">
                {board.slice(0, 60).map((m, i) => (
                  <div key={i} className="msg">
                    <div className="mh"><b style={{ color: hashColor(m.from) }}>{m.from}</b> → <b>{m.to}</b>{m.type ? <span className="mt">{m.type}</span> : null}<span className="muted"> {ago(m.at, now)}</span></div>
                    <div className="mb">{m.text}</div>
                  </div>
                ))}
                {!board.length && <p className="muted">대화 없음</p>}
              </div>
            </details>
          </section>
        </aside>
      </div>
      {sel && <StaffDrawer key={sel + selTab} initialTab={selTab} name={sel} workLog={workLog} live={staff.find((x) => x.name === sel) || null} now={now} onClose={closeSel} isAdmin={isAdmin} myStaff={myStaff} />}
      <p className="credit">픽셀 사무실 아이디어: pablodelucca/pixel-agents (그림은 직접 제작)</p>
      <style dangerouslySetInnerHTML={{ __html: ISO_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: BG_CSS }} />
      <style jsx global>{`
        /* 모든 색·모서리·그림자·폰트 = lib/pmThemes.js 토큰(var(--pm-*)). 여기에 hex 를 쓰지 않는다(__tests__/pmNoHexColor.test.js). */
        .pm { position: relative; min-height: 100vh; background: var(--pm-bg); color: var(--pm-ink); font-family: var(--pm-font); padding: 0 16px 24px; font-size: 13px; isolation: isolate; }
        .pm::before { content: ''; position: fixed; inset: 0; z-index: -2; background: var(--pm-tex) center / cover no-repeat; opacity: .28; pointer-events: none; }
        .pm::after { content: ''; position: fixed; inset: 0; z-index: -1; background: var(--pm-deco); pointer-events: none; }
        .pm .top { position: sticky; top: 0; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 -16px 12px; padding: 10px 16px; background: var(--pm-header); color: var(--pm-header-ink); box-shadow: var(--pm-shadow); border-bottom: 1px solid var(--pm-line); }
        .pm .top h1 { font-size: 20px; margin: 0 6px 0 0; color: var(--pm-header-ink); }
        .pm .badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--pm-surface2); color: var(--pm-ink); border: 1px solid var(--pm-line); }
        .pm .badge.live { background: var(--pm-ok); color: var(--pm-accent-ink); } .pm .badge.warn { background: var(--pm-err); color: var(--pm-accent-ink); }
        .pm .muted { color: var(--pm-muted); }
        .pm h2 { font-size: 15px; margin: 0 0 8px; } .pm h3 { font-size: 13px; margin: 8px 0 6px; color: var(--pm-ink); }
        .pm small { color: var(--pm-muted); font-weight: normal; }
        .pm .wrap { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; }
        .pm .wrap.wide { grid-template-columns: minmax(0, 1fr); }
        .pm .wrap.wide .side { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; align-items: start; }
        .pm .wrap.wide .side .sidetog, .pm .side .sidetog { justify-self: start; grid-column: 1 / -1; margin-bottom: 4px; }
        .pm .wrap > *, .pm .floor, .pm .room, .pm .topwing > * { min-width: 0; }
        .pm .floor { position: relative; background: color-mix(in srgb, var(--pm-surface) 55%, transparent); border: 2px solid var(--pm-line); border-radius: calc(var(--pm-radius) + 6px); padding: 12px; box-shadow: var(--pm-shadow); backdrop-filter: blur(2px); }
        .pm .scene-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 8px; } .pm .scene-h b { font-size: 14px; } .pm .scene-h .vtab { margin-left: auto; }
        .pm .floor.scene { padding: 10px; } .pm .chainbox { margin-top: 10px; } .pm .chainbox > summary { cursor: pointer; font-weight: bold; padding: 4px 0; color: var(--pm-ink); }
        .pm .side .panel { padding: 10px 12px; } .pm .side .panel h2 { display: flex; align-items: baseline; gap: 6px; }
        .pm .topwing { display: flex; gap: 10px; flex-wrap: wrap; }
        .pm .room { position: relative; background: var(--pm-floor); border: 3px solid var(--pm-line); border-radius: var(--pm-radius); padding: 28px 10px 10px; box-shadow: var(--pm-shadow); }
        .pm .room::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 6px; border-radius: var(--pm-radius) var(--pm-radius) 0 0; background: var(--dc, var(--pm-accent)); }
        .pm .plate { position: absolute; top: -10px; left: 14px; z-index: 6; background: var(--pm-plate); color: var(--pm-plate-ink); font-weight: bold; font-size: 12px; padding: 3px 12px; border: 2px solid var(--pm-line); border-radius: 999px; box-shadow: var(--pm-shadow); }
        .pm .plate small { color: inherit; opacity: .8; }
        .pm .lab { flex: 1 1 520px; } .pm .mgr { flex: 0 0 150px; }
        .pm .rows { display: grid; grid-template-columns: repeat(auto-fill, 120px); gap: 8px; justify-content: start; }
        .pm .wing { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
        .pm .table { display: inline-flex; flex-direction: column; max-width: 100%; overflow-x: auto; background: color-mix(in srgb, var(--pm-ink) 6%, transparent); padding: 6px; border-radius: var(--pm-radius); }
        .pm .row { display: flex; gap: 6px; }
        .pm .divider { height: 4px; margin: 3px 0; background: var(--pm-line); border-radius: 2px; }
        .pm .seat { position: relative; z-index: 6; width: 120px; height: 150px; flex: 0 0 120px; box-sizing: border-box; background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); padding: 4px; text-align: center; overflow: hidden; box-shadow: var(--pm-shadow); }
        .pm .seat.d-off { opacity: .78; } .pm .seat.d-off .sprite { filter: grayscale(.85) brightness(.75); }
        .pm .seat.clickable { cursor: pointer; } .pm .seat.clickable:hover, .pm .seat.clickable:focus-visible { outline: 3px solid var(--pm-accent2); outline-offset: 1px; transform: translateY(-2px); }
        .pm .seat.d-error { border-color: var(--pm-err); } .pm .seat.d-working { border-color: var(--pm-ok); }
        .pm .empty-seat { border-style: dashed; }
        .pm .chip { display: inline-block; max-width: 100%; font-size: 11px; font-weight: bold; border-radius: 999px; padding: 1px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .chip-working { background: var(--pm-ok-bg); color: var(--pm-ok-ink); } .pm .chip-idle { background: var(--pm-idle-bg); color: var(--pm-idle-ink); } .pm .chip-off { background: var(--pm-off-bg); color: var(--pm-off-ink); } .pm .chip-error { background: var(--pm-err-bg); color: var(--pm-err-ink); } .pm .chip-empty { background: var(--pm-surface2); color: var(--pm-muted); }
        .pm .bubble { position: relative; background: var(--pm-bubble); color: var(--pm-bubble-ink); border: 1px solid var(--pm-line); height: 28px; box-sizing: border-box; border-radius: 10px; padding: 2px 5px; font-size: 10px; line-height: 12px; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-align: left; margin-bottom: 6px; }
        .pm .bubble.none { visibility: hidden; }
        .pm .nm { color: var(--pm-ink); font-weight: bold; margin-top: 2px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm .tstrip { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; background: var(--pm-surface); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px 12px; margin-bottom: 12px; color: var(--pm-ink); box-shadow: var(--pm-shadow); }
        .pm .tstrip b.g, .pm .fh { color: var(--pm-ok); }
        .pm .est { background: var(--pm-est-bg); color: var(--pm-est-ink); border-radius: 999px; padding: 0 7px; font-size: 11px; font-weight: bold; }
        .pm .panel { background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px; margin-bottom: 12px; box-shadow: var(--pm-shadow); }
        .pm details.panel > summary { cursor: pointer; list-style: none; } .pm details.panel > summary h2 { display: inline; }
        /* 제품 목표(비전 P0) 패널 — 색은 전부 테마 토큰 */
        .pm .vispanel .vgate { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 6px 8px; margin: 8px 0; font-size: 12px; }
        .pm .vispanel .vgw { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .pm .vispanel .vwk { background: var(--pm-off-bg); color: var(--pm-off-ink); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: bold; }
        .pm .vispanel .vwk.ok { background: var(--pm-ok-bg); color: var(--pm-ok-ink); }
        .pm .vispanel .vgoals { margin: 0; padding: 0 0 0 2px; list-style: none; counter-reset: vg; }
        .pm .vispanel .vgoals > li { padding: 6px 0; border-top: 1px dashed var(--pm-line); counter-increment: vg; }
        .pm .vispanel .vgoals > li:first-child { border-top: 0; }
        .pm .vispanel .vgt { display: flex; align-items: baseline; gap: 6px; }
        .pm .vispanel .vgt b::before { content: counter(vg) '. '; color: var(--pm-muted); font-weight: normal; }
        .pm .vispanel .vst { margin-left: auto; font-size: 11px; font-weight: bold; border-radius: 999px; padding: 0 7px; background: var(--pm-surface2); color: var(--pm-muted); white-space: nowrap; }
        .pm .vispanel .vst.ok { background: var(--pm-ok-bg); color: var(--pm-ok-ink); }
        .pm .vispanel .vst.warn { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .pm .vispanel .vbar { position: relative; height: 12px; margin-top: 4px; background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: 999px; overflow: hidden; }
        .pm .vispanel .vbar i { display: block; height: 100%; background: var(--pm-accent); }
        .pm .vispanel .vbar em { position: absolute; right: 6px; top: -1px; font-style: normal; font-size: 10px; font-weight: bold; color: var(--pm-ink); }
        .pm .vispanel .vbs { font-size: 11px; margin-top: 2px; }
        .pm .vispanel .vweek ul { margin: 4px 0 0; padding-left: 16px; } .pm .vispanel .vweek li { margin: 2px 0; }
        /* PM 일지 팝오버 — 직원 상세와 같은 drawer-back 재사용 */
        .pm .pmpop { background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); width: min(560px, 94vw); max-height: 86vh; overflow: auto; padding: 12px 14px; }
        .pm .pmpop .pmpop-b { display: grid; gap: 6px; }
        .pm .pmpop .pmlog { margin: 0; padding-left: 4px; list-style: none; }
        .pm .pmpop .pmlog li { padding: 3px 0; border-top: 1px dashed var(--pm-line); font-size: 12px; }
        .pm .pmpop .pmlog li:first-child { border-top: 0; }
        .pm .pmpop .pmlog .wt { color: var(--pm-muted); font-variant-numeric: tabular-nums; margin-right: 6px; }
        .pm .feat { margin: 8px 0 0; padding-left: 20px; } .pm .feat li { margin-bottom: 8px; }
        .pm .ft { display: flex; justify-content: space-between; gap: 6px; } .pm .fh { font-weight: bold; white-space: nowrap; }
        .pm .pchips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; } .pm .pchips span, .pm .mt { background: var(--pm-surface2); color: var(--pm-ink); border: 1px solid var(--pm-line); border-radius: 999px; padding: 0 6px; font-size: 11px; }
        .pm .unp { margin: 4px 0 0; padding-left: 18px; font-size: 12px; }
        .pm .tg h3 { border-left: 4px solid var(--pm-line); padding-left: 6px; }
        .pm .tg-approval { border-color: var(--pm-err) !important; } .pm .tg-day3 { border-color: var(--pm-idle) !important; } .pm .tg-investigate { border-color: var(--pm-accent) !important; } .pm .tg-verify { border-color: var(--pm-ok) !important; }
        .pm .task, .pm .msg { background: var(--pm-surface2); color: var(--pm-ink); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 6px 9px; margin-bottom: 6px; font-size: 12px; line-height: 1.4; }
        .pm .tk { font-weight: bold; word-break: break-all; } .pm .days { margin-left: 6px; background: var(--pm-err); color: var(--pm-accent-ink); padding: 0 6px; border-radius: 999px; font-size: 11px; }
        .pm .dec { color: var(--pm-accent); font-weight: bold; }
        .pm .pbsum { font-size: 12px; color: var(--pm-muted); margin-bottom: 8px; line-height: 1.5; }
        .pm .pbcard { display: block; width: 100%; text-align: left; font: inherit; cursor: pointer; }
        .pm .pbcard.on { outline: 2px solid var(--pm-accent); }
        .pm .pblearn { margin: 2px 0; } .pm .pbh { display: flex; justify-content: space-between; gap: 6px; } .pm .pbh .chip { flex: none; }
        .pm .pbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .pm .pbk { word-break: break-all; }
        .pm .feed { max-height: 60vh; overflow-y: auto; }
        .pm .unres { list-style: none; margin: 0 0 8px; padding: 0; } .pm .unres li { padding: 7px 0; border-bottom: 1px solid var(--pm-line); font-size: 13px; line-height: 1.45; } .pm .unres li:last-child { border-bottom: 0; }
        .pm .unres .dec { font-size: 12px; color: var(--pm-muted); }
        .pm .rawtalk > summary { cursor: pointer; font-size: 12px; color: var(--pm-muted); padding: 4px 0; } .pm .rawtalk[open] > summary { margin-bottom: 6px; }
        .pm .mh { font-size: 11px; } .pm .mt { margin-left: 6px; } .pm .mb { margin-top: 2px; line-height: 1.4; word-break: break-word; }
        .pm .credit { margin-top: 12px; font-size: 11px; color: var(--pm-muted); }
        /* 복도 = 2.5D 길(살짝 눕힌 바닥판 + 두께) */
        .pm .hallwrap { position: relative; margin: 18px 0; padding: 12px; background: var(--pm-hall); color: var(--pm-hall-ink); border: 2px solid var(--pm-line); border-radius: calc(var(--pm-radius) + 4px); box-shadow: 0 8px 0 color-mix(in srgb, var(--pm-hall) 60%, var(--pm-ink)), var(--pm-shadow); }
        .pm .hall-t { position: relative; z-index: 6; color: var(--pm-hall-ink); font-weight: bold; font-size: 13px; margin-bottom: 8px; } .pm .hall-t small { color: var(--pm-hall-ink); opacity: .8; }
        .pm .corridor { display: grid; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); gap: 8px; }
        .pm .ccol { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pm .cell { position: relative; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 56px; padding: 7px 3px; background: var(--pm-surface); color: var(--pm-ink); border: 2px solid var(--sc, var(--pm-line)); border-radius: var(--pm-radius); cursor: pointer; font: inherit; box-shadow: 0 5px 0 color-mix(in srgb, var(--sc, var(--pm-line)) 55%, transparent); }
        .pm .cell:hover, .pm .cell:focus-visible, .pm .cell.on { outline: 3px solid var(--pm-accent2); outline-offset: 1px; }
        .pm .cell .ch { font-size: 16px; font-weight: bold; color: var(--sc, var(--pm-ink)); }
        .pm .cell .cl { font-size: 12px; color: var(--pm-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .pm .cell .cn, .pm .clink .cn { white-space: nowrap; font-size: 10px; background: var(--sc); color: var(--pm-surface); border-radius: 999px; padding: 0 5px; font-weight: bold; }
        .pm .cell .cnow { display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; }
        .pm .cell .cnow .cn { white-space: normal; word-break: keep-all; overflow-wrap: anywhere; line-height: 12px; padding: 1px 4px; }
        .pm .cell .cn.dim, .pm .lchip.rec { opacity: 0.62; }
        .pm .lchips { display: flex; flex-direction: column; gap: 3px; position: relative; z-index: 6; }
        .pm .lchip { font-size: 10px; line-height: 14px; padding: 1px 6px; border-radius: var(--pm-radius); white-space: normal; word-break: keep-all; overflow-wrap: anywhere; cursor: pointer; background: var(--pm-surface); color: var(--pm-ink); border: 1px solid var(--sc); }
        .pm .lchip.cur { background: var(--sc); color: var(--pm-surface); font-weight: bold; } .pm .lchip b { display: block; }
        .pm .cell.unk { --sc: var(--pm-muted); cursor: default; border-style: dashed; }
        .pm .spanel { position: relative; z-index: 6; margin-top: 8px; background: var(--pm-surface); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px 10px; color: var(--pm-ink); }
        .pm .ltip { font-size: 12px; }
        .pm .sph { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; } .pm .spx { margin-left: auto; color: var(--pm-ink); }
        .pm .spu { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; } .pm .spl { margin-top: 4px; }
        .pm .flows { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 5; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--pm-accent2) 50%, transparent)); }
        .pm .flows .fl, .pm .flows .hit { pointer-events: stroke; cursor: pointer; }
        .pm .chains { margin-top: 12px; padding-top: 10px; border-top: 2px dashed var(--pm-line); }
        .pm .chain { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px; align-items: center; margin-bottom: 8px; }
        .pm .chl { color: var(--pm-hall-ink); font-weight: bold; font-size: 12px; }
        .pm .chrow { display: flex; align-items: stretch; min-width: 0; }
        .pm .chseg { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
        .pm .cnode { flex: 1 1 0; min-width: 0; cursor: default; overflow: hidden; padding-top: 10px; }
        .pm .cnode .dstrip { position: absolute; left: 0; right: 0; top: 0; height: 6px; }
        .pm .cnode .cd, .pm .cnode .cd2 { font-size: 10px; color: var(--pm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .pm .clink { position: relative; flex: 0 0 34px; display: flex; flex-direction: column; align-items: center; }
        .pm .clink svg { display: block; width: 34px; } .pm .clink .cn { position: relative; z-index: 7; padding: 0 4px; } .pm .clink .cn i { font-style: normal; }
        .pm .hlist { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; }
        .pm .hlist li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; color: var(--pm-hall-ink); font-size: 12px; }
        .pm .hlist .muted, .pm .hnone { color: var(--pm-hall-ink); opacity: .85; } .pm .hnone { margin: 4px 0 0; font-size: 12px; }
        .pm .dsw { display: inline-block; width: 10px; height: 10px; flex: 0 0 10px; border-radius: 3px; border: 1px solid var(--pm-line); }
        .pm .fchips { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; margin: 4px 0; }
        .pm .wlscroll { max-height: 46vh; overflow-y: auto; margin-top: 4px; }
        .pm .wlog { list-style: none; margin: 0; padding: 0; }
        .pm .wday { font-size: 11px; color: var(--pm-muted); margin: 6px 0 2px; border-bottom: 1px solid var(--pm-line); }
        .pm .wrow { display: flex; align-items: center; gap: 6px; padding: 3px 0; min-width: 0; font-size: 12px; }
        .pm .wt { font-variant-numeric: tabular-nums; color: var(--pm-muted); flex: 0 0 auto; }
        .pm .wn { flex: 0 0 auto; color: var(--pm-ink); font-weight: bold; }
        .pm .wl { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        /* 테마 선택기 */
        .pm .tpick { position: relative; margin-left: auto; }
        .pm .tgrid { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; width: min(560px, 92vw); display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; padding: 10px; background: var(--pm-surface); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); }
        .pm .tthumb { display: flex; flex-direction: column; gap: 4px; padding: 4px; background: var(--pm-surface2); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); font-size: 11px; color: var(--pm-ink); }
        .pm .tthumb img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: calc(var(--pm-radius) / 2); display: block; }
        .pm .tthumb.on { border-color: var(--pm-accent); outline: 2px solid var(--pm-accent); }
        .pm .nm .tokb { margin-left: 4px; padding: 0 5px; font-size: 10px; font-weight: normal; vertical-align: 1px; background: var(--pm-est-bg); color: var(--pm-est-ink); border: 0; }
        /* 직원 상세(시안 page-staff-detail) */
        .drawer-back { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: color-mix(in srgb, var(--pm-ink) 45%, transparent); }
        .pm .sdpage { width: min(1180px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: color-mix(in srgb, var(--pm-bg) 85%, var(--pm-surface)); color: var(--pm-ink); border: 3px solid var(--pm-line); border-radius: calc(var(--pm-radius) + 8px); box-shadow: var(--pm-shadow); overflow: hidden; }
        .pm .sdh { display: flex; align-items: center; gap: 12px; padding: 12px 16px; flex-wrap: wrap; }
        .pm .sdh h2 { margin: 0; font-size: 22px; }
        .pm .sdtabs { flex: 1; gap: 8px; justify-content: center; }
        .pm .sdtabs .pmk-tab { flex: 0 0 auto; min-height: 38px; padding: 0 18px; background: var(--pm-surface); border: 2px solid var(--pm-line); border-radius: 999px; color: var(--pm-ink); box-shadow: var(--pm-shadow); }
        .pm .sdtabs .pmk-tab.on { background: var(--pm-accent); color: var(--pm-accent-ink); border-color: var(--pm-accent); }
        .pm .sdh .x { margin-left: auto; color: var(--pm-ink); font-size: 24px; min-width: 44px; min-height: 44px; }
        .pm .sdbody { flex: 1; overflow-y: auto; padding: 4px 16px 18px; line-height: 1.5; }
        .pm .sdgrid { display: grid; grid-template-columns: 240px minmax(0, 1fr) 220px; gap: 14px; align-items: start; }
        .pm .pcard { background: var(--pm-surface); border: 2px solid var(--pm-line); border-radius: calc(var(--pm-radius) + 4px); padding: 12px; box-shadow: var(--pm-shadow); }
        .pm .pcard h3 { margin-top: 0; font-size: 15px; }
        .pm .who { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
        .pm .avbox { width: 100%; aspect-ratio: 1; display: grid; place-items: center; background: var(--pm-surface2); border-radius: var(--pm-radius); border: 2px solid var(--pm-line); }
        .pm .avph { width: 110px; height: 110px; display: grid; place-items: center; border-radius: 50%; background: var(--pm-accent); color: var(--pm-accent-ink); font-size: 48px; font-weight: bold; }
        .pm .wname { font-size: 22px; font-weight: bold; }
        .pm .lv { width: 100%; display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .pm .gauge { position: relative; flex: 1; height: 16px; background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: 999px; overflow: hidden; }
        .pm .gauge i { position: absolute; inset: 0 auto 0 0; background: var(--pm-accent); border-radius: 999px; }
        .pm .gauge em { position: relative; display: block; text-align: center; font-size: 11px; font-style: normal; font-weight: bold; line-height: 16px; }
        .pm .tok { font-size: 15px; }
        .pm .sdmain { display: grid; gap: 14px; min-width: 0; }
        .pm .tline { list-style: none; margin: 0; padding: 4px 0 0; display: grid; grid-template-columns: repeat(9, 1fr); position: relative; }
        .pm .tline::before { content: ''; position: absolute; left: 5%; right: 5%; top: 19px; height: 4px; background: var(--pm-line); border-radius: 2px; }
        .pm .tline li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: var(--pm-muted); }
        .pm .tline .dotn { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: var(--pm-surface2); border: 2px solid var(--pm-line); color: var(--pm-muted); font-weight: bold; font-size: 14px; }
        .pm .tline li.has .dotn { background: color-mix(in srgb, var(--sc) 30%, var(--pm-surface)); border-color: var(--sc); color: var(--pm-ink); }
        .pm .tline li.has .tl { color: var(--pm-ink); }
        .pm .tline li.cur .dotn { background: var(--sc); color: var(--pm-surface); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sc) 35%, transparent); }
        .pm .nowgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; } .pm .nowgrid > div + div { border-left: 2px solid var(--pm-line); padding-left: 16px; }
        .pm .heat { display: grid; gap: 3px; }
        .pm .hrow { display: grid; grid-template-columns: 44px repeat(13, 1fr); gap: 3px; align-items: center; font-size: 11px; }
        .pm .hrow i { position: relative; display: block; aspect-ratio: 1; border-radius: calc(var(--pm-radius) / 3); background: var(--pm-surface2); border: 1px solid var(--pm-line); }
        .pm .hrow i::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--pm-accent); opacity: var(--hv, 0); }
        .pm .hhead span { text-align: center; color: var(--pm-muted); }
        .pm .sdside { display: grid; gap: 14px; }
        .pm .bonus .bitem { display: flex; gap: 8px; align-items: center; padding: 6px; margin-top: 6px; background: var(--pm-surface2); border-radius: var(--pm-radius); }
        .pm .bonus .bic { font-size: 24px; }
        .pm .pmk-btn.bigbtn { min-height: 76px; font-size: 22px; font-weight: bold; border-radius: calc(var(--pm-radius) + 10px); border: 2px solid var(--pm-line); box-shadow: var(--pm-shadow); display: flex; align-items: center; justify-content: center; gap: 10px; }
        .pm .pmk-btn.shopb { background: color-mix(in srgb, var(--pm-accent2) 45%, var(--pm-surface)); color: var(--pm-ink); }
        .pm .pmk-btn.lookb { background: color-mix(in srgb, var(--pm-accent) 40%, var(--pm-surface)); color: var(--pm-ink); }
        .pm .pmk-btn.bigbtn span { font-size: 30px; }
        .pm .small { font-size: 11px; }
        .pm .sdpage .sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .pm .sdpage .sum div { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px; text-align: center; }
        .pm .sdpage .sum b { display: block; font-size: 20px; } .pm .sdpage .sum span { font-size: 11px; color: var(--pm-muted); }
        .pm .sdpage .card { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 10px; margin-top: 8px; }
        .pm .sdpage .wt { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .pm .sdpage .pill, .pm .sdpage .basis, .pm .sdpage .pipe span { font-size: 11px; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: 999px; padding: 0 6px; color: var(--pm-ink); }
        .pm .sdpage .pipe { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0; } .pm .sdpage .pipe span.done { background: var(--pm-accent); color: var(--pm-accent-ink); border-color: var(--pm-accent); }
        .pm .sdpage .save, .pm .sdpage .a-anchored, .pm .sdpage .b-erp-verified { background: var(--pm-ok-bg); color: var(--pm-ok-ink); }
        .pm .sdpage .b-estimated, .pm .sdpage .pill.est, .pm .sdpage .a-erp { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .pm .sdpage .save { font-size: 12px; font-weight: bold; border-radius: 999px; padding: 0 7px; }
        .pm .sdpage .bar, .pm .sdpage .hbt, .pm .sdpage .stack { height: 10px; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: 999px; overflow: hidden; }
        .pm .sdpage .bar i, .pm .sdpage .hbt i { display: block; height: 100%; background: var(--pm-accent); }
        .pm .sdpage .stack { display: flex; height: 18px; } .pm .sdpage .stack i { display: block; height: 100%; min-width: 2px; }
        .pm .sdpage .kv { margin-top: 4px; } .pm .sdpage .kv ul { margin: 2px 0 0 18px; padding: 0; }
        .pm .sdpage .steps { margin: 6px 0 0; padding: 0; list-style: none; } .pm .sdpage .steps li { border-top: 1px solid var(--pm-line); padding: 6px 0; }
        .pm .sdpage .ex { font-size: 12px; background: var(--pm-surface); padding: 2px 6px; border-radius: 4px; margin-top: 2px; word-break: break-word; }
        .pm .sdpage .cand { margin: 0; padding-left: 20px; }
        .pm .sdpage .legend { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
        .pm .sdpage .sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: middle; }
        .pm .sdpage .hbars { display: grid; gap: 4px; }
        .pm .sdpage .hb { display: grid; grid-template-columns: minmax(0, 40%) 1fr 48px; gap: 6px; align-items: center; font-size: 12px; }
        .pm .sdpage .hbn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .pm .sdpage .hbv { text-align: right; font-weight: bold; }
        .pm .sdpage .dry { margin-top: 8px; } .pm .sdpage .dryres { margin-top: 6px; padding: 6px 8px; border-radius: var(--pm-radius); font-size: 12px; }
        .pm .sdpage .dryres.ok { background: var(--pm-ok-bg); color: var(--pm-ok-ink); } .pm .sdpage .dryres.bad, .pm .sdpage .warn { background: var(--pm-err-bg); color: var(--pm-err-ink); }
        /* 상점·꾸미기 — 게임급 리스킨(2026-11-05 사장님 "진짜 게임 수준으로"): 아라곤 배경 아트 + 유리판 패널 */
        .pm .shop { background: url('/pm/shop/bg/stage-beach.webp') center / cover no-repeat, var(--pm-room); border-radius: 22px; padding: 14px; box-shadow: var(--pm-shadow); }
        .pm .shop .shead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .pm .shop .shead h2 { margin: 0; font-size: 19px; padding: 8px 18px; background: var(--pm-est-bg); color: var(--pm-est-ink); border: 2px solid color-mix(in srgb, var(--pm-est-ink) 35%, var(--pm-est-bg)); border-radius: 999px; box-shadow: 0 4px 0 color-mix(in srgb, var(--pm-est-ink) 40%, var(--pm-est-bg)), var(--pm-shadow); }
        .pm .wpill { margin-left: auto; padding: 6px 16px; font-size: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--pm-est-bg) 80%, white), var(--pm-est-bg)); color: var(--pm-est-ink); border: 2px solid color-mix(in srgb, var(--pm-est-ink) 35%, var(--pm-est-bg)); border-radius: 999px; box-shadow: 0 3px 0 color-mix(in srgb, var(--pm-est-ink) 40%, var(--pm-est-bg)); font-weight: 800; }
        .pm .sgrid { display: grid; grid-template-columns: 300px minmax(0, 1fr) 230px; gap: 14px; align-items: start; }
        .pm .sitems, .pm .sside { background: color-mix(in srgb, var(--pm-surface) 82%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 2px solid color-mix(in srgb, var(--pm-surface) 55%, transparent); border-radius: 18px; padding: 12px; box-shadow: var(--pm-shadow); }
        .pm .sstage { background: color-mix(in srgb, var(--pm-surface) 68%, transparent); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); border: 2px solid color-mix(in srgb, var(--pm-surface) 50%, transparent); border-radius: 18px; padding: 12px; }
        .pm .stagebox { position: relative; display: grid; place-items: center; height: 240px; border-radius: var(--pm-radius); background: radial-gradient(circle at 50% 40%, var(--pm-surface), var(--pm-surface2) 70%); overflow: hidden; }
        .pm .stagebox .pav { z-index: 1; }
        /* 3D 렌더 미리보기(종족 베이스 + 장착 레이어 겹침, components/pm/PmTheme.js Render3DPreview) */
        .pm .r3d { margin-top: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .pm .r3dstack { position: relative; width: 170px; height: 170px; border-radius: var(--pm-radius); background: radial-gradient(circle at 50% 42%, var(--pm-surface), var(--pm-surface2) 72%); border: 2px solid var(--pm-line); overflow: hidden; }
        /* 피팅룸(디자인 자문): 3D 렌더가 주인공 — 좌측 폭을 꽉 채우고, 단상 그림자 타원으로 "서 있는" 공간감 */
        /* 게임급: 피팅룸 캐릭터가 배경 아트의 무대·받침대 위에 바로 서게 — 프레임 없는 투명 스택 */
        .pm .r3dbig .r3dstack { width: 100%; max-width: 276px; height: auto; aspect-ratio: 1; background: transparent; border: 0; overflow: visible; }
        /* 발밑 받침 원반 + 그림자 — 캐릭터가 허공에 뜨지 않게(배경 아트 어디에서도 성립) */
        .pm .r3dbig .r3dstack::before { content: ''; position: absolute; left: 50%; bottom: 3%; width: 72%; height: 14%; transform: translateX(-50%); border-radius: 50%; background: linear-gradient(180deg, color-mix(in srgb, var(--pm-est-bg) 70%, white), color-mix(in srgb, var(--pm-est-bg) 70%, var(--pm-est-ink))); box-shadow: 0 6px 0 color-mix(in srgb, var(--pm-est-ink) 45%, var(--pm-est-bg)), 0 12px 16px color-mix(in srgb, var(--pm-ink) 25%, transparent); }
        .pm .r3dbig .r3dstack::after { content: ''; position: absolute; left: 50%; bottom: 8%; width: 52%; height: 7%; transform: translateX(-50%); border-radius: 50%; background: radial-gradient(ellipse at center, color-mix(in srgb, var(--pm-ink) 22%, transparent), transparent 70%); }
        .pm .r3dbig .r3dstack img { inset: 0 0 8% 0; height: 92%; z-index: 1; }
        .pm .pc2stage { zoom: .9; opacity: .95; }
        .pm .r3dstack img { position: absolute; inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px); object-fit: contain; }
        .pm .r3dstack img.r3dm { inset: auto 4px 4px auto; width: 56px; height: 56px; }
        .pm .pedestal { position: absolute; bottom: 22px; left: 50%; width: 170px; height: 34px; transform: translateX(-50%); border-radius: 50%; background: color-mix(in srgb, var(--pm-accent) 30%, var(--pm-surface2)); box-shadow: 0 6px 0 color-mix(in srgb, var(--pm-accent) 50%, var(--pm-line)); }
        .pm .czst { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; justify-content: center; }
        .pm .slots { gap: 4px; }
        .pm .slots .pmk-tab { flex: 1 0 30%; min-height: 40px; font-size: 12px; background: var(--pm-surface2); border: 2px solid var(--pm-line); border-radius: var(--pm-radius); }
        .pm .slots .pmk-tab.on { background: var(--pm-accent); color: var(--pm-accent-ink); border-color: var(--pm-accent); }
        .pm .sitems { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
        .pm .sitem { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; min-height: 132px; background: color-mix(in srgb, var(--pm-surface) 94%, transparent); color: var(--pm-ink); border: 2px solid var(--pm-line); border-radius: 16px; font-size: 11px; transition: transform .12s ease, box-shadow .12s ease; }
        .pm .sitem:hover { transform: translateY(-3px); box-shadow: 0 8px 14px color-mix(in srgb, var(--pm-ink) 14%, transparent); }
        /* 등급색 테두리(게임급): 희귀 = 라벤더 링, 전설 = 금테 + 은은한 금빛 바탕 */
        .pm .sitem:has(.czr.r-rare) { border-color: var(--pm-dept3); box-shadow: 0 0 0 1px color-mix(in srgb, var(--pm-dept3) 55%, transparent); }
        .pm .sitem:has(.czr.r-legendary) { border-color: color-mix(in srgb, var(--pm-est-ink) 45%, var(--pm-est-bg)); background: linear-gradient(180deg, color-mix(in srgb, var(--pm-est-bg) 35%, var(--pm-surface)), var(--pm-surface)); box-shadow: 0 0 10px color-mix(in srgb, var(--pm-est-bg) 70%, transparent); }
        .pm .sitem img { width: 72px; height: 72px; object-fit: contain; background: radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--pm-est-bg) 75%, var(--pm-surface)) 0 46%, transparent 50%); border-radius: 50%; }
        /* [2026-11-06 사장님 신고 "원래 색값이 안 나옴"] 상점 렌더 이미지에 3D 사무실 캔버스와 같은 채도 보정(lib/pmThemes RENDER.canvasFilter) — 썸네일·피팅룸·상세가 사무실 실물 색과 일치 */
        .pm .sitem img, .pm .r3dstack img, .pm .sdetail .dimg img { filter: saturate(1.24) contrast(1.04); }
        /* 잠긴 상품(디자인 자문): 시커먼 박스 → 밝은 반투명 덮개 + 중앙 자물쇠(오류가 아니라 '갖고 싶은 것'으로) */
        .pm .sitem.lock.poor { background: color-mix(in srgb, var(--pm-surface) 55%, var(--pm-surface2)); color: var(--pm-muted); }
        .pm .sitem.lock.poor img { filter: grayscale(.45) opacity(.75); }
        .pm .sitem .padlock { position: absolute; top: 34%; left: 50%; transform: translate(-50%, -50%); font-size: 22px; filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--pm-ink) 30%, transparent)); }
        .pm .sitem.on { border-color: var(--pm-accent); outline: 2px solid var(--pm-accent); }
        .pm .sitem .eq { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; background: var(--pm-ok); color: var(--pm-accent-ink); font-size: 12px; display: grid; place-items: center; }
        .pm .sitem small.czr { background: color-mix(in srgb, var(--pm-accent) 14%, var(--pm-surface)); border-radius: 999px; padding: 1px 8px; font-weight: 700; }
        .pm .iname { font-weight: bold; text-align: center; }
        .pm .czr { font-size: 10px; border-radius: 999px; padding: 0 6px; background: var(--pm-surface); color: var(--pm-ink); border: 1px solid var(--pm-line); }
        .pm .czr.r-rare { background: color-mix(in srgb, var(--pm-accent) 25%, var(--pm-surface)); } .pm .czr.r-legendary { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .pm .sside { display: flex; flex-direction: column; gap: 8px; }
        .pm .sdetail { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
        .pm .sdetail .dimg { width: 100%; aspect-ratio: 1; display: grid; place-items: center; background: var(--pm-surface2); border-radius: var(--pm-radius); }
        .pm .sdetail img { width: 70%; height: 70%; object-fit: contain; }
        /* 젤리 버튼(게임급): 아래 두툼한 그림자 + 누르면 쑥 들어감 */
        .pm .pmk-btn.big { min-height: 48px; font-size: 15px; border-radius: 999px; box-shadow: 0 5px 0 var(--pm-accent-down), var(--pm-shadow); }
        .pm .pmk-btn.big:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--pm-accent-down); }
        .pm .pmk-btn.buy { background: var(--pm-accent2); color: var(--pm-accent-ink); border-color: var(--pm-accent2); box-shadow: 0 5px 0 color-mix(in srgb, var(--pm-accent2) 60%, var(--pm-ink)), var(--pm-shadow); }
        .pm .slots .pmk-tab { border-radius: 999px; background: color-mix(in srgb, var(--pm-surface) 88%, transparent); }
        .pm .srow { display: flex; gap: 6px; } .pm .srow .pmk-btn { flex: 1; border-radius: 999px; }
        .pm .czmsg { font-size: 12px; margin: 0; }
        .pm .shist { margin-top: 10px; }
        .pm .wal .sum { display: flex; gap: 10px; } .pm .wal .sum div { flex: 1; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px; text-align: center; }
        .pm .wal .sum b { display: block; font-size: 18px; } .pm .wal .sum span { font-size: 11px; color: var(--pm-muted); }
        .pm .walh { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 12px; } .pm .walh li { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 4px 8px; }
        @media (max-width: 1000px) { .pm .sdgrid, .pm .sgrid { grid-template-columns: 1fr; } .pm .nowgrid { grid-template-columns: 1fr; } .pm .nowgrid > div + div { border-left: 0; padding-left: 0; } }
        @media (max-width: 640px) { .pm .chain { grid-template-columns: 1fr; gap: 2px; } .pm .clink { flex-basis: 22px; } .pm .clink svg { width: 22px; } .pm .cnode .cd { display: none; } .pm .chrow { flex-wrap: wrap; row-gap: 6px; } .pm .chseg { flex: 0 0 50%; } .pm .clink .cn i { display: none; } .pm .tline .tl { display: none; } .pm .drawer-back { padding: 0; } .pm .sdpage { max-height: 100vh; border-radius: 0; } }
        @media (max-width: 640px) { .pm .corridor { grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); } .pm { padding: 0 8px 20px; } .pm .top { margin: 0 -8px 10px; } .pm .seat { width: 104px; flex-basis: 104px; } }
        @media (prefers-reduced-motion: reduce) { .pm .flows circle { display: none; } }
        @media (max-width: 860px) { .pm .wrap { grid-template-columns: 1fr; } .pm .wing { grid-template-columns: 1fr; } .pm .mgr, .pm .lab { flex: 1 1 100%; } .pm .feed { max-height: none; } }
      `}</style>
      <style jsx global>{`
        .sprite { position: relative; width: 64px; height: 64px; margin: 0 auto; image-rendering: pixelated; }
        .sprite .head { position: absolute; left: 22px; top: 4px; width: 20px; height: 18px; }
        .sprite .hair { position: absolute; left: 0; top: -2px; width: 20px; height: 6px; background: var(--pm-hair); }
        .sprite .antenna { position: absolute; left: 9px; top: -6px; width: 2px; height: 6px; background: var(--pm-muted); }
        .sprite .antenna:after { content: ''; position: absolute; left: -2px; top: -4px; width: 6px; height: 4px; background: var(--pm-err); }
        .sprite .eyes { position: absolute; left: 4px; top: 8px; width: 3px; height: 3px; background: var(--pm-ink); box-shadow: 9px 0 0 var(--pm-ink); }
        .sprite .body { position: absolute; left: 18px; top: 22px; width: 28px; height: 18px; }
        .sprite .desk { position: absolute; left: 0; top: 38px; width: 64px; height: 26px; background: var(--pm-desk-wood); border-top: 4px solid var(--pm-desk-top); }
        .sprite .monitor { position: absolute; left: 4px; top: -22px; width: 18px; height: 14px; background: var(--pm-monitor); padding: 2px; }
        .sprite .screen { width: 100%; height: 100%; background: var(--pm-screen); }
        .sprite .kb { position: absolute; left: 24px; top: 2px; width: 20px; height: 4px; background: var(--pm-surface2); }
        .sprite .hand { position: absolute; top: -3px; width: 5px; height: 4px; background: var(--pm-skin); }
        .sprite .hand.l { left: 2px; } .sprite .hand.r { left: 13px; }
        .sprite.st-working .screen { background: var(--pm-screen-on); animation: pmscr 1.2s steps(2) infinite; }
        .sprite.st-working .hand.l { animation: pmtype .3s steps(2) infinite; }
        .sprite.st-working .hand.r { animation: pmtype .3s steps(2) infinite .15s; }
        .sprite.st-idle .head { top: 8px; } .sprite.st-idle .eyes { height: 1px; }
        .sprite.st-off .head, .sprite.st-off .body, .sprite.st-off .hand { visibility: hidden; }
        .sprite.st-off .screen { background: var(--pm-monitor); }
        .sprite.st-error .screen { background: var(--pm-err); animation: pmscr .6s steps(2) infinite; }
        .sprite .zzz { position: absolute; right: 2px; top: -4px; color: var(--pm-accent); font: bold 10px monospace; animation: pmz 2s ease-in-out infinite; }
        .sprite .zzz span { font-size: 12px; } .sprite .zzz b { font-size: 14px; }
        .sprite .bang { position: absolute; right: 4px; top: -6px; width: 14px; height: 18px; background: var(--pm-err); color: var(--pm-accent-ink); font: bold 14px monospace; line-height: 18px; animation: pmbang .8s steps(2) infinite; }
        @keyframes pmtype { 50% { transform: translateY(-2px); } }
        @keyframes pmscr { 50% { filter: brightness(1.4); } }
        @keyframes pmz { 0% { opacity: 0; transform: translateY(4px); } 50% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
        @keyframes pmbang { 50% { opacity: .3; } }
        @media (prefers-reduced-motion: reduce) { .sprite * { animation: none !important; } }
        .pav { position: relative; display: inline-block; flex: none; vertical-align: middle; }
        .pav img, .pav .pbody { position: absolute; inset: 0; width: 100%; height: 100%; }
        /* 아이템은 단독 아이콘(Higgsfield 생성)이라 캐릭터 위 자리를 부위별로 잡는다 */
        .pav .pbody { z-index: 1; } .pav img.it { inset: auto; object-fit: contain; }
        .pav img.it-hat { width: 56%; height: 56%; left: 22%; top: -16%; }
        .pav img.it-glasses { width: 44%; height: 44%; left: 28%; top: 14%; }
        .pav img.it-outfit { width: 52%; height: 52%; left: 24%; top: 50%; }
        .pav img.it-badge { width: 18%; height: 18%; left: 52%; top: 62%; }
        .pav img.it-desk { width: 34%; height: 34%; right: -10%; bottom: -2%; z-index: 2; }
        .pav img.it-pet { width: 34%; height: 34%; left: -12%; bottom: -2%; z-index: 2; }
        .sprite .sav { position: absolute; left: 12px; top: -1px; }
        .pav.pmc-working .pbody { animation: pmcw .5s steps(2) infinite; }
        .pav.pmc-idle .pbody { transform-origin: 50% 100%; animation: pmci 3s ease-in-out infinite; }
        .pav.pmc-off { filter: grayscale(1) brightness(.7); }
        .pav.pmc-error .pbody { animation: pmce .25s linear infinite; }
        .pav.pmc-handoff .pbody { animation: pmch .6s steps(2) infinite; }
        @keyframes pmcw { 50% { transform: translateY(-1.5px); } }
        @keyframes pmci { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes pmce { 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); } }
        @keyframes pmch { 0% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-2px) rotate(4deg); } }
        @media (prefers-reduced-motion: reduce) { .pav, .pav * { animation: none !important; } }
      `}</style>
    </div>
    </GrowProvider>
    </PmThemeCtx.Provider>
  );
}
