import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import * as XLSXStyled from 'xlsx-js-style';
import { appendDutchPriceSheet, parseDutchPivotWorkbook, priceProgress } from '../../lib/dutchVolumePrice';

const STORAGE_PREFIX = 'nenova.dutch-volume-prices.v1:';
const customerName = value => String(value || '').split('\n')[0].trim();

export default function DutchVolumeBoard() {
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [entries, setEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [currency, setCurrency] = useState('EUR');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const inputRefs = useRef([]);
  const progress = useMemo(() => priceProgress(entries, prices), [entries, prices]);
  const visibleEntries = useMemo(() => { const token = query.trim().toLowerCase(); return token ? entries.filter(row => `${row.customer} ${row.product} ${row.color}`.toLowerCase().includes(token)) : entries; }, [entries, query]);

  useEffect(() => { if (storageKey && entries.length) localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify({ prices, currency })); }, [storageKey, entries.length, prices, currency]);

  async function upload(file) {
    setError('');
    try {
      const nextWorkbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSX, nextWorkbook);
      const nextStorageKey = `${file.name}:${file.size}:${file.lastModified}`;
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${nextStorageKey}`) || '{}');
      setWorkbook(nextWorkbook); setFileName(file.name); setStorageKey(nextStorageKey); setEntries(parsed.entries); setPrices(saved.prices || {}); setCurrency(saved.currency === 'KRW' ? 'KRW' : 'EUR');
    } catch (uploadError) {
      setWorkbook(null); setEntries([]); setPrices({}); setError(uploadError.message || '엑셀 파일을 읽지 못했습니다.');
    }
  }

  function updatePrice(id, value) {
    const normalized = value === '' ? '' : Math.max(0, Number(value));
    setPrices(previous => ({ ...previous, [id]: Number.isFinite(normalized) ? normalized : '' }));
  }
  function moveNext(event, index) { if (event.key === 'Enter') { event.preventDefault(); inputRefs.current[index + 1]?.focus(); inputRefs.current[index + 1]?.select(); } }
  function download() {
    if (!workbook) return;
    appendDutchPriceSheet(XLSXStyled, workbook, entries, prices, currency);
    XLSXStyled.writeFile(workbook, `${fileName.replace(/\.xlsx?$/i, '')}_단가입력.xlsx`, { compression: true });
  }

  return <><Head><title>네덜란드 물량표 - nenova ERP</title></Head><section className="dutch-board">
    <header><div><h1>네덜란드 물량표</h1><p>Pivot 통계에서 만든 네덜란드 엑셀을 올리고 업체·품목별 단가를 연속 입력합니다.</p></div><label className="upload">엑셀 업로드<input type="file" accept=".xlsx,.xls" onChange={event => event.target.files?.[0] && upload(event.target.files[0])}/></label></header>
    {error && <div className="notice error">{error}</div>}
    {!entries.length && !error && <div className="empty"><b>네덜란드 Pivot 엑셀을 올려주세요.</b><span>원본 수량과 계산식은 바꾸지 않고, 내려받는 파일에 NL_단가표 시트를 추가합니다.</span></div>}
    {!!entries.length && <><div className="toolbar"><div><b>{fileName}</b><span>단가 입력 {progress.completed}/{progress.total} · 미입력 {progress.pending}</span></div><input aria-label="업체·품목 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="업체·품목 검색"/><select aria-label="통화" value={currency} onChange={event => setCurrency(event.target.value)}><option>EUR</option><option>KRW</option></select><button onClick={download}>단가표 엑셀 저장</button></div>
      <div className="guide"><b>입력 방법</b><span>단가 입력 후 Enter를 누르면 다음 수량의 단가 칸으로 이동합니다. 파란색은 완료, 주황색은 미입력입니다.</span></div>
      <div className="grid-wrap"><table><colgroup><col className="product"/><col className="color"/><col className="customer"/><col className="qty"/><col className="price"/><col className="amount"/></colgroup><thead><tr><th>품목</th><th>칼라</th><th>업체</th><th>수량</th><th>단가 ({currency})</th><th>금액</th></tr></thead><tbody>{visibleEntries.map((row, index) => { const price = Number(prices[row.id] || 0); return <tr key={row.id} className={price > 0 ? 'done' : 'pending'}><td title={row.product}>{row.product}</td><td>{row.color || '-'}</td><td title={row.customer}>{customerName(row.customer)}</td><td><strong>{row.quantity.toLocaleString()}</strong>{price > 0 && <small>@ {price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</small>}</td><td><input ref={node => { inputRefs.current[index] = node; }} aria-label={`${customerName(row.customer)} ${row.product} 단가`} type="number" min="0" step="any" value={prices[row.id] ?? ''} onChange={event => updatePrice(row.id, event.target.value)} onKeyDown={event => moveNext(event, index)} placeholder="단가 입력"/></td><td>{price > 0 ? (row.quantity * price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</td></tr>; })}</tbody></table></div>
    </>}
  </section><style jsx>{`.dutch-board{padding:14px;background:#eef2f7;min-height:calc(100vh - 44px);color:#172033}header{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#102d72,#1676b8);color:#fff;padding:14px 18px;border-radius:5px}h1{font-size:20px;margin:0 0 4px}header p{margin:0;font-size:12px;opacity:.9}.upload{background:#fff;color:#164c94;padding:8px 14px;border-radius:4px;font-weight:800;cursor:pointer}.upload input{display:none}.empty,.notice{margin-top:12px;padding:32px;background:#fff;border:1px solid #c9d4e3;border-radius:5px;display:flex;flex-direction:column;gap:7px;text-align:center}.error{color:#a61b14;background:#fff1ef}.toolbar{display:flex;gap:8px;align-items:center;margin-top:10px;padding:9px;background:#fff;border:1px solid #c9d4e3}.toolbar>div{display:flex;flex-direction:column;margin-right:auto}.toolbar span{font-size:11px;color:#617188}.toolbar input{width:240px}.toolbar input,.toolbar select,.toolbar button{height:32px;border:1px solid #aebbd0;border-radius:3px;padding:0 9px}.toolbar button{background:#155bd7;color:#fff;font-weight:800}.guide{margin:7px 0;padding:8px 10px;background:#e8f1ff;border:1px solid #a8c7ef;font-size:12px}.guide b{margin-right:12px}.grid-wrap{overflow:auto;max-height:calc(100vh - 220px);background:#fff;border:1px solid #bfcada}table{border-collapse:collapse;width:auto;min-width:900px;font-size:12px}col.product{width:360px}col.color{width:110px}col.customer{width:210px}col.qty{width:105px}col.price{width:150px}col.amount{width:130px}th{position:sticky;top:0;z-index:2;background:#dce6f4;color:#16335e}th,td{height:38px;padding:5px 8px;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}td:nth-child(n+4){text-align:right}.pending{background:#fffaf0}.done{background:#f5fbff}td small{display:block;color:#0c65b5;font-weight:800}td input{width:125px;height:28px;border:2px solid #e1a647;border-radius:3px;text-align:right;padding:0 6px;font-weight:800}tr.done td input{border-color:#3c8bd1;background:#f1f8ff}td input:focus{outline:3px solid #9ecbff;border-color:#155bd7}@media(max-width:760px){.dutch-board{padding:7px}header{align-items:flex-start;gap:10px}header p{display:none}.toolbar{flex-wrap:wrap}.toolbar>div{width:100%}.toolbar input{flex:1;width:auto}.grid-wrap{max-height:calc(100vh - 240px)}}`}</style></>;
}
