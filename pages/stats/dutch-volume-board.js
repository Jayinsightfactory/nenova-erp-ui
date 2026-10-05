import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSXStyled from 'xlsx-js-style';
import { apiGet } from '../../lib/useApi';
import { addDutchPriceColumns, buildDutchEntriesFromPivotData, dutchPriceKey, isDutchIndividualPriceCustomer, migrateDutchPriceDraft, parseDutchPivotWorkbook } from '../../lib/dutchVolumePrice';
import { addDutchPriceShapesToXlsx } from '../../lib/dutchPriceShapes';
import { buildDutchPreviewEntries, dutchPreviewRowKind, editDutchDraftEntry, isDutchPreviewCurrent, newDutchDraftEntry, readDutchDraft, writeDutchDraft } from '../../lib/dutchVolumeDraft';
import ErpMatchPicker from '../../components/dutch/ErpMatchPicker';

const customerName = value => String(value || '').split('\n')[0].trim();
const fmt = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const currentYear = new Date().getFullYear();
const requestHeaders = { 'Content-Type': 'application/json' };
const num = value => Number(value ?? 0);

function withEditedWorkbook(workbook, entries, prices) {
  const copy = { ...workbook, SheetNames: [...workbook.SheetNames], Sheets: { ...workbook.Sheets } };
  const touched = new Set();
  for (const entry of entries) {
    if (entry.added || !entry.sheetName || !entry.cellAddress || !copy.Sheets[entry.sheetName]) continue;
    if (!touched.has(entry.sheetName)) { copy.Sheets[entry.sheetName] = { ...copy.Sheets[entry.sheetName] }; touched.add(entry.sheetName); }
    const sheet = copy.Sheets[entry.sheetName];
    sheet[entry.cellAddress] = { ...(sheet[entry.cellAddress] || {}), t: 'n', v: Number(entry.quantity) };
  }
  const added = entries.filter(entry => entry.added);
  const rematched = entries.some(entry => Number(entry.custKey) > 0 || Number(entry.prodKey) > 0);
  if (added.length || rematched) {
    const sheetName = 'ERP적용초안';
    if (!copy.SheetNames.includes(sheetName)) copy.SheetNames.push(sheetName);
    copy.Sheets[sheetName] = XLSXStyled.utils.aoa_to_sheet([
      ['ERP 적용 초안 — 원본 Pivot 셀 및 도형은 별도 보존'],
      ['업체', '업체키', '품목', '품목키', '수량', '단위', '원화 단가(빈칸=기존값 보존)', '원본 위치'],
      ...entries.map(entry => [entry.customer, entry.custKey || '', entry.product, entry.prodKey || '', Number(entry.quantity), entry.unit || 'ERP 출고단위', prices[dutchPriceKey(entry)] ?? '', entry.added ? '수동 추가행' : `${entry.sheetName}!${entry.cellAddress}`]),
    ]);
  }
  return copy;
}

