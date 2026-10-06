import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { isExpectedWeekdayPrintBlock } from '../lib/weekdayPrintReadiness.js';
import WeekdayCycleMatrix from './WeekdayCycleMatrix';
import { readWeekdayStoredInputs, saveWeekdayScopedInputs, mergeWeekdayStoredInputs,
  clearWeekdayStoredSubmission, weekdayInputStorageKey } from '../lib/weekdayDraftStorage.js';
import { wilsonRecordKey, wilsonWriteInput, wilsonPendingAfterSave, validateWilsonWriteResponse } from '../lib/weekdayWilsonClient.js';
import { locateShippingDay } from '../lib/weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from '../lib/weekdayEstimateCompare.js';
import { validateWeekdayConfirmationResponse } from '../lib/weekdayConfirmation.js';
import { buildWeekdayPrintRequests, validateWeekdayPrintResponse, buildWeekdayEstimatePrintBundle } from '../lib/weekdayEstimatePrintBundle.js';
import { buildWeekdayDistributionSubmission, clearSubmittedWeekdayDrafts, checkWeekdayDistributionStatus,
  saveWeekdayDistribution, weekdayDraftScope, weekdayUnsavedPrintReason, moveWeekdayDistributionDraft, projectWeekdayDistribution,
  validateWeekdayDistributionCompareResponse, weekdayDistributionPreviewMatches } from '../lib/weekdayDistributionClient.js';

const initialYear = new Date().getFullYear();
const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const panel = { border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: 8 };
const inputStyle = { border: '1px solid #9aaec4', borderRadius: 4, padding: '3px 6px', minHeight: 28, background: '#fff' };

function candidateCells(row) { return (row.cells || []).filter((cell) => cell.kind === 'numeric-candidate' && cell.headerRole === 'date-quantity-candidate'); }
function draftKey(row) { return `${row.sheet}|${row.row}|${row.cell.address}`; }
function historySnapshotLabel(snapshot) {
  if(!snapshot || typeof snapshot!=='object') return snapshot==null?'기록 없음':String(snapshot);
  const dates=snapshot.shipmentDates || snapshot.dates;
  return `${snapshot.shipmentOutQuantity!=null?`총량 ${snapshot.shipmentOutQuantity} · `:''}${Array.isArray(dates)?dates.map(day=>`${day.date} ${day.shipmentQuantity ?? day.quantity}`).join(' / '):JSON.stringify(snapshot)}`;
}
function carryoverHistoryValue(value) { return value == null ? '미등록' : String(typeof value === 'object' ? value.quantity ?? '미확인' : value); }
function carryoverActorLabel(actor) { return actor == null ? '담당자 미확인' : typeof actor === 'object' ? actor.userName || actor.userId || actor.name || '담당자 미확인' : String(actor); }

