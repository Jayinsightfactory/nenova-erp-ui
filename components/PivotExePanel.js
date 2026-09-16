import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWeek } from '../lib/useWeekInput';
import { EXE_FIELDS, assertPivotRenderLimit, buildPivotModel, filterRows, normalizeLayout } from '../lib/pivotExeModel';
import PivotExeGrid from './PivotExeGrid';
import { getPivotExeGroupKeys } from '../lib/pivotExePresentation';
import { normalizePivotExeRange } from '../lib/pivotExeRange';
import { normalizePivotExeView } from '../lib/pivotExeViewState';
import { collectPivotOrderValues, createPivotValueOrderComparator, movePivotValue } from '../lib/pivotExeValueOrder';
import PivotExeFavorites from './PivotExeFavorites';
import { applyPivotValueSelection, createPivotHeaderHeightResizeSession, createPivotPreferenceWriter, createPivotResizeSession, describePivotValueSelection, movePivotField, normalizeCollectivePivotWidths, pivotResizePreferenceKey, withCollectivePivotWidth } from '../lib/pivotExeInteraction';

// Native field ids match FormQuantityPivot.GetData; supplements use explicit web ids.
const FIELDS = EXE_FIELDS;
const BY_ID = Object.fromEntries(FIELDS.map((field) => [field.id, field]));
const SUMMARY_LABELS = {sum:'합계',avg:'평균',weightedavg:'수량가중평균',min:'최소',max:'최대',count:'개수'};
const DEFAULT_ZONES = { rows: ['CounName', 'FlowerName', 'ProdName'], cols: ['OrderYear', 'OrderWeek', 'ListType', 'CustName'], values: [{ id: 'Quantity', aggregation: 'sum' }], filters: ['CountryFlower', 'CustArea', 'CustOrderCode', 'ShipmentDtm', 'UPrice', 'TPrice', 'DistCost', 'ArrivalCost', 'OrderNo', 'CustDescr'] };
const EMPTY_AST = () => ({ kind: 'group', op: 'AND', children: [] });
const cleanText = (value) => value === null ? '(null)' : value === undefined ? '(undefined)' : value === '' ? '(빈값)' : String(value);
const rawFilterValue = (value) => value === '(null)' ? null : value === '(undefined)' ? undefined : value === '(빈값)' ? '' : value;
function normalizeWeek(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : value;
}
function currentRange() {
  const current = getCurrentWeek().split('-');
  return { fromYear: current[0], fromWeek: `${current[1]}-${current[2]}`, toYear: current[0], toWeek: `${current[1]}-${current[2]}` };
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
    const top = below + popupRect.height <= window.innerHeight - 8
      ? below
      : Math.max(8, anchorRect.top - popupRect.height - gap);
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
    {aggregation && <label style={{display:'block',fontSize:11,marginTop:7}}>집계 <select value={aggregation} onChange={(event)=>onAggregation(field.id,event.target.value)}>{field.numeric && <><option value="sum">합계</option><option value="avg">평균</option>{field.weightField && <option value="weightedavg">수량가중평균</option>}<option value="min">최소</option><option value="max">최대</option></>}<option value="count">개수</option></select></label>}
    <button style={{width:'100%',marginTop:5}} onClick={onClose}>닫기</button>
  </div>;
}

