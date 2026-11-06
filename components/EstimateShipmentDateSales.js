import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/useApi';
import { quantityFormula, settlementPeriods, shortWeek, weekdayValue } from '../lib/estimateShipmentDateSales';
import WorkflowGuide from './WorkflowGuide';
import styles from './EstimateShipmentDateSales.module.css';

const PAGE = 'estimate-shipment-date-sales';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
function favoriteValue(favorite) {
  const value = JSON.parse(favorite.FilterData);
  if (!Number.isInteger(value.custKey) || value.custKey <= 0 || typeof value.custName !== 'string') throw Error('저장된 업체 기준이 올바르지 않습니다. 다시 저장하세요.');
  return { ...value, startDay: weekdayValue(value.startDay), endDay: weekdayValue(value.endDay) };
}

export default function EstimateShipmentDateSales() {
  const [customers, setCustomers] = useState([]), [favorites, setFavorites] = useState([]);
  const [custKey, setCustKey] = useState(''), [startDay, setStartDay] = useState(1), [endDay, setEndDay] = useState(5);
  const [favoriteKey, setFavoriteKey] = useState(null), [mode, setMode] = useState('history');
  const [anchor, setAnchor] = useState(today), [startDate, setStartDate] = useState(() => settlementPeriods(today(), 1, 5, 1)[0].startDate), [endDate, setEndDate] = useState(today);
  const [periods, setPeriods] = useState([]), [resultLabel, setResultLabel] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const requestId = useRef(0), currentScope = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all([apiGet('/api/customers/search'), apiGet('/api/favorites', { page: PAGE })]).then(([c, f]) => {
      if (active) { setCustomers(c.customers ?? []); setFavorites(f.favorites ?? []); setReady(true); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; requestId.current++; };
  }, []);
  function invalidate() { requestId.current++; setBusy(false); setPeriods([]); setResultLabel(''); currentScope.current = null; setError(''); setNotice(''); }
  function parameters() { return mode === 'history' ? { custKey, mode, anchor, startDay, endDay } : { custKey, mode, startDate, endDate }; }
  async function load(scope, append = false, name) {
    const id = ++requestId.current;
    setError(''); setNotice(''); setBusy(true);
    if (!append) setPeriods([]);
    try {
      const data = await apiGet('/api/estimate/shipment-date-sales', scope);
      if (id !== requestId.current) return;
      currentScope.current = scope;
      setPeriods(previous => append ? [...previous, ...data.periods] : data.periods);
      setResultLabel(name ?? customers.find(c => String(c.CustKey) === String(scope.custKey))?.CustName ?? '선택 업체');
    } catch (e) { if (id === requestId.current) setError(e.message); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function chooseFavorite(favorite) {
    try {
      const value = favoriteValue(favorite);
      invalidate(); setFavoriteKey(favorite.FavoriteKey); setCustKey(String(value.custKey)); setStartDay(value.startDay); setEndDay(value.endDay); setMode('history'); setAnchor(today());
      load({ custKey: value.custKey, mode: 'history', startDay: value.startDay, endDay: value.endDay, anchor: today() }, false, value.custName);
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
  const options = customers.filter(c => !search || c.CustName?.toLowerCase().includes(search.toLowerCase()) || String(c.CustKey) === custKey);
  return <section className={styles.root} aria-label="출고일 기준 매출">
    <div className={styles.heading}><div><h2>출고일 기준 매출</h2><p>입고 차수와 관계없이 지정한 출고일의 확정 견적 수량과 매출을 확인합니다.</p></div><WorkflowGuide workflowId="estimate-shipment-date-sales" /></div>
    <div className={styles.favorites} aria-label="업체별 정산 즐겨찾기">
      <strong>업체 즐겨찾기</strong>
      {favorites.map(f => <button type="button" className={favoriteKey === f.FavoriteKey ? styles.selected : ''} key={f.FavoriteKey} onClick={() => chooseFavorite(f)} disabled={saving}>{f.FavName}</button>)}
      {ready && !favorites.length && <span>업체와 정산 요일을 저장하면 한 번에 과거 기간까지 조회할 수 있습니다.</span>}
    </div>
    <form className={styles.form} onSubmit={e => { e.preventDefault(); load(parameters()); }}>
      <label>업체 검색<input aria-label="출고 매출 업체 검색" value={search} onChange={e => setSearch(e.target.value)} placeholder="업체명 검색" /></label>
      <label>업체<select aria-label="출고 매출 업체" value={custKey} onChange={e => { invalidate(); setCustKey(e.target.value); setFavoriteKey(null); }} required disabled={!ready || saving}><option value="">업체 선택</option>{options.map(c => <option key={c.CustKey} value={c.CustKey}>{c.CustName}</option>)}</select></label>
      <label>정산 시작 요일<select aria-label="정산 시작 요일" value={startDay} disabled={saving} onChange={e => { invalidate(); setStartDay(Number(e.target.value)); }}>{DAYS.map((d,i) => <option key={d} value={i}>{d}요일</option>)}</select></label>
      <label>정산 종료 요일<select aria-label="정산 종료 요일" value={endDay} disabled={saving} onChange={e => { invalidate(); setEndDay(Number(e.target.value)); }}>{DAYS.map((d,i) => <option key={d} value={i}>{d}요일</option>)}</select></label>
      <button type="button" onClick={saveFavorite} disabled={!custKey || saving || !ready}>{saving ? '저장 중…' : favoriteKey ? '즐겨찾기 기준 수정' : '즐겨찾기 저장'}</button>
      {favoriteKey && <><button type="button" disabled={saving} onClick={removeFavorite}>즐겨찾기 삭제</button><button type="button" disabled={saving} onClick={() => { setFavoriteKey(null); setNotice('새 기준으로 저장할 수 있습니다.'); }}>새 즐겨찾기로 저장하기</button></>}
      <div className={styles.break} />
      <label>조회 방식<select aria-label="출고 매출 조회 방식" value={mode} onChange={e => { invalidate(); setMode(e.target.value); }}><option value="history">정산 기간별 과거 이력</option><option value="range">직접 기간 선택</option></select></label>
      {mode === 'history' ? <label>기준일<input aria-label="정산 기준일" type="date" required value={anchor} onChange={e => { invalidate(); setAnchor(e.target.value); }} /></label> : <><label>시작일<input aria-label="출고 매출 시작일" type="date" required value={startDate} onChange={e => { invalidate(); setStartDate(e.target.value); }} /></label><label>종료일<input aria-label="출고 매출 종료일" type="date" required value={endDate} min={startDate} onChange={e => { invalidate(); setEndDate(e.target.value); }} /></label></>}
      <button type="submit" className={styles.primary} disabled={busy || !custKey || !ready}>{busy ? '조회 중…' : '조회'}</button>
    </form>
    <p className={styles.help}>금액은 부가세 포함입니다. 정상 출고는 지정된 출고일 기준, 불량차감·판매요청 등 견적 조정은 등록된 적용일 기준으로 별도 표시합니다. 수량은 견적 단위별로 구분합니다. 기존 차수 집계는 유지됩니다.</p>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status">{notice}</div>}
    <div aria-live="polite">{busy && '출고일 매출을 조회하고 있습니다.'}{!busy && !periods.length && !error && '업체와 기간을 선택하거나 즐겨찾기 업체를 눌러 조회하세요.'}</div>
    {periods.length > 0 && <h3>{resultLabel} · {mode === 'history' ? `${DAYS[startDay]}요일~${DAYS[endDay]}요일 정산` : '선택 기간 매출'}</h3>}
    {periods.map((period, index) => <article className={styles.period} key={period.startDate}>
      <div className={styles.periodHeading}><h3>{period.startDate} ~ {period.endDate}</h3><strong>매출 {fmt(period.totalAmount)}원</strong></div>
      <p>판매수량 {period.quantities.map(q => `${fmt(q.quantity)}${q.unit}`).join(' · ') || '0'}{period.adjustmentAmount !== 0 && ` / 견적 조정 ${fmt(period.adjustmentAmount)}원 포함`}</p>
      {!period.products.length ? <p className={styles.help}>해당 기간의 확정 출고·견적 조정 내역이 없습니다.</p> : <details open={index === 0}>
        <summary>품목별 수량·차수 구성 보기 ({period.products.length}개 항목)</summary>
        <div className={styles.tableWrap}><table><thead><tr><th>구분</th><th>품목</th><th>단위</th><th>합계수량 = 원차수별 수량</th><th>매출금액(VAT 포함)</th><th>출고일·단가 상세</th></tr></thead><tbody>
          {period.products.map(product => <tr key={product.key}><td>{product.kind === 'adjustment' ? '견적 조정' : '출고'}</td><td>{product.prodName}</td><td>{product.unit}</td><td>{quantityFormula(product)}</td><td className={styles.number}>{fmt(product.amount + product.vat)}원</td><td><details><summary>상세 {product.details.length}건</summary>{product.details.map(d => <div className={styles.detail} key={`${d.rowKey}-${d.date}`}>{d.date} · {shortWeek(d.orderWeek)}차 · {fmt(d.quantity)}{product.unit} × 단가 {fmt(d.cost)}원 · 매출 {fmt(d.amount + d.vat)}원</div>)}</details></td></tr>)}
        </tbody></table></div>
      </details>}
    </article>)}
    {periods.length > 0 && currentScope.current?.mode === 'history' && <button type="button" className={styles.more} disabled={busy} onClick={() => {
      const oldest = periods.at(-1).startDate;
      const previous = new Date(oldest + 'T00:00:00Z'); previous.setUTCDate(previous.getUTCDate() - 7);
      load({ ...currentScope.current, anchor: previous.toISOString().slice(0,10) }, true, resultLabel);
    }}>{busy ? '조회 중…' : '이전 12개 정산 기간 더 보기'}</button>}
  </section>;
}
