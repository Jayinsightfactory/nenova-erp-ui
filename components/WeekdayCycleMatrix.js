import { Fragment, useMemo, useRef, useState } from 'react';
import { buildHorizontalWeekdayMatrix, horizontalCycleKey, horizontalEditPayload,
  horizontalPrintReason, validateHorizontalQuantity } from '../lib/weekdayHorizontalMatrix.js';

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

function QuantityCell({ day, row, block, disabled, onEditCell, onSelect }) {
  const [input, setInput] = useState(null);
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const lastSubmitted = useRef(null);
  const visibleQuantity = day.planned ?? day.current;
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
  return <div className={`wcm-cell${day.planned != null ? ' wcm-proposed' : ''}`} title={`${description}${reason ? `\n${reason}` : ''}`}>
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
    {(day.delta != null && day.delta !== 0 || reason) && <button type="button" className="wcm-cell-info"
      aria-label={`${row.name} ${day.date} 수량 내역`} onClick={() => onSelect(`${description}\n${reason}`)}>
      {day.delta != null && day.delta !== 0 ? `${day.delta > 0 ? '+' : ''}${numberLabel(day.delta)}` : '!'}</button>}
    {failure && <span className="wcm-cell-error" role="alert">{failure}</span>}
  </div>;
}

function PrintButton({ label, reason, onClick, className = '', visibleLabel = label }) {
  return <span title={reason || 'ERP 저장된 확정 견적만 출력 · 미적용 초안 제외'}>
    <button type="button" className={className} disabled={Boolean(reason)} aria-label={label}
      onClick={onClick}>{visibleLabel}</button>
  </span>;
}

