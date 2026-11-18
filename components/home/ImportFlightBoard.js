// 홈 "수입 비행기 현황" 카드 — 이슈 먼저, 그다음 예측 지도와 편별 목록.
// 지도 위 위치는 실제 위치가 아니라 일정으로 계산한 예측이다(화면에 그대로 적는다).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { WORLD_VIEW, WORLD_LAND_PATH, projectLonLat } from '../../lib/importFlightWorldPath';

const { issueRows, shortIssue } = require('../../desktop/shell/flight-board');

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
  const buttons = [...event.currentTarget.querySelectorAll('tbody button')];
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
  const planes = flights.filter(f => f.position && (f.status === 'in_flight' || f.status === 'before_departure'));
  return (
    <svg viewBox={`0 0 ${WORLD_VIEW.width} ${WORLD_VIEW.height}`} role="img" aria-label="수입 비행기 예측 위치 지도"
      style={{ width: '100%', height: 'auto', display: 'block', background: '#eef4fa', borderRadius: 6, border: '1px solid #d7e0ea' }}>
      <path d={WORLD_LAND_PATH} fill="#d5dee8" stroke="#aebccb" strokeWidth="0.4" />
      {routes.map(r => (
        <path key={r.key} d={r.d} fill="none" stroke="#5b8fd1" strokeWidth="1" strokeDasharray={r.via ? '3 3' : undefined} opacity="0.75" />
      ))}
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
        const pos = f.status === 'before_departure' && f.origin ? { lat: f.origin.lat, lon: f.origin.lon } : f.position;
        const p = projectLonLat(pos.lon, pos.lat);
        const on = f.key === selectedKey;
        const st = STATUS_STYLE[f.status] || STATUS_STYLE.in_flight;
        return (
          <g key={f.key} onClick={() => onSelect(f.key)} style={{ cursor: 'pointer' }}>
            <title>{`${f.weekLabel}차 ${f.country} ${f.flight} — ${f.statusLabel}${f.progress != null ? ` 약 ${Math.round(f.progress * 100)}%` : ''}`}</title>
            <circle cx={p.x} cy={p.y} r={on ? 7 : 5} fill={st.dot} stroke="#fff" strokeWidth="1.4" opacity="0.95" />
            <text x={p.x} y={p.y + 2.6} fontSize="6.5" textAnchor="middle" fill="#fff" fontWeight="700">✈</text>
            {f.status === 'in_flight' && (
              <text x={p.x + 8} y={p.y + 3} fontSize="8" fontWeight="700" fill="#0b3d75" stroke="#eef4fa" strokeWidth="2" paintOrder="stroke">
                {f.phase === 'layover' && f.via?.name ? `${f.country} · ${f.via.name} 대기` : `${f.country} ${Math.round((f.progress || 0) * 100)}%`}
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
    if (selectedKey) detailRef.current?.focus();
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
  const active = flights.filter(f => f.status !== 'registered');
  const done = flights.filter(f => f.status === 'registered');
  const shown = showDone ? flights : active;
  const selected = flights.find(f => f.key === selectedKey) || null;
  const s = data?.summary || {};
  const todo = Array.isArray(data?.todo) ? data.todo : [];
  const issues = issueRows([...todo, ...(data?.issues || [])]);
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

          {issues.length > 0 && (
            <section className="flight-issues" aria-label="확인할 이슈">
              <h3>확인할 이슈 {issues.length}건</h3>
              <table className="flight-issue-table" onKeyDown={moveTableFocus}>
                <thead><tr><th scope="col">번호</th><th scope="col">이슈</th><th scope="col">상세</th></tr></thead>
                <tbody>{issues.map((it, i) => (
                  <tr key={JSON.stringify([it.key, it.text])}>
                    <td style={{ color: it.level === 'red' ? '#b02a2a' : '#8a5a00' }}>{i + 1}</td>
                    <td title={it.text}>{shortIssue(it.text)}</td>
                    <td><button type="button" className="btn btn-sm" aria-label={'이슈 ' + (i + 1) + ' 상세'} onClick={event => selectDetail(it.key, event)}>상세</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          )}

          {roomNews.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text3)' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setShowRoomNews(v => !v)}>
                {showRoomNews ? '▾' : '▸'} 어느 비행기인지 못 붙인 방 글 {roomNews.length}건
              </span>
              {showRoomNews && roomNews.map((e, i) => (
                <div key={`rn-${i}`} style={{ lineHeight: 1.6, color: roomColor(e.level) }}>
                  {roomLine(e)} · {e.room} · {e.label} — {e.text}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 8, alignItems: 'start' }} className="import-flight-grid">
            <div>
              <FlightMap flights={flights} destination={data.destination} selectedKey={selectedKey} onSelect={setSelectedKey} />
            </div>
            <div style={{ minWidth: 0, overflowX: 'auto' }}>
              {selected && (
                <div ref={detailRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') setSelectedKey(''); }} data-testid="flight-selected-detail" style={{ marginTop: 6, border: '1px solid #d7e0ea', borderRadius: 6, padding: '6px 10px', fontSize: 12, lineHeight: 1.7 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{selected.weekLabel}차 {selected.country} {selected.itemLabel}</b>
                    <StatusChip f={selected} />
                    <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedKey('')}>닫기</button>
                  </div>
                  <div>항공사 {selected.airline || '-'} · 편명 {selected.flight || '아직 없음'} · 빌번호 {selected.awb || '아직 없음'}</div>
                  <div>
                    {selected.origin ? `${selected.origin.name}${selected.origin.assumed ? '(출발 도시 추정)' : ''} → ${selected.via?.name ? `${selected.via.name}(경유) → ` : ''}인천` : '출발지 미확인'}
                    {selected.lastLegDepartAt ? ` · 경유지 출발(공항 자료 기준) ${shortTime(selected.lastLegDepartAt)}` : ''}
                    {selected.departAtEstimated ? ` · 출발 예측 ${shortTime(selected.departAtEstimated)}` : ''} · 도착 예정 {arrivalText(selected)}
                  </div>
                  <div style={{ color: 'var(--text3)' }}>{selected.note}</div>
                  <div>
                    실린 것({selected.contents.source} 기준{selected.contents.farms ? `, 농장 ${fmt(selected.contents.farms)}곳` : ''}): {selected.contents.items.length
                      ? selected.contents.items.map(it => `${it.name} ${fmt(it.box)}박스`).join(' · ')
                      : `품목 내역 없음${selected.box ? ` (총 ${fmt(selected.box)}박스)` : ''} — 입고 등록 뒤 표시`}
                  </div>
                  {selected.actual && (
                    <div>
                      인천공항 최신 예정 {shortTime(selected.actual.estimatedAt || selected.actual.scheduledAt) || '-'}
                      {selected.actual.remark && !selected.statusLabel.includes(selected.actual.remark) ? ` · ${selected.actual.remark}` : ''}
                    </div>
                  )}
                  {(selected.checklist?.steps || []).some(st => st.at) && (
                    <div style={{ color: 'var(--text3)' }}>
                      {selected.checklist.steps.filter(st => st.at).map(st => `${st.label} ${shortTime(st.at)}`).join(' · ')}
                    </div>
                  )}
                  {(selected.roomEvents || []).length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontWeight: 700 }}>방에서 온 소식</div>
                      {selected.roomEvents.map((e, i) => (
                        <div key={`re-${i}`} style={{ color: roomColor(e.level), lineHeight: 1.6 }}>
                          {roomLine(e)} · [{e.room}] {e.label} — {e.text}
                          {e.guessed && <span style={{ color: 'var(--text3)', fontSize: 10, marginLeft: 4 }}>추정 연결</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12 }} hidden={!!selected} onKeyDown={moveTableFocus}>
                <thead>
                  <tr><th>차수·나라</th><th>편명</th><th>박스</th><th>도착 예정</th><th>상태</th><th>실제 위치</th></tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--text3)' }}>
                      {data.feed?.ok ? '지금 들어오는 비행기 공지가 없습니다' : '도착 공지를 읽지 못했습니다'}
                    </td></tr>
                  )}
                  {shown.map(f => (
                    <Fragment key={f.key}>
                    <tr onClick={() => setSelectedKey(f.key)} style={{ cursor: 'pointer', background: f.key === selectedKey ? '#f0f6ff' : undefined }}>
                      <td>
                        <button type="button" className="btn btn-sm" onClick={event => { event.stopPropagation(); selectDetail(f.key, event); }}><b>{f.weekLabel}</b> {f.country} 상세</button>
                        {(f.issues || []).length > 0 && <span title={f.issues.join('\n')} style={{ color: '#b02a2a', marginLeft: 4 }}>⚠</span>}
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{f.itemLabel}</div>
                      </td>
                      <td>{f.flight || <span style={{ color: '#b07500' }}>없음</span>}<div style={{ fontSize: 10, color: 'var(--text3)' }}>{f.awb || '빌번호 없음'}</div></td>
                      <td style={{ textAlign: 'right' }}>{f.box ? fmt(f.box) : '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {arrivalText(f)}
                        {f.actual?.estimatedAt && (() => {
                          const dv = delayView(f.actual);
                          return (
                            <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                              공항 {shortTime(f.actual.estimatedAt)}{f.actual.remark ? ` ${f.actual.remark}` : ''}
                              {dv && <b style={{ color: dv.color, marginLeft: 4 }}>{dv.text}</b>}
                            </div>
                          );
                        })()}
                      </td>
                      <td><StatusChip f={f} /></td>
                      <td onClick={e => e.stopPropagation()}>
                        {(f.links?.aircraftTrack || f.links?.flightTrack)
                          ? <a href={f.links.aircraftTrack || f.links.flightTrack} target="_blank" rel="noopener noreferrer" title={f.aircraft?.regNo ? `기체 ${f.aircraft.regNo}${f.aircraft.type ? ` (${f.aircraft.type})` : ''} — 그 비행기의 실제 위치를 엽니다` : '편명으로 실제 위치를 엽니다(기체 번호는 공항 자료가 잡히면 표시)'} style={{ color: 'var(--blue)', whiteSpace: 'nowrap' }}>실제 위치 ↗{f.aircraft?.regNo ? <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)' }}>기체 {f.aircraft.regNo}</span> : null}</a>
                          : <span style={{ color: 'var(--text3)' }}>-</span>}
                      </td>
                    </tr>
                    {f.checklist?.steps?.length > 0 && (
                      <tr onClick={() => setSelectedKey(f.key)} style={{ cursor: 'pointer', background: f.key === selectedKey ? '#f0f6ff' : undefined }}>
                        <td colSpan={6} style={{ padding: '2px 8px 8px' }}>
                          <FlightStrip f={f} faded={f.status === 'registered'} busy={busyAwb === f.awb} onToggleDocs={toggleDocs} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, fontSize: 11, color: 'var(--text3)', flexWrap: 'wrap' }}>
                {done.length > 0 && (
                  <button type="button" className="btn btn-sm" onClick={() => setShowDone(v => !v)}>
                    {showDone ? '입고 등록 끝난 편 숨기기' : `입고 등록 끝난 편 ${done.length}건 보기`}
                  </button>
                )}
                {data.unannounced?.length > 0 && (
                  <span title={data.unannounced.map(u => `${u.orderWeek} ${u.country} ${u.awb} ${fmt(u.boxes)}박스`).join('\n')}>
                    최근 3일 입고 등록 중 도착 공지에서 못 찾은 빌번호 {data.unannounced.length}건
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`

        .flight-issues { border: 1px solid #f3c2c2; background: #fff5f5; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
        .flight-issues h3 { margin: 0 0 6px; font-size: 14px; color: #b02a2a; }
        .flight-issue-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; text-align: left; }
        .flight-issue-table th, .flight-issue-table td { padding: 6px; border-bottom: 1px solid #eedddd; vertical-align: top; overflow-wrap: anywhere; }
        .flight-issue-table th:first-child { width: 44px; }
        .flight-issue-table th:last-child { width: 62px; }
        @media (max-width: 900px) {
          :global(.import-flight-grid) { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
