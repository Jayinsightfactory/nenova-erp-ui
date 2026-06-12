// pages/stats/pivot.js
// Pivot 통계 — 기존 프로그램과 동일한 구조
// 수정이력: 2026-03-30 — 완전 재구현
//   행 토글: 품목명, 출고일, 입고단가, 입고총단가, AWB
//   열: 주문년도 ▲, 주문차수 ▲, 구분(01전재고/02주문/03입고/05현재고) ▲▼, 지역 ▲, 비고 ▲, 거래처명/농장명 ▲
//   구분별 열: 02.주문=거래처명, 03.입고=농장명
//   즐겨찾기: 현재 설정 저장/불러오기

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiGet } from '../../lib/useApi';
import { useColumnResize } from '../../lib/useColumnResize';
import { useWeekInput, useYearInput, getCurrentWeek, WeekInput, WeekSpinInput, YearInput } from '../../lib/useWeekInput';
import { t } from '../../lib/i18n';
import { useLang } from '../../lib/i18n';
import {
  PIVOT_FIELDS, FIELD_BY_ID, ZONES, canDropInZone, COL_GROUP_LABELS, COL_GROUP_FIELD_MAP,
  DEFAULT_COLUMN_ZONE, sectionsFromColumnZone, columnZoneFromSections,
} from '../../lib/pivotFieldRegistry';

const DND_FIELD_ID = 'application/x-pivot-field-id';
const DND_FIELD_FROM = 'application/x-pivot-field-from';

const fN = n => (!n || n === 0) ? '' : Number(n).toFixed(2);

// 행 대표 분배단가 — compact 뷰용. 거래처별 분배단가를 주문수량으로 가중 평균.
// Σ(orders[c]·distCostOrders[c]) / Σ(orders[c] for c in distCostOrders)
const rowDistCostAvg = r => {
  const dc = r?.distCostOrders || {};
  const ord = r?.orders || {};
  let num = 0, den = 0;
  for (const c of Object.keys(dc)) {
    const cost = Number(dc[c] || 0);
    if (!(cost > 0)) continue;
    const q = Number(ord[c] || 0) || 1;  // 주문수량 없으면 균등 가중
    num += q * cost; den += q;
  }
  return den > 0 ? num / den : 0;
};

// 정렬 방향 토글
const nextSort = s => s === null ? 'asc' : s === 'asc' ? 'desc' : null;
const SortIcon = ({ dir }) => dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ' ▲';

// 컬럼 헤더 버튼 (클릭 시 정렬 + 필터 드롭다운)
// - createPortal로 body에 렌더링 → overflow:auto 컨테이너에 잘리지 않음
// - useRef + getBoundingClientRect로 위치 계산
function ColHeader({ label, sortKey, sorts, onSort, filter, onFilter, filterOptions }) {
  const [showFilter, setShowFilter] = useState(false);
  const [dropPos,    setDropPos]    = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const dir    = sorts[sortKey] || null;

  // 전체해제 상태 (filter=['__EMPTY__'])
  const allDeselected = filter?.includes('__EMPTY__');
  // 필터 활성 여부 (일부만 선택)
  const hasFilter = filter?.length > 0 && !allDeselected;

  // 체크 여부 계산
  const isChecked = opt => {
    if (allDeselected) return false;
    if (!filter?.length) return true;
    return filter.includes(opt);
  };

  // 체크박스 토글
  const handleChange = (opt, checked) => {
    let cur;
    if (allDeselected)    cur = [];
    else if (!filter?.length) cur = [...filterOptions];
    else                  cur = [...filter];

    let next = checked
      ? [...new Set([...cur, opt])]
      : cur.filter(x => x !== opt);
    if (next.length === filterOptions.length) next = []; // 전부 선택 → 필터 없음
    onFilter(sortKey, next);
  };

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!showFilter) return;
    const close = e => setShowFilter(false);
    const t = setTimeout(() => document.addEventListener('click', close), 50);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [showFilter]);

  return (
    <th style={{textAlign:'center', fontSize:11, position:'relative', cursor:'pointer',
      background:'#D4DDE8', whiteSpace:'nowrap'}}
      onClick={() => onSort(sortKey)}
    >
      {label}<SortIcon dir={dir}/>

      {/* 필터 ▼ 버튼 — filterOptions가 1개 이상일 때만 표시 */}
      {filterOptions?.length > 0 && (
        <span ref={btnRef}
          onClick={e => {
            e.stopPropagation();
            if (!showFilter && btnRef.current) {
              const r = btnRef.current.getBoundingClientRect();
              setDropPos({ top: r.bottom + window.scrollY, left: r.left + window.scrollX });
            }
            setShowFilter(s => !s);
          }}
          style={{
            marginLeft: 4, fontSize: 10, cursor: 'pointer',
            color:      hasFilter ? '#fff'          : 'var(--text2)',
            background: hasFilter ? 'var(--blue)'   : '#dde4ee',
            border: `1px solid ${hasFilter ? 'var(--blue)' : 'var(--border2)'}`,
            borderRadius: 2, padding: '0 3px',
            display: 'inline-block', lineHeight: '14px', userSelect: 'none',
          }}>▼</span>
      )}

      {/* 드롭다운 — portal로 body에 렌더링 (overflow 컨테이너 클리핑 방지) */}
      {showFilter && filterOptions?.length > 0 && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed',
          top:  dropPos.top,
          left: dropPos.left,
          zIndex: 9999,
          background: '#fff',
          border: '2px solid var(--border2)',
          minWidth: 170,
          maxHeight: 260,
          overflowY: 'auto',
          boxShadow: '3px 4px 12px rgba(0,0,0,.28)',
          borderRadius: 4,
        }} onClick={e => e.stopPropagation()}>

          {/* 전체선택/해제 상태 표시 행 */}
          <div style={{padding:'4px 8px', background:'#f0f4fa', borderBottom:'1px solid var(--border)',
            fontSize:10, color:'var(--text3)'}}>
            {label} 필터 ({allDeselected ? '전체해제' : !filter?.length ? '전체선택' : `${filter.length}/${filterOptions.length}개`})
          </div>

          {filterOptions.map(opt => (
            <label key={opt} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 10px',
              fontSize:11, cursor:'pointer',
              background: isChecked(opt) ? '#f0f6ff' : '#fff'}}>
              <input type="checkbox"
                checked={isChecked(opt)}
                onChange={e => { e.stopPropagation(); handleChange(opt, e.target.checked); }} />
              {opt}
            </label>
          ))}

          <div style={{padding:'5px 8px', borderTop:'1px solid var(--border)',
            display:'flex', gap:4, position:'sticky', bottom:0, background:'#f8f8f8'}}>
            <button className="btn btn-sm" style={{fontSize:10, height:20}}
              onClick={e => { e.stopPropagation(); onFilter(sortKey, !filter?.length ? ['__EMPTY__'] : []); }}>
              {!filter?.length ? '전체해제' : '전체선택'}
            </button>
            <button className="btn btn-sm" style={{fontSize:10, height:20}}
              onClick={e => { e.stopPropagation(); setShowFilter(false); }}>닫기</button>
          </div>
        </div>,
        document.body
      )}
    </th>
  );
}

