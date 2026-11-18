// 홈 "수입 비행기 현황" 카드 — 이슈 먼저, 그다음 예측 지도와 편별 목록.
// 지도 위 위치는 실제 위치가 아니라 일정으로 계산한 예측이다(화면에 그대로 적는다).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { WORLD_VIEW, WORLD_LAND_PATH, projectLonLat } from '../../lib/importFlightWorldPath';

const { issueRows, shortIssue, linkedFlights, nextAction } = require('../../desktop/shell/flight-board');

const REFRESH_MS = 5 * 60 * 1000;
const STATUS_STYLE = {
  in_flight: { bg: '#e3f0ff', ink: '#0b57a4', dot: '#1668c7' },
  before_departure: { bg: '#f1f3f5', ink: '#495057', dot: '#868e96' },
  awaiting_awb: { bg: '#fff4d6', ink: '#8a5a00', dot: '#d99a00' },
  arrived: { bg: '#e6f6ea', ink: '#1d6b33', dot: '#2f9e4f' },
  registered: { bg: '#eef0f2', ink: '#6c757d', dot: '#adb5bd' },
};
const fmt = n => Number(n || 0).toLocaleString();
function moveTableFocus(event) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName !== 'BUTTON') return;
  const buttons = [...event.currentTarget.querySelectorAll('[data-flight-select]')];
  const index = buttons.indexOf(event.target);
  const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) { event.preventDefault(); next.focus(); }
}

function kstParts(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 9 * 3600000);
  return { mo: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: String(d.getUTCHours()).padStart(2, '0'), mm: String(d.getUTCMinutes()).padStart(2, '0'), dow: '일월화수목금토'[d.getUTCDay()] };
}
function arrivalText(f) {
  const p = kstParts(f.arriveAt);
  if (!p) return f.arrivalDate || '-';
  return f.timeAssumed ? `${p.mo}/${p.day}(${p.dow}) 시각 미정` : `${p.mo}/${p.day}(${p.dow}) ${p.hh}:${p.mm}`;
}
function shortTime(iso) {
  const p = kstParts(iso);
  return p ? `${p.mo}/${p.day} ${p.hh}:${p.mm}` : '';
}

const STEP_STYLE = {
  done: { bg: '#e6f6ea', ink: '#1d6b33', mark: '✔ ' },
  wait: { bg: '#f1f3f5', ink: '#868e96', mark: '' },
  due: { bg: '#fff4d6', ink: '#8a5a00', mark: '⏳ ' },
  late: { bg: '#ffe3e3', ink: '#b02a2a', mark: '⚠ ' },
  na: { bg: 'transparent', ink: '#868e96', mark: '', dashed: true },
};
const ROOM_LEVEL_COLOR = { red: '#b02a2a', amber: '#b07500' };
const roomColor = level => ROOM_LEVEL_COLOR[level] || 'var(--text3)';
function roomLine(e) {
  const p = kstParts(e?.at);
  return p ? `${p.mo}/${p.day} ${p.hh}:${p.mm}` : '';
}
function delayView(actual) {
  const m = Number(actual?.delayMinutes);
  if (!Number.isFinite(m) || Math.abs(m) < 30) return null;
  return { text: `${m > 0 ? '+' : '−'}${Math.abs(Math.round(m))}분`, color: m >= 60 ? '#b02a2a' : '#b07500' };
}
function quarantineView(cl, steps) {
  const q = cl?.quarantine;
  if (!q?.deadlineAt) return null;
  if (steps.find(x => x.key === 'quarantine')?.state === 'done') return null;
  const p = kstParts(q.deadlineAt);
  if (!p) return null;
  const left = Date.parse(q.deadlineAt) - Date.now();
  const color = left < 0 ? '#b02a2a' : left <= 6 * 3600000 ? '#b07500' : 'var(--text3)';
  return { text: `검역 신청 마감(예상) ${p.mo}/${p.day}(${p.dow}) ${p.hh}:${p.mm}${q.slot ? ` · ${q.slot}` : ''}`, color };
}

