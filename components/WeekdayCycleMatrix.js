import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { buildHorizontalWeekdayMatrix, horizontalCycleKey, horizontalEditPayload,
  horizontalPrintReason, validateHorizontalQuantity, hasHorizontalShipmentQuantity } from '../lib/weekdayHorizontalMatrix.js';
import { horizontalCycleColumns, weekdayQuantityLabel, weekdayProductLabel } from '../lib/weekdayHorizontalMatrix.js';
import { reconcileWeekdayQuote } from '../lib/weekdayQuoteReconciliation.js';
import { weekdayUnsavedPrintReason } from '../lib/weekdayDistributionClient.js';
import { applyWeekdayCarryoverToMatrix } from '../lib/weekdayCarryover.js';
import { resolveWeekdayPrintReadiness } from '../lib/weekdayPrintReadiness.js';

const numberLabel = (value) => value == null || !Number.isFinite(Number(value))
  ? '미확인' : String(Number(value));
const cycleKey = horizontalCycleKey;
const cycleLabel = (cycle) => `${cycle.year ?? '연도 미확인'} / ${cycle.majorWeek ?? '차수 미확인'}차`;
const sourceLabel = (plan) => plan.sourceOrderWeek
  ? `${plan.sourceYear ?? '연도 미확인'}/${plan.sourceOrderWeek}` : '입고 원천 미지정';

const wilsonWeekdays = ['목','금','토','일','월','화','수'];
function displayCycleColumns(cycle, selectedDay) {
  return horizontalCycleColumns(cycle).flatMap(column => column.kind === 'day' && column.day.label === selectedDay
    ? [column,{...column,kind:'wilson'},{...column,kind:'dayTotal'}]
    : column.kind === 'remaining01' ? [{...column,kind:'sum01'},column]
    : column.kind === 'remainingMajor' ? [{...column,kind:'sum02'},{...column,kind:'remaining02'},column] : [column]);
}

function WilsonCell({row,block,day,split,disabled,onEditWilson,onSelect}) {
  const [input,setInput]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const lock=useRef(false);
  async function save(classificationOnly=false) {
    if(!classificationOnly && input === null) return;
    if(lock.current || disabled || typeof onEditWilson!=='function' || day.editDisabledReason || split.error && !classificationOnly) return;
    const checked=validateHorizontalQuantity(input ?? String(split.wilson ?? split.savedWilson ?? 0));
    if(checked.state!=='VALID') {if(checked.error)setError(checked.error);return;}
    const total=classificationOnly ? split.savedTotal : split.total-split.wilson+checked.quantity;
    if(total==null || classificationOnly && checked.quantity>total){setError('윌슨 분류량은 저장된 합계 이하여야 합니다.');return;}
    lock.current=true;setSaving(true);setError('');
    try {
      const result=await onEditWilson({row,block,day,quantity:checked.quantity,currentTotal:split.savedTotal,totalQuantity:total,classificationOnly});
      if(result===false || result?.success===false || result?.error)throw new Error(result?.error || '윌슨 기록 실패');
      setInput(null);
    }catch(failure){setError(failure.message || '윌슨 기록 실패 · 입력 유지');}
    finally{lock.current=false;setSaving(false);}
  }
  return <div className="wcm-wilson-cell"><input type="text" inputMode="decimal" aria-label={`${row.name} ${day.date} 윌슨 수량`} value={input ?? (split.wilson==null?'':String(split.wilson))}
    disabled={disabled || saving || Boolean(day.editDisabledReason) || split.total==null || typeof onEditWilson!=='function'}
    onChange={event=>setInput(event.target.value)} onBlur={()=>save()} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent?.isComposing){event.preventDefault();event.currentTarget.blur();}if(event.key==='Escape'){setInput(null);setError('');}}}/>
    <button type="button" disabled={disabled || saving || Boolean(day.editDisabledReason) || split.savedTotal==null || typeof onEditWilson!=='function'}
      onMouseDown={event=>event.preventDefault()} onClick={()=>save(true)} title="ERP 합계를 유지하고 일반·윌슨 분류만 저장">분류</button>
    {split.draft && <small className="wcm-inline-status wcm-draft">초안</small>}
    {split.error && <button type="button" className="wcm-warning" onClick={()=>onSelect(`${split.error}\n최신 합계 안에서 윌슨 수량을 입력한 뒤 분류 버튼으로 확인하세요.`)}>재확인 · 분류</button>}
    {error && <small role="alert" className="wcm-error">{error}</small>}
  </div>;
}

// Keep each number + unit together; only the visual label wraps, never the raw input.
function QuantityLabel({ children }) {
  const label = String(children);
  const review = label.includes('환산 확인');
  // Review-only raw decimals may exceed a narrow day column with the unit attached.
  const parts = label.split(review
    ? /(\s+|(?<=박스|단|송이)(?=[+-]?\d)|(?<=\d)(?=박스|단|송이))/u
    : /(\s+|(?<=박스|단|송이)(?=[+-]?\d))/u).filter(Boolean);
  return <span className="wcm-quantity-label">{parts.map((part, index) => /^\s+$/u.test(part)
    ? part : <span className={`wcm-quantity-part${review && /^\(?[+-]?\d+(?:\.\d+)?\)?$/u.test(part)?' wcm-quantity-raw':''}`} key={index}>{part}</span>)}</span>;
}

const cellDescription = (row, block, day) => [
  `${row.name} · ${block.cycle.year}/${day.effectiveOrderWeek ?? '?'} · ${day.date}`,
  `전산 ${numberLabel(day.current)} / 미적용 초안 ${numberLabel(day.planned)} / 차이 ${numberLabel(day.delta)} ${day.unit ?? ''}`,
  ...day.actualDetails.map((item) => `전산 원문 ${item.orderWeek}: ${numberLabel(item.shipmentQuantity)} ${item.unit || '단위 미확인'}`),
  ...day.drafts.map((plan) => `초안 ${plan.id}: ${numberLabel(plan.quantity)} ${plan.unit || '단위 미확인'} · ${sourceLabel(plan)}`),
  day.assignedWeekMismatch ? `실제 ${day.actualOrderWeeks.join(', ')} / 달력 권장 ${day.orderWeek}` : '',
  block.fixed ? '확정 전산 포함 · 편집은 미적용 초안만' : '', day.editDisabledReason,
].filter(Boolean).join('\n');

function QuantityCell({ day, row, block, disabled, disabledReason, onEditCell, onSelect, onOpenNote }) {
  const [input, setInput] = useState(null);
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const lastSubmitted = useRef(null);
  const inputControl = useRef(null);
  const visibleQuantity = day.planned ?? day.displayCurrent ?? day.current;
  const value = input ?? (visibleQuantity == null ? '' : String(visibleQuantity));
  const reason = day.editDisabledReason || (typeof onEditCell !== 'function' ? '초안 편집 기능 미연결' : '');
  const description = cellDescription(row, block, day);
  const blockedReason = reason || (disabled ? disabledReason || '조회·저장 확인 또는 초안 이동 처리 중입니다.' : saving ? '초안 입력 처리 중입니다.' : '');
  function focusQuantity(event) {
    if (event.target.closest?.('button,input')) return;
    if (blockedReason) { onSelect(`${description}\n편집 불가: ${blockedReason}`); return; }
    inputControl.current?.focus(); inputControl.current?.select();
  }
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
  return <div className={`wcm-cell${day.knownEmpty?' wcm-unallocated':''}${day.planned != null ? ' wcm-proposed' : ''}${changed?' wcm-changed':''}${early?' wcm-early':''}${blockedReason?' wcm-readonly':' wcm-editable'}`} onClick={focusQuantity} title={`${day.knownEmpty?'미분배 · ':''}${description}\n최초 ${numberLabel(day.initial)}${early?`\n수동확인 ${early.sourceYear}/${early.sourceOrderWeek}차 선출고 ${early.quantity} ${early.unit}`:''}${blockedReason ? `\n편집 불가: ${blockedReason}` : '\n숫자 클릭: 원본 수량 초안 편집 · Enter/다른 칸 클릭으로 초안 기록'}`}>
    <span className="wcm-number-display" aria-hidden="true"><QuantityLabel>{weekdayQuantityLabel(visibleQuantity,row,day.unit,block.packaging)}</QuantityLabel></span>
    <input ref={inputControl} type="text" inputMode="decimal" value={value} placeholder="—" disabled={disabled || saving || Boolean(reason)}
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
    <div className="wcm-cell-detail">{day.planned!=null && <small className="wcm-original">초안 · 저장 <QuantityLabel>{weekdayQuantityLabel(day.displayCurrent ?? day.current,row,day.unit,block.packaging)}</QuantityLabel></small>}{changed && <small className="wcm-original"><QuantityLabel>{`(${weekdayQuantityLabel(day.initial,row,day.unit,block.packaging)})`}</QuantityLabel></small>}
    {(day.delta != null && day.delta !== 0 || reason) && <button type="button" className="wcm-cell-info"
      aria-label={`${row.name} ${day.date} 수량 내역`} onClick={() => onSelect(`${description}\n${reason}`)}>
      {day.delta != null && day.delta !== 0 ? <>Δ{day.delta > 0 ? '+' : ''}<QuantityLabel>{weekdayQuantityLabel(day.delta,row,day.unit,block.packaging)}</QuantityLabel></> : '!'}</button>}</div>
    {failure && <span className="wcm-cell-error" role="alert">{failure}</span>}
    {early && <button type="button" className="wcm-early-label" aria-label={`${row.name} ${day.date} 선출고 비고`} onClick={()=>onOpenNote?.({row,block})}>{early.sourceOrderWeek.slice(0,2)}차 선출고 <QuantityLabel>{weekdayQuantityLabel(early.quantity,row,early.unit,block.packaging)}</QuantityLabel>{earlyNeedsReview?' · 재확인':''}</button>}
  </div>;
}

