// nenova.exe FormOrderHistory(발주 관리 · ≡ 발주 목록) DevExpress 피벗과 같은 화면.
// 데이터: GET /api/warehouse/order-history-pivot (읽기 전용). 집계·표시는 공용 피벗 모델/그리드 재사용.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_HISTORY_FIELDS, ORDER_HISTORY_DEFAULT_LAYOUT } from '../lib/orderHistoryPivotFields';
import { normalizeLayout, pivotAxisKey } from '../lib/pivotExeModel';
import PivotExeGrid from './PivotExeGrid';
import ExePivotFieldArea from './ExePivotFieldArea';
import ExePivotTheme from './ExePivotTheme.module.css';
import { buildPivotExeStructure, getPivotExeGroupKeys, pivotExeValueLabel } from '../lib/pivotExePresentation';
import { normalizePivotExeView } from '../lib/pivotExeViewState';
import { collectPivotOrderValues, createPivotValueOrderComparator, movePivotValue } from '../lib/pivotExeValueOrder';
import { usePivotExeCalculation } from '../lib/usePivotExeCalculation';
import PivotLoadingOverlay from './PivotLoadingOverlay';
import { pivotLinkedValues, applyLinkedPivotSelection } from '../lib/pivotLinkedFilters';
import { createPivotPreferenceWriter, createPivotResizeSession, describePivotValueSelection, movePivotField, normalizeCollectivePivotWidths, pivotResizePreferenceKey, withCollectivePivotWidth } from '../lib/pivotExeInteraction';

const FIELDS = ORDER_HISTORY_FIELDS;
const BY_ID = Object.fromEntries(FIELDS.map((field) => [field.id, field]));
const VIEW_OPTIONS = { fields: ORDER_HISTORY_FIELDS, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT };
const DEFAULT_ZONES = {
  rows: [...ORDER_HISTORY_DEFAULT_LAYOUT.row],
  cols: [...ORDER_HISTORY_DEFAULT_LAYOUT.column],
  values: ORDER_HISTORY_DEFAULT_LAYOUT.data.map((id) => ({ id, aggregation: 'sum' })),
  filters: [...ORDER_HISTORY_DEFAULT_LAYOUT.filter],
};
const DEFAULT_WIDTHS = { ProdName: 189 };
const WEB_TOOLS_OPEN_KEY = 'orderHistoryPivotWebToolsOpen';
const EMPTY_AST = () => ({ kind: 'group', op: 'AND', children: [] });
const cleanText = (value) => value === null ? '(null)' : value === undefined ? '(undefined)' : value === '' ? '(빈값)' : String(value);
const rawFilterValue = (value) => value === '(null)' ? null : value === '(undefined)' ? undefined : value === '(빈값)' ? '' : value;
const DRILL_COLUMNS = [
  ['ChangeDtm', '입력일자'], ['OrderWeek', '주문주차'], ['CustName', '거래처명'], ['CounName', '국가'], ['FlowerName', '꽃'],
  ['ProdName', '품목명(색상)'], ['OrderCode', 'C.N.'], ['ChangeType', '변경구분'], ['ColumName', '변경항목'],
  ['AfterValue', '변경수량'], ['ChangeUser', '변경자'], ['OutUnit', '단위'],
];

// 셀(행 경로 × 열 경로)에 속한 원본 행. 모델 축은 rows 를 공개하지 않으므로 같은 키 함수로 경로를 맞춘다.
function pathMatches(row, fields, path) {
  if (!path.length) return true;
  return pivotAxisKey('p', fields.slice(0, path.length).map((field) => row?.[field])) === pivotAxisKey('p', path);
}
export function orderHistoryDrillRows(model, rowAxis, columnAxis) {
  if (!model || !rowAxis || !columnAxis) return [];
  const rowFields = model.layout?.row || [];
  const columnFields = model.layout?.column || [];
  return (model.rows || []).filter((row) => pathMatches(row, rowFields, rowAxis.path || []) && pathMatches(row, columnFields, columnAxis.path || []));
}

function useAnchoredPopup(open, anchor, onOrphan) {
  const popupRef = useRef(null);
  const [position, setPosition] = useState(null);
  const place = useCallback(() => {
    const popup = popupRef.current;
    if (!popup || !anchor?.isConnected) {
      if (anchor && !anchor.isConnected) onOrphan();
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 6;
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - popupRect.width - 8));
    const below = anchorRect.bottom + gap;
    const top = below + popupRect.height <= window.innerHeight - 8 ? below : Math.max(8, anchorRect.top - popupRect.height - gap);
    setPosition({ left, top });
  }, [anchor, onOrphan]);
  useEffect(() => {
    if (!open || !anchor) return undefined;
    setPosition(null);
    const frame = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(popupRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, anchor, place]);
  return [popupRef, position];
}