export default function WeekdayCycleMatrix({ cycles = [], plans = [], comparisonRows = [], onMove, busy = false,
  onEditCell, onPrint, printBusy = false, customer = null, custKey = null, customerProvided }) {
  const safeCycles = Array.isArray(cycles) ? cycles : [];
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeComparisons = Array.isArray(comparisonRows) ? comparisonRows : [];
  const [search, setSearch] = useState('');
  const [flower, setFlower] = useState('');
  const [selectedDates, setSelectedDates] = useState({});
  const [selectedInfo, setSelectedInfo] = useState('');
  const [printError, setPrintError] = useState('');
  const [printing, setPrinting] = useState(false);
  const printLock = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [form, setForm] = useState({ id: '', quantity: '', date: '', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const submitLock = useRef(false);
  const pendingEventId = useRef(null);
  const disabled = busy || moving;
  const matrix = useMemo(() => buildHorizontalWeekdayMatrix(safeCycles, safePlans, safeComparisons), [cycles, plans, comparisonRows]);
  const hasCustomer = customerProvided ?? (Number(customer?.CustKey ?? customer?.custKey ?? custKey) > 0);
  const printReason = (cycle, dates, mode) => busy ? '전산 조회/처리 중' : horizontalPrintReason({ cycle, dates, mode, onPrint,
    customerProvided: hasCustomer, printBusy: printBusy || printing });
  const flowers = [...new Set(matrix.rows.flatMap((row) => row.flowerNames))].sort();
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = matrix.rows.filter((row) => (!flower || row.flowerNames.includes(flower))
    && (!query || `${row.prodKey} ${row.name} ${row.flowerNames.join(' ')}`.toLocaleLowerCase().includes(query)));
  const validDestinations = safeCycles.filter((cycle) => cycle.calendarState === 'FOUND')
    .flatMap((cycle) => cycle.days.filter((day) => day.calendarState === 'FOUND')
      .map((day) => ({ cycle, day })));
  const selectedPlan = safePlans.find((plan) => String(plan.id) === form.id);
  const { outsidePlans, outsideComparisons } = matrix;
  const diagnostics = matrix.rows.flatMap((row) => row.blocks.map((block) => ({ row, block })))
    .filter(({ block }) => block.outside.length || block.outsideDrafts.length || block.unitState !== 'MATCHED'
      && (block.productActuals.length || block.productPlans.length) || block.days.some((day) => day.assignedWeekMismatch || day.drafts.length > 1));

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
      <label className="wcm-search">품목 검색<input type="search" value={search}
        placeholder="품목명 / 품목키" onChange={(event) => setSearch(event.target.value)} /></label>
      <label>품종<select value={flower} onChange={(event) => setFlower(event.target.value)}>
        <option value="">전체 품종</option>{flowers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <span className="wcm-muted">품목 {visibleRows.length}/{matrix.rows.length} · 현재 출고·초안 우선 · 편집은 미적용 초안</span>
      {safePlans.length > 0 && <button type="button" disabled={disabled} onClick={openMove}>초안 날짜·차수 이동</button>}
    </div>
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
    {matrix.cycles.length > 0 && <div className="wcm-table-scroll" tabIndex={0} role="region"
      aria-label="이전·현재·다음 차수 통합 요일표, 작은 화면에서는 가로 스크롤">
      <table>
        <caption>목→수 · 전산값 / 미적용 초안(파랑) · 잔량 미확인 · 빈칸은 전산 날짜행 없음(0 아님).
          출력은 ERP 저장된 확정 견적만 포함하며 화면 초안은 제외합니다. 기준 화면 1920×1080 / 100%.</caption>
        <colgroup><col className="wcm-product-col" />{matrix.columns.map((column, index) => <col key={index} />)}</colgroup>
        <thead>
          <tr><th rowSpan={3} scope="col">품목 <span className="wcm-muted">· 품종 / 단위</span></th>
            {matrix.cycles.map((cycle) => {
              const dates = (selectedDates[cycleKey(cycle)] || []).filter((value) => cycle.days.some((day) => day.date === value));
              return <th key={cycleKey(cycle)} colSpan={cycle.days.length + 1} scope="colgroup"
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
            {cycle.days.map((day, index) => {
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
            <th rowSpan={2} scope="col" className="wcm-total">차수<br />합계</th>
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
          const name = badge && row.flowerNames.length === 1 && row.name.toLocaleLowerCase().startsWith(badge.toLocaleLowerCase() + ' ')
            ? row.name.slice(badge.length).trim() : row.name;
          const units = [...new Set(row.blocks.map((block) => block.unit).filter(Boolean))].join('/');
          const productTitle = [row.name, '품목 ' + row.prodKey, badge, units || '단위 확인 필요',
            ...row.blocks.flatMap((block) => block.sources.map((source) => cycleLabel(block.cycle) + ' 초안 원천: ' + source)),
            '전산 입고 원천 미지정 · 요일별 입고 원천 추정 안 함'].filter(Boolean).join('\n');
          return <tr key={row.prodKey}>
            <th scope="row" title={productTitle}><div className="wcm-product">
              {badge && <span className="wcm-badge">{badge}</span>}
              <span className="wcm-product-name">{name}</span><small>{units || '?'}</small>
            </div></th>
            {row.blocks.map((block) => <Fragment key={cycleKey(block.cycle)}>
              {block.days.map((day, index) => <td key={day.date || index} className={index === 0 ? 'wcm-cycle-start' : ''}>
                <QuantityCell row={row} block={block} day={day} disabled={disabled} onEditCell={onEditCell} onSelect={setSelectedInfo} />
              </td>)}
              <td className="wcm-total" title={'전산 ' + numberLabel(block.currentTotal) + ' / 미적용 초안 ' + numberLabel(block.plannedTotal)
                + ' ' + (block.unit || '단위 확인 필요') + '\n날짜 범위 밖 원문도 차수 합계에는 포함'}>
                <span>{block.currentTotal == null ? '—' : numberLabel(block.currentTotal)}</span>
                {block.plannedTotal != null && <small className="wcm-draft"> / {numberLabel(block.plannedTotal)}</small>}
              </td>
            </Fragment>)}
          </tr>;
        })}
          {!visibleRows.length && <tr><td colSpan={matrix.columns.length + 1}>
            {matrix.rows.length ? '검색/품종 조건에 맞는 품목이 없습니다.' : '조회된 품목 또는 초안이 없습니다. 재고 0을 의미하지 않습니다.'}
          </td></tr>}
        </tbody>
      </table>
    </div>}

    {diagnostics.length > 0 && <details className="wcm-outside">
      <summary>범위 밖 날짜 / 실제 세부차수 불일치 / 단위·초안 검토 · {diagnostics.length}개 품목·차수 (원문 보존)</summary>
      {diagnostics.map(({ row, block }) => <div key={row.prodKey + '|' + cycleKey(block.cycle)} className="wcm-detail-record">
        <strong>{row.name} · 품목 {row.prodKey} · {cycleLabel(block.cycle)}</strong>
        {block.unitState !== 'MATCHED' && <span className="wcm-warning"> · 단위 확인 / 합산 불가</span>}
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
      .weekday-cycle-matrix { width:100%; min-width:0; box-sizing:border-box; color:#172b42; font-size:12px; line-height:1.4; }
      .weekday-cycle-matrix * { box-sizing:border-box; }
      .weekday-cycle-matrix p { margin:6px 0; }
      .weekday-cycle-matrix .wcm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:7px 0; }
      .weekday-cycle-matrix button { border:1px solid #8da5bd; border-radius:4px; background:#fff; color:#172b42; padding:4px 7px; font:inherit; cursor:pointer; }
      .weekday-cycle-matrix button:disabled { opacity:.55; cursor:not-allowed; }
      .weekday-cycle-matrix :is(button,input,select,.wcm-table-scroll):focus-visible { outline:2px solid #2563eb; outline-offset:1px; }
      .weekday-cycle-matrix .wcm-muted { color:#526277; font-size:11px; }
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
      .weekday-cycle-matrix table { width:100%; min-width:1780px; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:12px; }
      .weekday-cycle-matrix .wcm-product-col { width:220px; }
      .weekday-cycle-matrix caption { text-align:left; color:#526277; padding:5px 0; font-size:11px; }
      .weekday-cycle-matrix table th, .weekday-cycle-matrix table td { border-right:1px solid #c3cfdb; border-bottom:1px solid #c3cfdb; padding:2px 3px; text-align:center; vertical-align:middle; }
      .weekday-cycle-matrix tr > :first-child { border-left:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead tr:first-child th { border-top:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead th { position:static; top:auto; background:#edf3f9; }
      .weekday-cycle-matrix tbody :is(th,td) { padding:0 3px; }
      .weekday-cycle-matrix thead .wcm-current-head { background:#dbeafe; }
      .weekday-cycle-matrix .wcm-cycle-header { display:flex; flex-wrap:wrap; gap:5px 10px; align-items:center; justify-content:center; padding:3px; }
      .weekday-cycle-matrix .wcm-day-print { width:100%; font-size:11px; padding:2px 1px; min-height:24px; }
      .weekday-cycle-matrix .wcm-day-select { display:flex; flex-direction:row; justify-content:center; align-items:center; gap:3px; font-size:10px; margin-top:3px; }
      .weekday-cycle-matrix .wcm-day-select input { width:auto; margin:0; }
      .weekday-cycle-matrix .wcm-date { display:block; }
      .weekday-cycle-matrix tbody th { position:sticky; top:auto; left:0; z-index:1; text-align:left; font-weight:normal; background:#f8fafc; }
      .weekday-cycle-matrix .wcm-product { display:flex; gap:4px; align-items:center; height:19px; min-width:0; }
      .weekday-cycle-matrix .wcm-product-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .weekday-cycle-matrix .wcm-product small { margin-left:auto; color:#526277; flex-shrink:0; }
      .weekday-cycle-matrix .wcm-badge { font-size:10px; padding:1px 3px; background:#e4ecf5; color:#405774; border-radius:3px; max-width:72px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex-shrink:0; }
      .weekday-cycle-matrix .wcm-total { background:#f1f6fb; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-cycle-start { border-left:2px solid #8da5bd; }
      .weekday-cycle-matrix .wcm-cell { display:flex; align-items:center; position:relative; min-height:19px; }
      .weekday-cycle-matrix .wcm-cell input { padding:0 1px; border:1px solid transparent; height:18px; min-height:18px; line-height:16px; text-align:right; font-size:12px; background:transparent; border-radius:2px; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-cell input:disabled { color:#526277; opacity:1; }
      .weekday-cycle-matrix .wcm-cell input:hover:not(:disabled) { border-color:#93b5df; }
      .weekday-cycle-matrix .wcm-proposed input { color:#174e9c; background:#eaf3ff; }
      .weekday-cycle-matrix .wcm-cell-info { font-size:9px; padding:0 2px; border:0; background:#e2ecfa; max-width:26px; overflow:hidden; flex-shrink:0; }
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
