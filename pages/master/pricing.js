// pages/master/pricing.js
// 업체별 품목 단가 관리 — 매트릭스 뷰 (업체×품목 일괄 수정)

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiGet, apiPut } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();
const LS = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const LSset = (key, val) => { try { localStorage.setItem(key, val); } catch {} };

// ── 검색 가능한 드롭다운 컴포넌트
function SearchableSelect({ value, onChange, options, placeholder = '전체', minWidth = 120 }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef();

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <button
        className="filter-input"
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        style={{
          minWidth, textAlign: 'left', cursor: 'pointer',
          display: 'inline-flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
          background: value ? '#EEF4FF' : undefined,
          borderColor: value ? 'var(--blue)' : undefined,
          fontWeight: value ? 700 : 'normal',
        }}
      >
        <span style={{ color: value ? 'inherit' : 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        <span style={{ fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, zIndex: 400,
          background: '#fff', border: '2px solid var(--border2)',
          minWidth: Math.max(minWidth, 160), maxHeight: 280,
          display: 'flex', flexDirection: 'column',
          boxShadow: '2px 6px 16px rgba(0,0,0,0.18)',
          borderRadius: 4,
        }}>
          <div style={{ padding: '5px 7px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="검색..."
              style={{ width: '100%', border: '1px solid var(--border2)', borderRadius: 3, padding: '3px 7px', fontSize: 12 }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* 전체(초기화) 옵션 */}
            <div
              onClick={() => { onChange(''); setOpen(false); }}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text3)', borderBottom: '1px solid #EEE', background: !value ? '#F0F0F0' : '#fff' }}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                style={{
                  padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                  background: o === value ? '#EEF4FF' : '#fff',
                  borderBottom: '1px solid #EEE',
                  fontWeight: o === value ? 700 : 'normal',
                  color: o === value ? 'var(--blue)' : 'inherit',
                }}
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text3)' }}>검색 결과 없음</div>
            )}
          </div>
          <div style={{ padding: '3px 8px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', background: 'var(--bg)' }}>
            {filtered.length}/{options.length}개
          </div>
        </div>
      )}
    </div>
  );
}

