// ECOUNT·전산 차수 비교 — 차수를 고르면 그 차수의 ECOUNT 판매현황(매출일=화요일)과 전산 매출(확정 출고 + 차감·판매요청 견적)을
// 거래처×품목 라인으로 대조하고, 다른 값만 바로 보여준다. 업로드(매출일 23:59) 뒤 전산이 바뀐 라인은 "이카운트 반영 필요" 배지.
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지.
import { useState, useEffect, useCallback, Fragment } from 'react';

const fmt = (n) => Number(n || 0).toLocaleString();
const qf = (n) => (Number.isInteger(Number(n)) ? fmt(n) : Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const diffColor = (d) => (Math.abs(d) < 1 ? '#16a34a' : d > 0 ? '#dc2626' : '#2563eb');
const TYPE_STYLE = {
  '이카운트에만': { bg: '#fee2e2', fg: '#991b1b' },
  '전산에만': { bg: '#dbeafe', fg: '#1e3a8a' },
  '수량 차이': { bg: '#ffedd5', fg: '#9a3412' },
  '단가 차이(수량 동일)': { bg: '#fef9c3', fg: '#854d0e' },
  '일치': { bg: '#dcfce7', fg: '#166534' },
};

function defaultWeek() {
  // 기본 = 지난 화요일(최근 매출일)에 해당하는 2026년 차수. 2026-01-06 기준 7일 분할.
  const now = new Date();
  const base = new Date(2026, 0, 6, 12);
  const w = Math.floor((now - base) / (7 * 86400e3)) + 1;
  return Math.min(53, Math.max(1, w));
}

const btn = (extra = {}) => ({ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', ...extra });
const th = { padding: '6px 8px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, verticalAlign: 'top' };
const r = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function EcountWeekComparePage() {
  const [year, setYear] = useState(2026);
  const [week, setWeek] = useState(defaultWeek());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [open, setOpen] = useState({});     // 거래처 접기/펼치기
  const [detail, setDetail] = useState({}); // 라인 상세(원라인·이력) 펼치기

  const load = useCallback(async (y = year, w = week) => {
    setLoading(true); setErr(''); setDetail({});
    try {
      const res = await fetch(`/api/ecount/week-compare?year=${y}&week=${w}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      const o = {}; for (const c of d.byCust) o[c.key] = true; setOpen(o); // 기본 전부 펼침
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [year, week]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const go = (w) => { const nw = Math.min(53, Math.max(1, w)); setWeek(nw); load(year, nw); };

  const s = data?.summary;
  const custs = (data?.byCust || [])
    .map((c) => ({ ...c, lines: c.lines.filter((l) => (onlyDiff ? Math.abs(l.diff) >= 1 : true)) }))
    .filter((c) => c.lines.length > 0);

  const downloadCsv = () => {
    if (!data) return;
    const rows = [['차수', '매출일', '거래처', '품목/유형', '유형', '이카운트 수량', '이카운트 공급가', '전산 수량', '전산 공급가', '수량 차이', '금액 차이(이카운트−전산)', '이카운트 반영 필요', '업로드 후 전산 변경']];
    for (const c of custs) for (const l of c.lines) rows.push([
      `${data.week}차`, data.saleDate, c.name, l.name, l.type, l.ecQty, l.ecAmt, l.erpQty, l.erpAmt, l.qtyDiff, l.diff,
      l.needUpload ? 'Y' : '', l.lateChanges.map((h) => `${h.at} ${h.changeId} ${h.changeType} ${h.before ?? ''}→${h.after ?? ''} ${h.descr || ''}`.trim()).join(' | '),
    ]);
    const csv = rows.map((rw) => rw.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ecount-week-compare-${data.year}-${String(data.week).padStart(2, '0')}${onlyDiff ? '-diff' : ''}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>📊 ECOUNT·전산 차수 비교</h1>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
        차수의 <b>ECOUNT 판매현황(매출일 = 화요일)</b>과 <b>전산 매출(확정 출고 + 차감·판매요청 견적)</b>을 거래처×품목 라인으로 대조합니다.
        매출일 23:59 이후 전산이 바뀌어 이카운트와 다른 라인은 <b style={{ color: '#b45309' }}>이카운트 반영 필요</b> 배지가 붙습니다. (차이 = 이카운트 − 전산)
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>차수</span>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} min={2024} max={2030}
          style={{ width: 70, border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 8px', fontSize: 14 }} />
        <button style={btn()} onClick={() => go(week - 1)} disabled={loading || week <= 1} title="이전 차수">◀</button>
        <input type="number" value={week} min={1} max={53} onChange={(e) => setWeek(Number(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') go(Number(e.target.value)); }}
          style={{ width: 64, border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 8px', fontSize: 14, textAlign: 'center' }} />
        <span style={{ fontSize: 13, color: '#334155' }}>차</span>
        <button style={btn()} onClick={() => go(week + 1)} disabled={loading || week >= 53} title="다음 차수">▶</button>
        <button onClick={() => load()} disabled={loading}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {loading ? '조회 중…' : '조회'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569', marginLeft: 6 }}>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          차이만 (|차이| ≥ 1원)
        </label>
        <button style={btn({ marginLeft: 'auto' })} onClick={downloadCsv} disabled={!data}>⬇ 엑셀(CSV)</button>
      </div>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>⚠️ {err}</div>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
          {[
            ['차수', `${data.year}년 ${data.week}차`],
            ['매출일(이카운트)', data.saleDate],
            ['이카운트 합계', data.noEcount ? '—' : `${fmt(s.ecTotal)}원`],
            ['전산 합계', `${fmt(s.erpTotal)}원`],
            ['차이(이카운트−전산)', data.noEcount ? '—' : `${fmt(s.diff)}원`, data.noEcount ? '#64748b' : diffColor(s.diff)],
            ['차이 라인 수', data.noEcount ? '—' : `${s.diffLines} / ${s.totalLines}`],
            ['반영 필요 라인', `${s.lateLines}`, s.lateLines ? '#b45309' : undefined],
            ['스냅샷', data.snapshotKey ? `#${data.snapshotKey}` : '없음', undefined, data.takenAt ? `수집 ${data.takenAt}` : ''],
          ].map(([label, value, color, sub]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: color || '#0f172a' }}>{value}</div>
              {sub ? <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div> : null}
            </div>
          ))}
        </div>
      )}

      {data?.noEcount && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>
          이카운트 수집 데이터 없음(매출일 {data.saleDate}). 아래는 전산 합계·라인만 표시합니다. (전산 라인은 전부 "전산에만"으로 보입니다)
        </div>
      )}

      {data && custs.length === 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #22c55e', color: '#166534', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
          {onlyDiff ? '차이 나는 라인이 없습니다. 이카운트와 전산이 일치합니다.' : '라인이 없습니다.'}
        </div>
      )}

      {custs.map((c) => (
        <div key={c.key} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
          <div onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: '#f8fafc', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748b', width: 14 }}>{open[c.key] ? '▼' : '▶'}</span>
            <b style={{ fontSize: 14 }}>{c.name}</b>
            {c.needUpload && <span style={{ fontSize: 11, background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d', borderRadius: 999, padding: '1px 8px', fontWeight: 700 }}>이카운트 반영 필요</span>}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>
              이카운트 <b>{fmt(c.ec)}</b> · 전산 <b>{fmt(c.erp)}</b> · 차이 <b style={{ color: diffColor(c.diff) }}>{fmt(c.diff)}</b> · 차이 라인 {c.diffLines}
            </span>
          </div>
          {open[c.key] && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>품목 / 유형</th>
                  <th style={th}>판정</th>
                  <th style={{ ...th, ...r }}>이카운트 수량</th>
                  <th style={{ ...th, ...r }}>이카운트 공급가</th>
                  <th style={{ ...th, ...r }}>전산 수량</th>
                  <th style={{ ...th, ...r }}>전산 공급가</th>
                  <th style={{ ...th, ...r }}>수량 차이</th>
                  <th style={{ ...th, ...r }}>금액 차이</th>
                  <th style={th}>업로드 후 전산 변경</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => {
                  const ts = TYPE_STYLE[l.type] || {};
                  const dk = `${c.key}|${l.key}`;
                  return (
                    <Fragment key={l.key}>
                      <tr style={{ background: l.needUpload ? '#fffbeb' : undefined }}>
                        <td style={td}>
                          <span onClick={() => setDetail((d) => ({ ...d, [dk]: !d[dk] }))} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} title="원 라인 보기">
                            {l.name}
                          </span>
                          {l.isType && <span style={{ marginLeft: 6, fontSize: 10, color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 4px' }}>차감·견적</span>}
                          {l.needUpload && <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d', borderRadius: 999, padding: '0 6px', fontWeight: 700 }}>이카운트 반영 필요</span>}
                          {!l.needUpload && l.lateChanged && <span style={{ marginLeft: 6, fontSize: 10, color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 999, padding: '0 6px' }}>업로드 후 변경(현재 일치)</span>}
                        </td>
                        <td style={td}><span style={{ fontSize: 11, background: ts.bg, color: ts.fg, borderRadius: 4, padding: '1px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>{l.type}</span></td>
                        <td style={{ ...td, ...r }}>{l.ecLines.length ? qf(l.ecQty) : '—'}</td>
                        <td style={{ ...td, ...r }}>{l.ecLines.length ? fmt(l.ecAmt) : '—'}</td>
                        <td style={{ ...td, ...r }}>{l.erpLines.length ? qf(l.erpQty) : '—'}</td>
                        <td style={{ ...td, ...r }}>{l.erpLines.length ? fmt(l.erpAmt) : '—'}</td>
                        <td style={{ ...td, ...r, color: Math.abs(l.qtyDiff) >= 0.01 ? '#9a3412' : '#94a3b8' }}>{l.ecLines.length && l.erpLines.length ? qf(l.qtyDiff) : '—'}</td>
                        <td style={{ ...td, ...r, fontWeight: 700, color: diffColor(l.diff) }}>{fmt(l.diff)}</td>
                        <td style={{ ...td, fontSize: 11, color: '#92400e' }}>
                          {l.lateChanges.length === 0 ? <span style={{ color: '#94a3b8' }}>—</span> : l.lateChanges.map((h, i) => (
                            <div key={i}>
                              {h.at} {h.changeId && <b>{h.changeId}</b>} {h.changeType}
                              {h.before != null ? ` ${fmt(h.before)}→${fmt(h.after)}` : h.after != null ? ` ${fmt(h.after)}원` : ''}
                              {h.shipDate ? ` (출고일 ${h.shipDate})` : ''}
                              {h.sdetailKey ? ` #${h.sdetailKey}` : h.estimateKey ? ` 견적#${h.estimateKey}` : ''}
                              {h.descr ? ` "${h.descr}"` : ''}
                            </div>
                          ))}
                        </td>
                      </tr>
                      {detail[dk] && (
                        <tr>
                          <td colSpan={9} style={{ ...td, background: '#f8fafc', fontSize: 11, color: '#334155' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <div>
                                <b>🧾 이카운트 원 라인 ({l.ecLines.length})</b>
                                {l.ecLines.length === 0 ? <div style={{ color: '#94a3b8' }}>없음</div> : l.ecLines.map((x, i) => (
                                  <div key={i}>{x.prod} · {qf(x.qty)}개 · 단가 {fmt(x.unitPrice)} · 공급가 {fmt(x.supplyAmt)}{x.memo ? ` · "${x.memo}"` : ''}</div>
                                ))}
                              </div>
                              <div>
                                <b>📦 전산 원 라인 ({l.erpLines.length})</b>
                                {l.erpLines.length === 0 ? <div style={{ color: '#94a3b8' }}>없음</div> : l.erpLines.map((x, i) => (
                                  <div key={i}>
                                    {x.kind === 'sd'
                                      ? <>#{x.sdetailKey} {x.prod} · {qf(x.qty)}개 · {fmt(x.amt)}원 · 출고일 {x.shipDate}{x.custDel ? ' · 거래처 삭제코드' : ''}{x.prodDel ? ' · 품목 삭제코드' : ''}</>
                                      : <>견적#{x.estimateKey} {x.prod}{x.refProd ? ` (${x.refProd})` : ''} · {qf(x.qty)} · {fmt(x.amt)}원 · 등록 {x.estDate}{x.descr ? ` "${x.descr}"` : ''}</>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {data && (
        <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
          · 매출일 = {data.year === 2026 ? '2026-01-06(화) + 7×(차수−1)' : '그 해 첫 화요일 + 7×(차수−1)'}. 이카운트는 매출일을 포함한 가장 최신 스냅샷(#{data.snapshotKey || '—'}) 한 개만 사용.
          · 전산 = ShipmentDetail(isFix=1, Amount≠0, 삭제 거래처·품목 코드 포함) + Estimate(차감·판매요청, 유형명 단위). 거래처는 별칭표, 품목은 괄호 제거·기호 제거 후 매칭.
          · "업로드 후 전산 변경" = ShipmentHistory ChangeDtm(KST) &gt; {data.cutoff}, 또는 견적 등록일이 매출일 이후. 변경 이력이 있어도 현재 금액이 같으면 배지 없이 회색 표시.
        </p>
      )}
    </div>
  );
}
