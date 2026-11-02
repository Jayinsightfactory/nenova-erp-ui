// pages/pm.js
// PM 사무실 — AI 에이전트·직원을 픽셀 사무실 책상으로 보여주는 실시간 화면(20초 폴링).
// 데이터: GET /api/pm/office (사장님 PC 가 ~1분마다 name=pm-office 로 올리는 runtime JSON). 읽기 전용.
// 디자인 영감: pablodelucca/pixel-agents (픽셀 사무실 캐릭터). 에셋·코드는 가져오지 않고 CSS 박스 스프라이트로 직접 그렸다.
import { useEffect, useState } from 'react';
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

function Desk({ name, sub, status, activity, lastAt, now, robot, extra }) {
  const st = STATUS_LABEL[status] ? status : 'off';
  return (
    <div className={`deskcard d-${st}`} title={activity || ''}>
      {activity && st !== 'off' ? <div className="bubble">{activity}</div> : <div className="bubble empty">{st === 'off' ? '자리 비움' : '…'}</div>}
      <Sprite status={st} color={hashColor(name)} robot={robot} />
      <div className="nm">{name || '?'}</div>
      <div className="meta"><span className={`dot dot-${st}`} />{STATUS_LABEL[st]}{sub ? ` · ${sub}` : ''}</div>
      <div className="meta">{ago(lastAt, now)}{extra ? ` · ${extra}` : ''}</div>
    </div>
  );
}

export default function PmOffice() {
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/pm/office', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
        setResp(j); setErr('');
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
  const depts = {};
  for (const s of staff) (depts[s.dept || '기타'] ||= []).push(s);
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
      {!resp && !err && <p className="muted">불러오는 중…</p>}
      {resp && !resp.data && <p className="muted">아직 올라온 pm-office 데이터가 없습니다.</p>}
      <div className="wrap">
        <main className="floor">
          <section className="zone">
            <h2>AI 팀 <small>{agents.length}명</small></h2>
            <div className="desks">
              {agents.map((a) => (
                <Desk key={a.id || a.name} robot name={a.name || a.id} sub={a.role} status={a.status} activity={a.activity} lastAt={a.lastAt} now={now}
                  extra={a.today?.done != null ? `오늘 ${a.today.done}건` : ''} />
              ))}
            </div>
          </section>
          <section className="zone">
            <h2>직원 <small>{staff.length}명</small></h2>
            {Object.entries(depts).map(([dept, list]) => (
              <div key={dept} className="dept">
                <h3>{dept}</h3>
                <div className="desks">
                  {list.map((s) => (
                    <Desk key={s.name} name={s.name} sub={s.app} status={s.status} activity={s.app ? `${s.app} 사용 중` : ''} lastAt={s.lastAt} now={now}
                      extra={s.events15m != null ? `15분 ${s.events15m}건` : ''} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        </main>
        <aside className="side">
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
      <p className="credit">픽셀 사무실 아이디어: pablodelucca/pixel-agents (그림은 직접 제작)</p>
      <style jsx>{`
        .pm { min-height: 100vh; background: #1e2230; color: #e8ebf2; padding: 12px 16px 24px; font-size: 13px; }
        .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
        h1 { font-size: 18px; margin: 0 6px 0 0; }
        .badge { padding: 3px 9px; border-radius: 10px; font-size: 12px; background: #2f3548; }
        .badge.shadow { background: #4b4f63; } .badge.live { background: #1f8f4f; }
        .badge.warn { background: #b8452f; }
        .muted { color: #9aa3b8; }
        .wrap { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; }
        .floor { background: repeating-conic-gradient(#2a3042 0 25%, #262b3c 0 50%) 0 0 / 32px 32px; border: 4px solid #3a4158; border-radius: 6px; padding: 12px; }
        .zone + .zone { margin-top: 16px; border-top: 4px dashed #3a4158; padding-top: 12px; }
        h2 { font-size: 14px; margin: 0 0 8px; } h3 { font-size: 12px; margin: 8px 0 6px; color: #c7cde0; }
        small { color: #9aa3b8; font-weight: normal; }
        .desks { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
        .deskcard { background: rgba(20, 23, 34, .75); border: 2px solid #3a4158; border-radius: 4px; padding: 6px; text-align: center; position: relative; }
        .deskcard.d-off { opacity: .45; filter: grayscale(.8); }
        .deskcard.d-error { border-color: #e0483a; }
        .deskcard.d-working { border-color: #3fbf7f; }
        .bubble { background: #fff; color: #222; border-radius: 6px; padding: 3px 6px; font-size: 11px; min-height: 30px; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-align: left; position: relative; margin-bottom: 6px; }
        .bubble:after { content: ''; position: absolute; left: 50%; bottom: -5px; border: 5px solid transparent; border-top-color: #fff; border-bottom: 0; }
        .bubble.empty { background: #3a4158; color: #9aa3b8; } .bubble.empty:after { border-top-color: #3a4158; }
        .nm { font-weight: bold; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .meta { font-size: 11px; color: #9aa3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dot { display: inline-block; width: 7px; height: 7px; margin-right: 4px; background: #666; }
        .dot-working { background: #3fbf7f; } .dot-idle { background: #ffcc3f; } .dot-error { background: #e0483a; }
        .panel { background: #262b3c; border: 2px solid #3a4158; border-radius: 4px; padding: 10px; margin-bottom: 12px; }
        .tg h3 { border-left: 4px solid #666; padding-left: 6px; }
        .tg-approval { border-color: #e0483a !important; } .tg-day3 { border-color: #ff8a4f !important; } .tg-investigate { border-color: #4f8cff !important; } .tg-verify { border-color: #3fbf7f !important; }
        .task { background: #1e2230; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; line-height: 1.4; }
        .tk { font-weight: bold; word-break: break-all; } .days { margin-left: 6px; background: #b8452f; padding: 0 5px; border-radius: 6px; font-size: 11px; }
        .dec { color: #ffcc3f; }
        .feed { max-height: 60vh; overflow-y: auto; }
        .msg { background: #1e2230; border-radius: 10px 10px 10px 2px; padding: 6px 9px; margin-bottom: 6px; }
        .mh { font-size: 11px; } .mt { margin-left: 6px; background: #3a4158; padding: 0 5px; border-radius: 6px; }
        .mb { margin-top: 2px; line-height: 1.4; word-break: break-word; }
        .credit { margin-top: 12px; font-size: 11px; color: #6f7890; }
        @media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } .desks { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); } .feed { max-height: none; } }
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
