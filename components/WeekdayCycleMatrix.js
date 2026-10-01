import { Fragment, useMemo, useRef, useState } from 'react';
import { buildHorizontalWeekdayMatrix, horizontalCycleKey, horizontalEditPayload,
  horizontalPrintReason, validateHorizontalQuantity, hasHorizontalShipmentQuantity } from '../lib/weekdayHorizontalMatrix.js';
import { horizontalCycleColumns, weekdayQuantityLabel, weekdayProductLabel } from '../lib/weekdayHorizontalMatrix.js';
import { reconcileWeekdayQuote } from '../lib/weekdayQuoteReconciliation.js';

const numberLabel = (value) => value == null || !Number.isFinite(Number(value))
  ? '미확인' : String(Number(value));
const cycleKey = horizontalCycleKey;
const cycleLabel = (cycle) => `${cycle.year ?? '연도 미확인'} / ${cycle.majorWeek ?? '차수 미확인'}차`;
const sourceLabel = (plan) => plan.sourceOrderWeek
  ? `${plan.sourceYear ?? '연도 미확인'}/${plan.sourceOrderWeek}` : '입고 원천 미지정';

const cellDescription = (row, block, day) => [
  `${row.name} · ${block.cycle.year}/${day.effectiveOrderWeek ?? '?'} · ${day.date}`,
  `전산 ${numberLabel(day.current)} / 미적용 초안 ${numberLabel(day.planned)} / 차이 ${numberLabel(day.delta)} ${day.unit ?? ''}`,
  ...day.actualDetails.map((item) => `전산 원문 ${item.orderWeek}: ${numberLabel(item.shipmentQuantity)} ${item.unit || '단위 미확인'}`),
  ...day.drafts.map((plan) => `초안 ${plan.id}: ${numberLabel(plan.quantity)} ${plan.unit || '단위 미확인'} · ${sourceLabel(plan)}`),
  day.assignedWeekMismatch ? `실제 ${day.actualOrderWeeks.join(', ')} / 달력 권장 ${day.orderWeek}` : '',
  block.fixed ? '확정 전산 포함 · 편집은 미적용 초안만' : '', day.editDisabledReason,
].filter(Boolean).join('\n');

function QuantityCell({ day, row, block, disabled, onEditCell, onSelect, onOpenNote }) {
  const [input, setInput] = useState(null);
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const lastSubmitted = useRef(null);
  const visibleQuantity = day.planned ?? day.displayCurrent ?? day.current;
  const value = input ?? (visibleQuantity == null ? '' : String(visibleQuantity));
  const reason = day.editDisabledReason || (typeof onEditCell !== 'function' ? '초안 편집 기능 미연결' : '');
  const description = cellDescription(row, block, day);
  async function commit() {
    if (input === null || disabled || reason || lock.current) return;
    const validated = validateHorizontalQuantity(input);
    if (validated.state === 'UNCHANGED') { setInput(null); setFailure(''); return; }
    if (validated.state === 'INVALID') { setFailure(validated.error); return; }
    if (validated.quantity === visibleQuantity || validated.quantity === lastSubmitted.current) {
      setInput(null); setFailure(''); return;
    }
    lock.current = true;
    setSaving(true);
    setFailure('');
    try {
      const result = await onEditCell(horizontalEditPayload(row, block, day, input));
      if (result === false || result?.success === false || result?.error) throw new Error(result?.error || '초안 편집 실패');
      lastSubmitted.current = validated.quantity;
      setInput(null);
    } catch (error) { setFailure(error?.message || '초안 편집 실패 · 입력값 유지'); }
    finally { lock.current = false; setSaving(false); }
  }
  const changed = day.initialDelta != null && day.initialDelta !== 0;
  const early=block.pageNote?.earlyShipment?.date===day.date?block.pageNote.earlyShipment:null;
  const earlyNeedsReview=early && (early.unit!==day.unit || day.displayCurrent==null || early.quantity>day.displayCurrent);
  return <div className={`wcm-cell${day.planned != null ? ' wcm-proposed' : ''}${changed?' wcm-changed':''}${early?' wcm-early':''}`} title={`${description}\n최초 ${numberLabel(day.initial)}${early?`\n수동확인 ${early.sourceYear}/${early.sourceOrderWeek}차 선출고 ${early.quantity} ${early.unit}`:''}${reason ? `\n${reason}` : ''}`}>
    <span className="wcm-number-display" aria-hidden="true">{weekdayQuantityLabel(visibleQuantity,row,day.unit)}</span>
    <input type="text" inputMode="decimal" value={value} placeholder="—" disabled={disabled || saving || Boolean(reason)}
      aria-label={`${row.name} ${block.cycle.year}/${day.effectiveOrderWeek} ${day.date} 미적용 초안 수량`}
      aria-invalid={Boolean(failure)} onFocus={() => onSelect(description)} onBlur={commit}
      onChange={(event) => {
        setInput(event.target.value); lastSubmitted.current = null;
        const check = validateHorizontalQuantity(event.target.value);
        setFailure(check.state === 'INVALID' ? check.error : '');
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { setInput(null); setFailure(''); }
      }} />
    <div className="wcm-cell-detail">{changed && <small className="wcm-original">({weekdayQuantityLabel(day.initial,row,day.unit)})</small>}
    {(day.delta != null && day.delta !== 0 || reason) && <button type="button" className="wcm-cell-info"
      aria-label={`${row.name} ${day.date} 수량 내역`} onClick={() => onSelect(`${description}\n${reason}`)}>
      {day.delta != null && day.delta !== 0 ? `Δ${day.delta > 0 ? '+' : ''}${numberLabel(day.delta)}` : '!'}</button>}</div>
    {failure && <span className="wcm-cell-error" role="alert">{failure}</span>}
    {early && <button type="button" className="wcm-early-label" aria-label={`${row.name} ${day.date} 선출고 비고`} onClick={()=>onOpenNote?.({row,block})}>{early.sourceOrderWeek.slice(0,2)}차 선출고 {weekdayQuantityLabel(early.quantity,row,early.unit)}{earlyNeedsReview?' · 재확인':''}</button>}
  </div>;
}

