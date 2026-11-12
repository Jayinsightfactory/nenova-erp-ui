// components/manuals/RoutineManual.js — /work/manuals "신입 루틴" 뷰.
//   부서 탭 → 신입 첫 주 순서(읽음 체크) · 하루 타임라인(시간축) · 주간 7칸 · 월간 체크리스트 · 메일함 가이드 · 부서간 넘김.
//   현장팀 탭은 업무방 카톡 기반 추정. 색은 /pm 토큰(var(--pm-*))만 — hex 금지(__tests__/workManualRoutines.test.js).
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, PmUiStyles, Tabs, ToggleChip } from '../pm/ui';
import { allThemesCss, readStoredTheme } from '../../lib/pmThemes';

const CONF = { high: ['높음', 'ok'], medium: ['보통', 'idle'], low: ['낮음', 'off'], estimate: ['추정', 'est'] };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const H0 = 7, H1 = 21;
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const READ_KEY = (dept) => `wm.routine.read.${dept}`;

export function readChecks(dept) {
  try { return JSON.parse(window.localStorage.getItem(READ_KEY(dept)) || '{}') || {}; } catch { return {}; }
}
function writeChecks(dept, v) {
  try { window.localStorage.setItem(READ_KEY(dept), JSON.stringify(v)); } catch { /* 저장 불가(사생활 모드) — 이번 화면만 */ }
}

function Evidence({ it, kakao }) {
  const ev = it.evidence || {};
  const [label, tone] = CONF[it.confidence] || CONF.estimate;
  const parts = [];
  if (ev.count != null) parts.push(`근거 ${ev.count}건`);
  if (it.messages != null) parts.push(`메시지 ${it.messages}건`);
  if (ev.days != null) parts.push(`${ev.of ? `${ev.of}일 중 ` : ''}${ev.days}일`);
  else if (it.days != null) parts.push(`${it.days}일 관측`);
  const last = ev.lastSeen || it.lastSeen;
  if (last) parts.push(`최신 ${last.slice(5)}`);
  return (
    <span className="ev">
      {kakao && <Badge tone="est">카톡 기반 추정</Badge>}
      <Badge tone={tone}>신뢰도 {label}</Badge>
      <small>{parts.join(' · ') || '근거 없음'}</small>
    </span>
  );
}

function Confirm({ it, onConfirm }) {
  const c = it.confirm;
  if (c) {
    return (
      <span className="cf">
        <Badge tone={c.status === 'confirmed' ? 'ok' : 'err'}>{c.status === 'confirmed' ? '직원 확인' : '틀림 표시'} · {c.by}</Badge>
        <Button size="sm" variant="ghost" onClick={() => onConfirm(it.id, 'clear')}>되돌리기</Button>
      </span>
    );
  }
  return (
    <span className="cf">
      <Button size="sm" onClick={() => onConfirm(it.id, 'confirmed')}>맞아요</Button>
      <Button size="sm" variant="ghost" onClick={() => onConfirm(it.id, 'wrong')}>틀려요</Button>
    </span>
  );
}

const what = (it) => [it.app, it.stage].filter(Boolean).join(' · ') + (it.task ? ` — ${it.task}` : '');