// 편별 진행 띠 — 빌번호부터 입고 등록까지 한 줄
function FlightStrip({ f, faded, busy, onToggleDocs }) {
  const steps = Array.isArray(f.checklist?.steps) ? f.checklist.steps : [];
  if (steps.length === 0) return null;
  const q = quarantineView(f.checklist, steps);
  const latest = Array.isArray(f.roomEvents) && f.roomEvents.length ? f.roomEvents[0] : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, fontSize: 10.5, opacity: faded ? 0.7 : 1 }}>
      {steps.map((st, i) => {
        const sty = STEP_STYLE[st.state] || STEP_STYLE.wait;
        const pillStyle = { display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 10.5, lineHeight: 1.5, whiteSpace: 'nowrap', background: sty.bg, color: sty.ink, border: sty.dashed ? '1px dashed #adb5bd' : '1px solid transparent' };
        const title = [st.note, st.at ? shortTime(st.at) : ''].filter(Boolean).join(' · ');
        const isDocsBtn = st.key === 'docs' && f.awb && st.note !== '통관 진행으로 확인';
        return (
          <Fragment key={st.key || i}>
            {i > 0 && <span style={{ color: '#adb5bd' }}>→</span>}
            {isDocsBtn ? (
              <button type="button" disabled={busy} title="선율에 서류를 보냈으면 눌러 표시합니다(다시 누르면 취소)"
                onClick={e => { e.stopPropagation(); onToggleDocs(f, st.state !== 'done'); }}
                style={{ ...pillStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit', fontSize: 10.5 }}>
                {st.state === 'done' ? '서류 전달 ✔' : '서류 전달함 표시'}
              </button>
            ) : (
              <span title={title} style={pillStyle}>{sty.mark}{st.label}</span>
            )}
          </Fragment>
        );
      })}
      {q && <span style={{ marginLeft: 'auto', color: q.color, fontSize: 10.5 }}>{q.text}</span>}
      {latest && (
        <span title={latest.text} style={{ marginLeft: q ? 6 : 'auto', color: roomColor(latest.level), fontSize: 10 }}>
          최근: {latest.room} {latest.label} {roomLine(latest)}
        </span>
      )}
    </div>
  );
}

// 경로 점들을 SVG path 로. 지도 이음매(경도 -30)를 넘으면 선을 끊는다.
function routePath(points) {
  let d = '';
  let prevX = null;
  for (const pt of points || []) {
    const { x, y } = projectLonLat(pt.lon, pt.lat);
    const jump = prevX !== null && Math.abs(x - prevX) > WORLD_VIEW.width / 2;
    d += `${prevX === null || jump ? 'M' : 'L'}${x.toFixed(1)},${Math.max(2, Math.min(WORLD_VIEW.height - 2, y)).toFixed(1)}`;
    prevX = x;
  }
  return d;
}

