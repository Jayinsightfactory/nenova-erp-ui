// 홈 "수입 비행기 현황" 카드 — 이슈 먼저, 그다음 예측 지도와 편별 목록.
// 지도 위 위치는 실제 위치가 아니라 일정으로 계산한 예측이다(화면에 그대로 적는다).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi';
import { WORLD_VIEW, WORLD_LAND_PATH, projectLonLat } from '../../lib/importFlightWorldPath';

const REFRESH_MS = 5 * 60 * 1000;
const STATUS_STYLE = {
  in_flight: { bg: '#e3f0ff', ink: '#0b57a4', dot: '#1668c7' },
  before_departure: { bg: '#f1f3f5', ink: '#495057', dot: '#868e96' },
  awaiting_awb: { bg: '#fff4d6', ink: '#8a5a00', dot: '#d99a00' },
  arrived: { bg: '#e6f6ea', ink: '#1d6b33', dot: '#2f9e4f' },
  registered: { bg: '#eef0f2', ink: '#6c757d', dot: '#adb5bd' },
};
const fmt = n => Number(n || 0).toLocaleString();

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
      if (!seen.has(f.origin.code)) seen.set(f.origin.code, { code: f.origin.code, name: f.origin.name, lat: f.origin.lat, lon: f.origin.lon, d: routePath(f.route), via: /경유/.test(f.note || '') });
    }
    return [...seen.values()];
  }, [flights]);
  const dest = destination ? projectLonLat(destination.lon, destination.lat) : null;
  const planes = flights.filter(f => f.position && (f.status === 'in_flight' || f.status === 'before_departure'));
  return (
    <svg viewBox={`0 0 ${WORLD_VIEW.width} ${WORLD_VIEW.height}`} role="img" aria-label="수입 비행기 예측 위치 지도"
      style={{ width: '100%', height: 'auto', display: 'block', background: '#eef4fa', borderRadius: 6, border: '1px solid #d7e0ea' }}>
      <path d={WORLD_LAND_PATH} fill="#d5dee8" stroke="#aebccb" strokeWidth="0.4" />
      {routes.map(r => (
        <path key={r.code} d={r.d} fill="none" stroke="#5b8fd1" strokeWidth="1" strokeDasharray={r.via ? '3 3' : undefined} opacity="0.75" />
      ))}
      {routes.map(r => {
        const p = projectLonLat(r.lon, r.lat);
        return (
          <g key={`o-${r.code}`}>
            <circle cx={p.x} cy={p.y} r="2.6" fill="#fff" stroke="#3b6fb5" strokeWidth="1" />
            <text x={p.x + 4} y={p.y - 4} fontSize="8" fill="#33475b">{r.name}</text>
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
                {f.country} {Math.round((f.progress || 0) * 100)}%
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

export default function ImportFlightBoard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet('/api/import/flight-board');
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

  const flights = data?.flights || [];
  const active = flights.filter(f => f.status !== 'registered');
  const done = flights.filter(f => f.status === 'registered');
  const shown = showDone ? flights : active;
  const selected = flights.find(f => f.key === selectedKey) || null;
  const s = data?.summary || {};

  return (
    <div className="card" style={{ marginBottom: 6 }} data-testid="import-flight-board">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="card-title">■ 수입 비행기 현황</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          지도 위 위치는 도착 공지 일정으로 계산한 <b>예측</b>입니다 · 실제 위치는 편별 「실제 위치」 버튼
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
          {data?.generatedAt ? `${shortTime(data.generatedAt)} 기준` : ''}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => { setLoading(true); load(); }} disabled={loading}>새로고침</button>
      </div>

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
            <span style={{ padding: '3px 10px', borderRadius: 12, background: s.issues ? '#ffe3e3' : '#f1f3f5', color: s.issues ? '#b02a2a' : '#6c757d', fontWeight: 700 }}>이슈 {fmt(s.issues)}</span>
          </div>

          {data.issues?.length > 0 && (
            <div style={{ border: '1px solid #f3c2c2', background: '#fff5f5', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b02a2a', marginBottom: 2 }}>확인이 필요한 비행기</div>
              {data.issues.slice(0, 8).map((it, i) => (
                <div key={`${it.key}-${i}`} style={{ fontSize: 12, lineHeight: 1.6, cursor: 'pointer' }} onClick={() => setSelectedKey(it.key)}>
                  <b>{it.label}</b> — {it.text}
                </div>
              ))}
              {data.issues.length > 8 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>외 {data.issues.length - 8}건은 아래 목록에서 확인</div>}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 8, alignItems: 'start' }} className="import-flight-grid">
            <div>
              <FlightMap flights={flights} destination={data.destination} selectedKey={selectedKey} onSelect={setSelectedKey} />
              {selected && (
                <div style={{ marginTop: 6, border: '1px solid #d7e0ea', borderRadius: 6, padding: '6px 10px', fontSize: 12, lineHeight: 1.7 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{selected.weekLabel}차 {selected.country} {selected.itemLabel}</b>
                    <StatusChip f={selected} />
                    <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedKey('')}>닫기</button>
                  </div>
                  <div>항공사 {selected.airline || '-'} · 편명 {selected.flight || '아직 없음'} · 빌번호 {selected.awb || '아직 없음'}</div>
                  <div>
                    {selected.origin ? `${selected.origin.name}${selected.origin.assumed ? '(출발 도시 추정)' : ''} → 인천` : '출발지 미확인'}
                    {selected.departAtEstimated ? ` · 출발 예측 ${shortTime(selected.departAtEstimated)}` : ''} · 도착 예정 {arrivalText(selected)}
                  </div>
                  <div style={{ color: 'var(--text3)' }}>{selected.note}</div>
                  <div>
                    실린 것({selected.contents.source} 기준{selected.contents.farms ? `, 농장 ${fmt(selected.contents.farms)}곳` : ''}): {selected.contents.items.length
                      ? selected.contents.items.map(it => `${it.name} ${fmt(it.box)}박스`).join(' · ')
                      : `품목 내역 없음${selected.box ? ` (총 ${fmt(selected.box)}박스)` : ''} — 입고 등록 뒤 표시`}
                  </div>
                  {selected.issues.map((t, i) => <div key={i} style={{ color: '#b02a2a' }}>⚠ {t}</div>)}
                </div>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12 }}>
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
                    <tr key={f.key} onClick={() => setSelectedKey(f.key)} style={{ cursor: 'pointer', background: f.key === selectedKey ? '#f0f6ff' : undefined }}>
                      <td>
                        <b>{f.weekLabel}</b> {f.country}
                        {f.issues.length > 0 && <span title={f.issues.join('\n')} style={{ color: '#b02a2a', marginLeft: 4 }}>⚠</span>}
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{f.itemLabel}</div>
                      </td>
                      <td>{f.flight || <span style={{ color: '#b07500' }}>없음</span>}<div style={{ fontSize: 10, color: 'var(--text3)' }}>{f.awb || '빌번호 없음'}</div></td>
                      <td style={{ textAlign: 'right' }}>{f.box ? fmt(f.box) : '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{arrivalText(f)}</td>
                      <td><StatusChip f={f} /></td>
                      <td onClick={e => e.stopPropagation()}>
                        {f.links?.flightTrack
                          ? <a href={f.links.flightTrack} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', whiteSpace: 'nowrap' }}>실제 위치 ↗</a>
                          : <span style={{ color: 'var(--text3)' }}>-</span>}
                      </td>
                    </tr>
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
        @media (max-width: 900px) {
          :global(.import-flight-grid) { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