function Timeline({ person, onConfirm }) {
  const span = (H1 - H0) * 60;
  if (!person.daily?.length) return <p className="empty">하루 루틴 근거가 부족합니다(관측 {person.observedDays || 0}일).</p>;
  return (
    <div className="tl">
      <div className="axis" aria-hidden>
        {Array.from({ length: H1 - H0 + 1 }).map((_, i) => <span key={i} style={{ left: `${(i * 60 / span) * 100}%` }}>{H0 + i}</span>)}
        {person.daily.map((d) => (
          <i key={d.id} className={`bar c-${d.confidence}`} title={`${d.from}~${d.to} ${what(d)}`}
            style={{ left: `${((toMin(d.from) - H0 * 60) / span) * 100}%`, width: `${Math.max(1.5, ((toMin(d.to) - toMin(d.from)) / span) * 100)}%` }} />
        ))}
      </div>
      <ol className="rows">
        {person.daily.map((d) => (
          <li key={d.id}>
            <b className="time">{d.from}~{d.to}</b>
            <span className="what">{what(d)}</span>
            <Evidence it={d} />
            <Confirm it={d} onConfirm={onConfirm} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function WeekGrid({ dept, onConfirm }) {
  const { cells, all } = useMemo(() => {
    const m = Object.fromEntries(WEEK_ORDER.map((w) => [w, []]));
    const list = [];
    for (const p of dept.people || []) for (const w of p.weekly || []) list.push({ ...w, who: p.name });
    list.sort((a, b) => b.evidence.days - a.evidence.days || b.lift - a.lift);
    for (const w of list) m[w.weekday].push(w);
    return { cells: m, all: list };
  }, [dept]);
  const fixed = (w) => (dept.fixedWeekly || []).filter((f) => f.weekday === w);
  return (
    <>
      <div className="week">
        {WEEK_ORDER.map((w) => (
          <div key={w} className="day">
            <h4>{WD[w]}</h4>
            {fixed(w).map((f, i) => <div key={i} className="wk fixed"><b>{f.time} {f.what}</b></div>)}
            {cells[w].length === 0 && !fixed(w).length && <p className="empty">특이 업무 없음</p>}
            {cells[w].slice(0, 4).map((x) => (
              <div key={x.id} className="wk" title={`${x.who} ${what(x)} · 평소의 ${x.lift}배`}>
                <b>{x.who}</b> {String(x.peakHour).padStart(2, '0')}시 {x.stage || x.app}
                <small className="muted"> {x.evidence.days}/{x.evidence.of}주</small>
              </div>
            ))}
            {cells[w].length > 4 && <small className="muted">+{cells[w].length - 4}건 (아래 목록)</small>}
          </div>
        ))}
      </div>
      {all.length > 0 && (
        <details className="wkd">
          <summary>요일별 특이 업무 전체 {all.length}건 · 확인하기</summary>
          <ul className="month">
            {all.map((x) => (
              <li key={x.id}>
                <Badge tone="plain">{x.weekdayName}</Badge> <b>{x.who}</b> {String(x.peakHour).padStart(2, '0')}시경 {what(x)} <small className="muted">평소의 {x.lift}배</small>
                <Evidence it={x} />
                <Confirm it={x} onConfirm={onConfirm} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Monthly({ dept, onConfirm }) {
  const items = (dept.people || []).flatMap((p) => (p.monthly || []).map((m) => ({ ...m, who: p.name })));
  if (!items.length) return <p className="empty">월초·월말에 몰리는 업무 근거가 없습니다.</p>;
  return (
    <ul className="month">
      {items.map((m) => (
        <li key={m.id}>
          <Badge tone="plain">{m.when}</Badge> <b>{m.who}</b> {what(m)}
          <Evidence it={m} />
          {m.evidence?.months < 2 && <small className="muted">관측 {m.evidence.months}개월 — 다음 달 재확인</small>}
          <Confirm it={m} onConfirm={onConfirm} />
        </li>
      ))}
    </ul>
  );
}

function MailTable({ dept, onConfirm }) {
  const rows = (dept.people || []).flatMap((p) => (p.mail || []).map((m) => ({ ...m, who: p.name })));
  if (!rows.length) return <p className="empty">이 부서 PC에서 메일 화면 관측이 없습니다(메일 대신 카톡·메신저로 받는 부서일 수 있음).</p>;
  return (
    <div className="tblwrap">
      <table className="tbl">
        <thead><tr><th>메일 유형(발신)</th><th>제목에 자주 나오는 말</th><th>첨부</th><th>다음 행동(쓰는 화면)</th><th>담당</th><th>근거</th><th /></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td><b>{m.sender}</b></td>
              <td>{m.subjectKeywords.join(', ') || '-'}</td>
              <td>{m.attachments.join(', ') || '-'}</td>
              <td>{m.nextAction || '다음 화면 관측 없음'}{m.nextActionShare ? <small className="muted"> ({m.nextActionShare}%)</small> : null}</td>
              <td>{m.who}</td>
              <td><Evidence it={m} /></td>
              <td><Confirm it={m} onConfirm={onConfirm} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Handoffs({ dept }) {
  if (!dept.handoffs?.length) return null;
  return (
    <ul className="hand">
      {dept.handoffs.map((h, i) => (
        <li key={i}><b>{h.from}</b> → <b>{h.to}</b> : {h.what} <small className="muted">({h.via})</small></li>
      ))}
      <li className="muted"><small>넘김 사슬은 사장님 정의(2026-11-03) 기준</small></li>
    </ul>
  );
}

function FieldTeam({ field }) {
  if (!field) return <p className="empty">현장팀 카톡 데이터가 아직 없습니다.</p>;
  const cal = (list) => (
    <div className="week">
      {WEEK_ORDER.map((w) => {
        const hits = list.filter((x) => x.weekdays.includes(WD[w]));
        return (
          <div key={w} className="day">
            <h4>{WD[w]}</h4>
            {hits.length === 0 && <p className="empty">-</p>}
            {hits.map((x) => <div key={x.key} className="wk"><b>{x.key}</b>{x.area ? <small className="muted"> {x.area}</small> : null} <small>{x.peakHour}시경 · {x.days}일</small></div>)}
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      <p className="note">
        <Badge tone="est">카톡 기반 추정</Badge> 현장팀은 PC 데이터가 없어 업무방 카톡({field.rooms.join(', ')}) {field.messages}건({field.period.from}~{field.period.to}, {field.period.days}일)으로만 추정했습니다. 원문·연락처·금액은 넣지 않았습니다.
      </p>
      <h3>직원별 예상 루틴</h3>
      <div className="cards">
        {field.staff.map((s) => (
          <div key={s.name} className="card">
            <b>{s.name}</b> <Evidence it={s} kakao />
            <p>바쁜 시간 {s.busyHours.join('·')} / 자주 나오는 요일 {s.busyWeekdays.join('·')}</p>
            <p>주로 하는 일: {s.mainTypes.map((t) => `${t.type} ${t.share}%`).join(', ')}</p>
          </div>
        ))}
      </div>
      <h3>거래처별 출고 캘린더 <small className="muted">(배차·출고 메시지에 간판명이 나온 요일, 2일 이상)</small></h3>
      {cal(field.customerSchedule.slice(0, 20))}
      <h3>지역별 출고 캘린더</h3>
      {cal(field.regionSchedule)}
      <h3>검역·소독·통관·도착 일정</h3>
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th>종류</th><th>주기</th><th>자주 나오는 요일</th><th>시각</th><th>근거</th></tr></thead>
          <tbody>
            {field.inspectionSchedule.map((x) => (
              <tr key={x.type}><td><b>{x.type}</b></td><td>{x.cadence}</td><td>{x.weekdays.join('·')}</td><td>{x.peakHour}시경</td><td><Evidence it={x} kakao /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>신입이 카톡방에서 확인할 것</h3>
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th>메시지 유형</th><th>할 일</th><th>건수</th></tr></thead>
          <tbody>{field.roomGuide.map((g) => <tr key={g.type}><td><b>{g.type}</b></td><td>{g.todo}</td><td>{g.messages}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

// 화면별 따라하기 — Orbit 버튼 순서(data.uia)·전산 저장 대조(data.erp) 기반. 숫자는 생성기가 센 값.
const fmtSec = (s) => (s == null ? '-' : s >= 90 ? `약 ${Math.round(s / 60)}분` : `약 ${s}초`);
function ProcConf({ pr }) {
  const [label, tone] = CONF[pr.confidence] || CONF.estimate;
  return (
    <span className="ev">
      <Badge tone={tone}>신뢰도 {label}</Badge>
      <small>{pr.actions}회 관측{pr.days ? ` · ${pr.days}일` : ''}{pr.lastSeen ? ` · 최신 ${pr.lastSeen.slice(5)}` : ''}</small>
    </span>
  );
}
function ProcedureCard({ pr }) {
  const main = pr.variants?.[0];
  const ck = pr.check || {};
  return (
    <div className="card proc">
      <b>{pr.screen}</b> <ProcConf pr={pr} />
      <h5>순서</h5>
      {main?.steps?.length ? (
        <ol className="steps">{main.steps.map((s, i) => <li key={i}>[{s}] 누르기</li>)}</ol>
      ) : <p className="empty">버튼 순서 기록 없음(조회 화면으로 보기만 함)</p>}
      {pr.variants?.length > 1 && (
        <p className="muted"><small>다른 방법: {pr.variants.slice(1).map((v) => `${v.steps.join(' → ')} (${v.count}회)`).join(' / ')}</small></p>
      )}
      <h5>입력·확인하는 칸</h5>
      <p>{(pr.fields || []).map((f) => f.name).join(', ') || '-'}</p>
      <h5>옆에 띄워 보는 자료</h5>
      <p>{(pr.sources || []).map((x) => x.name).join(', ') || (pr.apps?.length ? pr.apps.join(', ') : '-')}</p>
      <h5>저장 확인 방법</h5>
      <p>
        {ck.saves ? `저장 ${ck.saves}번 중 ${ck.matched}번(${ck.matchedShare}%) 전산에 실제 반영 확인` : '저장 없이 보기만 하는 화면'}
        {ck.kinds?.length ? ` · ${ck.kinds.map((k) => k.kind).join('·')} 자료가 바뀜` : ''}
        {ck.columns?.length ? ` (바뀌는 칸: ${ck.columns.join(', ')})` : ''}
      </p>
      {pr.typed?.checked > 0 && <p className="muted"><small>입력한 거래처·품목이 전산과 일치 {pr.typed.confirmed}/{pr.typed.checked}건</small></p>}
      <h5>건당 시간</h5>
      <p>{fmtSec(pr.medianSec)}{pr.timeConfidence !== 'measured' && pr.medianSec != null ? ' (사례 적음 — 추정)' : ''}</p>
      {pr.problems?.length > 0 && (
        <>
          <h5>자주 생기는 문제</h5>
          <ul className="probs">{pr.problems.map((x, i) => <li key={i}>{x.text} <small className="muted">{x.count}회</small></li>)}</ul>
        </>
      )}
    </div>
  );
}
function Procedures({ dept }) {
  const people = (dept.people || []).filter((p) => p.procedures?.length);
  const [who, setWho] = useState(null);
  const cur = people.find((p) => p.name === who) || people[0];
  if (!people.length) return <p className="empty">이 부서는 아직 화면·버튼 기록이 없습니다(새 수집 기능이 켜진 PC부터 쌓입니다).</p>;
  return (
    <>
      {dept.procedures?.length > 0 && (
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>화면</th><th>대표 순서</th><th>쓰는 사람</th><th>전산 반영 확인</th><th>근거</th></tr></thead>
            <tbody>
              {dept.procedures.map((pr) => (
                <tr key={pr.screen}>
                  <td><b>{pr.screen}</b></td>
                  <td>{pr.steps?.length ? pr.steps.join(' → ') : '보기만'}</td>
                  <td>{(pr.people || []).join(', ')}</td>
                  <td>{pr.matchedShare == null ? '-' : `${pr.matchedShare}%`}</td>
                  <td><ProcConf pr={pr} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="who">{people.map((p) => <ToggleChip key={p.name} on={cur?.name === p.name} onClick={() => setWho(p.name)}>{p.name} ({p.procedures.length})</ToggleChip>)}</div>
      {cur && <div className="cards">{cur.procedures.map((pr) => <ProcedureCard key={pr.screen} pr={pr} />)}</div>}
    </>
  );
}

// 신입 첫 주 순서(Basecamp 식) — 부서마다 같은 다섯 단계
const FIRST_WEEK = [
  ['tools', '1일차: 부서가 맡는 단계와 쓰는 화면'],
  ['daily', '2일차: 하루 타임라인 따라 해 보기'],
  ['mail', '3일차: 메일함·메신저에서 볼 것'],
  ['weekly', '4일차: 요일별 특이 업무(차수 수요일 기준)'],
  ['handoff', '5일차: 부서간 넘김 + 월초·월말 업무'],
];

export default function RoutineManual({ routines, me, onConfirm, onSwitch, onLive }) {
  const [theme, setTheme] = useState('B');
  const depts = routines?.departments || [];
  // 내 부서를 먼저(없으면 첫 부서 — 신입은 이름이 아직 없으니 탭으로 고른다)
  const [deptId, setDeptId] = useState(() => (depts.find((d) => (d.people || []).some((p) => p.name === me)) || depts[0] || {}).id || 'management');
  const [person, setPerson] = useState(null);
  const [checks, setChecks] = useState({});
  useEffect(() => { setTheme(readStoredTheme(me)); }, [me]);
  useEffect(() => { setChecks(readChecks(deptId)); setPerson(null); }, [deptId]);
  const css = useMemo(() => allThemesCss(), []);
  const dept = depts.find((d) => d.id === deptId);
  const people = (dept?.people || []);
  const cur = people.find((p) => p.name === person) || people.find((p) => p.daily?.length) || people[0];
  const toggle = (k) => { const v = { ...checks, [k]: !checks[k] }; setChecks(v); writeChecks(deptId, v); };
  const done = FIRST_WEEK.filter(([k]) => checks[k]).length;

  return (
    <div className="pm wmr" data-theme={theme}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header className="hd">
        <h1 data-desktop-chrome>부서별 신입 루틴 매뉴얼</h1>
        <p className="muted">
          실제 관찰 기록으로 만든 루틴입니다(관측 {routines?.period?.from}~{routines?.period?.to}, 갱신 {String(routines?.generatedAt || '').slice(0, 10)}). 숫자는 스크립트가 센 값이고, 근거가 없으면 &apos;추정&apos;으로 표시합니다.
        </p>
        {onLive && <Button size="sm" variant="primary" onClick={onLive}>라이브 매뉴얼(단계 재생)</Button>}
        <Button size="sm" variant="ghost" onClick={onSwitch}>직원별 절차 초안 보기</Button>
      </header>
      <Tabs label="부서" items={depts.map((d) => [d.id, d.name])} value={deptId} onChange={setDeptId} />
      {!dept ? <p className="empty">루틴 데이터가 없습니다.</p> : dept.id === 'field' ? <FieldTeam field={routines.field} /> : (
        <>
          <section className="fw">
            <h2>신입 첫 주 <small className="muted">{done}/{FIRST_WEEK.length} 읽음</small></h2>
            <div className="fwl">
              {FIRST_WEEK.map(([k, l]) => <ToggleChip key={k} on={!!checks[k]} onClick={() => toggle(k)}>{checks[k] ? '✓ ' : ''}{l}</ToggleChip>)}
            </div>
          </section>
          <section>
            <h2>1. 이 부서가 맡는 단계와 화면</h2>
            <div className="cards">
              {people.map((p) => (
                <div key={p.name} className="card">
                  <b>{p.name}</b> <small className="muted">관측 {p.observedDays || 0}일{p.lastDay ? ` · 최신 ${p.lastDay.slice(5)}` : ''}</small>
                  {p.observedDays ? (
                    <>
                      <p>단계: {(p.stages || []).map((s) => `${s.stage}(${s.count})`).join(', ') || '-'}</p>
                      <p>화면: {(p.tools || []).map((t) => `${t.app} ${t.share}%`).join(', ')}</p>
                    </>
                  ) : <p className="empty">관측 데이터 없음 — 루틴 미작성</p>}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2>2. 하루 타임라인</h2>
            <div className="who">{people.filter((p) => p.observedDays).map((p) => <ToggleChip key={p.name} on={cur?.name === p.name} onClick={() => setPerson(p.name)}>{p.name}</ToggleChip>)}</div>
            {cur && <Timeline person={cur} onConfirm={onConfirm} />}
          </section>
          <section><h2>2-1. 화면별 따라하기 <small className="muted">(버튼 순서·입력 칸·저장 확인 — 최근 {routines?.procedurePeriodDays || 30}일 기록)</small></h2>
            <p className="note2">이 칸은 화면에서 눌린 버튼 이름을 순서대로 모은 자동 기록입니다. 왜·언제 하는지, 무엇을 보고 무엇을 넣는지는 들어 있지 않습니다.{dept.id === 'import' ? ' 수입부는 맨 위 「수입부 인수인계 업무표」의 매뉴얼을 먼저 보세요.' : ''}</p>
            <Procedures key={dept.id} dept={dept} /></section>
          <section><h2>3. 메일함에서 볼 것</h2><MailTable dept={dept} onConfirm={onConfirm} /></section>
          <section><h2>4. 주간 캘린더</h2><WeekGrid dept={dept} onConfirm={onConfirm} /></section>
          <section><h2>5. 부서간 넘김 · 월간 체크리스트</h2><Handoffs dept={dept} /><Monthly dept={dept} onConfirm={onConfirm} /></section>
        </>
      )}
      <style jsx global>{`
        .wmr { background: var(--pm-bg); color: var(--pm-ink); font-family: var(--pm-font); padding: 16px; min-height: 100%; }
        .wmr h1 { font-size: 20px; margin: 0 0 4px; }
        .wmr h2 { font-size: 16px; margin: 0 0 8px; }
        .wmr h3 { font-size: 14px; margin: 16px 0 6px; }
        .wmr .hd { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
        .wmr .hd p { flex: 1 1 100%; margin: 0; }
        .wmr section, .wmr .note { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px; margin: 10px 0; box-shadow: var(--pm-shadow); }
        .wmr .muted { color: var(--pm-muted); }
        .wmr .empty { color: var(--pm-muted); font-size: 12px; margin: 4px 0; }
        .wmr .fwl, .wmr .who { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .wmr .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
        .wmr .card { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 8px 10px; font-size: 13px; }
        .wmr .card p { margin: 4px 0 0; }
        .wmr .ev { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-left: 6px; }
        .wmr .ev small, .wmr .lift { color: var(--pm-muted); font-size: 11px; }
        .wmr .cf { display: inline-flex; gap: 4px; margin-left: 6px; }
        .wmr .badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--pm-off-bg); color: var(--pm-off-ink); }
        .wmr .badge.ok { background: var(--pm-ok-bg); color: var(--pm-ok-ink); }
        .wmr .badge.idle, .wmr .badge.est { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .wmr .badge.err { background: var(--pm-err-bg); color: var(--pm-err-ink); }
        .wmr .badge.plain { background: var(--pm-surface2); color: var(--pm-ink); }
        .wmr .tl .axis { position: relative; height: 34px; border-bottom: 1px solid var(--pm-line); margin: 4px 0 8px; }
        .wmr .tl .axis span { position: absolute; top: 0; font-size: 10px; color: var(--pm-muted); transform: translateX(-50%); }
        .wmr .tl .bar { position: absolute; top: 16px; height: 14px; border-radius: 4px; background: var(--pm-accent); }
        .wmr .tl .bar.c-medium { opacity: .75; } .wmr .tl .bar.c-low, .wmr .tl .bar.c-estimate { opacity: .45; }
        .wmr .rows { list-style: none; padding: 0; margin: 0; }
        .wmr .rows li { padding: 6px 0; border-top: 1px dashed var(--pm-line); font-size: 13px; }
        .wmr .rows .time { display: inline-block; min-width: 96px; }
        .wmr .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
        .wmr .day { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 6px; min-height: 80px; font-size: 12px; }
        .wmr .day h4 { margin: 0 0 4px; font-size: 13px; text-align: center; }
        .wmr .wk { padding: 4px 0; border-top: 1px dashed var(--pm-line); }
        .wmr .wk.fixed { color: var(--pm-link); }
        .wmr .wkd { margin-top: 8px; font-size: 13px; } .wmr .wkd summary { cursor: pointer; color: var(--pm-link); }
        .wmr .month, .wmr .hand { padding-left: 18px; font-size: 13px; }
        .wmr .month li, .wmr .hand li { margin: 4px 0; }
        .wmr .tblwrap { overflow-x: auto; }
        .wmr .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
        .wmr .tbl th, .wmr .tbl td { border-bottom: 1px solid var(--pm-line); padding: 6px; text-align: left; vertical-align: top; }
        .wmr .tbl th { background: var(--pm-surface2); }
        .wmr .note2 { font-size: 12px; color: var(--pm-muted); margin: 0 0 8px; }
        .wmr .proc h5 { margin: 8px 0 2px; font-size: 12px; color: var(--pm-muted); }
        .wmr .proc .steps, .wmr .proc .probs { margin: 2px 0; padding-left: 20px; }
        @media (max-width: 760px) { .wmr .week { grid-template-columns: repeat(2, minmax(0, 1fr)); } .wmr .rows .time { display: block; } }
      `}</style>
    </div>
  );
}
