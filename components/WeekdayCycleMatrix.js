import { useId, useMemo, useRef, useState } from 'react';
import { buildWeekdayMatrix } from '../lib/weekdayEstimateCycle.js';

const numberLabel = (value) => value == null || !Number.isFinite(Number(value))
  ? '미확인' : String(Number(value));
const cycleKey = (cycle) => `${cycle.offset}|${cycle.year}|${cycle.majorWeek}|${cycle.startDate}`;
const cycleLabel = (cycle) => `${cycle.year ?? '연도 미확인'} / ${cycle.majorWeek ?? '차수 미확인'}차`;
const inCycle = (row, cycle) => Number(row.year) === cycle.year
  && String(row.orderWeek).split('-')[0] === cycle.majorWeek;
const sourceLabel = (plan) => plan.sourceOrderWeek
  ? `${plan.sourceYear ?? '연도 미확인'}/${plan.sourceOrderWeek}` : '입고 원천 미지정';

function QuantityCell({ day, row, drafts, actuals }) {
  const mixedActuals = actuals.flatMap((actual, actualIndex) => (actual.shipmentDates || [])
    .filter((item) => String(item.date).slice(0, 10) === day.date)
    .map((item, dateIndex) => ({ ...item, unit: actual.outUnit, key: `${actualIndex}|${dateIndex}` })));
  return <>
    <div>전산 <strong>{numberLabel(day.current)}</strong></div>
    {row.unitState !== 'MATCHED' && mixedActuals.map((item) =>
      <div className="wcm-muted" key={`actual|${item.key}`}>{numberLabel(item.shipmentQuantity)} {item.unit || '단위 미확인'}</div>)}
    {drafts.length > 0 && <div className="wcm-draft">초안 {day.planned != null
      ? <strong>{numberLabel(day.planned)}</strong>
      : drafts.map((plan, index) => <div key={`draft|${plan.id}|${index}`}>{numberLabel(plan.quantity)} {plan.unit || '단위 미확인'}</div>)}</div>}
    {day.delta != null && <div className={day.delta === 0 ? 'wcm-muted' : 'wcm-delta'}>
      변경 {day.delta > 0 ? '+' : ''}{numberLabel(day.delta)}
    </div>}
    <div className="wcm-muted">잔량 미확인</div>
    {day.calendarState !== 'FOUND' && <div className="wcm-warning">달력 {day.calendarState === 'AMBIGUOUS' ? '중복' : '미확인'}</div>}
    {(day.actualOrderWeeks || []).some((week) => week !== day.orderWeek) &&
      <div className="wcm-warning">실제 {day.actualOrderWeeks.join(', ')}<br />권장 {day.orderWeek ?? '미확인'}와 다름</div>}
  </>;
}