function PrintButton({ label, reason, onClick, className = '', visibleLabel = label }) {
  return <span title={reason || 'ERP 저장된 확정 견적만 출력 · 미적용 초안 제외'}>
    <button type="button" className={className} disabled={Boolean(reason)} aria-label={label}
      onClick={onClick}>{visibleLabel}</button>
  </span>;
}

export default function WeekdayCycleMatrix({ cycles = [], plans = [], comparisonRows = [], onMove, busy = false,
  onEditCell, onPrint, printBusy = false, customer = null, custKey = null, customerProvided,
  onSearchProducts, onAddProduct, baselines = [], baselineCandidates = [], onConfirmBaseline, baselineBusy = false, onOpenNote, pageNotes = [], quoteResults = [] }) {
  const safeCycles = Array.isArray(cycles) ? cycles : [];
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeComparisons = Array.isArray(comparisonRows) ? comparisonRows : [];
  const [search, setSearch] = useState('');
  const [flower, setFlower] = useState('');
  const [addedKeys, setAddedKeys] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addCandidates, setAddCandidates] = useState([]);
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const addRequest = useRef(0);
  const addLock = useRef(false);
  const [selectedDates, setSelectedDates] = useState({});
  const [selectedInfo, setSelectedInfo] = useState('');
  const [printError, setPrintError] = useState('');
  const [printing, setPrinting] = useState(false);
  const printLock = useRef(false);
  const tableScroll = useRef(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [form, setForm] = useState({ id: '', quantity: '', date: '', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const submitLock = useRef(false);
  const pendingEventId = useRef(null);
  const disabled = busy || moving;
  const matrix = useMemo(() => buildHorizontalWeekdayMatrix(safeCycles, safePlans, safeComparisons,baselines,baselineCandidates), [cycles, plans, comparisonRows,baselines,baselineCandidates]);
  for(const row of matrix.rows)for(const block of row.blocks) {
    block.pageNote=pageNotes.find(note=>Number(note.year)===Number(block.cycle.year)&&String(note.majorWeek)===String(block.cycle.majorWeek)&&Number(note.prodKey)===row.prodKey);
    block.quote=reconcileWeekdayQuote(block,row.prodKey,quoteResults.find(result=>Number(result.year)===Number(block.cycle.year)&&String(result.majorWeek)===String(block.cycle.majorWeek)));
  }
  const hasCustomer = customerProvided ?? (Number(customer?.CustKey ?? customer?.custKey ?? custKey) > 0);
  const printReason = (cycle, dates, mode) => busy ? '전산 조회/처리 중' : horizontalPrintReason({ cycle, dates, mode, onPrint,
    customerProvided: hasCustomer, printBusy: printBusy || printing });
  const shipmentRows = matrix.rows.filter((row) => hasHorizontalShipmentQuantity(row) || addedKeys.includes(row.prodKey));
  const flowers = [...new Set(shipmentRows.flatMap((row) => row.flowerNames))].sort();
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = shipmentRows.filter((row) => (!flower || row.flowerNames.includes(flower))
    && (!query || `${row.prodKey} ${row.name} ${row.flowerNames.join(' ')}`.toLocaleLowerCase().includes(query)));
  const validDestinations = safeCycles.filter((cycle) => cycle.calendarState === 'FOUND')
    .flatMap((cycle) => cycle.days.filter((day) => day.calendarState === 'FOUND')
      .map((day) => ({ cycle, day })));
  const selectedPlan = safePlans.find((plan) => String(plan.id) === form.id);
  const { outsidePlans, outsideComparisons } = matrix;
  const diagnostics = matrix.rows.flatMap((row) => row.blocks.map((block) => ({ row, block })))
    .filter(({ block }) => block.outside.length || block.outsideDrafts.length || block.unitState !== 'MATCHED'
      && (block.productActuals.length || block.productPlans.length) || block.days.some((day) => day.assignedWeekMismatch || day.drafts.length > 1));

  function openAdd() {
    addRequest.current += 1; setAddOpen(true); setAddQuery(''); setAddError('');
    setAddCandidates(matrix.rows.filter((row) => !shipmentRows.includes(row)).slice(0, 20)
      .map((row) => ({ ProdKey:row.prodKey, ProdName:row.name, FlowerName:row.flowerNames.join(' / ') })));
  }
  async function searchAdd() {
    const query = addQuery.trim();
    if (!query) { openAdd(); return; }
    const request = ++addRequest.current; setAdding(true); setAddError('');
    try {
      if (typeof onSearchProducts !== 'function') throw new Error('품목 검색 기능 미연결');
      const candidates = await onSearchProducts(query);
      if (request !== addRequest.current) return;
      setAddCandidates((Array.isArray(candidates) ? candidates : []).slice(0,20));
      if (!candidates?.length) setAddError('검색된 품목이 없습니다.');
    } catch (failure) { if (request === addRequest.current) {setAddCandidates([]); setAddError(failure.message || '품목 검색 실패');} }
    finally { if (request === addRequest.current) setAdding(false); }
  }
  async function addProduct(product) {
    if (addLock.current || disabled || adding) return;
    const key = Number(product.ProdKey);
    if (!Number.isInteger(key) || key <= 0) {setAddError('품목키를 확인하세요.');return;}
    addLock.current=true; setAdding(true); setAddError('');
    try {
      if (typeof onAddProduct !== 'function') throw new Error('품목 추가 기능 미연결');
      const result = await onAddProduct(product);
      if (result === false || result?.success === false || result?.error) throw new Error(result?.error || '품목 추가 조회 실패');
      setAddedKeys((current) => [...new Set([...current,key])]);
      setSearch('');setFlower('');setAddOpen(false);
    } catch (failure) {setAddError(failure.message || '품목 추가 실패');}
    finally {addLock.current=false;setAdding(false);}
  }

  async function print(cycle, dates, mode) {
    if (printReason(cycle, dates, mode) || printLock.current) return;
    printLock.current = true;
    setPrinting(true); setPrintError('');
    try {
      const result = await onPrint({ cycle, dates, mode });
      if (result === false || result?.success === false || result?.error) throw new Error(result?.error || '견적 출력 실패');
    } catch (failure) { setPrintError(failure?.message || '견적 출력에 실패했습니다.'); }
    finally { printLock.current = false; setPrinting(false); }
  }

  function updateForm(field, value) {
    pendingEventId.current = null;
    setForm((previous) => ({ ...previous, [field]: value }));
    setMessage('');
  }

  function openMove() {
    setMoveOpen(true);
    if (!form.id && safePlans.length) setForm((previous) => ({ ...previous, id: String(safePlans[0].id) }));
  }

  async function submitMove(event) {
    event.preventDefault();
    if (disabled || submitLock.current) return;
    setError('');
    setMessage('');
    const plan = safePlans.find((item) => String(item.id) === form.id);
    const quantity = Number(form.quantity);
    const destination = validDestinations.find(({ day }) => day.date === form.date);
    if (!plan) { setError('이동할 초안을 선택하세요. 선택한 초안이 변경되었으면 다시 선택하세요.'); return; }
    if (!form.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(Number(plan.quantity)) || quantity > Number(plan.quantity)) {
      setError(`이동수량은 0보다 크고 현재 초안수량 ${numberLabel(plan.quantity)} 이하이어야 합니다.`); return;
    }
    if (!destination || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      setError('확인된 전산 달력에서 이동할 날짜를 선택하세요.'); return;
    }
    const parsedDate = new Date(`${form.date}T00:00:00Z`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== form.date) {
      setError('실제로 존재하는 출고일을 선택하세요.'); return;
    }
    if (!form.reason.trim()) { setError('변경 사유를 입력하세요.'); return; }
    if (plan.date === form.date && Number(plan.year) === destination.cycle.year
      && plan.orderWeek === destination.day.orderWeek) { setError('현재와 다른 출고일 또는 차수를 선택하세요.'); return; }
    if (typeof onMove !== 'function') { setError('초안 이동 기능이 아직 연결되지 않았습니다. 입력값은 유지됩니다.'); return; }
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
      setError('이동 ID를 생성할 수 없습니다. 보안 브라우저 환경을 확인하세요. 입력값은 유지됩니다.'); return;
    }
    submitLock.current = true;
    setMoving(true);
    try {
      if (!pendingEventId.current) pendingEventId.current = crypto.randomUUID();
      const result = await onMove({ id: plan.id, quantity, date: form.date,
        reason: form.reason.trim(), eventId: pendingEventId.current });
      if (result === false || result?.success === false || result?.error) {
        throw new Error(result?.error || '초안 이동을 완료하지 못했습니다.');
      }
      pendingEventId.current = null;
      setMessage('이동 초안 요청을 처리했습니다. 아직 ERP에 적용하거나 영속 저장하지 않았습니다.');
    } catch (failure) {
      setError(failure?.message || '초안 이동 요청에 실패했습니다. 입력값은 유지됩니다.');
    } finally {
      submitLock.current = false;
      setMoving(false);
    }
  }

  return <section className="weekday-cycle-matrix" aria-label="목요일부터 수요일까지 연결 차수 행렬" aria-busy={disabled}>
    <div className="wcm-toolbar">
      <button type="button" disabled={disabled || adding || !hasCustomer || typeof onAddProduct !== 'function'} onClick={openAdd}>품목 추가</button>
      <label className="wcm-search">품목 검색<input type="search" value={search}
        placeholder="품목명 / 품목키" onChange={(event) => setSearch(event.target.value)} /></label>
      <label>품종<select value={flower} onChange={(event) => setFlower(event.target.value)}>
        <option value="">전체 품종</option>{flowers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <span className="wcm-muted">품목 {visibleRows.length}/{shipmentRows.length} · 출고 없음 {matrix.rows.length - shipmentRows.length}개 숨김 · 현재 출고·초안 우선 · 편집은 미적용 초안</span>
      {safePlans.length > 0 && <button type="button" disabled={disabled} onClick={openMove}>초안 날짜·차수 이동</button>}
    </div>
    {addOpen && <div className="wcm-add" role="region" aria-label="품목 추가 검색">
      <div className="wcm-toolbar">
        <label>추가할 품목<input type="search" value={addQuery} placeholder="ERP 품목명 검색" disabled={adding}
          onChange={(event)=>setAddQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.nativeEvent?.isComposing) searchAdd();}} /></label>
        <button type="button" disabled={adding} onClick={searchAdd}>검색</button>
        <button type="button" disabled={adding} onClick={()=>{addRequest.current+=1;setAddOpen(false);}}>닫기</button>
        <span className="wcm-muted">표에만 추가 · 전산 등록 아님 · 최대 20개 후보</span>
      </div>
      {addError && <p role="alert" className="wcm-error">{addError}</p>}
      <div className="wcm-add-candidates">{addCandidates.map((product)=><button type="button" key={product.ProdKey}
        disabled={adding || disabled} onClick={()=>addProduct(product)}>{product.ProdName} <small>{[product.CounName,product.FlowerName].filter(Boolean).join(' / ')}</small></button>)}</div>
      {!addCandidates.length && !adding && !addError && <span className="wcm-muted">품목명을 검색해 추가하세요.</span>}
    </div>}
    {selectedInfo && <div className="wcm-selected" role="status">
      <strong>선택 칸 내역</strong><button type="button" onClick={() => setSelectedInfo('')} aria-label="선택 칸 내역 닫기">닫기</button>
      <pre>{selectedInfo}</pre>
    </div>}
    {printError && <p className="wcm-error" role="alert">{printError}</p>}
    {(!hasCustomer || typeof onPrint !== 'function') && <p className="wcm-muted">
      출력 불가: {!hasCustomer ? '거래처를 먼저 선택하세요.' : '견적 출력 기능 미연결'}
    </p>}

    {moveOpen && <section className="wcm-move" aria-label="미적용 초안 이동">
      <div className="wcm-toolbar"><strong>초안 이동 · 입고 원천 유지 · ERP 미적용</strong>
        <button type="button" disabled={disabled} onClick={() => setMoveOpen(false)}>접기</button></div>
      <form onSubmit={submitMove} noValidate>
        <div className="wcm-form">
          <label>이동할 초안<select value={form.id} disabled={disabled} onChange={(event) => updateForm('id', event.target.value)}>
            <option value="">초안 선택</option>
            {safePlans.map((plan, index) => <option key={`move-plan|${plan.id}|${index}`} value={String(plan.id)}>
              {plan.prodName || `품목 ${plan.prodKey}`} · {plan.year}/{plan.orderWeek} · {plan.date} · {numberLabel(plan.quantity)} {plan.unit || '단위 미확인'}
            </option>)}
          </select></label>
          <label>이동수량<input type="number" min="0" step="any" max={selectedPlan?.quantity ?? undefined}
            value={form.quantity} disabled={disabled} onChange={(event) => updateForm('quantity', event.target.value)} /></label>
          <label>이동할 전산 달력 날짜<select value={form.date} disabled={disabled} onChange={(event) => updateForm('date', event.target.value)}>
            <option value="">날짜 선택</option>
            {validDestinations.map(({ cycle, day }, index) => <option key={`destination|${cycleKey(cycle)}|${day.date}|${index}`} value={day.date}>
              {day.date} ({day.label}) · {cycle.year}/{day.orderWeek}
            </option>)}
          </select></label>
          <label>변경 사유<input type="text" value={form.reason} disabled={disabled}
            onChange={(event) => updateForm('reason', event.target.value)} aria-required="true" /></label>
        </div>
        {selectedPlan && <p className="wcm-muted">출발 {selectedPlan.year}/{selectedPlan.orderWeek} · {selectedPlan.date}
          {' / 현재 초안 '}{numberLabel(selectedPlan.quantity)} {selectedPlan.unit || '단위 미확인'}
          {' / 사용 입고 '}{sourceLabel(selectedPlan)}{selectedPlan.wdetailKey != null ? ` · 원본행 ${selectedPlan.wdetailKey}` : ''}</p>}
        {!validDestinations.length && <p className="wcm-warning">이동 가능한 전산 달력이 없습니다. 입력값은 유지됩니다.</p>}
        {error && <p className="wcm-error" role="alert">{error}</p>}
        {message && <p className="wcm-status" role="status">{message}</p>}
        <button type="submit" disabled={disabled || !safePlans.length || !validDestinations.length || typeof onMove !== 'function'}>
          {moving ? '초안 이동 처리 중…' : '초안에만 이동 기록'}
        </button>
        {typeof onMove !== 'function' && <span className="wcm-warning"> 이동 기능 미연결</span>}
      </form>
    </section>}

    {!matrix.cycles.length && <p className="wcm-muted">전산 달력을 조회하면 이전·현재·다음 차수를 하나의 표로 표시합니다.</p>}
    {matrix.cycles.length > 0 && <nav className="wcm-cycle-jump" aria-label="가로 차수 바로 보기">{matrix.cycles.map((cycle,index)=><button type="button" key={cycleKey(cycle)} onClick={()=>{
      const scroll=tableScroll.current;
      const header=scroll?.querySelectorAll('thead tr:first-child > th')[index+1];
      if(scroll && header) scroll.scrollTo({left:Math.max(0,header.offsetLeft-260),behavior:'smooth'});
    }}>{cycle.offset<0?'이전':cycle.offset>0?'다음':'현재'} {cycle.majorWeek}차 보기</button>)}<span className="wcm-muted">품목 고정 · 가로 스크롤</span></nav>}
    {matrix.cycles.length > 0 && <div ref={tableScroll} className="wcm-table-scroll" tabIndex={0} role="region"
      aria-label="이전·현재·다음 차수 통합 요일표, 가로 스크롤로 연결 차수 보기">
      <table>
        <caption>목→수 · 기준 대비 분배 잔량(ERP 재고 아님) · 미확정/초안 예상은 별도 표시 · 변경값 아래 (최초값) · 노랑=변경 · 보라=선출고 · 파랑=미적용 초안 · 품목 행 마우스 강조 · 가로 스크롤로 차수 연결.
          출력은 ERP 저장된 확정 견적만 포함하며 화면 초안은 제외합니다. 기준 화면 1920×1080 / 100%.</caption>
        <colgroup><col className="wcm-product-col" />{matrix.columns.map((column, index) => <col key={index} className={column.kind==='remainingMajor'?'wcm-summary-col':column.kind.startsWith('initial')?'wcm-baseline-col':column.kind==='remaining01'?'wcm-remainder-col':'wcm-day-col'} />)}</colgroup>
        <thead>
          <tr><th rowSpan={3} scope="col">품목 <span className="wcm-muted">· 단위</span></th>
            {matrix.cycles.map((cycle) => {
              const dates = (selectedDates[cycleKey(cycle)] || []).filter((value) => cycle.days.some((day) => day.date === value));
              return <th key={cycleKey(cycle)} colSpan={horizontalCycleColumns(cycle).length} scope="colgroup"
                className={cycle.offset === 0 ? 'wcm-current-head' : ''}>
                <div className="wcm-cycle-header"><strong>{cycle.offset < 0 ? '이전' : cycle.offset > 0 ? '다음' : '현재'} {cycleLabel(cycle)}</strong>
                  <span className="wcm-muted">{cycle.startDate} ~ {cycle.endDate}</span>
                  <PrintButton label="전체 견적" reason={printReason(cycle, [], 'major')} onClick={() => print(cycle, [], 'major')} />
                  <PrintButton label={'선택요일 출력 (' + dates.length + ')'} reason={printReason(cycle, dates, 'dates')}
                    onClick={() => print(cycle, dates, 'dates')} />
                </div>
              </th>;
            })}
          </tr>
          <tr>{matrix.cycles.map((cycle) => <Fragment key={cycleKey(cycle)}>
            {horizontalCycleColumns(cycle).map((column, index) => {
              if(column.kind!=='day') {
                const initial=column.kind.startsWith('initial');
                const suffix=column.kind.endsWith('01')?'01':'02';
                const saved=baselines.find(record=>Number(record.year)===Number(cycle.year)&&record.orderWeek===`${cycle.majorWeek}-${suffix}`);
                const candidate=baselineCandidates.find(record=>Number(record.year)===Number(cycle.year)&&record.orderWeek===`${cycle.majorWeek}-${suffix}`);
                return <th key={column.kind} rowSpan={2} scope="col" className={initial?'wcm-initial wcm-cycle-start':'wcm-total'}>
                  {initial ? <>{cycle.majorWeek}-{suffix}<br/>최초분배<br/>{saved?<small title={`${saved.confirmedAt} · ${saved.confirmedBy}`}>기준 보관됨</small>:<><small className={candidate?.error?'wcm-warning':'wcm-muted'} title={candidate?.error || '현재 ERP 분배량 · 확정 시 최초 기준으로 고정'}>{candidate?.error?'조회 실패':candidate?'미확정':busy?'조회 중':'미확정'}</small><br/><button type="button" className="wcm-confirm" disabled={busy || baselineBusy || !hasCustomer || cycle.calendarState!=='FOUND' || typeof onConfirmBaseline!=='function'}
                    aria-label={`${cycle.year}/${cycle.majorWeek}-${suffix} 최초분배 확정`} onClick={()=>onConfirmBaseline({cycle,orderWeek:`${cycle.majorWeek}-${suffix}`})}>확정</button></>}</>
                    : column.kind==='remaining01' ? <>{cycle.majorWeek}-01<br/>최초기준<br/>잔량</> : <>{cycle.majorWeek}차<br/>잔량<br/><small>합계·변경</small></>}
                </th>;
              }
              const day=column.day;
              const reason = printReason(cycle, [day.date], 'dates');
              const key = cycleKey(cycle);
              return <th key={day.date || index} scope="col" className={index === 0 ? 'wcm-cycle-start' : ''}>
                <PrintButton className="wcm-day-print" visibleLabel="출력" label={(cycle.majorWeek ?? '?') + '차 ' + day.label + ' 견적 출력'}
                  reason={reason} onClick={() => print(cycle, [day.date], 'dates')} />
                <label className="wcm-day-select" title={reason || '선택요일 견적 출력에 포함'}>
                  <input type="checkbox" disabled={Boolean(reason)} checked={(selectedDates[key] || []).includes(day.date)}
                    aria-label={cycle.year + '/' + cycle.majorWeek + '차 ' + day.label + ' ' + day.date + ' 출력 선택'}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedDates((previous) => {
                        const selected = new Set(previous[key] || []);
                        if (checked) selected.add(day.date); else selected.delete(day.date);
                        return { ...previous, [key]: cycle.days.filter((item) => selected.has(item.date)).map((item) => item.date) };
                      });
                    }} /> 선택
                </label>
              </th>;
            })}
          </Fragment>)}</tr>
          <tr>{matrix.cycles.map((cycle) => <Fragment key={cycleKey(cycle)}>
            {cycle.days.map((day, index) => <th key={day.date || index} scope="col"
              className={index === 0 ? 'wcm-cycle-start' : ''} title={day.orderWeek + ' · 달력 ' + day.calendarState}>
              {day.label}<span className="wcm-muted wcm-date">{day.date?.slice(5) || '미확인'}</span>
              {day.calendarState !== 'FOUND' && <span className="wcm-warning">미확인</span>}
            </th>)}
          </Fragment>)}</tr>
        </thead>
        <tbody>{visibleRows.map((row) => {
          const badge = row.flowerNames.join(', ');
          const name = weekdayProductLabel(row);
          const units = [...new Set(row.blocks.map((block) => block.unit).filter(Boolean))].join('/');
          const productTitle = [row.name, '품목 ' + row.prodKey, badge, units || '단위 확인 필요',
            ...row.blocks.flatMap((block) => block.sources.map((source) => cycleLabel(block.cycle) + ' 초안 원천: ' + source)),
            '전산 입고 원천 미지정 · 요일별 입고 원천 추정 안 함'].filter(Boolean).join('\n');
          return <tr key={row.prodKey}>
            <th scope="row" title={productTitle}><div className="wcm-product">
              <span className="wcm-product-name">{name}</span><small>{units || '?'}</small>
            </div></th>
            {row.blocks.map((block) => <Fragment key={cycleKey(block.cycle)}>
              {horizontalCycleColumns(block.cycle).map((column,index)=>{
                if(column.kind==='day') {
                  const day=block.days.find(item=>item.date===column.day.date);
                  return <td key={day.date || index}><QuantityCell row={row} block={block} day={day} disabled={disabled} onEditCell={onEditCell} onSelect={setSelectedInfo} onOpenNote={onOpenNote}/></td>;
                }
                const initial=column.kind==='initial01'?block.initial01:column.kind==='initial02'?block.initial02:null;
                const provisional=column.kind==='initial01'?block.provisional01:column.kind==='initial02'?block.provisional02:null;
                const remainder=column.kind==='remaining01'?block.remainder01View:column.kind==='remainingMajor'?block.remainderMajorView:null;
                const value=column.kind.startsWith('initial')?(initial || provisional)?.quantity:remainder?.value;
                return <td key={column.kind} className={column.kind.startsWith('initial')?`wcm-initial wcm-cycle-start${provisional?' wcm-provisional':''}`:column.kind==='remainingMajor'?'wcm-total wcm-major-total':'wcm-total'} title={`${provisional?'미확정 · 현재 ERP 분배량 (확정 시 최초 기준 고정)':'최초기준 비교값 · ERP재고 아님'}\n전산 ${numberLabel(block.currentTotal)} / 미적용 초안 ${numberLabel(block.plannedTotal)} ${block.unit||''}\n최초 ${numberLabel(block.initialMajor)} · 변경 ${numberLabel(block.initialChange)}\n${block.quote.state}: 관리 ${block.quote.managementQuantity ?? '?'} / 인쇄 순수량 ${block.quote.netQuantity ?? '?'} ${block.quote.unit || ''} · 총액 ${block.quote.amount ?? '?'}원\n${block.pageNote?.note || ''}`}>
                  <span className={remainder?.hasDraft?'wcm-draft wcm-remainder-value':'wcm-remainder-value'} title={remainder?`${remainder.label} · 저장 전산 기준잔량 ${numberLabel(remainder.savedValue)} · ERP 재고 아님`:undefined}>{weekdayQuantityLabel(value,row,block.unit)}</span>
                  {remainder && <small className={`wcm-remainder-status${remainder.hasDraft?' wcm-draft':''}`}>{remainder.label}</small>}
                  {column.kind==='remainingMajor' && <small className="wcm-cycle-sum"><span title="초안이 있으면 예상 합계, 없으면 저장 분배 합계">합 {weekdayQuantityLabel(block.effectiveTotal,row,block.unit)}</span>
                    <button type="button" className="wcm-change-note" title="최초 대비 변경량 · 비고 보기/입력" aria-label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 변경 비고`}
                      onClick={()=>typeof onOpenNote==='function'?onOpenNote({row,block}):setSelectedInfo(`최초 ${numberLabel(block.initialMajor)} / 저장 ${numberLabel(block.currentTotal)} / 예상 ${numberLabel(block.effectiveTotal)} / 예상 변경 ${numberLabel(block.effectiveInitialChange)}`)}>{block.effectiveInitialChange==null?'Δ—':`Δ${block.effectiveInitialChange>0?'+':''}${numberLabel(block.effectiveInitialChange)}`}{block.pageNote?.note?' ✎':''}</button>
                    <button type="button" className={`wcm-quote ${block.quote.state==='견적 불일치'?'wcm-warning':''}`} data-quantity={block.quote.managementQuantity ?? block.quote.netQuantity ?? '—'} title={`견 ${block.quote.managementQuantity ?? block.quote.netQuantity ?? '—'} · ${block.quote.state} · 저장 견적만 포함`}
                      aria-label={`${row.name} ${block.cycle.majorWeek}차 견적 대조`} onClick={()=>setSelectedInfo(`${block.quote.state}\n견적관리 ${block.quote.managementQuantity ?? '?'} / 인쇄 ${block.quote.netQuantity ?? '?'} ${block.quote.unit || ''}\n저장 분배 ${numberLabel(block.currentTotal)} / 예상 합계 ${numberLabel(block.effectiveTotal)}\n초안은 견적 출력에 포함하지 않습니다.`)}>견{block.quote.state==='견적 일치'?'✓':block.quote.state==='견적 불일치'?'!':'?'}</button>
                  </small>}
                </td>;
              })}
            </Fragment>)}
          </tr>;
        })}
          {!visibleRows.length && <tr><td colSpan={matrix.columns.length + 1}>
            {shipmentRows.length ? '검색/품종 조건에 맞는 품목이 없습니다.' : matrix.rows.length
              ? '표시 범위에 출고 수량 또는 양수 초안이 있는 품목이 없습니다. 출고 없는 품목은 숨겼습니다.'
              : '조회된 품목 또는 초안이 없습니다. 재고 0을 의미하지 않습니다.'}
          </td></tr>}
        </tbody>
      </table>
    </div>}

    {diagnostics.length > 0 && <details className="wcm-outside">
      <summary>범위 밖 날짜 / 실제 세부차수 불일치 / 단위·초안 검토 · {diagnostics.length}개 품목·차수 (원문 보존)</summary>
      {diagnostics.map(({ row, block }) => <div key={row.prodKey + '|' + cycleKey(block.cycle)} className="wcm-detail-record">
        <strong>{row.name} · 품목 {row.prodKey} · {cycleLabel(block.cycle)}</strong>
        {block.unitState !== 'MATCHED' && <span className="wcm-warning"> · 단위 확인 / 합산 불가</span>}
        {(block.productInitials || []).map((initial,index)=><div key={`initial|${index}`}>
          최초 {initial.year}/{initial.orderWeek} · {numberLabel(initial.quantity)} {initial.unit || '단위 미확인'} · 현재 단위가 달라도 원본 기준 보존
        </div>)}
        {block.productActuals.map((actual, index) => <div key={'actual|' + index}>
          전산 {actual.year}/{actual.orderWeek} · 차수수량 {numberLabel(actual.shipmentOutQuantity)} {actual.outUnit || '단위 미확인'}
          {' · '}{(actual.shipmentDates || []).length ? actual.shipmentDates.map((item) =>
            String(item.date).slice(0, 10) + ': ' + numberLabel(item.shipmentQuantity) + ' ' + (actual.outUnit || '?')).join(' / ') : '날짜행 없음'}
        </div>)}
        {block.productPlans.map((plan, index) => <div key={'draft|' + index}>
          초안 {plan.id} · {plan.year}/{plan.orderWeek} · {plan.date || '날짜 미지정'} · {numberLabel(plan.quantity)} {plan.unit || '단위 미확인'} · {sourceLabel(plan)}
        </div>)}
        {block.days.filter((day) => day.assignedWeekMismatch || day.drafts.length > 1).map((day) => <div key={day.date} className="wcm-warning">
          {day.date} · 실제 {day.actualOrderWeeks.join(', ') || '없음'} / 달력 권장 {day.orderWeek} · {day.editDisabledReason}
        </div>)}
        {(block.outside.length > 0 || block.outsideDrafts.length > 0) && <div className="wcm-warning">
          날짜 범위 밖 전산 {block.outside.length}건 / 초안 {block.outsideDrafts.length}건 · 차수 합계에는 포함, 7일 칸에는 미포함
        </div>}
      </div>)}
    </details>}

    {(outsidePlans.length > 0 || outsideComparisons.length > 0) && <details className="wcm-outside" aria-label="연결 조회 범위 밖 자료">
      <summary>연결 차수 범위 밖 · 초안 {outsidePlans.length}건 / 전산 대조 {outsideComparisons.length}건 (연도·업무키 별도 보존)</summary>
      {outsidePlans.map((plan, index) => <div key={'unscoped-plan|' + index}>
        초안 {plan.prodName || '품목 ' + plan.prodKey} · 품목 {plan.prodKey} · {plan.year}/{plan.orderWeek} · {plan.date || '날짜 미지정'}
        {' · '}{numberLabel(plan.quantity)} {plan.unit || '단위 미확인'} · {sourceLabel(plan)}
      </div>)}
      {outsideComparisons.map((row, index) => <div key={'unscoped-actual|' + index}>
        전산 {row.prodName || '품목 ' + row.prodKey} · 품목 {row.prodKey} · {row.year}/{row.orderWeek}
        {' · 차수수량 '}{numberLabel(row.shipmentOutQuantity)} {row.outUnit || '단위 미확인'}
        {' · '}{(row.shipmentDates || []).length ? row.shipmentDates.map((item) =>
          String(item.date).slice(0, 10) + ': ' + numberLabel(item.shipmentQuantity) + ' ' + (row.outUnit || '?')).join(' / ') : '날짜행 없음'}
      </div>)}
    </details>}

    <style dangerouslySetInnerHTML={{__html:`
      .weekday-cycle-matrix { width:100%; min-width:0; box-sizing:border-box; color:#0f172a; font-size:13px; line-height:1.4; }
      .weekday-cycle-matrix td.wcm-provisional { background:#f1f5f9; color:#334155; }
      .weekday-cycle-matrix * { box-sizing:border-box; }
      .weekday-cycle-matrix p { margin:6px 0; }
      .weekday-cycle-matrix .wcm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:7px 0; }
      .weekday-cycle-matrix button { border:1px solid #8da5bd; border-radius:4px; background:#fff; color:#172b42; padding:4px 7px; font:inherit; cursor:pointer; }
      .weekday-cycle-matrix button:disabled { opacity:.55; cursor:not-allowed; }
      .weekday-cycle-matrix :is(button,input,select,.wcm-table-scroll):focus-visible { outline:2px solid #2563eb; outline-offset:1px; }
      .weekday-cycle-matrix .wcm-muted { color:#334155; font-size:12px; }
      .weekday-cycle-matrix .wcm-draft, .weekday-cycle-matrix .wcm-delta { color:#174e9c; }
      .weekday-cycle-matrix .wcm-warning { color:#805100; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-error { color:#a51a24; background:#fff0f1; padding:8px; border:1px solid #e5a3a9; }
      .weekday-cycle-matrix .wcm-status { color:#164e63; background:#ecfeff; padding:8px; }
      .weekday-cycle-matrix .wcm-selected { position:fixed; bottom:16px; right:16px; width:min(430px,calc(100% - 32px)); z-index:20; border:1px solid #93b5df; padding:7px; background:#f3f8ff; box-shadow:0 4px 16px #172b4233; }
      .weekday-cycle-matrix .wcm-selected button { float:right; }
      .weekday-cycle-matrix .wcm-selected pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:5px 0 0; font:inherit; }
      .weekday-cycle-matrix .wcm-outside { padding:7px; margin:8px 0; background:#fffbeb; border:1px solid #dfc788; overflow-wrap:anywhere; }
      .weekday-cycle-matrix summary { cursor:pointer; }
      .weekday-cycle-matrix .wcm-detail-record { margin:6px 0; padding:5px 0; border-bottom:1px solid #e6d5a7; }
      .weekday-cycle-matrix .wcm-table-scroll { width:100%; overflow-x:auto; }
      .weekday-cycle-matrix .wcm-cycle-jump { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:4px 0; }
      .weekday-cycle-matrix .wcm-cycle-jump button { padding:2px 6px; font-size:12px; }
      .weekday-cycle-matrix .wcm-add { border:1px solid #93b5df; background:#f3f8ff; padding:6px; margin:4px 0; }
      .weekday-cycle-matrix .wcm-add-candidates { display:flex; flex-wrap:wrap; gap:4px; }
      .weekday-cycle-matrix .wcm-add-candidates button { text-align:left; font-size:12px; padding:3px 6px; }
      .weekday-cycle-matrix table { width:100%; min-width:3032px; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:13px; }
      .weekday-cycle-matrix .wcm-product-col { width:260px; }
      .weekday-cycle-matrix .wcm-summary-col { width:160px; }
      .weekday-cycle-matrix .wcm-baseline-col, .weekday-cycle-matrix .wcm-day-col { width:76px; }
      .weekday-cycle-matrix .wcm-remainder-col { width:80px; }
      .weekday-cycle-matrix caption { text-align:left; color:#526277; padding:5px 0; font-size:11px; }
      .weekday-cycle-matrix table th, .weekday-cycle-matrix table td { border-right:1px solid #c3cfdb; border-bottom:1px solid #c3cfdb; padding:2px 3px; text-align:center; vertical-align:middle; }
      .weekday-cycle-matrix tr > :first-child { border-left:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead tr:first-child th { border-top:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead th { position:static; top:auto; background:#edf3f9; }
      .weekday-cycle-matrix tbody :is(th,td) { padding:0 3px; }
      .weekday-cycle-matrix tbody tr:is(:hover,:focus-within) > :is(th,td) { box-shadow:inset 0 2px #60a5fa,inset 0 -2px #60a5fa; }
      .weekday-cycle-matrix tbody tr:is(:hover,:focus-within) > th { background:#dbeafe; box-shadow:inset 4px 0 #2563eb,inset 0 2px #60a5fa,inset 0 -2px #60a5fa; }
      .weekday-cycle-matrix thead .wcm-current-head { background:#dbeafe; }
      .weekday-cycle-matrix .wcm-cycle-header { display:flex; flex-wrap:wrap; gap:5px 10px; align-items:center; justify-content:center; padding:3px; }
      .weekday-cycle-matrix .wcm-day-print { width:100%; font-size:11px; padding:2px 1px; min-height:24px; }
      .weekday-cycle-matrix .wcm-day-select { display:flex; flex-direction:row; justify-content:center; align-items:center; gap:3px; font-size:12px; margin-top:3px; }
      .weekday-cycle-matrix .wcm-day-select input { width:auto; margin:0; }
      .weekday-cycle-matrix .wcm-date { display:block; }
      .weekday-cycle-matrix tbody th { position:sticky; top:auto; left:0; z-index:1; text-align:left; font-weight:normal; background:#f8fafc; }
      .weekday-cycle-matrix .wcm-product { display:flex; gap:4px; align-items:center; min-height:32px; min-width:0; }
      .weekday-cycle-matrix .wcm-product-name { min-width:0; overflow-wrap:anywhere; white-space:normal; font-size:13px; font-weight:600; }
      .weekday-cycle-matrix .wcm-product small { margin-left:auto; color:#526277; flex-shrink:0; }
      .weekday-cycle-matrix .wcm-badge { font-size:10px; padding:1px 3px; background:#e4ecf5; color:#405774; border-radius:3px; max-width:72px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex-shrink:0; }
      .weekday-cycle-matrix .wcm-total { background:#f1f6fb; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-initial { background:#edf7f0; font-variant-numeric:tabular-nums; font-size:13px; }
      .weekday-cycle-matrix .wcm-confirm { padding:1px 3px; font-size:12px; }
      .weekday-cycle-matrix .wcm-remainder-status { display:block; font-size:12px; line-height:16px; }
      .weekday-cycle-matrix .wcm-major-total .wcm-remainder-status { display:inline; margin-left:5px; }
      .weekday-cycle-matrix .wcm-cycle-sum { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:2px 4px; font-size:12px; line-height:16px; }
      .weekday-cycle-matrix .wcm-change-note { font-size:12px; line-height:16px; padding:0 2px; background:#fff7da; }
      .weekday-cycle-matrix .wcm-cycle-start { border-left:2px solid #8da5bd; }
      .weekday-cycle-matrix .wcm-cell { display:flex; flex-direction:column; align-items:stretch; justify-content:center; position:relative; min-height:32px; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-changed { background:#fff0b3; }
      .weekday-cycle-matrix .wcm-early { background:#eadbfa; }
      .weekday-cycle-matrix .wcm-early-label { position:relative; z-index:2; font-size:12px; line-height:16px; padding:0; border:0; background:#eadbfa; color:#652397; width:100%; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-quote { font-size:12px; padding:0 2px; line-height:16px; }
      .weekday-cycle-matrix .wcm-major-total { line-height:16px; font-size:13px; }
      .weekday-cycle-matrix .wcm-number-display { pointer-events:none; width:100%; text-align:right; font-size:13px; font-weight:600; line-height:18px; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-remainder-value { font-weight:600; }
      .weekday-cycle-matrix .wcm-proposed .wcm-number-display { color:#174e9c; font-weight:600; }
      .weekday-cycle-matrix .wcm-cell-detail { display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:2px; position:relative; z-index:2; font-size:12px; line-height:16px; }
      .weekday-cycle-matrix .wcm-original { font-size:12px; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-cell input { position:absolute; opacity:0; left:0; top:0; width:100%; padding:0 1px; border:1px solid transparent; height:20px; min-height:20px; line-height:18px; text-align:right; font-size:13px; background:transparent; border-radius:2px; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-cell input:focus { position:relative; opacity:1; }
      .weekday-cycle-matrix .wcm-cell:has(input:focus) .wcm-number-display { display:none; }
      .weekday-cycle-matrix .wcm-cell input:disabled { color:#526277; opacity:1; }
      .weekday-cycle-matrix .wcm-cell input:hover:not(:disabled) { border-color:#93b5df; }
      .weekday-cycle-matrix .wcm-proposed input { color:#174e9c; background:#eaf3ff; }
      .weekday-cycle-matrix .wcm-cell-info { position:relative; z-index:2; font-size:12px; line-height:16px; padding:0 2px; border:0; background:#e2ecfa; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-cell-error { color:#a51a24; position:absolute; top:100%; right:0; width:180px; z-index:4; background:#fff0f1; border:1px solid #e5a3a9; padding:4px; text-align:left; }
      .weekday-cycle-matrix .wcm-cell input[aria-invalid=true] { border-color:#a51a24; background:#fff0f1; }
      .weekday-cycle-matrix .wcm-move { border:1px solid #7ba0cb; background:#f3f8ff; border-radius:7px; padding:10px; margin:10px 0; }
      .weekday-cycle-matrix .wcm-form { display:grid; grid-template-columns:minmax(230px,2fr) minmax(100px,.7fr) minmax(210px,1.4fr) minmax(200px,1.5fr); gap:8px; margin:8px 0; }
      .weekday-cycle-matrix label { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .weekday-cycle-matrix input, .weekday-cycle-matrix select { width:100%; min-width:0; font:inherit; padding:5px; border:1px solid #9aaec4; border-radius:4px; background:#fff; color:#172b42; }
      .weekday-cycle-matrix .wcm-search { min-width:200px; }
      .weekday-cycle-matrix .wcm-toolbar label { flex-direction:row; align-items:center; gap:6px; }
      .weekday-cycle-matrix .wcm-toolbar input { width:200px; padding:3px 5px; }
      .weekday-cycle-matrix .wcm-toolbar select { width:105px; padding:3px; }
      @media (max-width:1000px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width:560px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:minmax(0,1fr); } }
    `}}/>
  </section>;
}
