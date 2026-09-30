import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../lib/useApi';
import WeekdayCycleMatrix from './WeekdayCycleMatrix';
import { locateShippingDay, moveWeekdayPlan } from '../lib/weekdayEstimateCycle.js';

const initialYear = new Date().getFullYear();
const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const panel = { border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', padding: 16 };
const inputStyle = { border: '1px solid #9aaec4', borderRadius: 6, padding: '8px 10px', minHeight: 38, background: '#fff' };

function candidateCells(row) { return (row.cells || []).filter((cell) => cell.kind === 'numeric-candidate' && cell.headerRole === 'date-quantity-candidate'); }
function draftKey(row) { return `${row.sheet}|${row.row}|${row.cell.address}`; }

export default function WeekdayEstimateWorkspace() {
  const [year, setYear] = useState(String(initialYear));
  const [majorWeek, setMajorWeek] = useState('38');
  const [shipDate, setShipDate] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
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
  const [cycles, setCycles] = useState([]);
  const [calendarError, setCalendarError] = useState('');
  const [sourceLots, setSourceLots] = useState([]);
  const [erpHistory, setErpHistory] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const calendarRequest = useRef(0);
  const comparisonRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('엑셀은 임시로 읽기만 합니다. 전산 원장에는 저장하지 않습니다.');

  const sourceRows = useMemo(() => (parsed?.sheets || []).flatMap((sheet) => (sheet.rows || [])
    .filter((row) => row.section && row.label && !row.isHeaderRow && (row.cells || []).some((cell) => cell.column === 'B' && cell.raw === row.label))
    .map((row) => ({ ...row, sheet: sheet.name, quantityCells: candidateCells(row) }))), [parsed]);

  useEffect(() => {
    const request = ++calendarRequest.current;
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
      setParsed(result); setFileName(file.name); setPlans([]); setMappings({}); setProductNames({}); setCompareRows(null); setSelectedSource(null); setDraftHistory([]); setSourceLots([]); setErpHistory([]);
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
    setCompareRows(null);
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
    if (!customer?.CustKey || !plans.length) { setMessage('거래처 선택과 배분 초안이 필요합니다.'); return; }
    const invalid = plans.filter((plan) => Number(plan.custKey) !== Number(customer.CustKey) || !/^\d{4}$/.test(String(plan.year)) || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !/^\d{2}-\d{2}$/.test(plan.orderWeek) || !Number.isFinite(Number(plan.quantity)) || Number(plan.quantity) < 0 || plan.unit === '확인 필요');
    if (invalid.length) { setMessage(`차수·날짜·수량·단위 확인이 필요한 행 ${invalid.length}건을 먼저 수정하세요.`); return; }
    const request = ++comparisonRequest.current;
    setBusy(true); setMessage('앞·현재·뒤 차수의 동일 거래처·품목 전산값을 대조 중…');
    try {
      const ranges = new Map();
      for (const cycle of cycles.filter((item) => item.calendarState === 'FOUND')) {
        ranges.set(cycle.year, [...new Set([...(ranges.get(cycle.year) || []), ...cycle.days.map((day) => day.orderWeek)])]);
      }
      for (const plan of plans) ranges.set(Number(plan.year), [...new Set([...(ranges.get(Number(plan.year)) || []), plan.orderWeek])]);
      const results = await Promise.all([...ranges].map(async ([requestYear,orderWeeks]) => {
        const response = await fetch('/api/estimate/weekday-compare', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: requestYear, custKey: Number(customer.CustKey), orderWeeks, prodKeys: [...new Set(plans.map((item) => Number(item.prodKey)))] }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '전산 대조에 실패했습니다.');
      return result;
      }));
      if (request !== comparisonRequest.current) return;
      setCompareRows(results.flatMap((result) => result.rows)); setSourceLots(results.flatMap((result) => result.sourceLots || [])); setErpHistory(results.flatMap((result) => result.history || []));
      setMessage(`전후 차수 전산 대조 완료 · 읽기 전용 · ERP 변경 없음${results.some((result)=>result.historyTruncated) ? ' · 이력 1000건 초과, 일부 표시' : ''}`);
    } catch (error) { if (request === comparisonRequest.current) setMessage(error.message); }
    finally { if (request === comparisonRequest.current) setBusy(false); }
  }

  const style = `
    .weekday-workspace { color:#122033; max-width:100%; margin:0 auto; padding:18px; }
    .weekday-workspace button { border:1px solid #7892b0; border-radius:6px; padding:8px 12px; color:#16345a; background:#f8fbff; cursor:pointer; font-weight:600; }
    .weekday-workspace button.primary { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
    .weekday-workspace button:disabled { opacity:.5; cursor:not-allowed; }
    .weekday-workspace input,.weekday-workspace select { font:inherit; color:inherit; }
    .weekday-workspace table { border-collapse:collapse; width:100%; }
    .weekday-workspace th,.weekday-workspace td { border-bottom:1px solid #dce4ed; text-align:left; padding:8px; vertical-align:top; }
    .weekday-workspace th { background:#eff5fc; position:sticky; top:0; z-index:1; }
    .weekday-workspace .scroll-table { overflow-x:auto; border:1px solid #dce4ed; border-radius:8px; }
    .weekday-workspace .grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:12px; }
    .weekday-workspace .span-12 { grid-column:span 12; }
    .weekday-workspace .span-6 { grid-column:span 6; }
    .weekday-workspace .span-4 { grid-column:span 4; }
    .weekday-workspace .muted { color:#586b80; font-size:13px; }
    .weekday-workspace .tag { display:inline-flex; background:#edf4ff; padding:3px 7px; border-radius:99px; margin:2px; font-size:12px; }
    @media(max-width:900px) { .weekday-workspace .span-6,.weekday-workspace .span-4 { grid-column:span 12; } .weekday-workspace { padding:10px; } }
  `;

  return <main className="weekday-workspace">
    <style>{style}</style>
    <header style={{ ...panel, background:'#f3f8ff', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ color:'#16439a', fontSize:22, fontWeight:800 }}>주광 견적서 · 요일별 배분 작업</div>
          <div className="muted" style={{ marginTop:5 }}>엑셀 기준 → 품목·세부차수 연결 → 요일 계획 → 전산 대조. 현재 단계는 초안/조회 전용입니다.</div>
        </div>
        <label>연도 <input style={{ ...inputStyle, width:90 }} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" /></label>
        <label>대차수 <input style={{ ...inputStyle, width:72 }} value={majorWeek} onChange={(e) => setMajorWeek(e.target.value)} inputMode="numeric" /></label>
        <label>헤더 날짜 미인식 시 출고일 <input style={inputStyle} type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} /></label>
      </div>
      <div role="status" style={{ marginTop:12, padding:'9px 12px', borderRadius:6, background:'#fff7df', color:'#624900', fontWeight:600 }}>{message}</div>
      {calendarError && <div role="alert" style={{color:'#b42318',marginTop:8}}>전산 달력: {calendarError}</div>}
    </header>

    <div className="grid">
      <section className="span-4" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>1. 거래처 선택</h2>
        <div style={{ display:'flex', gap:7 }}>
          <input style={{ ...inputStyle, flex:1, minWidth:0 }} value={customerQuery} placeholder="주광 또는 거래처명 검색" onChange={(e) => setCustomerQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findCustomers()} />
          <button onClick={findCustomers}>검색</button>
        </div>
        {customerError && <p style={{ color:'#b42318' }}>{customerError}</p>}
        {customers.length > 0 && <div style={{ marginTop:8, maxHeight:180, overflow:'auto' }}>{customers.map((item) => <button key={item.CustKey} onClick={() => { comparisonRequest.current += 1; setBusy(false); setCustomer(item); setCustomerQuery(item.CustName); setCustomers([]); setCompareRows(null); setSourceLots([]); setErpHistory([]); }} style={{ display:'block', width:'100%', textAlign:'left', marginBottom:4 }}>{item.CustName} <span className="muted">· {item.CustArea || '지역 미등록'} · {item.CustKey}</span></button>)}</div>}
        <div style={{ marginTop:10, padding:10, background:'#f4f8fc', borderRadius:6 }}><b>선택 업체:</b> {customer ? `${customer.CustName} (${customer.CustKey})` : '미선택'}<br/><span className="muted">업체를 직접 확인해야 대조가 가능합니다. 기본 자동 선택하지 않습니다.</span></div>
      </section>

      <section className="span-4" style={panel}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>2. 요일별 엑셀 업로드</h2>
        <input aria-label="요일별 출고 엑셀 파일" type="file" accept=".xlsx,.xls" onChange={(e) => uploadWorkbook(e.target.files?.[0])} disabled={busy} />
        {fileName && <p><b>{fileName}</b> · {parsed?.sheets?.length || 0}개 시트 · 원문 임시 분석</p>}
        {uploadError && <p style={{ color:'#b42318' }}>{uploadError}</p>}
        {parsed && <div className="muted">{parsed.sheets.map((sheet) => <span className="tag" key={sheet.name}>{sheet.name}: {sheet.rows.length}행 · 병합 {sheet.merges.length}</span>)}<p>텍스트·수식은 자동 수량으로 바꾸지 않습니다. 날짜 수량 열로 인식되지 않은 셀은 검토가 필요합니다.</p></div>}
      </section>

      <section className="span-4" style={{ ...panel, background:'#f8fafc' }}>
        <h2 style={{ margin:'0 0 10px', fontSize:17 }}>3. 단위 확인</h2>
        <label>업로드 날짜 수량의 단위 확인 <select style={{ ...inputStyle, display:'block', width:'100%', marginTop:7 }} value={unit} onChange={(e) => setUnit(e.target.value)}><option>확인 필요</option><option>박스</option><option>단</option><option>송이</option></select></label>
        <p className="muted">원본 양식에 단위가 확정되지 않은 값은 환산하지 않습니다. 선택은 현재 화면의 초안에만 적용됩니다.</p>
      </section>

      <section className="span-12" style={panel}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',marginBottom:10}}><h2 style={{fontSize:17,margin:0}}>목~수 출고 · 앞뒤 차수 연결</h2><button onClick={compareWithErp} disabled={busy || !plans.length}>선택 범위 전산 대조</button></div>
        <WeekdayCycleMatrix cycles={cycles} plans={plans.filter((plan)=>Number(plan.custKey)===Number(customer?.CustKey))} comparisonRows={compareRows || []} onMove={moveDraft} busy={busy}/>
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
          <button disabled title="EXE 인쇄 양식 대조 자료 확보 후 제공">요일 견적 인쇄 · 준비 중</button>
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
            const related = plans.filter((item) => Number(item.year) === row.year && item.prodKey === row.prodKey && item.orderWeek === row.orderWeek);
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
        <span className="muted">ERP 적용은 다요일 ShipmentDate 저장/확정 사이클의 실DB·EXE parity 검증이 남아 비활성화했습니다. 견적 인쇄는 EXE 출력 골든 비교 자료를 확인한 뒤 연결합니다. 화면 초안은 페이지를 새로고침하면 사라집니다.</span>
      </section>
    </div>
  </main>;
}
