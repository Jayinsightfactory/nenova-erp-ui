// pages/incoming-price.js — 입고단가 / 농장 송금 관리
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import { apiGet } from '../lib/useApi';

const fmtUSD = v => v == null ? '' : `$${Number(v).toFixed(2)}`;
const fmtUSDInt = v => v == null ? '' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function IncomingPricePage() {
  const [allWeeks, setAllWeeks] = useState([]);
  const [selectedWeeks, setSelectedWeeks] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [includeFreight, setIncludeFreight] = useState(false);
  const [credits, setCredits] = useState({});
  const [editCredit, setEditCredit] = useState({});
  const [creditWeek, setCreditWeek] = useState('');  // 크레딧 저장용 단일 차수
  const [saving, setSaving] = useState({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiGet('/api/incoming-price').then(d => {
      if (d.success) setAllWeeks(d.weeks || []);
    });
  }, []);

  const toggleWeek = (w) => {
    setSelectedWeeks(prev =>
      prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]
    );
  };

  const loadData = useCallback(async (weeks) => {
    if (!weeks.length) { setData(null); return; }
    setLoading(true);
    setData(null);
    try {
      const d = await apiGet('/api/incoming-price', { weeks: weeks.join(',') });
      if (d.success) {
        setData(d);
        setCredits(d.credits || {});
        const init = {};
        for (const farm of (d.farms || [])) {
          const c = d.credits?.[farm];
          init[farm] = { creditUSD: c?.creditUSD ?? '', memo: c?.memo ?? '' };
        }
        setEditCredit(init);
        // 크레딧 저장 기본 차수: 마지막 선택 차수
        setCreditWeek(weeks[weeks.length - 1] || '');
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(selectedWeeks); }, [selectedWeeks, loadData]);

  const saveCredit = async (farm) => {
    if (!creditWeek) return;
    setSaving(p => ({ ...p, [farm]: true }));
    try {
      const ec = editCredit[farm] || {};
      const res = await fetch('/api/incoming-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ farmName: farm, orderWeek: creditWeek, creditUSD: Number(ec.creditUSD) || 0, memo: ec.memo || '' }),
      });
      const d = await res.json();
      if (d.success) {
        setCredits(p => ({ ...p, [farm]: { creditUSD: Number(ec.creditUSD) || 0, memo: ec.memo || '' } }));
        setMsg(`✅ ${farm} 크레딧 저장 (${creditWeek})`);
        setTimeout(() => setMsg(''), 2500);
      }
    } finally { setSaving(p => ({ ...p, [farm]: false })); }
  };

  const [selCountries,    setSelCountries]    = useState([]);
  const [selFlowers,      setSelFlowers]      = useState([]);
  const [expandedFlowers, setExpandedFlowers] = useState(new Set());

  // 데이터 변경 시 필터·확장 초기화
  useEffect(() => { setSelCountries([]); setSelFlowers([]); setExpandedFlowers(new Set()); }, [data]);

  const farms  = data?.farms  || [];
  const rows   = data?.rows   || [];
  const totals = data?.totals || {};

  const allCountries = [...new Set(rows.map(r => r.country).filter(Boolean))].sort();
  const allFlowers   = [...new Set(rows.map(r => r.flower ).filter(Boolean))].sort();

  const toggle = (setter, val) =>
    setter(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);

  const toggleFlowerExpand = (key) =>
    setExpandedFlowers(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  // 필터 적용된 행
  const filteredRows = [...rows]
    .filter(r => selCountries.length === 0 || selCountries.includes(r.country))
    .filter(r => selFlowers.length   === 0 || selFlowers.includes(r.flower))
    .sort((a, b) =>
      (a.country||'').localeCompare(b.country||'') ||
      (a.flower||'').localeCompare(b.flower||'') ||
      (a.prodName||'').localeCompare(b.prodName||'')
    );

  // 데이터 있는 농장만 표시
  const activeFarms = farms.filter(farm =>
    filteredRows.some(r => (r.prices[farm]?.tPrice || 0) > 0)
  );

  // 꽃별 그룹핑
  const flowerGroups = [];
  const seen = new Set();
  for (const r of filteredRows) {
    const key = `${r.country}||${r.flower}`;
    if (!seen.has(key)) {
      seen.add(key);
      flowerGroups.push({ key, country: r.country, flower: r.flower, rows: [] });
    }
    flowerGroups[flowerGroups.length - 1].rows.push(r);
  }

  // 꽃 그룹별 농장 합계
  const groupFarmTotal = (group, farm) =>
    group.rows.reduce((s, r) => s + (r.prices[farm]?.tPrice || 0), 0);

  // 필터 적용된 농장 소계 재계산
  const filteredTotals = {};
  for (const farm of activeFarms) {
    filteredTotals[farm] = {
      subtotal: filteredRows.reduce((s, r) => s + (r.prices[farm]?.tPrice || 0), 0),
      freightTPrice: totals[farm]?.freightTPrice || 0,
    };
  }

  const getFarmTotal = (farm) => {
    const t = filteredTotals[farm] || {};
    return (t.subtotal || 0) + (includeFreight ? (t.freightTPrice || 0) : 0);
  };

  const getNetPayment = (farm) => getFarmTotal(farm) - (Number(credits[farm]?.creditUSD) || 0);

  return (
    <Layout title="입고단가 / 농장 송금">
      <Head><title>입고단가 · NENOVA</title></Head>
      <div style={{ padding: '16px 20px', minHeight: '100vh', background: '#f8f9fa' }}>

        {/* 상단 컨트롤 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a237e' }}>입고단가 / 농장 송금</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeFreight} onChange={e => setIncludeFreight(e.target.checked)} />
              국내 운송료 포함
            </label>
            {msg && <span style={{ color: '#388e3c', fontWeight: 600 }}>{msg}</span>}
          </div>

          {/* 차수 토글 버튼 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#666', marginRight: 4 }}>차수 선택:</span>
            {allWeeks.length === 0 && (
              <span style={{ fontSize: 12, color: '#aaa' }}>로딩 중…</span>
            )}
            {allWeeks.map(w => {
              const active = selectedWeeks.includes(w);
              return (
                <button
                  key={w}
                  onClick={() => toggleWeek(w)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: active ? '2px solid #1a237e' : '1px solid #bbb',
                    background: active ? '#1a237e' : '#fff',
                    color: active ? '#fff' : '#333',
                    fontWeight: active ? 700 : 400,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {w}
                </button>
              );
            })}
            {selectedWeeks.length > 0 && (
              <button
                onClick={() => setSelectedWeeks([])}
                style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid #e0e0e0', background: '#f5f5f5', color: '#888', fontSize: 12, cursor: 'pointer' }}
              >
                전체 해제
              </button>
            )}
          </div>

          {selectedWeeks.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
              선택된 차수: <strong style={{ color: '#1a237e' }}>{selectedWeeks.join(', ')}</strong>
              {selectedWeeks.length > 1 && ' (합산 집계)'}
            </div>
          )}

          {/* 국가 필터 */}
          {allCountries.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#666', marginRight: 4, minWidth: 60 }}>국가:</span>
              {allCountries.map(c => {
                const on = selCountries.includes(c);
                return (
                  <button key={c} onClick={() => toggle(setSelCountries, c)}
                    style={{ padding: '3px 10px', borderRadius: 20, border: on ? '2px solid #00695c' : '1px solid #bbb', background: on ? '#00695c' : '#fff', color: on ? '#fff' : '#333', fontWeight: on ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
                    {c}
                  </button>
                );
              })}
              {selCountries.length > 0 && (
                <button onClick={() => setSelCountries([])}
                  style={{ padding: '3px 8px', borderRadius: 20, border: '1px solid #e0e0e0', background: '#f5f5f5', color: '#888', fontSize: 11, cursor: 'pointer' }}>
                  해제
                </button>
              )}
            </div>
          )}

          {/* 꽃 필터 */}
          {allFlowers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 12, color: '#666', marginRight: 4, minWidth: 60 }}>꽃:</span>
              {allFlowers.map(f => {
                const on = selFlowers.includes(f);
                return (
                  <button key={f} onClick={() => toggle(setSelFlowers, f)}
                    style={{ padding: '3px 10px', borderRadius: 20, border: on ? '2px solid #6a1b9a' : '1px solid #bbb', background: on ? '#6a1b9a' : '#fff', color: on ? '#fff' : '#333', fontWeight: on ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
                    {f}
                  </button>
                );
              })}
              {selFlowers.length > 0 && (
                <button onClick={() => setSelFlowers([])}
                  style={{ padding: '3px 8px', borderRadius: 20, border: '1px solid #e0e0e0', background: '#f5f5f5', color: '#888', fontSize: 11, cursor: 'pointer' }}>
                  해제
                </button>
              )}
            </div>
          )}
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>로딩 중…</div>}

        {!loading && data && farms.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>해당 차수의 입고 데이터가 없습니다.</div>
        )}

        {!loading && data && activeFarms.length === 0 && filteredRows.length === 0 && farms.length > 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>필터 조건에 맞는 데이터가 없습니다.</div>
        )}

        {!loading && data && activeFarms.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, background: '#fff', width: '100%', minWidth: activeFarms.length * 130 + 300 }}>
              <thead>
                <tr style={{ background: '#1a237e', color: '#fff' }}>
                  <th style={thS(100)}>국가</th>
                  <th style={thS(110, 'left')}>꽃</th>
                  <th style={thS(200, 'left')}>품목명</th>
                  {activeFarms.map(f => (
                    <th key={f} style={thS(130)}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flowerGroups.filter(group => activeFarms.some(f => groupFarmTotal(group, f) > 0)).map(group => {
                  const expanded = expandedFlowers.has(group.key);
                  const cnt = group.rows.length;
                  return (
                    <>
                      {/* 꽃 요약 행 */}
                      <tr key={group.key}
                        onClick={() => toggleFlowerExpand(group.key)}
                        style={{ background: '#e8eaf6', cursor: 'pointer', borderBottom: '1px solid #c5cae9' }}>
                        <td style={tdS(100, 'center', { fontWeight: 700, color: '#1a237e' })}>{group.country}</td>
                        <td style={{ padding: '7px 8px', fontWeight: 700, color: '#283593' }}>
                          <span style={{ marginRight: 6 }}>{expanded ? '▼' : '▶'}</span>
                          {group.flower}
                          <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 6 }}>({cnt}품목)</span>
                        </td>
                        <td style={tdS(200, 'left', { color: '#aaa', fontSize: 11, paddingLeft: 8 })}>
                          클릭하여 {expanded ? '접기' : '펼치기'}
                        </td>
                        {activeFarms.map(farm => {
                          const total = groupFarmTotal(group, farm);
                          return (
                            <td key={farm} style={tdS(130, 'center', { fontWeight: 700, color: total > 0 ? '#1a237e' : '#ccc' })}>
                              {total > 0 ? fmtUSDInt(total) : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      {/* 세부 품목 행 (펼쳐진 경우) */}
                      {expanded && group.rows.map((row, idx) => (
                        <tr key={`${group.key}-${idx}`} style={{ background: idx % 2 === 0 ? '#fafafa' : '#f3f3f3', borderBottom: '1px solid #eee' }}>
                          <td style={tdS(100, 'center', { color: '#bbb', fontSize: 11 })}></td>
                          <td style={{ padding: '5px 8px', paddingLeft: 24, color: '#888', fontSize: 11 }}></td>
                          <td style={tdS(200, 'left', { paddingLeft: 16, fontSize: 12 })}>
                            {row.displayName || row.prodName}
                          </td>
                          {activeFarms.map(farm => {
                            const p = row.prices[farm];
                            return (
                              <td key={farm} style={tdS(130, 'center', p ? { fontSize: 12 } : { color: '#ddd' })}>
                                {p ? (
                                  <span title={`합계: ${fmtUSDInt(p.tPrice)}`}>
                                    {fmtUSD(p.uPrice)}
                                  </span>
                                ) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  );
                })}

                {/* 운송료 행 */}
                <tr style={{ background: '#e8f5e9', fontStyle: 'italic' }}>
                  <td style={tdS(100, 'center', { color: '#388e3c' })}>운송료</td>
                  <td colSpan={2} style={tdS(290, 'left', { paddingLeft: 8, color: '#388e3c' })}>국내 운송비</td>
                  {activeFarms.map(farm => {
                    const fr = filteredTotals[farm]?.freightTPrice || 0;
                    return (
                      <td key={farm} style={tdS(130, 'center', { color: fr > 0 ? '#388e3c' : '#ccc' })}>
                        {fr > 0 ? fmtUSDInt(fr) : '—'}
                      </td>
                    );
                  })}
                </tr>

                {/* 구분선 */}
                <tr><td colSpan={3 + activeFarms.length} style={{ height: 4, background: '#1a237e' }} /></tr>

                {/* 소계 */}
                <tr style={{ background: '#e3f2fd', fontWeight: 700 }}>
                  <td colSpan={3} style={tdS(390, 'right', { paddingRight: 12 })}>
                    소계 {includeFreight ? '(운송료 포함)' : '(운송료 제외)'}
                  </td>
                  {activeFarms.map(farm => (
                    <td key={farm} style={tdS(130, 'center', { color: '#1a237e' })}>
                      {fmtUSDInt(getFarmTotal(farm))}
                    </td>
                  ))}
                </tr>

                {/* 크레딧 입력 */}
                <tr style={{ background: '#fff3e0' }}>
                  <td colSpan={3} style={tdS(390, 'right', { paddingRight: 12, color: '#e65100', fontWeight: 600 })}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span>크레딧 차감 (불량/반품)</span>
                      {selectedWeeks.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                          <span style={{ color: '#888' }}>저장할 차수:</span>
                          <select
                            value={creditWeek}
                            onChange={e => setCreditWeek(e.target.value)}
                            style={{ fontSize: 11, padding: '1px 4px', border: '1px solid #ffb74d', borderRadius: 3 }}
                          >
                            {selectedWeeks.map(w => <option key={w} value={w}>{w}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </td>
                  {activeFarms.map(farm => (
                    <td key={farm} style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#888' }}>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editCredit[farm]?.creditUSD ?? ''}
                            onChange={e => setEditCredit(p => ({ ...p, [farm]: { ...(p[farm]||{}), creditUSD: e.target.value } }))}
                            style={{ width: 70, padding: '2px 4px', border: '1px solid #ffb74d', borderRadius: 4, fontSize: 12, textAlign: 'right' }}
                            placeholder="0.00"
                          />
                        </div>
                        <input
                          type="text"
                          value={editCredit[farm]?.memo ?? ''}
                          onChange={e => setEditCredit(p => ({ ...p, [farm]: { ...(p[farm]||{}), memo: e.target.value } }))}
                          placeholder="메모 (사유)"
                          style={{ width: 100, padding: '2px 4px', border: '1px solid #ffb74d', borderRadius: 4, fontSize: 11 }}
                        />
                        <button
                          onClick={() => saveCredit(farm)}
                          disabled={saving[farm] || !creditWeek}
                          style={{ fontSize: 11, padding: '2px 8px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                        >
                          {saving[farm] ? '…' : '저장'}
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* 최종 송금액 */}
                <tr style={{ background: '#1a237e', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                  <td colSpan={3} style={tdS(390, 'right', { paddingRight: 12, color: '#fff' })}>
                    💸 최종 송금액
                  </td>
                  {activeFarms.map(farm => {
                    const net = getNetPayment(farm);
                    return (
                      <td key={farm} style={tdS(130, 'center', { color: net < 0 ? '#ff5252' : '#a5d6a7', fontWeight: 700 })}>
                        {fmtUSDInt(net)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>

            {/* 농장별 요약 카드 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
              {activeFarms.map(farm => {
                const total  = getFarmTotal(farm);
                const credit = Number(credits[farm]?.creditUSD) || 0;
                const net    = total - credit;
                return (
                  <div key={farm} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '12px 16px', minWidth: 200, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontWeight: 700, color: '#1a237e', marginBottom: 6, fontSize: 14 }}>{farm}</div>
                    <div style={{ fontSize: 13, color: '#555' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>소계</span>
                        <span style={{ fontWeight: 600 }}>{fmtUSDInt(total)}</span>
                      </div>
                      {credit > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e65100' }}>
                          <span>크레딧</span>
                          <span>- {fmtUSDInt(credit)}</span>
                        </div>
                      )}
                      {credits[farm]?.memo && (
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{credits[farm].memo}</div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', marginTop: 6, paddingTop: 6, fontWeight: 700, color: net < 0 ? '#c62828' : '#1b5e20' }}>
                        <span>송금액</span>
                        <span>{fmtUSDInt(net)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && !data && selectedWeeks.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 15 }}>
            위에서 차수를 선택하면 농장별 입고단가와 송금액을 확인할 수 있습니다.
          </div>
        )}
      </div>
    </Layout>
  );
}

function thS(w, align = 'center') {
  return { width: w, minWidth: w, padding: '8px 6px', textAlign: align, borderRight: '1px solid rgba(255,255,255,0.2)', fontSize: 12, fontWeight: 700 };
}
function tdS(w, align = 'center', extra = {}) {
  return { width: w, minWidth: w, padding: '6px 6px', textAlign: align, borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #eee', fontSize: 13, ...extra };
}