function FlightMap({ flights, destination, selectedKey, onSelect }) {
  const routes = useMemo(() => {
    const seen = new Map();
    for (const f of flights) {
      if (!f.origin || !f.route?.length || f.status === 'registered') continue;
      // 같은 출발지라도 경유지가 다르면 길이 다르다(출발지 → 경유지 → 인천)
      const rk = `${f.origin.code}-${f.via?.code || ''}`;
      if (!seen.has(rk)) seen.set(rk, { key: rk, code: f.origin.code, name: f.origin.name, lat: f.origin.lat, lon: f.origin.lon, d: routePath(f.route), via: /미확인/.test(f.note || '') });
    }
    return [...seen.values()];
  }, [flights]);
  // 경유지(인천행 마지막 비행기가 떠나는 공항) 표시
  const vias = useMemo(() => {
    const seen = new Map();
    for (const f of flights) if (f.via?.code && f.status !== 'registered' && !seen.has(f.via.code)) seen.set(f.via.code, f.via);
    return [...seen.values()];
  }, [flights]);
  const origins = useMemo(() => { const m = new Map(); for (const r of routes) if (!m.has(r.code)) m.set(r.code, r); return [...m.values()]; }, [routes]);
  const dest = destination ? projectLonLat(destination.lon, destination.lat) : null;
  const planes = flights.filter(f => (f.status !== 'registered' || f.flightIssues?.length) && (f.position || f.origin || (f.status === 'arrived' && destination)));
  return (
    <svg viewBox={`0 0 ${WORLD_VIEW.width} ${WORLD_VIEW.height}`} role="group" aria-label="수입 비행기 예측 위치 지도"
      style={{ width: '100%', height: 'auto', display: 'block', background: '#eef4fa', borderRadius: 6, border: '1px solid #d7e0ea' }}>
      <path d={WORLD_LAND_PATH} fill="#d5dee8" stroke="#aebccb" strokeWidth="0.4" />
      {routes.map(r => (
        <path key={r.key} d={r.d} fill="none" stroke="#5b8fd1" strokeWidth="1" strokeDasharray={r.via ? '3 3' : undefined} opacity="0.75" />
      ))}
      {flights.filter(f => f.key === selectedKey && f.route?.length).map(f => <path key={'selected-'+f.key} d={routePath(f.route)} fill="none" stroke="#145db4" strokeWidth="3" />)}
      {origins.map((r, i) => {
        const p = projectLonLat(r.lon, r.lat);
        // 보고타·메데진처럼 가까운 출발지의 이름이 겹치지 않게 위·아래로 번갈아 적는다
        const below = i % 2 === 1;
        return (
          <g key={`o-${r.code}`}>
            <circle cx={p.x} cy={p.y} r="2.6" fill="#fff" stroke="#3b6fb5" strokeWidth="1" />
            <text x={p.x + 4} y={below ? p.y + 10 : p.y - 4} fontSize="8" fill="#33475b" stroke="#eef4fa" strokeWidth="2" paintOrder="stroke">{r.name}</text>
          </g>
        );
      })}
      {vias.map(v => {
        const p = projectLonLat(v.lon, v.lat);
        return (
          <g key={`v-${v.code}`}>
            <rect x={p.x - 2.6} y={p.y - 2.6} width="5.2" height="5.2" transform={`rotate(45 ${p.x} ${p.y})`} fill="#fff3bf" stroke="#e67700" strokeWidth="1" />
            <text x={p.x + 5} y={p.y - 4} fontSize="8" fill="#8a4b00" stroke="#eef4fa" strokeWidth="2" paintOrder="stroke">{v.name}(경유)</text>
          </g>
        );
      })}
      {dest && (
        <g>
          <circle cx={dest.x} cy={dest.y} r="3.4" fill="#d9480f" stroke="#fff" strokeWidth="1" />
          <text x={dest.x + 5} y={dest.y + 3} fontSize="9" fontWeight="700" fill="#b23c0a">인천</text>
        </g>
      )}
      {planes.map(f => {
        const pos = f.status === 'arrived' && destination ? destination : f.status === 'before_departure' && f.origin ? f.origin : (f.position || f.origin);
        const p = projectLonLat(pos.lon, pos.lat);
        const on = f.key === selectedKey;
        const st = STATUS_STYLE[f.status] || STATUS_STYLE.in_flight;
        return (
          <g key={f.key} role="button" tabIndex={0} aria-label={`${f.boardNumber}번 ${f.country} ${f.flight || '편명 미확인'} 선택`} aria-pressed={on} onClick={event => onSelect(f.key, event)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(f.key, event); } }} style={{ cursor: 'pointer' }}>
            <title>{`${f.weekLabel}차 ${f.country} ${f.flight} — ${f.statusLabel}${f.progress != null ? ` 약 ${Math.round(f.progress * 100)}%` : ''}`}</title>
            <circle cx={p.x} cy={p.y} r={on ? 9 : 7} fill={st.dot} stroke="#fff" strokeWidth="1.4" opacity="0.95" />
            <text x={p.x} y={p.y + 2.6} fontSize="6.5" textAnchor="middle" fill="#fff" fontWeight="700">{f.boardNumber}</text>
            {(
              <text x={p.x + 8} y={p.y + 3} fontSize="8" fontWeight="700" fill="#0b3d75" stroke="#eef4fa" strokeWidth="2" paintOrder="stroke">
                {`${f.boardNumber}. ${f.flight || f.country}${f.status === 'arrived' ? ' 도착' : f.status === 'before_departure' ? ' 출발 전' : ` ${Math.round((f.progress || 0) * 100)}%`}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function StatusChip({ f }) {
  const st = STATUS_STYLE[f.status] || STATUS_STYLE.before_departure;
  return (
    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: st.bg, color: st.ink, whiteSpace: 'nowrap' }}>
      {f.statusLabel}{f.status === 'in_flight' && f.progress != null ? ` ${Math.round(f.progress * 100)}%` : ''}
    </span>
  );
}

export default function ImportFlightBoard({ initialViewId = '' }) {
  const appliedViewId = useRef('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const detailRef = useRef(null);
  const returnFocusRef = useRef(null);
  const selectDetail = (key, event) => {
    returnFocusRef.current = event?.currentTarget || null;
    setSelectedKey(key);
  };
  useEffect(() => {
    if (selectedKey) { const card = detailRef.current?.querySelector('[data-selected="true"]'); card?.focus(); card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else returnFocusRef.current?.focus();
  }, [selectedKey]);
  const [showDone, setShowDone] = useState(false);
  const [busyAwb, setBusyAwb] = useState('');
  const [showRoomNews, setShowRoomNews] = useState(false);

  const load = useCallback(async (fresh = false) => {
    try {
      const d = await apiGet(fresh ? '/api/import/flight-board?fresh=1' : '/api/import/flight-board');
      setData(d);
      setErr('');
    } catch (e) {
      setErr(e?.message || '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const toggleDocs = useCallback(async (f, sent) => {
    setBusyAwb(f.awb);
    try {
      await apiPost('/api/import/flight-board', { awb: f.awb, sent });
      await load();
    } catch (e) {
      setErr(e?.message || '서류 전달 표시를 저장하지 못했습니다.');
    } finally {
      setBusyAwb('');
    }
  }, [load]);

  const flights = data?.flights || [];
  useEffect(() => {
    if (!initialViewId || appliedViewId.current === initialViewId || !data) return;
    const flight = (data.flights || []).find(f => f.viewId === initialViewId);
    appliedViewId.current = initialViewId;
    if (flight) { setSelectedKey(flight.key); if (flight.status === 'registered') setShowDone(true); }
  }, [data, initialViewId]);
  const issues = issueRows([...(data?.todo || []), ...(data?.issues || [])]);
  const ordered = linkedFlights(flights, issues);
  const active = ordered.filter(f => f.status !== 'registered' || f.flightIssues.length);
  const done = ordered.filter(f => f.status === 'registered' && !f.flightIssues.length);
  const shown = showDone ? ordered : active;
  const selected = flights.find(f => f.key === selectedKey) || null;
  const s = data?.summary || {};
  const todo = Array.isArray(data?.todo) ? data.todo : [];
  const roomNews = Array.isArray(data?.roomNews) ? data.roomNews : [];

  return (
    <div className="card" style={{ marginBottom: 6 }} data-testid="import-flight-board">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="card-title">수입 비행기 현황</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          지도 위 위치는 도착 공지 일정으로 계산한 <b>예측</b>입니다 · 실제 위치는 편별 「실제 위치」 버튼
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
          {data?.generatedAt ? `${shortTime(data.generatedAt)} 기준` : ''}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => { setLoading(true); load(true); }} disabled={loading}>새로고침</button>
      </div>

      {initialViewId && data && !flights.some(f => f.viewId === initialViewId) && (
        <p role="status" style={{ padding: 12 }}>선택한 비행기는 최신 목록에서 찾을 수 없습니다. 아래 전체 현황을 확인해 주세요.</p>
      )}
      {loading && !data && <div className="skeleton" style={{ height: 120, margin: 8 }} />}
      {err && <div className="banner-err" style={{ margin: 8 }}>수입 비행기 현황을 불러오지 못했습니다: {err}</div>}
      {data && !data.feed?.ok && <div className="banner-err" style={{ margin: 8 }}>{data.feed?.error} 전산 입고 기록만 표시합니다.</div>}
      {data?.feed?.rooms && <details style={{ padding: '4px 8px', fontSize: 12 }}><summary>카톡 원문 반영 시각 · NENOVAKAKAO</summary>{Object.entries(data.feed.rooms).map(([room, r]) => <div key={room}>{room}: 원문 {shortTime(r.latestMessageAt)} · 저장 {shortTime(r.latestImportedAt)} {r.error ? '· 조회 실패 — 완료 여부 확인 필요' : ''}</div>)}<div>원문 시각은 마지막 메시지 기준이며 수집기의 마지막 확인 시각과 다릅니다.</div></details>}
      {data && data.receipts && !data.receipts.ok && <div className="banner-err" style={{ margin: 8 }}>{data.receipts.error}</div>}

      {data && (
        <div style={{ padding: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, fontSize: 12 }}>
            {[['비행 중', s.inFlight, STATUS_STYLE.in_flight], ['출발 전', s.beforeDeparture, STATUS_STYLE.before_departure], ['빌번호 대기', s.awaitingAwb, STATUS_STYLE.awaiting_awb], ['도착·입고 대기', s.arrived, STATUS_STYLE.arrived], ['입고 등록 끝', s.registered, STATUS_STYLE.registered]].map(([label, n, st]) => (
              <span key={label} style={{ padding: '3px 10px', borderRadius: 12, background: st.bg, color: st.ink, fontWeight: 700 }}>{label} {fmt(n)}</span>
            ))}
            <span style={{ padding: '3px 10px', borderRadius: 12, background: issues.length ? '#ffe3e3' : '#f1f3f5', color: issues.length ? '#b02a2a' : '#6c757d', fontWeight: 700 }}>이슈 {fmt(issues.length)}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text3)', alignSelf: 'center', display: 'inline-flex', gap: 8 }}>
              <span title="인천공항 운항 정보">공항 자료 {data.sources?.icn?.enabled && data.sources?.icn?.ok ? '✔' : '–'}</span>
              <span title="관세청 유니패스">통관 자료 {data.sources?.customs?.enabled && data.sources?.customs?.ok ? '✔' : '–'}</span>
            </span>
          </div>

          {roomNews.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text3)' }}>
              <button type="button" className="btn btn-sm" onClick={() => setShowRoomNews(v => !v)}>
                {showRoomNews ? '▾' : '▸'} 어느 비행기인지 못 붙인 방 글 {roomNews.length}건
              </button>
              {showRoomNews && roomNews.map((e, i) => (
                <div key={`rn-${i}`} style={{ lineHeight: 1.6, color: roomColor(e.level) }}>
                  {roomLine(e)} · {e.room} · {e.label} — {e.text}
                </div>
              ))}
            </div>
          )}

          <div className="import-flight-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
            <div className="flight-map-panel">
              <FlightMap flights={shown} destination={data.destination} selectedKey={selectedKey} onSelect={selectDetail} />
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0' }}>지도 번호와 오른쪽 항공편이 연결됩니다. 위치는 일정 기반 예측이며, 위치 자료가 없는 편은 목록에서 확인하세요.</p>
              <p style={{ fontSize: 12 }}>우선 확인 {active.filter(f => f.priority === 0).length}편 · 확인 필요 {active.filter(f => f.priority === 1).length}편 · 이슈 없는 편은 접어서 표시</p>
            </div>
            <div ref={detailRef} onKeyDown={moveTableFocus} aria-label="처리 순서별 항공편" style={{ minWidth: 0 }}>
              {!shown.length && <p>지금 확인할 항공편이 없습니다.</p>}
              {shown.map(f => {
                const expanded = f.key === selectedKey;
                const attention = f.priority < 2;
                const track = f.links?.aircraftTrack || f.links?.flightTrack;
                return <article key={f.key} tabIndex={-1} data-selected={expanded} data-testid="flight-card" onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); setSelectedKey(''); } }} style={{ border: expanded ? '2px solid #1668c7' : '1px solid #d7e0ea', borderLeft: `4px solid ${f.priority === 0 ? '#b02a2a' : f.priority === 1 ? '#b07500' : '#aab8c8'}`, borderRadius: 8, padding: 10, marginBottom: 8, background: expanded ? '#f0f6ff' : '#fff', fontSize: 13, lineHeight: 1.6 }}>
                  <button type="button" data-flight-select className="flight-select" aria-expanded={expanded} onClick={event => selectDetail(expanded ? '' : f.key, event)}>
                    <b>{f.boardNumber}. {f.country} · {f.flight || '편명 미확인'}</b>
                    <span>{f.priority === 0 ? '우선 확인' : f.priority === 1 ? '확인 필요' : f.status === 'registered' ? '입고 등록 끝' : '이슈 없음'} {expanded ? '▴' : '▾'}</span>
                  </button>
                  <div><StatusChip f={f} /> <span>{f.weekLabel}차 · {f.itemLabel} · 공지 도착 {arrivalText(f)}</span></div>
                  {(attention || expanded) && <>
                    {f.flightIssues.length > 0 ? <ol className="flight-actions">{(expanded ? f.flightIssues : f.flightIssues.slice(0,2)).map(it => <li key={it.text}><span>{shortIssue(it.text)}</span><div className="flight-next">→ {nextAction(it)}</div></li>)}</ol> : <p style={{ margin: '4px 0', color: 'var(--text3)' }}>{f.nextStep ? `${f.nextStep} 확인` : '현재 연결된 이슈 없음'}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {!expanded && f.flightIssues.length > 2 && <button type="button" className="btn btn-sm" onClick={event => selectDetail(f.key,event)}>이슈 {f.flightIssues.length}건 모두 보기</button>}
                      {track && <a href={track} target="_blank" rel="noopener noreferrer" className="btn btn-sm">시간·실제 위치 원문 ↗</a>}
                      <button type="button" className="btn btn-sm" disabled={loading} onClick={() => { setLoading(true); load(true); }}>공항 자료 다시 확인</button>
                    </div>
                  </>}
                  {expanded && <div data-testid="flight-selected-detail" style={{ borderTop: '1px solid #d7e0ea', marginTop: 8, paddingTop: 8 }}>
                    <div>항공사 {f.airline || '미확인'} · 빌번호 {f.awb || '미확인'}</div>
                    <div>{f.origin?.name || '출발지 미확인'} → {f.via?.name ? `${f.via.name}(경유) → ` : ''}인천</div>
                    <div>공항 예정(STA) {shortTime(f.actual?.scheduledAt) || '미확인'}{f.actual?.estimatedAt ? ` · ${/도착/.test(f.actual.remark || "") ? "공항 도착 표시" : "공항 예상"} ${shortTime(f.actual.estimatedAt)}` : ''}</div>
                    <div style={{ color: 'var(--text3)' }}>자료 읽음 {shortTime(data.generatedAt)} KST · 출처: 인천공항 자료 · 미확인은 미처리 확정이 아닙니다.</div>
                    <div>실린 품목: {(f.contents?.items || []).map(it => `${it.name} ${fmt(it.box)}박스`).join(' · ') || '내역 없음'}</div>
                    <FlightStrip f={f} faded={f.status === 'registered'} busy={busyAwb === f.awb} onToggleDocs={toggleDocs} />
                    {f.note && <div style={{ color: 'var(--text3)' }}>{f.note}</div>}
                    {(f.history || []).length > 1 && <details><summary>일정 변경 이력</summary>{f.history.map((h,i) => <p key={i}>{shortTime(h.postedAt)} 공지 → {shortTime(h.arrivalAt || h.arrivalDate)} · {h.box ?? '–'}박스</p>)}</details>}
                    {(f.roomEvents || []).length > 0 && <details><summary>연결된 처리 원문·완료 근거</summary>{f.roomEvents.map((e,i) => <p key={i}>{roomLine(e)} · {e.room} · {e.text}{e.guessed ? ' (추정 연결)' : ''}</p>)}</details>}
                  </div>}
                </article>;
              })}
              {done.length > 0 && <button type="button" className="btn btn-sm" onClick={() => setShowDone(v => !v)}>{showDone ? '입고 등록 끝난 편 숨기기' : `입고 등록 끝난 편 ${done.length}건 보기`}</button>}
              {data.unannounced?.length > 0 && <p>도착 공지에서 찾지 못한 입고 빌번호 {data.unannounced.length}건</p>}
            </div>
          </div>
        </div>
      )}
      <style jsx>{`

        .flight-select { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; border: 0; background: transparent; text-align: left; color: #163957; font: inherit; cursor: pointer; padding: 0 0 5px; }
        .flight-select:focus-visible { outline: 2px solid #1668c7; outline-offset: 3px; }
        .flight-actions { margin: 6px 0; padding-left: 22px; }
        .flight-actions li { margin: 4px 0; }
        .flight-next { color: #526981; font-size: 12px; }
        .flight-map-panel { position: sticky; top: 8px; }
        @media (max-width: 900px) {
          .flight-map-panel { position: static; }
          :global(.import-flight-grid) { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