function FieldMenu({ field, aggregation, sort, popupRef, position, onAggregation, onClose, onMove, onHide, onSort, onBestFit, onFilter, onReorder }) {
  const move = (zone) => { onMove(field.id, zone); onClose(); };
  return <div ref={popupRef} data-testid="pivot-exe-field-menu" role="dialog" aria-label={`${field.label} 메뉴`} style={{...menuStyle,...position,visibility:position?'visible':'hidden'}} onClick={(event) => event.stopPropagation()}>
    <div style={{display:'flex',justifyContent:'space-between',gap:8}}><b style={{fontSize:12}}>{field.label}</b><small style={{color:'#607089'}}>정렬 {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : '—'}</small></div>
    <div style={menuGrid}>
      <button onClick={(event) => onFilter(field.id, event)}>값 필터…</button><button onClick={() => { onSort(field.id, 'asc'); onClose(); }}>오름차순</button>
      <button onClick={() => { onSort(field.id, 'desc'); onClose(); }}>내림차순</button><button onClick={() => { onSort(field.id, null); onClose(); }}>정렬 해제</button>
      <button data-testid="pivot-exe-move-row" onClick={() => move('rows')}>세로 행으로 이동</button><button data-testid="pivot-exe-move-column" onClick={() => move('cols')}>가로 열로 이동</button>
      <button data-testid="pivot-exe-move-value" onClick={() => move('values')}>값으로 이동{field.numeric ? '' : ' (개수)'}</button><button data-testid="pivot-exe-move-filter" onClick={() => move('filters')}>필터로 이동</button>
      <button onClick={() => onReorder(field.id, 'first')}>처음</button><button onClick={() => onReorder(field.id, 'prev')}>이전</button>
      <button onClick={() => onReorder(field.id, 'next')}>다음</button><button onClick={() => onReorder(field.id, 'last')}>끝</button>
      <button onClick={() => onBestFit(field.id)}>너비 자동맞춤</button><button onClick={() => { onHide(field.id); onClose(); }}>숨김</button>
    </div>
    {aggregation && <label style={{display:'block',fontSize:11,marginTop:7}}>집계 <select value={aggregation} onChange={(event)=>onAggregation(field.id,event.target.value)}>{field.numeric && <><option value="sum">합계</option><option value="avg">평균</option><option value="min">최소</option><option value="max">최대</option></>}<option value="count">개수</option></select></label>}
    <button style={{width:'100%',marginTop:5}} onClick={onClose}>닫기</button>
  </div>;
}

function FilterValueDialog({ field, values, selected, valueOrder, sort, rawValue, rawValues, popupRef, position, onApply, onClear, onClose }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(() => new Set(Array.isArray(selected) ? selected : values));
  const [draftOrder, setDraftOrder] = useState(valueOrder || []);
  const [draftSort, setDraftSort] = useState(sort || null);
  const ordered = useMemo(() => {
    const compare = createPivotValueOrderComparator(draftOrder, draftSort || (draftOrder.length ? 'asc' : null));
    return [...values].sort((a,b) => compare(rawValue(a),rawValue(b)));
  }, [values,draftOrder,draftSort,rawValue]);
  const visible = ordered.filter((value) => cleanText(value).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const changeSort = (direction) => { setDraftSort(direction); setDraftOrder([]); };
  const moveValue = (value, offset) => { setDraftOrder(movePivotValue(ordered, ordered.indexOf(value), offset).flatMap(rawValues)); setDraftSort(null); };
  const toggle = (value) => setDraft((previous) => { const next = new Set(previous); next.has(value) ? next.delete(value) : next.add(value); return next; });
  return <section ref={popupRef} data-testid="pivot-exe-value-filter" role="dialog" aria-label={`${field.label} 값 필터`} style={{...valueFilterStyle,...position,visibility:position?'visible':'hidden'}} onClick={(event) => event.stopPropagation()}>
    <div style={popupHeaderStyle}><b>{field.label}에서 표시할 값</b><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
    <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="값 검색" style={inputStyle} />
    <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',margin:'7px 0'}}><button onClick={() => setDraft(new Set(values))}>전체 선택</button><button onClick={() => setDraft(new Set())}>전체 해제</button>{search && <button onClick={() => setDraft(new Set(visible))}>검색 결과만 선택</button>}<span style={{fontSize:11,color:'#667'}}>선택 {draft.size}/{values.length}</span></div>
    <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',margin:'7px 0'}} aria-label="값 나열 순서">
      <button type="button" onClick={()=>changeSort('asc')} aria-pressed={!draftOrder.length && draftSort==='asc'}>오름차순</button>
      <button type="button" onClick={()=>changeSort('desc')} aria-pressed={!draftOrder.length && draftSort==='desc'}>내림차순</button>
      <button type="button" onClick={()=>changeSort(null)}>순서 초기화</button>
    </div>
    <div style={{maxHeight:'min(38vh,320px)',overflow:'auto',border:'1px solid #d6dce5'}}>{visible.length ? visible.map((value,index) => <div key={value} style={{...checkLine,alignItems:'center',gap:3}}>
      <label style={{display:'flex',alignItems:'center',gap:7,flex:1,minWidth:0,overflowWrap:'anywhere'}}><input type="checkbox" checked={draft.has(value)} onChange={() => toggle(value)} />{cleanText(value)}</label>
      <button type="button" style={{minWidth:26,minHeight:24}} aria-label={`${cleanText(value)} 위로`} disabled={Boolean(search)||index===0} onClick={()=>moveValue(value,-1)}>↑</button>
      <button type="button" style={{minWidth:26,minHeight:24}} aria-label={`${cleanText(value)} 아래로`} disabled={Boolean(search)||index===ordered.length-1} onClick={()=>moveValue(value,1)}>↓</button>
    </div>) : <div style={{padding:12,textAlign:'center',fontSize:12,color:'#7a8797'}}>검색 결과가 없습니다.</div>}</div>
    <div style={{display:'flex',justifyContent:'space-between',gap:7,marginTop:12}}><button type="button" onClick={onClear}>필터 초기화</button><span style={{display:'flex',gap:7}}><button type="button" onClick={onClose}>취소</button><button type="button" className="btn btn-primary" onClick={() => onApply([...draft],draftOrder,draftSort)}>선택·순서 적용</button></span></div>
  </section>;
}

function Modal({ title, children, onClose, width = 640 }) { return <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section role="dialog" aria-modal="true" style={{...modalStyle,width}}><header style={modalHeader}><b>{title}</b><button onClick={onClose}>×</button></header><div style={{padding:12,overflow:'auto'}}>{children}</div></section></div>; }

function FieldList({ zones, hidden, onClose, onMove, onHide }) {
  const findZone = (id) => hidden.includes(id) ? 'hidden' : ['rows','cols','values','filters'].find((zone) => zones[zone].some((item) => typeof item === 'string' ? item === id : item.id === id)) || 'hidden';
  return <Modal title="필드 목록" onClose={onClose} width={520}>
    {FIELDS.map((field) => { const zone = findZone(field.id); return <div key={field.id} style={{display:'grid',gridTemplateColumns:'1fr 130px',gap:5,alignItems:'center',padding:'5px 0',borderBottom:'1px solid #eef1f5',fontSize:12}}>
      <span>{field.label} <small style={{color:'#778'}}>({field.id})</small></span>
      <select aria-label={`${field.label} 표시 위치`} value={zone} onChange={(event)=>event.target.value==='hidden'?onHide(field.id):onMove(field.id,event.target.value)}><option value="hidden">숨김</option><option value="rows">세로 행</option><option value="cols">가로 열</option><option value="filters">필터</option><option value="values">값 {field.numeric ? '' : '(개수)'}</option></select>
    </div>; })}
    <div style={{textAlign:'right',marginTop:10}}><button className="btn btn-primary" onClick={onClose}>완료</button></div>
  </Modal>;
}

function DrillDownModal({ drill, onClose }) {
  const total = drill.rows.reduce((sum, row) => sum + (Number(row.AfterValue) || 0), 0);
  return <Modal title={`발주 이력 · ${drill.title}`} onClose={onClose} width={1100}>
    <div data-testid="order-history-drilldown" style={{fontSize:12}}>
      <div style={{marginBottom:6,color:'#52647a'}}>{drill.rows.length.toLocaleString()}행 · 변경수량 합계 {total.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div style={{maxHeight:'60vh',overflow:'auto',border:'1px solid #9d9d9d'}}>
        <table style={{borderCollapse:'collapse',width:'100%',fontSize:12}}>
          <thead><tr>{DRILL_COLUMNS.map(([id,label]) => <th key={id} style={drillHead}>{label}</th>)}</tr></thead>
          <tbody>{drill.rows.map((row, index) => <tr key={index}>{DRILL_COLUMNS.map(([id]) => <td key={id} style={{...drillCell,textAlign:id==='AfterValue'?'right':'left'}}>{id === 'AfterValue' ? (Number(row[id]) || 0).toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}) : (row[id] ?? '')}</td>)}</tr>)}
            {!drill.rows.length && <tr><td colSpan={DRILL_COLUMNS.length} style={{...drillCell,textAlign:'center',color:'#777'}}>해당 셀의 원본 행이 없습니다.</td></tr>}</tbody>
        </table>
      </div>
      <div style={{textAlign:'right',marginTop:10}}><button className="btn btn-primary" onClick={onClose}>닫기</button></div>
    </div>
  </Modal>;
}

