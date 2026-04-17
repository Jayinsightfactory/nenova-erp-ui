import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../../lib/useApi';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();
const PROD_GROUPS = ['콜롬비아카네이션','콜롬비아장미','콜롬비아수국','콜롬비아알스트로','에콰도르장미','네달란드','중국기타','국내왁스'];

// 차수(예: "15-01") → 정상 출고일(YYYY-MM-DD) 변환
function weekToShipDate(weekStr, year = new Date().getFullYear()) {
  try {
    const [wStr, dStr] = weekStr.split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
  } catch { return null; }
}
const WEEK_SUFFIXES = ['-01', '-02'];
const DAY_NAMES = ['월','화','수','목','금'];

// 출고수량을 요일별로 자동 균등 분배
function autoSplitQty(totalQty, dayCount) {
  if (dayCount <= 0 || totalQty <= 0) return [];
  const base = Math.floor(totalQty / dayCount);
  const remainder = totalQty - base * dayCount;
  return Array.from({ length: dayCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export default function Distribute() {
  const { t } = useLang();
  const [tab, setTab] = useState(0); // 0:품목기준 1:출고일지정 2:집계
  const weekInput = useWeekInput('');
  const week = weekInput.value;
  const [prodGroup, setProdGroup] = useState('');
  const [viewMode, setViewMode] = useState('prod'); // 'prod'=품목기준 'cust'=업체기준

  // 품목기준
  const [products, setProducts] = useState([]);
  const [selectedProd, setSelectedProd] = useState(null);
  const [custDist, setCustDist] = useState([]);
  const [distLoading, setDistLoading] = useState(false);
  const [inQty, setInQty] = useState(0);
  const [outQty, setOutQty] = useState(0);
  const [prodFilter, setProdFilter] = useState('');

  // 업체기준
  const [custList, setCustList] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custItems, setCustItems] = useState([]);
  const [custLoading, setCustLoading] = useState(false);

  // 업체기준 인라인 편집: { [prodKey]: { outQty, cost } }
  const [custEditInputs, setCustEditInputs] = useState({});

  const [loading, setLoading] = useState(false);
  const [custFilter, setCustFilter] = useState('');
  const [distMode, setDistMode] = useState('ratio');
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveModal, setSaveModal] = useState(null); // 저장 완료 모달
  const [outInputs, setOutInputs] = useState({});
  const [fixLoading, setFixLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [isFixed, setIsFixed] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [showValidate, setShowValidate] = useState(false);

  // 탭2: 출고요일 설정
  const [shipDayConfigs, setShipDayConfigs] = useState({}); // { 'prodGroup|suffix': '월,화,수' }
  const [shipDayLoading, setShipDayLoading] = useState(false);
  const [shipDaySaving, setShipDaySaving] = useState(false);
  // 탭2: 업체별 일별 수량 분배 { 'custKey|prodKey': { '월': 3, '화': 2, ... } }
  const [dailyQtyInputs, setDailyQtyInputs] = useState({});
  // 탭2: 품목별 출고일 오버라이드 { 'custKey|prodKey': '월,수' }
  const [prodDayOverrides, setProdDayOverrides] = useState({});
  const [tab2CustKey, setTab2CustKey] = useState(null);
  const [tab2Items, setTab2Items] = useState([]);
  const [tab2Loading, setTab2Loading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);

  // ── 출고요일 설정 로드
  const loadShipDayConfigs = useCallback(async () => {
    setShipDayLoading(true);
    try {
      const d = await apiGet('/api/shipment/ship-days', {});
      const map = {};
      (d.configs || []).forEach(c => {
        map[`${c.ProdGroup}|${c.WeekSuffix}`] = c.ShipDays;
      });
      setShipDayConfigs(map);
    } catch (e) { setErr(e.message); } finally { setShipDayLoading(false); }
  }, []);

  useEffect(() => { loadShipDayConfigs(); }, [loadShipDayConfigs]);

  // 출고요일 설정 저장
  const saveShipDayConfigs = async () => {
    setShipDaySaving(true); setErr('');
    try {
      const configs = Object.entries(shipDayConfigs).map(([key, days]) => {
        const [prodGroup, weekSuffix] = key.split('|');
        return { prodGroup, weekSuffix, custKey: 0, shipDays: days };
      });
      const res = await fetch('/api/shipment/ship-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('✅ 출고요일 설정 저장 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setShipDaySaving(false); }
  };

  // 출고요일 토글
  const toggleShipDay = (prodGroup, suffix, day) => {
    const key = `${prodGroup}|${suffix}`;
    const current = (shipDayConfigs[key] || '').split(',').filter(Boolean);
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    // 월~금 순서 정렬
    current.sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
    setShipDayConfigs(prev => ({ ...prev, [key]: current.join(',') }));
  };

  // 품목의 출고요일 가져오기 (오버라이드 → 기본설정 → 빈배열)
  const getShipDays = (custKey, prodKey, prodGroup) => {
    const overKey = `${custKey}|${prodKey}`;
    if (prodDayOverrides[overKey]) return prodDayOverrides[overKey].split(',').filter(Boolean);
    // 차수 접미사 파악 (week = "14-01" → suffix = "-01")
    const suffix = week ? `-${week.split('-').pop()}` : '-01';
    const cfgKey = `${prodGroup}|${suffix}`;
    const days = (shipDayConfigs[cfgKey] || '').split(',').filter(Boolean);
    return days;
  };

  // 탭2 업체 선택 → 품목+출고수량 로드 → 자동 일별 분배
  const loadTab2Items = async (ck) => {
    if (!week || !ck) return;
    setTab2CustKey(ck);
    setTab2Loading(true);
    try {
      const d = await apiGet('/api/shipment/distribute', { type: 'custItems', week, custKey: ck });
      const items = d.items || [];
      setTab2Items(items);
      // 자동 일별 분배 초기화
      const newInputs = {};
      items.forEach(item => {
        const days = getShipDays(ck, item.ProdKey, item.CountryFlower || '');
        const totalQty = item.출고수량 || item.주문수량 || 0;
        if (days.length > 0 && totalQty > 0) {
          const splits = autoSplitQty(totalQty, days.length);
          const dayMap = {};
          days.forEach((day, i) => { dayMap[day] = splits[i] || 0; });
          newInputs[`${ck}|${item.ProdKey}`] = dayMap;
        }
      });
      setDailyQtyInputs(prev => ({ ...prev, ...newInputs }));
    } catch (e) { setErr(e.message); } finally { setTab2Loading(false); }
  };

  // 일별 수량 변경 → 자동 조정
  const handleDailyQtyChange = (custKey, prodKey, day, value, totalQty, days) => {
    const key = `${custKey}|${prodKey}`;
    const current = { ...(dailyQtyInputs[key] || {}) };
    const newVal = parseFloat(value) || 0;
    current[day] = newVal;

    // 나머지 요일에 남은 수량 자동 분배
    const otherDays = days.filter(d => d !== day);
    const usedByThis = newVal;
    const remaining = Math.max(0, totalQty - usedByThis);

    if (otherDays.length > 0) {
      const splits = autoSplitQty(remaining, otherDays.length);
      otherDays.forEach((d, i) => { current[d] = splits[i] || 0; });
    }

    setDailyQtyInputs(prev => ({ ...prev, [key]: current }));
  };

  // 엑셀 다운로드
  const handleExcelDownload = async (singleCustKey) => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    setExcelDownloading(true); setErr('');
    try {
      const params = new URLSearchParams({ week });
      if (singleCustKey) params.set('custKey', singleCustKey);
      // 출고요일 설정과 일별 수량을 쿼리에 포함
      params.set('shipDayConfigs', JSON.stringify(shipDayConfigs));
      params.set('dailyQtyInputs', JSON.stringify(dailyQtyInputs));
      params.set('prodDayOverrides', JSON.stringify(prodDayOverrides));

      const res = await fetch(`/api/shipment/excel-download?${params.toString()}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || '다운로드 실패'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g,'') || `출고_${week}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMsg('✅ 엑셀 다운로드 완료');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) { setErr(e.message); } finally { setExcelDownloading(false); }
  };

  const handleFix = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    // 사전검증
    setFixLoading(true); setErr('');
    try {
      const vRes = await fetch(`/api/shipment/fix?week=${encodeURIComponent(week)}`);
      const vData = await vRes.json();
      if (vData.issueCount > 0) {
        setValidateResult(vData);
        setShowValidate(true);
        setFixLoading(false);
        return;
      }
    } catch(e) { /* 검증 실패해도 확정 진행 허용 */ }
    await doFix();
  };

  const doFix = async () => {
    if (!confirm(`[${week}] 차수를 확정하시겠습니까?\n\n확정 시 재고가 업데이트되고 견적서에 반영됩니다.`)) { setFixLoading(false); return; }
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, action: 'fix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(true);
      setShowValidate(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 5000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleUnfix = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    if (!confirm(`[${week}] 확정을 취소 / Cancelar하시겠습니까?`)) return;
    setFixLoading(true); setErr('');
    try {
      const res = await fetch('/api/shipment/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, action: 'unfix' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setIsFixed(false);
      setSuccessMsg('✅ ' + data.message);
      setTimeout(() => setSuccessMsg(''), 3000);
      handleSearch();
    } catch(e) { setErr(e.message); } finally { setFixLoading(false); }
  };

  const handleHistory = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    try {
      const d = await apiGet('/api/shipment/history', {
        startDate: '2020-01-01',
        endDate: new Date().toISOString().slice(0,10),
        search: week,
      });
      setHistoryData(d.history || []);
      setShowHistory(true);
    } catch(e) { setErr(e.message); }
  };

  const handleSearch = async () => {
    if (!week) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    setSelectedProd(null); setCustDist([]); setSelectedCust(null); setCustItems([]);

    try {
      const [prodRes, custRes] = await Promise.all([
        apiGet('/api/shipment/distribute', { type: 'products', week, prodGroup }),
        apiGet('/api/shipment/distribute', { type: 'custList', week }),
      ]);
      setProducts(prodRes.products || []);
      const customers = custRes.customers || [];
      setCustList(customers);

      // 거래처 검색어가 있으면 → 업체 기준 모드로 자동 전환 + 첫 매칭 거래처 자동 선택
      if (custFilter && custFilter.trim()) {
        const matched = customers.filter(c => c.CustName.includes(custFilter.trim()));
        if (matched.length > 0) {
          setViewMode('cust');
          // 첫 번째 매칭 거래처 자동 선택
          const first = matched[0];
          setSelectedCust(first);
          setCustLoading(true);
          try {
            const d = await apiGet('/api/shipment/distribute', { type: 'custItems', week, custKey: first.CustKey });
            setCustItems(d.items || []);
          } catch { setCustItems([]); } finally { setCustLoading(false); }
        } else {
          setErr(`거래처 "${custFilter}" 를 이 차수에서 찾을 수 없습니다.`);
        }
      }
    } catch(e) { setErr(e.message); } finally { setLoading(false); }
  };

  // 품목 클릭 → 거래처 분배 정보 로드
  const selectProd = async (prod) => {
    setSelectedProd(prod);
    setInQty(prod.inQty || 0);
    setOutQty(prod.outQty || 0);
    setDistLoading(true);
    try {
      const d = await apiGet('/api/shipment/distribute', { type:'custDist', week, prodKey: prod.ProdKey });
      setCustDist(d.customers || []);
      // 기존 출고수량으로 초기화
      const inputs = {};
      (d.customers||[]).forEach(c => { inputs[c.CustKey] = c.출고수량 || 0; });
      setOutInputs(inputs);
      setInQty(prod.inQty || 0);
      setOutQty(d.totalOut || 0);
    } catch(e) { setErr(e.message); } finally { setDistLoading(false); }
  };

  // 업체 선택 → 해당 업체 주문 품목 로드
  const selectCust = async (cust) => {
    setSelectedCust(cust);
    setCustLoading(true);
    try {
      const d = await apiGet('/api/shipment/distribute', { type:'custItems', week, custKey: cust.CustKey });
      const items = d.items || [];
      setCustItems(items);
      // 편집 입력값 초기화: 기존 출고수량 + 기존 단가
      const inputs = {};
      items.forEach(item => {
        inputs[item.ProdKey] = { outQty: item.출고수량 || 0, cost: item.Cost || 0 };
      });
      setCustEditInputs(inputs);
    } catch(e) { setErr(e.message); } finally { setCustLoading(false); }
  };

  // 업체기준 저장
  const handleSaveCustItems = async () => {
    if (!selectedCust || !week) { setErr('업체와 차수를 선택하세요.'); return; }
    setSaving(true); setErr('');
    try {
      for (const item of custItems) {
        const edit = custEditInputs[item.ProdKey] || {};
        const qty = edit.outQty !== undefined ? parseFloat(edit.outQty) || 0 : (item.출고수량 || 0);
        const cost = edit.cost !== undefined ? parseFloat(edit.cost) || 0 : (item.Cost || 0);
        if (qty <= 0) continue;
        await fetch('/api/shipment/distribute', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            week, year: new Date().getFullYear().toString(),
            outDate: weekToShipDate(week),
            custKey: selectedCust.CustKey,
            prodKey: item.ProdKey,
            outQty: qty,
            cost,
          })
        });
      }
      const savedItems = custItems.filter(item => {
        const edit = custEditInputs[item.ProdKey] || {};
        return (edit.outQty !== undefined ? parseFloat(edit.outQty)||0 : (item.출고수량||0)) > 0;
      });
      setSaveModal({
        prodName: selectedCust.CustName,
        week,
        savedCount: savedItems.length,
        totalQty: savedItems.reduce((a, item) => {
          const edit = custEditInputs[item.ProdKey] || {};
          return a + (edit.outQty !== undefined ? parseFloat(edit.outQty)||0 : (item.출고수량||0));
        }, 0),
      });
      selectCust(selectedCust); // 새로고침
    } catch(e) { setErr(e.message); } finally { setSaving(false); }
  };

  // 비율 분배 자동 계산
  const autoDistribute = () => {
    if (!selectedProd || custDist.length === 0) return;

    const available = selectedProd.inQty || 0; // 입고 가능 수량
    const newInputs = {};

    if (distMode === 'ratio') {
      // ── 비율 분배: 입고수량을 주문비율대로 나눔
      const totalOrder = custDist.reduce((a,b) => a+(b.주문수량||0), 0);
      if (totalOrder === 0) { alert('주문 수량이 없습니다.'); return; }

      let allocated = 0;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach((c, idx) => {
        if (idx === sorted.length - 1) {
          // 마지막 거래처: 나머지 전부 (반올림 오차 보정)
          newInputs[c.CustKey] = Math.max(0, available - allocated);
        } else {
          const ratio = (c.주문수량||0) / totalOrder;
          const qty = Math.floor(ratio * available); // 소수점 버림
          newInputs[c.CustKey] = qty;
          allocated += qty;
        }
      });

    } else {
      // ── 우선 분배: 주문수량 순서대로 입고수량 소진
      let remain = available;
      const sorted = [...custDist].sort((a,b) => (b.주문수량||0)-(a.주문수량||0));

      sorted.forEach(c => {
        const want = c.주문수량||0;
        const give = Math.min(want, remain);
        newInputs[c.CustKey] = give;
        remain = Math.max(0, remain - give);
      });
    }

    setOutInputs(newInputs);
    setOutQty(Object.values(newInputs).reduce((a,b)=>a+b,0));
  };

  // 저장
  const handleSave = async () => {
    if (!selectedProd || !week) { setErr('품목과 차수를 선택하세요.'); return; }
    setSaving(true); setErr('');
    try {
      for (const c of custDist) {
        const qty = outInputs[c.CustKey] || 0;
        if (qty <= 0) continue;
        await fetch('/api/shipment/distribute', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            week, year: new Date().getFullYear().toString(),
            outDate: weekToShipDate(week),
            custKey: c.CustKey,
            prodKey: selectedProd.ProdKey,
            outQty: qty,
            cost: selectedProd.Cost || 0,
          })
        });
      }
      const savedCount = custDist.filter(c => (outInputs[c.CustKey]||0) > 0).length;
      const totalSaved = Object.values(outInputs).reduce((a,b)=>a+(b||0),0);
      setSaveModal({
        prodName: selectedProd.ProdName,
        week,
        savedCount,
        totalQty: totalSaved,
      });
      selectProd(selectedProd); // 새로고침
    } catch(e) { setErr(e.message); } finally { setSaving(false); }
  };

  const filteredProds = products.filter(p => !prodFilter || (p.DisplayName || p.ProdName).toLowerCase().includes(prodFilter.toLowerCase()) || p.ProdName.toLowerCase().includes(prodFilter.toLowerCase()));
  const totalOutInput = Object.values(outInputs).reduce((a,b)=>a+b,0);
  const remain = (inQty||0) - totalOutInput;

  const tabs = ['출고 분배 및 농장 정보','출고일 지정','출고 분배 집계'];

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 104px)'}}>
      {/* 툴바 */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'8px 8px 0 0',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',flexShrink:0}}>
        <WeekInput weekInput={weekInput} label="차수" />
        <span className="filter-label">품목</span>
        <select className="filter-select" value={prodGroup} onChange={e=>setProdGroup(e.target.value)} style={{minWidth:160}}>
          <option value="">전체</option>
          {PROD_GROUPS.map(g=><option key={g}>{g}</option>)}
        </select>
        <span className="filter-label">거래처</span>
        <input className="filter-input" placeholder="거래처명 입력 후 조회▶" value={custFilter||''}
          onChange={e=>setCustFilter(e.target.value)}
          onKeyDown={e=>e.key==='Enter' && handleSearch()}
          style={{minWidth:150, borderColor: custFilter ? 'var(--blue)' : undefined, fontWeight: custFilter ? 600 : undefined}} />
        {custFilter && (
          <button className="btn btn-sm" style={{padding:'2px 7px',fontSize:11}} onClick={()=>{setCustFilter('');setSelectedCust(null);setCustItems([]);setViewMode('prod');}}>✕</button>
        )}
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          <button className="btn btn-secondary btn-sm" onClick={handleSearch}>🔍 조회</button>
          <button className="btn btn-success btn-sm" onClick={handleFix} disabled={fixLoading||isFixed}>
            {fixLoading?'처리중... / Procesando': isFixed?'✅ 확정됨 / Confirmado':'✅ 확정 / Confirmar'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleUnfix} disabled={fixLoading||!isFixed}>
            ↩️ 확정취소 / Cancelar / Anular
          </button>
          <button className="btn btn-primary btn-sm" onClick={viewMode==='cust' ? handleSaveCustItems : handleSave} disabled={saving}>{saving?'저장중... / Guardando':'💾 저장 / Guardar'}</button>
          <button className="btn btn-secondary btn-sm" onClick={handleHistory}>📋 내역 조회 / Historial</button>
          <button className="btn btn-success btn-sm" onClick={() => handleExcelDownload()} disabled={excelDownloading}>
            {excelDownloading ? '다운로드중...' : '📥 엑셀 다운 / Excel'}
          </button>
          <button className="btn btn-sm" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>

      {/* 알림 */}
      {err && <div style={{padding:'6px 14px',background:'var(--red-bg)',color:'var(--red)',fontSize:12,borderLeft:'3px solid var(--red)',flexShrink:0}}>⚠️ {err}</div>}
      {successMsg && <div style={{padding:'6px 14px',background:'var(--green-bg)',color:'var(--green)',fontSize:12,flexShrink:0}}>{successMsg}</div>}

      {/* 저장 완료 모달 */}
      {saveModal && (
        <div className="modal-overlay" onClick={() => setSaveModal(null)}>
          <div className="modal" style={{maxWidth:380, textAlign:'center'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{background:'#E8F8E8', borderBottom:'2px solid #66BB66'}}>
              <span className="modal-title" style={{color:'#006600'}}>✅ 출고 분배 저장 완료</span>
            </div>
            <div className="modal-body" style={{padding:'20px 24px'}}>
              <div style={{fontSize:15, fontWeight:'bold', marginBottom:16, color:'#006600'}}>
                출고 분배가 저장되었습니다.
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                <tbody>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)', width:100}}>품목</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.prodName}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>차수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--blue)'}}>{saveModal.week}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>거래처 수</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold'}}>{saveModal.savedCount}개</td>
                  </tr>
                  <tr>
                    <td style={{padding:'6px 4px', color:'var(--text3)'}}>총 출고수량</td>
                    <td style={{padding:'6px 4px', fontWeight:'bold', color:'var(--amber)'}}>{saveModal.totalQty.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              <button className="btn btn-primary" style={{width:'100%', height:36, fontSize:13}}
                onClick={() => setSaveModal(null)}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={{display:'flex',borderBottom:'2px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
        {tabs.map((t,i) => (
          <div key={t} onClick={()=>setTab(i)}
            style={{padding:'9px 16px',fontSize:13,fontWeight:600,cursor:'pointer',color:tab===i?'var(--blue)':'var(--text3)',borderBottom:tab===i?'2px solid var(--blue)':'2px solid transparent',marginBottom:-2,whiteSpace:'nowrap'}}>
            {['🚚','📅','📊'][i]} {t}
          </div>
        ))}
        {/* 보기 모드 전환 */}
        {tab===0 && (
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,padding:'0 14px'}}>
            <span style={{fontSize:11,color:'var(--text3)'}}>조회 기준:</span>
            <button className={`btn btn-sm ${viewMode==='prod'?'btn-primary':'btn-secondary'}`} onClick={()=>setViewMode('prod')}>품목 기준</button>
            <button className={`btn btn-sm ${viewMode==='cust'?'btn-primary':'btn-secondary'}`} onClick={()=>setViewMode('cust')}>업체 기준</button>
          </div>
        )}
      </div>

      {/* 탭1 본문 */}
      {tab === 0 && (
        <div style={{display:'grid',gridTemplateColumns: viewMode==='prod'?'320px 1fr':'240px 1fr',flex:1,overflow:'hidden',background:'var(--surface)',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px'}}>

          {/* ── 품목 기준: 왼쪽 품목 목록 ── */}
          {viewMode === 'prod' && (
            <div style={{borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:6}}>
                <input className="filter-input" placeholder="품목명 검색..." value={prodFilter} onChange={e=>setProdFilter(e.target.value)} style={{flex:1,height:28,fontSize:12}}/>
              </div>
              <div style={{overflowY:'auto',flex:1}}>
                {loading ? <div className="skeleton" style={{margin:12,height:300,borderRadius:8}}></div> : (
                  <table className="tbl" style={{fontSize:12}}>
                    <thead>
                      <tr>
                        <th>품목명(색상)</th><th>단위</th>
                        <th style={{textAlign:'right'}}>box</th><th style={{textAlign:'right'}}>단</th><th style={{textAlign:'right'}}>송이</th>
                        <th style={{textAlign:'right',color:'var(--text3)'}}>전재고</th>
                        <th style={{textAlign:'right',color:'var(--blue)'}}>입고</th>
                        <th style={{textAlign:'right'}}>출고</th>
                        <th style={{textAlign:'right',color:'var(--green)'}}>현재고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProds.length === 0
                        ? <tr><td colSpan={9} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>차수 선택 후 조회하세요</td></tr>
                        : filteredProds.map(p => {
                          const isSelected = selectedProd?.ProdKey === p.ProdKey;
                          const hasStock = p.inQty > 0;
                          return (
                            <tr key={p.ProdKey} className={isSelected?'selected':''} onClick={()=>selectProd(p)} style={{cursor:'pointer',background:hasStock&&!isSelected?'#F0F7FF':undefined}}>
                              <td style={{fontWeight:hasStock?600:400,color:hasStock?'var(--blue)':'var(--text2)'}}>{p.DisplayName || p.ProdName}</td>
                              <td style={{color:'var(--text3)'}}>{p.OutUnit}</td>
                              <td className="num">{p.BunchOf1Box||0}</td>
                              <td className="num">{p.SteamOf1Box||0}</td>
                              <td className="num">{(p.BunchOf1Box||0)*(p.SteamOf1Box||0)}</td>
                              <td className="num" style={{color:'var(--text3)'}}>{((p.prevStock||0)-(p.inQty||0))!==0?((p.prevStock||0)-(p.inQty||0)).toFixed(2):'—'}</td>
                              <td className="num" style={{color:'var(--blue)',fontWeight:p.inQty>0?700:400}}>{p.inQty?.toFixed(2)||'—'}</td>
                              <td className="num">{p.outQty?.toFixed(2)||'—'}</td>
                              <td className="num" style={{fontWeight:700,color:(p.prevStock-p.outQty)>0?'var(--green)':'var(--text3)'}}>{((p.prevStock||0)-(p.outQty||0)).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="foot">
                        <td colSpan={5}>합계</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+((b.prevStock||0)-(b.inQty||0)),0).toFixed(2)}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+(b.inQty||0),0).toFixed(2)}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+(b.outQty||0),0).toFixed(2)}</td>
                        <td className="num">{filteredProds.reduce((a,b)=>a+((b.prevStock||0)-(b.outQty||0)),0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── 업체 기준: 왼쪽 업체 목록 ── */}
          {viewMode === 'cust' && (
            <div style={{borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'8px 12px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',fontSize:11,fontWeight:700,color:'var(--text2)'}}>거래처 목록</div>
              <div style={{overflowY:'auto',flex:1}}>
                {loading ? <div className="skeleton" style={{margin:12,height:200,borderRadius:8}}></div> : (
                  <table className="tbl" style={{fontSize:12}}>
                    <thead><tr><th>거래처명</th><th>지역</th><th>코드</th></tr></thead>
                    <tbody>
                      {custList.filter(c => !custFilter || c.CustName.includes(custFilter)).length === 0
                        ? <tr><td colSpan={3} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>차수 조회 후 표시</td></tr>
                        : custList.filter(c => !custFilter || c.CustName.includes(custFilter)).map(c => (
                          <tr key={c.CustKey} className={selectedCust?.CustKey===c.CustKey?'selected':''} onClick={()=>selectCust(c)} style={{cursor:'pointer'}}>
                            <td className="name">{c.CustName}</td>
                            <td><span className="badge badge-gray" style={{fontSize:10}}>{c.CustArea}</span></td>
                            <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.OrderCode}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── 오른쪽: 거래처 분배 정보 (품목기준) / 품목 목록 (업체기준) ── */}
          <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
            {viewMode === 'prod' && (
              <>
                {/* 분배 컨트롤 */}
                <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text2)'}}>분배방식</span>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='ratio'} onChange={()=>setDistMode('ratio')}/> 비율 분배
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                    <input type="radio" name="distMode" checked={distMode==='prior'} onChange={()=>setDistMode('prior')}/> 우선 분배
                  </label>
                  <button className="btn btn-secondary btn-sm" onClick={autoDistribute}>📋 일괄 출고분배 / Distrib. masiva</button>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{const o={};custDist.forEach(c=>{o[c.CustKey]=c.주문수량||0;});setOutInputs(o);}}>📦 개별 출고분배 / Distrib. indiv.</button>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{const o={};custDist.forEach(c=>{o[c.CustKey]=0;});setOutInputs(o);setOutQty(0);}}>🔄 개별 초기화</button>
                </div>
                {/* 입고/출고/잔량 */}
                <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--bg)',flexShrink:0}}>
                  {[['입고수량',inQty,'var(--blue)'],['출고수량',totalOutInput,'var(--text1)'],['잔량',remain,remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)']].map(([label,val,color])=>(
                    <div key={label} style={{flex:1,padding:'10px 16px',textAlign:'center',borderRight:'1px solid var(--border)'}}>
                      <div style={{fontSize:11,color:'var(--text3)',marginBottom:3}}>{label}</div>
                      <div style={{fontSize:20,fontWeight:900,fontFamily:'var(--mono)',color}}>{(val||0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                {/* 거래처 분배 테이블 */}
                <div style={{overflowY:'auto',flex:1}}>
                  {!selectedProd
                    ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">품목을 선택하세요</div></div>
                    : distLoading ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                    : (
                      <>
                        <div style={{padding:'6px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600}}>
                          {selectedProd.DisplayName || selectedProd.ProdName} — 거래처 분배 정보
                        </div>
                        <table className="tbl" style={{fontSize:12}}>
                          <thead>
                            <tr>
                              <th>거래처명</th><th>주문코드</th><th>단위</th>
                              <th style={{textAlign:'right'}}>주문수량</th>
                              <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                              <th style={{textAlign:'right'}}>차이</th>
                              <th style={{textAlign:'right'}}>Box수량</th>
                              <th style={{textAlign:'right'}}>단수량</th>
                              <th style={{textAlign:'right'}}>송이수량</th>
                              <th style={{textAlign:'right'}}>단가</th>
                              <th>비고</th>
                            </tr>
                          </thead>
                          <tbody>
                            {custDist.length === 0
                              ? <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>주문 데이터 없음</td></tr>
                              : custDist.map(c => {
                                const outVal = outInputs[c.CustKey] || 0;
                                const diff = (c.주문수량||0) - outVal;
                                const boxQty = selectedProd.OutUnit==='박스' ? outVal : 0;
                                const bunchQty = selectedProd.OutUnit==='박스' ? Math.floor(outVal*(selectedProd.BunchOf1Box||1)) : selectedProd.OutUnit==='단' ? outVal : 0;
                                const steamQty = Math.floor(outVal*(selectedProd.SteamOf1Box||1));
                                return (
                                  <tr key={c.CustKey}>
                                    <td className="name">{c.CustName}</td>
                                    <td style={{fontFamily:'var(--mono)',fontSize:11}}>{c.주문코드}</td>
                                    <td style={{fontSize:11}}>{c.단위}</td>
                                    <td className="num">{(c.주문수량||0).toFixed(2)}</td>
                                    <td>
                                      <input type="number" min={0} step={1} value={outVal||''}
                                        onChange={e=>{const v=parseFloat(e.target.value)||0;setOutInputs(o=>({...o,[c.CustKey]:v}));}}
                                        style={{width:75,height:26,border:`1px solid ${outVal>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:outVal>0?'var(--blue-bg)':'var(--bg)',fontWeight:outVal>0?700:400}}
                                      />
                                    </td>
                                    <td className="num" style={{color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--text3)'}}>{diff.toFixed(2)}</td>
                                    <td className="num">{boxQty||'—'}</td>
                                    <td className="num">{bunchQty||'—'}</td>
                                    <td className="num">{steamQty||'—'}</td>
                                    <td className="num">{fmt(selectedProd.Cost||0)}</td>
                                    <td style={{fontSize:11,color:'var(--text3)'}}>{c.비고||'—'}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                          <tfoot>
                            <tr className="foot">
                              <td colSpan={3}>합계</td>
                              <td className="num">{custDist.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                              <td className="num" style={{color:'var(--blue)'}}>{totalOutInput.toFixed(2)}</td>
                              <td className="num" style={{color:remain<0?'var(--red)':remain===0?'var(--green)':'var(--amber)'}}>{remain.toFixed(2)}</td>
                              <td colSpan={5}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </>
                    )}
                </div>
              </>
            )}

            {/* 업체 기준 오른쪽: 해당 업체 주문 품목 */}
            {viewMode === 'cust' && (
              <div style={{overflowY:'auto',flex:1}}>
                {!selectedCust
                  ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
                  : custLoading ? <div className="skeleton" style={{margin:16,height:300,borderRadius:8}}></div>
                  : (
                    <>
                      <div style={{padding:'8px 14px',background:'var(--blue-bg)',fontSize:12,color:'var(--blue)',fontWeight:600,borderBottom:'1px solid var(--border-t)'}}>
                        {selectedCust.CustName} ({selectedCust.OrderCode}) — 주문 품목 목록
                      </div>
                      <table className="tbl" style={{fontSize:12}}>
                        <thead>
                          <tr>
                            <th>국가</th><th>꽃</th><th>품목명</th><th>단위</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>주문수량</th>
                            <th style={{textAlign:'right',color:'var(--blue)'}}>출고수량 입력</th>
                            <th style={{textAlign:'right'}}>잔량</th>
                            <th style={{textAlign:'right',color:'var(--amber)'}}>단가 (편집)</th>
                            <th style={{textAlign:'right',color:'var(--text3)'}}>금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custItems.length === 0
                            ? <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>주문 데이터 없음</td></tr>
                            : custItems.map((item,i) => {
                              const edit = custEditInputs[item.ProdKey] || {};
                              const outVal = edit.outQty !== undefined ? edit.outQty : (item.출고수량 || 0);
                              const costVal = edit.cost !== undefined ? edit.cost : (item.Cost || 0);
                              const diff = (item.주문수량||0) - parseFloat(outVal||0);
                              const amount = parseFloat(outVal||0) * parseFloat(costVal||0);
                              return (
                                <tr key={i} style={{background:item.잔량>0?'#FFFBEB':undefined}}>
                                  <td style={{fontSize:11}}>{item.CounName}</td>
                                  <td style={{fontSize:11}}>{item.FlowerName}</td>
                                  <td style={{fontWeight:500}}>{item.DisplayName || item.ProdName}</td>
                                  <td style={{fontSize:11}}>{item.OutUnit}</td>
                                  <td className="num" style={{color:'var(--blue)',fontWeight:700}}>{(item.주문수량||0).toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={0.1} value={outVal||''}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),outQty:e.target.value}}))}
                                      style={{width:80,height:26,border:`1px solid ${parseFloat(outVal)>0?'var(--blue)':'var(--border2)'}`,borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:parseFloat(outVal)>0?'var(--blue-bg)':'var(--bg)',fontWeight:parseFloat(outVal)>0?700:400}}
                                    />
                                  </td>
                                  <td className="num" style={{fontWeight:700,color:diff<0?'var(--red)':diff===0?'var(--green)':'var(--amber)'}}>{diff.toFixed(2)}</td>
                                  <td>
                                    <input type="number" min={0} step={1} value={costVal||''}
                                      onChange={e=>setCustEditInputs(prev=>({...prev,[item.ProdKey]:{...(prev[item.ProdKey]||{}),cost:e.target.value}}))}
                                      style={{width:90,height:26,border:'1px solid var(--amber)',borderRadius:4,textAlign:'right',fontSize:12,fontFamily:'var(--mono)',padding:'0 4px',background:'#FFFBEB'}}
                                    />
                                  </td>
                                  <td className="num" style={{color:'var(--text2)'}}>{amount>0?fmt(Math.round(amount)):'—'}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                        <tfoot>
                          <tr className="foot">
                            <td colSpan={4}>합계</td>
                            <td className="num">{custItems.reduce((a,b)=>a+(b.주문수량||0),0).toFixed(2)}</td>
                            <td className="num" style={{color:'var(--blue)'}}>
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};return a+parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;},0).toFixed(2)}
                            </td>
                            <td className="num">
                              {custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;return a+((item.주문수량||0)-q);},0).toFixed(2)}
                            </td>
                            <td></td>
                            <td className="num" style={{color:'var(--text2)',fontWeight:700}}>
                              {fmt(Math.round(custItems.reduce((a,item)=>{const e=custEditInputs[item.ProdKey]||{};const q=parseFloat(e.outQty!==undefined?e.outQty:(item.출고수량||0))||0;const c=parseFloat(e.cost!==undefined?e.cost:(item.Cost||0))||0;return a+q*c;},0)))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 탭2: 출고일 지정 */}
      {tab === 1 && (
        <div style={{flex:1,overflow:'auto',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px',background:'var(--surface)'}}>
          {/* 상단: 기본 출고요일 설정 */}
          <div style={{padding:'12px 16px',borderBottom:'2px solid var(--border)',background:'#F8FAFC'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{fontSize:13,fontWeight:700}}>📅 품목그룹별 기본 출고요일 설정</span>
              <button className="btn btn-primary btn-sm" onClick={saveShipDayConfigs} disabled={shipDaySaving}>
                {shipDaySaving ? '저장중...' : '💾 출고요일 저장'}
              </button>
              {shipDayLoading && <span style={{fontSize:11,color:'var(--text3)'}}>로딩...</span>}
            </div>
            <div style={{overflowX:'auto'}}>
              <table className="tbl" style={{fontSize:12,minWidth:600}}>
                <thead>
                  <tr>
                    <th style={{width:180}}>품목그룹</th>
                    {WEEK_SUFFIXES.map(s => (
                      <th key={s} colSpan={5} style={{textAlign:'center',color:'var(--blue)'}}>
                        {s.replace('-','')+'차'}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th></th>
                    {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => (
                      <th key={s+d} style={{textAlign:'center',fontSize:11,width:40,padding:'4px 2px'}}>{d}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {PROD_GROUPS.map(pg => (
                    <tr key={pg}>
                      <td style={{fontWeight:600,fontSize:12}}>{pg}</td>
                      {WEEK_SUFFIXES.map(s => DAY_NAMES.map(d => {
                        const key = `${pg}|${s}`;
                        const checked = (shipDayConfigs[key] || '').split(',').includes(d);
                        return (
                          <td key={s+d} style={{textAlign:'center',padding:'3px 2px'}}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleShipDay(pg, s, d)}
                              style={{cursor:'pointer',width:16,height:16}} />
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하단: 업체별 일별 수량 분배 */}
          <div style={{display:'grid',gridTemplateColumns:'240px 1fr',flex:1,overflow:'hidden'}}>
            {/* 업체 목록 */}
            <div style={{borderRight:'1px solid var(--border)',overflowY:'auto'}}>
              <div style={{padding:'8px 12px',background:'#F0F7FF',borderBottom:'1px solid var(--border)',fontSize:11,fontWeight:700}}>
                업체 선택 → 일별 분배
              </div>
              {custList.length === 0
                ? <div style={{padding:20,textAlign:'center',color:'var(--text3)',fontSize:12}}>차수 조회 후 표시</div>
                : custList.map(c => (
                  <div key={c.CustKey}
                    onClick={() => loadTab2Items(c.CustKey)}
                    style={{
                      padding:'6px 12px',fontSize:12,cursor:'pointer',
                      background: tab2CustKey === c.CustKey ? 'var(--blue-bg)' : undefined,
                      borderBottom:'1px solid var(--border)',
                      fontWeight: tab2CustKey === c.CustKey ? 700 : 400,
                    }}>
                    {c.CustName} <span style={{fontSize:10,color:'var(--text3)'}}>{c.CustArea}</span>
                  </div>
                ))
              }
            </div>

            {/* 품목별 일별 수량 */}
            <div style={{overflowY:'auto',overflowX:'auto'}}>
              {!tab2CustKey
                ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
                : tab2Loading
                ? <div className="skeleton" style={{margin:16,height:200,borderRadius:8}}></div>
                : (
                  <table className="tbl" style={{fontSize:12}}>
                    <thead>
                      <tr>
                        <th>국가</th><th>꽃</th><th>품목명</th><th>단위</th>
                        <th style={{textAlign:'right'}}>출고수량</th>
                        {DAY_NAMES.map(d => (
                          <th key={d} style={{textAlign:'center',color:'var(--blue)',width:65}}>{d}</th>
                        ))}
                        <th style={{textAlign:'right'}}>합계</th>
                        <th style={{textAlign:'center'}}>차이</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tab2Items.length === 0
                        ? <tr><td colSpan={12} style={{textAlign:'center',padding:24,color:'var(--text3)'}}>출고 데이터 없음 (탭1에서 먼저 분배하세요)</td></tr>
                        : tab2Items.filter(item => (item.출고수량 || 0) > 0).map((item, i) => {
                          const totalQty = item.출고수량 || 0;
                          const days = getShipDays(tab2CustKey, item.ProdKey, item.CountryFlower || '');
                          const key = `${tab2CustKey}|${item.ProdKey}`;
                          const dayInputs = dailyQtyInputs[key] || {};
                          const daySum = Object.values(dayInputs).reduce((a, b) => a + (parseFloat(b) || 0), 0);
                          const diff = totalQty - daySum;

                          return (
                            <tr key={i} style={{background: diff !== 0 ? '#FFF3E0' : undefined}}>
                              <td style={{fontSize:11}}>{item.CounName}</td>
                              <td style={{fontSize:11}}>{item.FlowerName}</td>
                              <td style={{fontWeight:500}}>{item.DisplayName || item.ProdName}</td>
                              <td style={{fontSize:11}}>{item.OutUnit}</td>
                              <td className="num" style={{fontWeight:700,color:'var(--blue)'}}>{totalQty}</td>
                              {DAY_NAMES.map(d => {
                                const isActive = days.includes(d);
                                return (
                                  <td key={d} style={{textAlign:'center',padding:'2px 3px',background: isActive ? '#E3F2FD' : '#F5F5F5'}}>
                                    {isActive ? (
                                      <input type="number" min={0} step={1}
                                        value={dayInputs[d] ?? ''}
                                        onChange={e => handleDailyQtyChange(tab2CustKey, item.ProdKey, d, e.target.value, totalQty, days)}
                                        style={{width:50,height:24,textAlign:'right',fontSize:11,fontFamily:'var(--mono)',
                                          border:'1px solid var(--blue)',borderRadius:3,padding:'0 3px',
                                          background: (dayInputs[d] || 0) > 0 ? '#E3F2FD' : '#fff'}}
                                      />
                                    ) : (
                                      <span style={{color:'#ccc',fontSize:10}}>—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="num" style={{fontWeight:700}}>{daySum}</td>
                              <td className="num" style={{
                                fontWeight:700,
                                color: diff === 0 ? 'var(--green)' : diff > 0 ? 'var(--amber)' : 'var(--red)',
                              }}>
                                {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    {tab2Items.filter(item => (item.출고수량 || 0) > 0).length > 0 && (
                      <tfoot>
                        <tr className="foot">
                          <td colSpan={4}>합계</td>
                          <td className="num">{tab2Items.reduce((a, b) => a + (b.출고수량 || 0), 0)}</td>
                          {DAY_NAMES.map(d => {
                            const dayTotal = tab2Items.filter(item => (item.출고수량 || 0) > 0).reduce((a, item) => {
                              const key = `${tab2CustKey}|${item.ProdKey}`;
                              return a + (parseFloat(dailyQtyInputs[key]?.[d]) || 0);
                            }, 0);
                            return <td key={d} className="num">{dayTotal || ''}</td>;
                          })}
                          <td className="num">
                            {tab2Items.filter(item => (item.출고수량 || 0) > 0).reduce((a, item) => {
                              const key = `${tab2CustKey}|${item.ProdKey}`;
                              return a + Object.values(dailyQtyInputs[key] || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                            }, 0)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
            </div>
          </div>
        </div>
      )}

      {/* 탭3: 출고 분배 집계 */}
      {tab === 2 && (
        <div style={{flex:1,overflow:'auto',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 8px 8px',background:'var(--surface)'}}>
          <div style={{padding:'8px 14px',background:'#F8FAFC',borderBottom:'1px solid var(--border)',display:'flex',gap:8,alignItems:'center'}}>
            {['차수','품목명','지역','담당자','주문수량','출고수량'].map(f=>(
              <span key={f} className={`chip ${f==='주문수량'||f==='출고수량'?'chip-active':'chip-inactive'}`}>{f}</span>
            ))}
          </div>
          <div style={{overflowX:'auto'}}>
            <table className="tbl" style={{minWidth:600}}>
              <thead>
                <tr>
                  <th>국가</th><th>꽃</th><th>품목명(색상)</th>
                  {custList.map(c=><th key={c.CustKey} colSpan={2} style={{textAlign:'center',color:'var(--blue)',fontSize:11}}>{c.CustName}</th>)}
                </tr>
                <tr>
                  <th colSpan={3}></th>
                  {custList.map(c=>[
                    <th key={`${c.CustKey}-o`} style={{textAlign:'right',fontSize:10}}>주문</th>,
                    <th key={`${c.CustKey}-s`} style={{textAlign:'right',fontSize:10}}>출고</th>
                  ])}
                </tr>
              </thead>
              <tbody>
                {products.map(p=>(
                  <tr key={p.ProdKey}>
                    <td style={{fontSize:11}}>{p.CounName}</td>
                    <td style={{fontSize:11}}>{p.FlowerName}</td>
                    <td style={{fontSize:12}}>{p.DisplayName || p.ProdName}</td>
                    {custList.map(c=>{
                      const oq = p.orderQty || 0;
                      const sq = p.outQty || 0;
                      return [
                        <td key={`${c.CustKey}-o`} className="num" style={{fontSize:11}}>{oq||''}</td>,
                        <td key={`${c.CustKey}-s`} className="num" style={{fontSize:11}}>{sq||''}</td>
                      ];
                    })}
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={3+custList.length*2} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>조회 후 표시됩니다</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 확정 전 사전검증 모달 */}
      {showValidate && validateResult && (
        <div className="modal-overlay" onClick={() => setShowValidate(false)}>
          <div className="modal" style={{maxWidth:620}} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{background:'#FFF3CD', borderBottom:'2px solid #FFC107'}}>
              <span className="modal-title" style={{color:'#856404'}}>⚠️ 확정 전 이슈 발견 ({validateResult.issueCount}건) — [{validateResult.week}]</span>
              <button className="modal-close" onClick={() => setShowValidate(false)}>✕</button>
            </div>
            <div className="modal-body" style={{padding:'16px 20px', maxHeight:'60vh', overflowY:'auto', fontSize:12}}>

              {validateResult.negative?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#c00', marginBottom:6}}>🔴 마이너스 잔량 ({validateResult.negative.length}건) — 출고량이 입고+재고 초과</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#f8d7da'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>전재고</th>
                      <th style={{padding:'4px 6px'}}>입고</th>
                      <th style={{padding:'4px 6px'}}>출고</th>
                      <th style={{padding:'4px 6px', color:'#c00'}}>잔량</th>
                    </tr></thead>
                    <tbody>{validateResult.negative.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #f5c6cb'}}>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.prevStock}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.inQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.outQty}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.remain}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.duplicate?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#856404', marginBottom:6}}>🟡 중복 출고 ({validateResult.duplicate.length}건) — 같은 거래처+품목에 복수 입력</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#fff3cd'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>건수</th>
                      <th style={{padding:'4px 6px'}}>합계</th>
                    </tr></thead>
                    <tbody>{validateResult.duplicate.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #ffeeba'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center', color:'#c00', fontWeight:700}}>{r.cnt}건</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.totalQty}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {validateResult.ghost?.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontWeight:700, color:'#555', marginBottom:6}}>⚪ 주문 없는 출고 ({validateResult.ghost.length}건) — 주문 미등록 상태에서 출고 분배됨</div>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead><tr style={{background:'#e2e3e5'}}>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>거래처</th>
                      <th style={{padding:'4px 6px', textAlign:'left'}}>품목</th>
                      <th style={{padding:'4px 6px'}}>수량</th>
                      <th style={{padding:'4px 6px'}}>확정여부</th>
                    </tr></thead>
                    <tbody>{validateResult.ghost.map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid #d6d8db'}}>
                        <td style={{padding:'3px 6px'}}>{r.CustName}</td>
                        <td style={{padding:'3px 6px'}}>{r.ProdName}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.OutQuantity}</td>
                        <td style={{padding:'3px 6px', textAlign:'center'}}>{r.isFix ? '확정' : '미확정'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              <div style={{color:'#666', fontSize:11, marginTop:8}}>위 이슈를 확인 후 수정하거나, 이상 없으면 그대로 확정할 수 있습니다.</div>
            </div>
            <div className="modal-footer" style={{display:'flex', gap:8, justifyContent:'flex-end', padding:'12px 20px'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowValidate(false)}>취소 / Cancelar</button>
              <button className="btn btn-warning btn-sm" style={{background:'#FFC107', color:'#000', border:'none'}}
                onClick={() => { setShowValidate(false); doFix(); }}>
                이슈 무시하고 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 출고 분배 내역 조회 모달 */}
      {showHistory && (
        <div className="modal-overlay" onClick={()=>setShowHistory(false)}>
          <div className="modal" style={{maxWidth:860}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">■ 출고 분배 내역 조회 — [{week}] 차수</span>
              <button className="btn btn-sm" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
            <div className="modal-body" style={{padding:0,maxHeight:'70vh',overflowY:'auto'}}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>변경일자</th><th>차수</th><th>거래처명</th>
                    <th>국가</th><th>꽃</th><th>품목명</th>
                    <th>변경유형</th><th>변경항목</th>
                    <th style={{textAlign:'right'}}>기준값</th>
                    <th style={{textAlign:'right'}}>변경값</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.length === 0
                    ? <tr><td colSpan={11} style={{textAlign:'center',padding:32,color:'var(--text3)'}}>변경 내역 없음</td></tr>
                    : historyData.map((r,i) => (
                      <tr key={i}>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{r.ChangeDtm}</td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:'bold'}}>{r.week}</td>
                        <td>{r.CustName}</td>
                        <td>{r.country}</td>
                        <td>{r.flower}</td>
                        <td style={{fontSize:12}}>{r.name}</td>
                        <td>
                          <span className={`badge ${r.type==='신규'?'badge-green':r.type==='수정'?'badge-blue':'badge-red'}`}>
                            {r.type}
                          </span>
                        </td>
                        <td style={{fontSize:11}}>{r.변경항목||'수량'}</td>
                        <td className="num" style={{color:'var(--text3)'}}>{r.before}</td>
                        <td className="num" style={{fontWeight:'bold',color:r.type==='삭제'?'var(--red)':r.type==='신규'?'var(--green)':'var(--blue)'}}>{r.after}</td>
                        <td style={{fontSize:11,color:'var(--text3)'}}>{r.Descr||'—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowHistory(false)}>{t('닫기')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