function PrintButton({ label, reason, onClick, className = '', visibleLabel = label }) {
  return <span title={reason || 'ERP 저장된 확정 견적만 출력 · 미적용 초안 제외'}>
    <button type="button" className={className} disabled={Boolean(reason)} aria-label={label}
      onClick={onClick}>{visibleLabel}</button>
  </span>;
}

const confirmationLabels = {
  FIXED: 'ERP확정', PARTIAL: 'ERP부분확정', UNFIXED: 'ERP미확정',
  EMPTY: 'ERP자료 없음', UNKNOWN: 'ERP확정 미확인',
};
const compactCategoryLabel = name => String(name).replace(/^(콜롬비아|네덜란드|에콰도르|베트남|이탈리아|중국|태국|호주|일본|케냐)\s*/u,
  country => `${({'콜롬비아':'콜','네덜란드':'네덜','에콰도르':'에콰','베트남':'베','이탈리아':'이탈','중국':'중','태국':'태','호주':'호','일본':'일','케냐':'케'})[country.trim()]} `);

function ConfirmationBadges({ cycle, states, busy, error }) {
  const matches = (Array.isArray(states) ? states : []).filter(item =>
    Number(item.year) === Number(cycle.year) && String(item.majorWeek) === String(cycle.majorWeek));
  const record = matches.length === 1 && matches[0].allCustomers !== false ? matches[0] : null;
  const categories = Array.isArray(record?.categories) ? record.categories : [];
  const scope = `${cycle.year}/${cycle.majorWeek}차 · 전체 거래처·대차수 전체 세부차수 범위 · 선택 거래처/화면 필터와 무관\nERP 출고 상세 확정 · 저장 가능/재고 마감/인쇄 완전성 보장 아님`;
  const stateLabel = state => confirmationLabels[state] || confirmationLabels.UNKNOWN;
  const warningCount = count => Number.isInteger(Number(count)) && Number(count) > 0 ? Number(count) : 0;
  const scopedError = record?.error || (!record ? error : '');
  if (busy || scopedError || !record) return <span className="wcm-confirmation wcm-warning" title={`${scope}\n${scopedError || (busy ? '권위 있는 ERP 확정 상태 조회 중' : '확정 상태 미확인 · 확정으로 간주하지 않음')}`}>
    {scopedError ? 'ERP확정 미확인 · 조회 실패' : busy ? 'ERP확정 조회 중…' : confirmationLabels.UNKNOWN}
  </span>;
  const globalWarnings = warningCount(record.warningCount);
  const globalTitle = `${scope}\n대차수 전체 상태: ${stateLabel(record.state)} · 연결경고 ${globalWarnings}건 · 식별불명 ${numberLabel(record.unknownCount)}건`;
  return <details className="wcm-confirmation-disclosure"><summary>ERP 확정 상세 · {stateLabel(record.state)}{globalWarnings > 0 ? ` · 연결경고 ${globalWarnings}건` : ''}</summary><span className="wcm-confirmations">
    <span className={`wcm-confirmation${record.state === 'FIXED' && !globalWarnings ? ' wcm-fixed' : ' wcm-warning'}`} title={globalTitle} aria-label={globalTitle}>{stateLabel(record.state)}{record.state === 'FIXED' ? ' ✓' : ''}{globalWarnings > 0 ? ` · 연결경고 ${globalWarnings}건` : ''}</span>
    {['PARTIAL','UNFIXED'].includes(record.state) && <span className="wcm-confirmation wcm-warning" title={`${scope}\n미확정 출고 상세 물량은 견적에서 제외 · 인쇄 완전성 보장 아님`}>미확정 물량은 견적에서 제외</span>}
    {categories.map((category, index) => {
      const name = String(category.countryFlower || '품종 미확인');
      const state = category.state in confirmationLabels ? category.state : 'UNKNOWN';
      const warnings = warningCount(category.warningCount);
      const title = `${scope}\n${name} · ${stateLabel(state)} · 확정 ${numberLabel(category.fixedCount)} / 전체 ${numberLabel(category.totalCount)}건 · 연결경고 ${warnings}건 · 식별불명 ${numberLabel(category.unknownCount)}건 · 세부차수 ${(Array.isArray(category.orderWeeks) ? category.orderWeeks : []).join(', ') || '미확인'}`;
      return <span key={`${name}|${index}`} className={`wcm-confirmation${state === 'FIXED' && !warnings ? ' wcm-fixed' : ' wcm-warning'}`}
        title={title} aria-label={title}>{compactCategoryLabel(name)} {state === 'FIXED' ? warnings ? '확정·연결경고!' : '✓' : state === 'PARTIAL' ? '부분 !' : state === 'UNFIXED' ? '미확정 !' : state === 'EMPTY' ? '자료 없음' : '미확인 ?'}</span>;
    })}
  </span></details>;
}

// A real button/popover supplements title text for touch and keyboard users.
function SummaryDetails({ label, description, visibleLabel = '내역' }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const panel = useRef(null);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" className="wcm-summary-details" aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} title={description} onClick={() => setOpen(true)}>{visibleLabel}</button>
    {open && <div ref={panel} className="wcm-detail-popover" role="dialog" aria-modal="false" aria-label={label}
      tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="wcm-toolbar"><strong>{label}</strong><button type="button" onClick={close} aria-label={`${label} 닫기`}>닫기</button></div>
      <pre>{description}</pre>
    </div>}
  </>;
}

