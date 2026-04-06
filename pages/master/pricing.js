// pages/master/pricing.js
// 업체별 품목 단가 관리 — 매트릭스 뷰 (업체×품목 일괄 수정)

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPut } from '../../lib/useApi';

const fmt = n => Number(n || 0).toLocaleString();

export default function Pricing() {
  // ── 필터 상태
  const [counName,   setCountName]   = useState('');
  const [flowerName, setFlowerName]  = useState('');
  const [prodSearch, setProdSearch]  = useState('');

  // ── 업체 선택
  const [allCustomers, setAllCustomers] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set()); // CustKey Set
  const [custSearch,   setCustSearch]   = useState('');
  const [showCustPanel, setShowCustPanel] = useState(false);
  const custPanelRef = useRef();

  // ── 드롭다운 옵션
  const [counNames,   setCounNames]   = useState([]);
  const [flowerNames, setFlowerNames] = useState([]);

  // ── 매트릭스 데이터
  const [products,   setProducts]   = useState([]);
  const [costs,      setCosts]      = useState({}); // "custKey_prodKey" → {autoKey, cost}
  const [localCosts, setLocalCosts] = useState({}); // 편집 중인 단가
  const [changed,    setChanged]    = useState(new Set()); // "custKey_prodKey"

  // ── UI 상태
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [searched,   setSearched]   = useState(false);
  const [err,        setErr]        = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── 일괄 지정
  const [showBulk, setShowBulk]   = useState(false);
  const [bulkCost, setBulkCost]   = useState('');
  const [bulkTarget, setBulkTarget] = useState('all'); // 'all' | 'cust:{key}' | 'prod:{key}'
  const [inlineCost, setInlineCost] = useState(''); // 인라인 일괄 단가 입력

  // 외부 클릭 시 업체 패널 닫기
  useEffect(() => {
    const handler = e => {
      if (custPanelRef.current && !custPanelRef.current.contains(e.target))
        setShowCustPanel(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 초기 로드: 전체 옵션 목록
  useEffect(() => {
    apiGet('/api/master/pricing-matrix')
      .then(d => {
        setAllCustomers(d.allCustomers || []);
        setCounNames(d.counNames   || []);
        setFlowerNames(d.flowerNames || []);
      })
      .catch(() => {});
  }, []);

  // 조회
  const handleSearch = useCallback(() => {
    if (selectedKeys.size === 0) {
      setErr('업체를 1개 이상 선택하세요.');
      return;
    }
    setLoading(true); setErr(''); setSearched(false);
    const params = {
      custKeys:   [...selectedKeys].join(','),
      ...(counName   && { counName }),
      ...(flowerName && { flowerName }),
      ...(prodSearch && { prodSearch }),
    };
    apiGet('/api/master/pricing-matrix', params)
      .then(d => {
        setProducts(d.products || []);
        setCosts(d.costs || {});
        // localCosts 초기화: 기존 단가 세팅
        const lc = {};
        for (const [key, val] of Object.entries(d.costs || {})) {
          lc[key] = val.cost;
        }
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

  // 저장 (50개씩 배치 전송)
  const handleSave = async () => {
    if (changed.size === 0) return;
    setSaving(true); setErr('');
    const changes = [...changed].map(key => {
      const [ck, pk] = key.split('_');
      return {
        custKey:  parseInt(ck),
        prodKey:  parseInt(pk),
        autoKey:  costs[key]?.autoKey || null,
        cost:     parseFloat(localCosts[key]) || 0,
      };
    });
    try {
      const BATCH = 50;
      let totalSaved = 0;
      for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        const d = await apiPut('/api/master/pricing-matrix', { changes: batch });
        totalSaved += d.saved || batch.length;
      }
      // 저장 후 costs 동기화
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
    const newLC  = { ...localCosts };
    const newChg = new Set(changed);
    [...selectedKeys].forEach(ck => {
      products.forEach(p => {
        const k = `${ck}_${p.ProdKey}`;
        newLC[k] = cost; newChg.add(k);
      });
    });
    setLocalCosts(newLC);
    setChanged(newChg);
    setSuccessMsg(`✅ ${[...selectedKeys].length}개 업체 × ${products.length}개 품목에 ${fmt(cost)}원 적용 (저장 버튼으로 확정)`);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // 일괄 적용
  const handleBulk = () => {
    const cost = parseFloat(bulkCost) || 0;
    const newLC  = { ...localCosts };
    const newChg = new Set(changed);

    const selCusts = [...selectedKeys];

    if (bulkTarget === 'all') {
      selCusts.forEach(ck => {
        products.forEach(p => {
          const k = `${ck}_${p.ProdKey}`;
          newLC[k] = cost; newChg.add(k);
        });
      });
    } else if (bulkTarget.startsWith('cust:')) {
      const ck = parseInt(bulkTarget.split(':')[1]);
      products.forEach(p => {
        const k = `${ck}_${p.ProdKey}`;
        newLC[k] = cost; newChg.add(k);
      });
    } else if (bulkTarget.startsWith('prod:')) {
      const pk = parseInt(bulkTarget.split(':')[1]);
      selCusts.forEach(ck => {
        const k = `${ck}_${pk}`;
        newLC[k] = cost; newChg.add(k);
      });
    }

    setLocalCosts(newLC);
    setChanged(newChg);
    setShowBulk(false);
    setBulkCost('');
    setSuccessMsg(`✅ ${newChg.size - changed.size + 1}개 항목에 ${fmt(cost)}원 일괄 적용 (저장 버튼으로 확정)`);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // 선택 업체 정보
  const selectedCustomers = allCustomers.filter(c => selectedKeys.has(c.CustKey));

  // 업체 검색 필터
  const filteredCusts = custSearch
    ? allCustomers.filter(c =>
        c.CustName.toLowerCase().includes(custSearch.toLowerCase()) ||
        (c.Manager || '').toLowerCase().includes(custSearch.toLowerCase())
      )
    : allCustomers;

  // 셀 값 가져오기
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
            }}
          >
            {selectedKeys.size === 0
              ? '업체 선택...'
              : `${selectedKeys.size}개 업체 선택됨`}
            {' '}▼
          </button>

          {showCustPanel && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 300,
              background: '#fff', border: '2px solid var(--border2)',
              width: 300, maxHeight: 320, display: 'flex', flexDirection: 'column',
              boxShadow: '2px 4px 12px rgba(0,0,0,0.2)',
            }}>
              {/* 검색 + 전체선택 */}
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
                  if (selectedKeys.size === filteredCusts.length)
                    setSelectedKeys(new Set());
                  else
                    setSelectedKeys(new Set(filteredCusts.map(c => c.CustKey)));
                }}>
                  {selectedKeys.size === filteredCusts.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {/* 업체 목록 */}
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
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(c.CustKey)) next.delete(c.CustKey);
                            else next.add(c.CustKey);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <strong>{c.CustName}</strong>
                        <span style={{ color: 'var(--text3)', marginLeft: 6 }}>
                          {c.CustArea} · {c.Manager}
                        </span>
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

        {/* 국가 필터 */}
        <span className="filter-label">국가</span>
        <select className="filter-input" value={counName} onChange={e => setCountName(e.target.value)} style={{ minWidth: 100 }}>
          <option value="">전체</option>
          {counNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        {/* 꽃 종류 필터 */}
        <span className="filter-label">품종</span>
        <select className="filter-input" value={flowerName} onChange={e => setFlowerName(e.target.value)} style={{ minWidth: 100 }}>
          <option value="">전체</option>
          {flowerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

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
              {/* 인라인 단가 일괄 지정 */}
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
              <button
                className="btn btn-primary"
                disabled={changed.size === 0 || saving}
                onClick={handleSave}
              >
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
      {changed.size > 0 && (
        <div className="banner-warn">✏️ {changed.size}개 변경됨 — 저장 버튼으로 확정하세요.</div>
      )}

      {/* ── 매트릭스 테이블 ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-header">
          <span className="card-title">■ 업체별 품목 단가 매트릭스</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {searched
              ? `${selectedCustomers.length}개 업체 × ${products.length}개 품목`
              : '업체 선택 후 조회하세요'}
          </span>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : !searched ? (
          <div className="empty-state">
            <div className="empty-icon">💰</div>
            <div className="empty-text">업체를 선택하고 조회하세요</div>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-text">조건에 맞는 품목이 없습니다</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: selectedCustomers.length * 110 + 300 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 70, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 10 }}>국가</th>
                  <th style={{ minWidth: 80, position: 'sticky', left: 70, background: 'var(--bg2)', zIndex: 10 }}>품종</th>
                  <th style={{ minWidth: 180, position: 'sticky', left: 150, background: 'var(--bg2)', zIndex: 10 }}>품목명</th>
                  <th style={{ textAlign: 'right', minWidth: 75, color: 'var(--text3)' }}>기본단가</th>
                  {selectedCustomers.map(c => (
                    <th key={c.CustKey} style={{ textAlign: 'center', minWidth: 100 }}>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>{c.CustName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 'normal' }}>{c.Manager}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.ProdKey}>
                    <td style={{ fontSize: 11, position: 'sticky', left: 0, background: '#fff', zIndex: 5 }}>{p.CounName}</td>
                    <td style={{ fontSize: 11, position: 'sticky', left: 70, background: '#fff', zIndex: 5 }}>{p.FlowerName}</td>
                    <td style={{ fontWeight: 500, fontSize: 12, position: 'sticky', left: 150, background: '#fff', zIndex: 5 }}>{p.ProdName}</td>
                    <td style={{ padding: '2px 4px' }}>
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
                          border: '1px solid #FFD54F',
                          borderRadius: 2, textAlign: 'right', fontSize: 11,
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
                              borderRadius: 2,
                              textAlign: 'right', fontSize: 12,
                              fontFamily: 'var(--mono)',
                              padding: '0 4px',
                              background: chg ? '#FFFFC0' : 'var(--surface)',
                              fontWeight: chg ? 'bold' : 'normal',
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {searched && (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg)', fontSize: 11, color: 'var(--text3)' }}>
            💡 단가 0 또는 빈칸이면 기본단가(Product.Cost)를 사용합니다.
          </div>
        )}
      </div>

      {/* ── 일괄 지정 모달 ── */}
      {showBulk && (
        <div className="modal-overlay" onClick={() => setShowBulk(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 일괄 단가 지정</span>
              <button className="btn btn-sm" onClick={() => setShowBulk(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">적용 범위</label>
                <select
                  className="form-control"
                  value={bulkTarget}
                  onChange={e => setBulkTarget(e.target.value)}
                >
                  <option value="all">전체 ({selectedCustomers.length}개 업체 × {products.length}개 품목)</option>
                  <optgroup label="── 업체 1개만">
                    {selectedCustomers.map(c => (
                      <option key={c.CustKey} value={`cust:${c.CustKey}`}>
                        {c.CustName} ({products.length}개 품목)
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="── 품목 1개만">
                    {products.map(p => (
                      <option key={p.ProdKey} value={`prod:${p.ProdKey}`}>
                        {p.ProdName} ({selectedCustomers.length}개 업체)
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">적용 단가</label>
                <input
                  type="number"
                  className="form-control"
                  value={bulkCost}
                  onChange={e => setBulkCost(e.target.value)}
                  placeholder="0 = 기본단가로 초기화"
                  autoFocus
                />
              </div>
              {bulkCost !== '' && (
                <div className="banner-info" style={{ marginTop: 8 }}>
                  → {fmt(bulkCost)}원 적용
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleBulk} disabled={bulkCost === ''}>✅ 일괄 적용</button>
              <button className="btn" onClick={() => setShowBulk(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