export default function OrderHistoryPivotPanel() {
  const [lookups, setLookups] = useState({ weeks: [], countryFlowers: [] });
  const [lookupError, setLookupError] = useState('');
  const [week, setWeek] = useState('');
  const [countryFlower, setCountryFlower] = useState('');
  const [rows, setRows] = useState([]);
  const [successScope, setSuccessScope] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [hidden, setHidden] = useState([]);
  const [fieldMenu, setFieldMenu] = useState(null);
  const [fieldList, setFieldList] = useState(false);
  const [filterField, setFilterField] = useState(null);
  const [selections, setSelections] = useState({});
  const [filterActive, setFilterActive] = useState(true);
  const [decimals, setDecimals] = useState(2);
  const [previousNonzeroDecimals, setPreviousNonzeroDecimals] = useState(2);
  const [zeroVisible, setZeroVisible] = useState(false);
  const [showRowTotals, setShowRowTotals] = useState(true);
  const [showColumnTotals, setShowColumnTotals] = useState(true);
  const [showGrandTotals, setShowGrandTotals] = useState(true);
  const [collapsedRows, setCollapsedRows] = useState(new Set());
  const [collapsedCols, setCollapsedCols] = useState(new Set());
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [rowHeight, setRowHeight] = useState(24);
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [preferenceKey, setPreferenceKey] = useState(null);
  const [preferenceError, setPreferenceError] = useState('');
  const [draggedField, setDraggedField] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [sorts, setSorts] = useState({});
  const [valueOrders, setValueOrders] = useState({});
  const [exporting, setExporting] = useState(false);
  const [drill, setDrill] = useState(null);
  const [webToolsOpen, setWebToolsOpen] = useState(false);
  useEffect(() => { try { setWebToolsOpen(localStorage.getItem(WEB_TOOLS_OPEN_KEY) === '1'); } catch { /* keep folded */ } }, []);
  const toggleWebTools = (event) => {
    const open = event.currentTarget.open;
    setWebToolsOpen(open);
    try { localStorage.setItem(WEB_TOOLS_OPEN_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const request = useRef({ id: 0, controller: null });
  const autoQueryTimer = useRef(null);
  const preferenceWriter = useRef(null);
  const cancelResize = useRef(null);
  const closeFieldMenu = useCallback(() => setFieldMenu(null), []);
  const closeValueFilter = useCallback(() => setFilterField(null), []);
  const [fieldMenuRef, fieldMenuPosition] = useAnchoredPopup(Boolean(fieldMenu), fieldMenu?.anchor, closeFieldMenu);
  const [valueFilterRef, valueFilterPosition] = useAnchoredPopup(Boolean(filterField), filterField?.anchor, closeValueFilter);

  const applyView = useCallback((input) => {
    const view = normalizePivotExeView(input, VIEW_OPTIONS);
    setZones(view.zones); setHidden(view.hidden); setDecimals(view.decimals);
    setPreviousNonzeroDecimals(view.previousNonzeroDecimals); setZeroVisible(view.zeroVisible);
    setWidths(normalizeCollectivePivotWidths(view.widths)); setRowHeight(view.rowHeight); setSorts(view.sorts);
    setValueOrders(view.valueOrders); setSelections(view.selections); setFilterActive(view.filterActive);
    setShowRowTotals(view.showRowTotals); setShowColumnTotals(view.showColumnTotals); setShowGrandTotals(view.showGrandTotals);
    setCollapsedRows(new Set()); setCollapsedCols(new Set()); setFieldMenu(null); setFilterField(null);
  }, []);
  const currentView = useMemo(() => ({schemaVersion:1,zones,hidden,decimals,previousNonzeroDecimals,zeroVisible,widths,rowHeight,sorts,valueOrders,selections,filterActive,showRowTotals,showColumnTotals,showGrandTotals}), [zones,hidden,decimals,previousNonzeroDecimals,zeroVisible,widths,rowHeight,sorts,valueOrders,selections,filterActive,showRowTotals,showColumnTotals,showGrandTotals]);

  useEffect(() => {
    if (!fieldMenu && !filterField) return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (fieldMenuRef.current?.contains(target) || valueFilterRef.current?.contains(target)) return;
      if (fieldMenu?.anchor?.contains(target) || filterField?.anchor?.contains(target)) return;
      closeFieldMenu(); closeValueFilter();
    };
    const closeEscape = (event) => { if (event.key === 'Escape') { closeFieldMenu(); closeValueFilter(); } };
    document.addEventListener('mousedown', closeOutside, true);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside, true); document.removeEventListener('keydown', closeEscape); };
  }, [fieldMenu, filterField, fieldMenuRef, valueFilterRef, closeFieldMenu, closeValueFilter]);

  // 사용자 확인 후에만 사용자별 배치를 읽고 쓴다 (PivotExePanel 과 같은 패턴).
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch('/api/auth/me', {credentials:'include',cache:'no-store',signal:controller.signal})
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success || !payload.user?.userId) throw new Error('사용자 확인 실패');
        if (!alive) return;
        const key = `orderHistoryPivotLayout:v1:${encodeURIComponent(payload.user.userId)}`;
        try { const stored = localStorage.getItem(key); if (stored) applyView(JSON.parse(stored)); }
        catch { setPreferenceError('이전에 저장한 화면 설정을 불러오지 못했습니다. 기본 배치로 표시합니다.'); }
        setPreferenceKey(key);
      })
      .catch(() => { if (alive) setPreferenceError('사용자를 확인하지 못해 마지막 화면 자동 저장은 일시 중단했습니다.'); })
      .finally(() => { clearTimeout(timeout); if (alive) setLayoutHydrated(true); });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [applyView]);
  useEffect(() => {
    if (!layoutHydrated || !preferenceKey) return undefined;
    const writer = createPivotPreferenceWriter({
      write: (view) => localStorage.setItem(preferenceKey, JSON.stringify(view)),
      onError: () => setPreferenceError('이 브라우저에서 마지막 화면을 저장할 수 없습니다.'),
    });
    preferenceWriter.current = writer;
    window.addEventListener('pagehide', writer.flush);
    return () => { window.removeEventListener('pagehide', writer.flush); writer.dispose(); preferenceWriter.current = null; };
  }, [layoutHydrated, preferenceKey]);
  useEffect(() => { if (layoutHydrated && preferenceKey) preferenceWriter.current?.schedule(currentView); }, [layoutHydrated, preferenceKey, currentView]);
  useEffect(() => () => cancelResize.current?.(), []);
  useEffect(() => () => request.current.controller?.abort(), []);
  useEffect(() => { setCollapsedRows(new Set()); setCollapsedCols(new Set()); }, [zones]);

  // exe SetComobo: 차수 = 최신 순 첫 항목, 품목 = CountryFlower (빈값 허용).
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    fetch('/api/warehouse/order-history-pivot?mode=lookups', {credentials:'include',signal:controller.signal})
      .then(async (response) => { const payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.error || '차수·품목 목록을 불러오지 못했습니다.'); return payload; })
      .then((payload) => {
        if (!alive) return;
        const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];
        const countryFlowers = Array.isArray(payload.countryFlowers) ? payload.countryFlowers : [];
        setLookups({ weeks, countryFlowers }); setLookupError('');
        const first = weeks.find((item) => item?.OrderWeek)?.OrderWeek;
        setWeek((previous) => previous || first || '');
      })
      .catch((cause) => { if (alive && cause.name !== 'AbortError') setLookupError(cause.message || '차수·품목 목록을 불러오지 못했습니다.'); });
    return () => { alive = false; controller.abort(); };
  }, []);
  const weekOptions = useMemo(() => [...new Set(lookups.weeks.map((item) => item?.OrderWeek).filter(Boolean))], [lookups.weeks]);
  const flowerOptions = useMemo(() => [...new Set(lookups.countryFlowers.map((item) => item?.CountryFlower).filter(Boolean))], [lookups.countryFlowers]);

  const refresh = useCallback(async () => {
    clearTimeout(autoQueryTimer.current);
    if (!week) return;
    request.current.controller?.abort();
    const controller = new AbortController(); const id = request.current.id + 1; request.current = { id, controller };
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ week, countryFlower }).toString();
      const response = await fetch(`/api/warehouse/order-history-pivot?${params}`, {credentials:'include',signal:controller.signal});
      let payload;
      try { payload = await response.json(); } catch { throw new Error('서버 응답이 지연되거나 갱신 중입니다. 잠시 후 새로고침해 주세요.'); }
      if (!response.ok || !payload.success) throw new Error(payload.error || '발주 목록을 불러오지 못했습니다.');
      if (request.current.id !== id) return;
      setRows(Array.isArray(payload.rows) ? payload.rows : []); setSuccessScope({ week, countryFlower });
    } catch (cause) { if (cause.name !== 'AbortError' && request.current.id === id) setError(cause.message || '조회 실패'); }
    finally { if (request.current.id === id) setBusy(false); }
  }, [week, countryFlower]);
  // 조건 변경 → 350ms 후 자동 조회. 필드 이동은 로컬 재집계만.
  useEffect(() => {
    request.current.controller?.abort(); request.current.id += 1; setBusy(false);
    if (!week) return undefined;
    const timer = setTimeout(refresh, 350); autoQueryTimer.current = timer;
    return () => { clearTimeout(timer); request.current.controller?.abort(); request.current.id += 1; };
  }, [refresh, week]);

  const moveField = useCallback((id, target, targetIndex) => {
    const field = BY_ID[id]; if (!field || !['rows','cols','values','filters'].includes(target)) return;
    setZones((previous) => movePivotField(previous, id, target, targetIndex, field.numeric));
    setHidden((previous) => previous.filter((item) => item !== id));
    setCollapsedRows(new Set()); setCollapsedCols(new Set());
  }, []);
  const hideField = useCallback((id) => { setZones((previous) => ({rows:previous.rows.filter((item)=>item!==id),cols:previous.cols.filter((item)=>item!==id),filters:previous.filters.filter((item)=>item!==id),values:previous.values.filter((item)=>item.id!==id)})); setHidden((previous) => previous.includes(id) ? previous : [...previous,id]); }, []);
  const reorder = useCallback((id, direction) => setZones((previous) => {
    const targetIndex = (index, length) => direction === 'first' ? 0 : direction === 'last' ? length - 1 : Math.max(0, Math.min(length - 1, index + (direction === 'prev' ? -1 : 1)));
    const zoneName = ['rows','cols','filters'].find((zone) => previous[zone].includes(id));
    if (!zoneName && previous.values.some((value) => value.id === id)) {
      const list = [...previous.values]; const index = list.findIndex((value) => value.id === id);
      const [item] = list.splice(index, 1); list.splice(targetIndex(index, previous.values.length), 0, item);
      return {...previous, values:list};
    }
    if (!zoneName) return previous;
    const list = [...previous[zoneName]]; const index = list.indexOf(id);
    list.splice(index, 1); list.splice(targetIndex(index, previous[zoneName].length), 0, id);
    return {...previous,[zoneName]:list};
  }), []);

  const rawValuesByField = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, collectPivotOrderValues(rows,field.id,cleanText)])), [rows]);
  const valuesByField = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, [...rawValuesByField[field.id].keys()]])), [rawValuesByField]);
  const rawOrderValues = useCallback((value) => {
    const map = rawValuesByField[filterField?.id];
    return map?.has(value) ? map.get(value) : [rawFilterValue(value) ?? null];
  }, [rawValuesByField, filterField?.id]);
  const rawOrderValue = useCallback((value) => rawOrderValues(value)[0], [rawOrderValues]);
  const valueFilterStates = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, describePivotValueSelection(valuesByField[field.id] || [], selections[field.id], filterActive)])), [valuesByField, selections, filterActive]);
  const modelFieldFilters = useMemo(() => Object.fromEntries(Object.entries(selections).map(([id, selected]) => [id, (selected || []).map(rawFilterValue)])), [selections]);
  const linkedValues = useMemo(() => filterField ? pivotLinkedValues(rows, filterField.id, {fields:FIELDS,fieldFilters:modelFieldFilters,filterEnabled:filterActive}, cleanText) : [], [rows, filterField?.id, modelFieldFilters, filterActive]);
  const modelLayout = useMemo(() => normalizeLayout({ row:zones.rows, column:zones.cols, filter:zones.filters, data:zones.values.map((value) => value.id) }, FIELDS), [zones]);
  const summaryTypes = useMemo(() => Object.fromEntries(zones.values.map((value) => [value.id, value.aggregation])), [zones.values]);
  const dirty = successScope && (successScope.week !== week || successScope.countryFlower !== countryFlower);
  const calculationOptions = useMemo(() => ({fields:FIELDS,defaultLayout:ORDER_HISTORY_DEFAULT_LAYOUT,fieldFilters:modelFieldFilters,filterEnabled:filterActive,layout:modelLayout,sort:sorts,valueOrders,collapsedRows,collapsedColumns:collapsedCols,summaryTypes,blankZero:!zeroVisible,showRowTotals,showColumnTotals,showGrandTotals}), [modelFieldFilters,filterActive,modelLayout,sorts,valueOrders,collapsedRows,collapsedCols,summaryTypes,zeroVisible,showRowTotals,showColumnTotals,showGrandTotals]);
  const calculation = usePivotExeCalculation(rows, calculationOptions, Boolean(successScope) && layoutHydrated && !busy && !dirty && !error);
  const pivotModel = calculation.model;
  const structure = useMemo(() => buildPivotExeStructure(pivotModel, { includeBody: false }), [pivotModel]);
  const loadingVisible = busy || (!error && dirty) || calculation.visible;
  const loadingPercent = busy || dirty ? 0 : calculation.percent;
  const cancelLoading = () => { request.current.controller?.abort(); request.current.id += 1; clearTimeout(autoQueryTimer.current); setBusy(false); setError('조회를 취소했습니다. 새로고침으로 다시 조회할 수 있습니다.'); };

  const changeWidth = useCallback((id, startX, startWidth) => {
    const key = pivotResizePreferenceKey(id, zones.rows);
    cancelResize.current?.();
    const guide = document.createElement('div');
    guide.dataset.testid = 'pivot-exe-resize-preview';
    guide.setAttribute('aria-hidden', 'true');
    Object.assign(guide.style, {position:'fixed',top:'0',bottom:'0',left:'0',borderLeft:'2px solid #2563eb',pointerEvents:'none',zIndex:'10000',willChange:'transform'});
    const label = document.createElement('span');
    Object.assign(label.style, {position:'fixed',right:'16px',top:'12px',background:'#1558a6',color:'white',fontSize:'12px',padding:'5px 8px',borderRadius:'3px',pointerEvents:'none',zIndex:'10001'});
    document.body.append(guide, label);
    cancelResize.current = createPivotResizeSession({
      target: window, startX, startWidth,
      onPreview: (width, x) => { guide.style.transform = `translateX(${x}px)`; label.textContent = `${key === '__data' ? '가로 열 전체' : BY_ID[id]?.label || '열'} ${Math.round(width)}px · 놓으면 적용 · Esc 취소`; },
      onFinish: () => { guide.remove(); label.remove(); cancelResize.current = null; },
      onCommit: (width) => setWidths((previous) => withCollectivePivotWidth(previous, key, width)),
    });
  }, [zones.rows]);
  const bestFit = useCallback((id) => {
    const key = pivotResizePreferenceKey(id, zones.rows);
    const field = key === '__data' ? null : BY_ID[id];
    const header = field?.label || pivotModel.measures.map((measure) => BY_ID[measure.field]?.label || measure.field).join(' / ') || '데이터';
    const samples = field ? rows.slice(0, 500).map((row) => cleanText(row[id])) : pivotModel.cells.slice(0, 500).flatMap((cell) => pivotModel.measures.map((measure) => {
      const value = cell.values?.[measure.key];
      return value == null || (value === 0 && !zeroVisible) ? '' : Number(value).toLocaleString('ko-KR', {minimumFractionDigits:decimals,maximumFractionDigits:decimals});
    }));
    const chars = Math.max(header.length, ...samples.map((value) => String(value).length));
    const width = Math.min(400, Math.max(field ? 48 : 96, chars * 9 + 30));
    setWidths((previous) => withCollectivePivotWidth(previous, key, width));
  }, [rows, pivotModel, decimals, zeroVisible, zones.rows]);
  const exportVisible = useCallback(async () => {
    if (!successScope) return; setExporting(true);
    try {
      const { buildPivotExeWorkbook } = await import('../lib/pivotExeExport');
      const bytes = await buildPivotExeWorkbook(pivotModel, {sheetName:'발주 목록',decimalPlaces:decimals,blankZero:!zeroVisible,columnWidths:widths,rowHeight});
      const href = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link = document.createElement('a'); link.href = href; link.download = `발주 목록_${successScope.week}.xlsx`; link.click(); URL.revokeObjectURL(href);
    } catch (cause) { setError(`엑셀 생성 실패: ${cause.message}`); } finally { setExporting(false); }
  }, [successScope, pivotModel, decimals, zeroVisible, widths, rowHeight]);

  // exe FormHistory: 셀 더블클릭 → 해당 셀 원본 행 목록. 그리드 수정 없이 td data 속성으로 찾는다.
  const openDrillDown = useCallback((event) => {
    const cell = event.target?.closest?.('td[data-pivot-row-index]');
    if (!cell) return;
    const rowAxis = pivotModel.rowAxis[Number(cell.getAttribute('data-pivot-row-index'))];
    const columnAxis = structure.dataColumns[Number(cell.getAttribute('data-pivot-column-index'))]?.column;
    if (!rowAxis || !columnAxis) return;
    const describe = (axis, fields) => axis.isGrandTotal ? '총계' : axis.path.map((value, index) => `${BY_ID[fields[index]]?.label || fields[index]}: ${pivotExeValueLabel(value)}`).join(' / ');
    setDrill({ title: `${describe(rowAxis, pivotModel.layout.row)} × ${describe(columnAxis, pivotModel.layout.column)}`, rows: orderHistoryDrillRows(pivotModel, rowAxis, columnAxis) });
  }, [pivotModel, structure]);

  const openFieldMenu = useCallback((id, event) => { event.stopPropagation(); setFilterField(null); setFieldMenu({ id, anchor:event.currentTarget }); }, []);
  const openValueFilter = useCallback((id, event, anchor = event.currentTarget) => { event.stopPropagation(); setFieldMenu(null); setFilterField({ id, anchor }); }, []);
  const toggleRow = useCallback((key) => setCollapsedRows((previous) => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; }), []);
  const toggleColumn = useCallback((key) => setCollapsedCols((previous) => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; }), []);
  const dropField = (event, zone, index) => {
    event.preventDefault(); event.stopPropagation();
    const id = event.dataTransfer?.getData('application/x-nenova-pivot-field') || draggedField;
    if (BY_ID[id]) moveField(id, zone, index);
    setDraggedField(null); setDropTarget(null);
  };
  const applySort = useCallback((id, direction) => {
    setValueOrders((previous) => { const next = {...previous}; delete next[id]; return next; });
    setSorts((previous) => { const next = {...previous}; if (direction) next[id] = direction; else delete next[id]; return next; });
  }, []);
  const zoneArea = (zone, label, hint) => ({
    zone, label, emptyText: `여기에 필드를 놓으세요 (${hint})`,
    items: zones[zone], fieldsById: BY_ID, sorts, valueFilterStates, draggedField, dropTarget,
    onDragStart: (id, fromZone, index) => { setDraggedField(id); setDropTarget({zone:fromZone,index}); },
    onDragOverItem: (targetZone, index) => setDropTarget((previous) => previous?.zone === targetZone && previous.index === index ? previous : {zone:targetZone,index}),
    onDropZone: (targetZone, index, event) => dropField(event, targetZone, index),
    onDragEnd: () => { setDraggedField(null); setDropTarget(null); },
    onClickField: (id, event) => (zone === 'filters' ? openValueFilter : openFieldMenu)(id, event),
    onFilter: openValueFilter,
    onContextMenu: openFieldMenu,
    onSort: (id, direction) => applySort(id, direction),
  });
  const fieldAreas = {filters:zoneArea('filters','필터','표 전체'),rows:zoneArea('rows','세로 행','표 왼쪽'),cols:zoneArea('cols','가로 열','표 위쪽'),values:zoneArea('values','값','표 숫자')};
  const toggleDecimals = () => {
    if (decimals === 0) setDecimals(previousNonzeroDecimals || 2);
    else { setPreviousNonzeroDecimals(decimals); setDecimals(0); }
  };
  const resetLayout = () => {
    setZones(DEFAULT_ZONES); setHidden([]); setSelections({}); setFilterActive(true); setSorts({}); setValueOrders({});
    setWidths(DEFAULT_WIDTHS); setRowHeight(24); setDecimals(2); setPreviousNonzeroDecimals(2); setZeroVisible(false);
    setCollapsedRows(new Set()); setCollapsedCols(new Set()); setShowRowTotals(true); setShowColumnTotals(true); setShowGrandTotals(true);
  };
  const ready = calculation.ready && !calculation.error;

  if (!layoutHydrated) return <main data-testid="order-history-hydrating" role="status" style={{padding:12}}>사용자별 피벗 설정과 발주 목록을 불러오는 중…<PivotLoadingOverlay visible percent={0} /></main>;
  return <main style={{padding:'8px 12px 14px',minWidth:0}}>
    <PivotLoadingOverlay visible={loadingVisible} percent={loadingPercent} onCancel={loadingPercent<100?cancelLoading:undefined} />
    <div data-testid="order-history-toolbar" style={toolbarStyle}>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <label style={lookupLabel}>차수<select data-testid="order-history-week" value={week} onChange={(event)=>setWeek(event.target.value)} style={{...lookupStyle,minWidth:96}}>
          {!week && <option value="">차수</option>}
          {week && !weekOptions.includes(week) && <option value={week}>{week}</option>}
          {weekOptions.map((value)=><option key={value} value={value}>{value}</option>)}
        </select></label>
        <label style={lookupLabel}>품목<select data-testid="order-history-country-flower" value={countryFlower} onChange={(event)=>setCountryFlower(event.target.value)} style={{...lookupStyle,minWidth:160}}>
          <option value=""></option>
          {flowerOptions.map((value)=><option key={value} value={value}>{value}</option>)}
        </select></label>
        <span style={{fontSize:11,color:'#777'}}>nenova.exe FormOrderHistory · 읽기 전용</span>
      </div>
      <div style={{display:'flex',gap:4,alignItems:'stretch'}}>
        <button data-testid="order-history-refresh" type="button" style={bigButtonStyle} onClick={refresh} disabled={busy || !week}><span aria-hidden="true" style={bigIconStyle}>⟳</span>{busy ? '조회 중…' : '새로고침'}</button>
        <button data-testid="order-history-export" type="button" style={bigButtonStyle} onClick={exportVisible} disabled={!ready || calculation.pending || exporting}><span aria-hidden="true" style={bigIconStyle}>▦</span>{exporting ? '엑셀 생성…' : '엑셀'}</button>
        <button type="button" style={bigButtonStyle} onClick={()=>typeof window !== 'undefined' && window.close()}><span aria-hidden="true" style={bigIconStyle}>✕</span>닫기</button>
      </div>
    </div>
    <section data-testid="order-history-groupbox" style={groupBoxStyle}>
      <header style={groupTitleStyle}>≡ 발주 목록</header>
      <details data-testid="order-history-web-tools" open={webToolsOpen} onToggle={toggleWebTools} style={webToolsStyle}>
        <summary style={{cursor:'pointer',fontSize:12,color:'#333',padding:'3px 6px',userSelect:'none'}}>▸ 웹 추가 기능 <small style={{color:'#777'}}>소수점 · 0 표시 · 소계/총계 · 기본 배치 · 펼침/접기 · 필드 목록</small></summary>
        <div style={optionBarStyle}>
          <button data-testid="order-history-decimals-toggle" className="btn btn-sm" onClick={toggleDecimals}>{decimals === 0 ? '소수점 표시' : '소수점 숨기기'}</button>
          <label><input type="checkbox" checked={zeroVisible} onChange={(event)=>setZeroVisible(event.target.checked)} /> 0 표시</label>
          <label><input type="checkbox" checked={showRowTotals} onChange={(event)=>setShowRowTotals(event.target.checked)} /> 행 소계</label>
          <label><input type="checkbox" checked={showColumnTotals} onChange={(event)=>setShowColumnTotals(event.target.checked)} /> 열 소계</label>
          <label><input type="checkbox" checked={showGrandTotals} onChange={(event)=>setShowGrandTotals(event.target.checked)} /> 총계</label>
          <label><input type="checkbox" checked={filterActive} onChange={(event)=>setFilterActive(event.target.checked)} /> 필터 활성</label>
          <button data-testid="order-history-reset" className="btn btn-sm" onClick={resetLayout}>기본 배치 복원</button>
          {successScope && <><button className="btn btn-sm" onClick={()=>{setCollapsedRows(new Set());setCollapsedCols(new Set());}}>모두 펼침</button><button className="btn btn-sm" onClick={()=>{setCollapsedRows(getPivotExeGroupKeys(pivotModel,'row'));setCollapsedCols(getPivotExeGroupKeys(pivotModel,'column'));}}>모두 접기</button></>}
          <button data-testid="order-history-field-list" className="btn btn-sm" onClick={()=>setFieldList(true)}>필드 목록</button>
        </div>
      </details>
      {preferenceError && <div role="status" style={noticeError}>{preferenceError}</div>}
      {lookupError && <div style={noticeError}>{lookupError}</div>}
      {error && <div data-testid="order-history-error" role="alert" style={noticeError}>{error}</div>}
      {calculation.error && successScope && <div role="alert" style={noticeError}>{calculation.error} <button className="btn btn-sm" onClick={calculation.retry}>집계 다시 시도</button></div>}
      {zones.values.length === 0 && <div role="status" style={{fontSize:12,color:'#805500',padding:5}}>집계할 값이 없습니다. ‘변경수량’을 값 영역으로 옮기세요.</div>}
      {ready && <div data-testid="order-history-grid" onDoubleClick={openDrillDown} title="셀을 두 번 클릭하면 원본 발주 이력을 봅니다.">
        <PivotExeGrid model={pivotModel} zones={zones} decimals={decimals} zeroVisible={zeroVisible} widths={widths} rowHeight={rowHeight} onResize={changeWidth} onFieldMenu={openFieldMenu} onFilter={openValueFilter} onBestFit={bestFit} onToggleRow={toggleRow} onToggleColumn={toggleColumn} sorts={sorts} selections={selections} filterActive={filterActive} valueFilterStates={valueFilterStates} fieldAreas={fieldAreas} />
      </div>}
      {!ready && <div data-testid="order-history-field-areas-fallback" className={ExePivotTheme.area} style={{display:'grid',gap:2,padding:2,border:'1px solid #9d9d9d'}}>{['filters','values','cols','rows'].map((zone)=><ExePivotFieldArea key={zone} {...fieldAreas[zone]} />)}</div>}
      {successScope && <div style={{fontSize:11,color:dirty?'#9b4c00':'#667',padding:'3px 6px'}}>차수 {successScope.week}{successScope.countryFlower ? ` · ${successScope.countryFlower}` : ''} · 원본 {rows.length.toLocaleString()}행 · 필터 결과 {pivotModel.filteredRowCount.toLocaleString()}행{dirty ? ' — 조건 변경 조회 중' : ''}</div>}
    </section>
    {fieldMenu && <FieldMenu field={BY_ID[fieldMenu.id]} aggregation={zones.values.find((value)=>value.id===fieldMenu.id)?.aggregation} sort={sorts[fieldMenu.id]} popupRef={fieldMenuRef} position={fieldMenuPosition} onAggregation={(id,aggregation)=>setZones((previous)=>({...previous,values:previous.values.map((value)=>value.id===id?{...value,aggregation}:value)}))} onClose={closeFieldMenu} onMove={moveField} onHide={hideField} onSort={applySort} onBestFit={bestFit} onFilter={(id,event)=>openValueFilter(id,event,fieldMenu.anchor)} onReorder={reorder} />}
    {filterField && <FilterValueDialog key={filterField.id} field={BY_ID[filterField.id]} values={linkedValues} selected={selections[filterField.id]} valueOrder={valueOrders[filterField.id]} sort={sorts[filterField.id]} rawValue={rawOrderValue} rawValues={rawOrderValues} popupRef={valueFilterRef} position={valueFilterPosition} onClose={closeValueFilter} onClear={()=>{setSelections((previous)=>{const next={...previous}; delete next[filterField.id]; return next;});closeValueFilter();}} onApply={(accepted,order,direction)=>{setFilterActive(true);setSelections((previous)=>applyLinkedPivotSelection(previous,filterField.id,accepted,valuesByField[filterField.id] || []));setValueOrders((previous)=>{const next={...previous};if(order.length) next[filterField.id]=order;else delete next[filterField.id];return next;});setSorts((previous)=>{const next={...previous};if(direction) next[filterField.id]=direction;else delete next[filterField.id];return next;});closeValueFilter();}} />}
    {fieldList && <FieldList zones={zones} hidden={hidden} onClose={()=>setFieldList(false)} onMove={moveField} onHide={hideField} />}
    {drill && <DrillDownModal drill={drill} onClose={()=>setDrill(null)} />}
  </main>;
}