function CompactSummary({ row, block, disabled, carryover, carryoverBusy, carryoverError, hasCustomer,
  onOpenCarryover, onOpenNote, onSelect, customer, custKey }) {
  const remainder = block.remainderMajorView;
  const value = remainder?.value;
  const carry = block.carryover;
  const carryFailure = carryoverError ? '이월 조회 실패 · 새로고침 필요' : carry?.error
    ? `이월 확인 필요 · ${typeof carry.error === 'string' ? carry.error : carry.error.message || '계산 근거 확인 필요'}` : '';
  const carryDescription = carryFailure || (carry?.active
    ? `이월 ${carry.source ? `${carry.source.year ?? '?'} / ${carry.source.majorWeek ?? '?'}차 · ` : ''}${numberLabel(carry.incoming)} ${block.unit || ''}${carry.incomingProvisional ? ' · 이월 미확정 예상' : ''}${carry.incomingHasDraft ? ' · 이월 초안 예상' : ''}${carry.manual ? ' · 수동 마감' : ''}${carry.provisional ? ' · 미확정 예상' : ''}${carry.hasDraft ? ' · 초안 예상' : ''}`
    : carryoverBusy ? '이월 조회 중…' : carryover ? '이월 미등록' : '이월 조회 필요');
  const description = [
    `${row.name} · ${cycleLabel(block.cycle)} · 최초기준 비교값 · ERP재고 아님`,
    `합계 ${numberLabel(block.effectiveTotal)} / 저장 전산 ${numberLabel(block.currentTotal)} / 미적용 초안 ${numberLabel(block.plannedTotal)} ${block.unit || ''}`,
    `마감 잔량 ${numberLabel(value)} · ${remainder?.label || '잔량 미확인'}${remainder?.hasProvisional ? ' · 기준 미확정' : ''} · 저장 전산 기준잔량 ${numberLabel(remainder?.savedValue)}`,
    carryDescription,
    `최초 ${numberLabel(block.initialMajor)} · 저장 변경 ${numberLabel(block.initialChange)} · 예상 변경 ${numberLabel(block.effectiveInitialChange)}`,
    `${block.quote.state}: 견적관리 ${block.quote.managementQuantity ?? '?'} / 인쇄 순수량 ${block.quote.netQuantity ?? '?'} ${block.quote.unit || ''} · 총액 ${block.quote.amount ?? '?'}원`,
    block.quote.note, block.pageNote?.note,
    '초안은 견적 출력에 포함하지 않습니다. 웹 전용 마감 잔량 수정·이력 · ERP 재고 아님',
  ].filter(Boolean).join('\n');
  const cues = [remainder?.hasDraft ? '초안' : '', carry?.manual ? '수동' : '',
    carry?.incomingHasDraft ? '이월 초안' : '',
    !value && value !== 0 ? '미확인' : ''].filter(Boolean);
  const quoteStatus = block.quote.readiness?.state==='NO_SHIPMENT' ? '분배 후' : block.quote.readiness?.state==='UNFIXED' ? '확정 대기'
    : block.quote.readiness?.state==='INVALID' ? '연결 확인' : block.quote.error ? '실패' : block.quote.state === '견적 일치' ? '일치' : block.quote.state === '견적 불일치' ? '불일치'
    : block.quote.state === '견적 없음' ? '없음' : '확인';
  return <Fragment><td className="wcm-total wcm-major-total" title={description}>
    <div className="wcm-compact-summary">
      <div className="wcm-summary-row wcm-cycle-sum" data-wcm-label="sum" data-quantity={block.effectiveTotal ?? '—'}
        aria-label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 합계`}>
        <span className="wcm-summary-label">합계</span><span className="wcm-summary-value wcm-sum-value" title="초안이 있으면 예상 합계, 없으면 저장 분배 합계">
          <SummaryDetails label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 요약 내역`}
            visibleLabel={<QuantityLabel>{weekdayQuantityLabel(block.effectiveTotal,row,block.unit,block.packaging)}</QuantityLabel>} description={description}/>
          {block.productPlans.length > 0 && <small className="wcm-inline-status wcm-draft">초안</small>}
        </span>
      </div>
      <div className="wcm-summary-row wcm-summary-actions">
        <span className="wcm-summary-label">견적</span><div className="wcm-summary-value"><button type="button" className={`wcm-quote${block.quote.state === '견적 불일치' || block.quote.error ? ' wcm-warning' : ''}`}
          data-quantity={block.quote.managementQuantity ?? block.quote.netQuantity ?? '—'} title={`견 ${block.quote.managementQuantity ?? block.quote.netQuantity ?? '—'} · ${block.quote.state}${block.quote.error ? ' · 조회 실패 상세는 버튼 클릭' : ''} · 저장 견적만 포함`}
          aria-label={`${row.name} ${block.cycle.majorWeek}차 견적 대조 · ${block.quote.state}${block.quote.error ? ' · 조회 실패' : ''}`} onClick={() => onSelect(block.quote.error
            ? `견적 조회 실패 · ${block.cycle.year}/${block.cycle.majorWeek}차\n상태: ${block.quote.state}\n오류: ${String(block.quote.error)}`
            : `${block.quote.state}\n견적관리 ${block.quote.managementQuantity ?? '?'} / 인쇄 ${block.quote.netQuantity ?? '?'} ${block.quote.unit || ''}\n저장 분배 ${numberLabel(block.currentTotal)} / 예상 합계 ${numberLabel(block.effectiveTotal)}\n초안은 견적 출력에 포함하지 않습니다.`)}>
          <small className="wcm-inline-status wcm-quote-status"><span>견적</span><span>{quoteStatus}</span></small>
        </button>
        </div>
      </div>
    </div></td><td className={`wcm-total wcm-major-total${remainder?.hasProvisional || carry?.incomingProvisional?' wcm-provisional':''}${remainder?.hasDraft?' wcm-draft':''}`} title={description}><div className="wcm-compact-summary">
      <div className="wcm-summary-row wcm-major-heading">
        <span className="wcm-summary-label" title="마감 잔량">잔량</span><div className="wcm-summary-value">
          <button type="button" className={`wcm-remainder-action wcm-remainder-value${remainder?.hasDraft ? ' wcm-draft' : ''}`}
            data-wcm-label="remainder" data-quantity={value ?? '—'}
            disabled={disabled || carryoverBusy || !carryover || !hasCustomer || !block.unit || block.cycle.calendarState !== 'FOUND' || typeof onOpenCarryover !== 'function'}
            aria-label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 마감 잔량 수정·이력`}
            title={`${remainder?.label || '잔량 미확인'}${remainder?.hasProvisional ? ' · 기준 미확정' : ''} · 웹 전용 마감 잔량 수정·이력 · ERP 재고 아님`}
            onClick={event => onOpenCarryover({row,block,trigger:event.currentTarget,record:carryover.records.find(record => Number(record.year) === Number(block.cycle.year)
              && String(record.majorWeek) === String(block.cycle.majorWeek) && Number(record.custKey) === Number(customer?.CustKey ?? customer?.custKey ?? custKey) && Number(record.prodKey) === row.prodKey)})}>
            <QuantityLabel>{weekdayQuantityLabel(value,row,block.unit,block.packaging)}</QuantityLabel><span aria-hidden="true">✎</span>
          </button>
          {cues.map(cue => <small key={cue} className={`wcm-inline-status${cue.includes('초안') ? ' wcm-draft' : ''}`} title={`${remainder?.label || ''}${remainder?.hasProvisional ? ' · 기준 미확정' : ''}`}>{cue}</small>)}
          {carry?.active && carry.incoming !== 0 && carry.incoming != null && <span className="wcm-incoming" title={carryDescription}>이월 <QuantityLabel>{weekdayQuantityLabel(carry.incoming,row,block.unit,block.packaging)}</QuantityLabel></span>}
          {carryoverBusy && <small className="wcm-inline-status">이월 조회 중…</small>}
        </div>
      </div>
    </div></td><td className="wcm-total wcm-major-total" title={description}><div className="wcm-compact-summary">
          <button type="button" className="wcm-change-note" title={`최초 대비 변경량 · 비고 보기/입력\n${description}`} aria-label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 변경 비고`}
            onClick={() => typeof onOpenNote === 'function' ? onOpenNote({row,block}) : onSelect(`최초 ${numberLabel(block.initialMajor)} / 저장 ${numberLabel(block.currentTotal)} / 예상 ${numberLabel(block.effectiveTotal)} / 예상 변경 ${numberLabel(block.effectiveInitialChange)}`)}>
            {block.effectiveInitialChange == null ? 'Δ—' : <>Δ{block.effectiveInitialChange > 0 ? '+' : ''}<QuantityLabel>{weekdayQuantityLabel(block.effectiveInitialChange,row,block.unit,block.packaging)}</QuantityLabel></>}{block.pageNote?.note ? ' ✎' : ''}
          </button>


    </div>
    {carryFailure && <div className="wcm-carry-line wcm-error" role="alert">{carryFailure}</div>}
  </td></Fragment>;
}