function FilterValueDialog({ field, values, selected, valueOrder, sort, rawValue, rawValues, popupRef, position, onApply, onClear, onClose }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(() => new Set(Array.isArray(selected) ? selected.filter((value) => values.includes(value)) : values));
  const [draftOrder, setDraftOrder] = useState(valueOrder || []);
  const [draftSort, setDraftSort] = useState(sort || null);
  const ordered = useMemo(() => {
    const compare = createPivotValueOrderComparator(draftOrder, draftSort || (draftOrder.length ? 'asc' : null));
    return [...values].sort((a,b) => compare(rawValue(a),rawValue(b)));
  }, [values,draftOrder,draftSort,rawValue]);
  const visible = ordered.filter((value) => cleanText(value).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const changeSort = (direction) => { setDraftSort(direction); setDraftOrder([]); };
  const moveValue = (value, offset) => {
    setDraftOrder(movePivotValue(ordered, ordered.indexOf(value), offset).flatMap(rawValues));
    setDraftSort(null);
  };
  const toggle = (value) => setDraft((previous) => { const next = new Set(previous); next.has(value) ? next.delete(value) : next.add(value); return next; });
  return <section ref={popupRef} data-testid="pivot-exe-value-filter" role="dialog" aria-label={`${field.label} 값 필터`} style={{...valueFilterStyle,...position,visibility:position?'visible':'hidden'}} onClick={(event) => event.stopPropagation()}>
    <div style={popupHeaderStyle}><b>{field.label}에서 표시할 값</b><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
    <div style={{fontSize:11,color:'#52647a',marginBottom:7}}>체크한 값과 지정한 순서를 피벗 행·열 및 엑셀에 적용합니다.</div>
    <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="값 검색" style={inputStyle} />
    <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',margin:'7px 0'}}><button onClick={() => setDraft(new Set(values))}>전체 선택</button><button onClick={() => setDraft(new Set())}>전체 해제</button>{search && <button onClick={() => setDraft(new Set(visible))}>검색 결과만 선택</button>}<span style={{fontSize:11,color:'#667'}}>선택 {draft.size}/{values.length}</span></div>
    <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center',margin:'7px 0'}} aria-label="값 나열 순서">
      <button type="button" onClick={()=>changeSort('asc')} aria-pressed={!draftOrder.length && draftSort==='asc'}>오름차순</button>
      <button type="button" onClick={()=>changeSort('desc')} aria-pressed={!draftOrder.length && draftSort==='desc'}>내림차순</button>
      <button type="button" onClick={()=>changeSort(null)}>순서 초기화</button>
      <small>{draftOrder.length ? '사용자 지정 순서' : draftSort==='desc' ? '내림차순' : draftSort==='asc' ? '오름차순' : '기본 순서'}</small>
    </div>
    <div style={{fontSize:11,color:'#52647a',marginBottom:5}}>{search ? '검색어를 지우면 ↑↓로 순서를 변경할 수 있습니다.' : '↑↓로 한 칸씩 이동 · 적용 전에는 기존 화면이 유지됩니다.'}</div>
    <div style={{maxHeight:'min(38vh,320px)',overflow:'auto',border:'1px solid #d6dce5'}}>{visible.length ? visible.map((value,index) => <div key={value} style={{...checkLine,alignItems:'center',gap:3}}>
      <label style={{display:'flex',alignItems:'center',gap:7,flex:1,minWidth:0,overflowWrap:'anywhere'}}><input type="checkbox" checked={draft.has(value)} onChange={() => toggle(value)} />{cleanText(value)}</label>
      <button type="button" style={{minWidth:26,minHeight:24}} aria-label={`${cleanText(value)} 위로`} disabled={Boolean(search)||index===0} onClick={()=>moveValue(value,-1)}>↑</button>
      <button type="button" style={{minWidth:26,minHeight:24}} aria-label={`${cleanText(value)} 아래로`} disabled={Boolean(search)||index===ordered.length-1} onClick={()=>moveValue(value,1)}>↓</button>
    </div>) : <div style={{padding:12,textAlign:'center',fontSize:12,color:'#7a8797'}}>검색 결과가 없습니다.</div>}</div>
    <div style={{display:'flex',justifyContent:'space-between',gap:7,marginTop:12}}><button type="button" onClick={onClear}>필터 초기화</button><span style={{display:'flex',gap:7}}><button type="button" onClick={onClose}>취소</button><button type="button" className="btn btn-primary" onClick={() => onApply([...draft],draftOrder,draftSort)}>선택·순서 적용</button></span></div>
  </section>;
}

function AstEditor({ ast, setAst }) {
  const update = (path, replacement) => setAst((previous) => replaceNode(previous, path, replacement));
  return <AstNode node={ast} path={[]} update={update} remove={null} />;
}
function replaceNode(node, path, replacement) {
  if (!path.length) return replacement;
  const [index, ...rest] = path;
  if (node.kind === 'not') return { ...node, child: replaceNode(node.child, rest, replacement) };
  return { ...node, children: node.children.map((child, i) => i === index ? replaceNode(child, rest, replacement) : child) };
}
function AstNode({ node, path, update, remove }) {
  const edit = (patch) => update(path, { ...node, ...patch });
  const addCondition = () => edit({ children: [...(node.children || []), { kind:'condition', field:'CustName', operator:'=', value:'' }] });
  const addGroup = (kind = 'group') => edit({ children: [...(node.children || []), kind === 'not' ? {kind:'not',child:{kind:'condition',field:'CustName',operator:'=',value:''}} : {kind:'group',op:'AND',children:[]} ] });
  if (node.kind === 'condition') return <div style={conditionStyle}>
    <select value={node.field} onChange={(event) => edit({field:event.target.value})}>{FIELDS.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select>
    <select value={node.operator} onChange={(event) => edit({operator:event.target.value})}>{[['=','='],['!=','≠'],['>','>'],['>=','≥'],['<','<'],['<=','≤'],['contains','포함'],['startsWith','시작'],['endsWith','끝'],['in','IN'],['notIn','NOT IN'],['between','범위'],['isNull','빈값'],['notNull','값 있음']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
    {!['isNull','notNull'].includes(node.operator) && <input value={node.value || ''} onChange={(event) => edit({value:event.target.value, values:event.target.value.split(',').map((value) => value.trim()).filter(Boolean)})} placeholder={node.operator.includes('in') ? '쉼표로 여러 값' : '값'} />}
    {node.operator === 'between' && <input value={node.value2 || ''} onChange={(event) => edit({value2:event.target.value})} placeholder="끝 값" />}
    {remove && <button onClick={remove}>삭제</button>}
  </div>;
  if (node.kind === 'not') return <div style={groupStyle}><div><b>NOT</b>{remove && <button onClick={remove}>삭제</button>}</div><AstNode node={node.child} path={[...path, 'child']} update={update} remove={null} /></div>;
  return <div style={groupStyle}>
    <div style={{display:'flex',gap:5,alignItems:'center'}}><select value={node.op} onChange={(event) => edit({op:event.target.value})}><option>AND</option><option>OR</option></select>{remove && <button onClick={remove}>그룹 삭제</button>}</div>
    {(node.children || []).map((child, index) => <AstNode key={index} node={child} path={[...path,index]} update={update} remove={() => edit({children:node.children.filter((_, childIndex) => childIndex !== index)})} />)}
    <div style={{display:'flex',gap:5}}><button onClick={addCondition}>+ 조건</button><button onClick={() => addGroup()}>+ 그룹</button><button onClick={() => addGroup('not')}>+ NOT</button></div>
  </div>;
}

function Modal({ title, children, onClose, width = 640 }) { return <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section role="dialog" aria-modal="true" style={{...modalStyle,width}}><header style={modalHeader}><b>{title}</b><button onClick={onClose}>×</button></header><div style={{padding:12,overflow:'auto'}}>{children}</div></section></div>; }
function ModalButtons({ onCancel, onApply, applyLabel = '적용' }) { return <div style={{display:'flex',justifyContent:'flex-end',gap:7,marginTop:12}}><button onClick={onCancel}>취소</button><button className="btn btn-primary" onClick={onApply}>{applyLabel}</button></div>; }

export default function PivotExePanel() {
  const [range, setRange] = useState({fromYear:'',fromWeek:'',toYear:'',toWeek:''});
  const [weeks, setWeeks] = useState([]);
  const [weeksError, setWeeksError] = useState('');
  const [rows, setRows] = useState([]);
  const [successRange, setSuccessRange] = useState(null);
  const [source, setSource] = useState('');
  const [sourceWarnings, setSourceWarnings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [hidden, setHidden] = useState([]);
  const [fieldMenu, setFieldMenu] = useState(null);
  const [fieldList, setFieldList] = useState(false);
  const [filterField, setFilterField] = useState(null);
  const [selections, setSelections] = useState({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterActive, setFilterActive] = useState(true);
  const [ast, setAst] = useState(EMPTY_AST);
  const [draftAst, setDraftAst] = useState(EMPTY_AST);
  const [decimals, setDecimals] = useState(2);
  const [previousNonzeroDecimals, setPreviousNonzeroDecimals] = useState(2);
  const [zeroVisible, setZeroVisible] = useState(false);
  const [showRowTotals, setShowRowTotals] = useState(true);
  const [showColumnTotals, setShowColumnTotals] = useState(true);
  const [showGrandTotals, setShowGrandTotals] = useState(true);
  const [collapsedRows, setCollapsedRows] = useState(new Set());
  const [collapsedCols, setCollapsedCols] = useState(new Set());
  const [widths, setWidths] = useState({});
  const [rowHeight, setRowHeight] = useState(24);
  const [custHeaderHeight, setCustHeaderHeight] = useState(24);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [preferenceKey, setPreferenceKey] = useState(null);
  const [preferenceError, setPreferenceError] = useState('');
  const [draggedField, setDraggedField] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [sorts, setSorts] = useState({});
  const [valueOrders, setValueOrders] = useState({});
  const [exporting, setExporting] = useState(false);
  const request = useRef({id:0,controller:null});
  const autoQueryTimer = useRef(null);
  const preferenceWriter = useRef(null);
  const cancelResize = useRef(null);
  const closeFieldMenu = useCallback(() => setFieldMenu(null), []);
  const closeValueFilter = useCallback(() => setFilterField(null), []);
  const [fieldMenuRef, fieldMenuPosition] = useAnchoredPopup(Boolean(fieldMenu), fieldMenu?.anchor, closeFieldMenu);
  const [valueFilterRef, valueFilterPosition] = useAnchoredPopup(Boolean(filterField), filterField?.anchor, closeValueFilter);
  const applyView = useCallback((input) => {
    const view = normalizePivotExeView(input);
    setZones(view.zones); setHidden(view.hidden); setDecimals(view.decimals);
    setPreviousNonzeroDecimals(view.previousNonzeroDecimals); setZeroVisible(view.zeroVisible);
    setWidths(normalizeCollectivePivotWidths(view.widths)); setRowHeight(view.rowHeight); setCustHeaderHeight(view.custHeaderHeight); setSorts(view.sorts);
    setValueOrders(view.valueOrders);
    setSelections(view.selections); setAst(view.ast); setFilterActive(view.filterActive);
    setShowRowTotals(view.showRowTotals); setShowColumnTotals(view.showColumnTotals); setShowGrandTotals(view.showGrandTotals);
    setCollapsedRows(new Set()); setCollapsedCols(new Set()); setFieldMenu(null); setFilterField(null);
  }, []);
  const currentView = useMemo(() => ({schemaVersion:1,zones,hidden,decimals,previousNonzeroDecimals,zeroVisible,widths,rowHeight,custHeaderHeight,sorts,valueOrders,selections,ast,filterActive,showRowTotals,showColumnTotals,showGrandTotals}), [zones,hidden,decimals,previousNonzeroDecimals,zeroVisible,widths,rowHeight,custHeaderHeight,sorts,valueOrders,selections,ast,filterActive,showRowTotals,showColumnTotals,showGrandTotals]);

  useEffect(() => {
    if (!fieldMenu && !filterField) return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (fieldMenuRef.current?.contains(target) || valueFilterRef.current?.contains(target)) return;
      if (fieldMenu?.anchor?.contains(target) || filterField?.anchor?.contains(target)) return;
      closeFieldMenu();
      closeValueFilter();
    };
    const closeEscape = (event) => {
      if (event.key === 'Escape') {
        closeFieldMenu();
        closeValueFilter();
      }
    };
    document.addEventListener('mousedown', closeOutside, true);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside, true);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [fieldMenu, filterField, fieldMenuRef, valueFilterRef, closeFieldMenu, closeValueFilter]);

  // Authenticate the owner before reading/writing local preferences; never migrate a shared key.
  useEffect(() => {
    setRange(currentRange());
    const controller = new AbortController();
    let alive = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch('/api/auth/me', {credentials:'include',cache:'no-store',signal:controller.signal})
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success || !payload.user?.userId) throw new Error('사용자 확인 실패');
        if (!alive) return;
        const key = `pivotExeLayout:v2:${encodeURIComponent(payload.user.userId)}`;
        try { const stored = localStorage.getItem(key); if (stored) applyView(JSON.parse(stored)); }
        catch { setPreferenceError('이전에 저장한 화면 설정을 불러오지 못했습니다. 기본 배치로 표시합니다.'); }
        setPreferenceKey(key);
      })
      .catch(() => { if (alive) setPreferenceError('사용자를 확인하지 못해 마지막 화면 자동 저장은 일시 중단했습니다.'); })
      .finally(() => { clearTimeout(timeout); if (alive) setLayoutHydrated(true); });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [applyView]);
  useEffect(() => {
    if (!layoutHydrated || !preferenceKey) return;
    const writer = createPivotPreferenceWriter({
      write: (view) => localStorage.setItem(preferenceKey, JSON.stringify(view)),
      onError: () => setPreferenceError('이 브라우저에서 마지막 화면을 저장할 수 없습니다. 즐겨찾기에 저장해 주세요.'),
    });
    preferenceWriter.current = writer;
    window.addEventListener('pagehide', writer.flush);
    return () => { window.removeEventListener('pagehide', writer.flush); writer.dispose(); preferenceWriter.current = null; };
  }, [layoutHydrated,preferenceKey]);
  useEffect(() => {
    if (layoutHydrated && preferenceKey) preferenceWriter.current?.schedule(currentView);
  }, [layoutHydrated,preferenceKey,currentView]);
  useEffect(() => () => cancelResize.current?.(), []);
  useEffect(() => () => request.current.controller?.abort(), []);
  useEffect(() => {
    if (!/^\d{4}$/.test(range.fromYear) || !/^\d{4}$/.test(range.toYear)) return undefined;
    const controller = new AbortController();
    let alive = true;
    fetch(`/api/stats/pivot-exe?${new URLSearchParams({mode:'weeks',fromYear:range.fromYear,toYear:range.toYear || range.fromYear})}`, {credentials:'include',signal:controller.signal})
      .then(async (response) => { const payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.error || '조회 가능 차수를 불러오지 못했습니다.'); return payload; })
      .then((payload) => { if (alive) { setWeeks(payload.weeks || []); setWeeksError(''); } })
      .catch((cause) => { if (alive && cause.name !== 'AbortError') setWeeksError(cause.message || '조회 가능 차수를 불러오지 못했습니다.'); });
    return () => { alive = false; controller.abort(); };
  }, [range.fromYear, range.toYear]);
  useEffect(() => { setCollapsedRows(new Set()); setCollapsedCols(new Set()); }, [zones]);

  const moveField = useCallback((id, target, targetIndex) => {
    const field = BY_ID[id]; if (!field || !['rows','cols','values','filters'].includes(target)) return;
    setZones((previous) => movePivotField(previous, id, target, targetIndex, field.defaultSummary || field.numeric));
    setHidden((previous) => previous.filter((item) => item !== id));
    setCollapsedRows(new Set()); setCollapsedCols(new Set());
  }, []);
  const hideField = useCallback((id) => { setZones((previous) => ({rows:previous.rows.filter((item)=>item!==id),cols:previous.cols.filter((item)=>item!==id),filters:previous.filters.filter((item)=>item!==id),values:previous.values.filter((item)=>item.id!==id)})); setHidden((previous) => previous.includes(id) ? previous : [...previous,id]); }, []);
  const reorder = useCallback((id, direction) => setZones((previous) => {
    const zoneName = ['rows','cols','filters'].find((zone) => previous[zone].includes(id));
    if (!zoneName && previous.values.some((value) => value.id === id)) {
      const list = [...previous.values]; const index = list.findIndex((value) => value.id === id); const target = direction === 'first' ? 0 : direction === 'last' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, index + (direction === 'prev' ? -1 : 1)));
      const [item] = list.splice(index, 1); list.splice(target, 0, item);
      return {...previous, values:list};
    }
    if (!zoneName) return previous;
    const list = [...previous[zoneName]]; const index = list.indexOf(id); const target = direction === 'first' ? 0 : direction === 'last' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, index + (direction === 'prev' ? -1 : 1)));
    list.splice(index, 1); list.splice(target, 0, id); return {...previous,[zoneName]:list};
  }), []);
  const refresh = useCallback(async () => {
    clearTimeout(autoQueryTimer.current);
    try { normalizePivotExeRange(range); } catch (cause) { setError(cause.message); return; }
    request.current.controller?.abort(); const controller = new AbortController(); const id = request.current.id + 1; request.current = {id,controller}; setBusy(true); setError('');
    try {
      const params = new URLSearchParams(range).toString();
      const response = await fetch(`/api/stats/pivot-exe?${params}`, {credentials:'include',signal:controller.signal});
      let payload;
      try { payload = await response.json(); } catch { throw new Error('서버 응답이 지연되거나 갱신 중입니다. 잠시 후 새로고침해 주세요.'); }
      if (!response.ok || !payload.success) throw new Error(payload.error || '전산 피벗을 불러오지 못했습니다.');
      if (request.current.id !== id) return;
      setRows(Array.isArray(payload.rows) ? payload.rows : []); setSuccessRange(payload.range || {...range}); setSource(payload.source || 'nenova.exe FormQuantityPivot'); setSourceWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
    } catch (cause) { if (cause.name !== 'AbortError' && request.current.id === id) setError(cause.message || '조회 실패'); }
    finally { if (request.current.id === id) setBusy(false); }
  }, [range]);

  // Scope changes fetch once after a short input debounce; field moves only recalculate locally.
  useEffect(() => {
    request.current.controller?.abort();
    request.current.id += 1;
    setBusy(false);
    if (!range.fromYear && !range.toYear) return undefined;
    try { normalizePivotExeRange(range); } catch (cause) { setError(cause.message); return undefined; }
    const timer = setTimeout(refresh, 350); autoQueryTimer.current = timer;
    return () => { clearTimeout(timer); request.current.controller?.abort(); request.current.id += 1; };
  }, [refresh,range]);

  const rawValuesByField = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, collectPivotOrderValues(rows,field.id,cleanText)])), [rows]);
  const valuesByField = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, [...rawValuesByField[field.id].keys()]])), [rawValuesByField]);
  const rawOrderValues = useCallback((value) => {
    const map = rawValuesByField[filterField?.id];
    return map?.has(value) ? map.get(value) : [rawFilterValue(value) ?? null];
  }, [rawValuesByField,filterField?.id]);
  const rawOrderValue = useCallback((value) => rawOrderValues(value)[0], [rawOrderValues]);
  const valueFilterStates = useMemo(() => Object.fromEntries(FIELDS.map((field) => [field.id, describePivotValueSelection(valuesByField[field.id] || [], selections[field.id], filterActive)])), [valuesByField,selections,filterActive]);
  // The UI only chooses controls; the shared pure model owns grouping, totals,
  // averages, collapse state, and the exportable visible result.
  const modelFieldFilters = useMemo(() => Object.fromEntries(Object.entries(selections).map(([id, selected]) => [id, (selected || []).map(rawFilterValue)])), [selections]);
  const selectedRows = useMemo(() => filterRows(rows, { fieldFilters:modelFieldFilters, filterTree:ast, filterEnabled:filterActive }), [rows,modelFieldFilters,ast,filterActive]);
  const modelLayout = useMemo(() => normalizeLayout({ row:zones.rows, column:zones.cols, filter:zones.filters, data:zones.values.map((value) => value.id) }), [zones]);
  const summaryTypes = useMemo(() => Object.fromEntries(zones.values.map((value) => [value.id, value.aggregation])), [zones.values]);
  const pivotModel = useMemo(() => buildPivotModel(selectedRows, { layout:modelLayout, sort:sorts, valueOrders, collapsedRows, collapsedColumns:collapsedCols, summaryTypes, blankZero:!zeroVisible, showRowTotals, showColumnTotals, showGrandTotals }), [selectedRows,modelLayout,sorts,valueOrders,collapsedRows,collapsedCols,summaryTypes,zeroVisible,showRowTotals,showColumnTotals,showGrandTotals]);
  const renderLimitError = useMemo(() => { try { assertPivotRenderLimit(pivotModel); return ''; } catch (cause) { return cause.message || '표시 가능한 셀 수를 초과했습니다.'; } }, [pivotModel]);
  const dirty = successRange && Object.keys(range).some((key) => range[key] !== successRange[key]);
  const updateRange = (key, value) => setRange((previous) => ({...previous,[key]:value}));
  const changeWidth = useCallback((id, startX, startWidth) => {
    const preferenceKey = pivotResizePreferenceKey(id, zones.rows);
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
      onPreview: (width, x) => { guide.style.transform = `translateX(${x}px)`; label.textContent = `${preferenceKey === '__data' ? '가로 열 전체' : BY_ID[id]?.label || '열'} ${Math.round(width)}px · 놓으면 적용 · Esc 취소`; },
      onFinish: () => { guide.remove(); label.remove(); cancelResize.current = null; },
      onCommit: (width) => setWidths((previous) => withCollectivePivotWidth(previous, preferenceKey, width)),
    });
  }, [zones.rows]);
  const changeCustHeaderHeight = useCallback((startY, startHeight) => {
    cancelResize.current?.();
    const guide = document.createElement('div');
    guide.dataset.testid = 'pivot-exe-header-height-preview';
    Object.assign(guide.style, {position:'fixed',left:'0',right:'0',top:'0',borderTop:'2px solid #2563eb',pointerEvents:'none',zIndex:'10000',willChange:'transform'});
    const label = document.createElement('span');
    Object.assign(label.style, {position:'fixed',right:'16px',top:'12px',background:'#1558a6',color:'white',fontSize:'12px',padding:'5px 8px',borderRadius:'3px',pointerEvents:'none',zIndex:'10001'});
    document.body.append(guide, label);
    cancelResize.current = createPivotHeaderHeightResizeSession({
      target:window, startY, startHeight,
      onPreview:(height,y)=>{ guide.style.transform=`translateY(${y}px)`; label.textContent=`거래처명/농장명 높이 ${Math.round(height)}px · 놓으면 적용 · Esc 취소`; },
      onFinish:()=>{ guide.remove(); label.remove(); cancelResize.current=null; },
      onCommit:(height)=>setCustHeaderHeight(height),
    });
  }, []);
  const bestFit = useCallback((id) => {
    const preferenceKey = pivotResizePreferenceKey(id, zones.rows);
    const field = preferenceKey === '__data' ? null : BY_ID[id];
    const header = field?.label || pivotModel.measures.map((measure) => BY_ID[measure.field]?.label || measure.field).join(' / ') || '데이터';
    const samples = field ? rows.slice(0, 500).map((row) => cleanText(row[id])) : pivotModel.cells.slice(0, 500).flatMap((cell) => pivotModel.measures.map((measure) => {
      const value = cell.values?.[measure.key];
      return value == null || (value === 0 && !zeroVisible) ? '' : Number(value).toLocaleString('ko-KR', {minimumFractionDigits:decimals,maximumFractionDigits:decimals});
    }));
    const chars = Math.max(header.length, ...samples.map((value) => String(value).length));
    const width = Math.min(400, Math.max(field ? 48 : 96, chars * 9 + 30));
    setWidths((previous) => withCollectivePivotWidth(previous, preferenceKey, width));
  }, [rows,pivotModel,decimals,zeroVisible,zones.rows]);
  const exportVisible = useCallback(async () => {
    if (!successRange) return; setExporting(true);
    try { const { buildPivotExeWorkbook } = await import('../lib/pivotExeExport'); const bytes = await buildPivotExeWorkbook(pivotModel, {sheetName:'전산 피벗',decimalPlaces:decimals,blankZero:!zeroVisible,columnWidths:widths,rowHeight}); const href = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); const link = document.createElement('a'); link.href=href; link.download=`전산피벗_${successRange.fromYear}_${successRange.fromWeek}-${successRange.toYear}_${successRange.toWeek}.xlsx`; link.click(); URL.revokeObjectURL(href); } catch (cause) { setError(`엑셀 생성 실패: ${cause.message}`); } finally { setExporting(false); }
  }, [successRange,pivotModel,decimals,zeroVisible,widths,rowHeight]);

  const openFieldMenu = useCallback((id, event) => {
    event.stopPropagation();
    setFilterField(null);
    setFieldMenu({ id, anchor:event.currentTarget });
  }, []);
  const openValueFilter = useCallback((id, event, anchor = event.currentTarget) => {
    event.stopPropagation();
    setFieldMenu(null);
    setFilterField({ id, anchor });
  }, []);
  const toggleRow = useCallback((key) => setCollapsedRows((previous) => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; }), []);
  const toggleColumn = useCallback((key) => setCollapsedCols((previous) => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; }), []);
  const dropField = (event, zone, index) => {
    event.preventDefault(); event.stopPropagation();
    const id = event.dataTransfer.getData('application/x-nenova-pivot-field') || draggedField;
    if (BY_ID[id]) moveField(id, zone, index);
    setDraggedField(null); setDropTarget(null);
  };
  const zoneChip = (id, zone, index) => {
    const filterState = valueFilterStates[id];
    const fieldLabel = zone === 'filters' ? `${BY_ID[id].label}: ${filterState.label}` : BY_ID[id].label;
    const openPrimary = zone === 'filters' ? openValueFilter : openFieldMenu;
    const insertionBefore = dropTarget?.zone === zone && dropTarget.index === index;
    return <span key={`${zone}-${id}`} style={{display:'inline-flex',alignItems:'stretch'}}>
      {insertionBefore && <i data-testid="pivot-exe-drop-marker" aria-hidden="true" style={dropMarkerStyle} />}
      <span
        data-testid={`pivot-exe-drag-${id}`}
        draggable
        onDragStart={(event)=>{event.dataTransfer.setData('application/x-nenova-pivot-field',id);event.dataTransfer.effectAllowed='move';setDraggedField(id);setDropTarget({zone,index});}}
        onDragOver={(event)=>{event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();const before=event.clientX < rect.left + rect.width / 2;setDropTarget({zone,index:index + (before ? 0 : 1)});event.dataTransfer.dropEffect='move';}}
        onDrop={(event)=>dropField(event,zone,dropTarget?.zone===zone ? dropTarget.index : index)}
        onDragEnd={()=>{setDraggedField(null);setDropTarget(null);}}
        title="필드 버튼을 잡아 원하는 영역이나 순서로 끌어 놓으세요"
        style={{...chipStyle,...(filterState.active ? filterChipContainerActive : null),cursor:draggedField===id?'grabbing':'grab',opacity:draggedField===id ? .55 : 1}}
      >
        <button draggable data-testid={`pivot-exe-field-${id}`} data-zone={zone} type="button" title={zone === 'filters' ? `${BY_ID[id].label} 값 선택: ${filterState.label}` : `${BY_ID[id].label} 설정`} onClick={(event) => openPrimary(id, event)}>{fieldLabel}{sorts[id] === 'asc' ? ' ▲' : sorts[id] === 'desc' ? ' ▼' : ''}</button>
        <button draggable={false} data-testid={`pivot-exe-filter-${id}`} type="button" title={`${BY_ID[id].label}에서 표시할 값${filterState.active ? `: ${filterState.label}` : ''}`} aria-label={`${BY_ID[id].label} 값 필터`} style={{...filterChipButton,...(filterState.active ? filterChipActive : null)}} onClick={(event) => openValueFilter(id, event)}>{filterState.active ? '●' : '▼'}</button>
        {zone === 'values' && <small style={{padding:'2px 4px',color:'#50627a'}}>{SUMMARY_LABELS[zones.values.find((value)=>value.id===id)?.aggregation] || zones.values.find((value)=>value.id===id)?.aggregation}</small>}
      </span>
    </span>;
  };
  const zoneArea = (zone,label,hint) => {
    const items = zones[zone];
    const insertionAtEnd = dropTarget?.zone === zone && dropTarget.index === items.length;
    return <section data-testid={`pivot-exe-zone-${zone}`} aria-label={`${label} 드롭 영역`} onDragEnter={(event)=>{event.preventDefault();if(event.target===event.currentTarget)setDropTarget({zone,index:items.length});}} onDragOver={(event)=>{event.preventDefault();event.dataTransfer.dropEffect='move';if(event.target===event.currentTarget)setDropTarget({zone,index:items.length});}} onDrop={(event)=>dropField(event,zone,dropTarget?.zone===zone?dropTarget.index:items.length)} style={{...zoneStyle,gridArea:zone,...(draggedField?zoneDraggingStyle:null),...(dropTarget?.zone===zone?zoneActiveStyle:null)}}><strong style={zoneLabelStyle}><span>{label}</span><small style={zoneHintStyle}>{hint}</small></strong><div style={{display:'flex',alignItems:'center',alignContent:'flex-start',flexWrap:'wrap',gap:2,minHeight:24,flex:1}}>{items.map((item,index)=>zoneChip(typeof item==='string'?item:item.id,zone,index))}{insertionAtEnd && <i data-testid="pivot-exe-drop-marker" aria-hidden="true" style={dropMarkerStyle} />}{items.length===0 && <small style={{color:'#6b7280'}}>여기에 필드 버튼을 놓으세요</small>}</div></section>;
  };
  const setWidth = (id, value, min = 48, max = 400) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const width = Math.max(min, Math.min(max, number));
    setWidths((previous) => previous[id] === width ? previous : { ...previous, [id]:width });
  };
  const changeDecimals = (next) => {
    const value = Number(next);
    if (![0,1,2].includes(value)) return;
    if (value > 0) setPreviousNonzeroDecimals(value);
    setDecimals(value);
  };
  const toggleDecimals = () => {
    if (decimals === 0) setDecimals(previousNonzeroDecimals || 2);
    else { setPreviousNonzeroDecimals(decimals); setDecimals(0); }
  };
  if (!layoutHydrated) return <main data-testid="pivot-exe-hydrating" role="status" style={{padding:12}}>사용자별 피벗 설정과 현재 차수 자료를 자동으로 불러오는 중…</main>;
  return <main style={{padding:'8px 12px 14px',minWidth:0}}>
    <div style={toolbarStyle}><b style={{fontSize:14}}>전산 피벗</b><span style={{fontSize:11,color:'#667'}}>nenova.exe FormQuantityPivot · 읽기 전용</span>
      <RangeSelect label="시작" year={range.fromYear} week={range.fromWeek} weeks={weeks} onYear={(value)=>updateRange('fromYear',value)} onWeek={(value)=>updateRange('fromWeek',value)} />
      <RangeSelect label="종료" year={range.toYear} week={range.toWeek} weeks={weeks} onYear={(value)=>updateRange('toYear',value)} onWeek={(value)=>updateRange('toWeek',value)} />
      <button data-testid="pivot-exe-refresh" className="btn btn-primary btn-sm" onClick={refresh} disabled={busy}>{busy ? '조회 중…' : '새로고침'}</button><button data-testid="pivot-exe-export" className="btn btn-sm" onClick={exportVisible} disabled={!successRange || exporting}>{exporting ? '엑셀 생성…' : '엑셀'}</button>
      <button data-testid="pivot-exe-field-list" className="btn btn-sm" onClick={()=>setFieldList(true)}>필드 목록</button><button data-testid="pivot-exe-filter-editor" className="btn btn-sm" onClick={()=>{setDraftAst(ast);setFilterOpen(true);}}>필터 편집</button><button className="btn btn-sm" onClick={()=>typeof window !== 'undefined' && window.close()}>닫기</button>
    </div>
    <div style={{fontSize:11,color:'#52647a',margin:'6px 0 3px'}}>nenova.exe처럼 <b>필드 버튼 전체를 마우스로 잡아</b> 아래 고정된 위치에 놓으세요. <b>행은 왼쪽, 열은 위쪽, 값은 숫자 영역</b>입니다. 파란 삽입선이 실제 위치를 표시하며 오른쪽 <b>▼</b>는 실제 값 필터입니다.</div>
    <div className="pivot-exe-config-grid">
      <div data-testid="pivot-exe-field-deck" aria-label="nenova.exe 방식 피벗 필드 배치판" style={fieldDeckStyle}>{zoneArea('filters','필터','표 전체')}{zoneArea('rows','세로 행','표 왼쪽')}{zoneArea('cols','가로 열','표 위쪽')}{zoneArea('values','값','표 숫자')}</div>
      <aside data-testid="pivot-exe-view-tools" className="pivot-exe-view-tools" aria-label="피벗 표시와 즐겨찾기 도구">
        <div style={optionBarStyle}><label><input type="checkbox" checked={filterActive} onChange={(event)=>setFilterActive(event.target.checked)} /> 필터 활성</label><button className="btn btn-sm" onClick={()=>{setAst(EMPTY_AST());setSelections({});}}>필터 지우기</button><button data-testid="pivot-exe-decimals-toggle" className="btn btn-sm" onClick={toggleDecimals}>{decimals === 0 ? '소수점 표시' : '소수점 숨기기'}</button><label><input type="checkbox" checked={zeroVisible} onChange={(event)=>setZeroVisible(event.target.checked)} /> 0 표시</label><button data-testid="pivot-exe-settings-toggle" className="btn btn-sm" onClick={()=>setSettingsOpen((previous)=>!previous)}>표시 설정</button><label><input type="checkbox" checked={showRowTotals} onChange={(event)=>setShowRowTotals(event.target.checked)} /> 행 소계</label><label><input type="checkbox" checked={showColumnTotals} onChange={(event)=>setShowColumnTotals(event.target.checked)} /> 열 소계</label><label><input type="checkbox" checked={showGrandTotals} onChange={(event)=>setShowGrandTotals(event.target.checked)} /> 총계</label></div>
        {settingsOpen && <div style={settingsStyle}><label>행 높이 <NumberSetting testId="pivot-exe-row-height" value={rowHeight} min={18} max={48} onCommit={(value)=>setRowHeight(Math.max(18,Math.min(48,value)))} /></label><label>거래처/농장 헤더 높이 <NumberSetting testId="pivot-exe-cust-header-height" value={custHeaderHeight} min={18} max={120} onCommit={(value)=>setCustHeaderHeight(Math.max(18,Math.min(120,value)))} /></label><label title="한 값을 바꾸면 모든 가로 데이터 열에 같은 너비가 적용됩니다.">가로 열 전체 너비 <NumberSetting testId="pivot-exe-data-width" value={widths.__data ?? 96} min={48} max={400} onCommit={(value)=>setWidths((previous)=>withCollectivePivotWidth(previous,'__data',value))} /></label><label>소수 자릿수 <select value={decimals} onChange={(event)=>changeDecimals(event.target.value)}><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>{zones.rows.map((id)=><label key={id}>{BY_ID[id].label} 너비 <NumberSetting testId={`pivot-exe-row-width-${id}`} value={widths[id] ?? ({CounName:90,FlowerName:90,ProdName:220}[id] || 120)} min={48} max={400} onCommit={(value)=>setWidth(id,value)} /></label>)}</div>}
        <div style={favoriteRowStyle}><button data-testid="pivot-exe-reset" className="btn btn-sm" onClick={()=>{setZones(DEFAULT_ZONES);setHidden([]);setSelections({});setAst(EMPTY_AST());setFilterActive(true);setSorts({});setValueOrders({});setWidths({});setRowHeight(24);setCustHeaderHeight(24);setDecimals(2);setPreviousNonzeroDecimals(2);setZeroVisible(false);setCollapsedRows(new Set());setCollapsedCols(new Set());setShowRowTotals(true);setShowColumnTotals(true);setShowGrandTotals(true);}}>기본 배치 복원</button><PivotExeFavorites view={currentView} onApply={applyView} disabled={!layoutHydrated || !preferenceKey} /></div>
      </aside>
    </div>
    {zones.values.length === 0 && <div role="status" style={{fontSize:12,color:'#805500',padding:5}}>집계할 값이 없습니다. ‘수량’ 또는 ‘입고총단가’를 값 영역으로 옮기세요.</div>}
    {preferenceError && <div role="status" style={noticeError}>{preferenceError}</div>}
    {weeksError && <div style={noticeError}>{weeksError}</div>}{error && <div data-testid="pivot-exe-error" role="alert" style={noticeError}>{error}</div>}
    {successRange ? <div data-testid="pivot-exe-load-status" style={{fontSize:11,marginBottom:6,color:dirty?'#9b4c00':'#276749'}}>마지막 성공 범위: {successRange.fromYear} {successRange.fromWeek} ~ {successRange.toYear} {successRange.toWeek} · {rows.length.toLocaleString()}행 {source && ` · ${source}`} {dirty && '— 변경 범위 조회 전까지 이전 결과를 표시합니다.'} · 배치 변경 시 즉시 재집계</div> : <div style={{fontSize:11,marginBottom:6,color:'#667'}}>선택한 연도·차수의 자료를 자동으로 불러옵니다.</div>}
    {sourceWarnings.length > 0 && <div data-testid="pivot-exe-source-warning" style={noticeError}>{sourceWarnings.join(' ')}</div>}
    <details style={{fontSize:11,marginBottom:6}}><summary>EXE 원본 수량 안내</summary>미발주 구분은 EXE처럼 <code>NoneOutQuantity &gt; 0</code>일 때의 <code>OutQuantity</code>를 표시합니다. 수량 의미를 웹에서 변경하지 않습니다.</details>
    {successRange && <div style={{display:'flex',gap:5,marginBottom:5}}><button data-testid="pivot-exe-expand-all" className="btn btn-sm" onClick={()=>{setCollapsedRows(new Set());setCollapsedCols(new Set());}}>모두 펼침</button><button data-testid="pivot-exe-collapse-all" className="btn btn-sm" onClick={()=>{setCollapsedRows(getPivotExeGroupKeys(pivotModel,'row'));setCollapsedCols(getPivotExeGroupKeys(pivotModel,'column'));}}>모두 접기</button><span style={{fontSize:11,color:'#667',paddingTop:4}}>표시 행 {pivotModel.rowAxis.length} / 필터 결과 {pivotModel.filteredRowCount}행</span></div>}
    {successRange && renderLimitError && <div style={noticeError}>{renderLimitError} 범위를 좁히거나 필터를 적용하세요. 데이터는 잘리지 않았습니다.</div>}
    {successRange && !renderLimitError && <PivotExeGrid model={pivotModel} zones={zones} decimals={decimals} zeroVisible={zeroVisible} widths={widths} rowHeight={rowHeight} custHeaderHeight={custHeaderHeight} onResize={changeWidth} onCustHeaderResize={changeCustHeaderHeight} onFieldMenu={openFieldMenu} onFilter={openValueFilter} onBestFit={bestFit} onToggleRow={toggleRow} onToggleColumn={toggleColumn} sorts={sorts} selections={selections} filterActive={filterActive} valueFilterStates={valueFilterStates} />}
    {fieldMenu && <FieldMenu field={BY_ID[fieldMenu.id]} aggregation={zones.values.find((value)=>value.id===fieldMenu.id)?.aggregation} sort={sorts[fieldMenu.id]} popupRef={fieldMenuRef} position={fieldMenuPosition} onAggregation={(id,aggregation)=>setZones((previous)=>({...previous,values:previous.values.map((value)=>value.id===id?{...value,aggregation}:value)}))} onClose={closeFieldMenu} onMove={moveField} onHide={hideField} onSort={(id,direction)=>{setValueOrders((previous)=>{const next={...previous};delete next[id];return next;});setSorts((previous)=>{const next={...previous}; if (direction) next[id]=direction; else delete next[id]; return next;});}} onBestFit={bestFit} onFilter={(id,event)=>openValueFilter(id,event,fieldMenu.anchor)} onReorder={reorder} />}
    {filterField && <FilterValueDialog key={filterField.id} field={BY_ID[filterField.id]} values={valuesByField[filterField.id] || []} selected={selections[filterField.id]} valueOrder={valueOrders[filterField.id]} sort={sorts[filterField.id]} rawValue={rawOrderValue} rawValues={rawOrderValues} popupRef={valueFilterRef} position={valueFilterPosition} onClose={closeValueFilter} onClear={()=>{setSelections((previous)=>{const next={...previous}; delete next[filterField.id]; return next;});closeValueFilter();}} onApply={(accepted,order,direction)=>{setSelections((previous)=>applyPivotValueSelection(previous,filterField.id,accepted,valuesByField[filterField.id] || []));setValueOrders((previous)=>{const next={...previous};if(order.length) next[filterField.id]=order;else delete next[filterField.id];return next;});setSorts((previous)=>{const next={...previous};if(direction) next[filterField.id]=direction;else delete next[filterField.id];return next;});closeValueFilter();}} />}
    {fieldList && <FieldList zones={zones} hidden={hidden} onClose={()=>setFieldList(false)} onMove={moveField} onHide={hideField} />}
    {filterOpen && <Modal title="전체 필터 편집" onClose={()=>setFilterOpen(false)} width={760}><p style={{marginTop:0,fontSize:11,color:'#667'}}>AND / OR / NOT 조건을 안전한 데이터 비교로 적용합니다. 코드나 SQL은 실행하지 않습니다.</p><AstEditor ast={draftAst} setAst={setDraftAst} /><ModalButtons onCancel={()=>setFilterOpen(false)} onApply={()=>{setAst(draftAst);setFilterOpen(false);}} /></Modal>}
    <style jsx>{`
      .pivot-exe-config-grid { display:grid; grid-template-columns:minmax(720px,1.55fr) minmax(560px,1fr); gap:6px; align-items:stretch; margin-bottom:4px; }
      .pivot-exe-view-tools { min-width:0; padding:5px 6px; border:1px solid #c2cedb; background:#f6f8fb; display:flex; flex-direction:column; gap:5px; }
      @media (max-width: 1450px) { .pivot-exe-config-grid { grid-template-columns:1fr; } }
    `}</style>
  </main>;
}