export default function WeekdayCycleMatrix({ cycles = [], plans = [], comparisonRows = [], onMove, busy = false }) {
  const safeCycles = Array.isArray(cycles) ? cycles : [];
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeComparisons = Array.isArray(comparisonRows) ? comparisonRows : [];
  const instanceId = useId();
  const [expanded, setExpanded] = useState({});
  const [moveOpen, setMoveOpen] = useState(false);
  const [form, setForm] = useState({ id: '', quantity: '', date: '', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const submitLock = useRef(false);
  const pendingEventId = useRef(null);
  const disabled = busy || moving;
  const panels = useMemo(() => [...safeCycles].sort((a, b) => a.offset - b.offset)
    .map((cycle) => ({ cycle, rows: buildWeekdayMatrix(cycle, safePlans, safeComparisons) })),
  [cycles, plans, comparisonRows]);
  const validDestinations = safeCycles.filter((cycle) => cycle.calendarState === 'FOUND')
    .flatMap((cycle) => cycle.days.filter((day) => day.calendarState === 'FOUND')
      .map((day) => ({ cycle, day })));
  const selectedPlan = safePlans.find((plan) => String(plan.id) === form.id);
  const outsidePlans = safePlans.filter((plan) => !safeCycles.some((cycle) => inCycle(plan, cycle)));
  const outsideComparisons = safeComparisons.filter((row) => !safeCycles.some((cycle) => inCycle(row, cycle)));

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
    <header className="wcm-heading">
      <div><h2>전산 조회 / 초안 (아직 미적용)</h2>
        <p className="wcm-muted">목→수 7일 · 01 목~일 / 02 월~수 · 잔량은 미확인 · 화면 초안은 새로고침 시 사라집니다.</p></div>
      {safePlans.length > 0 && <button type="button" disabled={disabled} onClick={openMove}>초안 날짜·차수 이동</button>}
    </header>

    {moveOpen && <section className="wcm-move" aria-label="미적용 초안 이동">
      <div className="wcm-heading"><strong>초안 이동 · 입고 원천 유지 · ERP 미적용</strong>
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

    {panels.length > 0 && <nav className="wcm-cycle-links" aria-label="전후 차수 연결">
      {panels.map(({ cycle }, index) => <span key={`link|${cycleKey(cycle)}|${index}`}>
        {index > 0 && <span className="wcm-arrow" aria-hidden="true"> ↔ </span>}
        <button type="button" aria-expanded={expanded[cycleKey(cycle)] ?? cycle.offset === 0}
          aria-controls={`${instanceId}-cycle-${index}`} onClick={() => setExpanded((previous) => ({ ...previous, [cycleKey(cycle)]: true }))}>
          {cycle.offset < 0 ? '이전' : cycle.offset > 0 ? '다음' : '현재'} {cycleLabel(cycle)}
        </button>
      </span>)}
    </nav>}
    {!panels.length && <p className="wcm-muted">전산 달력을 조회하면 이전·현재·다음 차수를 연결해 표시합니다.</p>}

    {panels.map(({ cycle, rows }, cycleIndex) => {
      const key = cycleKey(cycle);
      const open = expanded[key] ?? cycle.offset === 0;
      const scopedPlans = safePlans.filter((plan) => inCycle(plan, cycle));
      const scopedActuals = safeComparisons.filter((row) => inCycle(row, cycle));
      const outsideDrafts = scopedPlans.filter((plan) => !cycle.days.some((day) => day.date === plan.date));
      const outsideCount = rows.reduce((sum, row) => sum + row.outside.length, 0) + outsideDrafts.length;
      const mismatchCount = rows.reduce((sum, row) => sum + row.days.filter((day) =>
        (day.actualOrderWeeks || []).some((week) => week !== day.orderWeek)).length, 0);
      return <section key={`panel|${key}|${cycleIndex}`} className={`wcm-panel${cycle.offset === 0 ? ' wcm-current' : ''}`}>
        <div className="wcm-heading">
          <div><h3>{cycle.offset < 0 ? '이전' : cycle.offset > 0 ? '다음' : '현재'} {cycleLabel(cycle)}</h3>
            <div>{cycle.startDate} ~ {cycle.endDate} · 품목 {rows.length}개 · 초안 {scopedPlans.length}건
              {' · 실제 세부차수 불일치 '}{mismatchCount}칸 · 날짜 범위 밖 {outsideCount}건</div></div>
          <button type="button" aria-expanded={open} aria-controls={`${instanceId}-cycle-${cycleIndex}`}
            onClick={() => setExpanded((previous) => ({ ...previous, [key]: !open }))}>{open ? '상세 접기' : '상세 펼치기'}</button>
        </div>
        {cycle.calendarState !== 'FOUND' && <p className="wcm-warning">차수 전산 달력 미확인 · 이동 대상으로 사용할 수 없습니다.</p>}
        {rows.length > 0 && <div className="wcm-summary" aria-label="품목별 수량 요약">
          {rows.map((row, index) => <span key={`summary|${key}|${row.prodKey}|${index}`}>
            {row.name}: 전산 {numberLabel(row.currentTotal)} / 초안 {numberLabel(row.plannedTotal)}
            {' '}{row.unit || '(단위 확인 필요)'}{row.fixed ? ' · 확정 검토' : ''}
            {row.currentTotal != null && row.plannedTotal != null && <>
              {' · 변경 '}{row.plannedTotal > row.currentTotal ? '+' : ''}{numberLabel(row.plannedTotal - row.currentTotal)}
            </>}
          </span>)}
        </div>}
        {outsideCount > 0 && <div className="wcm-outside" role="note">
          <strong>날짜 범위 밖 {outsideCount}건 · 합계에는 포함, 7일 칸에는 별도 표시</strong>
          {rows.flatMap((row, rowIndex) => row.outside.map((item, index) =>
            <div key={`outside-actual|${key}|${row.prodKey}|${rowIndex}|${index}`}>
              전산 {row.name} · {String(item.date).slice(0, 10)} · 실제 {cycle.year}/{item.orderWeek}
              {' · '}{numberLabel(item.shipmentQuantity)} {row.unit || '단위 확인 필요'}
            </div>))}
          {outsideDrafts.map((plan, index) => <div key={`outside-draft|${key}|${plan.id}|${index}`}>
            초안 {plan.prodName || `품목 ${plan.prodKey}`} · {plan.date || '날짜 미지정'} · {plan.year}/{plan.orderWeek}
            {' · '}{numberLabel(plan.quantity)} {plan.unit || '단위 미확인'} · {sourceLabel(plan)}
          </div>)}
        </div>}
        <div id={`${instanceId}-cycle-${cycleIndex}`} hidden={!open}>
          <div className="wcm-table-scroll" tabIndex={0} role="region" aria-label={`${cycleLabel(cycle)} 요일별 표, 가로 스크롤 가능`}>
            <table>
              <caption>{cycleLabel(cycle)} · 전산 조회와 미적용 초안 · 단위가 다른 수량은 합산하지 않음</caption>
              <thead>
                <tr><th rowSpan={2} scope="col">품목 / 사용 입고 원천</th>
                  <th colSpan={4} scope="colgroup">{cycle.majorWeek ?? '?'}-01 · 목~일</th>
                  <th colSpan={3} scope="colgroup">{cycle.majorWeek ?? '?'}-02 · 월~수</th>
                  <th rowSpan={2} scope="col">차수 합계</th></tr>
                <tr>{cycle.days.map((day, index) => <th key={`day-header|${key}|${day.date}|${index}`} scope="col">
                  {day.label}<div className="wcm-muted">{day.date}</div>
                </th>)}</tr>
              </thead>
              <tbody>{rows.map((row, rowIndex) => {
                const productPlans = scopedPlans.filter((plan) => Number(plan.prodKey) === row.prodKey);
                const productActuals = scopedActuals.filter((actual) => Number(actual.prodKey) === row.prodKey);
                const totalDelta = row.currentTotal != null && row.plannedTotal != null ? row.plannedTotal - row.currentTotal : null;
                return <tr key={`product|${key}|${row.prodKey}|${rowIndex}`}>
                  <th scope="row"><strong>{row.name}</strong><div className="wcm-muted">품목 {row.prodKey} · {row.unit || '단위 확인 필요'}</div>
                    {(row.sources.length ? row.sources : ['입고 원천 미지정']).map((source, index) =>
                      <div className="wcm-source" key={`source|${key}|${row.prodKey}|${source}|${index}`}>
                        {productPlans.length > 0 ? '초안 원천: ' : ''}{source}
                      </div>)}
                    {productActuals.length > 0 && productPlans.length > 0 && <div className="wcm-muted">전산: 입고 원천 미지정</div>}
                    <div className="wcm-muted">요일별 입고 원천은 추정하지 않음</div>
                    {row.fixed && <div className="wcm-warning">전산 확정 포함 · 초안만 편집</div>}
                  </th>
                  {row.days.map((day, index) => <td key={`cell|${key}|${row.prodKey}|${day.date}|${index}`}>
                    <QuantityCell day={day} row={row} drafts={productPlans.filter((plan) => plan.date === day.date)} actuals={productActuals} />
                  </td>)}
                  <td className="wcm-total"><div>전산 <strong>{numberLabel(row.currentTotal)}</strong></div>
                    {productPlans.length > 0 && <div className="wcm-draft">초안 <strong>{numberLabel(row.plannedTotal)}</strong></div>}
                    {totalDelta != null && <div className="wcm-delta">변경 {totalDelta > 0 ? '+' : ''}{numberLabel(totalDelta)}</div>}
                    <div className="wcm-muted">잔량 미확인</div>
                    {row.unitState !== 'MATCHED' && <div className="wcm-warning">단위 확인 · 합산 불가</div>}
                    {row.outside.length > 0 && <div className="wcm-warning">범위 밖 전산 {row.outside.length}건 포함</div>}
                  </td>
                </tr>;
              })}
              {!rows.length && <tr><td colSpan={9}>이 차수에 조회된 품목 또는 초안이 없습니다. 재고 0을 의미하지 않습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>;
    })}

    {(outsidePlans.length > 0 || outsideComparisons.length > 0) && <aside className="wcm-outside" aria-label="연결 조회 범위 밖 자료">
      <strong>연결 차수 범위 밖 · 초안 {outsidePlans.length}건 / 전산 대조 {outsideComparisons.length}건 (별도 보존)</strong>
      {outsidePlans.map((plan, index) => <div key={`unscoped-plan|${plan.id}|${index}`}>
        초안 {plan.prodName || `품목 ${plan.prodKey}`} · {plan.year}/{plan.orderWeek} · {plan.date || '날짜 미지정'}
        {' · '}{numberLabel(plan.quantity)} {plan.unit || '단위 미확인'} · {sourceLabel(plan)}
      </div>)}
      {outsideComparisons.map((row, index) => <div key={`unscoped-actual|${row.year}|${row.orderWeek}|${row.prodKey}|${index}`}>
        전산 {row.prodName || `품목 ${row.prodKey}`} · {row.year}/{row.orderWeek} · 날짜 {(row.shipmentDates || []).length
          ? row.shipmentDates.map((item) => String(item.date).slice(0, 10)).join(', ') : '날짜행 없음'}
      </div>)}
    </aside>}

    <style>{`
      .weekday-cycle-matrix { width:100%; min-width:0; box-sizing:border-box; color:#172b42; font-size:13px; line-height:1.5; }
      .weekday-cycle-matrix * { box-sizing:border-box; }
      .weekday-cycle-matrix h2 { margin:0; font-size:17px; }
      .weekday-cycle-matrix h3 { margin:0 0 3px; font-size:15px; }
      .weekday-cycle-matrix p { margin:6px 0; }
      .weekday-cycle-matrix .wcm-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
      .weekday-cycle-matrix button { border:1px solid #8da5bd; border-radius:5px; background:#fff; color:#172b42; padding:6px 10px; font:inherit; cursor:pointer; }
      .weekday-cycle-matrix button:disabled { opacity:.55; cursor:not-allowed; }
      .weekday-cycle-matrix button:focus-visible, .weekday-cycle-matrix input:focus-visible, .weekday-cycle-matrix select:focus-visible, .weekday-cycle-matrix .wcm-table-scroll:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
      .weekday-cycle-matrix .wcm-muted { color:#526277; font-size:13px; }
      .weekday-cycle-matrix .wcm-draft, .weekday-cycle-matrix .wcm-delta { color:#174e9c; }
      .weekday-cycle-matrix .wcm-warning { color:#805100; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-error { color:#a51a24; background:#fff0f1; padding:8px; border:1px solid #e5a3a9; }
      .weekday-cycle-matrix .wcm-status { color:#164e63; background:#ecfeff; padding:8px; }
      .weekday-cycle-matrix .wcm-cycle-links { display:flex; flex-wrap:wrap; gap:5px; margin:10px 0; }
      .weekday-cycle-matrix .wcm-arrow { color:#526277; }
      .weekday-cycle-matrix .wcm-panel { min-width:0; width:100%; padding:10px; margin:8px 0; border:1px solid #bdcbd9; border-radius:7px; background:#fff; }
      .weekday-cycle-matrix .wcm-current { border:2px solid #507cab; }
      .weekday-cycle-matrix .wcm-summary { display:flex; flex-wrap:wrap; gap:5px 14px; margin:7px 0; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-outside { padding:8px; margin:8px 0; background:#fffbeb; border:1px solid #dfc788; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-table-scroll { width:100%; overflow-x:auto; }
      .weekday-cycle-matrix table { width:100%; min-width:1080px; border-collapse:collapse; table-layout:fixed; font-size:13px; }
      .weekday-cycle-matrix caption { text-align:left; color:#526277; padding:5px 0; }
      .weekday-cycle-matrix th, .weekday-cycle-matrix td { border:1px solid #c3cfdb; padding:7px; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
      .weekday-cycle-matrix thead th { background:#edf3f9; text-align:center; }
      .weekday-cycle-matrix thead tr:first-child th:first-child { width:220px; }
      .weekday-cycle-matrix thead tr:first-child th:last-child { width:135px; }
      .weekday-cycle-matrix tbody th { font-weight:normal; background:#f8fafc; }
      .weekday-cycle-matrix .wcm-total { background:#f1f6fb; }
      .weekday-cycle-matrix .wcm-source { margin-top:3px; }
      .weekday-cycle-matrix .wcm-move { border:1px solid #7ba0cb; background:#f3f8ff; border-radius:7px; padding:10px; margin:10px 0; }
      .weekday-cycle-matrix .wcm-form { display:grid; grid-template-columns:minmax(230px,2fr) minmax(100px,.7fr) minmax(210px,1.4fr) minmax(200px,1.5fr); gap:8px; margin:8px 0; }
      .weekday-cycle-matrix label { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .weekday-cycle-matrix input, .weekday-cycle-matrix select { width:100%; min-width:0; font:inherit; padding:7px; border:1px solid #9aaec4; border-radius:4px; background:#fff; color:#172b42; }
      @media (max-width:1000px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width:560px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:minmax(0,1fr); } .weekday-cycle-matrix .wcm-panel { padding:7px; } }
    `}</style>
  </section>;
}
