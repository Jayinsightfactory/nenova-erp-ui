import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../lib/useApi';
import WeekdayCycleMatrix from './WeekdayCycleMatrix';
import { locateShippingDay, moveWeekdayPlan } from '../lib/weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from '../lib/weekdayEstimateCompare.js';
import { buildEstimateHtml } from '../lib/estimatePrintHtml.js';

const initialYear = new Date().getFullYear();
const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const panel = { border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: 8 };
const inputStyle = { border: '1px solid #9aaec4', borderRadius: 4, padding: '3px 6px', minHeight: 28, background: '#fff' };

function candidateCells(row) { return (row.cells || []).filter((cell) => cell.kind === 'numeric-candidate' && cell.headerRole === 'date-quantity-candidate'); }
function draftKey(row) { return `${row.sheet}|${row.row}|${row.cell.address}`; }

export default function WeekdayEstimateWorkspace() {
  const [year, setYear] = useState(String(initialYear));
  const [majorWeek, setMajorWeek] = useState('38');
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
  const [compareRows, setCompareRows] = useState(null);
  const [baselines, setBaselines] = useState([]);
  const [baselinePreview, setBaselinePreview] = useState(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const [pageNotes, setPageNotes] = useState([]);
  const [noteForm, setNoteForm] = useState(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [quoteResults, setQuoteResults] = useState([]);
  const noteRequest=useRef(0);
  const noteLock=useRef(false);
  const baselineRequest = useRef(0);
  const baselineLock = useRef(false);
  const [cycles, setCycles] = useState([]);
  const [calendarError, setCalendarError] = useState('');
  const [sourceLots, setSourceLots] = useState([]);
  const [erpHistory, setErpHistory] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const [toolsOpen,setToolsOpen] = useState(false);
  const [printPreview,setPrintPreview] = useState(null);
  const [printBusy,setPrintBusy] = useState(false);
  const defaultCustomerRequest=useRef(0);
  const printRequest=useRef(0);
  const printLock=useRef(false);
  const previewFrame=useRef(null);
  const calendarRequest = useRef(0);
  const comparisonRequest = useRef(0);
  const addedProductScope = useRef({scope:'', keys:[]});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('엑셀은 임시로 읽기만 합니다. 전산 원장에는 저장하지 않습니다.');

  const sourceRows = useMemo(() => (parsed?.sheets || []).flatMap((sheet) => (sheet.rows || [])
    .filter((row) => row.section && row.label && !row.isHeaderRow && (row.cells || []).some((cell) => cell.column === 'B' && cell.raw === row.label))
    .map((row) => ({ ...row, sheet: sheet.name, quantityCells: candidateCells(row) }))), [parsed]);

  useEffect(()=>{
    baselineRequest.current+=1;setBaselinePreview(null);setBaselineError('');setBaselines([]);
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
    baselineRequest.current+=1;noteRequest.current+=1;setBaselinePreview(null);setNoteForm(null);setBaselineError('');setNoteError('');setBaselines([]);setPageNotes([]);setQuoteResults([]);setCompareRows(null);
    printRequest.current+=1;setPrintPreview(null);
    if(customer?.CustKey && cycles.length) refreshErp();
    return ()=>{comparisonRequest.current+=1;};
  },[customer?.CustKey,cycles]);

  useEffect(() => {
    const request = ++calendarRequest.current;
    baselineRequest.current+=1;setBaselinePreview(null);setBaselineError('');setBaselines([]);
    noteRequest.current+=1;setNoteForm(null);setPageNotes([]);setQuoteResults([]);
    comparisonRequest.current += 1;
    setBusy(false);
    setCycles([]); setCompareRows(null); setCalendarError(''); setSourceLots([]); setErpHistory([]);
    if (!/^\d{4}$/.test(year) || Number(majorWeek) < 1 || Number(majorWeek) > 53) return;
    apiGet('/api/estimate/weekday-calendar', { year, majorWeek }).then((result) => {
      if (request === calendarRequest.current) setCycles(result.cycles || []);
    }).catch((error) => { if (request === calendarRequest.current) setCalendarError(error.message); });
    return () => { calendarRequest.current += 1; };
  }, [year, majorWeek]);

  function moveDraft(move) {
    try {
      const result = moveWeekdayPlan(plans, move, cycles);
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
    if (!file) return;
    setBusy(true); setUploadError(''); setMessage('엑셀 구조를 읽는 중…');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/estimate/weekday-upload-preview', { method: 'POST', credentials: 'include', body: form });
      let result;
      try { result = await response.json(); } catch { throw new Error(response.status === 401 ? '로그인이 필요합니다.' : '서버 응답을 읽을 수 없습니다.'); }
      if (!response.ok || !result.success) throw new Error(result.error || '엑셀을 읽지 못했습니다.');
      comparisonRequest.current += 1;
      setParsed(result); setFileName(file.name); setPlans([]); setMappings({}); setProductNames({}); setSelectedSource(null); setDraftHistory([]);
      setMessage(`원문 ${result.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)}행을 임시로 읽었습니다. 수식·문자 셀은 자동 변환하지 않았습니다.`);
    } catch (error) { setUploadError(error.message); setMessage('업로드 확인 필요'); }
    finally { setBusy(false); }
  }

  function addSourceRow(row) {
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
      year: destination.cycle.year, orderWeek: destination.day.orderWeek, date: destination.day.date, unit,
      sourceYear: null, sourceOrderWeek: null, wdetailKey: null,
      header: cell.columnHeader,
    })).filter((item) => item.header);
    if (plans.some((item) => additions.some((next) => next.sheet === item.sheet && next.sourceCell === item.sourceCell))) { setMessage('이미 초안에 포함된 원본 셀입니다. 이동/수량 변경으로 수정하세요.'); return; }
    setPlans((current) => [...current, ...additions]);
    setMessage(`${row.label}: 날짜 수량 후보 ${additions.length}건을 검토용 초안에 추가했습니다. ERP에는 저장되지 않았습니다.`);
  }

  function updatePlan(id, patch) {
    const before = plans.find((item) => item.id === id);
    if (before && Object.keys(patch).some((key) => String(before[key] ?? '') !== String(patch[key] ?? ''))) {
      setDraftHistory((current) => [{ id: crypto.randomUUID(), kind:'DRAFT_EDIT', applied:false, at:new Date().toISOString(), prodKey:before.prodKey, before:{year:before.year,orderWeek:before.orderWeek,date:before.date,quantity:before.quantity}, after:{year:before.year,orderWeek:before.orderWeek,date:before.date,quantity:before.quantity,...patch} },...current]);
    }
    setPlans((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    // Keep last ERP snapshot visible; draft editing must not hide its differences.
  }

  async function compareWithErp() {
    if (!customer?.CustKey) { setMessage('실제 거래처를 선택하세요.'); return; }
    const invalid = plans.filter((plan) => Number(plan.custKey) === Number(customer.CustKey) && (!/^\d{4}$/.test(String(plan.year)) || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !/^\d{2}-\d{2}$/.test(plan.orderWeek) || !Number.isFinite(Number(plan.quantity)) || Number(plan.quantity) < 0 || plan.unit === '확인 필요'));
    if (invalid.length) { setMessage(`차수·날짜·수량·단위 확인이 필요한 행 ${invalid.length}건을 먼저 수정하세요.`); return; }
    await refreshErp();
  }

  async function refreshErp(extraProdKeys = []) {
    const request=++comparisonRequest.current;
    setBusy(true);setQuoteResults([]); setMessage('앞·현재·뒤 차수의 동일 거래처·품목 전산값을 대조 중…');
    try {
      const ranges = new Map();
      for (const cycle of cycles.filter((item) => item.calendarState === 'FOUND')) {
        ranges.set(cycle.year, [...new Set([...(ranges.get(cycle.year) || []), ...cycle.days.map((day) => day.orderWeek)])]);
      }
      for (const plan of plans.filter(item=>Number(item.custKey)===Number(customer.CustKey))) ranges.set(Number(plan.year), [...new Set([...(ranges.get(Number(plan.year)) || []), plan.orderWeek])]);
      const results = await Promise.all([...ranges].map(async ([requestYear,orderWeeks]) => {
        const inventory=await apiGet('/api/estimate/weekday-products',{year:requestYear,custKey:Number(customer.CustKey),orderWeeks:orderWeeks.join(',')});
        const baselineResult=await apiGet('/api/estimate/weekday-baseline',{year:requestYear,custKey:Number(customer.CustKey),orderWeeks:(inventory.scope?.orderWeeks || orderWeeks).join(',')});
        const savedBaselines=baselineResult.baselines || [];
        const scope=`${customer.CustKey}|${year}|${majorWeek}`;
        const addedKeys=addedProductScope.current.scope===scope ? addedProductScope.current.keys : [];
        const prodKeys=[...new Set([...(inventory.products||[]).map(item=>Number(item.ProdKey)),...savedBaselines.flatMap(record=>record.rows.map(item=>Number(item.prodKey))),...plans.filter(item=>Number(item.custKey)===Number(customer.CustKey)).map(item=>Number(item.prodKey)),...addedKeys,...(Array.isArray(extraProdKeys)?extraProdKeys:[])])];
        if(!prodKeys.length) return {rows:[],sourceLots:[],history:[],baselines:savedBaselines};
        const response = await fetch('/api/estimate/weekday-compare', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: requestYear, custKey: Number(customer.CustKey), orderWeeks:inventory.scope?.orderWeeks || orderWeeks, prodKeys }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '전산 대조에 실패했습니다.');
      return {...result,baselines:savedBaselines};
      }));
      if (request !== comparisonRequest.current) return false;
      setCompareRows(results.flatMap((result) => result.rows)); setSourceLots(results.flatMap((result) => result.sourceLots || [])); setErpHistory(results.flatMap((result) => result.history || []));
      setBaselines(results.flatMap(result=>result.baselines || []));
      const ancillary=await Promise.all(cycles.filter(cycle=>cycle.calendarState==='FOUND').map(async cycle=>{
        let notes=[],quote=null;
        try {notes=(await apiGet('/api/estimate/weekday-note',{year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey)})).notes || [];}
        catch(error) {throw new Error(`비고 조회 실패: ${error.message}`);}
        try {
          const response=await fetch('/api/estimate/weekday-print',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey),mode:'major',dates:[]})});
          const result=await response.json();
          if(!response.ok || !result.success) throw new Error(result.error || '견적 조회 실패');
          quote={year:cycle.year,majorWeek:cycle.majorWeek,items:result.items || []};
          try {
            const management=await apiGet('/api/estimate',{year:cycle.year,week:cycle.majorWeek,custKey:Number(customer.CustKey),byDate:1,itemsOnly:1});
            if(!Array.isArray(management.items)) throw new Error('견적 관리 상세를 읽을 수 없습니다.');
            quote.managementItems=management.items;
          } catch(error) {quote.managementError=error.message;}
        } catch(error) {quote={year:cycle.year,majorWeek:cycle.majorWeek,error:error.message};}
        return {notes,quote};
      }));
      if(request!==comparisonRequest.current) return false;
      setPageNotes(ancillary.flatMap(result=>result.notes));setQuoteResults(ancillary.map(result=>result.quote));
      setMessage(`전후 차수 전산 대조 완료 · 읽기 전용 · ERP 변경 없음${results.some((result)=>result.historyTruncated) ? ' · 이력 1000건 초과, 일부 표시' : ''}`);
      return true;
    } catch (error) { if (request === comparisonRequest.current) setMessage(error.message); return {success:false,error:error.message}; }
    finally { if (request === comparisonRequest.current) setBusy(false); }
  }

  function shiftCenter(offset) {
    const target=cycles.find(cycle=>cycle.offset===offset && cycle.calendarState==='FOUND');
    if(!target || busy || baselineBusy || noteBusy) return;
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
    const qty=Number(cell.quantity);
    const destination=locateShippingDay(cycles,cell.date);
    const normalizedUnit=normalizeWeekdayUnit(cell.unit);
    if(!customer?.CustKey || !normalizedUnit || !destination || destination.day.calendarState!=='FOUND'
      || Number(cell.year)!==destination.cycle.year || String(cell.orderWeek).split('-')[0]!==destination.cycle.majorWeek
      || !Number.isFinite(qty)||qty<0) {setMessage('수량·단위·전산 달력·차수 기준을 확인하세요.');return false;}
    const matching=plans.filter(item=>Number(item.custKey)===Number(customer.CustKey)&&Number(item.prodKey)===Number(cell.prodKey)&&Number(item.year)===Number(cell.year)&&item.date===cell.date);
    if(matching.length>1 || matching.some(item=>normalizeWeekdayUnit(item.unit)!==normalizedUnit||item.orderWeek!==cell.orderWeek)) {
      setMessage('이 날짜에는 복수 초안 또는 다른 업무차수/단위가 있습니다. 상세 초안에서 각각 수정하세요.');return false;
    }
    if(matching.length===1) updatePlan(matching[0].id,{quantity:qty});
    else {
      const actual=compareRows?.filter(row=>row.year===Number(cell.year)&&row.orderWeek===cell.orderWeek&&row.prodKey===Number(cell.prodKey));
      const dates=(actual||[]).flatMap(row=>row.shipmentDates||[]).filter(item=>String(item.date).slice(0,10)===cell.date);
      const before=dates.length?dates.reduce((sum,item)=>sum+Number(item.shipmentQuantity),0):null;
      const plan={id:`grid|${customer.CustKey}|${cell.year}|${cell.orderWeek}|${cell.prodKey}|${cell.date}`,custKey:Number(customer.CustKey),prodKey:Number(cell.prodKey),prodName:cell.prodName,
        year:Number(cell.year),orderWeek:cell.orderWeek,date:cell.date,quantity:qty,unit:normalizedUnit,sourceLabel:'표 직접 입력',sheet:'전산 대조',sourceCell:cell.date,raw:before,header:cell.date,sourceYear:null,sourceOrderWeek:null,wdetailKey:null};
      setPlans(current=>[...current,plan]);
      setDraftHistory(current=>[{id:crypto.randomUUID(),kind:'GRID_DRAFT_EDIT',applied:false,at:new Date().toISOString(),prodKey:plan.prodKey,
        before:{year:plan.year,orderWeek:plan.orderWeek,date:plan.date,quantity:before},after:{year:plan.year,orderWeek:plan.orderWeek,date:plan.date,quantity:qty}},...current]);
    }
    setMessage('요일 수량 초안을 기록했습니다. 전산 분배·재고는 변경되지 않았습니다.');
    return true;
  }

  async function openWeekdayPrint({cycle,dates,mode}) {
    if(printLock.current||!customer?.CustKey) return;
    printLock.current=true;setPrintBusy(true);const request=++printRequest.current;
    try {
      const response=await fetch('/api/estimate/weekday-print',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:cycle.year,majorWeek:cycle.majorWeek,custKey:Number(customer.CustKey),dates,mode})});
      const result=await response.json();
      if(!response.ok||!result.success) throw new Error(result.error||'견적 조회 실패');
      if(request!==printRequest.current) return;
      if(!result.items?.length) {setMessage('선택 범위의 확정 견적 자료가 없습니다. 미적용 초안은 인쇄하지 않습니다.');return;}
      let logoDataUrl='';
      const logo=await fetch('/nenova-logo-estimate.png');
      if(logo.ok) {
        const blob=await logo.blob();
        logoDataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve('');reader.readAsDataURL(blob);});
      }
      if(request!==printRequest.current) return;
      const label=`${cycle.majorWeek}차 ${mode==='major'?'전체 견적':dates.join(' · ')} · 전산 확정본`;
      const html=buildEstimateHtml({bigoLabel:label,custName:result.customer.CustName,printDate:new Date().toISOString().slice(0,10),rows:result.items,logoDataUrl});
      setPrintPreview({html,label,note:result.note,count:result.items.length});
    } catch(error) {if(request===printRequest.current)setMessage(error.message);}
    finally {printLock.current=false;setPrintBusy(false);}
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
    @media(max-width:900px) { .weekday-workspace .span-6,.weekday-workspace .span-4 { grid-column:span 12; } .weekday-workspace { padding:10px; } }
  `;

  return <main className="weekday-workspace">
    <style>{style}</style>
    <header style={{ ...panel, background:'#f3f8ff', marginBottom:6 }}>
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:8 }}>
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ color:'#16439a', fontSize:18, fontWeight:800 }}>주광 견적서 · {customer?.CustName || '주광 자동 조회 중'}</div>
        </div>
        <label>연도 <input aria-label="조회 연도" style={{ ...inputStyle, width:70 }} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" /></label>
        <label>중심 차수 <input aria-label="중심 차수" style={{ ...inputStyle, width:50 }} value={majorWeek} onChange={(e) => setMajorWeek(e.target.value)} inputMode="numeric" /></label>
        <button aria-label="이전 차수를 중심으로" disabled={busy || baselineBusy || noteBusy || !cycles.some(cycle=>cycle.offset===-1&&cycle.calendarState==='FOUND')} onClick={()=>shiftCenter(-1)}>◀</button>
        <button aria-label="다음 차수를 중심으로" disabled={busy || baselineBusy || noteBusy || !cycles.some(cycle=>cycle.offset===1&&cycle.calendarState==='FOUND')} onClick={()=>shiftCenter(1)}>▶</button>
        <input aria-label="요일별 출고 엑셀 파일" style={{width:230}} type="file" accept=".xlsx,.xls" onChange={(e) => {setToolsOpen(true);uploadWorkbook(e.target.files?.[0]);}} disabled={busy} />
        <button onClick={compareWithErp} disabled={busy || !customer}>전산 새로고침</button>
        <button aria-expanded={toolsOpen} onClick={()=>setToolsOpen(value=>!value)}>업체·엑셀 연결 {toolsOpen?'접기':'펼치기'}</button>
      </div>
      <div role="status" style={{ marginTop:5, padding:'3px 6px', borderRadius:4, background:'#fff7df', color:'#624900' }}>{message}</div>
      {calendarError && <div role="alert" style={{color:'#b42318',marginTop:8}}>전산 달력: {calendarError}</div>}
      {customerError && <div role="alert" style={{color:'#b42318'}}>{customerError}</div>}
      {uploadError && <div role="alert" style={{color:'#b42318'}}>{uploadError}</div>}
    </header>

    {baselineError && <div role="alert" style={{color:'#b42318',padding:6}}>{baselineError}</div>}
    <WeekdayCycleMatrix key={`${customer?.CustKey || 'none'}|${year}|${majorWeek}`} cycles={cycles} plans={plans.filter((plan)=>Number(plan.custKey)===Number(customer?.CustKey))} comparisonRows={compareRows || []} baselines={baselines.filter(record=>Number(record.custKey)===Number(customer?.CustKey))} pageNotes={pageNotes} quoteResults={quoteResults} onOpenNote={openPageNote} onConfirmBaseline={openBaselineConfirmation} baselineBusy={baselineBusy} onMove={moveDraft} busy={busy} onEditCell={editGridCell} onPrint={openWeekdayPrint} printBusy={printBusy} customer={customer} onSearchProducts={searchGridProducts} onAddProduct={addGridProduct}/>

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
          <button disabled title="전산 쓰기는 후속 안전 검증 후 제공">ERP 적용 · 준비 중</button>
        </div>
        <p className="muted">각 원본행은 날짜 수량 후보만 초안에 복사합니다. 연도·세부차수·출고일·단위는 행별로 확인하세요. 단위 환산 및 ERP 저장은 하지 않습니다.</p>
        <div className="scroll-table"><table><thead><tr><th>원본 근거</th><th>ERP 품목</th><th>견적 세부차수</th><th>출고일/요일</th><th>수량</th><th>원본 단위</th><th>제거</th></tr></thead><tbody>
          {plans.map((plan) => <tr key={plan.id}><td>{plan.sourceLabel}<br/><span className="muted">{plan.sheet}!{plan.sourceCell} · {plan.header} · 원문 {plan.raw}</span></td><td>{plan.prodName || `ProdKey ${plan.prodKey}`}</td><td>{plan.year}/{plan.orderWeek}</td><td>{plan.date}<div className="muted">{plan.date ? weekdayLabels[new Date(`${plan.date}T12:00:00`).getDay()] + '요일' : ''} · 날짜 이동은 위 표에서</div></td><td><input style={{ ...inputStyle, width:110 }} type="number" min="0" step="any" value={plan.quantity} onChange={(e) => updatePlan(plan.id, { quantity:e.target.value })} /></td><td>{plan.unit}</td><td><button onClick={() => { setDraftHistory((current)=>[{id:crypto.randomUUID(),kind:'DRAFT_REMOVE',applied:false,at:new Date().toISOString(),prodKey:plan.prodKey,before:{...plan},after:null},...current]);setPlans((current) => current.filter((item) => item.id !== plan.id)); }}>삭제</button></td></tr>)}
          {!plans.length && <tr><td colSpan={7}>아직 배분 초안이 없습니다. 원본행을 ERP 품목과 연결한 뒤 계획에 추가하세요.</td></tr>}
        </tbody></table></div>
      </section>

      {(draftHistory.length > 0 || erpHistory.length > 0) && <section className="span-12" style={panel}>
        <h2 style={{fontSize:17,margin:'0 0 10px'}}>변경 이력 · 초안과 전산 기록 구분</h2>
        <div className="grid"><div className="span-6"><b>현재 화면 초안 (ERP 미적용)</b>{draftHistory.map((event)=><div key={event.id} style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13}}>{event.at?.slice(0,19).replace('T',' ')} · 품목 {event.prodKey} · {event.kind}<br/>{event.before?.year}/{event.before?.orderWeek} {event.before?.date} → {event.after ? `${event.after.year}/${event.after.orderWeek} ${event.after.date}` : '초안 제거'} · {event.quantity != null ? `${event.quantity} ${event.unit}` : `${event.before?.quantity ?? '—'} → ${event.after?.quantity ?? '—'}`} {event.reason && `· ${event.reason}`}</div>)}</div><div className="span-6"><b>ERP 확정 시 기록된 출고 변경</b><p className="muted">일자별 신규·수정·삭제 기록입니다. 기존 데이터에는 서로 연결된 이동 ID가 없어 출발/도착을 자동 단정하지 않습니다.</p>{erpHistory.map((event,index)=><div key={`${event.SdetailKey}|${event.ChangeDtm}|${index}`} style={{padding:'6px 0',borderBottom:'1px solid #ddd',fontSize:13}}>{event.ChangeDtm} · {event.ChangeID} · {event.OrderYear}/{event.OrderWeek} · 품목 {event.ProdKey}<br/>{event.ShipmentDate} {event.ChangeType} · {event.BeforeValue} → {event.AfterValue}</div>)}</div></div>
      </section>}

      {compareRows && <section className="span-12" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>6. 전산 대조 결과 · 읽기 전용</h2>
        <div className="scroll-table"><table><thead><tr><th>연도·세부차수</th><th>거래처</th><th>품목</th><th>계획(선택 단위)</th><th>전산 분배(OutUnit)</th><th>차이</th><th>확정 여부</th><th>날짜별 출고 / 견적수량</th><th>상태</th></tr></thead><tbody>
          {compareRows.map((row) => {
            const related = plans.filter((item) => Number(item.custKey) === Number(row.custKey) && Number(item.year) === row.year && item.prodKey === row.prodKey && item.orderWeek === row.orderWeek);
            const planned = related.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            const sameUnit = related.length > 0 && related.every((item) => item.unit === row.outUnit);
            const delta = sameUnit && row.shipmentOutQuantity != null ? planned - row.shipmentOutQuantity : null;
            const plannedByDate = new Map();
            for (const item of related) plannedByDate.set(item.date, (plannedByDate.get(item.date) || 0) + (Number(item.quantity) || 0));
            const actualByDate = new Map();
            for (const item of row.shipmentDates || []) {
              const date = String(item.date).slice(0, 10);
              const previous = actualByDate.get(date);
              actualByDate.set(date, { shipmentQuantity: (previous?.shipmentQuantity ?? 0) + Number(item.shipmentQuantity), estimateQuantity: (previous?.estimateQuantity ?? 0) + Number(item.estimateQuantity) });
            }
            const datesToShow = [...new Set([...plannedByDate.keys(), ...actualByDate.keys()])].sort();
            return <tr key={`${row.year}|${row.orderWeek}|${row.prodKey}`}><td>{row.year} / {row.orderWeek}</td><td>{customer?.CustName}</td><td>{related[0]?.prodName || row.prodName || row.prodKey}</td><td>{related.length ? planned : '초안 없음'} {related[0]?.unit || ''}</td><td>{row.shipmentOutQuantity == null ? '분배 없음' : `${row.shipmentOutQuantity} ${row.outUnit || ''}`}</td><td>{delta == null ? '대조 대상 없음/단위 확인' : delta}</td><td>{row.fixed === 'mixed' ? '혼합 · 검토 필요' : row.fixed == null ? '미확인' : row.fixed ? '확정 · 검토 필요' : '미확정'}</td><td>{datesToShow.length ? datesToShow.map((date) => { const actual = actualByDate.get(date); const dayDelta = sameUnit && actual ? (plannedByDate.get(date) || 0) - actual.shipmentQuantity : null; return <div key={date}>{date} · 계획 {plannedByDate.get(date) || 0} / {actual ? `전산 ${actual.shipmentQuantity} / 차이 ${dayDelta == null ? '단위 확인 필요' : dayDelta} · 견적 ${actual.estimateQuantity}` : '전산 날짜행 없음 · 차이 산출 불가'}</div>; }) : '날짜 계획/전산행 없음'}</td><td>{row.state}</td></tr>;
          })}
        </tbody></table></div>
        <p className="muted">이 결과는 선택한 전후 업무 주기의 현재 조회일 뿐, 요일 계획과 단위가 같다는 보증이나 적용 가능 판정이 아닙니다. 연말에는 연결된 다음 연도 차수도 명시적으로 조회합니다.</p>
      </section>}

      <section className="span-12" style={{ ...panel, borderColor:'#d5a329', background:'#fffbeb' }}>
        <b>현재 제공 범위</b>: 엑셀 원문 파싱, 행별 품목 연결, 초안 편집, 연도·세부차수·거래처·품목 범위의 전산 읽기 대조.<br/>
        <span className="muted">ERP 적용은 다요일 ShipmentDate 저장/확정 사이클 검증이 남아 비활성화했습니다. 상단 요일별 인쇄는 전산 확정본만 출력합니다. 화면 초안은 페이지를 새로고침하면 사라집니다.</span>
      </section>
    </div>
    </details>
    {printPreview && <div className="weekday-print-overlay" onKeyDown={event=>{if(event.key==='Escape')setPrintPreview(null);}}>
      <section role="dialog" aria-modal="true" aria-label="요일 견적서 인쇄 미리보기" className="weekday-print-dialog">
        <div style={{display:'flex',gap:8,alignItems:'center'}}><b style={{flex:1}}>{printPreview.label} · {printPreview.count}행</b><button className="primary" onClick={()=>previewFrame.current?.contentWindow?.print()}>견적서 출력</button><button autoFocus onClick={()=>setPrintPreview(null)}>닫기</button></div>
        <div className="muted">{printPreview.note} · 미적용 초안 제외 · A4 / 배율 100% 권장</div>
        <iframe ref={previewFrame} title="전산 확정 견적서" srcDoc={printPreview.html}/>
      </section>
    </div>}
  </main>;
}