export default function Pivot() {
  const { t } = useLang();
  const yearInput = useYearInput(new Date().getFullYear().toString());
  const weekStartInput = useWeekInput('');
  const weekEndInput   = useWeekInput('');
  const [custFilter, setCustFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [volBusy, setVolBusy] = useState('');   // 물량표 다운로드 진행 표시
  const [pickOpen, setPickOpen] = useState(false);   // 품종 선택 다운로드 모달
  const [pickItems, setPickItems] = useState([]);
  const [pickSel, setPickSel] = useState(new Set());

  // 행 추가 컬럼 토글
  const [showOutDate,  setShowOutDate]  = useState(false);
  const [showInPrice,  setShowInPrice]  = useState(false);
  const [showInTotal,  setShowInTotal]  = useState(false);
  const [showAWB,      setShowAWB]      = useState(false);
  const [showCost,     setShowCost]     = useState(false);
  const [showDescr,    setShowDescr]    = useState(false);
  const [showAmount,   setShowAmount]   = useState(false);
  const [showQty,      setShowQty]      = useState(true);
  const [showArea,     setShowArea]     = useState(false);
  const [showDistCost, setShowDistCost] = useState(false);  // 분배단가(ShipmentDetail.Cost) 표시
  const [showArrival,  setShowArrival]  = useState(false);  // 도착원가(=/freight displayArrivalKRW) 표시

  // ── 뷰 모드: compact(exe 기본 — 02.주문/03.입고 1열 합계) | detail(거래처/농장 전개)
  const [viewMode, setViewMode] = useState('compact');
  useEffect(() => {
    try { const v = localStorage.getItem('pivotViewMode'); if (v === 'compact' || v === 'detail') setViewMode(v); } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('pivotViewMode', viewMode); } catch {} }, [viewMode]);
  const compact = viewMode === 'compact';

  // 열 영역 필드 배치 — 구분(섹션)·그룹·거래처/농장 (showSections는 여기서 파생)
  const [columnZone, setColumnZone] = useState(DEFAULT_COLUMN_ZONE);
  const showSections = useMemo(() => sectionsFromColumnZone(columnZone), [columnZone]);

  // 열 정렬
  const [sorts, setSorts] = useState({});
  const handleSort = useCallback(key => setSorts(s => ({ ...s, [key]: nextSort(s[key]) })), []);

  // 열 필터
  const [filters, setFilters] = useState({});
  const handleFilter = useCallback((key, vals) => setFilters(f => ({ ...f, [key]: vals })), []);

  // 접기
  const [collapsed, setCollapsed] = useState(new Set());
  const toggleCollapse = useCallback(key => setCollapsed(s => { const n=new Set(s); n.has(key)?n.delete(key):n.add(key); return n; }), []);

  // 즐겨찾기
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pivotFavs')||'[]'); } catch { return []; }
  });
  const [favName, setFavName] = useState('');
  const [showFavMenu, setShowFavMenu] = useState(false);

  // ── 컬럼 그룹 순서 (드래그로 변경 → 02.주문 섹션 계층 결정)
  const [colGroupOrder, setColGroupOrder] = useState(['지역', '비고', '거래처명']);
  const [visibleCustNames, setVisibleCustNames] = useState([]); // 빈 배열 = 전체 표시
  const [showCustPicker, setShowCustPicker] = useState(false);
  const custPickerRef = useRef(null);
  const [dragOverIdx,   setDragOverIdx]   = useState(null);

  // ── Field List (exe DevExpress PivotGrid 형) — 행/열/필터/값 4영역 드래그
  const [showFieldList, setShowFieldList] = useState(true);
  const [filterZone,    setFilterZone]    = useState([]);          // 필터영역에 놓인 필드 id[]
  const [fieldFilters,  setFieldFilters]  = useState({});          // { fieldId: [선택값] }  (없음/빈배열 = 전체)
  const [dragField,     setDragField]     = useState(null);        // { id, from } 현재 드래그 중
  const [zoneHover,     setZoneHover]     = useState(null);        // 드롭 하이라이트 중인 zone id
  const [openFilterChip,setOpenFilterChip]= useState(null);        // 값 체크 드롭다운 열린 필터 필드 id

  // 열 너비 (텍스트보다 좁게 — 드래그 리사이즈, localStorage 유지)
  const [colWidths, setColWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pivotColWidths') || '{}'); } catch { return {}; }
  });
  const saveColWidth = useCallback((idx, w) => {
    setColWidths((prev) => {
      const key = typeof idx === 'string' ? idx : String(idx);
      const next = { ...prev, [key]: w };
      try { localStorage.setItem('pivotColWidths', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const custColWidth = colWidths['g:cust'] ?? 56;
  const setCustColWidth = useCallback((w) => saveColWidth('g:cust', w), [saveColWidth]);

  // 측정/행 토글 ↔ 필드 id 매핑 (Field List 가 기존 state 를 구동)
  const measureState = {
    qty:         [showQty,      setShowQty],
    saleCost:    [showCost,     setShowCost],
    distCost:    [showDistCost, setShowDistCost],
    arrivalCost: [showArrival,  setShowArrival],
    amount:      [showAmount,   setShowAmount],
  };
  const rowOptState = {
    area:    [showArea,    setShowArea],
    outDate: [showOutDate, setShowOutDate],
    inPrice: [showInPrice, setShowInPrice],
    inTotal: [showInTotal, setShowInTotal],
    awb:     [showAWB,     setShowAWB],
    descr:   [showDescr,   setShowDescr],
  };

  // 필드가 현재 자기 영역에서 활성인지 (Field List 칩 렌더링용)
  const isFieldActive = useCallback((id) => {
    const f = FIELD_BY_ID[id];
    if (!f) return false;
    if (f.locked) return true;
    if (f.sectionKey || f.id === 'custName' || f.id === 'farmName') {
      return columnZone.includes(id);
    }
    if (measureState[id]) return measureState[id][0];
    if (rowOptState[id])  return rowOptState[id][0];
    return false;
  }, [showQty, showCost, showDistCost, showArrival, showAmount, showArea, showOutDate, showInPrice, showInTotal, showAWB, showDescr, columnZone]); // eslint-disable-line react-hooks/exhaustive-deps

  // 필드를 자기 영역에 켜기/끄기 (locked 제외)
  const setFieldActive = useCallback((id, on) => {
    const f = FIELD_BY_ID[id];
    if (!f || f.locked) return;
    if (f.sectionKey || f.id === 'custName' || f.id === 'farmName') {
      setColumnZone((z) => {
        if (on) {
          const next = z.includes(id) ? z : [...z, id];
          if (id === 'custName' && !colGroupOrder.includes('거래처명')) setColGroupOrder((o) => [...o, '거래처명']);
          if (id === 'custName' || id === 'farmName') setViewMode('detail');
          return next;
        }
        const next = z.filter((x) => x !== id);
        if (id === 'custName') setColGroupOrder((o) => o.filter((x) => x !== '거래처명'));
        if (!next.includes('custName') && !next.includes('farmName')) setViewMode('compact');
        return next;
      });
      return;
    }
    if (measureState[id]) { measureState[id][1](on); return; }
    if (rowOptState[id])  { rowOptState[id][1](on); return; }
  }, [colGroupOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // pivotFieldLayout 복원 (필터영역 배치 + 값 체크) — 마운트 1회
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pivotFieldLayout');
      if (!raw) return;
      const l = JSON.parse(raw);
      if (Array.isArray(l.filter)) setFilterZone(l.filter.filter(id => FIELD_BY_ID[id]));
      if (l.fieldFilters && typeof l.fieldFilters === 'object') setFieldFilters(l.fieldFilters);
      if (Array.isArray(l.colGroupOrder)) setColGroupOrder(l.colGroupOrder);
      if (Array.isArray(l.visibleCustNames)) setVisibleCustNames(l.visibleCustNames);
      if (Array.isArray(l.columnZone)) {
        setColumnZone(l.columnZone.filter(id => FIELD_BY_ID[id]));
        if (l.columnZone.includes('custName') || l.columnZone.includes('farmName')) setViewMode('detail');
      } else if (l.showSections) setColumnZone(columnZoneFromSections(l.showSections, l.colGroupOrder));
      if (typeof l.showFieldList === 'boolean') setShowFieldList(l.showFieldList);
    } catch {}
  }, []);
  // 레이아웃 변경 시 저장 (값 영역 활성 측정 + 행 옵션도 함께 스냅샷)
  useEffect(() => {
    try {
      const layout = {
        row:    PIVOT_FIELDS.filter(f => f.zone === 'row' && isFieldActive(f.id)).map(f => f.id),
        column: columnZone,
        data:   PIVOT_FIELDS.filter(f => f.zone === 'data' && isFieldActive(f.id)).map(f => f.id),
        filter: filterZone,
        fieldFilters,
        colGroupOrder,
        columnZone,
        visibleCustNames,
        showFieldList,
      };
      localStorage.setItem('pivotFieldLayout', JSON.stringify(layout));
    } catch {}
  }, [filterZone, fieldFilters, colGroupOrder, columnZone, visibleCustNames, showFieldList, isFieldActive]);

  // 필드 드롭 — dataTransfer 우선 (React state 타이밍 이슈 방지)
  const readDropPayload = useCallback((e) => {
    const id = e?.dataTransfer?.getData(DND_FIELD_ID) || e?.dataTransfer?.getData('text/plain') || dragField?.id;
    const from = e?.dataTransfer?.getData(DND_FIELD_FROM) || dragField?.from || '__tray__';
    return { id: id || '', from };
  }, [dragField]);

  const startFieldDrag = useCallback((id, from) => (e) => {
    e.dataTransfer.setData(DND_FIELD_ID, id);
    e.dataTransfer.setData(DND_FIELD_FROM, from);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDragField({ id, from });
  }, []);

  const removeFilterField = useCallback((id) => {
    setFilterZone(z => z.filter(x => x !== id));
    setFieldFilters(ff => { const n = { ...ff }; delete n[id]; return n; });
    if (openFilterChip === id) setOpenFilterChip(null);
  }, [openFilterChip]);

  const removeFromColumnZone = useCallback((id) => {
    setColumnZone((z) => {
      const next = z.filter((x) => x !== id);
      if (id === 'area') setColGroupOrder((o) => o.filter((x) => x !== '지역'));
      if (id === 'descr') setColGroupOrder((o) => o.filter((x) => x !== '비고'));
      if (id === 'custName') setColGroupOrder((o) => o.filter((x) => x !== '거래처명'));
      if (!next.includes('custName') && !next.includes('farmName')) setViewMode('compact');
      return next;
    });
  }, []);

  const removeFieldFromZone = useCallback((id, zoneId) => {
    if (zoneId === 'filter') {
      removeFilterField(id);
      return;
    }
    if (zoneId === 'column') {
      removeFromColumnZone(id);
      return;
    }
    setFieldActive(id, false);
  }, [removeFilterField, removeFromColumnZone, setFieldActive]);

  const handleFieldDrop = useCallback((zoneId, dropId, dropFrom, e) => {
    setZoneHover(null);
    const payload = dropId ? { id: dropId, from: dropFrom || '__tray__' } : readDropPayload(e);
    setDragField(null);
    const { id, from } = payload;
    if (!id || !FIELD_BY_ID[id]) return;
    if (from === zoneId) return;

    const clearFromSource = () => {
      if (from === 'filter') removeFilterField(id);
      else if (from === 'column') removeFromColumnZone(id);
      else if (from === 'row' || from === 'data') setFieldActive(id, false);
    };

    if (zoneId === '__tray__') {
      clearFromSource();
      return;
    }
    if (!canDropInZone(id, zoneId)) return;
    if (from !== '__tray__') clearFromSource();

    if (zoneId === 'filter') {
      setFilterZone(z => z.includes(id) ? z : [...z, id]);
      return;
    }
    if (zoneId === 'column') {
      if (id === 'area' || id === 'descr') {
        if (rowOptState[id]) rowOptState[id][1](false);
        setColumnZone(z => z.includes(id) ? z : [...z, id]);
        const lbl = id === 'area' ? '지역' : '비고';
        setColGroupOrder(o => o.includes(lbl) ? o : [...o, lbl]);
      } else {
        setFieldActive(id, true);
      }
      return;
    }
    if (zoneId === 'row' || zoneId === 'data') {
      setColumnZone(z => {
        if (!z.includes(id)) return z;
        const next = z.filter(x => x !== id);
        if (id === 'area') setColGroupOrder(o => o.filter(x => x !== '지역'));
        if (id === 'descr') setColGroupOrder(o => o.filter(x => x !== '비고'));
        if (id === 'custName') setColGroupOrder(o => o.filter(x => x !== '거래처명'));
        if (!next.includes('custName') && !next.includes('farmName')) setViewMode('compact');
        return next;
      });
      setFieldActive(id, true);
    }
  }, [readDropPayload, setFieldActive, removeFilterField, removeFromColumnZone]);

  // ── Filter Editor
  const [filterConditions, setFilterConditions] = useState([]);
  const [showFilterEditor,  setShowFilterEditor]  = useState(false);
  const [draftConds,        setDraftConds]         = useState([]);

  const captureLayout = useCallback(() => ({
    showOutDate, showInPrice, showInTotal, showAWB, showCost, showDistCost, showArrival, showQty, showAmount,
    showArea, showDescr, columnZone, showSections, viewMode, showFieldList,
    filterZone, fieldFilters, colGroupOrder, visibleCustNames, filters, filterConditions,
  }), [showOutDate, showInPrice, showInTotal, showAWB, showCost, showDistCost, showArrival, showQty, showAmount,
    showArea, showDescr, columnZone, showSections, viewMode, showFieldList, filterZone, fieldFilters, colGroupOrder, visibleCustNames, filters, filterConditions]);

  const applyLayout = useCallback((cfg) => {
    if (!cfg) return;
    setShowOutDate(!!cfg.showOutDate); setShowInPrice(!!cfg.showInPrice);
    setShowInTotal(!!cfg.showInTotal); setShowAWB(!!cfg.showAWB);
    setShowCost(!!cfg.showCost); setShowDistCost(!!cfg.showDistCost);
    setShowArrival(!!cfg.showArrival); setShowQty(cfg.showQty !== false);
    setShowAmount(!!cfg.showAmount); setShowArea(!!cfg.showArea); setShowDescr(!!cfg.showDescr);
    if (Array.isArray(cfg.columnZone)) setColumnZone(cfg.columnZone.filter(id => FIELD_BY_ID[id]));
    else if (cfg.showSections) setColumnZone(columnZoneFromSections(cfg.showSections, cfg.colGroupOrder));
    if (cfg.viewMode === 'compact' || cfg.viewMode === 'detail') setViewMode(cfg.viewMode);
    if (typeof cfg.showFieldList === 'boolean') setShowFieldList(cfg.showFieldList);
    if (Array.isArray(cfg.filterZone)) setFilterZone(cfg.filterZone.filter(id => FIELD_BY_ID[id]));
    if (cfg.fieldFilters && typeof cfg.fieldFilters === 'object') setFieldFilters(cfg.fieldFilters);
    if (Array.isArray(cfg.colGroupOrder)) setColGroupOrder(cfg.colGroupOrder);
    if (Array.isArray(cfg.visibleCustNames)) setVisibleCustNames(cfg.visibleCustNames);
    if (cfg.filters && typeof cfg.filters === 'object') setFilters(cfg.filters);
    if (Array.isArray(cfg.filterConditions)) setFilterConditions(cfg.filterConditions);
  }, []);

  const saveFav = () => {
    if (!favName.trim()) return;
    const cfg = { name: favName.trim(), ...captureLayout() };
    const next = [...favorites, cfg];
    setFavorites(next);
    localStorage.setItem('pivotFavs', JSON.stringify(next));
    setFavName(''); setShowFavMenu(false);
  };
  const loadFav = fav => {
    applyLayout(fav);
    setShowFavMenu(false);
  };
  const delFav = idx => {
    const next = favorites.filter((_,i)=>i!==idx);
    setFavorites(next);
    localStorage.setItem('pivotFavs', JSON.stringify(next));
  };

  const load = () => {
    if (!weekStartInput.value) { setErr('차수를 입력하세요.'); return; }
    setLoading(true); setErr('');
    apiGet('/api/stats/pivot-data', {
      orderYear: yearInput.value,
      weekStart: weekStartInput.value,
      weekEnd: weekEndInput.value || weekStartInput.value,
    })
      .then(d => { setData(d); setCollapsed(new Set()); setFilters({}); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleExcel = () => {
    if (!data) return;
    let exportCusts = data.customers || [];
    if (visibleCustNames.length > 0) {
      if (visibleCustNames.includes('__NONE__')) exportCusts = [];
      else {
        const pick = new Set(visibleCustNames);
        exportCusts = exportCusts.filter(c => pick.has(c.custName));
      }
    }
    const farms = data.farms || [];
    const hdrs = ['국가','꽃','품목명'];
    if (showArea)    hdrs.push('지역');
    if (showOutDate) hdrs.push('출고일');
    if (showInPrice) hdrs.push('입고단가');
    if (showInTotal) hdrs.push('입고총단가');
    if (showArrival) hdrs.push('도착원가');
    if (showAWB)     hdrs.push('AWB');
    if (showAmount)  hdrs.push('판매금액');
    if (showDescr)   hdrs.push('비고');
    if (showSections.prev)     hdrs.push('01.전재고');
    if (showSections.order && !compact) exportCusts.forEach(c=>{ hdrs.push(`주문_${c.custName}`); if(showCost) hdrs.push(`판매단가_${c.custName}`); if(showDistCost) hdrs.push(`분배단가_${c.custName}`); });
    if (showSections.order)    hdrs.push(compact?'02.주문':'02.주문Total');
    if (showSections.order && compact && showDistCost) hdrs.push('분배단가');
    if (showSections.incoming && !compact) farms.forEach(f=>hdrs.push(`입고_${f}`));
    if (showSections.incoming && compact)  hdrs.push('03.입고');
    if (showSections.out)      hdrs.push('04.출고');
    if (showSections.none)     hdrs.push('03.미발주');
    if (showSections.cur)      hdrs.push('05.현재고');

    const rows = [hdrs];
    filteredRows.forEach(r=>{
      const row=[r.country,r.flower,r.prodName];
      if (showArea)    row.push(r.area||'');
      if (showOutDate) row.push(r.outDate||'');
      if (showInPrice) row.push(r.inPrice||0);
      if (showInTotal) row.push(r.inTotal||0);
      if (showArrival) row.push(r.arrivalCost||0);
      if (showAWB)     row.push(r.awb||'');
      if (showAmount)  row.push((r.cost||0)*(r.totalOrder||0));
      if (showDescr)   row.push(r.descr||'');
      if (showSections.prev)     row.push(r.prevStock||0);
      if (showSections.order && !compact) exportCusts.forEach(c=>{ row.push(r.orders?.[c.custName]||0); if(showCost) row.push(r.costOrders?.[c.custName]||0); if(showDistCost) row.push(r.distCostOrders?.[c.custName]||0); });
      if (showSections.order)    row.push(r.totalOrder||0);
      if (showSections.order && compact && showDistCost) row.push(rowDistCostAvg(r)||0);
      if (showSections.incoming && !compact) farms.forEach(f=>row.push(r.incoming?.[f]||0));
      if (showSections.incoming && compact)  row.push(r.totalIncoming||0);
      if (showSections.out)      row.push(r.confirmedOut||0);
      if (showSections.none)     row.push(r.noneOut||0);
      if (showSections.cur)      row.push(r.curStock||0);
      rows.push(row);
    });

    const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`Pivot통계_${weekStartInput.value}.csv`; a.click();
  };

  const handleVolumeExcel = async () => {
    if (!weekStartInput.value) { setErr('차수를 입력하세요.'); return; }
    setErr(''); setVolBusy('물량표 생성 중… (수십 초 걸릴 수 있어요)');
    try {
    const qs = new URLSearchParams({
      orderYear: yearInput.value,
      weekStart: weekStartInput.value,
      weekEnd: weekEndInput.value || weekStartInput.value,
    });
    const res = await fetch(`/api/stats/pivot-volume-excel?${qs.toString()}`);
    if (!res.ok) {
      let message = '물량표 다운로드 실패';
      try {
        const d = await res.json();
        message = d.error || message;
      } catch {}
      setErr(message);
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const encoded = cd.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    const fallback = `${yearInput.value}_${weekStartInput.value}_통합물량표.xlsx`;
    const fileName = encoded ? decodeURIComponent(encoded) : fallback;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    } catch (e) { setErr('물량표 다운로드 오류: ' + (e.message || e)); }
    finally { setVolBusy(''); }
  };

  // 차수×품종별 — 품종 목록 불러와 선택 모달 열기
  const openPick = async () => {
    if (!weekStartInput.value) { setErr('차수를 입력하세요.'); return; }
    setErr(''); setVolBusy('품종 목록 불러오는 중…');
    const base = { orderYear: yearInput.value, weekStart: weekStartInput.value, weekEnd: weekEndInput.value || weekStartInput.value };
    try {
      const listRes = await fetch(`/api/stats/pivot-volume-excel?${new URLSearchParams({ ...base, list: '1' })}`);
      const ld = await listRes.json();
      if (!ld.success || !ld.items?.length) { setErr(ld.error || '품종 데이터가 없습니다.'); return; }
      setPickItems(ld.items);
      setPickSel(new Set(ld.items.map(i => i.key)));   // 기본: 전체 선택
      setPickOpen(true);
    } catch (e) { setErr('품종 목록 조회 실패: ' + (e.message || e)); }
    finally { setVolBusy(''); }
  };

  const toggleSel = (key) => setPickSel(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });

  // 선택된 품종만 다운로드(개별 파일)
  const downloadPicked = async () => {
    const items = pickItems.filter(i => pickSel.has(i.key));
    if (!items.length) { setErr('다운로드할 품종을 선택하세요.'); return; }
    setPickOpen(false); setErr('');
    const base = { orderYear: yearInput.value, weekStart: weekStartInput.value, weekEnd: weekEndInput.value || weekStartInput.value };
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setVolBusy(`${i + 1}/${items.length} 다운로드 중: ${it.species}`);
        const r = await fetch(`/api/stats/pivot-volume-excel?${new URLSearchParams({ ...base, species: it.key })}`);
        if (!r.ok) continue;
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = it.fileName || `${it.species}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
        await new Promise(res => setTimeout(res, 450));
      }
      setVolBusy(`완료 — ${items.length}개 파일`);
      setTimeout(() => setVolBusy(''), 2500);
    } catch (e) { setErr('개별 다운로드 실패: ' + (e.message || e)); setVolBusy(''); }
  };

  // 그룹핑
  const allCusts = data?.customers || [];
  const farms  = data?.farms || [];

  const custs = useMemo(() => {
    let list = allCusts;
    if (custFilter) {
      list = list.filter(c =>
        c.custName.toLowerCase().includes(custFilter.toLowerCase())
        || c.area?.toLowerCase().includes(custFilter.toLowerCase()));
    }
    if (visibleCustNames.length > 0) {
      if (visibleCustNames.includes('__NONE__')) return [];
      const pick = new Set(visibleCustNames);
      list = list.filter(c => pick.has(c.custName));
    }
    return list;
  }, [allCusts, custFilter, visibleCustNames]);

  const custColPickCount = visibleCustNames.includes('__NONE__') ? 0
    : visibleCustNames.length === 0 ? allCusts.length : visibleCustNames.length;

  const isCustColChecked = useCallback((name) => {
    if (visibleCustNames.length === 0) return true;
    return visibleCustNames.includes(name);
  }, [visibleCustNames]);

  const toggleCustColPick = useCallback((name, checked) => {
    setVisibleCustNames(prev => {
      const allNames = allCusts.map(c => c.custName);
      let cur = prev.length === 0 ? [...allNames] : [...prev];
      let next = checked ? [...new Set([...cur, name])] : cur.filter(n => n !== name);
      if (next.length >= allNames.length) next = [];
      return next;
    });
  }, [allCusts]);

  useEffect(() => {
    if (!showCustPicker) return;
    const close = (e) => {
      if (custPickerRef.current?.contains(e.target)) return;
      setShowCustPicker(false);
    };
    const t = setTimeout(() => document.addEventListener('click', close), 50);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [showCustPicker]);

  useEffect(() => {
    if (!data?.customers?.length || visibleCustNames.length === 0) return;
    if (visibleCustNames.includes('__NONE__')) return;
    const valid = new Set(data.customers.map(c => c.custName));
    setVisibleCustNames(prev => {
      const next = prev.filter(n => valid.has(n));
      return next.length === prev.length ? prev : next;
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 필터 옵션 (필터용) — 데이터 변경 시만 재계산
  const areaOptions    = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.area).filter(Boolean))].sort(),    [data]);
  const countryOptions = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.country).filter(Boolean))].sort(), [data]);
  const flowerOptions  = useMemo(() => [...new Set((data?.rows||[]).map(r=>r.flower).filter(Boolean))].sort(),  [data]);
  const prodNameOptions= useMemo(() => [...new Set((data?.rows||[]).map(r=>r.prodName).filter(Boolean))].sort(),[data]);

  // ── Filter Editor: 필드 → row 키 매핑
  const COND_FIELD_MAP = {
    '국가':'country', '꽃':'flower', '지역':'area',
    '품목명':'prodName', '품목명(색상)':'prodName',
    '출고일':'outDate', '입고단가':'inPrice', '입고총단가':'inTotal',
    'AWB':'awb', '비고':'descr',
  };

  // anyof 옵션 목록 (데이터에서 추출)
  const getFieldValues = useCallback((field) => {
    const key = COND_FIELD_MAP[field];
    if (!key || !data?.rows) return [];
    return [...new Set(data.rows.map(r=>String(r[key]||'')).filter(Boolean))].sort().slice(0,60);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 필터영역 필드(레지스트리 id) → 데이터 distinct 값
  const getValuesForFieldId = useCallback((id) => {
    if (!data) return [];
    if (id === 'custName') {
      return [...new Set((data.customers || []).map(c => c.custName).filter(Boolean))].sort();
    }
    if (id === 'farmName') {
      return [...(data.farms || [])].sort();
    }
    if (id === 'area') {
      const fromRows = (data.rows || []).map(r => r.area).filter(Boolean);
      const fromCust = (data.customers || []).map(c => c.area).filter(Boolean);
      return [...new Set([...fromRows, ...fromCust])].sort();
    }
    if (id === 'descr') {
      const fromRows = (data.rows || []).map(r => r.descr).filter(Boolean);
      const fromCust = (data.customers || []).map(c => c.custDescr).filter(Boolean);
      return [...new Set([...fromRows, ...fromCust])].sort();
    }
    const key = FIELD_BY_ID[id]?.dataKey;
    if (!key || !data.rows) return [];
    return [...new Set(data.rows.map(r => String(r[key] ?? '')).filter(v => v !== ''))].sort().slice(0, 200);
  }, [data]);

  // 필터 적용 (__EMPTY__ = 전체 해제 + Filter Editor 조건)
  const filteredRows = useMemo(() => (data?.rows||[]).filter(r => {
    if (filters.area?.includes('__EMPTY__'))     return false;
    if (filters.country?.includes('__EMPTY__'))  return false;
    if (filters.flower?.includes('__EMPTY__'))   return false;
    if (filters.prodName?.includes('__EMPTY__')) return false;
    if (filters.area?.length    && !filters.area.includes(r.area))         return false;
    if (filters.country?.length && !filters.country.includes(r.country))   return false;
    if (filters.flower?.length  && !filters.flower.includes(r.flower))     return false;
    if (filters.prodName?.length && !filters.prodName.includes(r.prodName)) return false;
    // Filter Editor 조건
    for (const cond of filterConditions) {
      const key = COND_FIELD_MAP[cond.field];
      if (!key) continue;
      const val = String(r[key] ?? '');
      if (cond.op === 'eq'          && val !== (cond.value||''))        return false;
      if (cond.op === 'neq'         && val === (cond.value||''))        return false;
      if (cond.op === 'contains'    && !val.includes(cond.value||''))   return false;
      if (cond.op === 'notcontains' && val.includes(cond.value||''))    return false;
      if (cond.op === 'beginswith'  && !val.startsWith(cond.value||'')) return false;
      if (cond.op === 'endswith'    && !val.endsWith(cond.value||''))   return false;
      if (cond.op === 'anyof'  && cond.values?.length && !cond.values.includes(val)) return false;
      if (cond.op === 'gt'  && !(Number(val) >  Number(cond.value))) return false;
      if (cond.op === 'gte' && !(Number(val) >= Number(cond.value))) return false;
      if (cond.op === 'lt'  && !(Number(val) <  Number(cond.value))) return false;
      if (cond.op === 'lte' && !(Number(val) <= Number(cond.value))) return false;
    }
    // Field List 필터영역 값 체크 (anyof — 빈 선택은 전체 통과)
    for (const id of filterZone) {
      const sel = fieldFilters[id];
      if (!sel || sel.length === 0) continue;
      if (sel.includes('__EMPTY__')) return false;
      if (id === 'custName') {
        const hasOrder = sel.some(name => Number(r.orders?.[name] || 0) > 0);
        if (!hasOrder) return false;
        continue;
      }
      if (id === 'farmName') {
        const hasInc = sel.some(name => Number(r.incoming?.[name] || 0) > 0);
        if (!hasInc) return false;
        continue;
      }
      const key = FIELD_BY_ID[id]?.dataKey;
      if (!key) continue;
      if (!sel.includes(String(r[key] ?? ''))) return false;
    }
    return true;
  }), [data, filters, filterConditions, filterZone, fieldFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 거래처 그룹값 추출 (colGroupOrder용)
  const getCustVal = useCallback((cust, level) => {
    if (level === '지역')   return cust.area      || '';
    if (level === '비고')   return cust.custDescr || '';
    if (level === '거래처명') return cust.custName  || '';
    return '';
  }, []);

  // colGroupOrder 순서로 정렬된 거래처 (02.주문 컬럼 순서)
  const sortedCusts = useMemo(() => [...custs].sort((a, b) => {
    for (const lv of colGroupOrder) {
      const av = getCustVal(a, lv);
      const bv = getCustVal(b, lv);
      const c  = av.localeCompare(bv);
      if (c !== 0) return c;
    }
    return 0;
  }), [custs, colGroupOrder, getCustVal]);

  // 02.주문 그룹 헤더 셀 (colGroupOrder에서 마지막 레벨 제외)
  const custGroupHeaders = useMemo(() => {
    const levels = colGroupOrder.slice(0, -1); // 거래처명 제외
    return levels.map(level => {
      const cells = [];
      let i = 0;
      while (i < sortedCusts.length) {
        const val = getCustVal(sortedCusts[i], level);
        let j = i + 1;
        while (j < sortedCusts.length && getCustVal(sortedCusts[j], level) === val) j++;
        cells.push({ value: val || '(없음)', colspan: j - i });
        i = j;
      }
      return { level, cells };
    });
  }, [sortedCusts, colGroupOrder, getCustVal]);

  const openFilterEditor = useCallback(() => {
    const sectionCond = { field:'구분', sections:{...showSections} };
    const rest = filterConditions.filter(c => c.field !== '구분');
    setDraftConds([sectionCond, ...rest]);
    setShowFilterEditor(true);
  }, [showSections, filterConditions]);

  const applyFilterEditor = useCallback(() => {
    const sectionCond = draftConds.find(c => c.field === '구분');
    if (sectionCond?.sections) {
      setColumnZone(columnZoneFromSections(sectionCond.sections, colGroupOrder));
    }
    setFilterConditions(draftConds.filter(c => c.field && c.field !== '구분' && c.op));
    setShowFilterEditor(false);
  }, [draftConds, colGroupOrder]);

  // 정렬 함수
  const sortFn = useCallback((a, b) => {
    for (const [key, dir] of Object.entries(sorts)) {
      if (!dir) continue;
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  }, [sorts]);

  // 그룹핑 + 정렬 — filteredRows/sorts 변경 시만 재계산
  const sortedCountries = useMemo(() => {
    const grouped = {};
    filteredRows.forEach(r => {
      const ck = r.country;
      if (!grouped[ck]) grouped[ck] = { country:r.country, flowers:{} };
      const fk = r.flower;
      if (!grouped[ck].flowers[fk]) grouped[ck].flowers[fk] = { flower:r.flower, items:[] };
      grouped[ck].flowers[fk].items.push(r);
    });

    // 아이템 정렬
    Object.values(grouped).forEach(gc => {
      Object.values(gc.flowers).forEach(gf => { gf.items = [...gf.items].sort(sortFn); });
    });

    // 국가/꽃 그룹 정렬
    const sc = Object.values(grouped).sort((a, b) => {
      const dir = sorts.country;
      if (!dir) return String(a.country).localeCompare(String(b.country));
      const cmp = String(a.country).localeCompare(String(b.country));
      return dir === 'asc' ? cmp : -cmp;
    });
    sc.forEach(gc => {
      gc._sortedFlowers = Object.values(gc.flowers).sort((a, b) => {
        const dir = sorts.flower;
        if (!dir) return String(a.flower).localeCompare(String(b.flower));
        const cmp = String(a.flower).localeCompare(String(b.flower));
        return dir === 'asc' ? cmp : -cmp;
      });
    });
    return sc;
  }, [filteredRows, sorts, sortFn]);

  // 고정 좌측 컬럼 수 (국가+꽃+품목명 + 선택 열들)
  // showCost는 업체별 셀 내부에 스택으로 표시되므로 고정 컬럼 아님
  const totalFixedCols = useMemo(() =>
    3 + (showArea?1:0) + (showOutDate?1:0) + (showInPrice?1:0) + (showInTotal?1:0)
      + (showArrival?1:0) + (showAWB?1:0) + (showAmount?1:0) + (showDescr?1:0),
  [showArea, showOutDate, showInPrice, showInTotal, showArrival, showAWB, showAmount, showDescr]);

  const pivotColLayoutKey = useMemo(() => JSON.stringify({
    compact, columnZone, colGroupOrder,
    showArea, showOutDate, showInPrice, showInTotal, showArrival, showAWB, showAmount, showDescr,
    showSections, nc: sortedCusts.length, nf: farms.length, showCost, showDistCost,
  }), [compact, columnZone, colGroupOrder, showArea, showOutDate, showInPrice, showInTotal, showArrival,
    showAWB, showAmount, showDescr, showSections, sortedCusts.length, farms.length, showCost, showDistCost]);

  const pivotTableRef = useColumnResize(
    [loading, data, pivotColLayoutKey, custColWidth],
    {
      headerSelector: 'thead tr.pivot-col-header-row th',
      minWidth: 18,
      defaultWidth: 52,
      defaultGroupWidths: { cust: 56, farm: 56 },
      widths: colWidths,
      onResize: saveColWidth,
    },
  );

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 72px)'}}>
      {/* 툴바 */}
      <div className="filter-bar">
        <YearInput yearInput={yearInput} label="주문년도" />
        <button className="btn btn-sm" style={{height:22,fontSize:11,fontWeight:800}}
          onClick={() => { weekStartInput.prevWeek(); weekEndInput.prevWeek(); }}
          title="범위 전체 주차-1">&lt;&lt;</button>
        <button className="btn btn-sm" style={{height:22,fontSize:11}}
          onClick={() => { weekStartInput.prev(); weekEndInput.prev(); }}
          title="범위 전체 차수-1">&lt;</button>
        <WeekSpinInput weekInput={weekStartInput} label="주문차수"/>
        <span style={{color:'var(--text3)'}}>~</span>
        <WeekSpinInput weekInput={weekEndInput}/>
        <button className="btn btn-sm" style={{height:22,fontSize:11}}
          onClick={() => { weekStartInput.next(); weekEndInput.next(); }}
          title="범위 전체 차수+1">&gt;</button>
        <button className="btn btn-sm" style={{height:22,fontSize:11,fontWeight:800}}
          onClick={() => { weekStartInput.nextWeek(); weekEndInput.nextWeek(); }}
          title="범위 전체 주차+1">&gt;&gt;</button>
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <span className="filter-label">거래처</span>
        <input className="filter-input" style={{width:100,height:22,fontSize:11}} placeholder="거래처 검색..."
          value={custFilter} onChange={e=>setCustFilter(e.target.value)} />
        {!compact && showSections.order && sortedCusts.length > 0 && (
          <>
            <span className="filter-label" title="업체 열 너비 — 모든 거래처 열에 동시 적용">업체열</span>
            <input type="range" min={18} max={120} step={2} value={custColWidth}
              onChange={e => setCustColWidth(Number(e.target.value))}
              style={{width:72,height:22,verticalAlign:'middle',cursor:'pointer'}} />
            <span style={{fontSize:10,color:'var(--text3)',minWidth:28}}>{custColWidth}px</span>
          </>
        )}
        <button className="btn btn-success" onClick={handleVolumeExcel} disabled={!!volBusy}>{volBusy ? '생성 중…' : '물량표 다운받기'}</button>
        <button className="btn btn-success" onClick={openPick} disabled={!!volBusy} style={{background:'#1565c0'}}>차수·품종별(선택)</button>
        {volBusy && <span style={{marginLeft:8,fontSize:12,color:'#1565c0',fontWeight:700}}>⏳ {volBusy}</span>}
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? '⏳ 로딩 중...' : t('새로고침')}
          </button>
          <button className="btn" onClick={handleExcel}>{t('엑셀')}</button>
          {/* 즐겨찾기 */}
          <div style={{position:'relative', display:'inline-block'}}>
            <button className="btn" onClick={()=>setShowFavMenu(s=>!s)}>
              ⭐ 즐겨찾기{favorites.length>0?` (${favorites.length})`:''}
            </button>
            {showFavMenu && (
              <div style={{position:'absolute',top:'100%',right:0,zIndex:300,background:'#fff',
                border:'2px solid var(--border2)',width:260,boxShadow:'2px 2px 8px rgba(0,0,0,.2)'}}>
                <div style={{padding:'6px 8px',background:'var(--header-bg)',fontWeight:'bold',fontSize:12,borderBottom:'1px solid var(--border)'}}>
                  ⭐ 즐겨찾기
                </div>
                <div style={{padding:'6px 8px',borderBottom:'1px solid var(--border)'}}>
                  <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>현재 설정 저장 (필드·필터·그룹순서·구분 포함)</div>
                  <div style={{display:'flex',gap:4}}>
                    <input className="filter-input" style={{flex:1,height:22}} placeholder="이름..."
                      value={favName} onChange={e=>setFavName(e.target.value)}/>
                    <button className="btn btn-sm" onClick={saveFav}>{t('저장')}</button>
                  </div>
                </div>
                {favorites.length===0
                  ? <div style={{padding:'10px',fontSize:11,color:'var(--text3)',textAlign:'center'}}>없음</div>
                  : favorites.map((fav,idx)=>(
                    <div key={idx} style={{padding:'5px 8px',borderBottom:'1px solid #EEE',display:'flex',alignItems:'center',gap:6,fontSize:12}}>
                      <span style={{flex:1,cursor:'pointer',color:'var(--blue)'}} onClick={()=>loadFav(fav)}>⭐ {fav.name}</span>
                      <button className="btn btn-sm" style={{height:18,fontSize:10,color:'var(--red)'}} onClick={()=>delFav(idx)}>✕</button>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {err && <div className="banner-err">{err}</div>}

      {/* ■ Pivot 통계 헤더 */}
      <div style={{padding:'2px 8px',background:'var(--header-bg)',border:'1px solid var(--border)',borderTop:'none',fontSize:12,fontWeight:'bold',flexShrink:0}}>
        ■ Pivot 통계
      </div>

      {/* 툴바 — 필드 토글은 Field List 로 통합 (중복 버튼 제거) */}
      <div style={{padding:'3px 8px',background:'#EEF4FA',border:'1px solid var(--border)',borderTop:'none',display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
        <button className={`btn btn-sm ${showFieldList?'btn-primary':''}`} style={{height:22,fontSize:11,fontWeight:700}}
          title="필드를 행/열/필터/값 영역으로 드래그"
          onClick={()=>setShowFieldList(s=>!s)}>🗂 필드 목록</button>
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <button className={`btn btn-sm ${compact?'btn-primary':''}`} style={{height:22,fontSize:11}}
          title="02.주문/03.입고 품목당 1열 합계 (exe)"
          onClick={()=>setViewMode('compact')}>▣ 합계</button>
        <button className={`btn btn-sm ${!compact?'btn-primary':''}`} style={{height:22,fontSize:11}}
          title="거래처·농장 열 전개"
          onClick={()=>setViewMode('detail')}>▦ 상세</button>
        <span style={{borderLeft:'1px solid var(--border)',margin:'0 4px'}}></span>
        <button className="btn btn-sm" style={{height:22,fontSize:11}} onClick={()=>setCollapsed(new Set())}>▼ 펼침</button>
        <button className="btn btn-sm" style={{height:22,fontSize:11}} onClick={()=>{
          const keys=new Set();
          sortedCountries.forEach(gc=>{keys.add(gc.country);
            (gc._sortedFlowers||Object.values(gc.flowers||{})).forEach(gf=>keys.add(gc.country+'|'+gf.flower));});
          setCollapsed(keys);
        }}>▶ 닫기</button>
        <span style={{fontSize:10,color:'var(--text3)',marginLeft:4}}>필드·필터·그룹순서 → 🗂 필드 목록</span>
      </div>

      {/* ── Field List 패널 (exe DevExpress PivotGrid 형 — 행/열/필터/값 드래그) ── */}
      {showFieldList && (() => {
        const chipStyle = (active, locked) => ({
          padding:'2px 7px', height:22, fontSize:11, borderRadius:3,
          border:`1px solid ${active?'var(--blue)':'var(--border2)'}`,
          background: active?'#e8f0fe':'#f4f6f9', color: active?'#1a4d8f':'var(--text2)',
          cursor: locked?'default':'grab', userSelect:'none',
          display:'inline-flex', alignItems:'center', gap:3, whiteSpace:'nowrap', position:'relative',
        });
        const startDrag = startFieldDrag;
        const onZoneDragOver = (zoneId) => (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setZoneHover(zoneId);
        };
        const onZoneDrop = (zoneId) => (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleFieldDrop(zoneId, null, null, e);
        };
        const addFieldToDefaultZone = (f) => {
          if (canDropInZone(f.id, 'filter') && f.filterable) handleFieldDrop('filter', f.id, '__tray__');
          else if (canDropInZone(f.id, 'column')) handleFieldDrop('column', f.id, '__tray__');
          else if (canDropInZone(f.id, 'data')) handleFieldDrop('data', f.id, '__tray__');
          else handleFieldDrop('row', f.id, '__tray__');
        };
        const isFilterAllDeselected = (id) => fieldFilters[id]?.includes('__EMPTY__');
        const isFilterValueChecked = (id, v) => {
          const sel = fieldFilters[id];
          if (isFilterAllDeselected(id)) return false;
          if (!sel || sel.length === 0) return true;
          return sel.includes(v);
        };
        const toggleFilterValue = (id, v, checked) => {
          setFieldFilters(ff => {
            const all = getValuesForFieldId(id);
            let cur;
            if (ff[id]?.includes('__EMPTY__')) cur = [];
            else if (!ff[id]?.length) cur = [...all];
            else cur = [...ff[id]];
            let next = checked ? [...new Set([...cur, v])] : cur.filter(x => x !== v);
            if (next.length >= all.length) next = [];
            return { ...ff, [id]: next };
          });
        };
        const removeFromZone = (f, zoneId) => removeFieldFromZone(f.id, zoneId);
        const Chip = ({ f, zoneId, removable }) => (
          <span draggable={!f.locked} onDragStart={startDrag(f.id, zoneId)} onDragEnd={()=>{ setDragField(null); setZoneHover(null); }}
            onDragOver={onZoneDragOver(zoneId)} onDrop={onZoneDrop(zoneId)}
            style={chipStyle(true, f.locked)} title={f.locked?'고정 필드(제거 불가)':'드래그하여 영역 이동'}>
            {!f.locked && <span style={{fontSize:9,color:'var(--text3)',lineHeight:1}}>⠿</span>}
            {f.label}
            {f.kind==='measure' && <span style={{fontSize:8,color:'var(--blue)'}}>∑</span>}
            {removable && !f.locked && (
              <span style={{cursor:'pointer',color:'var(--red)',fontSize:12,marginLeft:1}}
                onClick={(e)=>{ e.stopPropagation(); removeFromZone(f, zoneId); }}>×</span>
            )}
          </span>
        );
        const zoneActiveFields = (zoneId) => {
          if (zoneId==='filter') return filterZone.map(id=>FIELD_BY_ID[id]).filter(Boolean);
          if (zoneId==='column') return columnZone.map(id=>FIELD_BY_ID[id]).filter(Boolean);
          if (zoneId==='data') return PIVOT_FIELDS.filter(f=>f.kind==='measure' && isFieldActive(f.id));
          return PIVOT_FIELDS.filter(f=>f.zone==='row' && (f.locked || isFieldActive(f.id)));
        };
        const isFieldPlaced = (f) =>
          columnZone.includes(f.id)
          || filterZone.includes(f.id)
          || !!measureState[f.id]?.[0]
          || !!rowOptState[f.id]?.[0];
        const trayFields = PIVOT_FIELDS.filter((f) => !f.locked && !isFieldPlaced(f));
        return (
          <div style={{padding:'6px 8px',background:'#F7FAFE',border:'1px solid var(--border)',borderTop:'none',flexShrink:0}}>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {ZONES.map(z=>(
                <div key={z.id}
                  onDragOver={onZoneDragOver(z.id)}
                  onDragLeave={()=>setZoneHover(h=>h===z.id?null:h)}
                  onDrop={onZoneDrop(z.id)}
                  style={{flex:'1 1 160px', minWidth:150, minHeight:46,
                    border:`2px dashed ${zoneHover===z.id?'var(--blue)':'var(--border2)'}`,
                    borderRadius:5, background: zoneHover===z.id?'#eaf2ff':'#fff', padding:'4px 6px'}}>
                  <div style={{fontSize:10,fontWeight:'bold',color:'var(--text3)',marginBottom:3}}>{z.label}</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}
                    onDragOver={onZoneDragOver(z.id)} onDrop={onZoneDrop(z.id)}>
                    {zoneActiveFields(z.id).map(f=>(
                      <span key={f.id} style={{position:'relative',display:'inline-block'}}>
                        <span onClick={z.id==='filter'?()=>setOpenFilterChip(o=>o===f.id?null:f.id):undefined}
                          style={{cursor:z.id==='filter'?'pointer':(f.locked?'default':'grab')}}>
                          <Chip f={f} zoneId={z.id} removable />
                          {z.id==='filter' && fieldFilters[f.id]?.length>0 && !isFilterAllDeselected(f.id) && (
                            <span style={{fontSize:8,color:'#fff',background:'var(--blue)',borderRadius:8,padding:'0 4px',marginLeft:2}}>
                              {fieldFilters[f.id].length}
                            </span>
                          )}
                          {z.id==='filter' && isFilterAllDeselected(f.id) && (
                            <span style={{fontSize:8,color:'#fff',background:'var(--red)',borderRadius:8,padding:'0 4px',marginLeft:2}}>0</span>
                          )}
                        </span>
                        {/* 필터 값 체크 드롭다운 */}
                        {z.id==='filter' && openFilterChip===f.id && (
                          <div style={{position:'absolute',top:'100%',left:0,zIndex:500,marginTop:2,
                            background:'#fff',border:'2px solid var(--border2)',borderRadius:4,minWidth:160,
                            maxHeight:240,overflowY:'auto',boxShadow:'2px 3px 10px rgba(0,0,0,.25)'}}
                            onClick={e=>e.stopPropagation()}>
                            <div style={{padding:'4px 8px',background:'#f0f4fa',fontSize:10,color:'var(--text3)',
                              display:'flex',gap:6,position:'sticky',top:0}}>
                              <span style={{cursor:'pointer',color:'var(--blue)'}}
                                onClick={()=>setFieldFilters(ff=>({...ff,[f.id]:[]}))}>전체선택</span>
                              <span style={{cursor:'pointer',color:'var(--red)'}}
                                onClick={()=>setFieldFilters(ff=>({...ff,[f.id]:['__EMPTY__']}))}>전체해제</span>
                              <span style={{marginLeft:'auto',cursor:'pointer'}} onClick={()=>setOpenFilterChip(null)}>닫기</span>
                            </div>
                            {getValuesForFieldId(f.id).map(v=>(
                              <label key={v} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 9px',fontSize:11,cursor:'pointer'}}>
                                <input type="checkbox"
                                  checked={isFilterValueChecked(f.id, v)}
                                  onChange={e=>toggleFilterValue(f.id, v, e.target.checked)} />
                                {v}
                              </label>
                            ))}
                          </div>
                        )}
                      </span>
                    ))}
                    {zoneActiveFields(z.id).length===0 && <span style={{fontSize:10,color:'var(--text3)'}}>여기로 드래그</span>}
                  </div>
                </div>
              ))}
            </div>
            {/* 02.주문 열 그룹순서 — 지역/비고/거래처명이 열 영역에 있을 때 */}
            {!compact && showSections.order && colGroupOrder.some(l => columnZone.includes(COL_GROUP_FIELD_MAP[l])) && (
              <div style={{marginTop:6,padding:'4px 8px',background:'#eef8ee',borderRadius:4,display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:'bold',color:'var(--text3)'}}>02.주문 그룹순서:</span>
                {colGroupOrder.map((lv, idx) => (
                  <span key={lv}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('cgIdx', String(idx)); e.dataTransfer.effectAllowed='move'; setDragOverIdx(idx); }}
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                    onDrop={e => {
                      e.preventDefault();
                      const from = parseInt(e.dataTransfer.getData('cgIdx'), 10);
                      if (Number.isNaN(from) || from === idx) { setDragOverIdx(null); return; }
                      const next = [...colGroupOrder];
                      const [removed] = next.splice(from, 1);
                      next.splice(idx, 0, removed);
                      setColGroupOrder(next);
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => setDragOverIdx(null)}
                    style={{
                      padding:'2px 8px', height:22, fontSize:11,
                      border:`1px solid ${dragOverIdx===idx?'var(--blue)':'var(--border2)'}`,
                      borderRadius:3,
                      background: dragOverIdx===idx ? '#e8f0fe' : '#fff',
                      cursor:'grab', userSelect:'none',
                      display:'inline-flex', alignItems:'center', gap:4,
                    }}>
                    <span style={{fontSize:9,color:'var(--text3)'}}>⠿</span>{lv}
                  </span>
                ))}
                {colGroupOrder.includes('거래처명') && columnZone.includes('custName') && (
                  <span ref={custPickerRef} style={{position:'relative',display:'inline-block'}}>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setShowCustPicker(s => !s); }}
                      style={{
                        padding:'2px 8px', height:22, fontSize:11, cursor:'pointer',
                        border:`1px solid ${visibleCustNames.length && !visibleCustNames.includes('__NONE__') ? 'var(--blue)' : 'var(--border2)'}`,
                        borderRadius:3,
                        background: visibleCustNames.length && !visibleCustNames.includes('__NONE__') ? '#e8f0fe' : '#fff',
                        color: visibleCustNames.length && !visibleCustNames.includes('__NONE__') ? '#1a4d8f' : 'var(--text2)',
                        fontWeight: visibleCustNames.length && !visibleCustNames.includes('__NONE__') ? 'bold' : 'normal',
                      }}
                      title="02.주문 열에 표시할 거래처 선택">
                      거래처 선택 ({custColPickCount}/{allCusts.length}) ▼
                    </button>
                    {showCustPicker && (
                      <div style={{
                        position:'absolute', top:'100%', left:0, zIndex:600, marginTop:2,
                        background:'#fff', border:'2px solid var(--border2)', borderRadius:4,
                        minWidth:220, maxWidth:320, maxHeight:280, overflowY:'auto',
                        boxShadow:'3px 4px 12px rgba(0,0,0,.25)', padding:'4px 0',
                      }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{padding:'4px 8px', borderBottom:'1px solid var(--border)', display:'flex', gap:6, fontSize:10}}>
                          <button type="button" className="btn btn-sm" style={{height:20,fontSize:10,padding:'0 6px'}}
                            onClick={() => setVisibleCustNames([])}>전체</button>
                          <button type="button" className="btn btn-sm" style={{height:20,fontSize:10,padding:'0 6px'}}
                            onClick={() => setVisibleCustNames(['__NONE__'])}>전체해제</button>
                        </div>
                        {allCusts.length === 0 ? (
                          <div style={{padding:8,fontSize:10,color:'var(--text3)'}}>거래처 없음</div>
                        ) : allCusts.map(c => (
                          <label key={c.custName} style={{
                            display:'flex', alignItems:'center', gap:6, padding:'3px 8px',
                            fontSize:11, cursor:'pointer', borderBottom:'1px solid #f0f0f0',
                          }}>
                            <input type="checkbox"
                              checked={visibleCustNames.includes('__NONE__') ? false : isCustColChecked(c.custName)}
                              onChange={e => {
                                if (visibleCustNames.includes('__NONE__')) {
                                  setVisibleCustNames([c.custName]);
                                  return;
                                }
                                toggleCustColPick(c.custName, e.target.checked);
                              }} />
                            <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                              title={`${c.area || ''} / ${c.custName}${c.custDescr ? ' / ' + c.custDescr : ''}`}>
                              {c.custName}
                            </span>
                            <span style={{fontSize:9,color:'var(--text3)',flexShrink:0}}>{c.orderCode}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </div>
            )}
            <div style={{marginTop:4,fontSize:10,color:'var(--text3)'}}>
              구분(01~05)·지역·비고·거래처/농장 → <b>열</b> 영역에 드래그 · 하단 칩으로 토글
            </div>
            {/* 사용 가능 필드 트레이 */}
            <div onDragOver={onZoneDragOver('__tray__')}
              onDragLeave={()=>setZoneHover(h=>h==='__tray__'?null:h)}
              onDrop={onZoneDrop('__tray__')}
              style={{marginTop:6,paddingTop:6,borderTop:'1px solid var(--border)',display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',
                background: zoneHover==='__tray__'?'#fff3f0':'transparent',borderRadius:4}}>
              <span style={{fontSize:10,fontWeight:'bold',color:'var(--text3)',marginRight:2}}>사용 가능:</span>
              {trayFields.length===0 ? <span style={{fontSize:10,color:'var(--text3)'}}>(모든 필드 배치됨)</span>
                : trayFields.map(f=>(
                  <span key={f.id} draggable onDragStart={startDrag(f.id,'__tray__')} onDragEnd={()=>{ setDragField(null); setZoneHover(null); }}
                    onDoubleClick={()=>addFieldToDefaultZone(f)}
                    style={{...chipStyle(false,false), cursor:'grab'}} title={`드래그 또는 더블클릭 → ${ZONES.find(z=>z.id===f.zone)?.label}`}>
                    <span style={{fontSize:9,color:'var(--text3)',lineHeight:1}}>⠿</span>{f.label}
                    {f.kind==='measure' && <span style={{fontSize:8,color:'var(--blue)'}}>∑</span>}
                  </span>
                ))}
            </div>
          </div>
        );
      })()}

      {/* 피벗 테이블 — 가로·세로 스크롤 (열 많을 때 이동바) */}
      <div className="pivot-table-scroll" style={{border:'1px solid var(--border2)',borderTop:'none'}}>
        {loading ? <div className="skeleton" style={{height:300,margin:16}}></div>
        : !data ? (
          <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">차수 입력 후 새로고침</div></div>
        ) : data.rows?.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">🔍</div><div className="empty-text">해당 차수에 데이터가 없습니다.</div></div>
        ) : (
          <table ref={pivotTableRef} className="tbl tbl-pivot" style={{fontSize:11}}>
            <thead>
              {/* 1행: 주문년도 */}
              <tr style={{background:'#C0CCE0'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)', fontSize:11, padding:'2px 8px', textAlign:'left'}}>
                </th>
                {showSections.prev     && <th style={{background:'#B8C8E0', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
                {showSections.order    && <th colSpan={compact?1:sortedCusts.length+1} style={{background:'#B8D8B8', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
                {showSections.incoming && <th colSpan={compact?1:(farms.length||1)} style={{background:'#D8C8B0', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
                {showSections.out      && <th style={{background:'#D0C0A8', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
                {showSections.none     && <th style={{background:'#D8D0A0', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
                {showSections.cur      && <th style={{background:'#C0C0D8', textAlign:'center', fontSize:10}}>{data?.orderYear || yearInput.value}</th>}
              </tr>
              {/* 2행: 주문차수 */}
              <tr style={{background:'#C8D4E4'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)'}}></th>
                {showSections.prev     && <th style={{background:'#C0CCE4', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.order    && <th colSpan={compact?1:sortedCusts.length+1} style={{background:'#C0D8C0', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.incoming && <th colSpan={compact?1:(farms.length||1)} style={{background:'#D8CCBC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.out      && <th style={{background:'#D4C4AC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.none     && <th style={{background:'#D8D4AC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
                {showSections.cur      && <th style={{background:'#C4C4DC', textAlign:'center', fontSize:10}}>{weekStartInput.value}</th>}
              </tr>
              {/* 3행: 구분 */}
              <tr style={{background:'#D0D8E8'}}>
                <th colSpan={totalFixedCols}
                  style={{borderRight:'2px solid var(--border2)'}}></th>
                {showSections.prev     && <th style={{background:'#C8D0E8',textAlign:'center',fontSize:10}}>∨ 01. 전재고</th>}
                {showSections.order    && <th colSpan={compact?1:sortedCusts.length+1} style={{background:'#C8D8C8',textAlign:'center',fontSize:10}}>∨ 02. 주문</th>}
                {showSections.incoming && <th colSpan={compact?1:(farms.length||1)} style={{background:'#D8CCC0',textAlign:'center',fontSize:10}}>∨ 03. 입고</th>}
                {showSections.out      && <th style={{background:'#D4C8B8',textAlign:'center',fontSize:10}}>∨ 04. 출고</th>}
                {showSections.none     && <th style={{background:'#DCD8B0',textAlign:'center',fontSize:10}}>∨ 03. 미발주</th>}
                {showSections.cur      && <th style={{background:'#C8C8E0',textAlign:'center',fontSize:10}}>∨ 05. 현재고</th>}
              </tr>

              {/* 그룹 헤더 행 (colGroupOrder에서 마지막 레벨 제외한 각 레벨) — detail 모드 전용 */}
              {!compact && showSections.order && custGroupHeaders.map(({level, cells}) => (
                <tr key={`gh-${level}`} style={{background:'#D0E8D0'}}>
                  <th colSpan={totalFixedCols} style={{background:'#E8EEF4',borderRight:'2px solid var(--border2)'}} />
                  {showSections.prev && <th style={{background:'#C8D0E8'}} />}
                  {cells.map((cell, ci) => (
                    <th key={ci} colSpan={cell.colspan} style={{
                      textAlign:'center', fontSize:10, background:'#BEDFBE',
                      borderLeft: ci>0 ? '2px solid var(--border2)' : 'none',
                      fontWeight:'bold', padding:'2px 4px', whiteSpace:'nowrap',
                    }}>
                      {cell.value}
                    </th>
                  ))}
                  <th style={{background:'#AECFAE'}} />
                  {showSections.incoming && <th colSpan={Math.max(farms.length,1)} style={{background:'#D8CCC0'}} />}
                  {showSections.out && <th style={{background:'#D4C8B8'}} />}
                  {showSections.none && <th style={{background:'#DCD8B0'}} />}
                  {showSections.cur  && <th style={{background:'#C8C8E0'}} />}
                </tr>
              ))}

              {/* 컬럼 헤더 행 — 열 너비 드래그 (우측 가장자리) */}
              <tr className="pivot-col-header-row" style={{background:'var(--header-bg)'}}>
                <ColHeader label="국가"    sortKey="country" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.country} filterOptions={countryOptions}/>
                <ColHeader label="꽃"      sortKey="flower"  sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.flower}  filterOptions={flowerOptions}/>
                <ColHeader label="품목명(색상)" sortKey="prodName" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.prodName} filterOptions={prodNameOptions}
                  style={{borderRight:'2px solid var(--border2)'}}/>
                {showArea     && <ColHeader label="지역" sortKey="area" sorts={sorts} onSort={handleSort} onFilter={handleFilter}
                  filter={filters.area} filterOptions={areaOptions}/>}
                {showOutDate  && <th style={{fontSize:10}}>출고일</th>}
                {showInPrice  && <th style={{fontSize:10,textAlign:'right'}}>입고단가</th>}
                {showInTotal  && <th style={{fontSize:10,textAlign:'right'}}>입고총단가</th>}
                {showArrival  && <th style={{fontSize:10,textAlign:'right'}} title="/freight 운송기준원가">도착원가</th>}
                {showAWB      && <th style={{fontSize:10}}>AWB</th>}
                {showAmount   && <th style={{fontSize:10,textAlign:'right'}}>판매금액</th>}
                {showDescr    && <th style={{fontSize:10}}>비고</th>}
                {/* 01. 전재고 */}
                {showSections.prev && (
                  <ColHeader label="전재고" sortKey="prevStock" sorts={sorts} onSort={handleSort}/>
                )}
                {/* 02. 주문 — detail: 거래처별 / compact: Total 1열만 */}
                {!compact && showSections.order && sortedCusts.map((c,ci)=>(
                  <th key={c.custName} data-resize-group="cust" style={{textAlign:'center',fontSize:10,background:'#D4ECD4',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                    borderLeft: ci>0 && sortedCusts[ci-1] && getCustVal(sortedCusts[ci-1],colGroupOrder[colGroupOrder.length-2]) !== getCustVal(c,colGroupOrder[colGroupOrder.length-2]) ? '1px solid var(--border2)' : undefined,
                  }}
                    title={`${c.area} / ${c.custName}${c.custDescr?' / '+c.custDescr:''}`}>
                    <div style={{fontSize:9,fontWeight:'bold'}}>{c.custName.length>8?c.custName.slice(0,8)+'…':c.custName}</div>
                    <div style={{fontSize:9,color:'var(--text3)'}}>{c.orderCode}</div>
                    {showCost && <div style={{fontSize:8,color:'var(--blue)',marginTop:1}}>수량 / 단가</div>}
                  </th>
                ))}
                {showSections.order && (
                  <th style={{background:'#B8D4B8',textAlign:'center',fontSize:10,fontWeight:'bold',
                    borderLeft: compact?undefined:'2px solid var(--border2)'}}>
                    {compact ? '02. 주문' : '02. 주문 Total'}
                    {compact && showDistCost && <div style={{fontSize:8,color:'var(--blue)',marginTop:1}}>수량 / 분배단가</div>}
                  </th>
                )}
                {/* 03. 입고 — detail: 농장별 / compact: Total 1열만 */}
                {!compact && showSections.incoming && farms.map(f=>(
                  <th key={f} data-resize-group="farm" style={{textAlign:'center',fontSize:10,background:'#E8DCCC',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f}>
                    ∨ {f.length>8?f.slice(0,8)+'…':f}
                  </th>
                ))}
                {!compact && showSections.incoming && farms.length===0 && (
                  <th style={{background:'#E8DCCC',textAlign:'center',fontSize:10}}>입고 없음</th>
                )}
                {compact && showSections.incoming && (
                  <th style={{background:'#E0D4C4',textAlign:'center',fontSize:10,fontWeight:'bold'}}>03. 입고</th>
                )}
                {showSections.out && (
                  <ColHeader label="출고" sortKey="confirmedOut" sorts={sorts} onSort={handleSort}/>
                )}
                {/* 03. 미발주 */}
                {showSections.none && (
                  <ColHeader label="미발주" sortKey="noneOut" sorts={sorts} onSort={handleSort}/>
                )}
                {/* 05. 현재고 */}
                {showSections.cur && (
                  <ColHeader label="현재고" sortKey="curStock" sorts={sorts} onSort={handleSort}/>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedCountries.length===0 ? (
                <tr><td colSpan={20} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>데이터 없음</td></tr>
              ) : sortedCountries.map(gCountry => {
                const ck = gCountry.country;
                const isCC = collapsed.has(ck);
                const cTot = { prev:0, order:0, out:0, none:0, cur:0, inc:0, custO:{}, farmI:{} };
                Object.values(gCountry.flowers).forEach(gf=>gf.items.forEach(r=>{
                  cTot.prev  += r.prevStock||0;
                  cTot.order += r.totalOrder||0;
                  cTot.inc   += r.totalIncoming||0;
                  cTot.out   += r.confirmedOut||0;
                  cTot.none  += r.noneOut||0;
                  cTot.cur   += r.curStock||0;
                  if (!compact) {
                    custs.forEach(c=>{cTot.custO[c.custName]=(cTot.custO[c.custName]||0)+(r.orders?.[c.custName]||0);});
                    farms.forEach(f=>{cTot.farmI[f]=(cTot.farmI[f]||0)+(r.incoming?.[f]||0);});
                  }
                }));
                return [
                  <tr key={`c-${ck}`} style={{background:'#D0DDE8',cursor:'pointer'}} onClick={()=>toggleCollapse(ck)}>
                    <td colSpan={totalFixedCols} style={{padding:'2px 8px',fontWeight:'bold',fontSize:12,borderRight:'2px solid var(--border2)'}}>
                      {isCC?'▶':'∨'} {gCountry.country}
                    </td>
                    {showSections.prev     && <td className="num" style={{fontWeight:'bold',background:'#C4CCE4'}}>{fN(cTot.prev)}</td>}
                    {!compact && showSections.order    && sortedCusts.map(c=><td key={c.custName} className="num" style={{background:'#C8DCC8'}}>{fN(cTot.custO[c.custName])}</td>)}
                    {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B0CEB0'}}>{fN(cTot.order)}</td>}
                    {!compact && showSections.incoming && farms.map(f=><td key={f} className="num" style={{background:'#DCC8B8'}}>{fN(cTot.farmI[f])}</td>)}
                    {!compact && showSections.incoming && farms.length===0 && <td></td>}
                    {compact && showSections.incoming && <td className="num" style={{fontWeight:'bold',background:'#DCC8B8'}}>{fN(cTot.inc)}</td>}
                    {showSections.out      && <td className="num" style={{fontWeight:'bold',background:'#D4C4B0'}}>{fN(cTot.out)}</td>}
                    {showSections.none     && <td className="num" style={{fontWeight:'bold',background:'#D8D0A8'}}>{fN(cTot.none)}</td>}
                    {showSections.cur      && <td className="num" style={{fontWeight:'bold',background:'#BEBEDE'}}>{fN(cTot.cur)}</td>}
                  </tr>,

                  ...(!isCC ? (gCountry._sortedFlowers || Object.values(gCountry.flowers)).map(gFlower=>{
                    const fk = ck+'|'+gFlower.flower;
                    const isFC = collapsed.has(fk);
                    const fTot = { prev:0, order:0, out:0, none:0, cur:0, inc:0, custO:{}, farmI:{} };
                    gFlower.items.forEach(r=>{
                      fTot.prev  += r.prevStock||0;
                      fTot.order += r.totalOrder||0;
                      fTot.inc   += r.totalIncoming||0;
                      fTot.out   += r.confirmedOut||0;
                      fTot.none  += r.noneOut||0;
                      fTot.cur   += r.curStock||0;
                      if (!compact) {
                        custs.forEach(c=>{fTot.custO[c.custName]=(fTot.custO[c.custName]||0)+(r.orders?.[c.custName]||0);});
                        farms.forEach(f=>{fTot.farmI[f]=(fTot.farmI[f]||0)+(r.incoming?.[f]||0);});
                      }
                    });

                    return [
                      <tr key={`f-${fk}`} style={{background:'#D8E4F0',cursor:'pointer'}} onClick={()=>toggleCollapse(fk)}>
                        <td style={{width:8}}></td>
                        <td colSpan={totalFixedCols-1} style={{padding:'2px 8px',fontWeight:'bold',fontSize:11,borderRight:'2px solid var(--border2)'}}>
                          {isFC?'▶':'∨'} {gFlower.flower} <span style={{fontSize:10,color:'var(--text3)'}}>({gFlower.items.length})</span>
                        </td>
                        {showSections.prev     && <td className="num" style={{background:'#CCD4EC'}}>{fN(fTot.prev)}</td>}
                        {!compact && showSections.order    && sortedCusts.map(c=><td key={c.custName} className="num" style={{background:'#CCE0CC'}}>{fN(fTot.custO[c.custName])}</td>)}
                        {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B4D0B4'}}>{fN(fTot.order)}</td>}
                        {!compact && showSections.incoming && farms.map(f=><td key={f} className="num" style={{background:'#DCCCC0'}}>{fN(fTot.farmI[f])}</td>)}
                        {!compact && showSections.incoming && farms.length===0 && <td></td>}
                        {compact && showSections.incoming && <td className="num" style={{fontWeight:'bold',background:'#DCCCC0'}}>{fN(fTot.inc)}</td>}
                        {showSections.out      && <td className="num" style={{background:'#D8C8B4'}}>{fN(fTot.out)}</td>}
                        {showSections.none     && <td className="num" style={{background:'#DDD8B0'}}>{fN(fTot.none)}</td>}
                        {showSections.cur      && <td className="num" style={{background:'#C4C4E0'}}>{fN(fTot.cur)}</td>}
                      </tr>,

                      ...(!isFC ? gFlower.items.map((r,idx)=>(
                        <tr key={`i-${r.prodKey}-${idx}`} style={{background:idx%2===0?'#fff':'var(--row-alt)'}}>
                          <td></td><td></td>
                          <td style={{fontSize:11,fontWeight:500,borderRight: showArea?'none':'2px solid var(--border2)',padding:'1px 4px'}} title={r.prodName}>
                            {r.prodName}
                          </td>
                          {showArea     && <td style={{fontSize:10,borderRight:'2px solid var(--border2)',color:'var(--text3)'}} title={r.area||''}>{r.area||''}</td>}
                          {showOutDate  && <td style={{fontSize:10}} title={r.outDate||''}>{r.outDate||''}</td>}
                          {showInPrice  && <td className="num" style={{fontSize:10}}>{fN(r.inPrice)}</td>}
                          {showInTotal  && <td className="num" style={{fontSize:10}}>{fN(r.inTotal)}</td>}
                          {showArrival  && <td className="num" style={{fontSize:10,color:(r.arrivalCost||0)>0?'#8a5a00':'var(--text3)'}} title={`${r.arrivalMeta?.displayUnit||r.unit||''}당 도착원가 (=/freight${r.arrivalMeta?.source?` · ${r.arrivalMeta.source}`:''})`}>{fN(r.arrivalCost)}</td>}
                          {showAWB      && <td style={{fontSize:10}}>{r.awb||''}</td>}
                          {showAmount   && <td className="num" style={{fontSize:10,color:'var(--green)'}}>{fN((r.cost||0)*(r.totalOrder||0))}</td>}
                          {showDescr    && <td style={{fontSize:10,color:'var(--text3)'}} title={r.descr}>{r.descr||''}</td>}
                          {showSections.prev && (
                            <td className="num" style={{background:'#F0F4FF',color:(r.prevStock||0)>0?'var(--blue)':'var(--text3)'}}>{fN(r.prevStock)}</td>
                          )}
                          {!compact && showSections.order && sortedCusts.map(c=>{
                            const showStack = showCost || showDistCost;
                            return (
                            <td key={c.custName} className="num" style={{background:'#F4FFF4',color:(r.orders?.[c.custName]||0)>0?'#006600':'var(--text3)',lineHeight:showStack?'1.2':'inherit',padding:showStack?'1px 4px':'inherit'}}>
                              {showQty && fN(r.orders?.[c.custName])}
                              {showCost && (r.costOrders?.[c.custName]||0)>0 && (
                                <div style={{fontSize:9,color:'var(--blue)',fontStyle:'italic'}} title="판매단가">{fN(r.costOrders?.[c.custName])}</div>
                              )}
                              {showDistCost && (r.distCostOrders?.[c.custName]||0)>0 && (
                                <div style={{fontSize:9,color:'var(--amber)',fontStyle:'italic'}} title="분배단가">{fN(r.distCostOrders?.[c.custName])}</div>
                              )}
                            </td>
                          );})}
                          {showSections.order && (
                            <td className="num" style={{fontWeight:'bold',background:'#E8F8E8',borderLeft: compact?undefined:'2px solid var(--border2)',color:(r.totalOrder||0)>0?'#006600':'var(--text3)',lineHeight:compact&&showDistCost?'1.2':'inherit'}}>
                              {fN(r.totalOrder)}
                              {compact && showDistCost && rowDistCostAvg(r)>0 && (
                                <div style={{fontSize:9,color:'var(--amber)',fontStyle:'italic',fontWeight:'normal'}} title="분배단가(주문 가중 평균)">{fN(rowDistCostAvg(r))}</div>
                              )}
                            </td>
                          )}
                          {!compact && showSections.incoming && farms.map(f=>(
                            <td key={f} className="num" style={{background:'#FFF8F0',color:(r.incoming?.[f]||0)>0?'var(--amber)':'var(--text3)'}}>
                              {fN(r.incoming?.[f])}
                            </td>
                          ))}
                          {!compact && showSections.incoming && farms.length===0 && <td></td>}
                          {compact && showSections.incoming && (
                            <td className="num" style={{fontWeight:'bold',background:'#FFF3E6',color:(r.totalIncoming||0)>0?'var(--amber)':'var(--text3)'}}>
                              {fN(r.totalIncoming)}
                            </td>
                          )}
                          {showSections.out && (
                            <td className="num" style={{background:'#FFF0E8',color:(r.confirmedOut||0)>0?'#884400':'var(--text3)'}}>{fN(r.confirmedOut)}</td>
                          )}
                          {showSections.none && (
                            <td className="num" style={{background:'#FFFCE8',color:(r.noneOut||0)>0?'var(--amber)':'var(--text3)'}}>{fN(r.noneOut)}</td>
                          )}
                          {showSections.cur && (
                            <td className="num" style={{background:'#F4F4FF',color:(r.curStock||0)<0?'var(--red)':(r.curStock||0)>0?'var(--blue)':'var(--text3)'}}>
                              {fN(r.curStock)}
                            </td>
                          )}
                        </tr>
                      )) : []),

                      <tr key={`ft-${fk}`} style={{background:'#D4E0EC',borderTop:'1px solid var(--border)'}}>
                        <td colSpan={totalFixedCols} style={{padding:'2px 16px',fontSize:11,color:'var(--text3)',borderRight:'2px solid var(--border2)'}}>
                          {gFlower.flower} Total
                        </td>
                        {showSections.prev     && <td className="num" style={{fontWeight:'bold',background:'#CAD2EA'}}>{fN(fTot.prev)}</td>}
                        {!compact && showSections.order    && sortedCusts.map(c=><td key={c.custName} className="num" style={{fontWeight:'bold',background:'#C8DCC8'}}>{fN(fTot.custO[c.custName])}</td>)}
                        {showSections.order    && <td className="num" style={{fontWeight:'bold',background:'#B0CEB0'}}>{fN(fTot.order)}</td>}
                        {!compact && showSections.incoming && farms.map(f=><td key={f} className="num" style={{fontWeight:'bold',background:'#D8C8B4'}}>{fN(fTot.farmI[f])}</td>)}
                        {!compact && showSections.incoming && farms.length===0 && <td></td>}
                        {compact && showSections.incoming && <td className="num" style={{fontWeight:'bold',background:'#D8C8B4'}}>{fN(fTot.inc)}</td>}
                        {showSections.out      && <td className="num" style={{fontWeight:'bold',background:'#D0C0A8'}}>{fN(fTot.out)}</td>}
                        {showSections.none     && <td className="num" style={{fontWeight:'bold',background:'#DAD4AC'}}>{fN(fTot.none)}</td>}
                        {showSections.cur      && <td className="num" style={{fontWeight:'bold',background:'#C0C0DC'}}>{fN(fTot.cur)}</td>}
                      </tr>,
                    ];
                  }) : []),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 하단 필터 상태바 ───────────────────────────────── */}
      <div style={{padding:'4px 10px', background:'#f0f4fa', borderTop:'2px solid var(--border2)',
        display:'flex', alignItems:'center', gap:5, fontSize:11, flexWrap:'wrap', flexShrink:0, minHeight:32}}>

        {/* 통합 필터 요약 — [구분] In [02.주문, 03.입고] And [국가] = [콜롬비아] 형식 */}
        {(() => {
          const secLabels = { prev:'01.전재고', order:'02.주문', incoming:'03.입고', out:'04.출고', none:'03.미발주', cur:'05.현재고' };
          const onSecs = Object.keys(secLabels).filter(k=>showSections[k]).map(k=>secLabels[k]);
          const parts = [];
          parts.push(<span key="sec"><b style={{color:'var(--text2)'}}>[구분]</b> In [{onSecs.join(', ')}]</span>);
          filterZone.forEach(id=>{
            const sel = fieldFilters[id];
            if (!sel || sel.length===0) return;
            const lbl = FIELD_BY_ID[id]?.label || id;
            if (sel.includes('__EMPTY__')) {
              parts.push(<span key={`fz-${id}`}> <b style={{color:'#3b7dd8'}}>And</b> <b style={{color:'var(--text2)'}}>[{lbl}]</b> = [없음]</span>);
              return;
            }
            const op = sel.length===1 ? '=' : 'In';
            parts.push(<span key={`fz-${id}`}> <b style={{color:'#3b7dd8'}}>And</b> <b style={{color:'var(--text2)'}}>[{lbl}]</b> {op} [{sel.join(', ')}]</span>);
          });
          filterConditions.forEach((c,i)=>{
            const opTxt = {eq:'=',neq:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤',contains:'Contains',notcontains:'Does not contain',beginswith:'Begins with',endswith:'Ends with',anyof:'In'}[c.op]||c.op;
            const val = c.op==='anyof' ? (c.values||[]).join(', ') : c.value;
            parts.push(<span key={`fc-${i}`}> <b style={{color:'#3b7dd8'}}>And</b> <b style={{color:'var(--text2)'}}>[{c.field}]</b> {opTxt} [{val}]</span>);
          });
          return <span style={{flexBasis:'100%',fontSize:10,color:'var(--text3)',marginBottom:2,whiteSpace:'normal'}}>{parts}</span>;
        })()}

        {/* 구분 섹션 토글 칩 */}
        <span style={{fontSize:10,color:'var(--text3)',fontWeight:'bold',marginRight:2}}>구분</span>
        {[
          {k:'prev',id:'secPrev',l:'01.전재고'},{k:'order',id:'secOrder',l:'02.주문'},
          {k:'incoming',id:'secIncoming',l:'03.입고'},{k:'out',id:'secOut',l:'04.출고'},
          {k:'none',id:'secNone',l:'03.미발주'},{k:'cur',id:'secCur',l:'05.현재고'},
        ].map(s => (
          <span key={s.k}
            onClick={() => setColumnZone(z => z.includes(s.id) ? z.filter(x => x !== s.id) : [...z, s.id])}
            style={{
              padding:'1px 7px', borderRadius:3, cursor:'pointer', fontSize:10, userSelect:'none',
              background: showSections[s.k] ? '#3b7dd8' : '#dde2ea',
              color: showSections[s.k] ? '#fff' : 'var(--text2)',
              border:`1px solid ${showSections[s.k]?'#2a6cc8':'var(--border)'}`,
            }}>{s.l}</span>
        ))}

        {/* Field List 필터영역 칩 (값 선택 후 표시) */}
        {filterZone.filter(id=>fieldFilters[id]?.length>0).map(id => (
          <span key={`fzchip-${id}`} style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{color:'#3b7dd8',fontWeight:'bold',fontSize:10}}>And</span>
            <span style={{background:'#fff',border:'1px solid var(--border2)',borderRadius:3,
              padding:'1px 6px',display:'flex',alignItems:'center',gap:3,fontSize:10}}>
              <span style={{color:'var(--text2)',fontWeight:'bold'}}>{FIELD_BY_ID[id]?.label||id}</span>
              {fieldFilters[id].includes('__EMPTY__') ? (
                <span style={{color:'var(--red)'}}>= 없음</span>
              ) : (
                <>
                  <span style={{color:'var(--text3)'}}>{fieldFilters[id].length===1?'=':'In'}</span>
                  {fieldFilters[id].slice(0,4).map(v=><span key={v} style={{background:'#e8f0fe',borderRadius:2,padding:'0 4px'}}>{v}</span>)}
                  {fieldFilters[id].length>4 && <span style={{color:'var(--text3)'}}>+{fieldFilters[id].length-4}</span>}
                </>
              )}
              <span style={{cursor:'pointer',color:'var(--red)',marginLeft:2,fontSize:12}}
                onClick={()=>setFieldFilters(ff=>({...ff,[id]:[]}))}>×</span>
            </span>
          </span>
        ))}

        {/* Filter Editor로 추가된 조건 */}
        {filterConditions.map((cond, idx) => (
          <span key={idx} style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{color:'#3b7dd8',fontWeight:'bold',fontSize:10}}>And</span>
            <span style={{background:'#fff',border:'1px solid var(--border2)',borderRadius:3,
              padding:'1px 6px',display:'flex',alignItems:'center',gap:3,fontSize:10}}>
              <span style={{color:'var(--text2)',fontWeight:'bold'}}>{cond.field}</span>
              <span style={{color:'var(--text3)'}}>
                {({eq:'=',neq:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤',
                  contains:'Contains',notcontains:'Does not contain',
                  beginswith:'Begins with',endswith:'Ends with',anyof:'Is any of'})[cond.op]||cond.op}
              </span>
              {cond.op==='anyof'
                ? (cond.values||[]).map(v=><span key={v} style={{background:'#e8f0fe',borderRadius:2,padding:'0 4px'}}>{v}</span>)
                : <span style={{background:'#e8f0fe',borderRadius:2,padding:'0 4px'}}>{cond.value}</span>
              }
              <span style={{cursor:'pointer',color:'var(--red)',marginLeft:2,fontSize:12}}
                onClick={()=>setFilterConditions(cs=>cs.filter((_,i)=>i!==idx))}>×</span>
            </span>
          </span>
        ))}

        <button className="btn btn-sm" style={{marginLeft:'auto',height:22,fontSize:11}}
          onClick={openFilterEditor}>✏️ Edit Filter</button>
      </div>

      {/* ── Filter Editor 모달 ───────────────────────────────── */}
      {showFilterEditor && typeof document !== 'undefined' && createPortal(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:3000,
          display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={e=>e.target===e.currentTarget&&setShowFilterEditor(false)}>
          <div style={{background:'#fff',border:'2px solid var(--border2)',width:540,maxHeight:'80vh',
            borderRadius:4,boxShadow:'4px 4px 20px rgba(0,0,0,.35)',display:'flex',flexDirection:'column'}}>

            {/* 헤더 */}
            <div style={{padding:'8px 14px',background:'var(--header-bg)',borderBottom:'1px solid var(--border)',
              fontWeight:'bold',fontSize:13,flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
              🔍 Filter Editor
              <span style={{marginLeft:'auto',cursor:'pointer',fontSize:16,color:'var(--text3)'}}
                onClick={()=>setShowFilterEditor(false)}>×</span>
            </div>

            {/* 조건 목록 */}
            <div style={{padding:14,overflowY:'auto',flex:1}}>
              <div style={{display:'inline-flex',alignItems:'center',background:'#ffe0e0',border:'1px solid #ff9999',
                borderRadius:3,padding:'2px 12px',fontSize:11,fontWeight:'bold',marginBottom:10,color:'#c00'}}>
                And
              </div>

              {draftConds.map((cond, idx) => (
                <div key={idx} style={{display:'flex',alignItems:'flex-start',gap:6,marginBottom:8,
                  padding:'6px 8px',background:'#fafafa',border:'1px solid #eee',borderRadius:4}}>

                  {/* × 삭제 */}
                  <button style={{background:'none',border:'1px solid #ddd',borderRadius:2,cursor:'pointer',
                    width:20,height:20,fontSize:11,color:'var(--red)',padding:0,flexShrink:0,marginTop:1}}
                    onClick={()=>setDraftConds(ds=>ds.filter((_,i)=>i!==idx))}>×</button>

                  {/* 필드 선택 */}
                  <select value={cond.field||''} style={{height:24,fontSize:11,border:'1px solid var(--border2)',borderRadius:2,flexShrink:0}}
                    onChange={e=>setDraftConds(ds=>ds.map((d,i)=>i===idx?{...d,field:e.target.value,op:'eq',value:'',values:[]}:d))}>
                    <option value="">-- 필드 선택 --</option>
                    {['구분','국가','꽃','비고','지역','품목명','품목명(색상)','출고일','입고단가','입고총단가','AWB','거래처명','농장명'].map(f=>(
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>

                  {/* 연산자 */}
                  {cond.field && cond.field !== '구분' && (
                    <select value={cond.op||'eq'} style={{height:24,fontSize:11,border:'1px solid var(--border2)',borderRadius:2,flexShrink:0}}
                      onChange={e=>setDraftConds(ds=>ds.map((d,i)=>i===idx?{...d,op:e.target.value,value:'',values:[]}:d))}>
                      {[{k:'eq',l:'='},{k:'neq',l:'≠'},{k:'gt',l:'>'},{k:'gte',l:'≥'},{k:'lt',l:'<'},{k:'lte',l:'≤'},
                        {k:'contains',l:'Contains'},{k:'notcontains',l:'Does not contain'},
                        {k:'beginswith',l:'Begins with'},{k:'endswith',l:'Ends with'},{k:'anyof',l:'Is any of'},
                      ].map(op=><option key={op.k} value={op.k}>{op.l}</option>)}
                    </select>
                  )}

                  {/* 값 입력 */}
                  <div style={{flex:1}}>
                    {cond.field === '구분' ? (
                      /* 구분: 섹션 체크박스 */
                      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                        {[{k:'prev',l:'01. 전재고'},{k:'order',l:'02. 주문'},
                          {k:'incoming',l:'03. 입고'},{k:'out',l:'04. 출고'},{k:'none',l:'03. 미발주'},{k:'cur',l:'05. 현재고'},
                        ].map(s=>(
                          <label key={s.k} style={{display:'flex',alignItems:'center',gap:3,fontSize:11,cursor:'pointer',
                            background:(cond.sections||showSections)[s.k]!==false?'#e8f0fe':'#f8f8f8',
                            border:'1px solid var(--border2)',borderRadius:2,padding:'2px 6px'}}>
                            <input type="checkbox"
                              checked={(cond.sections||showSections)[s.k]!==false}
                              onChange={e=>setDraftConds(ds=>ds.map((d,i)=>i===idx?{
                                ...d,sections:{...(d.sections||showSections),[s.k]:e.target.checked}
                              }:d))}/>
                            {s.l}
                          </label>
                        ))}
                      </div>
                    ) : cond.op === 'anyof' ? (
                      /* Is any of: 체크박스 목록 */
                      <div style={{display:'flex',gap:3,flexWrap:'wrap',maxHeight:100,overflowY:'auto',
                        border:'1px solid var(--border)',borderRadius:2,padding:'4px 6px'}}>
                        {getFieldValues(cond.field).map(v=>(
                          <label key={v} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,cursor:'pointer',
                            background:(cond.values||[]).includes(v)?'#e8f0fe':'#f8f8f8',
                            border:'1px solid var(--border2)',borderRadius:2,padding:'1px 5px'}}>
                            <input type="checkbox" checked={(cond.values||[]).includes(v)}
                              onChange={e=>{
                                const vals = e.target.checked
                                  ? [...(cond.values||[]),v]
                                  : (cond.values||[]).filter(x=>x!==v);
                                setDraftConds(ds=>ds.map((d,i)=>i===idx?{...d,values:vals}:d));
                              }}/>
                            {v}
                          </label>
                        ))}
                      </div>
                    ) : cond.field ? (
                      /* 텍스트/숫자 입력 */
                      <input type="text" value={cond.value||''} placeholder="값 입력..."
                        style={{width:'100%',height:24,fontSize:11,border:'1px solid var(--border2)',
                          borderRadius:2,padding:'0 6px',boxSizing:'border-box'}}
                        onChange={e=>setDraftConds(ds=>ds.map((d,i)=>i===idx?{...d,value:e.target.value}:d))}/>
                    ) : null}
                  </div>
                </div>
              ))}

              <button className="btn btn-sm" style={{marginTop:4,fontSize:11}}
                onClick={()=>setDraftConds(ds=>[...ds,{field:'',op:'eq',value:'',values:[]}])}>
                + 조건 추가
              </button>
            </div>

            {/* 푸터 버튼 */}
            <div style={{padding:'8px 14px',borderTop:'1px solid var(--border)',
              display:'flex',gap:8,justifyContent:'flex-end',flexShrink:0}}>
              <button className="btn btn-primary" onClick={applyFilterEditor}>OK</button>
              <button className="btn" onClick={()=>setShowFilterEditor(false)}>Cancel</button>
              <button className="btn" onClick={applyFilterEditor}>Apply</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 차수·품종별 선택 다운로드 모달 */}
      {pickOpen && createPortal(
        <div onMouseDown={(e)=>{ if(e.target===e.currentTarget) setPickOpen(false); }}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:9999,
            display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#fff',borderRadius:8,width:420,maxHeight:'80vh',
            display:'flex',flexDirection:'column',boxShadow:'0 8px 32px rgba(0,0,0,.3)'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
              display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <b style={{fontSize:14}}>다운로드할 품종 선택 ({pickSel.size}/{pickItems.length})</b>
              <button className="btn btn-sm" onClick={()=>setPickOpen(false)}>✕</button>
            </div>
            <div style={{padding:'8px 16px',borderBottom:'1px solid var(--border)',display:'flex',gap:6}}>
              <button className="btn btn-sm" onClick={()=>setPickSel(new Set(pickItems.map(i=>i.key)))}>전체 선택</button>
              <button className="btn btn-sm" onClick={()=>setPickSel(new Set())}>전체 해제</button>
            </div>
            <div style={{padding:'8px 16px',overflowY:'auto',flex:1}}>
              {pickItems.map(it => (
                <label key={it.key} style={{display:'flex',alignItems:'center',gap:8,
                  padding:'6px 4px',cursor:'pointer',fontSize:13,borderBottom:'1px solid #f0f0f0'}}>
                  <input type="checkbox" checked={pickSel.has(it.key)} onChange={()=>toggleSel(it.key)} />
                  <span>{it.species}</span>
                </label>
              ))}
            </div>
            <div style={{padding:'10px 16px',borderTop:'1px solid var(--border)',
              display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setPickOpen(false)}>취소</button>
              <button className="btn btn-success" onClick={downloadPicked} disabled={!pickSel.size}>
                선택 {pickSel.size}개 다운로드
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
