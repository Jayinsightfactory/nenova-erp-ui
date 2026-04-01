// pages/master/pricing.js
// 업체별 품목 단가 관리
// 수정이력: 2026-03-30 — 거래처 검색 드롭다운(담당자 있는 업체만), 품목 검색, 변경 하이라이트

import { useState, useEffect, useRef } from 'react';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

export default function Pricing() {
  // 거래처 검색
  const [custSearch, setCustSearch] = useState('');
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const custRef = useRef();

  // 품목 검색
  const [prodSearch, setProdSearch] = useState('');

  // 데이터
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [localCosts, setLocalCosts] = useState({});
  const [changed, setChanged] = useState(new Set());
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkCost, setBulkCost] = useState('');

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = e => {
      if (custRef.current && !custRef.current.contains(e.target)) setShowCustDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 거래처 검색 디바운스 — 담당자 있는 업체만
  useEffect(() => {
    const t = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch || '' })
        .then(d => {
          // 담당자(Manager)가 설정된 업체만 필터링
          const filtered = (d.customers || []).filter(c => c.Manager && c.Manager.trim() !== '');
          setCustList(filtered);
          if (custSearch.length > 0) setShowCustDrop(true);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  // 거래처 선택 시 단가 목록 로드
  const load = () => {
    if (!selectedCust) { setErr('거래처를 선택하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/master', { entity: 'pricing', custKey: selectedCust.CustKey })
      .then(d => {
        setData(d.data || []);
        const costs = {};
        (d.data || []).forEach(r => { costs[r.AutoKey] = r.Cost; });
        setLocalCosts(costs);
        setChanged(new Set());
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  // 단가 변경
  const handleCostChange = (autoKey, val) => {
    setLocalCosts(c => ({ ...c, [autoKey]: parseFloat(val) || 0 }));
    setChanged(c => new Set([...c, autoKey]));
  };

  // 일괄 지정
  const handleBulk = () => {
    const cost = parseFloat(bulkCost) || 0;
    const newCosts = { ...localCosts };
    const newChanged = new Set(changed);
    filteredData.forEach(r => { newCosts[r.AutoKey] = cost; newChanged.add(r.AutoKey); });
    setLocalCosts(newCosts);
    setChanged(newChanged);
    setShowBulk(false);
    setBulkCost('');
    setSuccessMsg(`✅ ${filteredData.length}개 품목에 ${fmt(cost)}원 일괄 적용됨 (저장 버튼으로 확정)`);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // 엑셀
  const handleExcel = () => {
    const rows = [['국가','꽃','품목명','기본단가','적용단가']];
    filteredData.forEach(r => rows.push([r.CounName, r.FlowerName, r.ProdName, r.Cost, localCosts[r.AutoKey]||0]));
    const csv = rows.map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `단가관리_${selectedCust?.CustName||''}.csv`;
    a.click();
  };

  // 품목 검색 필터 적용
  const filteredData = prodSearch
    ? data.filter(r =>
        r.ProdName?.toLowerCase().includes(prodSearch.toLowerCase()) ||
        r.FlowerName?.toLowerCase().includes(prodSearch.toLowerCase()) ||
        r.CounName?.toLowerCase().includes(prodSearch.toLowerCase())
      )
    : data;

  return (
    <div>
      {/* 필터 바 */}
      <div className="filter-bar">

        {/* 거래처 검색 드롭다운 */}
        <span className="filter-label">거래처</span>
        <div style={{position:'relative'}} ref={custRef}>
          <input
            className="filter-input"
            placeholder="거래처명 검색... (담당자 있는 업체)"
            value={custSearch}
            onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); }}
            onFocus={() => custList.length > 0 && setShowCustDrop(true)}
            style={{minWidth:220, borderColor: selectedCust ? 'var(--blue)' : undefined}}
          />
          {showCustDrop && custList.length > 0 && (
            <div style={{
              position:'absolute', top:'100%', left:0, zIndex:200,
              background:'#fff', border:'2px solid var(--border2)',
              width:320, maxHeight:260, overflowY:'auto',
              boxShadow:'2px 2px 8px rgba(0,0,0,0.2)'
            }}>
              {custList.map(c => (
                <div key={c.CustKey}
                  onClick={() => { setSelectedCust(c); setCustSearch(c.CustName); setShowCustDrop(false); }}
                  style={{padding:'5px 10px', cursor:'pointer', borderBottom:'1px solid #EEE', fontSize:12}}
                  onMouseEnter={e => e.currentTarget.style.background = '#E8F0FF'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <div style={{fontWeight:'bold'}}>{c.CustName}</div>
                  <div style={{fontSize:11, color:'var(--text3)'}}>
                    {c.CustArea} · 담당: <strong>{c.Manager}</strong> · {c.OrderCode}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 품목 검색 */}
        <span className="filter-label">품목 검색</span>
        <input
          className="filter-input"
          placeholder="품목명 / 꽃 / 국가"
          value={prodSearch}
          onChange={e => setProdSearch(e.target.value)}
          style={{minWidth:160}}
        />

        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn" onClick={() => setShowBulk(true)}>📋 일괄 지정 / Asign. masiva</button>
          <button className="btn btn-primary"
            disabled={changed.size === 0}
            onClick={() => alert(`${changed.size}개 변경사항 저장 기능은 API 연결 완료 후 활성화됩니다.`)}
          >
            💾 저장 / Guardar{changed.size > 0 ? ` (${changed.size}개)` : ''}
          </button>
          <button className="btn" onClick={handleExcel}>📊 엑셀 / Excel</button>
          <button className="btn" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {err       && <div className="banner-err">⚠️ {err}</div>}
      {successMsg && <div className="banner-ok">{successMsg}</div>}
      {changed.size > 0 && (
        <div className="banner-warn">
          ✏️ {changed.size}개 항목이 변경되었습니다. 저장 버튼을 눌러 확정하세요.
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">■ 업체별 품목 단가 목록</span>
          <span style={{fontSize:11, color:'var(--text3)'}}>
            {selectedCust
              ? `${selectedCust.CustName} · ${selectedCust.Manager} · 전체 ${data.length}개 / 표시 ${filteredData.length}개`
              : '거래처를 선택 후 조회하세요'}
          </span>
        </div>

        <div className="table-wrap" style={{border:'none', borderRadius:0}}>
          {loading ? (
            <div className="skeleton" style={{height:300}}></div>
          ) : filteredData.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💰</div>
              <div className="empty-text">
                {selectedCust ? '품목 데이터 없음' : '거래처 선택 후 조회하세요'}
              </div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width:28}}><input type="checkbox"/></th>
                  <th style={{minWidth:70}}>국가</th>
                  <th style={{minWidth:80}}>꽃</th>
                  <th style={{minWidth:200}}>품목명(색상)</th>
                  <th style={{textAlign:'right', minWidth:80}}>기본단가</th>
                  <th style={{textAlign:'right', minWidth:100}}>적용단가 (직접 입력)</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(r => {
                  const isChanged = changed.has(r.AutoKey);
                  const curCost = localCosts[r.AutoKey] ?? r.Cost;
                  return (
                    <tr key={r.AutoKey} style={{background: isChanged ? '#FFFFC0' : undefined}}>
                      <td><input type="checkbox"/></td>
                      <td style={{fontSize:11}}>{r.CounName}</td>
                      <td style={{fontSize:11}}>{r.FlowerName}</td>
                      <td style={{fontWeight:500, fontSize:12}}>{r.ProdName}</td>
                      <td className="num" style={{color:'var(--text3)', fontSize:11}}>{fmt(r.Cost)}</td>
                      <td style={{textAlign:'right'}}>
                        <input
                          type="number"
                          value={curCost}
                          onChange={e => handleCostChange(r.AutoKey, e.target.value)}
                          onFocus={e => e.target.select()}
                          style={{
                            width:95, height:22,
                            border:`1px solid ${isChanged ? '#AABB00' : 'var(--border2)'}`,
                            borderRadius:2,
                            textAlign:'right', fontSize:12,
                            fontFamily:'var(--mono)',
                            padding:'0 4px',
                            background: isChanged ? '#FFFFC0' : 'var(--surface)',
                            fontWeight: isChanged ? 'bold' : 'normal',
                          }}
                        />
                      </td>
                      <td style={{fontSize:11, color:'var(--text3)'}}>{r.Descr||'—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{padding:'6px 12px', borderTop:'1px solid var(--border)', background:'var(--bg)', fontSize:11, color:'var(--text3)'}}>
          💡 단가 0이면 기본 단가(Product.Cost)를 사용합니다.
        </div>
      </div>

      {/* 일괄 지정 모달 */}
      {showBulk && (
        <div className="modal-overlay" onClick={() => setShowBulk(false)}>
          <div className="modal" style={{maxWidth:380}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 일괄 단가 지정</span>
              <button className="btn btn-sm" onClick={() => setShowBulk(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{fontSize:12, marginBottom:10}}>
                현재 표시된 <strong>{filteredData.length}개</strong> 품목에 동일한 단가를 적용합니다.
              </div>
              <div className="form-group">
                <label className="form-label">적용할 단가</label>
                <input
                  type="number"
                  className="form-control"
                  value={bulkCost}
                  onChange={e => setBulkCost(e.target.value)}
                  placeholder="0 = 기본단가로 초기화"
                  autoFocus
                />
              </div>
              {bulkCost && (
                <div className="banner-info" style={{marginTop:8}}>
                  → {filteredData.length}개 품목에 {fmt(bulkCost)}원 적용
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleBulk}>✅ 일괄 적용</button>
              <button className="btn" onClick={() => setShowBulk(false)}>취소 / Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