export default function DutchVolumeBoard() {
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [entries, setEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [legacyCurrency, setLegacyCurrency] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState('35-01');
  const [availableWeeks, setAvailableWeeks] = useState([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState('');
  const [preview, setPreview] = useState(null);
  const [matchCache, setMatchCache] = useState({});
  const [customerOptions, setCustomerOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ackReplacement, setAckReplacement] = useState(false);
  const [ackQtyWarnings, setAckQtyWarnings] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [activeJobId, setActiveJobId] = useState('');
  const inputRefs = useRef([]);
  const revisionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const sourceRef = useRef('');
  const sourceModeRef = useRef('');
  const applyingRef = useRef(false);
  const previewCurrent = !loading && isDutchPreviewCurrent(preview, revisionRef.current, year, week, storageKey);
  const previewRows = preview?.rows || [];
  const missingRows = previewRows.filter(row => row.missingFromExcel);
  const blockedRows = previewRows.filter(row => row.fixBlocked);
  const warningRows = previewRows.filter(row => row.hasQtyWarning);
  const changedRows = previewRows.filter(row => num(row.shipmentDiffQty) !== 0 || row.priceChanged || num(row.orderAfterQty) !== num(row.orderBeforeQty));
  const visibleEntries = useMemo(() => { const token = query.trim().toLowerCase(); return token ? entries.filter(row => `${row.customer} ${row.product} ${row.color}`.toLowerCase().includes(token)) : entries; }, [entries, query]);
  const enteredPriceCount = entries.filter(row => prices[dutchPriceKey(row)] !== '' && prices[dutchPriceKey(row)] !== undefined).length;

  useEffect(() => { if (storageKey && entries.length) writeDutchDraft(localStorage, storageKey, entries, prices); }, [storageKey, entries, prices]);
  useEffect(() => {
    let active = true;
    async function loadRecordedWeeks() {
      setWeeksLoading(true);
      try {
        const result = await apiGet('/api/stats/pivot-weeks', { orderYear: year, source: 'orders' });
        if (!active) return;
        const recorded = Array.isArray(result.weeks) ? result.weeks : [];
        setAvailableWeeks(recorded);
        if (!recorded.length) { if (sourceModeRef.current !== 'UPLOAD') setError(`${year}년 DB 입력 차수가 없습니다.`); return; }
        const selectedWeek = recorded.includes(week) ? week : recorded[0];
        if (selectedWeek !== weekRef.current) { invalidate(); weekRef.current = selectedWeek; }
        setWeek(selectedWeek);
        if (sourceModeRef.current !== 'UPLOAD') await loadLive(year, selectedWeek);
      } catch (cause) { if (active) setError(cause.message || 'DB 입력 차수 목록을 불러오지 못했습니다.'); }
      finally { if (active) setWeeksLoading(false); }
    }
    loadRecordedWeeks();
    return () => { active = false; };
  }, [year]);

  function invalidate() {
    revisionRef.current += 1;
    previewRequestRef.current += 1;
    setPreview(null); setAckReplacement(false); setAckQtyWarnings(false);
    setPreviewLoading(false);
  }

  async function runPreview(nextEntries = entries, nextPrices = prices, selectedYear = year, selectedWeek = week, identity = storageKey, name = fileName) {
    if (!nextEntries.length || !identity || applyingRef.current) return;
    const revision = revisionRef.current;
    const request = ++previewRequestRef.current;
    setPreviewLoading(true); setError(''); setPreview(null); setAckReplacement(false); setAckQtyWarnings(false);
    try {
      const prepared = buildDutchPreviewEntries(nextEntries, nextPrices, dutchPriceKey);
      const response = await fetch('/api/shipment/dutch-volume-preview', { method: 'POST', headers: requestHeaders, credentials: 'same-origin', body: JSON.stringify({ year: selectedYear, week: selectedWeek, entries: prepared, sourceFileName: name }) });
      const data = await response.json();
      if (request !== previewRequestRef.current || revision !== revisionRef.current || identity !== sourceRef.current || selectedYear !== yearRef.current || selectedWeek !== weekRef.current) return;
      if (!response.ok) throw new Error(data.error || 'ERP 미리보기 검증에 실패했습니다.');
      setMatchCache(Object.fromEntries((data.entryMatches || []).map(item => [item.id, item])));
      setCustomerOptions(data.customerOptions || []);
      setProductOptions(data.productOptions || []);
      setPreview({ ...data, revision, year: selectedYear, week: selectedWeek, sourceIdentity: identity });
    } catch (cause) { if (request === previewRequestRef.current && revision === revisionRef.current) setError(cause.message || 'ERP 미리보기 검증에 실패했습니다.'); }
    finally { if (request === previewRequestRef.current && revision === revisionRef.current) setPreviewLoading(false); }
  }
  const yearRef = useRef(year);
  const weekRef = useRef(week);
  yearRef.current = year; weekRef.current = week;

  async function acceptSource(nextWorkbook, name, identity, nextEntries, mode) {
    const saved = readDutchDraft(localStorage, identity, nextEntries, migrateDutchPriceDraft);
    invalidate(); sourceRef.current = identity; sourceModeRef.current = mode; setSourceMode(mode);
    setMatchCache({}); setCustomerOptions([]); setProductOptions([]);
    setWorkbook(nextWorkbook); setFileName(name); setStorageKey(identity);
    setEntries(saved.entries); setPrices(saved.prices); setLegacyCurrency(saved.legacyCurrency);
    setApplyResult(null);
    // Initial matching is a read-only preview. Apply is always a separate, explicit action.
    await runPreview(saved.entries, saved.prices, yearRef.current, weekRef.current, identity, name);
  }

  async function loadLive(selectedYear = year, selectedWeek = week) {
    const request = ++loadRequestRef.current;
    invalidate(); setLoading(true); setError('');
    try {
      const result = await apiGet('/api/stats/pivot-data', { orderYear: selectedYear, weekStart: selectedWeek, weekEnd: selectedWeek });
      const liveEntries = buildDutchEntriesFromPivotData(result, selectedYear, selectedWeek);
      if (!liveEntries.length) throw new Error(`${selectedYear}년 ${selectedWeek} 네덜란드 업체별 주문수량이 없습니다.`);
      const params = new URLSearchParams({ orderYear: String(selectedYear), weekStart: selectedWeek, weekEnd: selectedWeek, species: 'country:네덜란드' });
      const volumeResponse = await fetch(`/api/stats/pivot-volume-excel?${params.toString()}`, { credentials: 'same-origin' });
      if (!volumeResponse.ok) { const detail = await volumeResponse.json().catch(() => ({})); throw new Error(detail.error || 'Pivot 물량표 원본 엑셀을 만들지 못했습니다.'); }
      const nextWorkbook = XLSXStyled.read(await volumeResponse.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      if (request !== loadRequestRef.current || selectedYear !== yearRef.current || selectedWeek !== weekRef.current) return;
      await acceptSource(nextWorkbook, `${selectedWeek.replace(/-/g, '')}_네덜란드.xlsx`, `live:${selectedYear}:${selectedWeek}`, parsed.entries, 'LIVE');
    } catch (cause) { if (request === loadRequestRef.current) setError(cause.message || '네덜란드 물량표 조회에 실패했습니다.'); }
    finally { if (request === loadRequestRef.current) setLoading(false); }
  }

  function stepWeek(delta) {
    if (!availableWeeks.length) return;
    const currentIndex = availableWeeks.indexOf(week);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(availableWeeks.length - 1, baseIndex - delta));
    changeWeek(availableWeeks[nextIndex]);
  }
  function clearLiveSource() {
    ++loadRequestRef.current;
    setLoading(false);
    if (sourceModeRef.current !== 'LIVE') return;
    sourceRef.current = ''; sourceModeRef.current = '';
    setSourceMode(''); setStorageKey(''); setWorkbook(null); setFileName('');
    setEntries([]); setPrices({}); setMatchCache({}); setApplyResult(null);
  }
  function changeWeek(value) { invalidate(); clearLiveSource(); weekRef.current = value; setWeek(value); }
  function changeYear(value) { invalidate(); clearLiveSource(); yearRef.current = value; setYear(value); }

  async function upload(file) {
    const request = ++loadRequestRef.current;
    invalidate(); setLoading(true); setError('');
    try {
      const nextWorkbook = XLSXStyled.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      if (request !== loadRequestRef.current) return;
      const identity = `${file.name}:${file.size}:${file.lastModified}`;
      await acceptSource(nextWorkbook, file.name, identity, parsed.entries, 'UPLOAD');
    } catch (cause) { if (request === loadRequestRef.current) setError(cause.message || '엑셀 파일을 읽지 못했습니다.'); }
    finally { if (request === loadRequestRef.current) setLoading(false); }
  }

  function updateEntry(id, change) { invalidate(); setEntries(previous => editDutchDraftEntry(previous, id, change)); }
  function updatePrice(entry, value) {
    invalidate();
    setPrices(previous => ({ ...previous, [dutchPriceKey(entry)]: value }));
  }
  function pickMaster(entry, kind, item) {
    const next = kind === 'product'
      ? { prodKey: Number(item.prodKey ?? item.ProdKey), product: String(item.prodName ?? item.ProdName ?? item.displayName ?? item.DisplayName) }
      : { custKey: Number(item.custKey ?? item.CustKey), customer: String(item.custName ?? item.CustName) };
    // A rematch changes price identity; never copy an unrelated product or customer price.
    if (isDutchIndividualPriceCustomer(entry.customer) || isDutchIndividualPriceCustomer(next.customer)) {
      setPrices(previous => { const updated = { ...previous }; delete updated[entry.id]; return updated; });
    }
    updateEntry(entry.id, next);
  }
  function addRow() {
    invalidate();
    setEntries(previous => [...previous, newDutchDraftEntry(`manual:${Date.now()}:${Math.random().toString(36).slice(2)}`)]);
  }
  function removeRow(id) { invalidate(); setEntries(previous => previous.filter(row => row.id !== id)); }
  function moveNext(event, index) { if (event.key === 'Enter') { event.preventDefault(); inputRefs.current[index + 1]?.focus(); inputRefs.current[index + 1]?.select(); } }

  async function download() {
    if (!workbook) return;
    try {
      const edited = withEditedWorkbook(workbook, entries, prices);
      const priced = addDutchPriceColumns(XLSXStyled, edited, entries, prices, 'KRW');
      const base = XLSXStyled.write(priced.workbook, { type: 'array', bookType: 'xlsx', compression: true });
      const shaped = await addDutchPriceShapesToXlsx(XLSXStyled, base, priced.workbook, entries.filter(row => !row.added), prices);
      const url = URL.createObjectURL(new Blob([shaped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${fileName.replace(/\.xlsx?$/i, '')}_단가입력.xlsx`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause.message || '엑셀 저장에 실패했습니다.'); }
  }

  async function recoverJob(jobId) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      try {
        const response = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' });
        if (response.status === 401) throw new Error('로그인 세션이 만료되었습니다. 작업 ID로 관리자에게 확인하세요.');
        if (!response.ok) continue;
        const data = await response.json();
        if (!data.progress) continue;
        setApplyResult(previous => ({ ...previous, progress: data.progress }));
        if (data.progress.finished) return data.progress.result || { success: false, error: data.progress.error?.message || '서버 적용 작업 실패' };
      } catch (cause) { if (cause.message?.includes('로그인 세션')) throw cause; }
    }
    throw new Error(`결과를 확인하지 못했습니다. 자동 재적용하지 마세요. 작업 ID ${jobId}로 이력을 확인하세요.`);
  }

  async function applyPreview() {
    if (!previewCurrent || !ackReplacement || (warningRows.length && !ackQtyWarnings) || applyingRef.current) return;
    const summary = `${year}년 ${week} 선택 품종 전체 교체\n대상 품종: ${(preview.replacementCategories || []).join(', ') || '서버 검증 범위'}\n변경 ${changedRows.length}건 / 파일 누락 분배 0 ${missingRows.length}건 / 확정 차단 ${blockedRows.length}건\n기존 주문은 보존, 없는 양수 주문만 생성합니다.\n표에 표시된 기존→최종 수량과 원화 단가를 확인하셨습니까?`;
    if (!window.confirm(summary)) return;
    const jobId = `dutch_${crypto.randomUUID()}`;
    applyingRef.current = true; setApplying(true); setActiveJobId(jobId); setError(''); setApplyResult({ running: true, progress: { stage: '서버 요청 중', done: 0, total: previewRows.length, logs: ['서버 적용 중입니다. 창을 닫거나 다시 적용하지 마세요.'] } });
    const timer = setInterval(async () => {
      try { const response = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' }); const data = await response.json(); if (data.progress) setApplyResult(previous => previous?.running ? { ...previous, progress: data.progress } : previous); } catch { /* POST result or recovery determines completion. */ }
    }, 900);
    try {
      let data;
      let response;
      try { response = await fetch('/api/shipment/dutch-volume-apply', { method: 'POST', headers: requestHeaders, credentials: 'same-origin', body: JSON.stringify({ planToken: preview.planToken, jobId, ackQtyWarnings }) }); }
      catch { data = await recoverJob(jobId); }
      if (!data && [502, 503, 504].includes(response.status)) data = await recoverJob(jobId);
      if (!data) { try { data = await response.json(); } catch { data = await recoverJob(jobId); } }
      if (!data.success) throw new Error(data.error || 'ERP 적용 실패');
      setApplyResult({ ...data, running: false });
      invalidate();
    } catch (cause) { setError(`${cause.message || 'ERP 적용 실패.'} 작업 로그를 확인하고, 재시도할 때는 ‘ERP 매칭·최종수량 다시 검증’을 먼저 실행하세요. 결과 미확인 상태에서는 재적용하지 마세요.`); setApplyResult(previous => ({ ...previous, running: false, failed: true, error: cause.message })); invalidate(); }
    finally { clearInterval(timer); applyingRef.current = false; setApplying(false); }
  }

  return <><Head><title>네덜란드 물량표 - nenova ERP</title></Head><section className="dutch-board">
    <header><div><h1>네덜란드 물량표</h1><p>원본 엑셀을 올리고 ERP 업체·품목 매칭, 최종 분배수량, 원화 단가를 검토합니다.</p></div><label className="upload">엑셀 업로드<input type="file" accept=".xlsx,.xls" disabled={applying} onChange={event => event.target.files?.[0] && upload(event.target.files[0])}/></label></header>
    <div className="live-load"><label>연도<input aria-label="연도" type="number" min="2000" max="2100" value={year} disabled={applying} onChange={event => changeYear(Number(event.target.value))}/></label><label>DB 입력 차수<div><button aria-label="이전 입력 차수" onClick={() => stepWeek(-1)} disabled={applying || weeksLoading || !availableWeeks.length}>‹</button><select aria-label="차수" value={week} onChange={event => changeWeek(event.target.value)} disabled={applying || weeksLoading || !availableWeeks.length}>{weeksLoading && <option value="">조회 중…</option>}{!weeksLoading && !availableWeeks.length && <option value="">입력 이력 없음</option>}{availableWeeks.map(recordedWeek => <option key={recordedWeek} value={recordedWeek}>{recordedWeek}</option>)}</select><button aria-label="다음 입력 차수" onClick={() => stepWeek(1)} disabled={applying || weeksLoading || !availableWeeks.length}>›</button></div></label><button className="load" onClick={() => loadLive(year, week)} disabled={applying || loading || weeksLoading || !availableWeeks.length}>{loading ? '조회 중…' : '네노바웹 물량 바로 불러오기'}</button><span>선택한 연도·세부차수를 모든 ERP 검증에 사용합니다.</span></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {legacyCurrency && <div className="notice warning">이 파일의 이전 {legacyCurrency} 단가 초안은 원화로 재해석하지 않았습니다. 필요한 원화 단가를 다시 입력하세요.</div>}
    {!entries.length && !loading && <div className="empty">네덜란드 Pivot 엑셀을 올리거나 DB 물량을 조회해 주세요. 조회와 자동 매칭은 읽기 전용이며 적용 버튼을 누르기 전에는 ERP에 저장하지 않습니다.</div>}
    {!!entries.length && <><div className="toolbar"><div><b>{sourceMode === 'LIVE' ? `네노바웹 ${year}년 ${week} 직접 조회` : fileName}</b><span>{entries.length}행 · 원화 단가 입력 {enteredPriceCount}행 · 미입력은 기존 단가 보존</span></div><input aria-label="업체·품목 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="업체·품목 검색"/><span className="currency">KRW 원화 고정</span><button onClick={download}>단가표 엑셀 저장</button></div>
      <div className="guide"><b>입력 방법</b><span>주광은 업체별 단가를 입력합니다. 주광 외 업체는 같은 품목·칼라의 균일가가 전체 업체에 함께 적용됩니다. 빈 단가는 ERP 기존값을 보존하며 0원은 명시 변경입니다. Enter를 누르면 다음 단가 칸으로 이동합니다.</span></div>
      <div className="actions"><button onClick={addRow} disabled={applying}>업체·품목 행 추가</button><button onClick={() => runPreview()} disabled={applying || previewLoading}>{previewLoading ? '검증 중…' : 'ERP 매칭·최종수량 다시 검증'}</button><span>{previewCurrent ? '검증됨 — 아래 전체 교체 범위를 확인하세요.' : '편집 후에는 다시 검증해야 적용할 수 있습니다.'}</span></div>
      <div className="grid-wrap" aria-label="물량 초안 표 가로 세로 스크롤"><table><thead><tr><th>품목 / 원본</th><th>업체 / 원본</th><th>ERP 품목 선택</th><th>ERP 업체 선택</th><th>수량</th><th>단위</th><th>단가 (KRW / 견적단위)</th><th>상태</th></tr></thead><tbody>{visibleEntries.map((row, index) => {
        const individual = isDutchIndividualPriceCustomer(row.customer);
        const match = matchCache[row.id];
        return <tr key={row.id} className={match?.status === 'unmatched' ? 'unmatched' : ''}>
          <td title={row.product}>{row.added ? <input aria-label="추가 품목명" value={row.product} onChange={event => updateEntry(row.id, { product: event.target.value })}/> : <><b>{row.product}</b><small>{row.color || '-'} · {row.sheetName}!{row.cellAddress}</small></>}</td>
          <td title={row.customer}>{row.added ? <input aria-label="추가 업체명" value={row.customer} onChange={event => updateEntry(row.id, { customer: event.target.value })}/> : <b>{customerName(row.customer)}</b>}<small className={individual ? 'individual-price' : 'uniform-price'}>{individual ? '주광 개별단가' : '품목 균일가'}</small></td>
          <td><ErpMatchPicker kind="product" value={row.prodKey || match?.prodKey} label={row.prodKey ? row.product : match?.prodName} options={productOptions} onPick={item => pickMaster(row, 'product', item)} disabled={applying}/></td>
          <td><ErpMatchPicker kind="customer" value={row.custKey || match?.custKey} label={row.custKey ? row.customer : match?.custName} options={customerOptions} onPick={item => pickMaster(row, 'customer', item)} disabled={applying}/></td>
          <td><input aria-label={`${customerName(row.customer)} ${row.product} 수량`} type="number" min="0" step="any" value={row.quantity} disabled={applying} onChange={event => updateEntry(row.id, { quantity: event.target.value })}/></td>
          <td><select aria-label={`${row.product} 단위`} value={row.unit || ''} disabled={applying} onChange={event => updateEntry(row.id, { unit: event.target.value })}><option value="">ERP 출고단위</option><option value="박스">박스</option><option value="단">단</option><option value="송이">송이</option></select></td>
          <td><input ref={node => { inputRefs.current[index] = node; }} aria-label={`${customerName(row.customer)} ${row.product} ${individual ? '개별단가' : '균일가'}`} type="number" min="0" step="any" value={prices[dutchPriceKey(row)] ?? ''} disabled={applying} onChange={event => updatePrice(row, event.target.value)} onKeyDown={event => moveNext(event, index)} placeholder="미입력: 보존"/><small>{match?.estUnit ? `원/${match.estUnit}` : '견적단위: 검증 후 확인'}</small></td>
          <td className="status">{match ? `${previewCurrent ? '' : '이전 검증 · '}${match.reason || match.status || '매칭'}` : '검증 전'}{row.added && <button onClick={() => removeRow(row.id)} disabled={applying}>행 삭제</button>}</td>
        </tr>;
      })}</tbody></table></div>
      {entries.some(row => row.added || row.prodKey || row.custKey) && <p className="export-note">원본 Pivot 셀과 단가 도형은 보존됩니다. 수동 추가·ERP 재매칭을 포함한 전체 입력은 내보내기 파일의 ‘ERP적용초안’ 시트에 별도로 기록됩니다. 원본 시트의 업체·품목 표시는 재매칭 결과로 바꾸지 않습니다.</p>}
      {preview && <section className="review"><div className="review-head"><h2>ERP 최종 적용 미리보기</h2><span>{previewCurrent ? '현재 초안 검증' : '초안 변경으로 무효화됨'}</span></div><p>범위: {preview.orderYear ?? year}년 {preview.week ?? week} · 서버가 판정한 CountryFlower {(preview.replacementCategories || []).join(', ') || '검증 범위'} 전체 교체. 파일에 없는 기존 업체·품목도 최종 0으로 표시됩니다. 표 필터와 무관하게 전체가 적용 대상입니다.</p><div className="kpis"><b>전체 {previewRows.length}</b><b>변경 {changedRows.length}</b><b>누락→0 {missingRows.length}</b><b>확정 차단 {blockedRows.length}</b><b>미매칭 {(preview.unmatched || []).length}</b></div>
        {(preview.unmatched || []).length > 0 && <div className="notice error">미매칭 {(preview.unmatched || []).length}건. 위 초안에서 ERP 업체·품목을 선택하고 다시 검증하세요. {(preview.unmatched || []).slice(0, 8).map(item => item.reason || item.product || item.customer).join(' / ')}</div>}
        {!!preview.blockers?.length && <div className="notice warning" role="alert">{preview.blockers.join(' / ')}</div>}
        <div className="preview-wrap" aria-label="전체 교체 미리보기 표 가로 세로 스크롤"><table><thead><tr><th>구분</th><th>업체</th><th>품목</th><th>기존 주문</th><th>적용 후 주문</th><th>기존 분배</th><th>최종 분배 (출고단위)</th><th>증감</th><th>기존 단가</th><th>최종 단가 KRW / 견적단위</th><th>상태 / 차단 사유</th></tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${row.custKey}:${row.prodKey}:${index}`} className={dutchPreviewRowKind(row)}><td>{row.missingFromExcel ? '파일 누락→0' : row.priceChanged && !num(row.shipmentDiffQty) ? '단가만' : '입력'}</td><td>{row.custName || row.customer}</td><td>{row.prodName || row.product || row.displayName}</td><td className="number">{fmt(row.orderBeforeQty ?? row.orderQty)}</td><td className="number">{fmt(row.orderAfterQty ?? row.orderBeforeQty ?? row.orderQty)}</td><td className="number">{fmt(row.currentOutQty)}</td><td className="number">{fmt(row.uploadQty)} {row.outUnit || ''}</td><td className="number">{fmt(row.shipmentDiffQty)}</td><td className="number">{row.currentCost == null ? '-' : fmt(row.currentCost)}</td><td className="number">{row.unitPrice == null ? '보존' : `${fmt(row.targetCost ?? row.unitPrice)}${num(row.unitPrice) === 0 ? ' (명시 0원)' : ''}`} {row.estUnit || ''}</td><td>{row.fixBlocked ? '확정 차단' : row.qtyWarnings?.map(item => item.message).join(' / ') || row.status || '검증'} {row.reason || ''}</td></tr>)}</tbody></table></div>
        {!!(preview.logs || []).length && <details><summary>검증 로그</summary><div className="logs">{preview.logs.map((line, index) => <div key={index}>{typeof line === 'string' ? line : JSON.stringify(line)}</div>)}</div></details>}
        <div className="approval"><label><input type="checkbox" checked={ackReplacement} disabled={!previewCurrent || applying} onChange={event => setAckReplacement(event.target.checked)}/> 파일 누락행의 최종 0과 위 전체 수량·주문·원화 단가를 확인했습니다.</label>{warningRows.length > 0 && <label><input type="checkbox" checked={ackQtyWarnings} disabled={!previewCurrent || applying} onChange={event => setAckQtyWarnings(event.target.checked)}/> 수량 경고 {warningRows.length}건을 확인했습니다.</label>}<button className="apply" disabled={!previewCurrent || !ackReplacement || !!blockedRows.length || !!(preview.unmatched || []).length || !!(warningRows.length && !ackQtyWarnings) || applying} onClick={applyPreview}>{applying ? '적용 중…' : '확인한 전체 범위 ERP 적용'}</button>{!preview?.planToken && <strong>서버가 적용 계획을 발행하지 않았습니다. 사유를 수정하고 다시 검증하세요.</strong>}</div>
      </section>}
      {applyResult && <section className="result" role="status"><h2>{applyResult.running ? '적용 진행 중' : applyResult.failed ? '적용 실패 또는 결과 확인 필요' : '적용 완료·DB 검증'}</h2><p>작업 ID: {activeJobId}</p>{applyResult.progress && <p>{applyResult.progress.stage} · {applyResult.progress.done}/{applyResult.progress.total}건 {applyResult.progress.current}</p>}{applyResult.error && <p className="error">{applyResult.error}</p>}{!applyResult.running && !applyResult.failed && <p>적용 {applyResult.appliedCount ?? 0}건 · 신규 주문 {applyResult.orderCreatedCount ?? 0}건 · 출고 변경 {applyResult.shipmentChangedCount ?? 0}건 · DB 사후검증 {applyResult.verification?.checked ?? 0}건 / 불일치 {applyResult.verification?.mismatchCount ?? 0}건</p>}<div className="logs">{(applyResult.logs || applyResult.progress?.logs || []).map((line, index) => <div key={index}>{typeof line === 'string' ? line : JSON.stringify(line)}</div>)}</div>{(applyResult.appliedRows || []).length > 0 && <details><summary>행별 적용·검증 결과</summary><div className="logs">{applyResult.appliedRows.map((row, index) => <div key={index}>{row.custName || row.customer} · {row.prodName || row.product} · {JSON.stringify(row)}</div>)}</div></details>}</section>}
    </>}
  </section><style jsx>{`.dutch-board{padding:14px;background:#eef2f7;min-height:calc(100vh - 44px);color:#172033;box-sizing:border-box}header{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#102d72,#1676b8);color:#fff;padding:14px 18px;border-radius:5px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0}header p{margin:0;font-size:12px;opacity:.9}.upload{background:#fff;color:#164c94;padding:8px 14px;border-radius:4px;font-weight:800;cursor:pointer}.upload input{display:none}.live-load{display:flex;align-items:end;gap:8px;padding:10px;margin-top:8px;background:#fff;border:1px solid #c9d4e3}.live-load label{font-size:11px;font-weight:800}.live-load label>input{display:block;width:82px}.live-load label div{display:flex}.live-load input,.live-load select,.live-load button{height:31px;border:1px solid #aebbd0;padding:0 7px}.live-load label div select{width:86px;text-align:center;font-weight:800}.live-load .load{background:#148044;color:#fff;font-weight:800;border-color:#148044}.live-load span{color:#617188;font-size:11px;margin-left:5px}.empty,.notice{margin-top:12px;padding:12px;background:#fff;border:1px solid #c9d4e3;border-radius:5px}.error{color:#a61b14;background:#fff1ef}.warning{color:#7a4a00;background:#fff7df}.toolbar{display:flex;gap:8px;align-items:center;margin-top:10px;padding:9px;background:#fff;border:1px solid #c9d4e3}.toolbar>div{display:flex;flex-direction:column;margin-right:auto}.toolbar span{font-size:11px;color:#617188}.toolbar input{width:240px}.toolbar input,.toolbar button{height:32px;border:1px solid #aebbd0;border-radius:3px;padding:0 9px}.toolbar button{background:#155bd7;color:#fff;font-weight:800}.currency{white-space:nowrap;font-weight:800;color:#136239!important}.guide{margin:7px 0;padding:8px 10px;background:#e8f1ff;border:1px solid #a8c7ef;font-size:12px}.guide b{margin-right:12px}.actions{display:flex;align-items:center;gap:8px;margin:8px 0}.actions button{padding:7px 10px;border:1px solid #8aa8cc;border-radius:4px;background:white;color:#164c94;font-weight:800}.actions span{font-size:12px;color:#52647c}.grid-wrap,.preview-wrap{overflow:auto;background:#fff;border:1px solid #bfcada}.grid-wrap{max-height:calc(100vh - 345px);min-height:160px}.preview-wrap{max-height:430px}table{border-collapse:collapse;min-width:100%;width:max-content;font-size:12px}th{position:sticky;top:0;z-index:2;background:#dce6f4;color:#16335e}th,td{height:38px;padding:5px 8px;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;white-space:nowrap}td small{display:block;color:#64748b}td input,td select{width:115px;height:29px;border:1px solid #aebbd0;padding:3px 6px}.number{text-align:right}.status{max-width:230px;white-space:normal}.status button{margin-left:5px}.unmatched,.blocked{background:#fff1ef}.missing{background:#fff6df}.price{background:#eef7ff}.individual-price{color:#7a45b8}.uniform-price{color:#168447}.export-note{font-size:11px;color:#7b4a18}.review,.result{background:#fff;border:1px solid #bfcada;margin-top:12px;padding:12px}.review-head{display:flex;justify-content:space-between}.review p{font-size:12px}.kpis{display:flex;gap:7px;margin:9px 0;flex-wrap:wrap}.kpis b{background:#e8f1ff;padding:6px 10px;border-radius:4px}.approval{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:10px}.approval label{font-size:12px}.approval .apply{background:#148044;color:white;border:0;border-radius:4px;padding:9px 14px;font-weight:900}.approval .apply:disabled{background:#9ca9b7}.approval strong{color:#a61b14;font-size:12px}.logs{max-height:180px;overflow:auto;background:#f6f8fb;padding:8px;font-size:11px;white-space:pre-wrap}details{margin-top:10px;font-size:12px}@media(max-width:760px){.dutch-board{padding:7px}header{align-items:flex-start;gap:10px}header p{display:none}.live-load,.toolbar,.actions{flex-wrap:wrap}.live-load span,.toolbar>div{width:100%}.toolbar input{flex:1;width:auto}.grid-wrap{max-height:500px}.approval{align-items:flex-start;flex-direction:column}}`}</style></>;
}