export default function WeekdayEstimateWorkspace() {
  const [year, setYear] = useState(String(initialYear));
  const [majorWeek, setMajorWeek] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [customerQuery, setCustomerQuery] = useState('주광농원');
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [customerError, setCustomerError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [selectedSource, setSelectedSource] = useState(null);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [productError, setProductError] = useState('');
  const [mappings, setMappings] = useState({});
  const [productNames, setProductNames] = useState({});
  const [unit, setUnit] = useState('확인 필요');
  const [plans, setPlans] = useState([]);
  const [inputUser, setInputUser] = useState('');
  const [inputLoaded, setInputLoaded] = useState(false);
  const [storedInputs, setStoredInputs] = useState(null);
  const [inputStorageError, setInputStorageError] = useState('');
  const inputsRef = useRef({ plans: [], wilsonDrafts: [] });
  const wilsonRecoveryKey = inputUser ? `weekday-pending-wilson:${encodeURIComponent(inputUser)}` : null;
  const freshCompareRows = useRef(null);
  const [compareRows, setCompareRows] = useState(null);
  const [baselines, setBaselines] = useState([]);
  const [baselineCandidates, setBaselineCandidates] = useState([]);
  const [baselinePreview, setBaselinePreview] = useState(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const [pageNotes, setPageNotes] = useState([]);
  const [wilsonRecords,setWilsonRecords] = useState([]);
  const [wilsonDrafts,setWilsonDrafts] = useState([]);
  const [wilsonPending,setWilsonPending] = useState([]);
  const [wilsonError,setWilsonError] = useState('');
  const [wilsonBusy,setWilsonBusy] = useState(false);
  const wilsonLock = useRef(false);
  const wilsonPendingRef = useRef([]);
  wilsonPendingRef.current=wilsonPending;
  const [noteForm, setNoteForm] = useState(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [quoteResults, setQuoteResults] = useState([]);
  const [confirmationStates,setConfirmationStates] = useState([]);
  const [confirmationError,setConfirmationError] = useState('');
  const [carryover, setCarryover] = useState(null);
  const [carryoverError, setCarryoverError] = useState('');
  const [carryoverLoading, setCarryoverLoading] = useState(false);
  const [carryoverForm, setCarryoverForm] = useState(null);
  const [carryoverFormError, setCarryoverFormError] = useState('');
  const [carryoverBusy, setCarryoverBusy] = useState(false);
  const carryoverRequest = useRef(0);
  const carryoverSaveRequest = useRef(0);
  const carryoverLock = useRef(false);
  const carryoverDialog = useRef(null);
  const carryoverTrigger = useRef(null);
  const noteRequest=useRef(0);
  const noteLock=useRef(false);
  const baselineRequest = useRef(0);
  const baselineLock = useRef(false);
  const [cycles, setCycles] = useState([]);
  const [calendarError, setCalendarError] = useState('');
  const [sourceLots, setSourceLots] = useState([]);
  const [erpHistory, setErpHistory] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const [savedHistory, setSavedHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [applyPreview, setApplyPreview] = useState(null);
  const [applyReason, setApplyReason] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [pendingApply, setPendingApply] = useState(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const applyLock = useRef(false);
  const pendingOperation = useRef(null);
  const scopeKey = weekdayDraftScope(customer?.CustKey, year, majorWeek);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const activePlans = plans.filter(plan => plan.draftScope === scopeKey);
  const activeWilsonInputs = wilsonDrafts.filter(record => record.scopeKey === scopeKey && activePlans.some(plan =>
    Number(plan.year) === record.year && Number(plan.prodKey) === record.prodKey && plan.date === record.date
    && plan.orderWeek === record.orderWeek && Number(plan.quantity) === record.expectedTotal));
  inputsRef.current = { plans, wilsonDrafts };
  const storedScopeInputs = { plans: (storedInputs?.plans || []).filter(plan => plan.draftScope === scopeKey),
    wilsonDrafts: (storedInputs?.wilsonDrafts || []).filter(record => record.scopeKey === scopeKey) };
  const inputDirty = JSON.stringify({ plans: activePlans, wilsonDrafts: activeWilsonInputs }) !== JSON.stringify(storedScopeInputs);
  const editLocked = !inputLoaded || !inputUser || applyBusy || Boolean(pendingApply) || Boolean(applyPreview) || recoveryBlocked || wilsonBusy;
  const [toolsOpen,setToolsOpen] = useState(false);
  const [printPreview,setPrintPreview] = useState(null);
  const [printBusy,setPrintBusy] = useState(false);
  const defaultCustomerRequest=useRef(0);
  const printRequest=useRef(0);
  const printLock=useRef(false);
  const previewFrame=useRef(null);
  const calendarRequest = useRef(0);
  const defaultCalendarRequest = useRef(0);
  const centerTouched = useRef(false);
  const [defaultCalendarError, setDefaultCalendarError] = useState('');
  const comparisonRequest = useRef(0);
  const uploadRequest = useRef(0);
  const addedProductScope = useRef({scope:'', keys:[]});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('엑셀은 임시로 읽기만 합니다. 전산 원장에는 저장하지 않습니다.');

  const sourceRows = useMemo(() => (parsed?.sheets || []).flatMap((sheet) => (sheet.rows || [])
    .filter((row) => row.section && row.label && !row.isHeaderRow && (row.cells || []).some((cell) => cell.column === 'B' && cell.raw === row.label))
    .map((row) => ({ ...row, sheet: sheet.name, quantityCells: candidateCells(row) }))), [parsed]);

  useEffect(() => {
    let alive = true;
    apiGet('/api/auth/me').then(result => {
      const userId = result?.success === true ? result.user?.userId : null;
      weekdayInputStorageKey(userId);
      if (!alive) return;
      setInputUser(userId);
      try {
        const saved = readWeekdayStoredInputs(localStorage, userId);
        const merged = mergeWeekdayStoredInputs(inputsRef.current, saved, pendingOperation.current);
        setPlans(merged.plans); setWilsonDrafts(merged.wilsonDrafts); setStoredInputs(saved);
        if (saved.plans.length) setMessage(`보관 입력 ${saved.plans.length}건을 복구했습니다. ERP 적용 전에 최신 전산값을 다시 확인합니다.`);
      } catch (error) { setInputStorageError(error.message); }
      setInputLoaded(true);
    }).catch(error => { if (alive) { setInputStorageError(`입력 보관 사용자 확인 실패: ${error.message}`); setInputLoaded(true); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (inputLoaded && customer?.CustKey && cycles.length) refreshErp();
  }, [inputLoaded]);
  useEffect(() => {
    if (pendingApply?.payload?.operationId && inputLoaded && customer?.CustKey && cycles.length) refreshErp();
  }, [pendingApply?.payload?.operationId]);

  async function saveInputOnly() {
    if (!inputLoaded || !inputUser || editLocked || busy || !customer?.CustKey) return;
    const requestedScope = scopeKey;
    try {
      const authenticated = await apiGet('/api/auth/me');
      if (authenticated?.success !== true || authenticated.user?.userId !== inputUser) throw new Error('로그인 사용자가 변경되었습니다. 새로고침 후 입력을 확인하세요.');
      if (requestedScope !== currentScope.current) throw new Error('조회 범위가 변경되었습니다. 현재 범위에서 입력만 저장을 다시 누르세요.');
      const saved = saveWeekdayScopedInputs(localStorage, inputUser, scopeKey, activePlans, activeWilsonInputs, storedScopeInputs);
      setStoredInputs(saved); setInputStorageError('');
      setMessage(`입력 ${activePlans.length}건을 이 브라우저에 보관했습니다. 분배·견적·재고는 변경되지 않았습니다.`);
    } catch (error) { setInputStorageError(`입력 보관 실패: ${error.message} · 현재 입력을 유지합니다.`); }
  }

  useEffect(()=>{
    setApplyPreview(null);setApplyError('');setSavedHistory([]);setHistoryError('');
    baselineRequest.current+=1;setBaselinePreview(null);setBaselineError('');setBaselines([]);setBaselineCandidates([]);
    const request=++defaultCustomerRequest.current;
    apiGet('/api/customers/search',{q:'주광농원'}).then(result=>{
      if(request!==defaultCustomerRequest.current) return;
      const exact=(result.customers||[]).filter(row=>String(row.CustName||'').replace(/\s/g,'')==='주광농원');
      if(exact.length===1) {setCustomer(exact[0]);setCustomerQuery(exact[0].CustName);}
      else {setCustomerError('기본 주광 거래처가 없거나 중복입니다. 업체를 직접 선택해주세요.');setToolsOpen(true);}
    }).catch(error=>{if(request===defaultCustomerRequest.current){setCustomerError(error.message);setToolsOpen(true);}});
    return ()=>{defaultCustomerRequest.current+=1;};
  },[]);

  useEffect(()=>{
    setSavedHistory([]);setHistoryError('');
    setConfirmationStates([]);setConfirmationError('');
    baselineRequest.current+=1;noteRequest.current+=1;setBaselinePreview(null);setNoteForm(null);setBaselineError('');setNoteError('');setBaselines([]);setBaselineCandidates([]);setPageNotes([]);setQuoteResults([]);setCompareRows(null);
    printRequest.current+=1;setPrintPreview(null);
    if(customer?.CustKey && cycles.length) refreshErp();
    return ()=>{comparisonRequest.current+=1;};
  },[customer?.CustKey,cycles]);

  useEffect(()=>{setApplyPreview(null);printRequest.current+=1;uploadRequest.current+=1;setPrintPreview(null);},[scopeKey]);

  useEffect(()=>{
    if (!inputUser) return;
    try {const saved=JSON.parse(sessionStorage.getItem(wilsonRecoveryKey) || '[]');
      if(!Array.isArray(saved)) throw new Error();
      setWilsonPending(saved);
      if(saved.length) setWilsonError('ERP 재저장 없이 윌슨 구분값 저장 결과를 확인하세요.');
      if (!saved.length && sessionStorage.getItem('weekday-pending-wilson') && sessionStorage.getItem('weekday-pending-wilson') !== '[]')
        setWilsonError('이전 윌슨 복구 기록은 사용자 식별이 없어 자동 복구하지 않았습니다. 원본 기록은 보존됩니다.');
    } catch {setWilsonError('윌슨 복구 기록을 읽을 수 없습니다. 구분값을 확인하세요.');}
  },[inputUser]);

  useEffect(() => {
    const request = ++defaultCalendarRequest.current;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' })
      .formatToParts(new Date()).reduce((parts, part) => ({...parts, [part.type]:part.value}), {});
    apiGet('/api/estimate/weekday-calendar', { defaultNext:'1', date:`${date.year}-${date.month}-${date.day}` }).then(result => {
      if (request !== defaultCalendarRequest.current || centerTouched.current) return;
      if (result.success !== true || !/^\d{4}$/.test(String(result.scope?.year))
        || !/^\d{1,2}$/.test(String(result.scope?.majorWeek)) || Number(result.scope.majorWeek) < 1
        || Number(result.scope.majorWeek) > 53 || !Array.isArray(result.cycles)) throw new Error('기본 차수 응답을 확인할 수 없습니다.');
      setDefaultCalendarError('');
      setYear(String(result.scope.year)); setMajorWeek(String(result.scope.majorWeek)); setCycles(result.cycles);
    }).catch(error => {
      if (request === defaultCalendarRequest.current && !centerTouched.current)
        setDefaultCalendarError(`${error.message} · 연도와 중심 차수를 직접 선택하세요.`);
    });
    return () => { defaultCalendarRequest.current += 1; };
  }, []);

  useEffect(() => {
    carryoverRequest.current += 1; carryoverSaveRequest.current += 1;
    setCarryover(null); setCarryoverError(''); setCarryoverLoading(false);
    setCarryoverForm(null); setCarryoverFormError(''); setCarryoverBusy(false);
    if (customer?.CustKey && /^\d{4}$/.test(year) && /^\d{1,2}$/.test(majorWeek)
      && Number(majorWeek) >= 1 && Number(majorWeek) <= 53) refreshCarryover();
    return () => { carryoverRequest.current += 1; carryoverSaveRequest.current += 1; };
  }, [scopeKey]);

  useEffect(() => {
    if (!carryoverForm) return;
    const trigger = carryoverTrigger.current;
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [Boolean(carryoverForm)]);

  useEffect(()=>{
    if (!inputUser) return;
    try {
      const saved=JSON.parse(sessionStorage.getItem('weekday-pending-erp-operation') || 'null');
      if(saved && (!saved.payload?.operationId || !Array.isArray(saved.submitted) || !saved.scopeKey)) throw new Error('저장 작업 식별 정보가 불완전합니다.');
      if(saved?.payload?.operationId && saved?.submitted && saved?.scopeKey) {
        const merged = mergeWeekdayStoredInputs(inputsRef.current, { userId: inputUser, plans: [], wilsonDrafts: [] }, saved);
        pendingOperation.current=saved;setPendingApply(saved);
        setPlans(merged.plans); setWilsonDrafts(merged.wilsonDrafts);
        setApplyReason(saved.payload.reason);setApplyError(saved.metadataOnly
          ? '중단된 윌슨 구분 저장이 있습니다. 구분값 저장 결과만 확인하며 ERP 합계는 변경하지 않습니다.'
          : '중단된 저장 작업이 있습니다. 같은 UUID의 저장 상태만 확인하세요.');
      }
    } catch {setRecoveryBlocked(true);setApplyError('이전 저장 작업의 상태·사용자를 확인할 수 없습니다. 원본 복구 기록을 보존하고 입력 병합·중복 저장을 차단했습니다. 담당자 확인이 필요합니다.');}
  },[inputUser]);

  useEffect(() => {
    const request = ++calendarRequest.current;
    setConfirmationStates([]);setConfirmationError('');
    baselineRequest.current+=1;setBaselinePreview(null);setBaselineError('');setBaselines([]);setBaselineCandidates([]);
    noteRequest.current+=1;setNoteForm(null);setPageNotes([]);setQuoteResults([]);
    comparisonRequest.current += 1;
    setBusy(false);
    setCycles([]); setCompareRows(null); setCalendarError(''); setSourceLots([]); setErpHistory([]);
    if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(majorWeek) || Number(majorWeek) < 1 || Number(majorWeek) > 53) return;
    apiGet('/api/estimate/weekday-calendar', { year, majorWeek }).then((result) => {
      if (request === calendarRequest.current) setCycles(result.cycles || []);
    }).catch((error) => { if (request === calendarRequest.current) setCalendarError(error.message); });
    return () => { calendarRequest.current += 1; };
  }, [year, majorWeek]);

  function touchCenter() {
    centerTouched.current = true; defaultCalendarRequest.current += 1; setDefaultCalendarError('');
  }

  async function refreshCarryover() {
    const requestedScope = scopeKey;
    const request = ++carryoverRequest.current;
    const isCurrent = () => request === carryoverRequest.current && requestedScope === currentScope.current;
    setCarryoverLoading(true); setCarryoverError('');
    try {
      const result = await apiGet('/api/estimate/weekday-carryover', { year, majorWeek:String(majorWeek).padStart(2,'0'), custKey:Number(customer.CustKey) });
      if (!isCurrent()) return null;
      if (result.success !== true || result.readOnly !== true || !Array.isArray(result.records)
        || !Array.isArray(result.context?.cycles) || !Array.isArray(result.context?.inputs)
        || Number(result.context.custKey) !== Number(customer.CustKey)) throw new Error('이월 응답의 업체·계산 범위를 확인할 수 없습니다.');
      const next = { scopeKey:requestedScope, context:result.context, records:result.records };
      setCarryover(next);
      return next;
    } catch (error) {
      if (isCurrent()) { setCarryover(null); setCarryoverError(error.message); }
      return null;
    } finally { if (isCurrent()) setCarryoverLoading(false); }
  }

  function openCarryover({ row, block, record, trigger }) {
    if (carryoverLock.current || carryoverLoading || !customer?.CustKey || carryover?.scopeKey !== scopeKey) return;
    carryoverTrigger.current = trigger;
    carryoverSaveRequest.current += 1;
    setCarryoverFormError('');
    setCarryoverForm({ scopeKey, year:block.cycle.year, majorWeek:block.cycle.majorWeek,
      custKey:Number(customer.CustKey), prodKey:row.prodKey, name:row.name, unit:block.unit,
      quantity:record?.quantity == null ? '' : String(record.quantity), reason:'',
      expectedRevision:record?.revision ?? 0, history:record?.history || [],
      incoming:block.carryover?.incoming, closing:block.carryover?.closing,
      source:block.carryover?.source, provisional:block.carryover?.provisional,
      incomingProvisional:block.carryover?.incomingProvisional, incomingHasDraft:block.carryover?.incomingHasDraft,
      hasDraft:block.carryover?.hasDraft, error:block.carryover?.error, saved:false });
  }

  async function saveCarryover(event) {
    event.preventDefault();
    if (carryoverLock.current || carryoverBusy || !carryoverForm || carryoverForm.scopeKey !== currentScope.current) return;
    const form = carryoverForm;
    const raw = form.quantity.trim();
    const quantity = Number(raw);
    if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(quantity)) {
      setCarryoverFormError('마감 잔량은 유한한 숫자로 입력하세요. 0·음수도 가능하며 빈칸은 0이 아닙니다.'); return;
    }
    if (!form.reason.trim()) { setCarryoverFormError('변경 사유를 입력하세요.'); return; }
    carryoverLock.current = true; setCarryoverBusy(true); setCarryoverFormError('');
    const request = ++carryoverSaveRequest.current;
    const isCurrent = () => request === carryoverSaveRequest.current && form.scopeKey === currentScope.current;
    try {
      const result = await apiPost('/api/estimate/weekday-carryover', { year:form.year, majorWeek:form.majorWeek,
        custKey:form.custKey, prodKey:form.prodKey, unit:form.unit, quantity, reason:form.reason.trim(), expectedRevision:form.expectedRevision });
      if (!isCurrent()) return;
      if (result.success !== true || result.erpChanged !== false || !result.record) throw new Error('마감 잔량 저장 응답을 확인할 수 없습니다. 재조회 후 이력을 확인하세요.');
      setCarryoverForm(current => current ? {...current, expectedRevision:result.record.revision,
        history:result.record.history || [], saved:true} : current);
      const latest = await refreshCarryover();
      if (!isCurrent()) return;
      if (!latest) throw new Error('마감 잔량 저장 응답은 확인했으나 전체 이월 재조회에 실패했습니다. 입력은 유지됩니다. 이월 새로고침 후 확인하세요.');
      setCarryoverForm(null);
      setMessage('웹 전용 마감 잔량과 이력을 저장하고 연결 차수를 다시 계산했습니다. ERP 주문·출고·재고·견적은 변경하지 않았습니다.');
    } catch (error) {
      if (isCurrent()) setCarryoverFormError(error.status === 409
        ? `${error.message} · 다른 수정과 충돌했습니다. 입력을 유지했습니다. 최신 이력을 다시 조회하고 확인하세요.` : error.message);
    } finally {
      carryoverLock.current = false;
      if (isCurrent()) setCarryoverBusy(false);
    }
  }

  async function reloadCarryoverForm() {
    if (carryoverLock.current || !carryoverForm) return;
    const form = carryoverForm;
    const request = carryoverSaveRequest.current;
    const latest = await refreshCarryover();
    if (!latest || request !== carryoverSaveRequest.current || form.scopeKey !== currentScope.current) return;
    const record = latest.records.find(item => Number(item.year) === Number(form.year)
      && String(item.majorWeek) === String(form.majorWeek) && Number(item.custKey) === form.custKey && Number(item.prodKey) === form.prodKey);
    setCarryoverForm(current => current?.scopeKey === form.scopeKey && current.prodKey === form.prodKey
      ? {...current, expectedRevision:record?.revision ?? 0, history:record?.history || [], closing:record?.quantity ?? current.closing, saved:false} : current);
    setCarryoverFormError('최신 이력을 조회했습니다. 입력값은 유지했습니다. 변경 전후를 확인한 뒤 저장하세요.');
  }

  function closeCarryover() {
    if (carryoverBusy) return;
    carryoverSaveRequest.current += 1; setCarryoverForm(null); setCarryoverFormError('');
  }

  function carryoverDialogKeys(event) {
    if (event.key === 'Escape' && !event.nativeEvent?.isComposing) { event.preventDefault(); closeCarryover(); }
    if (event.key !== 'Tab') return;
    const controls = [...(carryoverDialog.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])];
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); carryoverDialog.current?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function moveDraft(move) {
    if(editLocked) throw new Error('저장 확인/처리 중에는 초안을 변경할 수 없습니다.');
    try {
      const result = moveWeekdayDistributionDraft({plans,move,cycles,compareRows,custKey:customer?.CustKey,scopeKey});
      setPlans(result.plans); setDraftHistory((current) => [{ ...result.event, at: new Date().toISOString() }, ...current]);
      setMessage('출고일 이동 초안을 기록했습니다. 입고기록은 변경하지 않으며 아직 ERP에는 적용되지 않았습니다.');
    } catch (error) { setMessage(error.message); throw error; }
  }

  async function findCustomers() {
    setCustomerError('');
    try {
      const result = await apiGet('/api/customers/search', { q: customerQuery.trim() });
      setCustomers(result.customers || []);
      if (!(result.customers || []).length) setCustomerError('검색된 거래처가 없습니다.');
    } catch (error) { setCustomerError(error.message); }
  }

  async function searchProducts() {
    setProductError('');
    try {
      const result = await apiGet('/api/products/search', { q: productQuery.trim() });
      setProducts((result.products || []).slice(0, 80));
      if (!(result.products || []).length) setProductError('검색된 품목이 없습니다.');
    } catch (error) { setProductError(error.message); }
  }

  async function uploadWorkbook(file) {
    if (!file || editLocked) return;
    const request=++uploadRequest.current,uploadScope=scopeKey;
    setBusy(true); setUploadError(''); setMessage('엑셀 구조를 읽는 중…');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/estimate/weekday-upload-preview', { method: 'POST', credentials: 'include', body: form });
      let result;
      try { result = await response.json(); } catch { throw new Error(response.status === 401 ? '로그인이 필요합니다.' : '서버 응답을 읽을 수 없습니다.'); }
      if (!response.ok || !result.success) throw new Error(result.error || '엑셀을 읽지 못했습니다.');
      if(request!==uploadRequest.current || uploadScope!==currentScope.current) return;
      comparisonRequest.current += 1;
      setParsed(result); setFileName(file.name); setMappings({}); setProductNames({}); setSelectedSource(null); setDraftHistory([]);
      setMessage(`원문 ${result.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)}행을 임시로 읽었습니다. 수식·문자 셀은 자동 변환하지 않았습니다.`);
    } catch (error) { if(request===uploadRequest.current && uploadScope===currentScope.current){setUploadError(error.message); setMessage('업로드 확인 필요');} }
    finally { if(request===uploadRequest.current && uploadScope===currentScope.current)setBusy(false); }
  }

  function addSourceRow(row) {
    if(editLocked) return;
    if (!customer?.CustKey) { setMessage('먼저 실제 거래처를 선택하세요.'); return; }
    if (!cycles.length) { setMessage('전산 달력을 먼저 확인하세요.'); return; }
    if (unit === '확인 필요') { setMessage('먼저 이 초안의 원본 수량 단위를 확인하세요.'); return; }
    const prodKey = mappings[`${row.sheet}|${row.row}`];
    if (!prodKey) { setMessage('먼저 선택 행을 ERP 품목에 연결하세요.'); return; }
    const numericDateCells = row.quantityCells.filter((cell) => cell.headerRole === 'date-quantity-candidate');
    if (!numericDateCells.length) { setMessage(`${row.label}: 날짜 수량으로 안전하게 인식된 숫자가 없습니다. 원본 셀을 확인하세요.`); return; }
    const candidates = numericDateCells.map((cell) => {
      const match = String(cell.columnHeader).match(/\(?\s*(\d{1,2})\s*일/);
      const matchingDays = match ? cycles.flatMap((cycle) => cycle.days.map((day) => ({cycle, day}))).filter(({day}) => Number(day.date.slice(8)) === Number(match[1])) : [];
      const destination = matchingDays.length === 1 ? matchingDays[0] : shipDate ? locateShippingDay(cycles,shipDate) : null;
      return {cell,destination};
    });
    if (candidates.some(({destination}) => !destination || destination.day.calendarState !== 'FOUND')) { setMessage('원본 날짜 헤더가 전산 달력과 연결되지 않습니다. 출고일을 확인하세요.'); return; }
    const additions = candidates.map(({cell,destination}) => ({
      id: draftKey({ ...row, cell }), sheet: row.sheet, sourceRow: row.row, sourceCell: cell.address,
      sourceLabel: row.label, raw: cell.raw, quantity: Number(cell.numericCandidate),
      prodKey: Number(prodKey), prodName: productNames[`${row.sheet}|${row.row}`] || '',
      custKey: Number(customer.CustKey),
      draftScope: scopeKey,
      year: destination.cycle.year, orderWeek: destination.day.orderWeek, date: destination.day.date, unit,
      sourceYear: null, sourceOrderWeek: null, wdetailKey: null,
      header: cell.columnHeader,
    })).filter((item) => item.header);
    if (plans.some((item) => additions.some((next) => next.sheet === item.sheet && next.sourceCell === item.sourceCell))) { setMessage('이미 초안에 포함된 원본 셀입니다. 이동/수량 변경으로 수정하세요.'); return; }
    setPlans((current) => [...current, ...additions]);
    setMessage(`${row.label}: 날짜 수량 후보 ${additions.length}건을 검토용 초안에 추가했습니다. ERP에는 저장되지 않았습니다.`);
  }

  function updatePlan(id, patch) {
    if(editLocked) return;
    const before = plans.find((item) => item.id === id);
    if (before && Object.keys(patch).some((key) => String(before[key] ?? '') !== String(patch[key] ?? ''))) {
      setDraftHistory((current) => [{ id: crypto.randomUUID(), kind:'DRAFT_EDIT', applied:false, at:new Date().toISOString(), prodKey:before.prodKey, before:{year:before.year,orderWeek:before.orderWeek,date:before.date,quantity:before.quantity}, after:{year:before.year,orderWeek:before.orderWeek,date:before.date,quantity:before.quantity,...patch} },...current]);
    }
    setPlans((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    // Keep last ERP snapshot visible; draft editing must not hide its differences.
  }

  async function compareWithErp() {
    if (!customer?.CustKey) { setMessage('실제 거래처를 선택하세요.'); return; }
    const invalid = activePlans.filter((plan) => Number(plan.custKey) === Number(customer.CustKey) && (!/^\d{4}$/.test(String(plan.year)) || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !/^\d{2}-\d{2}$/.test(plan.orderWeek) || !Number.isFinite(Number(plan.quantity)) || Number(plan.quantity) < 0 || plan.unit === '확인 필요'));
    if (invalid.length) { setMessage(`차수·날짜·수량·단위 확인이 필요한 행 ${invalid.length}건을 먼저 수정하세요.`); return; }
    await refreshErp();
  }

  async function refreshErp(extraProdKeys = []) {
    if(!customer?.CustKey) return false;
    const refreshScope=scopeKey;
    const request=++comparisonRequest.current;
    const isCurrent=()=>request===comparisonRequest.current && refreshScope===currentScope.current;
    setBaselineCandidates([]);
    setConfirmationStates([]);setConfirmationError('');
    setBusy(true);setQuoteResults([]); setMessage('앞·현재·뒤 차수의 동일 거래처·품목 전산값을 대조 중…');
    try {
      const ranges = new Map();
      for (const cycle of cycles.filter((item) => item.calendarState === 'FOUND')) {
        ranges.set(cycle.year, [...new Set([...(ranges.get(cycle.year) || []), ...cycle.days.map((day) => day.orderWeek)])]);
      }
      for (const plan of activePlans) ranges.set(Number(plan.year), [...new Set([...(ranges.get(Number(plan.year)) || []), plan.orderWeek])]);
      const results = await Promise.all([...ranges].map(async ([requestYear,orderWeeks]) => {
        const inventory=await apiGet('/api/estimate/weekday-products',{year:requestYear,custKey:Number(customer.CustKey),orderWeeks:orderWeeks.join(',')});
        const baselineResult=await apiGet('/api/estimate/weekday-baseline',{year:requestYear,custKey:Number(customer.CustKey),orderWeeks:(inventory.scope?.orderWeeks || orderWeeks).join(',')});
        const savedBaselines=baselineResult.baselines || [];
        const candidateWeeks=[...new Set(cycles.filter(cycle=>cycle.calendarState==='FOUND' && Number(cycle.year)===Number(requestYear)).flatMap(cycle=>cycle.days.map(day=>day.orderWeek)))];
        const candidates=await Promise.all(candidateWeeks.filter(orderWeek=>!savedBaselines.some(record=>Number(record.year)===Number(requestYear) && record.orderWeek===orderWeek && Number(record.custKey)===Number(customer.CustKey))).map(async orderWeek=>{
          const scope={year:Number(requestYear),orderWeek,custKey:Number(customer.CustKey)};
          try {
            const response=await fetch('/api/estimate/weekday-baseline',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',...scope})});
            const result=await response.json();
            if(!response.ok || !result.success) throw new Error(result.error || '현재 분배 기준 조회 실패');
            const preview=result.preview;
            if(result.readOnly!==true || Number(preview?.year)!==scope.year || preview?.orderWeek!==orderWeek || Number(preview?.custKey)!==scope.custKey || !Array.isArray(preview?.rows)) throw new Error('분배 기준 응답 범위 확인 필요');
            return {...preview,provisional:true};
          } catch(error) {return {...scope,provisional:true,error:error.message,rows:[]};}
        }));
        const scope=`${customer.CustKey}|${year}|${majorWeek}`;
        const addedKeys=addedProductScope.current.scope===scope ? addedProductScope.current.keys : [];
        const prodKeys=[...new Set([...(inventory.products||[]).map(item=>Number(item.ProdKey)),...savedBaselines.flatMap(record=>record.rows.map(item=>Number(item.prodKey))),...activePlans.map(item=>Number(item.prodKey)),...addedKeys,...(Array.isArray(extraProdKeys)?extraProdKeys:[])])];
        if(!prodKeys.length) return {rows:[],sourceLots:[],history:[],baselines:savedBaselines,candidates};
        const compareScope={ year: requestYear, custKey: Number(customer.CustKey), orderWeeks:inventory.scope?.orderWeeks || orderWeeks, prodKeys };
        const response = await fetch('/api/estimate/weekday-compare', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compareScope),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '전산 대조에 실패했습니다.');
      validateWeekdayDistributionCompareResponse(compareScope,result);
      return {...result,baselines:savedBaselines,candidates};
      }));
      if (!isCurrent()) return false;
      freshCompareRows.current = results.flatMap((result) => result.rows);
      setCompareRows(freshCompareRows.current); setSourceLots(results.flatMap((result) => result.sourceLots || [])); setErpHistory(results.flatMap((result) => result.history || []));
      setBaselines(results.flatMap(result=>result.baselines || []));
      setBaselineCandidates(results.flatMap(result=>result.candidates || []));
      const ancillary=await Promise.all(cycles.filter(cycle=>cycle.calendarState==='FOUND').map(async cycle=>{
        let notes=[],quote=null,changes=[],changeError='',confirmation=null,confirmationFailure='',wilson=[],wilsonFailure='';
        try {const result=await apiGet('/api/estimate/weekday-wilson',{year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey)});
          if(result.success!==true || !Array.isArray(result.records)) throw new Error('윌슨 구분 응답 확인 필요');
          wilson=result.records;
        } catch(error) {wilsonFailure=`${cycle.year}/${cycle.majorWeek}: ${error.message}`;}
        try {
          const confirmationScope={year:cycle.year,majorWeek:cycle.majorWeek};
          confirmation=validateWeekdayConfirmationResponse(confirmationScope,
            await apiGet('/api/estimate/weekday-confirmation',confirmationScope));
        } catch(error) {
          confirmationFailure=`${cycle.year}/${cycle.majorWeek} ERP 확정 현황 조회 실패: ${error.message}`;
          confirmation={year:cycle.year,majorWeek:cycle.majorWeek,state:'UNKNOWN',categories:[],error:confirmationFailure};
        }
        try {
          const history=await apiGet('/api/estimate/weekday-changes',{custKey:Number(customer.CustKey),year:cycle.year,majorWeek:cycle.majorWeek});
          if(history.success!==true || !Array.isArray(history.changes)) throw new Error('영구 이력 응답을 확인할 수 없습니다.');
          changes=history.changes;
        }
        catch(error) {changeError=`${cycle.year}/${cycle.majorWeek} 저장 이력 조회 실패: ${error.message}`;}
        try {notes=(await apiGet('/api/estimate/weekday-note',{year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey)})).notes || [];}
        catch(error) {throw new Error(`비고 조회 실패: ${error.message}`);}
        try {
          const response=await fetch('/api/estimate/weekday-print',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey),mode:'major',dates:[]})});
          const result=await response.json();
          const expectedBlocked=isExpectedWeekdayPrintBlock(response.status,result);
          if((!response.ok || result.success!==true) && !expectedBlocked) throw new Error(result.error || '견적 조회 실패');
          quote=expectedBlocked ? {year:cycle.year,majorWeek:cycle.majorWeek,printReadiness:result.printReadiness}
            : {year:cycle.year,majorWeek:cycle.majorWeek,items:result.items || []};
          if(!expectedBlocked) try {
            const management=await apiGet('/api/estimate',{year:cycle.year,week:cycle.majorWeek,custKey:Number(customer.CustKey),byDate:1,itemsOnly:1});
            if(!Array.isArray(management.items)) throw new Error('견적 관리 상세를 읽을 수 없습니다.');
            quote.managementItems=management.items;
          } catch(error) {quote.managementError=error.message;}
        } catch(error) {quote={year:cycle.year,majorWeek:cycle.majorWeek,error:error.message};}
        return {notes,quote,changes,changeError,confirmation,confirmationFailure,wilson,wilsonFailure};
      }));
      if(!isCurrent()) return false;
      setSavedHistory(ancillary.flatMap(result=>result.changes));setHistoryError(ancillary.map(result=>result.changeError).filter(Boolean).join(' / '));
      setPageNotes(ancillary.flatMap(result=>result.notes));setQuoteResults(ancillary.map(result=>result.quote));
      setWilsonRecords(ancillary.flatMap(result=>result.wilson));
      setWilsonError(current=>ancillary.map(result=>result.wilsonFailure).filter(Boolean).join(' / ')
        || (wilsonPendingRef.current.length ? current || 'ERP 합계 저장 완료 · 윌슨 구분값 저장 확인 필요' : ''));
      setConfirmationStates(ancillary.map(result=>result.confirmation));
      setConfirmationError(ancillary.map(result=>result.confirmationFailure).filter(Boolean).join(' / '));
      await refreshCarryover();
      if(!isCurrent()) return false;
      setMessage(`전후 차수 전산 대조 완료 · 읽기 전용 · ERP 변경 없음${results.some((result)=>result.historyTruncated) ? ' · 이력 1000건 초과, 일부 표시' : ''}`);
      return true;
    } catch (error) { if (isCurrent()) setMessage(error.message); return {success:false,error:error.message}; }
    finally { if (isCurrent()) setBusy(false); }
  }

  function shiftCenter(offset) {
    const target=cycles.find(cycle=>cycle.offset===offset && cycle.calendarState==='FOUND');
    if(!target || busy || baselineBusy || noteBusy || carryoverBusy) return;
    touchCenter();
    setYear(String(target.year));setMajorWeek(String(target.majorWeek));
  }

  function openPageNote({row,block}) {
    const saved=pageNotes.find(record=>Number(record.year)===Number(block.cycle.year) && record.majorWeek===block.cycle.majorWeek && Number(record.prodKey)===row.prodKey);
    setNoteError('');
    const source=saved?.earlyShipment;
    setNoteForm({year:block.cycle.year,majorWeek:block.cycle.majorWeek,custKey:Number(customer.CustKey),prodKey:row.prodKey,name:row.name,unit:block.unit,
      note:saved?.note || '',expectedRevision:saved?.revision ?? 0,earlyDate:source?.date || '',sourceYear:String(source?.sourceYear ?? block.cycle.year),sourceOrderWeek:source?.sourceOrderWeek || '',earlyQuantity:source?.quantity==null?'':String(source.quantity),
      initial:block.initialMajor,current:block.currentTotal,change:block.initialChange,quote:block.quote,days:block.cycle.days});
  }

  async function savePageNote() {
    if(noteLock.current || !noteForm || noteForm.custKey!==Number(customer?.CustKey)) return;
    noteLock.current=true;setNoteBusy(true);setNoteError('');const request=++noteRequest.current;
    try {
      const form=noteForm;
      const hasEarly=Boolean(form.earlyDate || form.sourceOrderWeek || form.earlyQuantity);
      const earlyShipment=hasEarly?{date:form.earlyDate,sourceYear:Number(form.sourceYear),sourceOrderWeek:form.sourceOrderWeek,quantity:Number(form.earlyQuantity),unit:form.unit,confirmation:'MANUAL_USER_DECLARATION'}:null;
      if(hasEarly && (!form.earlyQuantity.trim() || !form.earlyDate || !form.sourceOrderWeek)) throw new Error('선출고는 날짜·물량 차수·양수 수량을 모두 입력하세요. 제거하려면 세 칸을 모두 비우세요.');
      const response=await fetch('/api/estimate/weekday-note',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:form.year,majorWeek:form.majorWeek,custKey:form.custKey,prodKey:form.prodKey,note:form.note,earlyShipment,expectedRevision:form.expectedRevision})});
      const result=await response.json();
      if(!response.ok || !result.success) throw new Error(result.error || '비고 저장 실패');
      if(request!==noteRequest.current) return;
      const saved=result.note;
      setPageNotes(current=>[...current.filter(record=>!(record.year===saved.year&&record.majorWeek===saved.majorWeek&&record.prodKey===saved.prodKey&&record.custKey===saved.custKey)),saved]);
      setNoteForm(current=>({...current,expectedRevision:saved.revision}));
      setMessage('비고·담당자 선출고 확인을 저장했습니다. 실제 ERP 분배·재고·견적은 변경하지 않았습니다.');
    } catch(error) {if(request===noteRequest.current)setNoteError(error.message);}
    finally {noteLock.current=false;setNoteBusy(false);}
  }

  async function openBaselineConfirmation({cycle,orderWeek}) {
    if(baselineLock.current || !customer?.CustKey || busy) return;
    baselineLock.current=true;setBaselineBusy(true);setBaselineError('');
    const request=++baselineRequest.current;
    try {
      const response=await fetch('/api/estimate/weekday-baseline',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'preview',year:cycle.year,orderWeek,custKey:Number(customer.CustKey)})});
      const result=await response.json();
      if(!response.ok || !result.success) throw new Error(result.error || '최초 기준 조회 실패');
      if(request===baselineRequest.current) setBaselinePreview(result.preview);
    } catch(error) {if(request===baselineRequest.current)setBaselineError(error.message);}
    finally {baselineLock.current=false;setBaselineBusy(false);}
  }

  async function confirmInitialBaseline() {
    if(baselineLock.current || !baselinePreview || Number(baselinePreview.custKey)!==Number(customer?.CustKey)) return;
    baselineLock.current=true;setBaselineBusy(true);setBaselineError('');
    const request=++baselineRequest.current;
    const preview=baselinePreview;
    try {
      const response=await fetch('/api/estimate/weekday-baseline',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'confirm',year:preview.year,orderWeek:preview.orderWeek,custKey:preview.custKey,expectedDigest:preview.digest})});
      const result=await response.json();
      if(!response.ok || !result.success) throw new Error(result.error || '최초 기준 저장 실패');
      if(request!==baselineRequest.current) return;
      setBaselinePreview(null);
      setBaselines(current=>[...current.filter(record=>!(record.year===result.baseline.year && record.orderWeek===result.baseline.orderWeek && record.custKey===result.baseline.custKey)),result.baseline]);
      await refreshCarryover();
      if(request!==baselineRequest.current) return;
      setMessage(`${preview.year}/${preview.orderWeek} 최초분배 기준을 보관했습니다. 전산 확정·분배·재고는 변경하지 않았습니다.`);
    } catch(error) {if(request===baselineRequest.current)setBaselineError(error.message);}
    finally {baselineLock.current=false;setBaselineBusy(false);}
  }

  async function searchGridProducts(query) {
    const result=await apiGet('/api/products/search',{q:query});
    return result.products || [];
  }
  async function addGridProduct(product) {
    if(!customer?.CustKey || !cycles.some(cycle=>cycle.calendarState==='FOUND')) return {success:false,error:'거래처와 전산 달력을 먼저 확인하세요.'};
    const key=Number(product.ProdKey);
    if(!Number.isInteger(key)||key<=0) return {success:false,error:'유효한 ERP 품목을 선택하세요.'};
    const scope=`${customer.CustKey}|${year}|${majorWeek}`;
    const result=await refreshErp([key]);
    if(result!==true) return result || false;
    const previous=addedProductScope.current.scope===scope ? addedProductScope.current.keys : [];
    addedProductScope.current={scope,keys:[...new Set([...previous,key])]};
    setMessage('품목을 표에 추가했습니다. 수량 입력은 미적용 초안이며 전산 등록·재고 변경은 하지 않았습니다.');
    return true;
  }

  function editGridCell(cell) {
    if(editLocked) return false;
    const qty=Number(cell.quantity);
    const destination=locateShippingDay(cycles,cell.date);
    const normalizedUnit=normalizeWeekdayUnit(cell.unit);
    if(!customer?.CustKey || !normalizedUnit || !destination || destination.day.calendarState!=='FOUND'
      || Number(cell.year)!==destination.cycle.year || String(cell.orderWeek).split('-')[0]!==destination.cycle.majorWeek
      || !Number.isFinite(qty)||qty<0) {setMessage('수량·단위·전산 달력·차수 기준을 확인하세요.');return false;}
    const matching=activePlans.filter(item=>Number(item.custKey)===Number(customer.CustKey)&&Number(item.prodKey)===Number(cell.prodKey)&&Number(item.year)===Number(cell.year)&&item.date===cell.date);
    if(matching.length>1 || matching.some(item=>normalizeWeekdayUnit(item.unit)!==normalizedUnit||item.orderWeek!==cell.orderWeek)) {
      setMessage('이 날짜에는 복수 초안 또는 다른 업무차수/단위가 있습니다. 상세 초안에서 각각 수정하세요.');return false;
    }
    const existingSplit=wilsonDrafts.find(item=>wilsonRecordKey(item)===wilsonRecordKey({...cell,custKey:Number(customer.CustKey)}))
      || wilsonRecords.find(item=>wilsonRecordKey(item)===wilsonRecordKey({...cell,custKey:Number(customer.CustKey)}) && item.status==='CURRENT');
    const splitQuantity=cell.wilsonQuantity ?? existingSplit?.wilsonQuantity;
    if(splitQuantity!=null && (!Number.isFinite(Number(splitQuantity)) || Number(splitQuantity)<0 || qty<Number(splitQuantity))) {setWilsonError('날짜 합계는 윌슨 수량보다 작을 수 없습니다. 윌슨 수량을 먼저 수정하세요.');return false;}
    if(matching.length===1) updatePlan(matching[0].id,{quantity:qty});
    else {
      const actual=compareRows?.filter(row=>row.year===Number(cell.year)&&row.orderWeek===cell.orderWeek&&row.prodKey===Number(cell.prodKey));
      const dates=(actual||[]).flatMap(row=>row.shipmentDates||[]).filter(item=>String(item.date).slice(0,10)===cell.date);
      const before=dates.length?dates.reduce((sum,item)=>sum+Number(item.shipmentQuantity),0):null;
      const plan={id:`grid|${scopeKey}|${cell.year}|${cell.orderWeek}|${cell.prodKey}|${cell.date}`,draftScope:scopeKey,custKey:Number(customer.CustKey),prodKey:Number(cell.prodKey),prodName:cell.prodName,
        year:Number(cell.year),orderWeek:cell.orderWeek,date:cell.date,quantity:qty,unit:normalizedUnit,sourceLabel:'표 직접 입력',sheet:'전산 대조',sourceCell:cell.date,raw:before,header:cell.date,sourceYear:null,sourceOrderWeek:null,wdetailKey:null};
      setPlans(current=>[...current,plan]);
      setDraftHistory(current=>[{id:crypto.randomUUID(),kind:'GRID_DRAFT_EDIT',applied:false,at:new Date().toISOString(),prodKey:plan.prodKey,
        before:{year:plan.year,orderWeek:plan.orderWeek,date:plan.date,quantity:before},after:{year:plan.year,orderWeek:plan.orderWeek,date:plan.date,quantity:qty}},...current]);
    }
    setMessage('요일 수량 초안을 기록했습니다. 전산 분배·재고는 변경되지 않았습니다.');
    const identity={year:Number(cell.year),orderWeek:cell.orderWeek,custKey:Number(customer.CustKey),prodKey:Number(cell.prodKey),date:cell.date};
    const key=wilsonRecordKey(identity);
    const split=wilsonDrafts.find(item=>wilsonRecordKey(item)===key) || wilsonRecords.find(item=>wilsonRecordKey(item)===key && item.status==='CURRENT');
    if(split) {
      const record={...identity,majorWeek:String(cell.orderWeek).slice(0,2),unit:normalizedUnit,
        wilsonQuantity:cell.wilsonQuantity ?? split.wilsonQuantity,expectedTotal:qty,expectedRevision:split.expectedRevision ?? split.revision ?? 0,scopeKey};
      setWilsonDrafts(current=>[...current.filter(item=>wilsonRecordKey(item)!==key),record]);
    }
    return true;
  }

  async function assertCurrentInputOwner(owner=inputUser) {
    if(!owner || owner!==inputUser) throw new Error('입력의 사용자와 현재 화면의 사용자가 다릅니다. 입력을 보존하고 새로고침하세요.');
    const authenticated=await apiGet('/api/auth/me');
    if(authenticated?.success!==true || authenticated.user?.userId!==owner) {
      throw new Error('로그인 사용자가 변경되었습니다. 입력을 보존하고 새로고침 후 확인하세요.');
    }
  }

  async function writeWilson(record) {
    await assertCurrentInputOwner();
    const result=await apiPost('/api/estimate/weekday-wilson',wilsonWriteInput(record));
    validateWilsonWriteResponse(record,result);
    setWilsonRecords(current=>[...current.filter(item=>wilsonRecordKey(item)!==wilsonRecordKey(record)),{...result.record,status:result.record.status ?? 'CURRENT'}]);
    return result.record;
  }

  async function editWilson({row,block,day,quantity,totalQuantity,classificationOnly=false}) {
    if(editLocked || wilsonLock.current || busy || !customer?.CustKey) return false;
    const value=Number(quantity),total=Number(classificationOnly ? day.current : totalQuantity);
    if(!Number.isFinite(value) || value<0 || !Number.isFinite(total) || total<value
      || day.current==null && classificationOnly || day.editDisabledReason) {setWilsonError('일반·윌슨 합계와 실제 날짜·차수·단위를 확인하세요.');return false;}
    const identity={year:Number(block.cycle.year),majorWeek:String(block.cycle.majorWeek),orderWeek:day.effectiveOrderWeek ?? day.orderWeek,
      custKey:Number(customer.CustKey),prodKey:Number(row.prodKey),date:day.date,unit:day.unit};
    const key=wilsonRecordKey(identity),saved=wilsonRecords.find(item=>wilsonRecordKey(item)===key);
    const record={...identity,wilsonQuantity:value,expectedTotal:total,expectedRevision:saved?.revision ?? 0,scopeKey};
    if(classificationOnly && activePlans.some(plan=>Number(plan.year)===identity.year && Number(plan.prodKey)===identity.prodKey && plan.date===identity.date)) {
      setWilsonError('미적용 수량 초안을 먼저 저장하거나 제거한 뒤 기존 합계를 분류하세요.');return false;
    }
    if(classificationOnly) {
      wilsonLock.current=true;setWilsonBusy(true);setWilsonError('');
      try {await writeWilson(record);setMessage('윌슨 구분값을 저장했습니다. ERP 날짜 합계·견적·재고는 변경하지 않았습니다.');return true;}
      catch(error) {setWilsonError(error.message);return false;}
      finally {wilsonLock.current=false;setWilsonBusy(false);}
    }
    if(!editGridCell({...identity,prodName:row.name,quantity:total,wilsonQuantity:value})) return false;
    setWilsonDrafts(current=>[...current.filter(item=>wilsonRecordKey(item)!==key),record]);
    setWilsonError('');setMessage('일반 + 윌슨 합계 초안입니다. ERP 저장 후 윌슨 구분값도 저장됩니다.');return true;
  }

  async function retryWilson(pending=wilsonPending) {
    if(wilsonLock.current || applyLock.current) return;
    wilsonLock.current=true;setWilsonBusy(true);
    const remaining=[];
    try {
      await assertCurrentInputOwner();
      for(const record of pending) {
        try {await writeWilson(record);}
        catch(error) {remaining.push(record);setWilsonError(`윌슨 구분값 저장 확인 필요: ${error.message} · ERP 합계를 다시 저장하지 마세요.`);}
      }
      setWilsonPending(remaining);wilsonPendingRef.current=remaining;
      try {sessionStorage.setItem(wilsonRecoveryKey,JSON.stringify(remaining));}
      catch {setWilsonError('ERP 저장은 완료됐지만 윌슨 복구 기록을 보관할 수 없습니다. 이 화면에서 저장 결과를 확인하세요.');return false;}
      if(!remaining.length) setWilsonError('');
      return remaining.length===0;
    } catch(error) {setWilsonError(error.message);return false;}
    finally {wilsonLock.current=false;setWilsonBusy(false);}
  }

  async function openWeekdayPrint({cycle,dates,mode}) {
    if(printLock.current||!customer?.CustKey) return;
    const draftReason=weekdayUnsavedPrintReason(plans,cycle,customer.CustKey,scopeKey);
    if(draftReason || pendingApply || applyBusy) {setMessage(draftReason || '저장 결과 확인 후 인쇄하세요.');return {success:false,error:draftReason || '저장 결과 확인 후 인쇄하세요.'};}
    const requestedScope=scopeKey;
    printLock.current=true;setPrintBusy(true);setPrintPreview(null);const request=++printRequest.current;
    try {
      const requests=buildWeekdayPrintRequests({cycle,dates,mode,custKey:Number(customer.CustKey)});
      const results=await Promise.all(requests.map(async scope=>{
        const response=await fetch('/api/estimate/weekday-print',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(scope)});
        const result=await response.json();
        if(!response.ok || result.success!==true) throw new Error(`${scope.dates[0] || '전체 차수'}: ${result.error || '견적 조회 실패'} · 전체 미리보기를 열지 않았습니다.`);
        return validateWeekdayPrintResponse(scope,result);
      }));
      if(request!==printRequest.current || requestedScope!==currentScope.current) return;
      let logoDataUrl='';
      const logo=await fetch('/nenova-logo-estimate.png');
      if(logo.ok) {
        const blob=await logo.blob();
        logoDataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve('');reader.readAsDataURL(blob);});
      }
      if(request!==printRequest.current || requestedScope!==currentScope.current) return;
      const bundle=buildWeekdayEstimatePrintBundle({requests,results,printDate:new Date().toISOString().slice(0,10),logoDataUrl});
      if(!bundle.html) {setMessage(bundle.note || '선택 범위의 확정 견적 자료가 없습니다. 미적용 초안은 인쇄하지 않습니다.');return {success:true,empty:true};}
      setPrintPreview(bundle);
      if(bundle.emptyDates.length)setMessage(bundle.note);
      return {success:true};
    } catch(error) {if(request===printRequest.current && requestedScope===currentScope.current){setPrintPreview(null);setMessage(error.message);return {success:false,error:error.message};}}
    finally {printLock.current=false;setPrintBusy(false);}
  }

  async function openErpSave() {
    if(applyLock.current || pendingOperation.current || recoveryBlocked || busy) return;
    applyLock.current = true;
    setApplyError('');
    try {
      const requestedScope = scopeKey;
      if (await refreshErp() !== true || requestedScope !== currentScope.current) throw new Error('최신 전산 조회를 확인한 뒤 분배 적용을 다시 확인하세요.');
      const submission=buildWeekdayDistributionSubmission({mode:'ALLOCATION',wilsonDrafts,plans:activePlans,compareRows:freshCompareRows.current,cycles,custKey:customer?.CustKey,scopeKey,reason:applyReason.trim() || '미리보기',operationId:crypto.randomUUID()});
      setApplyPreview(submission);printRequest.current+=1;setPrintPreview(null);
    } catch(error) {setApplyError(error.message);}
    finally { applyLock.current = false; }
  }

  async function finishErpSave(submission,outcome) {
    if(outcome.state==='saved') {
      let keepErpRecovery=false;
      const splits=submission.wilson || [];
      if(splits.length) {
        const pending=[...wilsonPending.filter(item=>!splits.some(split=>wilsonRecordKey(split)===wilsonRecordKey(item))),...splits];
        setWilsonPending(pending);wilsonPendingRef.current=pending;
        try {sessionStorage.setItem(wilsonRecoveryKey,JSON.stringify(pending));}
        catch {setWilsonError('ERP 저장 완료 · 윌슨 복구 기록 보관 실패. 구분값을 다시 확인하세요.');}
        // The saved UUID is never replayed for a metadata failure.
        applyLock.current=false;
        keepErpRecovery=await retryWilson(pending)===false;
        applyLock.current=true;
        setWilsonDrafts(current=>current.filter(item=>!splits.some(split=>wilsonRecordKey(item)===wilsonRecordKey(split) && item.expectedTotal===split.expectedTotal && item.wilsonQuantity===split.wilsonQuantity)));
      }
      pendingOperation.current=null;setPendingApply(null);
      setPlans(current=>clearSubmittedWeekdayDrafts(current,submission));
      if (inputUser) {
        try { setStoredInputs(clearWeekdayStoredSubmission(localStorage, inputUser, submission)); setInputStorageError(''); }
        catch (error) { keepErpRecovery = true; setInputStorageError(`ERP 적용은 완료됐지만 보관 입력 정리에 실패했습니다. 새로고침 전에 입력만 저장으로 정리하세요. ${error.message}`); }
      }
      if(!keepErpRecovery) try {sessionStorage.removeItem('weekday-pending-erp-operation');} catch { /* In-memory identity remains authoritative. */ }
      setApplyPreview(null);setApplyError('');
      if(submission.scopeKey===currentScope.current) {
        setApplyReason('');
        const refreshed=await refreshErp();
        setMessage(refreshed===true?'ERP 저장 응답을 확인했습니다. 저장된 요일 수량·견적·이력을 다시 조회했습니다. 최초 기준은 보존됩니다.':'ERP 저장은 확인됐으나 최신 자료 재조회에 실패했습니다. 전산 새로고침으로 확인하세요.');
      } else setMessage('이전 조회 범위의 ERP 저장을 확인했습니다. 제출한 초안만 정리했으며 현재 범위는 변경하지 않았습니다.');
    } else if(outcome.state==='failed') {
      try {sessionStorage.removeItem('weekday-pending-erp-operation');} catch { /* Keep drafts and error. */ }
      pendingOperation.current=null;setPendingApply(null);setApplyError(outcome.error);
      setApplyPreview(current=>current?{...current,payload:{...current.payload,operationId:crypto.randomUUID()}}:current);
    } else {setPendingApply(submission);setApplyError(outcome.error);}
  }

  async function finishMetadataOnlySave(submission) {
    await assertCurrentInputOwner(submission.inputUser);
    const splits=submission.wilson || [];
    if(!splits.length || submission.payload.changes.length || !submission.metadataChanges?.length
      || wilsonPendingAfterSave(splits,submission).length!==splits.length) throw new Error('윌슨 구분 저장의 확인 자료가 불완전합니다. 입력을 보존하고 다시 확인하세요.');
    const pending=[...wilsonPendingRef.current.filter(item=>!splits.some(split=>wilsonRecordKey(split)===wilsonRecordKey(item))),...splits];
    // Persist metadata recovery before any classification write. No ERP UUID is submitted.
    sessionStorage.setItem(wilsonRecoveryKey,JSON.stringify(pending));
    setWilsonPending(pending);wilsonPendingRef.current=pending;
    applyLock.current=false;
    let saved;
    try {saved=await retryWilson(pending);}
    finally {applyLock.current=true;}
    if(saved!==true) {setPendingApply(submission);setApplyError('윌슨 구분값 저장 결과를 확인하세요. ERP 날짜 합계는 변경하지 않았으며 입력 초안을 유지했습니다.');return;}
    // Only successful metadata commits release the unchanged absolute-quantity drafts.
    setPlans(current=>clearSubmittedWeekdayDrafts(current,submission));
    setWilsonDrafts(current=>current.filter(item=>!splits.some(split=>wilsonRecordKey(item)===wilsonRecordKey(split)
      && item.expectedTotal===split.expectedTotal && item.wilsonQuantity===split.wilsonQuantity)));
    let keepRecovery=false;
    if(inputUser) {
      try {setStoredInputs(clearWeekdayStoredSubmission(localStorage,inputUser,submission));setInputStorageError('');}
      catch(error) {keepRecovery=true;setInputStorageError(`윌슨 구분은 저장됐지만 보관 입력 정리에 실패했습니다. ${error.message}`);}
    }
    if(!keepRecovery) sessionStorage.removeItem('weekday-pending-erp-operation');
    pendingOperation.current=null;setPendingApply(null);setApplyPreview(null);setApplyError('');
    if(submission.scopeKey===currentScope.current) {setApplyReason('');await refreshErp();}
    setMessage('윌슨 구분값을 저장했습니다. 기존 ERP 날짜 합계·견적·재고는 그대로 유지했습니다.');
  }

  async function confirmErpSave() {
    if(applyLock.current || pendingOperation.current || recoveryBlocked || !applyPreview || applyPreview.scopeKey!==currentScope.current) return;
    try {await assertCurrentInputOwner();}
    catch(error) {setApplyError(error.message);return;}
    if(applyLock.current || pendingOperation.current || applyPreview.scopeKey!==currentScope.current) return;
    let submission;
    try {submission=buildWeekdayDistributionSubmission({mode:'ALLOCATION',wilsonDrafts,plans:activePlans,compareRows,cycles,custKey:customer?.CustKey,scopeKey,reason:applyReason,operationId:applyPreview.payload.operationId});}
    catch(error) {setApplyError(error.message);return;}
    if(!weekdayDistributionPreviewMatches(applyPreview,submission)) {setApplyError('미리보기 후 초안/전산 전체 스냅샷이 변경됐습니다. 닫고 다시 확인하세요.');return;}
    submission.drafts=activePlans.filter(plan=>submission.submitted.includes(JSON.stringify(plan)));
    submission.wilson=wilsonPendingAfterSave(wilsonDrafts.filter(record=>record.scopeKey===scopeKey),submission);
    submission.inputUser = inputUser;
    try {
      // A newer ERP UUID must not overwrite the only durable copy of older splits.
      if(wilsonPendingRef.current.length) sessionStorage.setItem(wilsonRecoveryKey,JSON.stringify(wilsonPendingRef.current));
      sessionStorage.setItem('weekday-pending-erp-operation',JSON.stringify(submission));
    }
    catch {setApplyError('작업 UUID를 보관할 수 없습니다. 브라우저 저장소를 확인한 뒤 저장하세요.');return;}
    applyLock.current=true;pendingOperation.current=submission;setApplyBusy(true);setApplyError('');
    try {
      if(submission.metadataOnly) await finishMetadataOnlySave(submission);
      else await finishErpSave(submission,await saveWeekdayDistribution(submission));
    } catch(error) {setPendingApply(submission);setApplyError(error.message);}
    finally {applyLock.current=false;setApplyBusy(false);}
  }

  async function recheckErpSave() {
    const submission=pendingOperation.current;
    if(!submission || applyLock.current) return;
    applyLock.current=true;setApplyBusy(true);
    try {
      await assertCurrentInputOwner(submission.inputUser);
      if(submission.metadataOnly) await finishMetadataOnlySave(submission);
      else await finishErpSave(submission,await checkWeekdayDistributionStatus(submission));
    } catch(error) {setApplyError(error.message);}
    finally {applyLock.current=false;setApplyBusy(false);}
  }

  const style = `
    .weekday-workspace { color:#122033; max-width:100%; margin:0 auto; padding:8px; font-size:13px; }
    .weekday-workspace button { border:1px solid #7892b0; border-radius:4px; padding:4px 8px; color:#16345a; background:#f8fbff; cursor:pointer; font-weight:600; }
    .weekday-workspace button.primary { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
    .weekday-workspace button:disabled { opacity:.5; cursor:not-allowed; }
    .weekday-workspace input,.weekday-workspace select { font:inherit; color:inherit; }
    .weekday-workspace table { border-collapse:collapse; width:100%; }
    .weekday-workspace th,.weekday-workspace td { border-bottom:1px solid #dce4ed; text-align:left; padding:5px; vertical-align:top; }
    .weekday-workspace th { background:#eff5fc; position:sticky; top:0; z-index:1; }
    .weekday-workspace .scroll-table { overflow-x:auto; border:1px solid #dce4ed; border-radius:8px; }
    .weekday-workspace .grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:8px; }
    .weekday-workspace .span-12 { grid-column:span 12; }
    .weekday-workspace .span-6 { grid-column:span 6; }
    .weekday-workspace .span-4 { grid-column:span 4; }
    .weekday-workspace .muted { color:#586b80; font-size:13px; }
    .weekday-workspace .tag { display:inline-flex; background:#edf4ff; padding:3px 7px; border-radius:99px; margin:2px; font-size:12px; }
    .weekday-print-overlay { position:fixed; inset:0; background:#13223888; z-index:3000; display:flex; align-items:center; justify-content:center; padding:12px; }
    .weekday-print-dialog { background:white; border-radius:6px; width:min(100%,1050px); height:calc(100vh - 24px); display:flex; flex-direction:column; padding:10px; gap:8px; box-sizing:border-box; }
    .weekday-print-dialog iframe { flex:1; min-height:0; width:100%; border:1px solid #cbd5e1; }
    .weekday-carry-dialog { width:min(620px,100%); max-height:calc(100dvh - 24px); overflow:auto; box-sizing:border-box; font-size:14px; color:#122033; }
    .weekday-carry-dialog h2 { font-size:18px; margin:0; }
    .weekday-carry-dialog button { font-size:14px; }
    .weekday-carry-dialog label { display:block; margin:10px 0; }
    .weekday-carry-dialog input,.weekday-carry-dialog textarea { display:block; width:100%; min-width:0; box-sizing:border-box; padding:7px; border:1px solid #7892b0; border-radius:4px; font:inherit; color:#122033; background:#fff; }
    .weekday-carry-dialog :is(button,input,textarea):focus-visible { outline:3px solid #1d4ed8; outline-offset:2px; }
    .weekday-carry-dialog .carry-history { max-height:250px; overflow:auto; border:1px solid #cbd5e1; padding:8px; overflow-wrap:anywhere; }
    .weekday-carry-dialog .carry-history p { margin:0; padding:7px 0; border-bottom:1px solid #dce4ed; }
    @media(max-width:900px) { .weekday-workspace .span-6,.weekday-workspace .span-4 { grid-column:span 12; } .weekday-workspace { padding:10px; } }
  `;

  return <main className="weekday-workspace">
    <style>{style}</style>
    <header style={{ ...panel, background:'#f3f8ff', marginBottom:6 }}>
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:8 }}>
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ color:'#16439a', fontSize:18, fontWeight:800 }}>주광 견적서 · {customer?.CustName || '주광 자동 조회 중'}</div>
        </div>
        <label>연도 <input disabled={applyBusy || carryoverBusy} aria-label="조회 연도" style={{ ...inputStyle, width:70 }} value={year} onChange={(e) => {touchCenter();setYear(e.target.value);}} inputMode="numeric" /></label>
        <label>중심 차수 <input disabled={applyBusy || carryoverBusy} aria-label="중심 차수" style={{ ...inputStyle, width:50 }} value={majorWeek} onChange={(e) => {touchCenter();setMajorWeek(e.target.value);}} inputMode="numeric" /></label>
        <button aria-label="이전 차수를 중심으로" disabled={applyBusy || busy || baselineBusy || noteBusy || carryoverBusy || !cycles.some(cycle=>cycle.offset===-1&&cycle.calendarState==='FOUND')} onClick={()=>shiftCenter(-1)}>◀</button>
        <button aria-label="다음 차수를 중심으로" disabled={applyBusy || busy || baselineBusy || noteBusy || carryoverBusy || !cycles.some(cycle=>cycle.offset===1&&cycle.calendarState==='FOUND')} onClick={()=>shiftCenter(1)}>▶</button>
        <input aria-label="요일별 출고 엑셀 파일" style={{width:230}} type="file" accept=".xlsx,.xls" onChange={(e) => {setToolsOpen(true);uploadWorkbook(e.target.files?.[0]);}} disabled={busy || editLocked} />
        <button onClick={compareWithErp} disabled={busy || editLocked || !customer}>전산 새로고침</button>
        <button onClick={saveInputOnly} disabled={!inputLoaded || !inputUser || editLocked || busy || !customer}>입력만 저장</button>
        <button aria-label="ERP 저장 · 변경 확인" className="primary" onClick={openErpSave} disabled={busy || editLocked || !activePlans.length || !compareRows}>분배 적용 · 변경 확인</button>
        <button aria-expanded={toolsOpen} onClick={()=>setToolsOpen(value=>!value)}>업체·엑셀 연결 {toolsOpen?'접기':'펼치기'}</button>
      </div>
      <div style={{fontSize:12,marginTop:4,color:inputStorageError?'#b91c1c':'#475569'}} role={inputStorageError?'alert':'status'}>{inputStorageError || (!inputLoaded?'보관 입력 확인 중…':inputDirty?'입력 변경 있음 · 입력만 저장하면 이 브라우저에서 복구됩니다.':'이 브라우저 보관 입력과 일치 · ERP 적용과 별도')}</div>
      <div role="status" style={{ marginTop:5, padding:'3px 6px', borderRadius:4, background:'#fff7df', color:'#624900' }}>{message}</div>
      <details className="weekday-guidance"><summary>안내·작업 기준 펼치기</summary><div style={{fontSize:13,color:'#122033',marginTop:5}}>전산 현재값 = 저장된 조회값 · 파란 수량 = 미저장 초안 {activePlans.length}건 · 최초 기준 = 이 페이지의 불변 기록{plans.length>activePlans.length && ` · 다른 조회 범위 초안 ${plans.length-activePlans.length}건 보관 (이번 저장 제외)`}</div>
      <div style={{fontSize:12,color:'#624900',marginTop:3}}>작업 순서: 입력 → 입력만 저장(이 브라우저 보관) → 필요할 때 분배 적용 · 변경 확인. 최초 기준 확정은 별도 기록이며, 인쇄는 API가 메인차수 전체 확정을 검사합니다.</div>
      </details>
      {applyError && <div role="alert" style={{color:'#9f1c16',fontSize:13,overflowWrap:'anywhere'}}>{applyError}</div>}
      {pendingApply && <div style={{fontSize:13,color:'#122033'}}>저장 결과 확인 대기 · 업체 {pendingApply.payload.custKey} · 작업 {pendingApply.payload.operationId} <button disabled={applyBusy} onClick={recheckErpSave}>{applyBusy?'확인 중…':pendingApply.metadataOnly?'윌슨 저장 결과 확인':'같은 작업 저장 상태 다시 조회'}</button></div>}
      {calendarError && <div role="alert" style={{color:'#b42318',marginTop:8}}>전산 달력: {calendarError}</div>}
      {defaultCalendarError && <div role="alert" style={{color:'#9f1c16',marginTop:8}}>중심 기본값: {defaultCalendarError}</div>}
      <details><summary>마감 잔량·이월 도구 펼치기</summary><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:6,fontSize:14}}>
        <span role="status">{carryoverLoading?'마감 잔량·이월 조회 중…':'웹 전용 마감 잔량 · ERP 수량·재고·견적과 분리'}</span>
        <button type="button" style={{fontSize:14}} disabled={carryoverLoading || carryoverBusy || !customer?.CustKey || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(majorWeek) || Number(majorWeek)<1 || Number(majorWeek)>53} onClick={refreshCarryover}>이월 새로고침</button>
      </div>
      </details>
      {carryoverError && <div role="alert" style={{color:'#9f1c16',marginTop:6,fontSize:14}}>마감 잔량·이월: {carryoverError} · 이월 계산값을 표시하지 않았습니다.</div>}
      {customerError && <div role="alert" style={{color:'#b42318'}}>{customerError}</div>}
      {uploadError && <div role="alert" style={{color:'#b42318'}}>{uploadError}</div>}
    </header>

    {baselineError && <div role="alert" style={{color:'#b42318',padding:6}}>{baselineError}</div>}
    {wilsonError && <div role="alert" style={{color:'#b42318',padding:6}}>윌슨: {wilsonError}</div>}
    {wilsonPending.length>0 && <button type="button" disabled={applyBusy || wilsonBusy || Boolean(pendingApply)} onClick={()=>retryWilson()}>윌슨 구분값 저장 확인 ({wilsonPending.length})</button>}
    <WeekdayCycleMatrix key={`${customer?.CustKey || 'none'}|${year}|${majorWeek}`} cycles={cycles} plans={activePlans} comparisonRows={compareRows || []} baselines={baselines.filter(record=>Number(record.custKey)===Number(customer?.CustKey))} baselineCandidates={baselineCandidates.filter(record=>Number(record.custKey)===Number(customer?.CustKey))} pageNotes={pageNotes} quoteResults={quoteResults} onRetryQuote={()=>refreshErp()} onOpenNote={openPageNote} onConfirmBaseline={openBaselineConfirmation} baselineBusy={baselineBusy} onMove={moveDraft} busy={busy || editLocked} onEditCell={editGridCell} onPrint={openWeekdayPrint} printBusy={printBusy || applyBusy || Boolean(pendingApply)} customer={customer} onSearchProducts={searchGridProducts} onAddProduct={addGridProduct}
      wilsonRecords={wilsonRecords.filter(record=>Number(record.custKey)===Number(customer?.CustKey))} wilsonDrafts={wilsonDrafts.filter(record=>record.scopeKey===scopeKey && activePlans.some(plan=>Number(plan.year)===record.year && Number(plan.prodKey)===record.prodKey && plan.date===record.date && Number(plan.quantity)===record.expectedTotal))} wilsonBusy={wilsonBusy} wilsonError={wilsonError} onEditWilson={editWilson}
      confirmationStates={confirmationStates} confirmationBusy={busy} confirmationError={confirmationError}
      carryover={carryover?.scopeKey===scopeKey?carryover:null} carryoverPlans={plans} onOpenCarryover={openCarryover} carryoverBusy={carryoverBusy || carryoverLoading} carryoverError={carryoverError}
      editDisabledReason={busy?'전산 조회 중입니다. 조회 완료 후 초안을 입력하세요.':editLocked?'ERP 저장 확인·처리 또는 미확인 작업 상태로 초안 편집이 잠겨 있습니다.':''}/>

    {carryoverForm && carryoverForm.scopeKey===scopeKey && <div className="weekday-print-overlay" onKeyDown={carryoverDialogKeys}>
      <section ref={carryoverDialog} role="dialog" aria-modal="true" aria-label="웹 전용 마감 잔량 수정·이력" className="weekday-carry-dialog" tabIndex={-1} style={panel}>
        <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'start'}}><h2>{carryoverForm.name} · {carryoverForm.year}/{carryoverForm.majorWeek}차 마감 잔량</h2><button type="button" disabled={carryoverBusy} onClick={closeCarryover}>닫기</button></div>
        <p>이 차수의 마감값을 지정하면 다음 차수로 이어집니다. 최초분배·전산 주문·출고·재고·견적 수량 및 금액은 변경하지 않습니다.</p>
        <p>이월 {carryoverForm.source?`${carryoverForm.source.year}/${carryoverForm.source.majorWeek}차 → `:''}{carryoverForm.incoming ?? '미등록'} {carryoverForm.unit} · 현재 마감 {carryoverForm.closing ?? '미확인'} {carryoverForm.unit}
          {carryoverForm.incomingProvisional?' · 이월 미확정 예상':''}{carryoverForm.incomingHasDraft?' · 이월 초안 예상':''}
          {carryoverForm.provisional?' · 미확정 예상':''}{carryoverForm.hasDraft?' · 초안 예상':''}</p>
        {carryoverForm.error && <p style={{color:'#9f1c16'}}>계산 근거 확인 필요: {typeof carryoverForm.error==='string'?carryoverForm.error:carryoverForm.error.message || '단위·달력·수량 확인 필요'}</p>}
        <form onSubmit={saveCarryover} noValidate>
          <label>수동 마감 잔량 ({carryoverForm.unit}) · 0·음수 가능<input autoFocus type="text" inputMode="decimal" aria-label="수동 마감 잔량" aria-required="true" disabled={carryoverBusy || carryoverLoading} value={carryoverForm.quantity} onChange={event=>setCarryoverForm(current=>({...current,quantity:event.target.value,saved:false}))}/></label>
          <label>변경 사유 (필수)<textarea rows={3} maxLength={1000} aria-label="마감 잔량 변경 사유" aria-required="true" disabled={carryoverBusy || carryoverLoading} value={carryoverForm.reason} onChange={event=>setCarryoverForm(current=>({...current,reason:event.target.value,saved:false}))}/></label>
          <p>빈칸은 0으로 저장하지 않습니다. 웹 이월 기록만 저장하며 실제 재고가 아닙니다.</p>
          {carryoverFormError && <p role="alert" style={{color:'#9f1c16',overflowWrap:'anywhere'}}>{carryoverFormError}</p>}
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="submit" className="primary" disabled={carryoverBusy || carryoverLoading || carryoverForm.saved}>{carryoverBusy?'저장·이월 재조회 중…':'웹 마감 잔량 저장'}</button><button type="button" disabled={carryoverBusy || carryoverLoading} onClick={reloadCarryoverForm}>최신 이력 다시 조회 · 입력 유지</button></div>
        </form>
        <h3 style={{fontSize:16}}>수정 이력 · 현재 revision {carryoverForm.expectedRevision}</h3>
        <div className="carry-history" tabIndex={0} aria-label="마감 잔량 전체 수정 이력">{carryoverForm.history.length?carryoverForm.history.map((entry,index)=><p key={`${entry.revision ?? index}|${entry.timestamp ?? ''}`}>
          {carryoverHistoryValue(entry.before)} → {carryoverHistoryValue(entry.after)} {carryoverForm.unit}<br/>
          {carryoverActorLabel(entry.actor)} · {entry.timestamp || '시각 미확인'} · revision {entry.revision ?? '미확인'}<br/>사유: {entry.reason || '미확인'}
        </p>):<p>수동 마감 수정 이력이 없습니다.</p>}</div>
      </section>
    </div>}

    {applyPreview && <div className="weekday-print-overlay"><section role="dialog" aria-modal="true" aria-label="ERP 저장 변경 확인" style={{...panel,width:'min(760px,100%)',maxHeight:'calc(100vh - 24px)',overflow:'auto',boxSizing:'border-box',fontSize:13,color:'#122033'}}>
      <h2 style={{fontSize:17,margin:'0 0 8px'}}>{applyPreview.metadataOnly?'윌슨 구분만 저장':'분배 적용'} · {customer?.CustName} · 확인 날짜 {applyPreview.preview.length}건</h2>
      {applyPreview.metadataOnly && <p>일반·윌슨 구분만 변경합니다. 기존 ERP 날짜 합계·견적·재고는 그대로 유지합니다.</p>}
      <p>아래 날짜의 최종 출고수량(OutUnit)을 적용합니다. 예를 들어 현재 100에서 120을 입력하면 20만 증가합니다. 입력하지 않은 기존 날짜는 보존하고, 명시 수량 0은 해당 날짜를 취소합니다. 기존 상세의 확정·미확정 상태를 그대로 유지하며, 신규 상세는 미확정 분배로 등록합니다. 자동 확정은 하지 않습니다. 최초 기준은 보존하고, 실패하면 입력 초안을 유지합니다.</p>
      <div className="scroll-table" style={{maxHeight:'45vh',overflow:'auto'}}><table><thead><tr><th>연도/세부차수</th><th>품목</th><th>날짜</th><th>저장 현재 → 초안 최종</th><th>ERP 상세 확정 전 → 후</th></tr></thead><tbody>{applyPreview.preview.map(cell=><tr key={`${cell.year}|${cell.orderWeek}|${cell.prodName}|${cell.date}`}><td>{cell.year}/{cell.orderWeek}</td><td>{cell.prodName}</td><td>{cell.date}</td><td>{cell.before} → {cell.after} {cell.unit}{cell.after===0?' · 취소':''}</td><td>{cell.detailFlag}</td></tr>)}</tbody></table></div>
      <label style={{display:'block',marginTop:10}}>ERP 변경 사유 (필수)<textarea autoFocus aria-label="ERP 저장 사유" rows={3} maxLength={1000} disabled={applyBusy || Boolean(pendingApply)} value={applyReason} onChange={event=>setApplyReason(event.target.value)} style={{width:'100%',boxSizing:'border-box',font:'inherit',color:'#122033'}}/></label>
      {applyError && <p role="alert" style={{color:'#9f1c16',overflowWrap:'anywhere'}}>{applyError}</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}><button className="primary" onClick={confirmErpSave} disabled={applyBusy || Boolean(pendingApply) || !applyReason.trim()}>{applyBusy?'저장/결과 확인 중…':applyPreview.metadataOnly?'확인 · 윌슨 구분만 저장':'변경 확인 · 분배 적용'}</button>{pendingApply && <button disabled={applyBusy} onClick={recheckErpSave}>저장 상태 다시 조회</button>}<button disabled={applyBusy} onClick={()=>setApplyPreview(null)}>닫기 · 초안 유지</button></div>
    </section></div>}

    {noteForm && <section role="dialog" aria-label="수량 변경 비고" style={{position:'fixed',right:16,bottom:16,zIndex:2200,...panel,width:'min(460px,calc(100% - 32px))',maxHeight:'calc(100vh - 32px)',overflow:'auto',boxShadow:'0 5px 24px #172b4244'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{noteForm.name} · {noteForm.year}/{noteForm.majorWeek}차</strong><button aria-label="비고창 닫기" disabled={noteBusy} onClick={()=>{noteRequest.current+=1;setNoteForm(null);}}>닫기</button></div>
      <p>최초 {noteForm.initial ?? '미확인'} / 전산 합계 {noteForm.current ?? '미확인'} / 변경 {noteForm.change ?? '미확인'} {noteForm.unit}</p>
      <p>견적 관리 합계: {noteForm.quote?.managementQuantity ?? '미확인'} {noteForm.quote?.unit} · {noteForm.quote?.state || '조회 필요'}<br/>인쇄 정상 {noteForm.quote?.quantity ?? '미확인'} / 차감 포함 {noteForm.quote?.netQuantity ?? '미확인'} · {noteForm.quote?.amount ?? '미확인'}원</p>
      <label>비고<textarea aria-label="수량 변경 비고 내용" rows={3} maxLength={1000} style={{width:'100%',font:'inherit'}} value={noteForm.note} onChange={event=>setNoteForm(current=>({...current,note:event.target.value}))}/></label>
      <fieldset style={{padding:6,marginTop:8,border:'1px solid #d9c0e9'}}><legend>선출고 · 담당자 수동 확인</legend>
        <label>출고일<select aria-label="선출고 출고일" value={noteForm.earlyDate} onChange={event=>setNoteForm(current=>({...current,earlyDate:event.target.value}))}><option value="">없음</option>{noteForm.days.map(day=><option key={day.date} value={day.date}>{day.date} {day.label}</option>)}</select></label>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:6,marginTop:5}}><label>원천 연도<input style={{width:'100%',minWidth:0}} aria-label="선출고 물량 연도" value={noteForm.sourceYear} onChange={event=>setNoteForm(current=>({...current,sourceYear:event.target.value}))}/></label><label>물량 차수<input style={{width:'100%',minWidth:0}} aria-label="선출고 물량 차수" placeholder="39-01" value={noteForm.sourceOrderWeek} onChange={event=>setNoteForm(current=>({...current,sourceOrderWeek:event.target.value}))}/></label><label>수량 ({noteForm.unit})<input style={{width:'100%',minWidth:0}} aria-label="선출고 수량" inputMode="decimal" value={noteForm.earlyQuantity} onChange={event=>setNoteForm(current=>({...current,earlyQuantity:event.target.value}))}/></label></div>
        <small>실제 입고원천·재고를 자동 변경하지 않습니다. 담당자가 확인한 수량만 표시합니다.</small>
      </fieldset>
      {noteError && <p role="alert" style={{color:'#b42318'}}>{noteError}</p>}
      <button className="primary" disabled={noteBusy || busy} onClick={savePageNote} style={{marginTop:8}}>{noteBusy?'저장 중…':'비고 저장'}</button>
    </section>}

    {baselinePreview && <div className="weekday-print-overlay"><section role="dialog" aria-modal="true" aria-label="최초분배 기준 확정" style={{...panel,width:'min(650px,100%)',maxHeight:'calc(100vh - 32px)',overflow:'auto'}}>
      <h2 style={{fontSize:17,margin:'0 0 8px'}}>{baselinePreview.year}/{baselinePreview.orderWeek} 최초분배 확정</h2>
      <p>현재 전산 분배 {baselinePreview.rows.length}개 품목을 최초 기준으로 보관합니다. 이후 수량·날짜 수정이나 재확정으로 덮어쓰지 않습니다.</p>
      <p style={{color:'#805100'}}>페이지 비교 기준만 확정합니다. 전산 분배 확정·재고 변경은 하지 않으며, 파란 미적용 초안과 업로드 수량은 포함하지 않습니다.</p>
      <table><thead><tr><th>품목</th><th>최초 분배수량</th></tr></thead><tbody>{baselinePreview.rows.map(row=><tr key={row.prodKey}><td>{row.prodName}</td><td>{row.quantity} {row.unit}</td></tr>)}</tbody></table>
      {baselineError && <p role="alert" style={{color:'#b42318'}}>{baselineError}</p>}
      {!baselinePreview.rows.some(row=>row.quantity>0) && <p style={{color:'#805100'}}>양수 분배가 없는 차수는 최초 기준을 확정할 수 없습니다.</p>}
      <div style={{display:'flex',gap:8,marginTop:10}}><button className="primary" disabled={baselineBusy || !baselinePreview.rows.some(row=>row.quantity>0)} onClick={confirmInitialBaseline}>{baselineBusy?'저장 중…':'최초 기준 확정'}</button><button disabled={baselineBusy} onClick={()=>{baselineRequest.current+=1;setBaselinePreview(null);setBaselineError('');}}>취소</button></div>
    </section></div>}

    <details open={toolsOpen} onToggle={event=>setToolsOpen(event.currentTarget.open)} style={{marginTop:8}}>
    <summary style={{cursor:'pointer',padding:'5px 0'}}>업체 변경 · 업로드 연결 · 세부 초안 · 변경 이력 ({plans.length}건)</summary>
    <div className="grid">
      <section className="span-4" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>1. 거래처 선택</h2>
        <div style={{ display:'flex', gap:7 }}>
          <input style={{ ...inputStyle, flex:1, minWidth:0 }} value={customerQuery} placeholder="주광 또는 거래처명 검색" onChange={(e) => setCustomerQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findCustomers()} />
          <button onClick={findCustomers}>검색</button>
        </div>
        {customerError && <p style={{ color:'#b42318' }}>{customerError}</p>}
        {customers.length > 0 && <div style={{ marginTop:8, maxHeight:180, overflow:'auto' }}>{customers.map((item) => <button key={item.CustKey} onClick={() => { defaultCustomerRequest.current += 1; comparisonRequest.current += 1; setBusy(false); setCustomerError('');setCustomer(item); setCustomerQuery(item.CustName); setCustomers([]); setCompareRows(null); setSourceLots([]); setErpHistory([]); }} style={{ display:'block', width:'100%', textAlign:'left', marginBottom:4 }}>{item.CustName} <span className="muted">· {item.CustArea || '지역 미등록'} · {item.CustKey}</span></button>)}</div>}
        <div style={{ marginTop:10, padding:10, background:'#f4f8fc', borderRadius:6 }}><b>선택 업체:</b> {customer ? `${customer.CustName} (${customer.CustKey})` : '미선택'}<br/><span className="muted">주광농원이 기본값입니다. 다른 거래처도 검색해 선택할 수 있습니다.</span></div>
      </section>

      <section className="span-4" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>2. 요일별 엑셀 업로드</h2>
        <label>헤더 날짜 미인식 시 출고일 <input style={inputStyle} type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} /></label>
        {fileName && <p><b>{fileName}</b> · {parsed?.sheets?.length || 0}개 시트 · 원문 임시 분석</p>}
        {uploadError && <p style={{ color:'#b42318' }}>{uploadError}</p>}
        {parsed && <div className="muted">{parsed.sheets.map((sheet) => <span className="tag" key={sheet.name}>{sheet.name}: {sheet.rows.length}행 · 병합 {sheet.merges.length}</span>)}<p>텍스트·수식은 자동 수량으로 바꾸지 않습니다. 날짜 수량 열로 인식되지 않은 셀은 검토가 필요합니다.</p></div>}
      </section>

      <section className="span-4" style={{ ...panel, background:'#f8fafc' }}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>3. 단위 확인</h2>
        <label>업로드 날짜 수량의 단위 확인 <select style={{ ...inputStyle, display:'block', width:'100%', marginTop:7 }} value={unit} onChange={(e) => setUnit(e.target.value)}><option>확인 필요</option><option>박스</option><option>단</option><option>송이</option></select></label>
        <p className="muted">원본 양식에 단위가 확정되지 않은 값은 환산하지 않습니다. 선택은 현재 화면의 초안에만 적용됩니다.</p>
      </section>

      {parsed && <section className="span-12" style={panel}>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
          <h2 style={{ margin:0, fontSize:17, flex:1 }}>4. 원본 품목 연결 및 날짜 수량 후보</h2>
          <span className="muted">원본행 {sourceRows.length}개 · 선택행만 계획에 추가</span>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
          <input id="weekday-product-search" style={{ ...inputStyle, minWidth:280, flex:1 }} value={productQuery} placeholder="선택한 원본행에 연결할 ERP 품목 검색" onChange={(e) => setProductQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchProducts()} />
          <button onClick={searchProducts}>품목 검색</button>
          {selectedSource && <span className="tag">연결 대상: {selectedSource.label} · {selectedSource.sheet}!{selectedSource.row}</span>}
        </div>
        {productError && <p style={{ color:'#b42318' }}>{productError}</p>}
        {products.length > 0 && <div style={{ display:'flex', gap:6, flexWrap:'wrap', maxHeight:160, overflow:'auto', marginBottom:10 }}>{products.map((product) => <button key={product.ProdKey} onClick={() => { if (!selectedSource) { setProductError('먼저 아래 원본 행의 “연결 선택”을 누르세요.'); return; } const key = `${selectedSource.sheet}|${selectedSource.row}`; setMappings((current) => ({ ...current, [key]: product.ProdKey })); setProductNames((current) => ({ ...current, [key]: product.ProdName })); setSelectedSource(null); setProducts([]); setProductError(''); }} style={{ textAlign:'left' }}>{product.ProdName}<span className="muted"> · {product.CounName}/{product.FlowerName}</span></button>)}</div>}
        <div className="scroll-table"><table><thead><tr><th>구역 / 원본행</th><th>원본 품명</th><th>날짜 수량 셀 원문</th><th>ERP 품목 연결</th><th>작업</th></tr></thead><tbody>
          {sourceRows.map((row) => {
            const key = `${row.sheet}|${row.row}`;
            return <tr key={key}><td>{row.section}<br/><span className="muted">{row.sheet}!{row.row}</span></td><td>{row.label}</td><td>{row.cells.filter((cell) => cell.kind !== 'blank').map((cell) => <span className="tag" key={cell.address} title={`${cell.columnHeader || '헤더 미확인'} · ${cell.reason}`}>{cell.address}={cell.raw}{cell.headerRole === 'date-quantity-candidate' ? ' · 날짜후보' : ''}</span>)}</td><td>{mappings[key] ? `ProdKey ${mappings[key]} · ${productNames[key] || '품목 연결됨'}` : '미연결'}</td><td style={{ whiteSpace:'nowrap' }}><button onClick={() => { setSelectedSource(row); setProductError(''); document.getElementById('weekday-product-search')?.focus(); }}>연결 선택</button> <button className="primary" disabled={!row.quantityCells.length} onClick={() => addSourceRow(row)}>계획에 추가</button></td></tr>;
          })}
          {!sourceRows.length && <tr><td colSpan={5}>날짜 수량 열로 안전하게 인식된 숫자 셀이 없습니다. 헤더 매핑을 수동 검토해야 합니다.</td></tr>}
        </tbody></table></div>
      </section>}

      <section className="span-12" style={panel}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
          <h2 style={{ margin:0, fontSize:17, flex:1 }}>5. 세부차수·출고일 배분 초안</h2>
          <button onClick={compareWithErp} disabled={busy || !plans.length}>선택 범위 전산 대조</button>
          <button onClick={saveInputOnly} disabled={!inputLoaded || !inputUser || editLocked || busy || !customer}>입력만 저장</button>
        <button aria-label="ERP 저장 · 변경 확인" className="primary" onClick={openErpSave} disabled={busy || editLocked || !activePlans.length || !compareRows}>분배 적용 · 변경 확인</button>
        </div>
        <p className="muted">입력은 미저장 초안입니다. 실제 OutUnit과 같은 단위만 명시 ERP 저장할 수 있으며 자동 환산하지 않습니다. 다른 조회 범위의 초안은 이번 저장에 포함하지 않습니다.</p>
        <div className="scroll-table"><table><thead><tr><th>원본 근거</th><th>ERP 품목</th><th>견적 세부차수</th><th>출고일/요일</th><th>수량</th><th>원본 단위</th><th>제거</th></tr></thead><tbody>
          {activePlans.map((plan) => <tr key={plan.id}><td>{plan.sourceLabel}<br/><span className="muted">{plan.sheet}!{plan.sourceCell} · {plan.header} · 원문 {plan.raw}</span></td><td>{plan.prodName || `ProdKey ${plan.prodKey}`}</td><td>{plan.year}/{plan.orderWeek}</td><td>{plan.date}<div className="muted">{plan.date ? weekdayLabels[new Date(`${plan.date}T12:00:00`).getDay()] + '요일' : ''} · 날짜 이동은 위 표에서</div></td><td><input disabled={editLocked} style={{ ...inputStyle, width:110 }} type="number" min="0" step="any" value={plan.quantity} onChange={(e) => updatePlan(plan.id, { quantity:e.target.value })} /></td><td>{plan.unit}</td><td><button disabled={editLocked} onClick={() => { setDraftHistory((current)=>[{id:crypto.randomUUID(),kind:'DRAFT_REMOVE',applied:false,at:new Date().toISOString(),prodKey:plan.prodKey,before:{...plan},after:null},...current]);setPlans((current) => current.filter((item) => item.id !== plan.id)); }}>초안 제거</button></td></tr>)}
          {!activePlans.length && <tr><td colSpan={7}>현재 조회 범위에 배분 초안이 없습니다. 다른 범위 초안은 원래 업체·연도·중심 차수로 돌아가면 다시 표시됩니다.</td></tr>}
        </tbody></table></div>
      </section>

      {(draftHistory.length > 0 || erpHistory.length > 0 || savedHistory.length>0 || historyError) && <section className="span-12" style={panel}>
        <h2 style={{fontSize:17,margin:'0 0 10px'}}>변경 이력 · 초안과 전산 기록 구분</h2>
        <div className="grid"><div className="span-6"><b>현재 화면 초안 (ERP 미적용)</b>{draftHistory.map((event)=><div key={event.id} style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13}}>{event.at?.slice(0,19).replace('T',' ')} · 품목 {event.prodKey} · {event.kind}<br/>{event.before?.year}/{event.before?.orderWeek} {event.before?.date} → {event.after ? `${event.after.year}/${event.after.orderWeek} ${event.after.date}` : '초안 제거'} · {event.quantity != null ? `${event.quantity} ${event.unit}` : `${event.before?.quantity ?? '—'} → ${event.after?.quantity ?? '—'}`} {event.reason && `· ${event.reason}`}</div>)}</div><div className="span-6"><b>EXE 공용 출고 이력 · ShipmentHistory</b><p className="muted">nenova.exe와 공유하는 기존 일자별 신규·수정·삭제 기록입니다. 상세행이 완전히 삭제된 취소건은 기존 EXE 조회에서 빠질 수 있으며, 웹 저장건은 아래 영속 감사에서 조회합니다. 기존 ShipmentHistory 행의 보존과 EXE 화면의 조회 가능 여부는 다릅니다. 명시 작업 UUID가 없는 이력은 이동·웹 감사와 자동 연결하거나 중복 제거하지 않습니다.</p>{erpHistory.map((event,index)=><div key={`${event.SdetailKey}|${event.ChangeDtm}|${index}`} style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13,color:'#122033',overflowWrap:'anywhere'}}>EXE 공용 · {event.ChangeDtm} · 담당자 {event.ChangeID} · {event.OrderYear}/{event.OrderWeek} · 품목 {event.ProdKey}<br/>{event.ShipmentDate} {event.ChangeType} · {event.BeforeValue} → {event.AfterValue}{event.Descr && <div>비고: {event.Descr}</div>}</div>)}</div></div>
        <b style={{display:'block',marginTop:10}}>웹 요일 저장 감사 · 작업 UUID / 전체 거래 보완 기록</b>
        <p className="muted">기존 EXE 공용 출고 이력은 위에 그대로 표시합니다. 같은 웹 저장이 두 출처에 기록될 수 있으며, 명시 UUID 연결이 없는 기록은 시각·수량으로 추정 중복 제거하지 않습니다.</p>
        {historyError && <p role="alert" style={{color:'#9f1c16'}}>{historyError}</p>}
        {savedHistory.map((event,index)=><div key={`${event.operationId}|${event.prodKey}|${index}`} style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13,color:'#122033',overflowWrap:'anywhere'}}>웹 감사 · {event.changedAt || event.createdAt || event.at} · 담당자 {event.userName || event.userId || event.changedBy} · {event.year}/{event.orderWeek} · 품목 {event.prodName || event.prodKey} · 사유: {event.reason}<br/>전: {historySnapshotLabel(event.before)}<br/>후: {historySnapshotLabel(event.after)} · 작업 {event.operationId}</div>)}
      </section>}

      {compareRows && <section className="span-12" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>6. 전산 대조 결과 · 읽기 전용</h2>
        <div className="scroll-table"><table><thead><tr><th>연도·세부차수</th><th>거래처</th><th>품목</th><th>저장 후 예상 합계(OutUnit)</th><th>저장 현재 분배(OutUnit)</th><th>전체 변경량</th><th>확정 여부</th><th>날짜별 출고 / 견적수량</th><th>상태</th></tr></thead><tbody>
          {compareRows.map((row) => {
            const related = activePlans.filter((item) => Number(item.custKey) === Number(row.custKey) && Number(item.year) === row.year && item.prodKey === row.prodKey && item.orderWeek === row.orderWeek);
            const projected = projectWeekdayDistribution(row, related);
            return <tr key={`${row.year}|${row.orderWeek}|${row.prodKey}`}>
              <td>{row.year} / {row.orderWeek}</td><td>{customer?.CustName}</td><td>{related[0]?.prodName || row.prodName || row.prodKey}</td>
              <td>{projected.projectedTotal ?? '미확인'} {projected.unit || ''}{!related.length && ' · 초안 없음/현재 유지'}</td>
              <td>{row.shipmentOutQuantity == null ? '분배 없음/미확인' : `${row.shipmentOutQuantity} ${row.outUnit || ''}`}</td>
              <td>{projected.delta ?? '미확인'}</td><td>{row.fixed === 'mixed' ? '혼합 · 검토 필요' : row.fixed == null ? '미확인' : row.fixed ? '확정 · 검토 필요' : '미확정'}</td>
              <td>{projected.valid ? projected.dates.length ? projected.dates.map(day=><div key={day.date}>{day.date} · 예상 {day.projectedQuantity} {day.drafted ? day.projectedQuantity===0?'(명시 취소)':'(미저장 초안)':'(현재 유지)'} / 저장 현재 {day.currentQuantity} · 변경 {day.delta} · 저장 견적 {day.estimateQuantity ?? '미확인'}</div>) : '날짜행 없음' : <span style={{color:'#9f1c16'}}>예상량 미확인 · {projected.error}</span>}</td>
              <td>{row.state}</td>
            </tr>;
          })}
        </tbody></table></div>
        <p className="muted">이 결과는 선택한 전후 업무 주기의 현재 조회일 뿐, 요일 계획과 단위가 같다는 보증이나 적용 가능 판정이 아닙니다. 연말에는 연결된 다음 연도 차수도 명시적으로 조회합니다.</p>
      </section>}

      <section className="span-12" style={{ ...panel, borderColor:'#d5a329', background:'#fffbeb' }}>
        <b>현재 제공 범위</b>: 엑셀 원문 파싱, 행별 품목 연결, 초안 편집, 연도·세부차수·거래처·품목 범위의 전산 읽기 대조.<br/>
        <span className="muted">명시 ERP 저장은 사유·변경 날짜 확인 후 실행합니다. 해당 차수에 미저장 초안이 있으면 먼저 저장해야 인쇄할 수 있습니다. 저장 결과 불명 시 동일 UUID의 상태만 조회하며 재저장하지 않습니다.</span>
      </section>
    </div>
    </details>
    {printPreview && <div className="weekday-print-overlay" onKeyDown={event=>{if(event.key==='Escape')setPrintPreview(null);}}>
      <section role="dialog" aria-modal="true" aria-label="요일 견적서 인쇄 미리보기" className="weekday-print-dialog">
        <div style={{display:'flex',gap:8,alignItems:'center'}}><b style={{flex:1,minWidth:0}}>{printPreview.label} · {printPreview.documentCount}문서 / {printPreview.count}행</b><button className="primary" onClick={()=>previewFrame.current?.contentWindow?.print()}>견적서 출력</button><button autoFocus onClick={()=>setPrintPreview(null)}>닫기</button></div>
        <div className="muted">{printPreview.note} · 미적용 초안 제외 · A4 / 배율 100% 권장</div>
        <iframe ref={previewFrame} title="전산 확정 견적서" srcDoc={printPreview.html}/>
      </section>
    </div>}
  </main>;
}