const groupBoxStyle={border:'1px solid #9d9d9d',background:'#fff',minWidth:0,marginTop:6};
const groupTitleStyle={padding:'3px 8px',background:'linear-gradient(to bottom,#f4f4f4,#dcdcdc)',borderBottom:'1px solid #9d9d9d',fontSize:12,fontWeight:700,color:'#1e1e1e'};
const toolbarStyle={display:'flex',gap:8,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',padding:'5px 8px',background:'#f0f0f0',border:'1px solid #c8c8c8'};
const lookupLabel={display:'inline-flex',alignItems:'center',gap:4,fontSize:12};
const lookupStyle={height:22,boxSizing:'border-box',padding:'0 4px',border:'1px solid #a7a7a7',background:'#FFF5E3',fontSize:12};
const bigButtonStyle={display:'inline-flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minWidth:64,height:44,padding:'2px 8px',border:'1px solid #a7a7a7',background:'linear-gradient(to bottom,#fdfdfd,#ececec)',color:'#1e1e1e',fontSize:12,cursor:'pointer'};
const bigIconStyle={fontSize:16,lineHeight:'18px'};
const webToolsStyle={borderBottom:'1px solid #c8c8c8',background:'#fafafa'};
const optionBarStyle={display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',fontSize:11,padding:'4px 6px 6px'};
const menuStyle={position:'fixed',zIndex:1000,width:260,padding:9,background:'#fff',border:'1px solid #93a5bb',boxShadow:'0 5px 18px #0003',borderRadius:4};
const valueFilterStyle={position:'fixed',zIndex:1000,width:360,maxWidth:'calc(100vw - 16px)',padding:9,background:'#fff',border:'1px solid #93a5bb',boxShadow:'0 5px 18px #0003',borderRadius:4};
const popupHeaderStyle={display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7,fontSize:12};
const menuGrid={display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,marginTop:7};
const overlayStyle={position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,.36)',display:'flex',alignItems:'center',justifyContent:'center',padding:12};
const modalStyle={background:'#fff',maxWidth:'calc(100vw - 24px)',maxHeight:'calc(100vh - 24px)',display:'flex',flexDirection:'column',boxShadow:'0 10px 35px #0005',borderRadius:5};
const modalHeader={display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#e7edf5',borderBottom:'1px solid #ccd6e3'};
const inputStyle={width:'100%',boxSizing:'border-box',padding:'6px 8px',border:'1px solid #b8c5d5',borderRadius:3};
const checkLine={display:'flex',gap:7,padding:'4px 8px',fontSize:12,borderBottom:'1px solid #f0f2f4'};
const drillHead={position:'sticky',top:0,background:'#e8e8e8',border:'1px solid #c8c8c8',padding:'3px 6px',textAlign:'left',whiteSpace:'nowrap'};
const drillCell={border:'1px solid #e1e1e1',padding:'2px 6px',whiteSpace:'nowrap'};
const noticeError={padding:'6px 9px',background:'#fff1f0',border:'1px solid #ffccc7',color:'#a8071a',fontSize:12,margin:5};
