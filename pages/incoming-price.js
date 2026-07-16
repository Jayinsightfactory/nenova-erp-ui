// pages/incoming-price.js — 입고단가 / 농장 송금 관리
import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import { apiGet } from '../lib/useApi';
import { formatWeekDisplay } from '../lib/useWeekInput';

const fmtUSD = v => v == null ? '' : `$${Number(v).toFixed(2)}`;
const fmtUSDInt = v => v == null ? '' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function IncomingPricePage() {
  const [allWeeks, setAllWeeks] = useState([]);
  const [selectedWeeks, setSelectedWeeks] = useState([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [years, setYears] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [includeFreight, setIncludeFreight] = useState(false);
  const [sideTab, setSideTab] = useState('pending');
  const [remits, setRemits] = useState([]);          // 송금 기록 (WebFarmRemit, 연도 스코프)
  const [remitModal, setRemitModal] = useState(null); // { farm, amount, date, memo }
  const [remitSaving, setRemitSaving] = useState(false);
  const [creditsRaw, setCreditsRaw] = useState([]);  // [{ farmName, orderWeek, creditUSD, memo }]
  const [editCredit, setEditCredit] = useState({});  // { "farm::week": { creditUSD, memo } }
  const [saving, setSaving] = useState({});
  const [msg, setMsg] = useState('');
  const tableContainerRef = useRef(null);
  const topScrollRef = useRef(null);

  useEffect(() => {
    apiGet('/api/incoming-price', { year }).then(d => {
      if (d.success) { setAllWeeks(d.weeks || []); setYears(d.years || []); }
    });
  }, [year]);

  const loadRemits = useCallback(() => {
    apiGet('/api/incoming-price/remit', { year }).then(d => {
      if (d.success) setRemits(d.remits || []);
    }).catch(() => {});
  }, [year]);
  useEffect(() => { loadRemits(); }, [loadRemits]);

  // 현재 선택 차수와 겹치는 이 농장의 송금 기록
  const farmRemitsOf = (farm) => remits.filter(r =>
    r.farmName === farm &&
    String(r.weeks || '').split(/[,\s]+/).filter(Boolean).some(w => selectedWeeks.includes(w))
  );

  const saveRemit = async () => {
    if (!remitModal) return;
    const amt = parseFloat(remitModal.amount);
    if (Number.isNaN(amt)) { alert('금액을 입력하세요.'); return; }
    setRemitSaving(true);
    try {
      const isEdit = !!remitModal.key;
      const res = await fetch('/api/incoming-price/remit', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(isEdit
          ? { key: remitModal.key, amountUSD: amt, remitDate: remitModal.date, memo: remitModal.memo || '' }
          : {
            year, weeks: selectedWeeks.join(','), farmName: remitModal.farm,
            amountUSD: amt, remitDate: remitModal.date, memo: remitModal.memo || '',
          }),
      });
      const d = await res.json();
      if (d.success) {
        setRemitModal(null);
        loadRemits();
        setMsg(`💸 ${remitModal.farm} 송금 기록 ${isEdit ? '수정' : '저장'}`);
        setTimeout(() => setMsg(''), 2500);
      } else alert(d.error || '저장 실패');
    } finally { setRemitSaving(false); }
  };

  const deleteRemitEntry = async (rm) => {
    if (!confirm(`${rm.farmName} 송금 기록(${rm.remitDate} · $${Number(rm.amountUSD).toFixed(2)})을 삭제하시겠습니까?`)) return;
    const res = await fetch('/api/incoming-price/remit', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key: rm.key }),
    });
    const d = await res.json();
    if (d.success) loadRemits();
    else alert(d.error || '삭제 실패');
  };

  const changeYear = (y) => {
    if (y === year) return;
    setYear(y);
    setSelectedWeeks([]);
    setShowAllWeeks(false);
  };

  const toggleWeek = (w) => {
    setSelectedWeeks(prev =>
      prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]
    );
  };

  const loadData = useCallback(async (weeks) => {
    if (!weeks.length) { setData(null); setCreditsRaw([]); setEditCredit({}); return; }
    setLoading(true);
    setData(null);
    try {
      const d = await apiGet('/api/incoming-price', { weeks: weeks.join(','), year });
      if (d.success) {
        setData(d);
        const raw = d.creditsRaw || [];
        setCreditsRaw(raw);
        // editCredit 초기화: farm::week 키로
        const init = {};
        for (const c of raw) {
          const k = `${c.farmName}::${c.orderWeek}`;
          init[k] = { creditUSD: c.creditUSD ?? '', memo: c.memo ?? '' };
        }
        // 크레딧 없는 farm×week 도 빈 값으로 초기화
        for (const farm of (d.farms || [])) {
          for (const w of weeks) {
            const k = `${farm}::${w}`;
            if (!init[k]) init[k] = { creditUSD: '', memo: '' };
          }
        }
        setEditCredit(init);
      }
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { loadData(selectedWeeks); }, [selectedWeeks, loadData]);

  // farm의 전체 크레딧 합산 (creditsRaw + 미저장 editCredit 반영)
  const getFarmCredit = (farm) =>
    selectedWeeks.reduce((sum, w) => {
      const ec = editCredit[`${farm}::${w}`];
      return sum + (Number(ec?.creditUSD) || 0);
    }, 0);

  const saveCredit = async (farm, week) => {
    const k = `${farm}::${week}`;
    setSaving(p => ({ ...p, [k]: true }));
    try {
      const ec = editCredit[k] || {};
      const res = await fetch('/api/incoming-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ farmName: farm, orderWeek: week, creditUSD: Number(ec.creditUSD) || 0, memo: ec.memo || '' }),
      });
      const d = await res.json();
      if (d.success) {
        // creditsRaw 로컬 업데이트 (재로드 없이 정확한 합산 유지)
        setCreditsRaw(prev => {
          const others = prev.filter(c => !(c.farmName === farm && c.orderWeek === week));
          return [...others, { farmName: farm, orderWeek: week, creditUSD: Number(ec.creditUSD) || 0, memo: ec.memo || '' }];
        });
        setMsg(`✅ ${farm} 크레딧 저장 (${week})`);
        setTimeout(() => setMsg(''), 2500);
      }
    } finally { setSaving(p => ({ ...p, [`${farm}::${week}`]: false })); }
  };

  const deleteCredit = async (farm, week) => {
    if (!confirm(`${farm} / ${week} 크레딧을 삭제하시겠습니까?`)) return;
    const k = `${farm}::${week}`;
    setSaving(p => ({ ...p, [k]: true }));
    try {
      const res = await fetch('/api/incoming-price', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ farmName: farm, orderWeek: week }),
      });
      const d = await res.json();
      if (d.success) {
        setCreditsRaw(prev => prev.filter(c => !(c.farmName === farm && c.orderWeek === week)));
        setEditCredit(p => ({ ...p, [k]: { creditUSD: '', memo: '' } }));
        setMsg(`🗑 ${farm} 크레딧 삭제 (${week})`);
        setTimeout(() => setMsg(''), 2500);
      }
    } finally { setSaving(p => ({ ...p, [k]: false })); }
  };

  const [selCountries,    setSelCountries]    = useState([]);
  const [selFlowers,      setSelFlowers]      = useState([]);
  const [expandedFlowers, setExpandedFlowers] = useState(new Set());
  const [showAllWeeks,    setShowAllWeeks]    = useState(false);

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

  const getNetPayment = (farm) => getFarmTotal(farm) - getFarmCredit(farm);

  const farmSummaries = activeFarms.map(farm => {
    const total = getFarmTotal(farm);
    const credit = getFarmCredit(farm);
    const net = total - credit;
    const savedEntries = creditsRaw
      .filter(c => c.farmName === farm && selectedWeeks.includes(c.orderWeek))
      .filter(c => (Number(c.creditUSD) || 0) !== 0 || String(c.memo || '').trim() !== '');
    const remitEntries = farmRemitsOf(farm);
    const remitTotal = remitEntries.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
    const hasRemit = remitEntries.length > 0;
    // 부분송금: 기록은 있으나 기송금 합계가 최종 송금액에 못 미침 (1센트 허용오차)
    const isFull = hasRemit && remitTotal >= net - 0.005;
    return {
      farm, total, credit, net, savedEntries,
      hasSavedInput: savedEntries.length > 0,
      remitEntries, hasRemit, remitTotal,
      isFull, isPartial: hasRemit && !isFull,
    };
  });
  const remittedFarmSummaries = farmSummaries.filter(f => f.isFull);
  const savedFarmSummaries = farmSummaries.filter(f => !f.isFull && f.hasSavedInput);
  const pendingFarmSummaries = farmSummaries.filter(f => !f.isFull && !f.hasSavedInput && f.net > 0);
  const activeSideRows = sideTab === 'saved' ? savedFarmSummaries
    : sideTab === 'remitted' ? remittedFarmSummaries : pendingFarmSummaries;

  return (
    <Layout title="입고단가 / 농장 송금">
      <Head><title>입고단가 · NENOVA</title></Head>
      <div style={{ padding: '16px 20px', minHeight: '100vh', background: '#f8f9fa' }}>
        <style jsx>{`
          .incoming-price-workspace {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
          }
          @media (max-width: 1100px) {
            .incoming-price-workspace {
              grid-template-columns: 1fr;
            }
          }
        `}</style>

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

          {/* 기준연도 선택 — 차수번호는 매년 반복되므로 연도별로 목록·집계 분리 */}
          {years.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#666', marginRight: 4 }}>기준연도:</span>
              {years.map(y => (
                <button key={y} onClick={() => changeYear(y)}
                  style={{
                    padding: '4px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                    border: y === year ? '2px solid #1a237e' : '1px solid #bbb',
                    background: y === year ? '#1a237e' : '#fff',
                    color: y === year ? '#fff' : '#333', fontWeight: y === year ? 700 : 400,
                  }}>
                  {y}년
                </button>
              ))}
            </div>
          )}

          {/* 차수 토글 버튼 — 기본은 최근 20개만, 나머지는 펼치기 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#666', marginRight: 4 }}>차수 선택:</span>
            {allWeeks.length === 0 && (
              <span style={{ fontSize: 12, color: '#aaa' }}>로딩 중…</span>
            )}
            {allWeeks.filter((w, i) => showAllWeeks || i < 20 || selectedWeeks.includes(w)).map(w => {
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
                  {formatWeekDisplay(w)}
                </button>
              );
            })}
            {allWeeks.length > 20 && (
              <button
                onClick={() => setShowAllWeeks(v => !v)}
                style={{ padding: '4px 10px', borderRadius: 20, border: '1px dashed #9fa8da', background: '#f6f8ff', color: '#3949ab', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                {showAllWeeks ? '접기 ▲' : `이전 차수 ${allWeeks.length - 20}개 더 ▼`}
              </button>
            )}
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
              선택된 차수: <strong style={{ color: '#1a237e' }}>{selectedWeeks.map(formatWeekDisplay).join(', ')}</strong>
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

        {/* 꽃 필터 바로 아래 가로 스크롤바 */}
        {!loading && data && activeFarms.length > 0 && (
          <div
            ref={topScrollRef}
            style={{ overflowX: 'auto', overflowY: 'hidden', height: 10, marginBottom: 4, marginTop: 2 }}
            onScroll={e => { if (tableContainerRef.current) tableContainerRef.current.scrollLeft = e.target.scrollLeft; }}
          >
            <div style={{ width: activeFarms.length * 130 + 410, height: 1 }} />
          </div>
        )}

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>로딩 중…</div>}

        {!loading && data && farms.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>해당 차수의 입고 데이터가 없습니다.</div>
        )}

        {!loading && data && activeFarms.length === 0 && filteredRows.length === 0 && farms.length > 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>필터 조건에 맞는 데이터가 없습니다.</div>
        )}

        {!loading && data && activeFarms.length > 0 && (
          <div className="incoming-price-workspace" style={{ gap: 16, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
            {/* 펼침/접힘 툴바 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <button onClick={() => setExpandedFlowers(new Set(flowerGroups.map(g => g.key)))}
                style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #c5cae9', background: '#fff', color: '#3949ab', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                ▼ 전체 펼치기
              </button>
              <button onClick={() => setExpandedFlowers(new Set())}
                style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #c5cae9', background: '#fff', color: '#3949ab', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                ▲ 전체 접기
              </button>
              <span style={{ fontSize: 11, color: '#999' }}>표는 세로·가로 스크롤 시 제목줄과 품목명이 고정됩니다</span>
            </div>
            {/* 메인 테이블 */}
            <div
              ref={tableContainerRef}
              style={{ overflow: 'auto', maxHeight: '72vh', border: '1px solid #e0e0e0', borderRadius: 6 }}
              onScroll={e => { if (topScrollRef.current) topScrollRef.current.scrollLeft = e.target.scrollLeft; }}
            >
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, background: '#fff', width: '100%', minWidth: activeFarms.length * 130 + 410 }}>
              <thead>
                <tr style={{ color: '#fff' }}>
                  <th style={thS(100, 'center', 0)}>국가</th>
                  <th style={thS(110, 'left', 100)}>꽃</th>
                  <th style={thS(200, 'left', 210)}>품목명</th>
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
                        style={{ background: '#e8eaf6', cursor: 'pointer' }}>
                        <td style={tdL(0, 100, '#e8eaf6', 'center', { fontWeight: 700, color: '#1a237e' })}>{group.country}</td>
                        <td style={tdL(100, 110, '#e8eaf6', 'left', { padding: '7px 8px', fontWeight: 700, color: '#283593', whiteSpace: 'nowrap' })}>
                          <span style={{ marginRight: 6 }}>{expanded ? '▼' : '▶'}</span>
                          {group.flower}
                          <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 6 }}>({cnt})</span>
                        </td>
                        <td style={tdL(210, 200, '#e8eaf6', 'left', { color: '#9095c9', fontSize: 11, paddingLeft: 8, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                          {expanded ? '' : group.rows.slice(0, 2).map(r => r.displayName || r.prodName).join(', ') + (cnt > 2 ? ` 외 ${cnt - 2}` : '')}
                        </td>
                        {activeFarms.map(farm => {
                          const total = groupFarmTotal(group, farm);
                          return (
                            <td key={farm} style={tdNum({ fontWeight: 700, color: total > 0 ? '#1a237e' : '#ddd' })}>
                              {total > 0 ? fmtUSDInt(total) : ''}
                            </td>
                          );
                        })}
                      </tr>

                      {/* 세부 품목 행 (펼쳐진 경우) */}
                      {expanded && group.rows.map((row, idx) => {
                        const rowBg = idx % 2 === 0 ? '#fafafa' : '#f3f3f3';
                        return (
                        <tr key={`${group.key}-${idx}`} style={{ background: rowBg }}>
                          <td style={tdL(0, 100, rowBg)}></td>
                          <td style={tdL(100, 110, rowBg)}></td>
                          <td style={tdL(210, 200, rowBg, 'left', { paddingLeft: 16, fontSize: 12 })}>
                            {row.displayName || row.prodName}
                          </td>
                          {activeFarms.map(farm => {
                            const p = row.prices[farm];
                            return (
                              <td key={farm} style={tdNum(p ? { fontSize: 12 } : { color: '#eee' })}>
                                {p ? (
                                  <span title={`합계: ${fmtUSDInt(p.tPrice)}`}>
                                    {fmtUSD(p.uPrice)}
                                  </span>
                                ) : ''}
                              </td>
                            );
                          })}
                        </tr>
                        );
                      })}
                    </>
                  );
                })}

                {/* 운송료 행 */}
                <tr style={{ background: '#e8f5e9', fontStyle: 'italic' }}>
                  <td style={tdL(0, 100, '#e8f5e9', 'center', { color: '#388e3c' })}>운송료</td>
                  <td colSpan={2} style={tdL(100, 310, '#e8f5e9', 'left', { paddingLeft: 8, color: '#388e3c' })}>국내 운송비</td>
                  {activeFarms.map(farm => {
                    const fr = filteredTotals[farm]?.freightTPrice || 0;
                    return (
                      <td key={farm} style={tdNum({ color: fr > 0 ? '#388e3c' : '#ddd' })}>
                        {fr > 0 ? fmtUSDInt(fr) : ''}
                      </td>
                    );
                  })}
                </tr>

                {/* 구분선 */}
                <tr><td colSpan={3 + activeFarms.length} style={{ height: 4, background: '#1a237e' }} /></tr>

                {/* 소계 */}
                <tr style={{ background: '#e3f2fd', fontWeight: 700 }}>
                  <td colSpan={3} style={tdL(0, 410, '#e3f2fd', 'right', { paddingRight: 12 })}>
                    소계 {includeFreight ? '(운송료 포함)' : '(운송료 제외)'}
                  </td>
                  {activeFarms.map(farm => (
                    <td key={farm} style={tdNum({ color: '#1a237e', fontWeight: 700 })}>
                      {fmtUSDInt(getFarmTotal(farm))}
                    </td>
                  ))}
                </tr>

                {/* 크레딧 입력 — 차수 | 비고 | 금액 테이블 */}
                <tr style={{ background: '#fff3e0' }}>
                  <td colSpan={3} style={tdL(0, 410, '#fff3e0', 'right', { paddingRight: 12, color: '#e65100', fontWeight: 600, verticalAlign: 'top' })}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                      <span>크레딧 차감 (불량/반품)</span>
                      <button
                        onClick={() => window.open('/incoming-price/credit-history?popup=1', '크레딧이력', 'width=820,height=600,resizable=yes,scrollbars=yes')}
                        style={{ fontSize: 11, padding: '2px 10px', background: '#fff', border: '1px solid #ffb74d', borderRadius: 4, color: '#e65100', cursor: 'pointer', fontWeight: 600 }}
                      >
                        📋 기록
                      </button>
                    </div>
                  </td>
                  {activeFarms.map(farm => {
                    const savedMemos = creditsRaw.filter(
                      c => c.farmName === farm && selectedWeeks.includes(c.orderWeek) && c.memo
                    );
                    return (
                      <td key={farm} style={{ padding: '4px 6px', verticalAlign: 'top', minWidth: 200 }}>
                        {/* 차수별 입력 */}
                        {selectedWeeks.map(w => {
                          const k = `${farm}::${w}`;
                          const ec = editCredit[k] || {};
                          const isSaving = saving[k];
                          return (
                            <div key={w} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: selectedWeeks.length > 1 ? '1px dashed #ffe0b2' : 'none' }}>
                              {selectedWeeks.length > 1 && (
                                <div style={{ fontSize: 10, color: '#e65100', fontWeight: 700, marginBottom: 3 }}>{w}</div>
                              )}
                              {/* 비고 textarea — 크고 넓게 */}
                              <textarea
                                value={ec.memo ?? ''}
                                onChange={e => setEditCredit(p => ({ ...p, [k]: { ...(p[k]||{}), memo: e.target.value } }))}
                                placeholder="비고 입력…"
                                rows={3}
                                style={{
                                  width: '100%', padding: '4px 6px',
                                  border: '1px solid #ffb74d', borderRadius: 4,
                                  fontSize: 12, boxSizing: 'border-box',
                                  resize: 'vertical', minHeight: 54, lineHeight: 1.5,
                                  fontFamily: 'inherit',
                                }}
                              />
                              {/* 금액 + 버튼 */}
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                                <span style={{ fontSize: 11, color: '#888' }}>$</span>
                                <input
                                  type="number" min="0" step="0.01"
                                  value={ec.creditUSD ?? ''}
                                  onChange={e => setEditCredit(p => ({ ...p, [k]: { ...(p[k]||{}), creditUSD: e.target.value } }))}
                                  style={{ flex: 1, padding: '3px 4px', border: '1px solid #ffb74d', borderRadius: 4, fontSize: 12, textAlign: 'right' }}
                                  placeholder="0.00"
                                />
                                <button onClick={() => saveCredit(farm, w)} disabled={isSaving}
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                                  {isSaving ? '…' : '💾'}
                                </button>
                                <button onClick={() => deleteCredit(farm, w)} disabled={isSaving} title="삭제"
                                  style={{ fontSize: 11, padding: '3px 6px', background: '#fff', border: '1px solid #ffcdd2', color: '#c62828', borderRadius: 4, cursor: 'pointer' }}>
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {/* 저장된 비고 카드 (차수별 분리) */}
                        {savedMemos.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginBottom: 4, letterSpacing: 0.3 }}>💬 저장된 비고</div>
                            {savedMemos.map(c => (
                              <div key={c.orderWeek} style={{
                                background: '#fff8f0', border: '1px solid #ffe0b2',
                                borderLeft: '3px solid #ff9800',
                                borderRadius: 4, padding: '5px 8px', marginBottom: 5,
                                fontSize: 12,
                              }}>
                                <div style={{ fontSize: 10, color: '#e65100', fontWeight: 700, marginBottom: 2 }}>{c.orderWeek}</div>
                                <div style={{ color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.memo}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 합계 (다중 차수) */}
                        {selectedWeeks.length > 1 && (
                          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: '#e65100', textAlign: 'right' }}>
                            합계: {fmtUSDInt(getFarmCredit(farm))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>

                {/* 최종 송금액 — 세로 스크롤 시에도 하단 고정 */}
                <tr style={{ background: '#1a237e', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                  <td colSpan={3} style={{ ...tdL(0, 410, '#1a237e', 'right', { paddingRight: 12, color: '#fff' }), position: 'sticky', bottom: 0, zIndex: 4 }}>
                    💸 최종 송금액
                  </td>
                  {activeFarms.map(farm => {
                    const net = getNetPayment(farm);
                    return (
                      <td key={farm} style={{ ...tdNum({ color: net < 0 ? '#ff5252' : '#a5d6a7', fontWeight: 700, background: '#1a237e' }), position: 'sticky', bottom: 0, zIndex: 3 }}>
                        {fmtUSDInt(net)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            </div>{/* /tableContainerRef */}

            {/* 농장별 요약 카드 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
              {activeFarms.map(farm => {
                const total  = getFarmTotal(farm);
                const credit = getFarmCredit(farm);
                const net    = total - credit;
                const farmRaw = creditsRaw.filter(c => c.farmName === farm && selectedWeeks.includes(c.orderWeek));
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
                      {farmRaw.map(c => c.memo).filter(Boolean).map((m, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{m}</div>
                      ))}
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
            <aside style={{
              position: 'sticky',
              top: 12,
              background: '#fff',
              border: '1px solid #dfe3ee',
              borderRadius: 8,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #e8eaf6', background: '#f6f8ff' }}>
                <button onClick={() => setSideTab('pending')} style={sideTabButtonStyle(sideTab === 'pending', '#c62828')}>
                  송금 필요 {pendingFarmSummaries.length}
                </button>
                <button onClick={() => setSideTab('saved')} style={sideTabButtonStyle(sideTab === 'saved', '#e65100')}>
                  입력 있음 {savedFarmSummaries.length}
                </button>
                <button onClick={() => setSideTab('remitted')} style={sideTabButtonStyle(sideTab === 'remitted', '#2e7d32')}>
                  송금 완료 {remittedFarmSummaries.length}
                </button>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <div style={{ background: '#ffebee', color: '#b71c1c', borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700 }}>송금 필요</div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{pendingFarmSummaries.length}</div>
                  </div>
                  <div style={{ background: '#fff3e0', color: '#e65100', borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700 }}>입력 있음</div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{savedFarmSummaries.length}</div>
                  </div>
                  <div style={{ background: '#e8f5e9', color: '#1b5e20', borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700 }}>송금 완료</div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{remittedFarmSummaries.length}</div>
                  </div>
                </div>
                <button
                  onClick={() => window.open('/incoming-price/ledger?popup=1', '송금크레딧내역', 'width=1150,height=700,resizable=yes,scrollbars=yes')}
                  style={{ width: '100%', marginBottom: 10, padding: '7px 10px', borderRadius: 6, border: '1px solid #c5cae9', background: '#f6f8ff', color: '#1a237e', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                  📒 송금/크레딧 전체 내역 보기
                </button>
                <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 2 }}>
                  {activeSideRows.length === 0 && (
                    <div style={{ padding: '24px 8px', textAlign: 'center', color: '#999', fontSize: 13 }}>
                      표시할 업체가 없습니다.
                    </div>
                  )}
                  {activeSideRows.map(row => (
                    <div key={row.farm} style={{
                      border: '1px solid #edf0f5',
                      borderLeft: `4px solid ${row.isFull ? '#43a047' : row.isPartial ? '#ffa726' : row.hasSavedInput ? '#ffb74d' : '#ef5350'}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                      marginBottom: 8,
                      background: row.isFull ? '#fbfffb' : row.isPartial ? '#fffcf5' : row.hasSavedInput ? '#fffdf8' : '#fffafa',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 800, color: '#1a237e', lineHeight: 1.35 }}>{row.farm}</div>
                        <div style={{ fontSize: 11, color: row.isFull ? '#2e7d32' : row.isPartial ? '#ef6c00' : row.hasSavedInput ? '#e65100' : '#c62828', fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {row.isFull ? '✓ 송금완료' : row.isPartial ? '◐ 부분송금' : row.hasSavedInput ? '입력됨' : '미입력'}
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>소계</span><strong>{fmtUSDInt(row.total)}</strong>
                        </div>
                        {row.credit > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e65100' }}>
                            <span>차감</span><strong>- {fmtUSDInt(row.credit)}</strong>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', marginTop: 6, paddingTop: 6, color: row.net < 0 ? '#c62828' : '#1b5e20' }}>
                          <span>송금액</span><strong>{fmtUSDInt(row.net)}</strong>
                        </div>
                        {row.hasRemit && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2e7d32' }}>
                              <span>기송금</span><strong>- {fmtUSDInt(row.remitTotal)}</strong>
                            </div>
                            {row.isPartial && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef6c00', fontWeight: 700 }}>
                                <span>잔여</span><strong>{fmtUSDInt(row.net - row.remitTotal)}</strong>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {/* 송금 기록 목록 — ✎ 수정 / ✕ 삭제 */}
                      {row.remitEntries.map(rm => (
                        <div key={rm.key} style={{ marginTop: 6, fontSize: 11, color: '#2e7d32', background: '#f0f9f0', borderRadius: 4, padding: '4px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ flex: 1 }}>💸 {rm.remitDate || rm.createDtm?.slice(0, 10)} · {fmtUSDInt(rm.amountUSD)}</span>
                            <button onClick={() => setRemitModal({ key: rm.key, farm: row.farm, amount: String(rm.amountUSD ?? ''), date: rm.remitDate || '', memo: rm.memo || '' })}
                              title="송금 기록 수정"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#1a237e', padding: '0 2px' }}>✎</button>
                            <button onClick={() => deleteRemitEntry(rm)} title="송금 기록 삭제"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#c62828', padding: '0 2px' }}>✕</button>
                          </div>
                          {rm.memo && <div style={{ color: '#666', whiteSpace: 'pre-wrap' }}>{rm.memo}</div>}
                        </div>
                      ))}
                      {row.savedEntries.length > 0 && (
                        <div style={{ marginTop: 8, borderTop: '1px dashed #e0e0e0', paddingTop: 6 }}>
                          {row.savedEntries.map(entry => (
                            <div key={`${row.farm}-${entry.orderWeek}`} style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                              <strong>{entry.orderWeek}</strong>
                              {(Number(entry.creditUSD) || 0) !== 0 && <span> · 차감 {fmtUSDInt(entry.creditUSD)}</span>}
                              {entry.memo && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{entry.memo}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 송금/추가송금 기록 버튼 — 금액은 잔여액 자동 (완납 후 추가는 0) */}
                      <button
                        onClick={() => {
                          const d = new Date();
                          const remain = Math.max(0, Math.round((row.net - row.remitTotal) * 100) / 100);
                          setRemitModal({
                            farm: row.farm,
                            amount: remain.toFixed(2),
                            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                            memo: '',
                          });
                        }}
                        style={{ width: '100%', marginTop: 8, padding: '6px 8px', borderRadius: 5, border: '1px solid #a5d6a7', background: row.hasRemit ? '#fff' : '#e8f5e9', color: '#1b5e20', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                        {row.isPartial ? `💸 추가 송금 기록 (잔여 ${fmtUSDInt(row.net - row.remitTotal)})`
                          : row.isFull ? '＋ 추가 송금 기록'
                          : '💸 송금 기록 남기기'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}

        {!loading && !data && selectedWeeks.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 15 }}>
            위에서 차수를 선택하면 농장별 입고단가와 송금액을 확인할 수 있습니다.
          </div>
        )}

        {/* 송금 기록 모달 */}
        {remitModal && (
          <div onClick={() => !remitSaving && setRemitModal(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 10, padding: '20px 22px', width: 380, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#1a237e', marginBottom: 4 }}>
                💸 송금 기록 {remitModal.key ? '수정' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
                {remitModal.farm} · {year}년 {selectedWeeks.join(', ')}차
                {!remitModal.key && ' · 여러 번 나눠 보낸 경우 건별로 각각 기록하세요 (부분송금 자동 표시)'}
              </div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>송금일</label>
              <input type="date" value={remitModal.date}
                onChange={e => setRemitModal(p => ({ ...p, date: e.target.value }))}
                style={{ width: '100%', padding: '7px 8px', border: '1px solid #bbb', borderRadius: 5, fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }} />
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>송금액 (USD)</label>
              <input type="number" step="0.01" value={remitModal.amount}
                onChange={e => setRemitModal(p => ({ ...p, amount: e.target.value }))}
                style={{ width: '100%', padding: '7px 8px', border: '1px solid #bbb', borderRadius: 5, fontSize: 13, textAlign: 'right', boxSizing: 'border-box', marginBottom: 10, fontVariantNumeric: 'tabular-nums' }} />
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>비고</label>
              <textarea rows={2} value={remitModal.memo} placeholder="예: 우리은행 T/T, 참조번호…"
                onChange={e => setRemitModal(p => ({ ...p, memo: e.target.value }))}
                style={{ width: '100%', padding: '7px 8px', border: '1px solid #bbb', borderRadius: 5, fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', marginBottom: 14 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setRemitModal(null)} disabled={remitSaving}
                  style={{ padding: '7px 16px', borderRadius: 5, border: '1px solid #ccc', background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer' }}>
                  취소
                </button>
                <button onClick={saveRemit} disabled={remitSaving}
                  style={{ padding: '7px 18px', borderRadius: 5, border: 'none', background: '#2e7d32', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
                  {remitSaving ? '저장 중…' : remitModal.key ? '💾 수정 저장' : '💾 송금 기록 저장'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function thS(w, align = 'center', left = null) {
  return {
    width: w, minWidth: w, padding: '8px 6px', textAlign: align, fontSize: 12, fontWeight: 700,
    background: '#1a237e', position: 'sticky', top: 0, zIndex: left != null ? 5 : 3,
    ...(left != null ? { left } : {}),
    borderRight: '1px solid rgba(255,255,255,0.2)', borderBottom: '2px solid #0d1b6e',
  };
}
function tdS(w, align = 'center', extra = {}) {
  return { width: w, minWidth: w, padding: '6px 6px', textAlign: align, borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #eee', fontSize: 13, ...extra };
}
// 좌측 고정 셀 — 가로 스크롤해도 국가/꽃/품목명이 보이도록. bg 는 행 배경과 동일하게 지정
function tdL(left, w, bg, align = 'center', extra = {}) {
  return { ...tdS(w, align, extra), position: 'sticky', left, background: bg, zIndex: 2 };
}
// 금액 셀 — 우측 정렬 + 자릿수 정렬 숫자
function tdNum(extra = {}) {
  return tdS(130, 'right', { paddingRight: 12, fontVariantNumeric: 'tabular-nums', ...extra });
}

function sideTabButtonStyle(active, color) {
  return {
    flex: 1,
    padding: '10px 8px',
    border: 'none',
    borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
    background: active ? '#fff' : 'transparent',
    color: active ? color : '#555',
    fontWeight: 700,
    cursor: 'pointer',
  };
}
