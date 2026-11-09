import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/useApi';
import { quantityFormula, settlementPeriods, shortWeek, weekdayValue } from '../lib/estimateShipmentDateSales';
import WorkflowGuide from './WorkflowGuide';
import styles from './EstimateShipmentDateSales.module.css';
import ShipmentSalesCustomerInput from './ShipmentSalesCustomerInput';
import ShipmentSalesRangeCalendar from './ShipmentSalesRangeCalendar';
import { buildSalesMatrix, storedPriceBuckets, visibleSalesPeriods } from '../lib/estimateShipmentDateMatrix';

const PAGE = 'estimate-shipment-date-sales';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
function favoriteValue(favorite) {
  const value = JSON.parse(favorite.FilterData);
  if (!Number.isInteger(value.custKey) || value.custKey <= 0 || typeof value.custName !== 'string') throw Error('저장된 업체 기준이 올바르지 않습니다. 다시 저장하세요.');
  return { ...value, startDay: weekdayValue(value.startDay), endDay: weekdayValue(value.endDay) };
}
function initialRange(){const current=settlementPeriods(today(),1,0,2);return {startDate:current[1].startDate,endDate:current[0].endDate};}

export default function EstimateShipmentDateSales() {
  const [customers, setCustomers] = useState([]), [favorites, setFavorites] = useState([]);
  const [custKey, setCustKey] = useState(''), [startDay, setStartDay] = useState(1), [endDay, setEndDay] = useState(5);
  const [favoriteKey, setFavoriteKey] = useState(null), [mode, setMode] = useState('range');
  const [anchor, setAnchor] = useState(today), [startDate, setStartDate] = useState(() => initialRange().startDate), [endDate, setEndDate] = useState(() => initialRange().endDate);
  const [periods, setPeriods] = useState([]), [resultLabel, setResultLabel] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [ready, setReady] = useState(false);
  const [detail, setDetail] = useState(null);
  const [historyPage,setHistoryPage] = useState(0), [showAllHistory,setShowAllHistory] = useState(false);
  const detailOrigin = useRef(null);
  const matrix=useMemo(()=>buildSalesMatrix(visibleSalesPeriods(periods,mode,historyPage,showAllHistory),mode),[periods,mode,historyPage,showAllHistory]);
  const requestId = useRef(0), currentScope = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all([apiGet('/api/customers/search'), apiGet('/api/favorites', { page: PAGE })]).then(([c, f]) => {
      if (active) { setCustomers(c.customers ?? []); setFavorites(f.favorites ?? []); setReady(true); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; requestId.current++; };
  }, []);
  function invalidate() { requestId.current++; setBusy(false); setPeriods([]); setHistoryPage(0); setShowAllHistory(false); setDetail(null); setResultLabel(''); currentScope.current = null; setError(''); setNotice(''); }
  function parameters() { return mode === 'history' ? { custKey, mode, anchor, startDay, endDay } : { custKey, mode, startDate, endDate }; }
  async function load(scope, append = false, name) {
    const id = ++requestId.current;
    setError(''); setNotice(''); setBusy(true);
    if (!append) { setPeriods([]); setHistoryPage(0); setShowAllHistory(false); setDetail(null); }
    try {
      const data = await apiGet('/api/estimate/shipment-date-sales', scope);
      if (id !== requestId.current) return false;
      currentScope.current = scope;
      setPeriods(previous => append ? [...previous, ...data.periods] : data.periods);
      setResultLabel(name ?? customers.find(c => String(c.CustKey) === String(scope.custKey))?.CustName ?? '선택 업체');
      return true;
    } catch (e) { if (id === requestId.current) setError(e.message); return false; }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function chooseFavorite(favorite) {
    try {
      const value = favoriteValue(favorite);
      const anchorDate=today();
      invalidate(); setFavoriteKey(favorite.FavoriteKey); setCustKey(String(value.custKey)); setStartDay(value.startDay); setEndDay(value.endDay); setMode('history'); setAnchor(anchorDate);
      load({ custKey: value.custKey, mode: 'history', startDay: value.startDay, endDay: value.endDay, anchor: anchorDate }, false, value.custName);
    } catch (e) { setError(e.message); }
  }
  async function saveFavorite() {
    const customer = customers.find(c => String(c.CustKey) === custKey);
    if (!customer) { setError('업체를 선택하세요.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const filterData = JSON.stringify({ custKey: Number(custKey), custName: customer.CustName, startDay: Number(startDay), endDay: Number(endDay) });
      const name = `${customer.CustName} (${DAYS[startDay]}~${DAYS[endDay]})`;
      const result = favoriteKey ? await apiPut('/api/favorites', { favoriteKey, name, filterData }) : await apiPost('/api/favorites', { page: PAGE, name, filterData });
      const list = await apiGet('/api/favorites', { page: PAGE }); setFavorites(list.favorites ?? []); setFavoriteKey(result.favoriteKey); setNotice('업체와 정산 요일을 즐겨찾기에 저장했습니다.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function removeFavorite() {
    setSaving(true); setError('');
    try { await apiDelete('/api/favorites', { favoriteKey }); const list = await apiGet('/api/favorites', { page: PAGE }); setFavorites(list.favorites ?? []); setFavoriteKey(null); setNotice('즐겨찾기를 삭제했습니다.'); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function loadOlder(advance = false) {
    if (busy || !currentScope.current || !periods.length) return;
    const oldest=periods.at(-1).startDate, previous=new Date(oldest+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-7);
    const succeeded=await load({...currentScope.current,anchor:previous.toISOString().slice(0,10)},true,resultLabel);
    if(succeeded&&advance)setHistoryPage(page=>page+1);
  }
  function previousPeriods() {
    if((historyPage+1)*2<periods.length){setHistoryPage(page=>page+1);setDetail(null);}
    else loadOlder(true);
  }
  return <section className={styles.root} aria-label="출고일 기준 매출">
    <div className={styles.heading}><h2>출고일 기준 매출</h2><WorkflowGuide workflowId="estimate-shipment-date-sales" /></div>
    <div className={styles.favorites} aria-label="업체별 정산 즐겨찾기">
      <strong>업체 즐겨찾기</strong>
      {favorites.map(f => <button type="button" className={favoriteKey === f.FavoriteKey ? styles.selected : ''} key={f.FavoriteKey} onClick={() => chooseFavorite(f)} disabled={saving}>{f.FavName}</button>)}
      {ready && !favorites.length && <span>업체와 정산 요일을 저장하면 한 번에 과거 기간까지 조회할 수 있습니다.</span>}
    </div>
    <form className={styles.form} onSubmit={e => { e.preventDefault(); load(parameters()); }}>
      <ShipmentSalesCustomerInput customers={customers} value={custKey} disabled={!ready||saving} onSelect={customer=>{invalidate();setCustKey(String(customer.CustKey));setFavoriteKey(null);}} onEdit={()=>{invalidate();setCustKey('');setFavoriteKey(null);}} />
      <label>정산 시작 요일<select aria-label="정산 시작 요일" value={startDay} disabled={saving} onChange={e => { invalidate(); setStartDay(Number(e.target.value)); }}>{DAYS.map((d,i) => <option key={d} value={i}>{d}요일</option>)}</select></label>
      <label>정산 종료 요일<select aria-label="정산 종료 요일" value={endDay} disabled={saving} onChange={e => { invalidate(); setEndDay(Number(e.target.value)); }}>{DAYS.map((d,i) => <option key={d} value={i}>{d}요일</option>)}</select></label>
      <button type="button" onClick={saveFavorite} disabled={!custKey || saving || !ready}>{saving ? '저장 중…' : favoriteKey ? '즐겨찾기 기준 수정' : '즐겨찾기 저장'}</button>
      {favoriteKey && <><button type="button" disabled={saving} onClick={removeFavorite}>즐겨찾기 삭제</button><button type="button" disabled={saving} onClick={() => { setFavoriteKey(null); setNotice('새 기준으로 저장할 수 있습니다.'); }}>새 즐겨찾기로 저장하기</button></>}
      <label>조회 방식<select aria-label="출고 매출 조회 방식" value={mode} onChange={e => { invalidate(); setMode(e.target.value); }}><option value="history">정산 기간별 과거 이력</option><option value="range">직접 기간 선택</option></select></label>
      {mode === 'history' ? <label>기준일<input aria-label="정산 기준일" type="date" required value={anchor} onChange={e => { invalidate(); setAnchor(e.target.value); }} /></label> : <><label>시작일<input aria-label="출고 매출 시작일" type="date" required value={startDate} onChange={e => { invalidate(); setStartDate(e.target.value); }} /></label><label>종료일<input aria-label="출고 매출 종료일" type="date" required value={endDate} min={startDate} onChange={e => { invalidate(); setEndDate(e.target.value); }} /></label></>}
      <ShipmentSalesRangeCalendar startDate={startDate} endDate={endDate} onChange={(start,end)=>{invalidate();setMode('range');setStartDate(start);setEndDate(end);}} />
      <button type="submit" className={styles.primary} disabled={busy || !custKey || !ready}>{busy ? '조회 중…' : '조회'}</button>
    </form>
    <p className={styles.help}>즐겨찾기 클릭 → 저장한 정산요일로 즉시 조회 · 판매단가/표 금액은 VAT 포함 · 공급가·VAT 별도 표시 · 복수단가는 표시기간 전체의 단가별 수량 · 기존 차수 집계 유지</p>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status">{notice}</div>}
    <div aria-live="polite">{busy && '출고일 매출을 조회하고 있습니다.'}{!busy && !periods.length && !error && '업체와 기간을 선택하거나 즐겨찾기 업체를 눌러 조회하세요.'}</div>
    {periods.length>0&&<>
      <div className={styles.resultHeading}><strong>{resultLabel} · {matrix.weeks.length}개 정산기간 · {matrix.rows.length}개 품목 행</strong>{mode==='history'&&<div className={styles.historyControls} aria-label="정산기간 이동">
        {!showAllHistory&&<><button type="button" disabled={busy} onClick={previousPeriods}>이전 2기간</button><button type="button" disabled={busy||historyPage===0} onClick={()=>{setHistoryPage(page=>page-1);setDetail(null);}}>다음 2기간</button></>}
        <button type="button" disabled={busy} onClick={()=>{setShowAllHistory(!showAllHistory);setHistoryPage(0);setDetail(null);}}>{showAllHistory?'최근 2기간 보기':'전체 이력 보기'}</button>
      </div>}</div>
      <div className={styles.salesSummary} aria-label="표시기간 매출 요약"><span>표시기간 공급가 <strong>{fmt(matrix.supplyAmount)}원</strong></span><span>VAT <strong>{fmt(matrix.vatAmount)}원</strong></span><span>합계(VAT 포함) <strong>{fmt(matrix.totalAmount)}원</strong></span></div>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="주차별 품목 수량 및 매출표"><table className={styles.matrix}>
        <caption className={styles.srOnly}>품목별 일별 수량, 주차별 원차수 구성과 매출금액. 수량을 누르면 출고일·단가 상세.</caption>
        <thead><tr><th rowSpan={2} className={styles.productHead}>품목</th><th rowSpan={2} className={styles.unitHead}>단위</th><th rowSpan={2} className={styles.priceHead}>판매단가<br/>(VAT 포함)</th>{matrix.weeks.map((week,i)=><th key={week.startDate} colSpan={week.dates.length+2} scope="colgroup" className={styles.weekHead}>
          {week.startDate.slice(5).replace('-','/')} ~ {week.endDate.slice(5).replace('-','/')}<span>원차수 {week.sources.map(shortWeek).join(' / ')||'—'}</span>
        </th>)}</tr><tr>{matrix.weeks.flatMap(week=>[...week.dates.map(date=><th key={date} scope="col" className={styles.dayHead}>{DAYS[new Date(date+'T00:00:00Z').getUTCDay()]}<span>{Number(date.slice(5,7))}/{Number(date.slice(8))}</span></th>),<th key={week.startDate+'-qty'} scope="col" className={styles.quantityHead}>합계수량 · 차수 구성</th>,<th key={week.startDate+'-money'} scope="col" className={styles.amountHead}>매출금액</th>])}</tr></thead>
        <tbody>{matrix.rows.map(row=>{const prices=storedPriceBuckets(row);return <tr key={row.key} className={row.kind==='adjustment'?styles.adjustment:''}><th scope="row" className={styles.productName}>{row.prodName}{row.kind==='adjustment'&&<span className={styles.badge}>견적 조정</span>}</th><td className={styles.unit}>{row.unit}</td><td className={styles.price} aria-label={`${row.prodName} ${row.kind==='adjustment'?'견적 조정':'출고'} 저장 판매단가`}>{prices.map(price=><div key={price.cost}>{fmt(price.cost)}원{prices.length>1&&<small> ({fmt(price.quantity)}{row.unit})</small>}</div>)}</td>{row.weeks.flatMap((week,i)=>[
          ...week.cells.map(cell=><td key={cell.date} className={styles.number}>{cell.details.length?<button type="button" className={styles.cell} aria-label={`${row.prodName} ${cell.date} 수량 ${fmt(cell.quantity)}${row.unit} 상세`} onClick={e=>{detailOrigin.current=e.currentTarget;setDetail({row,cell});}}>{fmt(cell.quantity)}</button>:'—'}</td>),
          <td key={i+'-qty'} className={styles.source}>{week.product?quantityFormula(week.product):'—'}</td>,<td key={i+'-money'} className={styles.number}>{week.product?fmt(week.product.amount+week.product.vat):'—'}</td>
        ])}</tr>})}</tbody>
        <tfoot><tr><th colSpan={3} className={styles.footerLabel}>일별 매출 (VAT 포함)</th>{matrix.weeks.flatMap(week=>[...week.dailyAmounts.map((amount,i)=><td key={week.dates[i]} className={styles.number}>{fmt(amount)}</td>),<td key={week.startDate+'-units'} className={styles.source}>출고 {week.quantities.map(q=>fmt(q.quantity)+q.unit).join(' / ')||'—'}</td>,<td key={week.startDate+'-total'} className={styles.number}>{fmt(week.totalAmount)}</td>])}</tr>
          <tr className={styles.weekTotal}><th colSpan={3} className={styles.footerLabel}>주차별 매출 합계</th>{matrix.weeks.map(week=><td key={week.startDate} colSpan={week.dates.length+2}>{fmt(week.totalAmount)}원{week.adjustmentAmount!==0&&<small> (견적 조정 {fmt(week.adjustmentAmount)}원 포함)</small>}</td>)}</tr></tfoot>
      </table></div>
      {!matrix.rows.length&&<p>선택 범위의 확정 출고·견적 조정 내역이 없습니다.</p>}
    </>}
    {detail&&<section className={styles.detailPanel} aria-label="출고일 단가 상세" onKeyDown={e=>{if(e.key==='Escape'){setDetail(null);detailOrigin.current?.focus();}}}>
      <strong>{detail.row.prodName} · {detail.cell.date} · {fmt(detail.cell.quantity)}{detail.row.unit}</strong><button type="button" autoFocus onClick={()=>{setDetail(null);detailOrigin.current?.focus();}}>상세 닫기</button>
      {detail.cell.details.map(d=><p key={d.rowKey}>{shortWeek(d.orderWeek)}차 · {fmt(d.quantity)}{detail.row.unit} × 단가 {fmt(d.cost)}원 · 매출 {fmt(d.amount+d.vat)}원</p>)}
    </section>}
    {periods.length > 0 && showAllHistory && currentScope.current?.mode === 'history' && <button type="button" className={styles.more} disabled={busy} onClick={()=>loadOlder()}>{busy ? '조회 중…' : '이전 12개 정산 기간 더 보기'}</button>}
  </section>;
}