function RangeSelect({ label, year, week, weeks, onYear, onWeek }) { const relevant = weeks.filter((item)=>!year || String(item.OrderYear) === String(year)); return <label style={{display:'inline-flex',alignItems:'center',gap:3,fontSize:11}}>{label}<input value={year} onChange={(event)=>onYear(event.target.value.replace(/\D/g,'').slice(0,4))} placeholder="연도" style={{width:48}} /><select value={week} onChange={(event)=>onWeek(event.target.value)}><option value="">차수</option>{week && !relevant.some((item)=>(item.OrderWeek || normalizeWeek(item.OrderYearWeek))===week) && <option value={week}>{year} {week}</option>}{relevant.map((item)=>{const value=item.OrderWeek || normalizeWeek(item.OrderYearWeek);return <option key={`${item.OrderYear}-${value}`} value={value}>{item.OrderYear} {value}</option>;})}</select></label>; }
function NumberSetting({ testId, value, min, max, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (Number.isFinite(number)) {
      const normalized = Math.max(min, Math.min(max, number));
      setDraft(String(normalized));
      onCommit(normalized);
    }
    else setDraft(String(value));
  };
  return <input data-testid={testId} type="number" min={min} max={max} value={draft} style={{width:60}} onChange={(event)=>setDraft(event.target.value)} onBlur={commit} onKeyDown={(event)=>{if(event.key==='Enter') event.currentTarget.blur();}} />;
}
function FieldList({ zones,hidden,onClose,onMove,onHide }) { const [search,setSearch]=useState(''); const findZone=(id)=>hidden.includes(id)?'hidden':['rows','cols','values','filters'].find((zone)=>zones[zone].some((item)=>typeof item==='string'?item===id:item.id===id)) || 'hidden'; return <Modal title="필드 목록" onClose={onClose} width={620}><p style={{margin:'0 0 7px',fontSize:11,color:'#5f6f82'}}>각 필드의 표시 위치를 세로 행·가로 열·값·필터 중에서 바로 선택하세요.</p><input autoFocus value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="필드 검색" style={inputStyle}/><div style={{maxHeight:'55vh',overflow:'auto'}}>{FIELDS.filter((field)=>field.label.includes(search)||field.id.toLowerCase().includes(search.toLowerCase())).map((field)=>{const zone=findZone(field.id);return <div key={field.id} style={{display:'grid',gridTemplateColumns:'1fr 130px 55px',gap:5,alignItems:'center',padding:'5px 0',borderBottom:'1px solid #eef1f5'}}><label><input type="checkbox" checked={zone!=='hidden'} onChange={(event)=>event.target.checked?onMove(field.id,'filters'):onHide(field.id)}/>{field.label} <small style={{color:'#778'}}>({field.id})</small></label><select aria-label={`${field.label} 표시 위치`} value={zone} onChange={(event)=>event.target.value==='hidden'?onHide(field.id):onMove(field.id,event.target.value)}><option value="hidden">숨김</option><option value="rows">세로 행</option><option value="cols">가로 열</option><option value="filters">필터</option><option value="values">값 {field.numeric ? '' : '(개수)'}</option></select><button onClick={()=>onHide(field.id)}>숨김</button></div>})}</div><ModalButtons onCancel={onClose} onApply={onClose} applyLabel="완료" /></Modal>; }