export default function Pricing() {
  // ── 필터 상태 (localStorage 복원)
  const [counName,   setCountName]   = useState(() => LS('pricing_coun'));
  const [flowerName, setFlowerName]  = useState(() => LS('pricing_flower'));
  const [prodSearch, setProdSearch]  = useState('');

  // ── 업체 선택
  const [allCustomers, setAllCustomers] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [custSearch,   setCustSearch]   = useState('');
  const [showCustPanel, setShowCustPanel] = useState(false);
  const custPanelRef = useRef();

  // ── 드롭다운 옵션
  const [counNames,   setCounNames]   = useState([]);
  const [flowerNames, setFlowerNames] = useState([]);

  // ── 매트릭스 데이터
  const [products,   setProducts]   = useState([]);
  const [costs,      setCosts]      = useState({});
  const [localCosts, setLocalCosts] = useState({});
  const [changed,    setChanged]    = useState(new Set());

  // ── UI 상태
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [searched,   setSearched]   = useState(false);
  const [err,        setErr]        = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── 우선순위 / 표시 옵션
  const [hideNoCost,    setHideNoCost]    = useState(false);
  const [sortByHasCost, setSortByHasCost] = useState(true);   // 단가 있는 항목 먼저

  // ── 인라인 단가 일괄
  const [inlineCost, setInlineCost] = useState('');

  // 필터 변경 + localStorage 저장
  const handleCountName = v => { setCountName(v);   LSset('pricing_coun', v); };
  const handleFlowerName = v => { setFlowerName(v); LSset('pricing_flower', v); };

  // 외부 클릭 시 업체 패널 닫기
  useEffect(() => {
    const h = e => {
      if (custPanelRef.current && !custPanelRef.current.contains(e.target))
        setShowCustPanel(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // 초기 로드
  useEffect(() => {
    apiGet('/api/master/pricing-matrix')
      .then(d => {
        setAllCustomers(d.allCustomers || []);
        setCounNames(d.counNames   || []);
        setFlowerNames(d.flowerNames || []);

        // localStorage에 저장된 업체키 복원
        try {
          const saved = localStorage.getItem('pricing_custKeys');
          if (saved) {
            const keys = saved.split(',').map(Number).filter(Boolean);
            const valid = new Set(
              keys.filter(k => (d.allCustomers || []).some(c => c.CustKey === k))
            );
            if (valid.size > 0) setSelectedKeys(valid);
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  // 조회
  const handleSearch = useCallback(() => {
    if (selectedKeys.size === 0) { setErr('업체를 1개 이상 선택하세요.'); return; }
    setLoading(true); setErr(''); setSearched(false);

    // 업체키 localStorage 저장
    LSset('pricing_custKeys', [...selectedKeys].join(','));

    apiGet('/api/master/pricing-matrix', {
      custKeys: [...selectedKeys].join(','),
      ...(counName   && { counName }),
      ...(flowerName && { flowerName }),
      ...(prodSearch && { prodSearch }),
    })
      .then(d => {
        setProducts(d.products || []);
        setCosts(d.costs || {});
        const lc = {};
        for (const [key, val] of Object.entries(d.costs || {})) lc[key] = val.cost;
        setLocalCosts(lc);
        setChanged(new Set());
        setSearched(true);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [selectedKeys, counName, flowerName, prodSearch]);

  // 단가 변경
  const handleCostChange = (custKey, prodKey, val) => {
    const key = `${custKey}_${prodKey}`;
    setLocalCosts(prev => ({ ...prev, [key]: val }));
    setChanged(prev => new Set([...prev, key]));
  };

  // 저장 (600개씩 배치 MERGE)
  const handleSave = async () => {
    if (changed.size === 0) return;
    setSaving(true); setErr('');
    const changes = [...changed].map(key => {
      const [ck, pk] = key.split('_');
      return { custKey: parseInt(ck), prodKey: parseInt(pk), autoKey: costs[key]?.autoKey || null, cost: parseFloat(localCosts[key]) || 0 };
    });
    try {
      const BATCH = 600;
      let totalSaved = 0;
      for (let i = 0; i < changes.length; i += BATCH) {
        const d = await apiPut('/api/master/pricing-matrix', { changes: changes.slice(i, i + BATCH) });
        totalSaved += d.saved || 0;
      }
      const newCosts = { ...costs };
      for (const ch of changes) {
        const k = `${ch.custKey}_${ch.prodKey}`;
        newCosts[k] = { autoKey: newCosts[k]?.autoKey || ch.autoKey, cost: ch.cost };
      }
      setCosts(newCosts);
      setChanged(new Set());
      setSuccessMsg(`✅ ${totalSaved}개 단가 저장 완료`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  // 인라인 전체 일괄 적용
  const handleInlineBulk = () => {
    const cost = parseFloat(inlineCost);
    if (isNaN(cost) || inlineCost === '') return;
    const newLC = { ...localCosts };
    const newChg = new Set(changed);
    [...selectedKeys].forEach(ck => {
      products.forEach(p => { const k = `${ck}_${p.ProdKey}`; newLC[k] = cost; newChg.add(k); });
    });
    setLocalCosts(newLC);
    setChanged(newChg);
    setSuccessMsg(`✅ ${[...selectedKeys].length}개 업체 × ${products.length}개 품목 ${fmt(cost)}원 적용`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // ── 품목별 단가 유무 사전 계산 (렌더링 최적화)
  const hasCostMap = useMemo(() => {
    const map = {};
    if (!searched) return map;
    const custArr = [...selectedKeys];
    for (const p of products) {
      map[p.ProdKey] = custArr.some(ck => {
        const key = `${ck}_${p.ProdKey}`;
        const v = key in localCosts ? localCosts[key] : costs[key]?.cost;
        return v !== undefined && v !== '' && parseFloat(v) > 0;
      });
    }
    return map;
  }, [products, localCosts, costs, selectedKeys, searched]);

  // ── 품목 우선순위 정렬
  const sortedProducts = useMemo(() => {
    if (!searched || products.length === 0) return products;
    let list = hideNoCost ? products.filter(p => hasCostMap[p.ProdKey]) : [...products];
    if (sortByHasCost) list.sort((a, b) => (hasCostMap[a.ProdKey] ? 0 : 1) - (hasCostMap[b.ProdKey] ? 0 : 1));
    return list;
  }, [products, hasCostMap, hideNoCost, sortByHasCost, searched]);

  const selectedCustomers = allCustomers.filter(c => selectedKeys.has(c.CustKey));

  const filteredCusts = custSearch
    ? allCustomers.filter(c =>
        c.CustName.toLowerCase().includes(custSearch.toLowerCase()) ||
        (c.Manager || '').toLowerCase().includes(custSearch.toLowerCase()))
    : allCustomers;

  const getCost = (custKey, prodKey) => {
    const key = `${custKey}_${prodKey}`;
    return key in localCosts ? localCosts[key] : (costs[key]?.cost ?? '');
  };
  const isChanged = (custKey, prodKey) => changed.has(`${custKey}_${prodKey}`);

  return (
    <div>
      {/* ── 필터 바 ── */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>

        {/* 업체 선택 */}
        <span className="filter-label">업체 선택</span>
        <div style={{ position: 'relative' }} ref={custPanelRef}>
          <button
            className="btn"
            onClick={() => setShowCustPanel(v => !v)}
            style={{
              minWidth: 200, textAlign: 'left', fontWeight: 'normal',
              borderColor: selectedKeys.size > 0 ? 'var(--blue)' : undefined,
              background: selectedKeys.size > 0 ? '#EEF4FF' : undefined,
            }}
          >
            {selectedKeys.size === 0 ? '업체 선택...' : `${selectedKeys.size}개 업체 선택됨`} ▼
          </button>

          {showCustPanel && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 300,
              background: '#fff', border: '2px solid var(--border2)',
              width: 300, maxHeight: 340, display: 'flex', flexDirection: 'column',
              boxShadow: '2px 4px 12px rgba(0,0,0,0.2)', borderRadius: 4,
            }}>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
                <input
                  className="filter-input"
                  placeholder="업체명 / 담당자 검색"
                  value={custSearch}
                  onChange={e => setCustSearch(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                  autoFocus
                />
                <button className="btn btn-sm" onClick={() => {
                  if (selectedKeys.size === filteredCusts.length) setSelectedKeys(new Set());
                  else setSelectedKeys(new Set(filteredCusts.map(c => c.CustKey)));
                }}>
                  {selectedKeys.size === filteredCusts.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {filteredCusts.map(c => {
                  const checked = selectedKeys.has(c.CustKey);
                  return (
                    <label key={c.CustKey} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                      borderBottom: '1px solid #EEE',
                      background: checked ? '#EEF4FF' : '#fff',
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        setSelectedKeys(prev => {
                          const next = new Set(prev);
                          next.has(c.CustKey) ? next.delete(c.CustKey) : next.add(c.CustKey);
                          return next;
                        });
                      }} />
                      <span>
                        <strong>{c.CustName}</strong>
                        <span style={{ color: 'var(--text3)', marginLeft: 6 }}>{c.CustArea} · {c.Manager}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg)', fontSize: 11, color: 'var(--text3)' }}>
                {selectedKeys.size}개 선택 / 전체 {allCustomers.length}개
              </div>
            </div>
          )}
        </div>

        {/* 국가 — SearchableSelect */}
        <span className="filter-label">국가</span>
        <SearchableSelect
          value={counName}
          onChange={handleCountName}
          options={counNames}
          placeholder="전체"
          minWidth={110}
        />

        {/* 품종 — SearchableSelect */}
        <span className="filter-label">품종</span>
        <SearchableSelect
          value={flowerName}
          onChange={handleFlowerName}
          options={flowerNames}
          placeholder="전체"
          minWidth={110}
        />

        {/* 품목 검색 */}
        <span className="filter-label">품목 검색</span>
        <input
          className="filter-input"
          placeholder="품목명 입력..."
          value={prodSearch}
          onChange={e => setProdSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ minWidth: 140 }}
        />

        <div className="page-actions">
          <button className="btn btn-primary" onClick={handleSearch}>🔍 조회</button>
          {searched && (
            <>
              {/* 인라인 단가 일괄 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 4, padding: '2px 8px' }}>
                <span style={{ fontSize: 11, color: '#795548', whiteSpace: 'nowrap' }}>단가:</span>
                <input
                  type="number"
                  value={inlineCost}
                  onChange={e => setInlineCost(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInlineBulk()}
                  placeholder="금액 입력"
                  style={{ width: 90, height: 24, border: '1px solid #FFD54F', borderRadius: 3, textAlign: 'right', fontSize: 12, padding: '0 4px', fontFamily: 'var(--mono)' }}
                />
                <button
                  className="btn"
                  onClick={handleInlineBulk}
                  disabled={inlineCost === ''}
                  style={{ whiteSpace: 'nowrap', background: '#FF8F00', color: '#fff', borderColor: '#FF8F00', fontSize: 11 }}
                >
                  ✅ 단가 일괄 지정
                </button>
              </div>
              <button className="btn btn-primary" disabled={changed.size === 0 || saving} onClick={handleSave}>
                {saving ? '⏳ 저장 중...' : `💾 저장 (${changed.size}개)`}
              </button>
            </>
          )}
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖ 닫기</button>
        </div>
      </div>

      {/* 메시지 */}
      {err        && <div className="banner-err">⚠️ {err}</div>}
      {successMsg && <div className="banner-ok">{successMsg}</div>}
      {changed.size > 0 && <div className="banner-warn">✏️ {changed.size}개 변경됨 — 저장 버튼으로 확정하세요.</div>}

      {/* ── 매트릭스 테이블 ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="card-title">■ 업체별 품목 단가 매트릭스</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {searched
                ? `${selectedCustomers.length}개 업체 × ${sortedProducts.length}개 품목${hideNoCost && sortedProducts.length < products.length ? ` (전체 ${products.length}개 중)` : ''}`
                : '업체 선택 후 조회하세요'}
            </span>
          </div>
          {searched && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
              {/* 단가 있는 항목 먼저 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={sortByHasCost}
                  onChange={e => setSortByHasCost(e.target.checked)}
                />
                <span>단가 있는 항목 먼저</span>
              </label>
              {/* 단가 없는 항목 숨기기 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={hideNoCost}
                  onChange={e => setHideNoCost(e.target.checked)}
                />
                <span style={{ color: hideNoCost ? 'var(--blue)' : 'inherit', fontWeight: hideNoCost ? 700 : 'normal' }}>
                  단가 없는 항목 숨기기
                </span>
              </label>
            </div>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : !searched ? (
          <div className="empty-state">
            <div className="empty-icon">💰</div>
            <div className="empty-text">업체를 선택하고 조회하세요</div>
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-text">
              {hideNoCost ? '단가가 설정된 품목이 없습니다' : '조건에 맞는 품목이 없습니다'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: selectedCustomers.length * 110 + 320 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 70,  position: 'sticky', left: 0,   background: 'var(--bg2)', zIndex: 10 }}>국가</th>
                  <th style={{ minWidth: 80,  position: 'sticky', left: 70,  background: 'var(--bg2)', zIndex: 10 }}>품종</th>
                  <th style={{ minWidth: 180, position: 'sticky', left: 150, background: 'var(--bg2)', zIndex: 10 }}>품목명</th>
                  <th style={{ textAlign: 'right', minWidth: 80, color: '#795548', background: '#FFFDE7' }}>기본단가↓</th>
                  {selectedCustomers.map(c => (
                    <th key={c.CustKey} style={{ textAlign: 'center', minWidth: 100 }}>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>{c.CustName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 'normal' }}>{c.Manager}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((p, idx) => {
                  const hasCostRow = hasCostMap[p.ProdKey] || false;
                  // 단가 있는/없는 경계 구분선
                  const showDivider = sortByHasCost && idx > 0 && !hasCostRow && hasCostMap[sortedProducts[idx - 1].ProdKey];
                  return (
                    <tr key={p.ProdKey} style={{ borderTop: showDivider ? '2px dashed var(--border2)' : undefined }}>
                      <td style={{ fontSize: 11, position: 'sticky', left: 0,   background: hasCostRow ? '#F7FFF7' : '#fff', zIndex: 5 }}>{p.CounName}</td>
                      <td style={{ fontSize: 11, position: 'sticky', left: 70,  background: hasCostRow ? '#F7FFF7' : '#fff', zIndex: 5 }}>{p.FlowerName}</td>
                      <td style={{ fontWeight: 500, fontSize: 12, position: 'sticky', left: 150, background: hasCostRow ? '#F7FFF7' : '#fff', zIndex: 5 }}>
                        {p.ProdName}
                        {hasCostRow && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--green)', fontWeight: 'normal' }}>●</span>}
                      </td>
                      {/* 기본단가 — 입력 시 전체 업체에 적용 */}
                      <td style={{ padding: '2px 4px', background: '#FFFDE7' }}>
                        <input
                          type="number"
                          placeholder={String(p.DefaultCost || 0)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const v = e.target.value;
                              if (v === '') return;
                              [...selectedKeys].forEach(ck => handleCostChange(ck, p.ProdKey, v));
                              e.target.value = '';
                              e.target.blur();
                            }
                          }}
                          onBlur={e => {
                            const v = e.target.value;
                            if (v === '') return;
                            [...selectedKeys].forEach(ck => handleCostChange(ck, p.ProdKey, v));
                            e.target.value = '';
                          }}
                          style={{
                            width: '100%', height: 22, minWidth: 70,
                            border: '1px solid #FFD54F', borderRadius: 2,
                            textAlign: 'right', fontSize: 11,
                            fontFamily: 'var(--mono)', padding: '0 4px',
                            background: '#FFFDE7', color: '#5D4037',
                          }}
                        />
                      </td>
                      {selectedCustomers.map(c => {
                        const chg = isChanged(c.CustKey, p.ProdKey);
                        const val = getCost(c.CustKey, p.ProdKey);
                        return (
                          <td key={c.CustKey} style={{ padding: '2px 4px', background: chg ? '#FFFFC0' : undefined }}>
                            <input
                              type="number"
                              value={val}
                              placeholder="0"
                              onChange={e => handleCostChange(c.CustKey, p.ProdKey, e.target.value)}
                              onFocus={e => e.target.select()}
                              style={{
                                width: '100%', height: 22, minWidth: 80,
                                border: `1px solid ${chg ? '#AABB00' : 'var(--border2)'}`,
                                borderRadius: 2, textAlign: 'right', fontSize: 12,
                                fontFamily: 'var(--mono)', padding: '0 4px',
                                background: chg ? '#FFFFC0' : 'var(--surface)',
                                fontWeight: chg ? 'bold' : 'normal',
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {searched && (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg)', fontSize: 11, color: 'var(--text3)' }}>
            💡 기본단가 칸 입력 후 Enter → 해당 품목 전체 업체 적용 &nbsp;|&nbsp; 단가 0 또는 빈칸 = 기본단가 사용 &nbsp;|&nbsp; ● 단가 설정된 품목
          </div>
        )}
      </div>
    </div>
  );
}