export default function WeekdayCycleMatrix({ cycles = [], plans = [], comparisonRows = [], onMove, busy = false,
  onEditCell, onPrint, printBusy = false, customer = null, custKey = null, customerProvided,
  onSearchProducts, onAddProduct, baselines = [], baselineCandidates = [], onConfirmBaseline, baselineBusy = false, onOpenNote, pageNotes = [], quoteResults = [],
  carryover = null, carryoverPlans = plans, onOpenCarryover, carryoverBusy = false, carryoverError = '', editDisabledReason = '',
  confirmationStates = [], confirmationBusy = false, confirmationError = '',
  wilsonRecords = [], wilsonDrafts = [], wilsonError = '', wilsonBusy = false, onEditWilson, onRetryQuote }) {
  const safeCycles = Array.isArray(cycles) ? cycles : [];
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeComparisons = Array.isArray(comparisonRows) ? comparisonRows : [];
  const [search, setSearch] = useState('');
  const [flower, setFlower] = useState('');
  const [wilsonDay,setWilsonDay]=useState('일');
  const [exportBusy,setExportBusy]=useState(false);
  useEffect(()=>{try {const stored=localStorage.getItem('nenova-weekday-wilson-day');if(wilsonWeekdays.includes(stored))setWilsonDay(stored);}catch {}},[]);
  const changeWilsonDay=value=>{setWilsonDay(value);try{localStorage.setItem('nenova-weekday-wilson-day',value);}catch{}};
  const [addedKeys, setAddedKeys] = useState([]);
  const [showUnallocated,setShowUnallocated] = useState(false);
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
  const topScroll = useRef(null);
  const bottomScroll = useRef(null);
  const topScrollWidth = useRef(null);
  const bottomScrollWidth = useRef(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [form, setForm] = useState({ id: '', quantity: '', date: '', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const submitLock = useRef(false);
  const pendingEventId = useRef(null);
  const disabled = busy || moving;
  const matrix = useMemo(() => {
    const built = buildHorizontalWeekdayMatrix(safeCycles, safePlans, safeComparisons, baselines, baselineCandidates, carryover?.context?.inputs || []);
    return applyWeekdayCarryoverToMatrix(built, carryover?.context, carryover?.records || [], carryoverPlans);
  }, [cycles, plans, comparisonRows, baselines, baselineCandidates, carryover, carryoverPlans]);
  for(const row of matrix.rows)for(const block of row.blocks) {
    block.pageNote=pageNotes.find(note=>Number(note.year)===Number(block.cycle.year)&&String(note.majorWeek)===String(block.cycle.majorWeek)&&Number(note.prodKey)===row.prodKey);
    const result=quoteResults.find(result=>Number(result.year)===Number(block.cycle.year)&&String(result.majorWeek)===String(block.cycle.majorWeek));
    const readiness=resolveWeekdayPrintReadiness(result);
    block.quote=readiness && ['NO_SHIPMENT','UNFIXED','INVALID'].includes(readiness.state)
      ? {state:readiness.label,readiness,quantity:null,unit:null,note:`${readiness.label} · ${readiness.action}`}
      : reconcileWeekdayQuote(block,row.prodKey,readiness?.state==='ERROR' ? {...result,error:readiness.reason} : result);
  }
  const quoteReadinessForCycle = cycle => resolveWeekdayPrintReadiness(quoteResults.find(result => Number(result.year) === Number(cycle.year)
    && String(result.majorWeek) === String(cycle.majorWeek)));
  const hasCustomer = customerProvided ?? (Number(customer?.CustKey ?? customer?.custKey ?? custKey) > 0);
  const printReason = (cycle, dates, mode) => weekdayUnsavedPrintReason(safePlans,cycle,customer?.CustKey ?? customer?.custKey ?? custKey)
    || (['NO_SHIPMENT','UNFIXED','INVALID'].includes(quoteReadinessForCycle(cycle)?.state) ? quoteReadinessForCycle(cycle).label : '')
    || (busy ? '전산 조회/처리 중' : horizontalPrintReason({ cycle, dates, mode, onPrint,
    customerProvided: hasCustomer, printBusy: printBusy || printing }));
  const shipmentRows = matrix.rows.filter((row) => showUnallocated || hasHorizontalShipmentQuantity(row)
    || row.blocks.some(block=>block.productPlans.length>0) || addedKeys.includes(row.prodKey)
    || row.blocks.some(block => block.carryover?.active && block.carryover.error));
  const flowers = [...new Set(shipmentRows.flatMap((row) => row.flowerNames))].sort();
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = shipmentRows.filter((row) => (!flower || row.flowerNames.includes(flower))
    && (!query || `${row.prodKey} ${row.name} ${row.flowerNames.join(' ')}`.toLocaleLowerCase().includes(query)));
  function splitFor(row,block,day) {
    const matches=record=>Number(record.year)===Number(block.cycle.year)&&String(record.orderWeek)===String(day.effectiveOrderWeek)
      && Number(record.custKey)===Number(customer?.CustKey ?? customer?.custKey ?? custKey)&&Number(record.prodKey)===row.prodKey&&record.date===day.date;
    const record=wilsonRecords.find(matches),draft=wilsonDrafts.find(matches);
    const savedTotal=day.displayCurrent ?? day.current;
    const editableEmpty=day.knownEmpty === true && day.current==null && !day.actualDetails.length && !day.drafts.length && !day.editDisabledReason && Boolean(day.unit) && day.calendarState==='FOUND';
    const total=day.planned ?? savedTotal ?? (editableEmpty?0:null);
    const cleared=record?.status==='CLEARED';
    const savedWilson=cleared?0:record?.wilson ?? record?.wilsonQuantity ?? 0;
    const amount=draft?.wilsonQuantity ?? draft?.wilson ?? savedWilson;
    const stale=record && !cleared && (record.status!=='CURRENT' || record.unit!==day.unit || Math.abs(Number(record.expectedTotal ?? record.total)-Number(savedTotal))>1e-6);
    const invalid=total==null || !Number.isFinite(Number(amount)) || Number(amount)<0 || Number(amount)>Number(total)
      || draft && (draft.unit!==day.unit || Math.abs(Number(draft.expectedTotal ?? draft.totalQuantity ?? draft.total)-Number(total))>1e-6);
    return {savedTotal,total,savedWilson:Number(savedWilson),wilson:stale&&!draft?null:Number(amount),draft:Boolean(draft),error:wilsonError || (stale&&!draft?'ERP 수량 또는 단위가 변경되었습니다. 일반·윌슨 분류를 재확인하세요.':invalid?'합계·윌슨 수량 또는 단위를 재확인하세요.':'')};
  }
  async function exportWorkbook() {
    if(exportBusy)return;setExportBusy(true);
    try {
      const imported=await import('xlsx'),XLSX=imported.default || imported;
      const header=['품목키','품목','단위'];
      for(const cycle of matrix.cycles){for(const day of cycle.days)header.push(`${day.date} ${day.label} 합계`);header.push(`${cycle.year}/${cycle.majorWeek}-01 합계`,`${cycle.year}/${cycle.majorWeek}-01 잔량`,`${cycle.year}/${cycle.majorWeek}-02 합계`,`${cycle.year}/${cycle.majorWeek}-02 잔량`,`${cycle.year}/${cycle.majorWeek}차 잔량`);}
      const data=visibleRows.map(row=>{const values=[row.prodKey,row.name,row.blocks.map(block=>block.unit).filter(Boolean).join('/')];for(const block of row.blocks){for(const day of block.days)values.push(day.planned ?? day.displayCurrent ?? day.current);values.push(block.subweek01?.effectiveTotal ?? null,block.subweek01?.remainderView?.value ?? null,block.subweek02?.effectiveTotal ?? null,block.subweek02?.remainderView?.value ?? null,block.remainderMajorView?.value ?? null);}return values;});
      const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...data]),'요일 합계');
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['윌슨은 네노바웹에서만 구분하며 이 엑셀과 실제 견적서는 일반·윌슨을 합산합니다.'],['화면에 초안이 있으면 이 엑셀에는 초안 예상 합계가 표시됩니다. 실제 견적서는 저장된 확정 전산값을 출력합니다.']]),'안내');
      XLSX.writeFile(workbook,`주광_요일합계_${matrix.cycles.find(c=>c.offset===0)?.year || ''}_${matrix.cycles.find(c=>c.offset===0)?.majorWeek || ''}.xlsx`);
    }catch(error){setSelectedInfo(`엑셀 내보내기 실패: ${error.message}`);}finally{setExportBusy(false);}
  }
  const validDestinations = safeCycles.filter((cycle) => cycle.calendarState === 'FOUND')
    .flatMap((cycle) => cycle.days.filter((day) => day.calendarState === 'FOUND')
      .map((day) => ({ cycle, day })));
  const selectedPlan = safePlans.find((plan) => String(plan.id) === form.id);
  const { outsidePlans, outsideComparisons } = matrix;
  const diagnostics = matrix.rows.flatMap((row) => row.blocks.map((block) => ({ row, block })))
    .filter(({ block }) => block.outside.length || block.outsideDrafts.length || block.unitState !== 'MATCHED'
      && (block.productActuals.length || block.productPlans.length) || block.days.some((day) => day.assignedWeekMismatch || day.drafts.length > 1));

  useEffect(() => {
    const viewport=tableScroll.current,top=topScroll.current,bottom=bottomScroll.current;
    const table=viewport?.querySelector('table');
    if(!viewport || !top || !bottom || !table) return;
    const surfaces=[viewport,top,bottom],mirrored=new WeakMap();
    let frame=null;
    // Scroll updates stay in the DOM: no React state or table rerender per event.
    const syncFrom=source=>{
      const left=source.scrollLeft;
      if(mirrored.get(source)===left) {mirrored.delete(source);return;}
      mirrored.delete(source);
      for(const target of surfaces) if(target!==source && target.scrollLeft!==left) {
        target.scrollLeft=left;
        mirrored.set(target,target.scrollLeft);
      }
    };
    const updateWidths=()=>{
      frame=null;
      viewport.style.maxHeight=`${Math.max(240,window.innerHeight-top.getBoundingClientRect().bottom-42)}px`;
      const width=`${table.scrollWidth}px`;
      for(const spacer of [topScrollWidth.current,bottomScrollWidth.current]) {
        if(spacer && spacer.style.width!==width) spacer.style.width=width;
      }
      surfaces.forEach(surface=>mirrored.delete(surface));
      syncFrom(viewport);
    };
    const scheduleWidths=()=>{if(frame===null) frame=requestAnimationFrame(updateWidths);};
    const listeners=surfaces.map(surface=>{
      const listener=()=>syncFrom(surface);
      surface.addEventListener('scroll',listener,{passive:true});
      return [surface,listener];
    });
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(scheduleWidths):null;
    observer?.observe(table);observer?.observe(viewport);observer?.observe(top);
    window.addEventListener('resize',scheduleWidths);
    document.addEventListener('toggle',scheduleWidths,true);
    scheduleWidths();
    return ()=>{
      listeners.forEach(([surface,listener])=>surface.removeEventListener('scroll',listener));
      observer?.disconnect();window.removeEventListener('resize',scheduleWidths);
      document.removeEventListener('toggle',scheduleWidths,true);
      if(frame!==null) cancelAnimationFrame(frame);
    };
  },[matrix.cycles.length,matrix.columns.length,visibleRows.length,wilsonDay]);

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
    <div className="wcm-toolbar wcm-wilson-tools"><label>윌슨 요일<select aria-label="윌슨 구분 요일" value={wilsonDay} onChange={event=>changeWilsonDay(event.target.value)}>{wilsonWeekdays.map(day=><option key={day} value={day}>{day}요일</option>)}</select></label>
      <span className="wcm-muted">일반 + 윌슨 = 실제 견적 합계</span><button type="button" disabled={disabled || exportBusy || !visibleRows.length} onClick={exportWorkbook}>{exportBusy?'엑셀 준비 중…':'합산 엑셀'}</button>
      <label className="wcm-unallocated-toggle"><input type="checkbox" checked={showUnallocated} onChange={event=>setShowUnallocated(event.target.checked)} aria-label="미분배 품목 표시"/>미분배 품목 표시</label></div>
    {wilsonError && <p className="wcm-error" role="alert">윌슨 분류: {wilsonError}</p>}
    <details className="wcm-filter-disclosure"><summary>품목 검색·필터 펼치기 {search || flower ? '· 필터 적용 중' : ''}</summary><div className="wcm-toolbar">
      <button type="button" disabled={disabled || adding || !hasCustomer || typeof onAddProduct !== 'function'} onClick={openAdd}>품목 추가</button>
      <label className="wcm-search">품목 검색<input type="search" value={search}
        placeholder="품목명 / 품목키" onChange={(event) => setSearch(event.target.value)} /></label>
      <label>품종<select value={flower} onChange={(event) => setFlower(event.target.value)}>
        <option value="">전체 품종</option>{flowers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <span className="wcm-muted">품목 {visibleRows.length}/{shipmentRows.length} · 출고 없음 {matrix.rows.length - shipmentRows.length}개 숨김 · 현재 출고·초안 우선 · 편집은 미적용 초안</span>
      {safePlans.length > 0 && <button type="button" disabled={disabled} onClick={openMove}>초안 날짜·차수 이동</button>}
    </div>
    </details>
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
    {confirmationError && <p className="wcm-error" role="alert">ERP확정 조회 실패 · {confirmationError}</p>}
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
      if(scroll && header) scroll.scrollTo({left:Math.max(0,header.offsetLeft-(scroll.querySelector('tbody th')?.offsetWidth || 170)),behavior:'smooth'});
    }}>{cycle.offset<0?'이전':cycle.offset>0?'다음':'현재'} {cycle.majorWeek}차 보기</button>)}<span className="wcm-muted">품목 고정 · 가로 스크롤</span></nav>}
    {matrix.cycles.length > 0 && <div className="wcm-scroll-region">
      <div ref={topScroll} className="wcm-scroll-top" tabIndex={0} role="region" aria-label="요일표 상단 가로 스크롤">
        <div ref={topScrollWidth} className="wcm-scroll-width" aria-hidden="true"/>
      </div>
      <div ref={tableScroll} className="wcm-table-scroll" tabIndex={0} role="region"
      aria-label="이전·현재·다음 차수 통합 요일표, 가로 스크롤로 연결 차수 보기">
      <table style={{width:170+matrix.cycles.reduce((sum,cycle)=>sum+displayCycleColumns(cycle,wilsonDay).reduce((width,column)=>
        width+(column.kind==='remainingMajor'?3*44:column.kind==='remaining01'?48:46),0),0)}}>
        <caption>목→수 · 기준 대비 분배 잔량(ERP 재고 아님) · 미확정/초안 예상은 별도 표시 · 변경값 아래 (최초값) · 노랑=변경 · 보라=선출고 · 파랑=미적용 초안 · 품목 행 마우스 강조 · 가로 스크롤로 차수 연결.
          출력은 ERP 저장된 확정 견적만 포함하며 화면 초안은 제외합니다. 기준 화면 1920×1080 / 100%.</caption>
        <colgroup><col className="wcm-product-col" />{matrix.cycles.flatMap(cycle=>displayCycleColumns(cycle,wilsonDay)).flatMap((column, index) => Array.from({length:column.kind==='remainingMajor'?3:1},(_,part) => <col key={`${index}|${part}`} className={column.kind==='remainingMajor'?'wcm-summary-col':column.kind.startsWith('initial')?'wcm-baseline-col':column.kind==='remaining01'?'wcm-remainder-col':'wcm-day-col'} />))}</colgroup>
        <thead>
          <tr><th rowSpan={3} scope="col">품목 <span className="wcm-muted">· 단위</span></th>
            {matrix.cycles.map((cycle) => {
              const dates = (selectedDates[cycleKey(cycle)] || []).filter((value) => cycle.days.some((day) => day.date === value));
              const readiness = quoteReadinessForCycle(cycle);
              return <th key={cycleKey(cycle)} colSpan={displayCycleColumns(cycle,wilsonDay).length + 2} scope="colgroup"
                className={cycle.offset === 0 ? 'wcm-current-head' : ''}>
                <div className="wcm-cycle-header"><div className="wcm-cycle-title"><strong>{cycle.offset < 0 ? '이전' : cycle.offset > 0 ? '다음' : '현재'} {cycleLabel(cycle)}</strong>
                  <ConfirmationBadges cycle={cycle} states={confirmationStates} busy={confirmationBusy} error={confirmationError}/></div>
                  {readiness?.state==='NO_SHIPMENT' && <span className="wcm-readiness" title={readiness.action}>{readiness.label} · {readiness.action}</span>}
                  {readiness?.state==='UNFIXED' && <span className="wcm-readiness">{readiness.label} · 해당 연도·차수 전체 업체 · 확정 현황에서 {cycle.year}년 {cycle.majorWeek}차를 조회·확정한 뒤 전산 새로고침 · <a href="/shipment/fix-status?popup=1" target="_blank" rel="noopener noreferrer">확정 현황</a></span>}
                  {readiness?.state==='INVALID' && <details className="wcm-readiness wcm-warning"><summary>{readiness.label} · 상세</summary><pre>{readiness.reason || readiness.action}</pre></details>}
                  {readiness?.state==='ERROR' && <div className="wcm-readiness-failure"><details className="wcm-quote-error"><summary>견적 조회 실패 · 상세</summary><pre>{readiness.reason}</pre></details><button type="button" disabled={disabled || typeof onRetryQuote!=='function'} onClick={()=>onRetryQuote(cycle)}>다시 조회</button></div>}
                  <span className="wcm-muted">{cycle.startDate} ~ {cycle.endDate}</span>
                  <PrintButton label="전체 견적" reason={printReason(cycle, [], 'major')} onClick={() => print(cycle, [], 'major')} />
                  <PrintButton label={'선택요일 출력 (' + dates.length + ')'} reason={printReason(cycle, dates, 'dates')}
                    onClick={() => print(cycle, dates, 'dates')} />
                </div>
              </th>;
            })}
          </tr>
          <tr>{matrix.cycles.map((cycle) => <Fragment key={cycleKey(cycle)}>
            {displayCycleColumns(cycle,wilsonDay).map((column, index) => {
              if(column.kind==='remainingMajor') return <Fragment key={column.kind}>{['합계','잔량','변경'].map(label=><th key={label} rowSpan={2} scope="col" className="wcm-total">{cycle.majorWeek}차<br/>{label}</th>)}</Fragment>;
              if(column.kind==='wilson' || column.kind==='dayTotal') return <th key={column.kind} rowSpan={2} scope="col" className="wcm-wilson-head">{column.kind==='wilson'?'윌슨':'요일 합계'}<span className="wcm-date">{column.day.date?.slice(5)}</span></th>;
              if(column.kind==='sum01'||column.kind==='sum02'||column.kind==='remaining02') return <th key={column.kind} rowSpan={2} scope="col" className="wcm-total">{cycle.majorWeek}-{column.kind==='sum01'?'01':'02'}<br/>{column.kind==='remaining02'?'잔량':'합계'}</th>;
              if(column.kind!=='day') {
                const initial=column.kind.startsWith('initial');
                const suffix=column.kind.endsWith('01')?'01':'02';
                const saved=baselines.find(record=>Number(record.year)===Number(cycle.year)&&record.orderWeek===`${cycle.majorWeek}-${suffix}`);
                const candidate=baselineCandidates.find(record=>Number(record.year)===Number(cycle.year)&&record.orderWeek===`${cycle.majorWeek}-${suffix}`);
                return <th key={column.kind} rowSpan={2} scope="col" className={initial?`wcm-initial wcm-cycle-start${!saved&&!candidate?.error?' wcm-provisional':''}`:'wcm-total'} title={initial&&!saved?'기준 미확정 · 최초분배 기준 보관 전':undefined}>
                  {initial ? <>{cycle.majorWeek}-{suffix}<br/>최초분배<br/>{saved?<small title={`${saved.confirmedAt} · ${saved.confirmedBy}`}>기준 보관됨</small>:<>{(candidate?.error || busy) && <small className={candidate?.error?'wcm-warning':'wcm-muted'} title={candidate?.error || '기준 조회 중'}>{candidate?.error?'조회 실패':'조회 중'}</small>}<button type="button" className="wcm-confirm" disabled={busy || baselineBusy || !hasCustomer || cycle.calendarState!=='FOUND' || typeof onConfirmBaseline!=='function'}
                    aria-label={`${cycle.year}/${cycle.majorWeek}-${suffix} 최초분배 확정`} onClick={()=>onConfirmBaseline({cycle,orderWeek:`${cycle.majorWeek}-${suffix}`})}>기준 확정</button></>}</>
                    : column.kind==='remaining01' ? <>{cycle.majorWeek}-01<br/>잔량</> : <>{cycle.majorWeek}차<br/>합계<br/><small>잔량·변경</small></>}
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
              {day.label}{day.label===wilsonDay?' 일반':''}<span className="wcm-muted wcm-date">{day.date?.slice(5) || '미확인'}</span>
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
              {displayCycleColumns(block.cycle,wilsonDay).map((column,index)=>{
                if(['day','wilson','dayTotal'].includes(column.kind)) {
                  const day=block.days.find(item=>item.date===column.day.date);
                  const split=splitFor(row,block,day);
                  if(column.kind==='wilson')return <td key={`wilson|${day.date}`} className="wcm-wilson-column"><WilsonCell row={row} block={block} day={day} split={split} disabled={disabled || wilsonBusy} onEditWilson={onEditWilson} onSelect={setSelectedInfo}/></td>;
                  if(column.kind==='dayTotal')return <td key={`dayTotal|${day.date}`} className="wcm-total"><SummaryDetails label={`${row.name} ${day.date} 일반·윌슨 합계 내역`} visibleLabel={weekdayQuantityLabel(split.total,row,day.unit,block.packaging)} description={`일반 ${split.error?'재확인':numberLabel(split.total-split.wilson)} / 윌슨 ${split.error?'재확인':numberLabel(split.wilson)} / 합계 ${numberLabel(split.total)} ${day.unit || ''}\n${split.error || '견적은 저장된 합계만 출력합니다.'}`}/></td>;
                  const selected=day.label===wilsonDay;
                  const savedGeneral=split.savedTotal==null || split.error?null:Number((split.savedTotal-split.savedWilson).toFixed(6));
                  const projectedGeneral=split.total==null || split.error?null:split.total-split.wilson;
                  const shown=selected?{...day,current:savedGeneral,displayCurrent:savedGeneral,planned:day.planned==null?null:projectedGeneral,initial:null,initialDelta:null,delta:null,editDisabledReason:day.editDisabledReason || split.error || (split.total==null?'일반·윌슨 날짜 합계 미확인':'')}:day;
                  return <td key={day.date || index}><QuantityCell row={row} block={block} day={shown} disabled={disabled || selected&&wilsonBusy} disabledReason={moving?'초안 이동 처리 중입니다.':editDisabledReason} onEditCell={selected&&typeof onEditCell==='function'?payload=>onEditCell({...payload,quantity:payload.quantity+split.wilson}):onEditCell} onSelect={setSelectedInfo} onOpenNote={onOpenNote}/></td>;
                }
                if(['sum01','sum02','remaining02','remaining01'].includes(column.kind)) {
                  const subweek=column.kind.endsWith('01')?block.subweek01:block.subweek02;
                  const sum=column.kind.startsWith('sum'),view=subweek?.remainderView;
                  const value=sum?subweek?.effectiveTotal:view?.value;
                  return <td key={column.kind} className={`wcm-total${view?.hasProvisional?' wcm-provisional':''}${view?.hasDraft?' wcm-draft':''}`}><SummaryDetails label={`${row.name} ${block.cycle.year}/${subweek?.orderWeek} ${sum?'합계':'잔량'} 내역`} visibleLabel={weekdayQuantityLabel(value,row,block.unit,block.packaging)} description={`${sum?'합계':'잔량'} ${numberLabel(value)} ${block.unit || ''}\n저장 합계 ${numberLabel(subweek?.currentTotal)}\n${view?.label || '미확인'}${view?.hasProvisional?' · 기준 미확정':''} · ERP 재고 아님`}/>{view?.hasDraft&&<small className="wcm-inline-status wcm-draft">초안</small>}</td>;
                }
                const initial=column.kind==='initial01'?block.initial01:column.kind==='initial02'?block.initial02:null;
                const provisional=column.kind==='initial01'?block.provisional01:column.kind==='initial02'?block.provisional02:null;
                const remainder=column.kind==='remaining01'?block.remainder01View:column.kind==='remainingMajor'?block.remainderMajorView:null;
                const value=column.kind.startsWith('initial')?(initial || provisional)?.quantity:remainder?.value;
                if(column.kind==='remainingMajor') return <CompactSummary key={column.kind} row={row} block={block}
                  disabled={disabled} carryover={carryover} carryoverBusy={carryoverBusy} carryoverError={carryoverError}
                  hasCustomer={hasCustomer} onOpenCarryover={onOpenCarryover} onOpenNote={onOpenNote}
                  onSelect={setSelectedInfo} customer={customer} custKey={custKey}/>;
                return <td key={column.kind} className={column.kind.startsWith('initial')?`wcm-initial wcm-cycle-start${provisional?' wcm-provisional':''}`:column.kind==='remainingMajor'?'wcm-total wcm-major-total':'wcm-total'} title={`${provisional?'기준 미확정 · 현재 ERP 분배량 (확정 시 최초 기준 고정)':'최초기준 비교값 · ERP재고 아님'}\n전산 ${numberLabel(block.currentTotal)} / 미적용 초안 ${numberLabel(block.plannedTotal)} ${block.unit||''}\n최초 ${numberLabel(block.initialMajor)} · 변경 ${numberLabel(block.initialChange)}\n${block.quote.state}: 관리 ${block.quote.managementQuantity ?? '?'} / 인쇄 순수량 ${block.quote.netQuantity ?? '?'} ${block.quote.unit || ''} · 총액 ${block.quote.amount ?? '?'}원\n${block.pageNote?.note || ''}`}>
                  <div className="wcm-remainder-compact">
                    <span className={remainder?.hasDraft?'wcm-draft wcm-remainder-value':'wcm-remainder-value'} data-wcm-label={remainder?'remainder':'initial'} data-quantity={value ?? '—'} aria-label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 ${remainder?'잔량':'최초분배'}`} title={remainder?`${remainder.label} · 저장 전산 기준잔량 ${numberLabel(remainder.savedValue)} · ERP 재고 아님`:undefined}>
                      <QuantityLabel>{weekdayQuantityLabel(value,row,block.unit,block.packaging)}</QuantityLabel>
                    </span>
                    {remainder && <SummaryDetails label={`${row.name} ${block.cycle.year}/${block.cycle.majorWeek}차 01 잔량 내역`}
                      visibleLabel={[remainder.hasDraft?'초안':'',remainder.value==null?'미확인':'',block.carryover?.source?'이월':''].filter(Boolean).join('·') || '기준'}
                      description={`${remainder.label}${remainder.hasProvisional?' · 기준 미확정':''} · 잔량 ${numberLabel(value)} ${block.unit || ''}\n저장 전산 기준잔량 ${numberLabel(remainder.savedValue)} · ERP 재고 아님`}/>}
                  </div>
                </td>;
              })}
            </Fragment>)}
          </tr>;
        })}
          {!visibleRows.length && <tr><td colSpan={1 + matrix.cycles.reduce((sum,cycle)=>sum+displayCycleColumns(cycle,wilsonDay).length+2,0)}>
            {shipmentRows.length ? '검색/품종 조건에 맞는 품목이 없습니다.' : matrix.rows.length
              ? '표시 범위에 출고 수량 또는 양수 초안이 있는 품목이 없습니다. 출고 없는 품목은 숨겼습니다.'
              : '조회된 품목 또는 초안이 없습니다. 재고 0을 의미하지 않습니다.'}
          </td></tr>}
        </tbody>
      </table>
      </div>
      <div ref={bottomScroll} className="wcm-scroll-bottom" tabIndex={0} role="region" aria-label="요일표 하단 가로 스크롤">
        <div ref={bottomScrollWidth} className="wcm-scroll-width" aria-hidden="true"/>
      </div>
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
      .weekday-cycle-matrix { width:100%; min-width:0; box-sizing:border-box; color:#0f172a; font-size:14px; line-height:1.4; }
      .weekday-cycle-matrix :is(td,th).wcm-provisional:not(.wcm-draft) { background:#fff7da; color:#334155; }
      .weekday-cycle-matrix .wcm-unallocated:not(.wcm-proposed):not(.wcm-changed):not(.wcm-early) { background:#edf2f7; }
      .weekday-cycle-matrix * { box-sizing:border-box; }
      .weekday-cycle-matrix p { margin:6px 0; }
      .weekday-cycle-matrix .wcm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:7px 0; }
      .weekday-cycle-matrix button { border:1px solid #8da5bd; border-radius:4px; background:#fff; color:#172b42; padding:4px 7px; font:inherit; cursor:pointer; }
      .weekday-cycle-matrix button:disabled { opacity:.55; cursor:not-allowed; }
      .weekday-cycle-matrix :is(button,input,select,.wcm-table-scroll,.wcm-scroll-top,.wcm-scroll-bottom):focus-visible { outline:2px solid #2563eb; outline-offset:1px; }
      .weekday-cycle-matrix .wcm-muted { color:#334155; font-size:12px; }
      .weekday-cycle-matrix .wcm-draft, .weekday-cycle-matrix .wcm-delta { color:#174e9c; }
      .weekday-cycle-matrix .wcm-warning { color:#805100; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-error { color:#a51a24; background:#fff0f1; padding:8px; border:1px solid #e5a3a9; }
      .weekday-cycle-matrix .wcm-quote-error { width:100%; min-width:0; color:#9f1c16; font-size:12px; text-align:left; }
      .weekday-cycle-matrix .wcm-quote-error summary { cursor:pointer; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-quote-error pre { max-block-size:min(144px,24vh); overflow:auto; margin:4px 0 0; padding:5px; border:1px solid #e5a3a9; background:#fff0f1; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; }
      .weekday-cycle-matrix .wcm-status { color:#164e63; background:#ecfeff; padding:8px; }
      .weekday-cycle-matrix .wcm-selected { position:fixed; bottom:16px; right:16px; width:min(760px,calc(100vw - 32px)); max-block-size:min(70vh,calc(100vh - 32px)); overflow:auto; z-index:20; border:1px solid #93b5df; padding:12px; background:#f3f8ff; box-shadow:0 4px 16px #172b4233; font-size:18px; line-height:1.5; text-align:center; }
      .weekday-cycle-matrix .wcm-selected button { float:right; }
      .weekday-cycle-matrix .wcm-selected pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:5px 0 0; font:inherit; }
      .weekday-cycle-matrix .wcm-outside { padding:7px; margin:8px 0; background:#fffbeb; border:1px solid #dfc788; overflow-wrap:anywhere; }
      .weekday-cycle-matrix summary { cursor:pointer; }
      .weekday-cycle-matrix .wcm-detail-record { margin:6px 0; padding:5px 0; border-bottom:1px solid #e6d5a7; }
      .weekday-cycle-matrix .wcm-scroll-region { position:relative; min-width:0; width:100%; }
      .weekday-cycle-matrix .wcm-scroll-top,.weekday-cycle-matrix .wcm-scroll-bottom { width:100%; height:22px; overflow-x:scroll; overflow-y:hidden; background:#edf3f9; border-top:1px solid #c3cfdb; border-bottom:1px solid #c3cfdb; }
      .weekday-cycle-matrix .wcm-scroll-bottom { position:sticky; bottom:0; z-index:3; }
      .weekday-cycle-matrix :is(.wcm-scroll-top,.wcm-scroll-bottom)::-webkit-scrollbar { height:16px; background:#dce6f2; }
      .weekday-cycle-matrix :is(.wcm-scroll-top,.wcm-scroll-bottom)::-webkit-scrollbar-thumb { background:#54779f; border:3px solid #dce6f2; border-radius:8px; }
      .weekday-cycle-matrix :is(.wcm-scroll-top,.wcm-scroll-bottom)::-webkit-scrollbar-thumb:hover { background:#315a88; }
      .weekday-cycle-matrix .wcm-scroll-width { height:1px; }
      .weekday-cycle-matrix .wcm-table-scroll { width:100%; overflow-x:auto; scrollbar-width:none; }
      .weekday-cycle-matrix .wcm-table-scroll::-webkit-scrollbar { display:none; }
      .weekday-cycle-matrix .wcm-cycle-jump { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:4px 0; }
      .weekday-cycle-matrix .wcm-cycle-jump button { padding:2px 6px; font-size:12px; }
      .weekday-cycle-matrix .wcm-add { border:1px solid #93b5df; background:#f3f8ff; padding:6px; margin:4px 0; }
      .weekday-cycle-matrix .wcm-add-candidates { display:flex; flex-wrap:wrap; gap:4px; }
      .weekday-cycle-matrix .wcm-add-candidates button { text-align:left; font-size:12px; padding:3px 6px; }
      .weekday-cycle-matrix table { min-width:0; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:12px; color:#122033; }
      .weekday-cycle-matrix .wcm-product-col { width:170px; }
      .weekday-cycle-matrix .wcm-summary-col { width:44px; }
      .weekday-cycle-matrix .wcm-baseline-col, .weekday-cycle-matrix .wcm-day-col { width:46px; }
      .weekday-cycle-matrix .wcm-remainder-col { width:48px; }
      .weekday-cycle-matrix caption { text-align:left; color:#526277; padding:3px 0; font-size:12px; }
      .weekday-cycle-matrix table th, .weekday-cycle-matrix table td { border-right:1px solid #c3cfdb; border-bottom:1px solid #c3cfdb; padding:2px 1px; text-align:center; vertical-align:middle; }
      .weekday-cycle-matrix tr > :first-child { border-left:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead tr:first-child th { border-top:1px solid #c3cfdb; }
      .weekday-cycle-matrix thead th { position:static; top:auto; background:#edf3f9; }
      .weekday-cycle-matrix thead { position:sticky; top:0; z-index:5; }
      .weekday-cycle-matrix tbody :is(th,td) { padding:1px; height:52px; }
      .weekday-cycle-matrix table small { font-size:10px; line-height:12px; }
      .weekday-cycle-matrix tbody tr:is(:hover,:focus-within) > :is(th,td) { box-shadow:inset 0 2px #60a5fa,inset 0 -2px #60a5fa; }
      .weekday-cycle-matrix tbody tr:is(:hover,:focus-within) > th { background:#dbeafe; box-shadow:inset 4px 0 #2563eb,inset 0 2px #60a5fa,inset 0 -2px #60a5fa; }
      .weekday-cycle-matrix thead .wcm-current-head { background:#dbeafe; }
      .weekday-cycle-matrix .wcm-cycle-header { display:flex; flex-wrap:wrap; gap:5px 10px; align-items:center; justify-content:center; padding:3px; }
      .weekday-cycle-matrix .wcm-day-print { width:100%; font-size:10px; padding:1px; min-height:20px; }
      .weekday-cycle-matrix .wcm-day-select { display:flex; flex-direction:row; justify-content:center; align-items:center; gap:1px; font-size:10px; margin-top:1px; }
      .weekday-cycle-matrix .wcm-day-select input { width:auto; margin:0; }
      .weekday-cycle-matrix .wcm-date { display:block; }
      .weekday-cycle-matrix tbody th { position:sticky; top:auto; left:0; z-index:3; text-align:left; font-weight:normal; background:#f8fafc; }
      .weekday-cycle-matrix .wcm-product { display:flex; gap:4px; align-items:center; min-height:32px; min-width:0; }
      .weekday-cycle-matrix .wcm-product-name { min-width:0; overflow-wrap:anywhere; white-space:normal; font-size:12px; font-weight:600; color:#122033; }
      .weekday-cycle-matrix .wcm-product small { margin-left:auto; color:#122033; flex-shrink:0; font-size:10px; }
      .weekday-cycle-matrix .wcm-badge { font-size:12px; padding:1px 3px; background:#e4ecf5; color:#405774; border-radius:3px; max-width:72px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex-shrink:0; }
      .weekday-cycle-matrix .wcm-total { background:#f1f6fb; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-initial { background:#edf7f0; font-variant-numeric:tabular-nums; font-size:14px; }
      .weekday-cycle-matrix .wcm-confirm { padding:1px 3px; font-size:12px; }
      .weekday-cycle-matrix .wcm-remainder-status { display:block; font-size:12px; line-height:16px; }
      .weekday-cycle-matrix .wcm-major-heading { display:flex; flex-flow:row wrap; align-items:center; justify-content:space-between; gap:0 3px; min-width:0; text-align:left; }
      .weekday-cycle-matrix .wcm-major-total .wcm-remainder-status { display:block; flex:0 1 auto; max-width:100%; margin:0; font-size:12px; line-height:16px; text-align:left; white-space:normal; word-break:keep-all; overflow-wrap:normal; }
      .weekday-cycle-matrix .wcm-cycle-sum { display:flex; width:100%; min-width:0; font-size:16px; line-height:20px; text-align:left; margin:0 0 1px; color:#122033; font-weight:700; }
      .weekday-cycle-matrix .wcm-sum-value { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 3px; width:100%; min-width:0; font-size:14px; font-weight:700; color:#122033; }
      .weekday-cycle-matrix .wcm-summary-actions { display:flex; flex-wrap:wrap; gap:2px; justify-content:flex-start; width:100%; min-width:0; margin-top:1px; }
      .weekday-cycle-matrix .wcm-summary-actions button { max-width:100%; white-space:normal; word-break:keep-all; overflow-wrap:normal; }
      .weekday-cycle-matrix .wcm-change-note { font-size:12px; line-height:16px; padding:1px 3px; background:#fff7da; }
      .weekday-cycle-matrix .wcm-cycle-start { border-left:2px solid #8da5bd; }
      .weekday-cycle-matrix .wcm-cell { display:flex; flex-direction:column; align-items:stretch; justify-content:center; position:relative; min-height:32px; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-editable { cursor:text; }
      .weekday-cycle-matrix .wcm-readonly { cursor:help; }
      .weekday-cycle-matrix .wcm-changed { background:#fff0b3; }
      .weekday-cycle-matrix .wcm-early { background:#eadbfa; }
      .weekday-cycle-matrix .wcm-early-label { position:relative; z-index:2; font-size:12px; line-height:16px; padding:1px; border:0; background:#eadbfa; color:#652397; width:100%; white-space:normal; word-break:keep-all; overflow-wrap:normal; }
      .weekday-cycle-matrix .wcm-early-label .wcm-quantity-label { font-size:14px; color:#122033; }
      .weekday-cycle-matrix .wcm-quote { font-size:12px; padding:1px 3px; line-height:16px; }
      .weekday-cycle-matrix .wcm-major-total { min-width:0; padding:1px; line-height:18px; font-size:14px; }
      .weekday-cycle-matrix .wcm-major-total .wcm-remainder-value { font-size:14px; font-weight:700; line-height:1.2; color:#122033; text-align:center; }
      .weekday-cycle-matrix .wcm-remainder-action { border:1px solid #7892b0; border-radius:4px; background:#fff; padding:2px 4px; text-align:left; max-width:100%; }
      .weekday-cycle-matrix .wcm-remainder-action:focus-visible { outline:3px solid #1d4ed8; outline-offset:2px; }
      .weekday-cycle-matrix .wcm-carry-line { font-size:14px; line-height:19px; color:#244263; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-carry-line.wcm-error { color:#9f1c16; }
      .weekday-cycle-matrix .wcm-remainder-value.wcm-draft, .weekday-cycle-matrix .wcm-major-total .wcm-remainder-value.wcm-draft { color:#174e9c; }
      .weekday-cycle-matrix .wcm-number-display { pointer-events:none; width:100%; text-align:center; font-size:14px; font-weight:700; line-height:20px; color:#122033; }
      .weekday-cycle-matrix .wcm-quantity-label { display:inline-flex; flex-wrap:wrap; align-items:baseline; justify-content:inherit; gap:0 2px; max-width:100%; min-width:0; white-space:normal; word-break:keep-all; overflow-wrap:normal; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-quantity-part { flex:0 1 auto; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-quantity-raw { flex:0 1 auto; min-width:0; max-width:100%; white-space:normal; word-break:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-number-display .wcm-quantity-label { width:100%; justify-content:center; }
      .weekday-cycle-matrix .wcm-remainder-value { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:center; gap:0 3px; min-width:0; font-size:14px; font-weight:700; color:#122033; }
      .weekday-cycle-matrix .wcm-remainder-label { flex:0 0 auto; }
      .weekday-cycle-matrix .wcm-major-total .wcm-remainder-value { flex:0 1 auto; max-width:100%; justify-content:center; }
      .weekday-cycle-matrix .wcm-proposed .wcm-number-display { color:#122033; font-weight:700; }
      .weekday-cycle-matrix .wcm-cell-detail { display:flex; justify-content:center; align-items:center; flex-wrap:wrap; gap:2px; position:relative; z-index:2; font-size:12px; line-height:16px; }
      .weekday-cycle-matrix .wcm-original { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:center; min-width:0; max-width:100%; font-size:14px; font-weight:700; color:#122033; word-break:keep-all; overflow-wrap:normal; }
      .weekday-cycle-matrix .wcm-cell input { position:absolute; opacity:0; left:0; top:0; width:100%; padding:1px; border:1px solid transparent; height:22px; min-height:22px; line-height:20px; text-align:center; font-size:14px; font-weight:700; background:transparent; color:#122033; border-radius:2px; font-variant-numeric:tabular-nums; }
      .weekday-cycle-matrix .wcm-cell input:focus { position:relative; opacity:1; }
      .weekday-cycle-matrix .wcm-cell:has(input:focus) .wcm-number-display { display:none; }
      .weekday-cycle-matrix .wcm-cell input:disabled { opacity:0; pointer-events:none; }
      .weekday-cycle-matrix .wcm-cell input:hover:not(:disabled) { border-color:#93b5df; }
      .weekday-cycle-matrix .wcm-proposed input { color:#122033; background:#eaf3ff; }
      .weekday-cycle-matrix .wcm-cell-info { position:relative; z-index:2; font-size:10px; line-height:12px; padding:0 1px; border:0; background:#e2ecfa; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix :is(.wcm-cell-info,.wcm-change-note) .wcm-quantity-label { font-size:14px; }
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
      .weekday-cycle-matrix .wcm-cycle-title, .weekday-cycle-matrix .wcm-confirmations { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:4px; min-width:0; }
      .weekday-cycle-matrix .wcm-confirmation { display:inline-block; border:1px solid #b6c4d5; border-radius:4px; padding:1px 5px; font-size:12px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:#fff8e8; }
      .weekday-cycle-matrix .wcm-confirmation.wcm-fixed { color:#166534; background:#ecfdf5; border-color:#86b9a1; }
      .weekday-cycle-matrix .wcm-compact-summary { display:grid; gap:1px; width:100%; min-width:0; }
      .weekday-cycle-matrix .wcm-summary-row { display:flex; flex-direction:column; align-items:center; gap:1px; width:100%; margin:0; text-align:center; }
      .weekday-cycle-matrix .wcm-summary-label { display:none; }
      .weekday-cycle-matrix .wcm-summary-value { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:1px 4px; min-width:0; width:100%; text-align:center; font-size:14px; font-weight:700; color:#122033; }
      .weekday-cycle-matrix .wcm-major-total .wcm-remainder-value { justify-content:center; text-align:center; }
      .weekday-cycle-matrix :is(.wcm-summary-value,.wcm-remainder-value,.wcm-original) .wcm-quantity-label { justify-content:center; }
      .weekday-cycle-matrix .wcm-inline-status { font-size:10px; line-height:12px; font-weight:600; color:#334155; background:#e4ecf5; border-radius:3px; padding:0 1px; }
      .weekday-cycle-matrix .wcm-inline-status.wcm-draft { color:#174e9c; background:#eaf3ff; }
      .weekday-cycle-matrix .wcm-incoming { font-size:14px; font-weight:700; text-align:center; color:#122033; }
      .weekday-cycle-matrix .wcm-summary-details { padding:1px 2px; font-size:14px; line-height:16px; font-weight:600; text-align:center; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix .wcm-remainder-compact { display:flex; flex-direction:column; align-items:center; gap:1px; }
      .weekday-cycle-matrix .wcm-detail-popover { position:fixed; inset:auto 16px 16px auto; width:min(760px,calc(100vw - 32px)); max-block-size:min(70vh,calc(100vh - 32px)); overflow:auto; z-index:30; padding:12px; border:1px solid #93b5df; background:#f3f8ff; box-shadow:0 4px 16px #172b4233; font-size:18px; line-height:1.5; text-align:center; font-weight:400; }
      .weekday-cycle-matrix .wcm-detail-popover .wcm-toolbar { justify-content:center; }
      .weekday-cycle-matrix .wcm-detail-popover pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; margin:6px 0; text-align:center; }
      .weekday-cycle-matrix .wcm-form input[type=number] { text-align:center; font-size:14px; font-weight:700; }
      .weekday-cycle-matrix :is(.wcm-selected,.wcm-detail-popover) strong { font-size:20px; }
      .weekday-cycle-matrix :is(.wcm-selected,.wcm-detail-popover) button { font-size:14px; padding:5px 10px; }
      .weekday-cycle-matrix .wcm-confirmations { flex:1 1 auto; gap:3px; }
      .weekday-cycle-matrix .wcm-confirmation { padding:0 4px; line-height:18px; }
      .weekday-cycle-matrix .wcm-compact-summary .wcm-remainder-action { padding:0 3px; }
      .weekday-cycle-matrix .wcm-compact-summary .wcm-quote { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:3px; padding:0 3px; }
      .weekday-cycle-matrix .wcm-compact-summary .wcm-quote .wcm-quantity-label { font-size:14px; font-weight:700; }
      .weekday-cycle-matrix tbody td .wcm-quantity-label { font-size:14px; font-weight:700; line-height:1.2; text-align:center; justify-content:center; }
      .weekday-cycle-matrix tbody td :is(.wcm-number-display,.wcm-original,.wcm-remainder-value,.wcm-remainder-action,.wcm-sum-value,.wcm-summary-value,.wcm-incoming) { font-size:14px; font-weight:700; line-height:1.2; text-align:center; justify-content:center; }
      .weekday-cycle-matrix tbody td .wcm-change-note { font-size:14px; font-weight:700; line-height:1.2; white-space:normal; overflow-wrap:anywhere; }
      .weekday-cycle-matrix tbody td .wcm-cell input { font-size:14px; font-weight:700; line-height:1.2; text-align:center; }
      .weekday-cycle-matrix .wcm-confirmation-disclosure summary, .weekday-cycle-matrix .wcm-filter-disclosure summary { cursor:pointer; font-size:12px; padding:3px; }
      .weekday-cycle-matrix .wcm-table-scroll { max-height:calc(100dvh - 190px); overflow-y:auto; }
      .weekday-cycle-matrix .wcm-wilson-head, .weekday-cycle-matrix .wcm-wilson-column { background:#f2ecff; }
      .weekday-cycle-matrix .wcm-wilson-cell { display:flex; flex-direction:column; gap:2px; align-items:center; }
      .weekday-cycle-matrix .wcm-wilson-cell input { text-align:center; font-size:14px; font-weight:700; padding:2px; }
      .weekday-cycle-matrix .wcm-wilson-cell button { font-size:12px; padding:1px 3px; }
      .weekday-cycle-matrix tbody :is(.wcm-summary-details,.wcm-remainder-action,.wcm-change-note,.wcm-quote) { border-color:#b2c2d5; border-radius:3px; padding:1px 2px; min-height:18px; }
      .weekday-cycle-matrix tbody .wcm-summary-details { background:#f8fbff; }
      .weekday-cycle-matrix tbody .wcm-quote { font-size:10px; line-height:12px; }
      .weekday-cycle-matrix tbody .wcm-wilson-cell button { font-size:10px; padding:1px; line-height:12px; }
      .weekday-cycle-matrix .wcm-wilson-cell input { height:22px; box-sizing:border-box; }
      .weekday-cycle-matrix .wcm-compact-summary .wcm-quote { width:100%; box-sizing:border-box; }
      .weekday-cycle-matrix .wcm-quote-status { display:flex; flex-direction:column; width:100%; padding:0; line-height:11px; }
      .weekday-cycle-matrix .wcm-quote-status span { white-space:nowrap; }
      .weekday-cycle-matrix thead tr:not(:first-child) th { font-size:10px; line-height:12px; }
      .weekday-cycle-matrix thead tr:not(:first-child) :is(small,.wcm-muted,.wcm-confirm) { font-size:10px; line-height:12px; }
      .weekday-cycle-matrix thead .wcm-confirm { padding:1px; }
      .weekday-cycle-matrix table button:focus-visible { outline:2px solid #2563eb; outline-offset:1px; }
      .weekday-cycle-matrix .wcm-unallocated-toggle { flex-direction:row; align-items:center; gap:3px; }
      .weekday-cycle-matrix .wcm-unallocated-toggle input { width:auto; margin:0; }
      .weekday-cycle-matrix .wcm-readiness { width:100%; font-size:11px; line-height:14px; color:#334155; }
      .weekday-cycle-matrix .wcm-readiness a { color:#1d4ed8; text-decoration:underline; }
      .weekday-cycle-matrix .wcm-readiness.wcm-warning { color:#805100; }
      .weekday-cycle-matrix .wcm-readiness pre { margin:3px 0; white-space:pre-wrap; overflow-wrap:anywhere; max-height:120px; overflow:auto; }
      .weekday-cycle-matrix .wcm-readiness-failure { display:flex; align-items:flex-start; gap:4px; width:100%; }
      @media (max-width:1000px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width:560px) { .weekday-cycle-matrix .wcm-form { grid-template-columns:minmax(0,1fr); } }
    `}}/>
  </section>;
}