const toolbarStyle={display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',padding:'7px 8px',background:'#edf2f7',border:'1px solid #d8e0ea'};
const fieldDeckStyle={display:'grid',gridTemplateColumns:'minmax(260px,0.75fr) minmax(620px,2.25fr)',gridTemplateAreas:'"filters filters" "rows cols" "rows values"',gridTemplateRows:'auto auto minmax(40px,auto)',gap:3,padding:3,marginBottom:3,border:'1px solid #8393a6',background:'#cfd7e1'};
const zoneStyle={display:'flex',alignItems:'flex-start',gap:5,minHeight:38,minWidth:0,padding:'4px 5px',border:'1px solid #9eacbc',background:'#f2f5f8'};
const zoneDraggingStyle={borderStyle:'dashed',borderColor:'#6d8fb5'};
const zoneActiveStyle={background:'#e5f0ff',border:'2px solid #1f6dcc',padding:'2px 3px'};
const zoneLabelStyle={display:'flex',flexDirection:'column',flex:'0 0 64px',padding:'3px 3px',fontSize:11,color:'#24384e',lineHeight:1.15};
const zoneHintStyle={marginTop:3,fontSize:9,fontWeight:400,color:'#718096',whiteSpace:'nowrap'};
const chipStyle={display:'inline-flex',alignItems:'center',border:'1px solid #8798ab',borderRadius:2,background:'linear-gradient(#fff,#e8edf2)',boxShadow:'0 1px 0 rgba(255,255,255,.8) inset',userSelect:'none'};
const dropMarkerStyle={display:'inline-block',alignSelf:'stretch',minHeight:24,width:3,margin:'0 1px',borderRadius:2,background:'#1266d3',boxShadow:'0 0 0 1px #fff'};
const filterChipButton={border:0,borderLeft:'1px solid #d5dfe9',background:'#f4f7fb',color:'#54708e',cursor:'pointer',fontSize:10,lineHeight:'18px',padding:'0 4px'};
const filterChipActive={background:'#dcecff',color:'#1558a6'};
const filterChipContainerActive={borderColor:'#2f6fb5',background:'#eaf3ff',boxShadow:'0 0 0 1px #b7d4f3 inset'};
const optionBarStyle={display:'flex',justifyContent:'flex-start',gap:5,alignItems:'center',flexWrap:'wrap',fontSize:11};
const settingsStyle={display:'flex',gap:7,flexWrap:'wrap',alignItems:'center',padding:'5px 6px',background:'#fff',border:'1px solid #d8e0ea',fontSize:11};
const favoriteRowStyle={display:'flex',gap:5,alignItems:'flex-start',flexWrap:'wrap'};
const menuStyle={position:'fixed',zIndex:1000,width:260,padding:9,background:'#fff',border:'1px solid #93a5bb',boxShadow:'0 5px 18px #0003',borderRadius:4};
const valueFilterStyle={position:'fixed',zIndex:1000,width:360,maxWidth:'calc(100vw - 16px)',padding:9,background:'#fff',border:'1px solid #93a5bb',boxShadow:'0 5px 18px #0003',borderRadius:4};
const popupHeaderStyle={display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7,fontSize:12};
const menuGrid={display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,marginTop:7};
const overlayStyle={position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,.36)',display:'flex',alignItems:'center',justifyContent:'center',padding:12};
const modalStyle={background:'#fff',maxWidth:'calc(100vw - 24px)',maxHeight:'calc(100vh - 24px)',display:'flex',flexDirection:'column',boxShadow:'0 10px 35px #0005',borderRadius:5};
const modalHeader={display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#e7edf5',borderBottom:'1px solid #ccd6e3'};
const inputStyle={width:'100%',boxSizing:'border-box',padding:'6px 8px',border:'1px solid #b8c5d5',borderRadius:3};
const checkLine={display:'flex',gap:7,padding:'4px 8px',fontSize:12,borderBottom:'1px solid #f0f2f4'};
const groupStyle={border:'1px solid #d5dde8',padding:8,margin:'7px 0',background:'#f8fafc',display:'grid',gap:6};
const conditionStyle={display:'flex',gap:5,alignItems:'center',flexWrap:'wrap',padding:6,background:'#fff',border:'1px solid #e1e6ed'};
const noticeError={padding:'6px 9px',background:'#fff1f0',border:'1px solid #ffccc7',color:'#a8071a',fontSize:12,marginBottom:5};
