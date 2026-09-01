import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSXStyled from 'xlsx-js-style';
import { apiGet } from '../../lib/useApi';
import { addDutchPriceColumns, buildDutchEntriesFromPivotData, dutchEntryPrice, dutchPriceKey, isDutchIndividualPriceCustomer, migrateDutchPriceDraft, parseDutchPivotWorkbook, priceProgress } from '../../lib/dutchVolumePrice';
import { addDutchPriceShapesToXlsx } from '../../lib/dutchPriceShapes';

const STORAGE_PREFIX = 'nenova.dutch-volume-prices.v1:';
const customerName = value => String(value || '').split('\n')[0].trim();
const currentYear = new Date().getFullYear();

export default function DutchVolumeBoard() {
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [entries, setEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [currency, setCurrency] = useState('EUR');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState('35-01');
  const [availableWeeks, setAvailableWeeks] = useState([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState('');
  const inputRefs = useRef([]);
  const progress = useMemo(() => priceProgress(entries, prices), [entries, prices]);
  const visibleEntries = useMemo(() => { const token = query.trim().toLowerCase(); return token ? entries.filter(row => `${row.customer} ${row.product} ${row.color}`.toLowerCase().includes(token)) : entries; }, [entries, query]);

  useEffect(() => { if (storageKey && entries.length) localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify({ prices, currency })); }, [storageKey, entries.length, prices, currency]);
  useEffect(() => {
    let active = true;
    async function loadRecordedWeeks() {
      setWeeksLoading(true); setError('');
      try {
        const result = await apiGet('/api/stats/pivot-weeks', { orderYear: year, source: 'orders' });
        if (!active) return;
        const recorded = Array.isArray(result.weeks) ? result.weeks : [];
        setAvailableWeeks(recorded);
        if (!recorded.length) {
          setWorkbook(null); setEntries([]); setPrices({}); setSourceMode('');
          setError(`${year}년 DB 입력 차수가 없습니다.`);
          return;
        }
        const selectedWeek = recorded.includes(week) ? week : recorded[0];
        setWeek(selectedWeek);
        await loadLive(year, selectedWeek);
      } catch (loadError) {
        if (active) setError(loadError.message || 'DB 입력 차수 목록을 불러오지 못했습니다.');
      } finally {
        if (active) setWeeksLoading(false);
      }
    }
    loadRecordedWeeks();
    return () => { active = false; };
  }, [year]);

  async function loadLive(selectedYear = year, selectedWeek = week) {
    setLoading(true); setError('');
    try {
      const result = await apiGet('/api/stats/pivot-data', { orderYear: selectedYear, weekStart: selectedWeek, weekEnd: selectedWeek });
      const liveEntries = buildDutchEntriesFromPivotData(result, selectedYear, selectedWeek);
      if (!liveEntries.length) throw new Error(`${selectedYear}년 ${selectedWeek} 네덜란드 업체별 주문수량이 없습니다.`);
      const params = new URLSearchParams({ orderYear: String(selectedYear), weekStart: selectedWeek, weekEnd: selectedWeek, species: 'country:네덜란드' });
      const volumeResponse = await fetch(`/api/stats/pivot-volume-excel?${params.toString()}`, { credentials: 'same-origin' });
      if (!volumeResponse.ok) {
        const detail = await volumeResponse.json().catch(() => ({}));
        throw new Error(detail.error || 'Pivot 물량표 원본 엑셀을 만들지 못했습니다.');
      }
      const nextWorkbook = XLSXStyled.read(await volumeResponse.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      const nextStorageKey = `live:${selectedYear}:${selectedWeek}`;
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${nextStorageKey}`) || '{}');
      setWorkbook(nextWorkbook); setFileName(`${selectedWeek.replace(/-/g, '')}_네덜란드.xlsx`); setStorageKey(nextStorageKey); setEntries(parsed.entries); setPrices(migrateDutchPriceDraft(parsed.entries, saved.prices || {})); setCurrency(saved.currency === 'KRW' ? 'KRW' : 'EUR'); setSourceMode('LIVE');
    } catch (loadError) {
      setWorkbook(null); setEntries([]); setPrices({}); setSourceMode(''); setError(loadError.message || '네덜란드 물량표 조회에 실패했습니다.');
    } finally { setLoading(false); }
  }

  function stepWeek(delta) {
    if (!availableWeeks.length) return;
    const currentIndex = availableWeeks.indexOf(week);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(availableWeeks.length - 1, baseIndex - delta));
    setWeek(availableWeeks[nextIndex]);
  }

  async function upload(file) {
    setError('');
    try {
      const nextWorkbook = XLSXStyled.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      const nextStorageKey = `${file.name}:${file.size}:${file.lastModified}`;
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${nextStorageKey}`) || '{}');
      setWorkbook(nextWorkbook); setFileName(file.name); setStorageKey(nextStorageKey); setEntries(parsed.entries); setPrices(migrateDutchPriceDraft(parsed.entries, saved.prices || {})); setCurrency(saved.currency === 'KRW' ? 'KRW' : 'EUR'); setSourceMode('UPLOAD');
    } catch (uploadError) {
      setWorkbook(null); setEntries([]); setPrices({}); setError(uploadError.message || '엑셀 파일을 읽지 못했습니다.');
    }
  }

  function updatePrice(entry, value) {
    const normalized = value === '' ? '' : Math.max(0, Number(value));
    setPrices(previous => ({ ...previous, [dutchPriceKey(entry)]: Number.isFinite(normalized) ? normalized : '' }));
  }
  function moveNext(event, index) { if (event.key === 'Enter') { event.preventDefault(); inputRefs.current[index + 1]?.focus(); inputRefs.current[index + 1]?.select(); } }
  async function download() {
    if (!workbook) return;
    const priced = addDutchPriceColumns(XLSXStyled, workbook, entries, prices, currency);
    const base = XLSXStyled.write(priced.workbook, { type: 'array', bookType: 'xlsx', compression: true });
    const shaped = await addDutchPriceShapesToXlsx(XLSXStyled, base, priced.workbook, entries, prices);
    const url = URL.createObjectURL(new Blob([shaped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${fileName.replace(/\.xlsx?$/i, '')}_단가입력.xlsx`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <><Head><title>네덜란드 물량표 - nenova ERP</title></Head><section className="dutch-board">
    <header><div><h1>네덜란드 물량표</h1><p>네노바웹 물량을 바로 조회하거나 Pivot 엑셀을 올려 업체·품목별 단가를 연속 입력합니다.</p></div><label className="upload">엑셀 업로드<input type="file" accept=".xlsx,.xls" onChange={event => event.target.files?.[0] && upload(event.target.files[0])}/></label></header>
    <div className="live-load"><label>연도<input aria-label="연도" type="number" min="2000" max="2100" value={year} onChange={event => setYear(Number(event.target.value))}/></label><label>DB 입력 차수<div><button aria-label="이전 입력 차수" onClick={() => stepWeek(-1)} disabled={weeksLoading || !availableWeeks.length}>‹</button><select aria-label="차수" value={week} onChange={event => setWeek(event.target.value)} disabled={weeksLoading || !availableWeeks.length}>{weeksLoading && <option value="">조회 중…</option>}{!weeksLoading && !availableWeeks.length && <option value="">입력 이력 없음</option>}{availableWeeks.map(recordedWeek => <option key={recordedWeek} value={recordedWeek}>{recordedWeek}</option>)}</select><button aria-label="다음 입력 차수" onClick={() => stepWeek(1)} disabled={weeksLoading || !availableWeeks.length}>›</button></div></label><button className="load" onClick={() => loadLive(year, week)} disabled={loading || weeksLoading || !availableWeeks.length}>{loading ? '조회 중…' : '네노바웹 물량 바로 불러오기'}</button><span>DB에 실제 입력된 세부차수만 표시하며 선택 연도·차수 주문수량을 읽습니다.</span></div>
    {error && <div className="notice error">{error}</div>}
    {!entries.length && !error && <div className="empty"><b>연도·차수를 조회하거나 네덜란드 Pivot 엑셀을 올려주세요.</b><span>전산은 읽기만 하며 입력 단가는 ERP 원장에 저장하지 않습니다. 저장 엑셀은 Pivot 물량표 원본 디자인을 유지하고 수량 셀 안에 단가를 함께 표시합니다.</span></div>}
    {!!entries.length && <><div className="toolbar"><div><b>{sourceMode === 'LIVE' ? `네노바웹 ${year}년 ${week} 직접 조회` : fileName}</b><span>단가 입력 {progress.completed}/{progress.total} · 미입력 {progress.pending}</span></div><input aria-label="업체·품목 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="업체·품목 검색"/><select aria-label="통화" value={currency} onChange={event => setCurrency(event.target.value)}><option>EUR</option><option>KRW</option></select><button onClick={download}>단가표 엑셀 저장</button></div>
      <div className="guide"><b>입력 방법</b><span>주광은 업체별 단가를 입력합니다. 주광 외 업체는 같은 품목·칼라의 균일가가 전체 업체에 함께 적용됩니다. Enter를 누르면 다음 단가 칸으로 이동합니다.</span></div>
      <div className="grid-wrap"><table><colgroup><col className="product"/><col className="color"/><col className="customer"/><col className="qty"/><col className="price"/><col className="amount"/></colgroup><thead><tr><th>품목</th><th>칼라</th><th>업체</th><th>수량</th><th>단가 ({currency})</th><th>금액</th></tr></thead><tbody>{visibleEntries.map((row, index) => { const price = dutchEntryPrice(row, prices); const individual = isDutchIndividualPriceCustomer(row.customer); return <tr key={row.id} className={price > 0 ? 'done' : 'pending'}><td title={row.product}>{row.product}</td><td>{row.color || '-'}</td><td title={row.customer}>{customerName(row.customer)}<small className={individual ? 'individual-price' : 'uniform-price'}>{individual ? '주광 개별단가' : '품목 균일가'}</small></td><td><strong>{row.quantity.toLocaleString()}</strong>{price > 0 && <small>{price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</small>}</td><td><input ref={node => { inputRefs.current[index] = node; }} aria-label={`${customerName(row.customer)} ${row.product} ${individual ? '개별단가' : '균일가'}`} type="number" min="0" step="any" value={prices[dutchPriceKey(row)] ?? ''} onChange={event => updatePrice(row, event.target.value)} onKeyDown={event => moveNext(event, index)} placeholder={individual ? '주광 단가' : '품목 균일가'}/></td><td>{price > 0 ? (row.quantity * price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</td></tr>; })}</tbody></table></div>
    </>}
  </section><style jsx>{`.dutch-board{padding:14px;background:#eef2f7;min-height:calc(100vh - 44px);color:#172033}header{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#102d72,#1676b8);color:#fff;padding:14px 18px;border-radius:5px}h1{font-size:20px;margin:0 0 4px}header p{margin:0;font-size:12px;opacity:.9}.upload{background:#fff;color:#164c94;padding:8px 14px;border-radius:4px;font-weight:800;cursor:pointer}.upload input{display:none}.live-load{display:flex;align-items:end;gap:8px;padding:10px;margin-top:8px;background:#fff;border:1px solid #c9d4e3}.live-load label{font-size:11px;font-weight:800}.live-load label>input{display:block;width:82px}.live-load label div{display:flex}.live-load input,.live-load select,.live-load button{height:31px;border:1px solid #aebbd0;padding:0 7px}.live-load label div select{width:86px;text-align:center;font-weight:800}.live-load .load{background:#148044;color:#fff;font-weight:800;border-color:#148044}.live-load span{color:#617188;font-size:11px;margin-left:5px}.empty,.notice{margin-top:12px;padding:32px;background:#fff;border:1px solid #c9d4e3;border-radius:5px;display:flex;flex-direction:column;gap:7px;text-align:center}.error{color:#a61b14;background:#fff1ef}.toolbar{display:flex;gap:8px;align-items:center;margin-top:10px;padding:9px;background:#fff;border:1px solid #c9d4e3}.toolbar>div{display:flex;flex-direction:column;margin-right:auto}.toolbar span{font-size:11px;color:#617188}.toolbar input{width:240px}.toolbar input,.toolbar select,.toolbar button{height:32px;border:1px solid #aebbd0;border-radius:3px;padding:0 9px}.toolbar button{background:#155bd7;color:#fff;font-weight:800}.guide{margin:7px 0;padding:8px 10px;background:#e8f1ff;border:1px solid #a8c7ef;font-size:12px}.guide b{margin-right:12px}.grid-wrap{overflow:auto;max-height:calc(100vh - 270px);background:#fff;border:1px solid #bfcada}table{border-collapse:collapse;width:auto;min-width:900px;font-size:12px}col.product{width:360px}col.color{width:110px}col.customer{width:210px}col.qty{width:105px}col.price{width:150px}col.amount{width:130px}th{position:sticky;top:0;z-index:2;background:#dce6f4;color:#16335e}th,td{height:38px;padding:5px 8px;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}td:nth-child(n+4){text-align:right}.pending{background:#fffaf0}.done{background:#f5fbff}td small{display:block;color:#0c65b5;font-weight:800}.uniform-price{color:#168447}.individual-price{color:#7a45b8}td input{width:125px;height:28px;border:2px solid #e1a647;border-radius:3px;text-align:right;padding:0 6px;font-weight:800}tr.done td input{border-color:#3c8bd1;background:#f1f8ff}td input:focus{outline:3px solid #9ecbff;border-color:#155bd7}@media(max-width:760px){.dutch-board{padding:7px}header{align-items:flex-start;gap:10px}header p{display:none}.live-load{flex-wrap:wrap}.live-load span{width:100%}.toolbar{flex-wrap:wrap}.toolbar>div{width:100%}.toolbar input{flex:1;width:auto}.grid-wrap{max-height:calc(100vh - 300px)}}`}</style></>;
}
