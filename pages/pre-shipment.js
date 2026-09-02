import { useEffect, useMemo, useRef, useState } from 'react';

const todayYear = () => String(new Date().getFullYear());
const number = value => Number(value || 0);
const fmt = value => number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

export default function PreShipmentPage() {
  const [data, setData] = useState({ plans: [], plan: null, items: [], schedules: [], allocations: [] });
  const [planKey, setPlanKey] = useState('');
  const [year, setYear] = useState(todayYear());
  const [week, setWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newSchedule, setNewSchedule] = useState({ shipmentDate: '', dayLabel: '추가 출고', targetOrderYear: todayYear(), targetMajorWeek: '' });
  const [newItem, setNewItem] = useState({ speciesName: '', itemName: '', orderBoxQty: '', orderUnitQty: '', busanWilsonQty: '', memo: '' });
  const [productSearches, setProductSearches] = useState({});
  const [productOptions, setProductOptions] = useState({});
  const [traceText, setTraceText] = useState('');
  const [traceYear, setTraceYear] = useState(todayYear());
  const [tracePreWeek, setTracePreWeek] = useState('');
  const [traceNormalWeek, setTraceNormalWeek] = useState('');
  const [traceResults, setTraceResults] = useState([]);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceMessage, setTraceMessage] = useState('');
  const fileRef = useRef(null);

  async function load(key = planKey) {
    setError('');
    const response = await fetch(`/api/pre-shipment${key ? `?planKey=${key}` : ''}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || '조회 실패');
    setData(json);
    if (json.plan?.PlanKey) setPlanKey(String(json.plan.PlanKey));
    if (json.plan) setNewSchedule(current => ({ ...current, targetOrderYear: json.plan.OrderYear, targetMajorWeek: String(json.plan.MajorWeek) }));
  }
  useEffect(() => { load('').catch(e => setError(e.message)); }, []);

  const allocationMap = useMemo(() => new Map(data.allocations.map(row => [`${row.ScheduleKey}:${row.ItemKey}`, number(row.Quantity)])), [data.allocations]);
  const groupedItems = useMemo(() => {
    const groups = [];
    for (const item of data.items) {
      let group = groups.find(row => row.name === item.SpeciesName);
      if (!group) { group = { name: item.SpeciesName, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  }, [data.items]);

  async function upload(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('엑셀 파일을 선택하세요.');
      if (!week) throw new Error('등록 차수를 입력하세요.');
      const body = new FormData(); body.append('file', file); body.append('orderYear', year); body.append('majorWeek', week);
      const response = await fetch('/api/pre-shipment/upload', { method: 'POST', body });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || '업로드 실패');
      const mismatch = Number(json.sourceSheetMajor) !== Number(week) ? ` (주의: 원본 시트명은 ${json.sourceSheetMajor}차)` : '';
      setMessage(`${json.sheetName} 시트의 ${json.itemCount}개 품목을 ${year}년 ${week}차로 불러왔습니다.${mismatch}`);
      setPlanKey(String(json.planKey)); await load(String(json.planKey));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function patchAllocation(scheduleKey, itemKey, quantity) {
    setData(current => {
      const next = current.allocations.filter(row => !(Number(row.ScheduleKey) === Number(scheduleKey) && Number(row.ItemKey) === Number(itemKey)));
      next.push({ ScheduleKey: scheduleKey, ItemKey: itemKey, Quantity: number(quantity) });
      return { ...current, allocations: next };
    });
  }
  async function saveCell(scheduleKey, itemKey, quantity) {
    patchAllocation(scheduleKey, itemKey, quantity);
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-cell', scheduleKey, itemKey, quantity: number(quantity) }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '수량 저장 실패');
    } catch (e) { setError(e.message); await load(); }
  }
  function patchSchedule(scheduleKey, field, value) {
    setData(current => ({ ...current, schedules: current.schedules.map(row => Number(row.ScheduleKey) === Number(scheduleKey) ? { ...row, [field]: value } : row) }));
  }
  async function saveSchedule(schedule) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-schedule', scheduleKey: schedule.ScheduleKey, shipmentDate: schedule.ShipmentDate ? String(schedule.ShipmentDate).slice(0, 10) : '', dayLabel: schedule.DayLabel, targetOrderYear: schedule.TargetOrderYear, targetMajorWeek: schedule.TargetMajorWeek }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '출고 기준 저장 실패');
      setMessage('출고일·견적 이동 차수를 저장했습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addSchedule() {
    if (!data.plan) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-schedule', planKey: data.plan.PlanKey, ...newSchedule }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '출고열 추가 실패');
      await load(); setMessage('출고열을 추가했습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addItem() {
    if (!data.plan) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-item', planKey: data.plan.PlanKey, ...newItem }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '품목 추가 실패');
      setNewItem({ speciesName: '', itemName: '', orderBoxQty: '', orderUnitQty: '', busanWilsonQty: '', memo: '' });
      await load(); setMessage('수기 품목을 추가했습니다. 전산 품목을 검색해 매칭할 수 있습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function searchProducts(item) {
    const term = String(productSearches[item.ItemKey] || `${item.SpeciesName || ''} ${item.ItemName || ''}`).trim();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search-products', query: term }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '전산 품목 검색 실패');
      setProductOptions(current => ({ ...current, [item.ItemKey]: json.products || [] }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function matchItem(item, prodKey) {
    if (!data.plan) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'match-item', planKey: data.plan.PlanKey, itemKey: item.ItemKey, prodKey }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '품목 매칭 저장 실패');
      await load();
      setMessage(prodKey ? '전산 품목 매칭을 저장했습니다.' : '전산 품목 매칭을 해제했습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function analyzeStockTrace() {
    if (!traceText.trim()) return setError('업체·품목·수량을 붙여넣으세요.');
    if (tracePreWeek && !/^\d{2}-\d{2}$/.test(tracePreWeek)) return setError('선출고 차수를 35-01 형식으로 입력하세요.');
    setTraceBusy(true); setError(''); setTraceMessage(''); setTraceResults([]);
    try {
      const parsedResponse = await fetch('/api/orders/parse-paste', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: traceText }),
      });
      const parsed = await parsedResponse.json();
      if (!parsedResponse.ok || !parsed.success) throw new Error(parsed.error || '붙여넣기 분석 실패');
      const effectivePreWeek = tracePreWeek || String(parsed.detectedWeek || '');
      if (!/^\d{2}-\d{2}$/.test(effectivePreWeek)) throw new Error('본문에 차수가 없으면 선출고 차수를 35-01 형식으로 선택하세요.');
      if (!tracePreWeek) setTracePreWeek(effectivePreWeek);
      const groups = (parsed.orders || []).map(order => ({
        customerName: order.custMatch?.CustName || order.custName || '',
        custKey: Number(order.custMatch?.CustKey || 0),
        items: (order.items || []).map(item => ({
          prodKey: Number(item.prodKey || 0), quantity: number(item.qty), unit: item.unit || '',
          inputName: item.inputName || item.prodName || '',
        })),
      }));
      if (!groups.length) throw new Error('분석된 업체·품목이 없습니다. 입력 형식을 확인하세요.');
      const unresolved = groups.filter(group => !group.custKey || group.items.some(item => !item.prodKey));
      if (unresolved.length) {
        const names = unresolved.map(group => group.customerName || '업체 미매칭').join(', ');
        throw new Error(`${names}: 업체 또는 품목 매칭이 필요합니다. 붙여넣기 주문등록의 매칭을 먼저 저장하거나 전산 품목명을 입력하세요.`);
      }
      const loaded = await Promise.all(groups.map(async group => {
        const params = new URLSearchParams({
          orderYear: traceYear, preWeek: effectivePreWeek, custKey: String(group.custKey),
          items: JSON.stringify(group.items),
        });
        if (traceNormalWeek) params.set('normalWeek', traceNormalWeek);
        const response = await fetch(`/api/pre-shipment/history?${params.toString()}`, { credentials: 'same-origin' });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(`${group.customerName}: ${json.error || '재고 이력 조회 실패'}`);
        return { ...json, customerName: group.customerName };
      }));
      setTraceResults(loaded);
      setTraceMessage(`${loaded.length}개 업체 · ${loaded.reduce((sum, row) => sum + row.items.length, 0)}개 품목의 선출고/정상차수 이력을 조회했습니다.`);
    } catch (e) { setError(e.message); } finally { setTraceBusy(false); }
  }

  const scheduleTotal = scheduleKey => data.items.reduce((sum, item) => sum + number(allocationMap.get(`${scheduleKey}:${item.ItemKey}`)), 0);
  const erpSummary = item => item.ProdKey ? data.erpStatus?.summaries?.[String(item.ProdKey)] : null;
  const erpDistributionTotal = data.items.reduce((sum, item) => sum + number(erpSummary(item)?.DistributedQuantity), 0);
  const erpConfirmedTotal = data.items.reduce((sum, item) => sum + number(erpSummary(item)?.ConfirmedQuantity), 0);
  const erpPendingTotal = data.items.reduce((sum, item) => sum + number(erpSummary(item)?.PendingQuantity), 0);
  return <main className="page">
    <h1>선출고·후출고 관리</h1>
    <p className="desc">선출고 계획과 정상 귀속 차수를 연결해 실제 출고·재고 수정 이력을 비교합니다. 이 화면은 ERP 입고·주문·출고·재고를 자동 변경하지 않습니다.</p>
    <section className="tracePanel">
      <div className="traceHead"><div><b>업체·품목 붙여넣기 재고 이력</b><span> 붙여넣기 주문등록과 같은 매칭 기준으로 품목별 선출고 차수와 정상차수를 비교합니다.</span></div></div>
      <div className="traceGrid">
        <div className="traceInput">
          <textarea value={traceText} onChange={e => setTraceText(e.target.value)} placeholder={'주광농원\n돈셀 4박스\n문라이트 20박스'} />
          <div className="traceControls">
            <label>연도 <input value={traceYear} onChange={e => setTraceYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
            <label>선출고 차수 <input value={tracePreWeek} onChange={e => setTracePreWeek(e.target.value)} placeholder="35-01" /></label>
            <label>정상차수 <input value={traceNormalWeek} onChange={e => setTraceNormalWeek(e.target.value)} placeholder="자동: 다음 재고차수" /></label>
            <button type="button" onClick={analyzeStockTrace} disabled={traceBusy}>{traceBusy ? '조회 중…' : '분석·이력 조회'}</button>
          </div>
          <small>정상차수를 비우면 같은 연도에서 실제 재고 스냅샷이 있는 다음 세부차수를 자동 선택합니다.</small>
        </div>
        <div className="traceResults">
          {traceMessage ? <div className="success">{traceMessage}</div> : null}
          {!traceResults.length ? <div className="traceEmpty">분석 후 품목별 재고 수정 여부와 두 차수의 이력이 표시됩니다.</div> : traceResults.flatMap(group => group.items.map(item => <article className="traceCard" key={`${group.customerName}-${item.prodKey}`}>
            <header><strong>{group.customerName} · {item.product?.prodName || `품목 #${item.prodKey}`}</strong><span>{fmt(item.quantity)} {item.unit || item.product?.outUnit || ''}</span></header>
            <div className="traceCompare">
              {[['선출고', item.preShipment], ['정상차수', item.normalShipment]].map(([label, row]) => <div className="weekTrace" key={label}>
                <b>{label} {row?.week || '-'}</b>
                <span className={row?.status?.hasManualStockAdjustment ? 'changed' : 'unchanged'}>{row?.status?.hasManualStockAdjustment ? '재고수정 있음' : row?.snapshot?.hasSnapshot ? '재고수정 없음' : '스냅샷 없음'}</span>
                <dl><dt>재고 스냅샷</dt><dd>{row?.snapshot?.hasSnapshot ? fmt(row.snapshot.stock) : '-'}</dd><dt>입고</dt><dd>{fmt(row?.inboundQuantity)}</dd><dt>확정출고</dt><dd>{fmt(row?.confirmedOutboundQuantity)}</dd><dt>해당업체 분배</dt><dd>{fmt((row?.customerDistribution || []).reduce((sum, entry) => sum + number(entry.distributionQuantity), 0))}</dd></dl>
                <details><summary>재고 이력 {row?.stockHistory?.length || 0}건</summary>{row?.stockHistory?.length ? row.stockHistory.map((history, index) => <div className="historyRow" key={`${history.changedAt}-${index}`}><time>{String(history.changedAt || '').replace('T', ' ').slice(0, 19)}</time><b>{history.changeType || '변경'}</b><span>{fmt(history.beforeValue)} → {fmt(history.afterValue)}</span><em>{history.changeId || ''} {history.descr || ''}</em></div>) : <div className="historyNone">이 차수의 재고 이력이 없습니다.</div>}</details>
              </div>)}
            </div>
            <footer>재고 이력은 품목·차수 전체 기록이며 특정 업체 때문에 발생한 변경으로 단정하지 않습니다.</footer>
          </article>))}
        </div>
      </div>
    </section>
    <form className="upload" onSubmit={upload}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" />
      <label>등록연도 <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
      <label>등록차수 <input value={week} onChange={e => setWeek(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="32" /></label>
      <button disabled={busy}>{busy ? '처리 중…' : '주광 시트 업로드'}</button>
      <span className="hint">`주광 카장수알 숫자차` 원본만 사용 · `(2)`/고정수량 제외</span>
    </form>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {message ? <div className="success" role="status">{message}</div> : null}
    <div className="toolbar">
      <label>저장 차수 <select value={planKey} onChange={e => { setPlanKey(e.target.value); load(e.target.value).catch(x => setError(x.message)); }}><option value="">선택</option>{data.plans.map(row => <option key={row.PlanKey} value={row.PlanKey}>{row.OrderYear}년 {row.MajorWeek}차 · {row.SourceSheetName}</option>)}</select></label>
      {data.plan ? <strong>{data.plan.OrderYear}년 {data.plan.MajorWeek}차 · 품목 {data.items.length}개 {data.customer?.CustName ? `· 전산 거래처 ${data.customer.CustName} (#${data.customer.CustKey})` : '· 전산 거래처 미매칭'}</strong> : null}
    </div>
    {data.plan ? <>
      <section className="addSchedule">
        <b>출고열 추가</b>
        <input type="date" value={newSchedule.shipmentDate} onChange={e => setNewSchedule({ ...newSchedule, shipmentDate: e.target.value })} />
        <input value={newSchedule.dayLabel} onChange={e => setNewSchedule({ ...newSchedule, dayLabel: e.target.value })} placeholder="목요일 선출고" />
        <span>견적 이동</span><input className="year" value={newSchedule.targetOrderYear} onChange={e => setNewSchedule({ ...newSchedule, targetOrderYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /><input className="week" value={newSchedule.targetMajorWeek} onChange={e => setNewSchedule({ ...newSchedule, targetMajorWeek: e.target.value.replace(/\D/g, '').slice(0, 2) })} /><span>차</span>
        <button onClick={addSchedule} disabled={busy}>추가</button>
      </section>
      <section className="addItem">
        <b>품목 추가</b>
        <input value={newItem.speciesName} onChange={e => setNewItem({ ...newItem, speciesName: e.target.value })} placeholder="품종 (예: 카네이션)" />
        <input value={newItem.itemName} onChange={e => setNewItem({ ...newItem, itemName: e.target.value })} placeholder="품목명" />
        <input type="number" min="0" step="0.01" value={newItem.orderBoxQty} onChange={e => setNewItem({ ...newItem, orderBoxQty: e.target.value })} placeholder="발주 박스" />
        <input type="number" min="0" step="0.01" value={newItem.orderUnitQty} onChange={e => setNewItem({ ...newItem, orderUnitQty: e.target.value })} placeholder="발주 단" />
        <input type="number" min="0" step="0.01" value={newItem.busanWilsonQty} onChange={e => setNewItem({ ...newItem, busanWilsonQty: e.target.value })} placeholder="부산윌슨" />
        <input value={newItem.memo} onChange={e => setNewItem({ ...newItem, memo: e.target.value })} placeholder="메모" />
        <button type="button" onClick={addItem} disabled={busy}>품목 추가</button>
      </section>
      <div className="matrixWrap">
        <table><thead><tr>
          <th className="species">품종</th><th className="item">품목명</th><th className="product">전산 품목 매칭</th><th>발주(박스)</th><th>발주(단)</th><th>부산윌슨</th>
          {data.schedules.map(schedule => <th key={schedule.ScheduleKey} className="scheduleHead">
            <input value={schedule.DayLabel || ''} onChange={e => patchSchedule(schedule.ScheduleKey, 'DayLabel', e.target.value)} aria-label="출고 구분" />
            <input type="date" value={schedule.ShipmentDate ? String(schedule.ShipmentDate).slice(0, 10) : ''} onChange={e => patchSchedule(schedule.ScheduleKey, 'ShipmentDate', e.target.value)} />
            <div className="target"><span>견적</span><input value={schedule.TargetOrderYear || data.plan.OrderYear} onChange={e => patchSchedule(schedule.ScheduleKey, 'TargetOrderYear', e.target.value.replace(/\D/g, '').slice(0, 4))} /><input value={schedule.TargetMajorWeek || data.plan.MajorWeek} onChange={e => patchSchedule(schedule.ScheduleKey, 'TargetMajorWeek', e.target.value.replace(/\D/g, '').slice(0, 2))} /><span>차</span></div>
            <button onClick={() => saveSchedule(schedule)} disabled={busy}>기준 저장</button>
          </th>)}
          <th>계획 출고합계</th><th>ERP 분배</th><th>ERP 확정</th><th>ERP 미확정</th><th>ERP 출고일 현황</th><th>계획-ERP분배</th><th>발주-출고</th><th>메모</th>
        </tr></thead><tbody>
          {groupedItems.flatMap(group => group.items.map((item, index) => <tr key={item.ItemKey}>
            {index === 0 ? <th className="species body" rowSpan={group.items.length}>{group.name}</th> : null}
            <th className="item body">{item.ItemName}</th><td className="product body"><div className={item.ProdKey ? 'matched' : 'unmatched'}>{item.ProdKey ? `#${item.ProdKey} ${item.MatchedProdName || ''}` : '미매칭'}</div><div className="productSearch"><input value={productSearches[item.ItemKey] ?? ''} onChange={e => setProductSearches(current => ({ ...current, [item.ItemKey]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchProducts(item); } }} placeholder="전산 품목 검색" /><button type="button" onClick={() => searchProducts(item)} disabled={busy}>검색</button></div>{productOptions[item.ItemKey]?.length ? <select value="" onChange={e => { if (e.target.value) matchItem(item, e.target.value); }}><option value="">검색 결과에서 선택</option>{productOptions[item.ItemKey].map(product => <option key={product.ProdKey} value={product.ProdKey}>#{product.ProdKey} · {product.ProdName}{product.DisplayName && product.DisplayName !== product.ProdName ? ` / ${product.DisplayName}` : ''}</option>)}</select> : null}{item.ProdKey ? <button type="button" className="unlink" onClick={() => matchItem(item, null)} disabled={busy}>해제</button> : null}</td><td>{fmt(item.OrderBoxQty)}</td><td>{fmt(item.OrderUnitQty)}</td><td>{fmt(item.BusanWilsonQty)}</td>
            {data.schedules.map(schedule => <td key={schedule.ScheduleKey} className="qtyCell"><input type="number" min="0" step="0.01" value={allocationMap.get(`${schedule.ScheduleKey}:${item.ItemKey}`) ?? ''} onChange={e => patchAllocation(schedule.ScheduleKey, item.ItemKey, e.target.value)} onBlur={e => saveCell(schedule.ScheduleKey, item.ItemKey, e.target.value)} /></td>)}
            {(() => { const shipped = data.schedules.reduce((sum, schedule) => sum + number(allocationMap.get(`${schedule.ScheduleKey}:${item.ItemKey}`)), 0); const matched = Number(item.ProdKey) > 0; const status = erpSummary(item); const distributed = number(status?.DistributedQuantity); const dateTotal = number(status?.ShipmentDateQuantity); const dates = data.erpStatus?.dates?.[String(item.ProdKey)] || []; return <><td className="sum">{fmt(shipped)}</td><td className={matched ? 'erpQty' : 'noMatch'}>{matched ? fmt(distributed) : '품목 미매칭'}</td><td className="erpQty">{matched ? fmt(status?.ConfirmedQuantity) : '-'}</td><td className="erpQty">{matched ? fmt(status?.PendingQuantity) : '-'}</td><td className="dateStatus">{matched ? <>{dates.length ? dates.map(row => <div key={`${row.OrderWeek}-${row.ShipmentDate}`}>{String(row.ShipmentDate).slice(0, 10)} · {row.OrderWeek}: {fmt(row.ShipmentDateQuantity)}{number(row.ConfirmedDateQuantity) ? ` (확정 ${fmt(row.ConfirmedDateQuantity)})` : ''}</div>) : '출고일 미지정'}{distributed !== dateTotal ? <div className="dateMismatch">출고일 합계 {fmt(dateTotal)} · 분배와 불일치</div> : null}</> : '-'}</td><td className={shipped - distributed === 0 ? 'balance' : 'mismatch'}>{matched ? fmt(shipped - distributed) : '-'}</td><td className={number(item.OrderBoxQty) - shipped < 0 ? 'over' : 'balance'}>{fmt(number(item.OrderBoxQty) - shipped)}</td></>; })()}<td className="memo">{item.Memo || ''}</td>
          </tr>))}
        </tbody><tfoot><tr><th colSpan="3">합계</th><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderBoxQty), 0))}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderUnitQty), 0))}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.BusanWilsonQty), 0))}</td>{data.schedules.map(schedule => <td key={schedule.ScheduleKey}>{fmt(scheduleTotal(schedule.ScheduleKey))}</td>)}<td>{fmt(data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0))}</td><td>{fmt(erpDistributionTotal)}</td><td>{fmt(erpConfirmedTotal)}</td><td>{fmt(erpPendingTotal)}</td><td>품목별 표시</td><td className={data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0) - erpDistributionTotal === 0 ? 'balance' : 'mismatch'}>{fmt(data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0) - erpDistributionTotal)}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderBoxQty), 0) - data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0))}</td><td /></tr></tfoot></table>
      </div>
    </> : <div className="empty">엑셀을 업로드하거나 저장 차수를 선택하세요.</div>}
    <style jsx>{`
      .page{padding:12px 16px;max-width:none}h1{font-size:22px;margin:0 0 5px}.desc{font-size:13px;color:#64748b;margin:0 0 10px}.tracePanel{border:1px solid #93c5fd;border-radius:8px;background:#f8fbff;margin:0 0 12px;overflow:hidden}.traceHead{padding:8px 10px;background:#dbeafe;color:#1e3a8a}.traceHead span{font-size:11px;color:#475569}.traceGrid{display:grid;grid-template-columns:minmax(430px,38%) 1fr;min-height:250px;max-height:430px}.traceInput{padding:9px;border-right:1px solid #bfdbfe;display:flex;flex-direction:column;gap:7px}.traceInput textarea{width:100%;min-height:145px;resize:vertical;border:1px solid #93c5fd;border-radius:5px;padding:8px;font:13px/1.45 monospace}.traceControls{display:flex;align-items:end;gap:6px;flex-wrap:wrap}.traceControls label{font-size:11px;font-weight:700}.traceControls input{display:block;width:88px;padding:5px;border:1px solid #94a3b8;border-radius:4px}.traceControls label:first-child input{width:58px}.traceControls label:nth-child(3) input{width:145px}.traceControls button{border:0;background:#0f766e;color:white;padding:7px 12px;border-radius:5px;font-weight:800}.traceInput small{color:#64748b}.traceResults{padding:8px;overflow:auto}.traceEmpty{height:100%;display:grid;place-items:center;color:#64748b}.traceCard{border:1px solid #cbd5e1;border-radius:7px;background:white;margin-bottom:7px;overflow:hidden}.traceCard>header{display:flex;justify-content:space-between;padding:6px 8px;background:#f1f5f9;color:#0f172a}.traceCompare{display:grid;grid-template-columns:1fr 1fr}.weekTrace{padding:7px 9px}.weekTrace+ .weekTrace{border-left:1px solid #e2e8f0}.weekTrace>b{margin-right:8px}.changed,.unchanged{display:inline-block;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:800}.changed{background:#fee2e2;color:#b91c1c}.unchanged{background:#dcfce7;color:#166534}.weekTrace dl{display:grid;grid-template-columns:repeat(4,max-content 1fr);gap:3px 6px;margin:6px 0;font-size:11px}.weekTrace dt{color:#64748b}.weekTrace dd{margin:0;font-weight:800;text-align:right}.weekTrace details{font-size:11px}.historyRow{display:grid;grid-template-columns:125px 80px 110px 1fr;gap:5px;padding:3px 0;border-top:1px solid #e2e8f0}.historyRow em{font-style:normal;color:#64748b}.historyNone{padding:5px;color:#64748b}.traceCard>footer{padding:4px 8px;background:#fffbeb;color:#92400e;font-size:10px}.upload,.toolbar,.addSchedule,.addItem{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#f8fafc;border:1px solid #dbe3ec;border-radius:8px;margin-bottom:10px}.upload input:not([type=file]),.addSchedule input,.addItem input,.toolbar select{padding:6px;border:1px solid #cbd5e1;border-radius:5px}.upload label{font-size:12px}.upload label input{width:56px}.upload button,.addSchedule button,.addItem button,.scheduleHead button,.productSearch button{border:0;background:#2563eb;color:white;padding:7px 12px;border-radius:5px;font-weight:700;cursor:pointer}.hint{font-size:11px;color:#64748b}.error,.success{padding:9px 12px;border-radius:6px;margin-bottom:9px}.error{background:#fee2e2;color:#991b1b}.success{background:#dcfce7;color:#166534}.toolbar{justify-content:space-between}.addSchedule{position:sticky;top:0;z-index:20;background:#eff6ff}.addSchedule .year{width:58px}.addSchedule .week{width:36px}.addItem input{width:110px}.matrixWrap{overflow:auto;max-height:calc(100vh - 335px);border:1px solid #cbd5e1}table{border-collapse:separate;border-spacing:0;font-size:12px;min-width:max-content;width:100%}th,td{border-right:1px solid #dbe3ec;border-bottom:1px solid #dbe3ec;padding:5px 7px;text-align:center;background:white;white-space:nowrap}thead th{position:sticky;top:0;z-index:10;background:#eaf2ff}.species{position:sticky;left:0;z-index:14;min-width:90px}.item{position:sticky;left:105px;z-index:13;min-width:180px}.product{min-width:250px}.body{background:#f8fafc}.species.body{vertical-align:middle;color:#1d4ed8}.scheduleHead{min-width:170px}.scheduleHead>input{display:block;width:145px;margin:2px auto;padding:4px;border:1px solid #bfdbfe;border-radius:4px}.target{display:flex;align-items:center;justify-content:center;gap:3px}.target input{width:43px;padding:3px;border:1px solid #cbd5e1}.target input:first-of-type{width:55px}.scheduleHead button{font-size:11px;padding:4px 8px;margin-top:3px}.qtyCell input{width:76px;text-align:right;padding:5px;border:1px solid #93c5fd;border-radius:4px;background:#eff6ff}.matched{font-weight:700;color:#166534}.unmatched{font-weight:700;color:#b45309}.productSearch{display:flex;gap:3px;margin-top:3px}.productSearch input{min-width:130px;width:100%;padding:4px;border:1px solid #bfdbfe;border-radius:4px}.productSearch button{padding:4px 7px;font-size:11px}.product select{margin-top:3px;max-width:238px;padding:3px}.unlink{margin:3px 0 0;border:1px solid #fca5a5;background:white;color:#b91c1c;border-radius:4px;padding:3px 7px;cursor:pointer}.erpQty{font-weight:700;color:#1e3a8a}.noMatch{font-size:11px;color:#b45309}.dateStatus{white-space:normal;min-width:170px;text-align:left;font-size:11px;line-height:1.45}.dateMismatch{color:#b91c1c;font-weight:800}.sum,tfoot td,tfoot th{font-weight:800;background:#fef3c7}.balance{font-weight:700;color:#166534}.mismatch{font-weight:800;color:#b91c1c;background:#fff1f2}.over{font-weight:800;color:#b91c1c;background:#fee2e2}.memo{max-width:220px;white-space:normal;text-align:left}.empty{padding:40px;color:#64748b;text-align:center}@media(max-width:900px){.page{padding:10px}.traceGrid{grid-template-columns:1fr;max-height:none}.traceInput{border-right:0;border-bottom:1px solid #bfdbfe}.traceResults{max-height:420px}.matrixWrap{max-height:calc(100vh - 380px)}}
    `}</style>
  </main>;
}
