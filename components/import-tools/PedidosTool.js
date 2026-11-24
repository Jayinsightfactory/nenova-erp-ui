import KakaoAdditions from './KakaoAdditions';
import WorkflowGuide from '../WorkflowGuide';
import CountryDownloadComparison from './CountryDownloadComparison';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PEDIDOS_COUNTRIES, generatePedidos, formatPedidosQuantity, readPedidosWorkbook, sanitizePedidosWeek, serializePedidosWorkbook } from '../../lib/importPedidos';
import { reviewCountryOrderQuantities, buildCountryOrderMatrix, applyCountryOrderManualQuantities, formatCountryOrderUnitBasis, formatCountryOrderStoredQuantities, buildCountryOrderProductSnapshot, suggestCountryOrderProductFactors } from '../../lib/countryOrderSource';
import { COUNTRY_ORDER_ETA_STORAGE, countryOrderEtaDefault, countryOrderSourceComplete, formatCountryOrderEta, withCountryOrderEta } from '../../lib/countryOrderEta';
import { createCountryOrderRequestGuard } from '../../lib/countryOrderPedidosAdapter';
import { importCountryLabel, importUnitLabel, importColumnLabel } from '../../lib/importToolsDisplay';
import { countryOrderShortName, countryOrderGroup, countryOrderIssue, generateCompactCountryOrders } from '../../lib/countryOrderPresentation';
import { appendOrderDownload, downloadHistoryKey, orderWorkbookRows, saveOrderFile } from '../../lib/countryOrderDownloadHistory';

// Native React, browser-only file conversion. Parent owns menu and shared storage.
export default function PedidosTool({ active = true }) {
  const [userId,setUserId] = useState('');
  const [sourceMode, setSourceMode] = useState('erp');
  const [cycles, setCycles] = useState([]);
  const [cycleKey, setCycleKey] = useState('');
  const [orderWeek, setOrderWeek] = useState('');
  const [subweeks, setSubweeks] = useState([]);
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const requestGuard = useRef(createCountryOrderRequestGuard());
  const contextGeneration = useRef(0);
  const [country, setCountry] = useState('');
  const [year, setYear] = useState('');
  const [week, setWeek] = useState('');
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [context, setContext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState('');
  const [changes, setChanges] = useState({});
  const [manual, setManual] = useState({}); // { rowKey: { custKey: '150' } } — web-only quantities for blocked products
  const [farms, setFarms] = useState(['Melody', 'CLOUD']);
  const [farmSplit, setFarmSplit] = useState(false);
  const [farmOptions, setFarmOptions] = useState([]);
  const [farmSelection, setFarmSelection] = useState({});
  const [expandedRows, setExpandedRows] = useState({});
  useEffect(() => {
    if (!active) return;
    const controller=new AbortController();
    setUserId('');
    fetch('/api/auth/me',{cache:'no-store',signal:controller.signal})
      .then(response=>response.ok ? response.json() : null)
      .then(result=>{
        if (!controller.signal.aborted && result?.user?.userId != null) setUserId(String(result.user.userId));
      })
      .catch(()=>{});
    return ()=>controller.abort();
  },[active]);
  useEffect(() => {
    if (!active || country !== 'China') return;
    const controller = new AbortController();
    fetch('/api/master?entity=codes', { signal: controller.signal }).then(result => result.ok ? result.json() : null).then(body => {
      if (!controller.signal.aborted) setFarmOptions((body?.farms ?? body?.data?.farms ?? []).map(farm => farm.FarmName).filter(Boolean));
    }).catch(() => { /* Names remain directly editable; no ERP farm assignment is performed. */ });
    return () => controller.abort();
  }, [active, country]);
  // "품목관리에 변경하시겠습니까?" dialog: per blocked row, editable Product factors (1단송이 / 1박스단수 / 1박스송이) saved via /api/master/products-bulk.
  const [productDialog, setProductDialog] = useState(null); // { items: [{ row, snapshot, suggestion, drafts }], saving, error }
  const [productSaved, setProductSaved] = useState('');
  const [etaDialog, setEtaDialog] = useState(null);
  const [historyRevision, updateHistory] = useState(0);
  const [savingDownload, setSavingDownload] = useState(false);
  const etaModal = useRef(null);
  const etaOpener = useRef(null);
  const downloading = useRef(false);
  const previewWindow = useRef(null);
  const previewOpener = useRef(null);
  const previewDialog = useRef(null);
  const [preview, setPreview] = useState(null);

  function closePreview() {
    const opened = previewWindow.current;
    previewWindow.current = null;
    if (opened && !opened.closed) opened.close();
    setPreview(null);
    setEtaDialog(null);
    requestAnimationFrame(() => previewOpener.current?.isConnected && previewOpener.current.focus());
  }

  function openPreview(opener) {
    if (previewWindow.current && !previewWindow.current.closed) {
      previewWindow.current.focus();
      return;
    }
    previewOpener.current = opener;
    // Keep this synchronous with the user click so browsers permit the popup.
    const opened = window.open('about:blank', '_blank', 'popup,width=1480,height=900,resizable=yes,scrollbars=yes');
    if (opened) {
      try {
        const child = opened.document;
        child.title = '국가별 발주서 · 매칭 데이터';
        child.documentElement.lang = 'ko';
        for (const sheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
          const copy = sheet.cloneNode(true);
          if (sheet.href) copy.href = sheet.href;
          child.head.appendChild(copy);
        }
        child.body.style.margin = '0';
        const mount = child.createElement('div');
        child.body.appendChild(mount);
        previewWindow.current = opened;
        opened.addEventListener('pagehide', () => {
          if (previewWindow.current === opened) {
            previewWindow.current = null;
            setPreview(null);
            setEtaDialog(null);
          }
        }, { once: true });
        setPreview({ mount });
        return;
      } catch {
        opened.close();
      }
    }
    setPreview({ mount: null });
  }

  useEffect(() => {
    if (preview && !preview.mount && !previewDialog.current?.open) previewDialog.current?.showModal();
  }, [preview]);
  useEffect(() => {
    if (!active) closePreview();
  }, [active]);
  useEffect(() => () => previewWindow.current?.close(), []);

  function closeEta() {
    setEtaDialog(null);
    requestAnimationFrame(() => etaOpener.current?.isConnected && etaOpener.current.focus());
  }
  useEffect(() => {
    if (etaDialog) etaModal.current?.querySelector('input')?.focus();
  }, [Boolean(etaDialog)]);

  function clearResults() {
    contextGeneration.current += 1;
    setEtaDialog(null);
    setResults(null); setContext(null); setError(''); setDownloaded(''); setBusy(false);
  }
  function setManualQuantity(rowKey, custKey, value) {
    clearResults();
    setManual(current => ({ ...current, [rowKey]: { ...(current[rowKey] ?? {}), [custKey]: value } }));
  }
  function invalidate(setter, value) {
    clearResults(); setter(value);
  }
  function changeSource(value) {
    if (value === sourceMode) return;
    closePreview(); requestGuard.current.invalidate(); setResponse(null); setLoading(false);
    setCycleKey('');setOrderWeek('');setSubweeks([]);
    invalidate(setSourceMode, value);
  }
  function changeCountry(value) {
    if (value === country) value = '';
    closePreview(); setCycleKey(''); setSubweeks([]);
    requestGuard.current.invalidate(); setResponse(null); setOrderWeek(''); setLoading(false);
    invalidate(setCountry, value);
  }
  function changeCycle(value) {
    if (value === cycleKey) value = '';
    closePreview(); setSubweeks([]);
    requestGuard.current.invalidate(); setResponse(null); setOrderWeek(''); setLoading(false);
    invalidate(setCycleKey, value);
  }

  useEffect(() => {
    clearResults(); setResponse(null); setChanges({}); setManual({}); setFarmSelection({}); setExpandedRows({}); setProductDialog(null); setProductSaved('');
    if (!active || sourceMode !== 'erp') { requestGuard.current.invalidate(); setLoading(false); return; }
    const selected = cycles.find(cycle => cycle.key === cycleKey);
    const scopeKey = country && selected ? `${country}/${selected.key}` : null;
    const request = requestGuard.current.begin(scopeKey);
    const params = new URLSearchParams();
    if (country && selected) {
      params.set('country', country); params.set('year', String(selected.year)); params.set('majorWeek', selected.majorWeek);
      if (orderWeek) params.set('orderWeek', orderWeek);
      else params.set('list', 'subweeks');
    }
    setLoading(true);
    (async () => {
      try {
        const result = await fetch(`/api/import/tools/country-orders${params.size ? `?${params}` : ''}`, { signal: request.signal, cache: 'no-store' });
        const body = await result.json();
        if (request.signal.aborted) return;
        if (!result.ok || !body.success) throw new Error(body.message || body.error || '전산 주문 조회에 실패했습니다. 다시 조회하세요.');
        if (!request.accepts(body)) throw new Error('조회 범위가 현재 선택과 다릅니다. 다시 조회하세요.');
        if (!Array.isArray(body.cycles) || body.cycles.length !== 6 || !Array.isArray(body.rows) || !Array.isArray(body.subweeks)) throw new Error('전산 조회 응답이 불완전합니다. 다시 조회하세요.');
        setCycles(body.cycles);
        if (!orderWeek) { setSubweeks(body.subweeks); return; }
        if (!body.subweeks.some(item => item.orderWeek === orderWeek)) throw new Error('선택한 세부차수에 주문이 없습니다. 차수를 다시 선택하세요.');
        setResponse(body);
      } catch (err) {
        if (!request.signal.aborted) { setResponse(null); setError(err.message || '전산 주문 조회에 실패했습니다.'); }
      } finally { if (!request.signal.aborted) setLoading(false); }
    })();
    return () => requestGuard.current.invalidate();
    // cycles are response metadata, never an additional query trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sourceMode, country, cycleKey, orderWeek, reload]);

  const matrixState = useMemo(() => {
    if (!response || !orderWeek || loading) return { matrix: null, error: '' };
    try { return { matrix: buildCountryOrderMatrix(response, orderWeek), error: '' }; }
    catch (err) { return { matrix: null, error: err.message || '전산 행렬을 확인하지 못했습니다.' }; }
  }, [response, orderWeek, loading]);
  const original = matrixState.matrix;
  const review = useMemo(() => {
    try { return { matrix: reviewCountryOrderQuantities(original, changes), error: '' }; }
    catch (err) { return { matrix: null, error: err.message }; }
  }, [original, changes]);
  const matrix = review.matrix ?? original;
  const selectedCycle = cycles.find(cycle => cycle.key === cycleKey);
  const matchesScope = Boolean(matrix && response?.scope?.scopeKey === `${country}/${selectedCycle?.key}` && matrix.scope.country === country && matrix.scope.year === selectedCycle?.year && matrix.scope.orderWeek === orderWeek);
  const sourceComplete = countryOrderSourceComplete(response);
  const canExport = active && !loading && !busy && matchesScope && !review.error && sourceComplete;
  const blockedRowCount = matrix ? matrix.rows.filter(row => row.blocked).length : 0;
  // Blocked products can be completed by typing the missing quantity in the web; it goes to the file only, never to ERP.
  const manualState = useMemo(() => {
    if (!matrix || matrix.blockers.length === 0) return { matrix, error: '' };
    try { return { matrix: applyCountryOrderManualQuantities(matrix, manual), error: '' }; }
    catch (err) { return { matrix: null, error: err.message || '수량 입력을 확인하세요.' }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, manual]);
  const canGenerate = canExport && (matrix.blockers.length === 0 || Boolean(manualState.matrix));

  useEffect(() => {
    if (!canExport || matrix.blockers.length) return;
    try {
      const outputs = generateCompactCountryOrders(matrix, { farms, selected: farmSelection, split: farmSplit });
      setContext({ country, year: matrix.scope.year, week: orderWeek, sourceName: '검토한 발주 수량' });
      setResults(outputs);
    } catch (err) { setResults(null); setError(err.message); }
  }, [canExport, matrix, country, orderWeek, farms, farmSelection, farmSplit]);

  function editQuantity(rowKey, customerKey, value) {
    clearResults();
    setChanges(current => ({ ...current, [rowKey]: { ...current[rowKey], [customerKey]: value } }));
  }
  function moveFarmSelection(event) {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const fields = [...event.currentTarget.closest('table').querySelectorAll('input[type="checkbox"]:not(:disabled)')];
    const target = fields[fields.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (target) { event.preventDefault(); target.focus(); }
  }
  const PRODUCT_FACTOR_FIELDS = [['SteamOf1Bunch', '1단송이', 'steamOf1Bunch'], ['BunchOf1Box', '1박스단수', 'bunchOf1Box'], ['SteamOf1Box', '1박스송이', 'steamOf1Box']];
  function requestGenerate() {
    if (!canGenerate) return;
    if (matrix.blockers.length === 0) { convertMatrix(false); return; }
    // Entered quantities exist: ask whether to store the product's conversion factors so the next order is not blocked again.
    const items = matrix.rows.filter(row => row.blocked).map(row => {
      const suggestion = suggestCountryOrderProductFactors(row, manual[row.key] ?? {});
      const drafts = Object.fromEntries(PRODUCT_FACTOR_FIELDS.map(([key, , basisKey]) => [key, suggestion[key] != null ? String(suggestion[key]) : row.unitBasis?.[basisKey] != null ? String(row.unitBasis[basisKey]) : '']));
      return { row, snapshot: buildCountryOrderProductSnapshot(row.unitBasis), suggestion, drafts };
    });
    setProductDialog({ items, saving: false, error: '' });
  }
  function productChanges(dialog) {
    const changes = [];
    for (const item of dialog.items) {
      const values = {};
      for (const [key, label] of PRODUCT_FACTOR_FIELDS) {
        const text = String(item.drafts[key] ?? '').trim();
        if (text === '') continue;
        if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error(`${item.row.label ?? item.row.name}: ${label}은 0 이상 숫자(소수 3자리까지)로 입력하세요.`);
        const value = Number(text);
        if (value !== (item.snapshot[key] ?? null)) values[key] = value;
      }
      if (Object.keys(values).length) changes.push({ prodKey: item.row.prodKey, expected: item.snapshot, values });
    }
    return changes;
  }
  async function saveProductFactorsAndGenerate() {
    if (!productDialog || productDialog.saving) return;
    let changes;
    try { changes = productChanges(productDialog); } catch (err) { setProductDialog({ ...productDialog, error: err.message }); return; }
    if (!changes.length) { setProductDialog({ ...productDialog, error: '변경된 환산 기준이 없습니다. 값을 입력하거나 [저장 없이 생성]을 누르세요.' }); return; }
    setProductDialog({ ...productDialog, saving: true, error: '' });
    try {
      const result = await fetch('/api/master/products-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      const body = await result.json();
      if (!result.ok || !body.success) throw new Error(body.error || '품목관리 저장에 실패했습니다.');
      const labelOf = key => PRODUCT_FACTOR_FIELDS.find(field => field[0] === key)?.[1] ?? key;
      const summary = (body.saved ?? []).map(item => {
        const changed = changes.find(change => change.prodKey === item.prodKey)?.values ?? {};
        return `${item.prodName} [ProdKey:${item.prodKey}] ${Object.keys(changed).map(key => `${labelOf(key)} ${item.before?.[key] ?? '미등록'}→${item.after?.[key]}`).join(', ')}`;
      }).join(' / ');
      setProductSaved(`품목관리 저장 완료 · ${summary}. 다음 주문 입력·조회부터 반영됩니다. 이번 차수의 전산 원주문 수량은 바뀌지 않았으니 전산에서 수정하세요.`);
      setProductDialog(null);
      convertMatrix(false);
    } catch (err) { setProductDialog({ ...productDialog, saving: false, error: `${err.message} 품목관리는 저장되지 않았습니다.` }); }
  }

  function convertMatrix() {
    clearResults();
    if (!canGenerate) return;
    try {
      const source = matrix.blockers.length ? manualState.matrix : matrix;
      const outputs = generateCompactCountryOrders(source, { farms, selected: farmSelection, split: farmSplit });
      setContext({ country, year: matrix.scope.year, week: orderWeek, sourceName: '전산 원주문 (읽기 전용)' }); setResults(outputs);
    } catch (err) { setError(err.message || '발주서 생성에 실패했습니다.'); }
  }

  async function convert(event) {
    event.preventDefault(); setError(''); setResults(null); setDownloaded('');
    if (!country || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999 || !file) {
      setError('국가, 4자리 연도, 차수와 Excel 파일을 선택하세요.'); return;
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('.xlsx 또는 .xls 파일을 선택하세요.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('20MB 이하 파일을 사용하세요.'); return; }
    setBusy(true);
    const generation = contextGeneration.current;
    try {
      const cleanWeek = sanitizePedidosWeek(week);
      const workbook = readPedidosWorkbook(await file.arrayBuffer());
      if (generation !== contextGeneration.current) return;
      const outputs = generatePedidos(workbook, country, cleanWeek, { year: Number(year) });
      setContext({ country, year, week: cleanWeek, sourceName: file.name });
      setResults(outputs);
    } catch (err) { if (generation === contextGeneration.current) setError(err.message || '파일 변환에 실패했습니다.'); }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  function download(output, opener) {
    if (!active || loading || busy || !results?.includes(output) || (sourceMode === 'erp' && !canExport)) return;
    etaOpener.current = opener;
    downloading.current = false;
    const cycle = cycles.find(item => Number(item.year) === Number(context.year) && item.majorWeek === context.week.split('-')[0].padStart(2, '0'));
    const scope = { year: context.year, week: context.week, cycleStart: cycle?.startDate ?? null };
    let saved = null, storageError = '';
    try { saved = JSON.parse(localStorage.getItem(COUNTRY_ORDER_ETA_STORAGE) || '{}')[country]; }
    catch { storageError = '저장된 ETA 기본값을 읽지 못했습니다. 날짜를 선택하세요.'; }
    setEtaDialog({ output, generation: contextGeneration.current, scope, date: countryOrderEtaDefault(saved, scope), error: storageError });
  }

  async function confirmEta(event) {
    event.preventDefault();
    if (downloading.current || !etaDialog || etaDialog.generation !== contextGeneration.current || !active || loading || busy || !results?.includes(etaDialog.output) || (sourceMode === 'erp' && !canExport)) return;
    downloading.current = true;
    setSavingDownload(true);
    const { output, date, scope } = etaDialog;
    const ownerDocument = event.currentTarget.ownerDocument;
    const generation = contextGeneration.current;
    setError('');
    try {
      const workbook=withCountryOrderEta(output.workbook,context.week,date);
      workbook.Custprops={...workbook.Custprops,NenovaOrderYear:String(context.year),NenovaOrderCountry:context.country};
      const bytes=serializePedidosWorkbook(workbook);
      const state=await saveOrderFile({bytes,filename:output.filename,document:ownerDocument,
        desktop:document.documentElement.dataset.nenovaCountryDownloads==='1',
        openPicker:ownerDocument.defaultView?.showSaveFilePicker?.bind(ownerDocument.defaultView)});
      if (state === 'cancelled') return;
      if (state === 'interrupted') throw Error('파일 저장이 중단되었습니다.');
      let historyMessage='';
      if (state === 'completed') {
        try {
          const key=await downloadHistoryKey(userId,context,output.filename);
          if (!key) throw Error('Account unavailable');
          await appendOrderDownload(localStorage,key,{id:crypto.randomUUID(),at:new Date().toISOString(),eta:date,
            rows:orderWorkbookRows(readPedidosWorkbook(bytes),output.unit),source:'completed'},navigator.locks);
          updateHistory(n=>n+1);
        } catch { historyMessage=' 비교 이력은 저장하지 못했습니다.'; }
      } else historyMessage=' 저장 확인 후 기존 발주서 불러오기로 비교 이력에 넣을 수 있습니다.';
      if (generation!==contextGeneration.current) return;
      let defaults;
      try { defaults = JSON.parse(localStorage.getItem(COUNTRY_ORDER_ETA_STORAGE) || '{}'); }
      catch { defaults = {}; }
      if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) defaults = {};
      try { localStorage.setItem(COUNTRY_ORDER_ETA_STORAGE, JSON.stringify({ ...defaults, [country]: { ...scope, date } })); } catch {}
      setDownloaded(`${output.filename} · ${formatCountryOrderEta(date)} ${state==='completed'?'저장 완료.':'다운로드 요청.'}${historyMessage}`);
      closeEta();
    } catch (err) {
      if (err.name!=='AbortError' && generation===contextGeneration.current) {
        setEtaDialog(current => current && ({ ...current, error: `다운로드 실패: ${err.message}` }));
      }
    } finally {
      downloading.current=false;setSavingDownload(false);
    }
  }

  const noItems = results !== null && (results.length === 0 || results.every(output => output.itemCount === 0));
  let currentEta='';
  if (context) {
    try {
      const saved=JSON.parse(localStorage.getItem(COUNTRY_ORDER_ETA_STORAGE) || '{}')[context.country];
      const cycle=cycles.find(item=>Number(item.year)===Number(context.year) && item.majorWeek===context.week.split('-')[0].padStart(2,'0'));
      currentEta=countryOrderEtaDefault(saved,{year:context.year,week:context.week,cycleStart:cycle?.startDate || null});
    } catch {}
  }
  const finishControls = <div className="pedidos-form-controls">
    {busy && <p role="status">Excel을 읽고 발주서를 생성하고 있습니다…</p>}
    {error && <p role="alert" className="pedidos-error">{countryOrderIssue(error)}</p>}
    {downloaded && <p role="status">{downloaded}</p>}
    {productSaved && <p role="status" className="pedidos-product-saved">{productSaved}</p>}
    {productDialog && <div className="pedidos-backdrop"><section role="dialog" aria-modal="true" aria-label="품목관리에 변경하시겠습니까?" className="pedidos-dialog">
      <h3>품목관리에 변경하시겠습니까?</h3>
      <p>입력한 수량으로 계산한 환산 기준입니다. 저장하면 전산·웹 품목관리(Product)에 반영되어 다음 주문부터 송이 수량이 자동 계산됩니다. 이미 저장된 이번 주문 수량은 바뀌지 않습니다.</p>
      {productDialog.items.map(item => <div key={item.row.key} className="pedidos-dialog-item">
        <strong>{item.row.label ?? item.row.name} <small>[ProdKey:{item.row.prodKey}] · 현재 {formatCountryOrderUnitBasis(item.row.unitBasis)}</small></strong>
        <div className="pedidos-dialog-fields">{PRODUCT_FACTOR_FIELDS.map(([key, label]) => <label key={key}>{label}{item.suggestion[key] != null && <em> 제안 {item.suggestion[key]}</em>}
          <input type="number" min="0" step="0.001" value={item.drafts[key]} disabled={productDialog.saving} onChange={event => setProductDialog(current => ({ ...current, error: '', items: current.items.map(entry => entry === item ? { ...entry, drafts: { ...entry.drafts, [key]: event.target.value } } : entry) }))} />
        </label>)}</div>
      </div>)}
      {productDialog.error && <p role="alert" className="pedidos-error">{productDialog.error}</p>}
      <div className="pedidos-dialog-actions">
        <button type="button" disabled={productDialog.saving} onClick={saveProductFactorsAndGenerate}>{productDialog.saving ? '저장 중…' : '품목관리에 저장 후 생성'}</button>
        <button type="button" className="pedidos-secondary" disabled={productDialog.saving} onClick={() => { setProductDialog(null); convertMatrix(false); }}>저장 없이 생성</button>
        <button type="button" className="pedidos-secondary" disabled={productDialog.saving} onClick={() => setProductDialog(null)}>취소</button>
      </div>
    </section></div>}
    {results !== null && <div aria-live="polite">
      <h3>2. 변환 결과 · 파일 {results.length}개</h3>
      <p>{importCountryLabel(context.country)} · {context.year}년 · {context.week}차 · {context.sourceName}</p>
      {noItems && <p role="status" className="pedidos-warning">변환할 품목이 없습니다. 선택 국가와 원본 시트·양식을 확인하세요. 일부 국가의 원본 규칙은 합계만 있는 빈 파일을 생성합니다.</p>}
      {results.map(output => <article className="pedidos-result" key={output.filename}>
        <div className="pedidos-result-heading">
          <div><h4>{output.filename}</h4><p>시트: {output.workbook.SheetNames[0]} · 원본: {output.sourceSheet}</p><div className="pedidos-totals"><span>품목 <strong>{output.itemCount.toLocaleString('ko-KR')}개</strong></span><span>총수량 <strong>{formatPedidosQuantity(output.totalQuantity)} {importUnitLabel(output.unit)}</strong></span>{output.totalBoxes != null&&<span>박스 <strong>{formatPedidosQuantity(output.totalBoxes)}</strong></span>}</div></div>
          <button type="button" onClick={event => download(output, event.currentTarget)}>엑셀 다운로드</button>
        </div>
        {output.totalQuantity === 0 && <p role="status" className="pedidos-note">숫자 원본의 합계가 0입니다. 정상적인 0 수량 결과도 다운로드할 수 있습니다.</p>}
        <CountryDownloadComparison key={JSON.stringify([context.country,context.year,context.week,output.filename])}
          userId={userId} context={context} output={output} revision={historyRevision} currentEta={currentEta} />
        {output.warnings.length > 0 && <div className="pedidos-warning"><h5>확인 필요</h5><ul>{output.warnings.map(warning => <li key={warning}>{countryOrderIssue(warning)}</li>)}</ul></div>}
        {output.itemCount > 0 && <details><summary>품목 미리보기 ({output.itemCount}개, 수식 계산값 표시)</summary>
          <div className="pedidos-preview" tabIndex={0} role="region" aria-label={`${output.filename} 품목 표`}>
            <table><colgroup>{output.preview.headers.map((_,i)=><col key={i} style={{width:i===0?320:120}}/>)}</colgroup><thead><tr>{output.preview.headers.map((header, i) => <th key={i} scope="col" title={String(header)}>{importColumnLabel(header)}</th>)}</tr></thead>
              <tbody>{output.preview.rows.map((row, i) => <tr key={i}>{row.map((cell, c) => <td key={c}>{c === 0 ? (cell == null ? '' : String(cell)) : formatPedidosQuantity(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>}
      </article>)}
      <p className="pedidos-note">변경량(Cambios)은 빈칸으로 유지됩니다. 다운로드 파일에는 원본 수식과 초기 계산값이 포함되며, 엑셀에서 편집하면 자동 재계산됩니다. 저장 위치는 브라우저 설정을 따릅니다.</p>
    </div>}
    {etaDialog && active && <div className="pedidos-backdrop"><form ref={etaModal} role="dialog" aria-modal="true" aria-labelledby="pedidos-eta-title" className="pedidos-dialog" onSubmit={confirmEta} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!savingDownload) closeEta(); }
      if (event.key === 'Tab') {
        const fields = [...etaModal.current.querySelectorAll('input, button')].filter(field => !field.disabled);
        const first = fields[0], last = fields[fields.length - 1];
        if (event.shiftKey && etaModal.current.ownerDocument.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && etaModal.current.ownerDocument.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h3 id="pedidos-eta-title">ETA 입력</h3>
      <p>{importCountryLabel(country)} · {context?.year}/{context?.week} · {etaDialog.output.filename}</p>
      <label>달력에서 날짜 선택<input type="date" min="1900-01-01" max="9999-12-31" value={/^\d{4}-\d{2}-\d{2}$/.test(etaDialog.date) ? etaDialog.date : ''} onChange={event => setEtaDialog(current => ({ ...current, date: event.target.value, error: '' }))} /></label>
      <label>ETA 직접 입력<input type="text" inputMode="numeric" placeholder="2026-11-16" value={etaDialog.date} onChange={event => setEtaDialog(current => ({ ...current, date: event.target.value, error: '' }))} /></label>
      <p className="pedidos-note">국가별 기본값은 이 PC·브라우저에 저장됩니다. 다음 주차는 7일 증가하고 같은 주의 세부차수는 유지합니다. 전산 주문은 변경하지 않습니다.</p>
      <p aria-live="polite">{(() => { try { return `Semana ${context?.week}차 ${formatCountryOrderEta(etaDialog.date)}`; } catch { return '달력에서 선택하거나 YYYY-MM-DD 형식으로 입력하세요.'; } })()}</p>
      {etaDialog.error && <p role="alert" className="pedidos-error">{etaDialog.error}</p>}
      <div className="pedidos-dialog-actions"><button type="submit" disabled={savingDownload}>{savingDownload?'파일 저장 확인 중…':'ETA 저장·엑셀 다운로드'}</button><button type="button" className="pedidos-secondary" disabled={savingDownload} onClick={closeEta}>취소</button></div>
    </form></div>}

  </div>;
  const orderPreview = <section className="pedidos-tool pedidos-work-preview" aria-label="국가별 발주 매칭 데이터">
    <header className="pedidos-preview-heading">
      <div><h2 id="pedidos-preview-title">매칭 데이터 미리보기</h2>
        <p>{importCountryLabel(country)} · {selectedCycle?.year}년 {orderWeek}차</p></div>
      <button type="button" className="pedidos-secondary" onClick={closePreview}>미리보기 닫기</button>
    </header>
      {country === 'China' && orderWeek && <fieldset className="pedidos-farms"><legend>수신 농장별 파일 나누기</legend>
        <p>기본값 Melody는 그대로 사용하거나 수정할 수 있습니다. 나누기를 켜면 체크한 품목은 농장 1, 나머지는 농장 2 파일에 들어갑니다. 전산 농장 배정은 변경하지 않습니다.</p>
        <label className="pedidos-split-toggle"><input type="checkbox" checked={farmSplit} onChange={event => { clearResults(); setFarmSplit(event.target.checked); }} />농장별 파일로 나누기</label>
        <div className="pedidos-fields">{farms.map((farm, index) => <label key={index}>농장 {index + 1}{index === 1 ? ' (미선택 품목)' : ''}<input type="text" list="pedidos-farm-names" value={farm} onChange={event => { clearResults(); setFarms(current => current.map((value, i) => i === index ? event.target.value : value)); }} /></label>)}</div>
        <datalist id="pedidos-farm-names">{[...new Set(['Melody', 'HUBFRESH', 'CLOUD', ...farmOptions])].map(name => <option key={name} value={name} />)}</datalist>
      </fieldset>}
      <div className="pedidos-auto-actions">
        {results?.length ? results.map(output => <button key={output.filename} type="button" onClick={event => download(output, event.currentTarget)}>{output.filename} 다운로드</button>) : <button type="button" disabled>엑셀 다운로드</button>}
        {matrix?.blockers.length > 0 && <button type="button" disabled={!canGenerate} onClick={requestGenerate}>미리보기 생성</button>}
        <button type="button" className="pedidos-secondary" disabled={loading} onClick={() => { requestGuard.current.invalidate(); clearResults(); setResponse(null); setReload(value => value + 1); }}>다시 조회</button>
        <span role="status">{loading ? (orderWeek ? '전산 원주문 조회 중…' : '차수 목록 조회 중…') : !country ? '국가를 선택하세요.' : !cycleKey ? '차수를 선택하세요.' : !orderWeek ? (subweeks.length ? '세부차수를 선택하면 주문을 조회합니다.' : '선택 범위에 주문 없음') : ''}</span>
      </div>
      {review.error && <p className="pedidos-error" role="alert">{review.error}</p>}
      {response && !sourceComplete && <p className="pedidos-error" role="alert">원주문 누락 점검을 통과하지 못했습니다. 조회되지 않은 활성 주문이 있거나 점검 결과가 없습니다. 누락 방지를 위해 다운로드를 중단했습니다. 관리자 확인 후 다시 조회하세요.</p>}
      {matrixState.error && <p role="alert" className="pedidos-error">{matrixState.error}</p>}
      {matrix && <>
        <p className="pedidos-note">{matrix.scope.year}년 {matrix.scope.orderWeek}차 · 품목 {matrix.rows.length}개 · 업체 {matrix.customers.length}개 · 송이·단 수량을 확인하고 필요하면 업체별 입력칸에서 수정하세요. 합계와 엑셀에 반영되며 전산 원주문은 유지됩니다.</p>
        <p className="pedidos-note">품목관리 기준은 현재 품목 설정이며 참고용입니다. 저장 주문수량은 선택 연도·차수의 원본 값입니다. 기준을 표시해도 발주서 수량을 다시 환산하지 않습니다.</p>
        {matrix.blockers.length > 0 && <div role="alert" className="pedidos-error"><strong>⚠ 수량 오류 {blockedRowCount}건 · 입력 전까지 발주서 생성 불가</strong><p>아래 표의 주황색 행에 {country === 'Netherlands' ? '송이' : '발주서 단위'} 수량을 직접 입력하면 [미리보기 생성]이 열립니다. 입력값은 발주서 파일에만 쓰이고 전산 원주문은 바뀌지 않으므로 전산에서도 수정하세요. 주문 누락 방지를 위해 확인 필요 품목을 제외한 다운로드는 허용하지 않습니다.</p>{manualState.error && <p className="pedidos-manual-state">{manualState.error}</p>}{country === 'Netherlands' && <p>저장 단 수량이 있어도 저장 송이 수량이 0이면 송이 수량을 확인해야 합니다. 표시된 0을 단 수량이나 품목관리 기준으로 자동 보정하지 않습니다.</p>}<ul>{matrix.blockers.map((message, index) => <li key={index}>{countryOrderIssue(message)}</li>)}</ul></div>}
        {matrix.warnings.length > 0 && <div className="pedidos-warning"><strong>확인 필요</strong><ul>{matrix.warnings.map((message, index) => <li key={index}>{countryOrderIssue(message)}</li>)}</ul></div>}
        <div className="pedidos-preview pedidos-matrix" tabIndex={0} role="region" aria-label="전산 품목별 업체 원수량 행렬"><table>
          <thead><tr><th scope="col">품목 · 상세</th>{country === 'China' && <th scope="col">농장 1</th>}<th scope="col">단위</th>{matrix.customers.map(customer => <th scope="col" key={customer.key} title={`${customer.name} · ${customer.key}`}>{customer.label}</th>)}<th scope="col">합계</th></tr></thead>
          <tbody>{[...matrix.rows].sort((a, b) => countryOrderGroup(matrix, a).localeCompare(countryOrderGroup(matrix, b), 'ko') || a.name.localeCompare(b.name, 'en')).map((row, index, rows) => <React.Fragment key={row.key}>
            {(index === 0 || countryOrderGroup(matrix, rows[index - 1]) !== countryOrderGroup(matrix, row)) && <tr className="pedidos-group"><th colSpan={matrix.customers.length + (country === 'China' ? 4 : 3)}>{countryOrderGroup(matrix, row)}</th></tr>}
            <tr className={row.blocked ? 'pedidos-row-blocked' : undefined}>
            <th scope="row" title={row.label ?? row.name}><button type="button" className="pedidos-row-detail" aria-expanded={Boolean(expandedRows[row.key])} onClick={() => setExpandedRows(current => ({ ...current, [row.key]: !current[row.key] }))}>{expandedRows[row.key] ? '−' : '+'} {countryOrderShortName(row)}</button>{row.blocked && <span className="pedidos-blocked-tag" title={row.blockers.map(countryOrderIssue).join(' / ')}>확인 필요</span>}</th>
            {country === 'China' && <td><input type="checkbox" disabled={!farmSplit} onKeyDown={moveFarmSelection} aria-label={`${row.name} 농장 1 ${farms[0]}`} checked={farmSelection[String(row.prodKey)] === true} onChange={event => { clearResults(); setFarmSelection(current => ({ ...current, [String(row.prodKey)]: event.target.checked })); }} /></td>}
            <td>{country === 'Netherlands' ? '스팀(송이)' : importUnitLabel(row.unit)}</td>
            {matrix.customers.map(customer => <td key={customer.key}>{row.blocked && Object.hasOwn(row.storedQuantitiesByCustomer ?? {}, customer.key) && !(((row.originalQuantities ?? row.quantities)[customer.key] ?? 0) > 0)
              ? <input type="number" min="1" step="any" className="pedidos-manual-input" aria-label={`${row.label ?? row.name} ${customer.label} ${country === 'Netherlands' ? '송이' : importUnitLabel(row.unit)} 수량 입력`} placeholder={country === 'Netherlands' ? '송이 입력' : '수량 입력'} value={manual[row.key]?.[customer.key] ?? ''} onChange={event => setManualQuantity(row.key, customer.key, event.target.value)} />
              : ['stems', 'bunches'].includes(row.unit) && Object.hasOwn(row.storedQuantitiesByCustomer ?? {}, customer.key)
                ? <input type="number" min="0" step="any" className="pedidos-review-input" title={`전산 ${(row.originalQuantities ?? row.quantities)[customer.key]} ${importUnitLabel(row.unit)}`} aria-label={`${row.label ?? row.name} ${customer.label} 발주 ${importUnitLabel(row.unit)} 수량`} value={changes[row.key]?.[customer.key] ?? row.quantities[customer.key]} onChange={event => editQuantity(row.key, customer.key, event.target.value)} />
                : formatPedidosQuantity(row.quantities[customer.key] ?? 0)}</td>)}
            <td><strong>{row.blocked && manualState.matrix ? formatPedidosQuantity(manualState.matrix.rows.find(item => item.key === row.key).total) : formatPedidosQuantity(row.total)}</strong></td>
          </tr>{expandedRows[row.key] && <tr><td colSpan={matrix.customers.length + (country === 'China' ? 4 : 3)} className="pedidos-detail-content"><strong>{row.name} · 품목번호 {row.prodKey}</strong><p>품목관리 기준: {formatCountryOrderUnitBasis(row.unitBasis)}</p><p>저장 주문수량: {formatCountryOrderStoredQuantities(row.storedQuantities)}</p><details><summary>업체별 저장수량</summary><ul>{matrix.customers.map(customer => <li key={customer.key}>{customer.label}: {Object.hasOwn(row.storedQuantitiesByCustomer ?? {}, customer.key) ? formatCountryOrderStoredQuantities(row.storedQuantitiesByCustomer[customer.key]) : '주문 없음'}</li>)}</ul></details></td></tr>}</React.Fragment>)}</tbody>
        </table></div>
      </>}

    {finishControls}
  </section>;
  return <section className="pedidos-tool" aria-label="국가별 발주서 파일 변환">
    <div className="pedidos-heading"><div><h2>국가별 발주서</h2><p className="pedidos-purpose">핵심 목적 · 수입 발주 누락을 확인하고 이전 파일과 수량을 대조합니다.</p></div><span className="pedidos-free">전산 읽기 전용 · 원장 변경 없음</span></div>
    <WorkflowGuide workflowId="import-country-orders" />
    <div className="pedidos-split"><div className="pedidos-primary">
    <div className="pedidos-source" role="group" aria-label="발주 수량 원천">
      <button type="button" aria-pressed={sourceMode === 'erp'} onClick={() => changeSource('erp')}>전산에서 자동 불러오기</button>
      <button type="button" aria-pressed={sourceMode === 'upload'} onClick={() => changeSource('upload')}>Excel 원본 업로드</button>
    </div>
    {sourceMode === 'erp' ? <div className="pedidos-auto">
      <h3>1. 국가</h3>
      <div className="pedidos-subweeks" role="group" aria-label="국가">{PEDIDOS_COUNTRIES.map(value => <button type="button" key={value} aria-pressed={country === value} onClick={() => changeCountry(value)}>{importCountryLabel(value)}</button>)}</div>
      {country && <><h3>2. 차수</h3>
      <div className="pedidos-cycles" role="group" aria-label="오늘부터 다음 5개 대차수">{cycles.map(cycle => <button type="button" key={cycle.key} aria-pressed={selectedCycle?.key === cycle.key} onClick={() => changeCycle(cycle.key)}>{cycle.year} {cycle.majorWeek}차 <small>{cycle.startDate.slice(5).replace('-', '/')}–{cycle.endDate.slice(5).replace('-', '/')}</small></button>)}</div></>}
      {cycleKey && <><h3>3. 세부차수</h3>
      <div className="pedidos-subweeks" role="group" aria-label="실제 주문 세부차수">{subweeks.map(subweek => <button type="button" key={subweek.key} aria-pressed={orderWeek === subweek.orderWeek} onClick={() => {
        closePreview();
        requestGuard.current.invalidate(); setResponse(null); setManual({}); invalidate(setOrderWeek, orderWeek === subweek.orderWeek ? '' : subweek.orderWeek);
      }}>{subweek.orderWeek}차</button>)}</div></>}
      {orderWeek && <button type="button" disabled={loading} className="pedidos-secondary pedidos-open-preview" onClick={event => openPreview(event.currentTarget)}>매칭데이터 미리보기 열기</button>}
      <p role="status">{loading ? (orderWeek ? '세부차수 주문 조회 중…' : '차수 목록 조회 중…') : !country ? '국가를 선택하세요.' : !cycleKey ? '차수를 선택하세요.' : !orderWeek ? (subweeks.length ? '세부차수를 선택하세요.' : '선택 범위에 주문 없음') : ''}</p>
    </div> : <form onSubmit={convert}>
      <fieldset disabled={busy}>
        <legend>1. 국가·차수와 원본 파일 선택</legend>
        <div className="pedidos-fields">
          <label>국가<select value={country} onChange={event => invalidate(setCountry, event.target.value)} required>
            <option value="">국가 선택</option>{PEDIDOS_COUNTRIES.map(value => <option key={value} value={value}>{importCountryLabel(value)}</option>)}
          </select></label>
          <label>연도<input type="number" min="1900" max="9999" step="1" placeholder="2026" value={year} onChange={event => invalidate(setYear, event.target.value)} required /></label>
          <label>차수<input type="text" placeholder="34-1" value={week} onChange={event => invalidate(setWeek, event.target.value)} required /></label>
          <label className="pedidos-file">엑셀 원본 (.xlsx / .xls, 최대 20MB)<input type="file" accept=".xlsx,.xls" onChange={event => invalidate(setFile, event.target.files?.[0] ?? null)} required /></label>
          <button type="submit" disabled={!country || !year || !week.trim() || !file}>{busy?'변환 중…':'미리보기 생성'}</button>
        </div>
      </fieldset>
    </form>}
    <p className="pedidos-note">주문·입고·재고에 자동 등록되지 않습니다. 수량 0은 화면·Excel에서 빈칸으로 표시하며 숫자와 수식은 보존합니다. 원인 확인용 저장수량 진단의 0은 표시합니다.</p>
    <details className="pedidos-guide"><summary>지원 양식과 변환 기준 보기</summary><p>기존 양식은 활성 시트(없으면 첫 시트)를 읽습니다. 중국 행렬은 수량원본과 구조화 시트의 업체키·품목키·숫자 수량을 사용하며 선택 연도·차수를 확인합니다. 파일명·시트명은 차수 기준으로 유지합니다. 차수의 공백·구두점은 원본 규칙대로 제거됩니다.</p></details>
    </div>{active && <KakaoAdditions orderScope={sourceMode==='erp'&&country?{
      country,year:selectedCycle?.year,majorWeek:selectedCycle?.majorWeek,orderWeek,
    }:null}/>}</div>
    {preview ? (preview.mount ? createPortal(orderPreview, preview.mount) :
      <dialog ref={previewDialog} className="pedidos-preview-window" aria-labelledby="pedidos-preview-title"
        onCancel={event => { event.preventDefault(); closePreview(); }}>{orderPreview}</dialog>) : finishControls}
    <style jsx global>{`
      .pedidos-tool { width: 100%; min-width: 0; color: #0f172a; font-size:14px; line-height:1.5; font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif; font-variant-numeric:tabular-nums; }
      .pedidos-purpose { font-size:16px;font-weight:700; }
      .pedidos-download-comparison {margin:12px 0;padding-top:10px;border-top:1px solid #cbd5e1}
      .pedidos-download-comparison label {max-width:420px;margin-bottom:8px}
      .pedidos-download-comparison input[type=checkbox] {width:18px}
      .pedidos-source, .pedidos-cycles, .pedidos-subweeks, .pedidos-auto-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; }
      .pedidos-source button, .pedidos-cycles button, .pedidos-subweeks button, .pedidos-secondary { background:#edf2fa; color:#234775; border:1px solid #cbd5e1; }
      .pedidos-tool button[aria-pressed="true"] { background:#2457c5; color:white; border-color:#2457c5; }
      .pedidos-cycles button { flex:1 1 145px; white-space:normal; }
      .pedidos-cycles small { display:block; font-weight:400; }
      .pedidos-split {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,3fr);gap:18px;align-items:start}.pedidos-primary{min-width:0}
      @media(max-width:950px){.pedidos-split{grid-template-columns:minmax(0,1fr)}}
      .pedidos-country { max-width:260px; margin:12px 0; }
      .pedidos-auto-actions span { color:#54657d; }
      .pedidos-work-preview {box-sizing:border-box;padding:18px 24px;min-height:100vh;background:#fff}
      .pedidos-preview-window {box-sizing:border-box;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;color:inherit}
      .pedidos-preview-heading {display:flex;align-items:start;justify-content:space-between;gap:12px;border-bottom:1px solid #d6e0ee;padding-bottom:10px;margin-bottom:12px}
      .pedidos-preview-heading p {margin:0;color:#54657d}
      .pedidos-work-preview .pedidos-matrix {max-height:none;width:100%;overflow-x:auto}
      .pedidos-work-preview .pedidos-matrix th:not(:first-child), .pedidos-work-preview .pedidos-matrix td {white-space:nowrap}
      @media(max-width:640px){.pedidos-work-preview{padding:12px}.pedidos-preview-heading{align-items:center}}
      .pedidos-matrix th:first-child { position:sticky; left:0; min-width:220px; white-space:nowrap; background:#eef2f7; z-index:2; }
      .pedidos-matrix th, .pedidos-matrix td { padding:3px 7px; }
      .pedidos-matrix .pedidos-row-detail { padding:2px 0; min-height:26px; background:transparent; color:#172b4d; font-weight:500; }
      .pedidos-matrix input.pedidos-review-input { width:76px; padding:3px 5px; text-align:center; }
      .pedidos-matrix input[type=checkbox] { width:18px; }
      .pedidos-matrix .pedidos-group th { background:#dce7f4; font-weight:700; }
      .pedidos-matrix .pedidos-detail-content { white-space:normal; text-align:left; background:#f4f7fb; padding:12px; }
      .pedidos-farms { margin-bottom:12px; }
      .pedidos-split-toggle { flex-direction:row; align-items:center; margin-bottom:8px; }
      .pedidos-split-toggle input { width:18px; }
      .pedidos-matrix thead th:first-child { z-index:3; }
      .pedidos-matrix tbody th { top:auto; text-align:left; }
      .pedidos-matrix td { text-align:right; }
      .pedidos-matrix .pedidos-unit-basis, .pedidos-matrix .pedidos-stored-quantities { min-width:180px; max-width:280px; white-space:normal; text-align:left; overflow-wrap:anywhere; }
      .pedidos-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
      .pedidos-dialog { background:white; border-radius:12px; padding:20px 22px; width:min(720px, 100%); max-height:calc(100vh - 40px); overflow:auto; box-shadow:0 20px 60px rgba(0,0,0,.3); }
      .pedidos-dialog h3 { margin:0 0 8px; font-size:18px; } .pedidos-dialog > p { color:#54657d; margin:0 0 12px; }
      .pedidos-dialog-item { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:10px; }
      .pedidos-dialog-item small { font-weight:400; color:#54657d; }
      .pedidos-dialog-fields { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; }
      .pedidos-dialog-fields label { display:flex; flex-direction:column; gap:4px; font-size:13px; } .pedidos-dialog-fields em { color:#b45309; font-style:normal; font-size:12px; }
      .pedidos-dialog-fields input { width:120px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font:inherit; }
      .pedidos-dialog-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      .pedidos-product-saved { background:#ecfdf3; border:1px solid #86efac; border-radius:8px; padding:10px 12px; }
      .pedidos-manual-input { width:96px; padding:6px 8px; border:2px solid #b45309; border-radius:6px; font:inherit; text-align:right; background:white; }
      .pedidos-manual-state { margin:6px 0 0; font-weight:600; }
      .pedidos-row-blocked th, .pedidos-row-blocked td { background:#fff4e5; }
      .pedidos-blocked-tag { display:inline-block; margin-left:6px; padding:1px 6px; border-radius:999px; background:#b45309; color:white; font-size:11px; font-weight:700; }
      .pedidos-stored-quantities details { margin-top:4px; }
      .pedidos-stored-quantities summary { padding:4px 0; color:#2457c5; }
      .pedidos-stored-quantities ul { margin:4px 0; padding-left:18px; }
      :where(.pedidos-tool) button:focus-visible:where(:not(.kakao-additions *)), :where(.pedidos-tool) input:focus-visible:where(:not(.kakao-additions *)), :where(.pedidos-tool) select:focus-visible:where(:not(.kakao-additions *)), .pedidos-preview:focus-visible, :where(.pedidos-tool) summary:focus-visible:where(:not(.kakao-additions *)) { outline:3px solid #ee9700; outline-offset:3px; }
      .pedidos-heading { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; }
      .pedidos-heading h2 { font-size:18px; } .pedidos-heading p { margin:0; color:#54657d; }
      .pedidos-free { border-radius:6px; background:#e9f6ee; color:#21653e; padding:5px 10px; font-size:12.5px; font-weight:600; }
      .pedidos-guide { margin:0 0 20px; font-size:13px; color:#54657d; }
      .pedidos-totals { display:flex; gap:10px; flex-wrap:wrap; }
      .pedidos-totals span { padding:6px 10px; border-radius:6px; background:#edf3ff; color:#38577e; }
      .pedidos-totals strong { color:#17365f; font-size:16px; margin-left:6px; }
      :where(.pedidos-tool) h2:where(:not(.kakao-additions *)), :where(.pedidos-tool) h3:where(:not(.kakao-additions *)), :where(.pedidos-tool) h4:where(:not(.kakao-additions *)), :where(.pedidos-tool) h5:where(:not(.kakao-additions *)) { margin: 0 0 8px; } :where(.pedidos-tool) p:where(:not(.kakao-additions *)) { margin: 8px 0 14px; }
      :where(.pedidos-tool) fieldset:where(:not(.kakao-additions *)) { border: 1px solid #d5deeb; border-radius: 8px; padding: 16px; min-width: 0; background:#f8faff; }
      :where(.pedidos-tool) legend:where(:not(.kakao-additions *)) { font-weight:700; padding:0 6px; }
      .pedidos-fields { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
      :where(.pedidos-tool) label:where(:not(.kakao-additions *)) { display: flex; flex-direction: column; gap: 6px; font-weight: 600; min-width: 130px; }
      .pedidos-file { flex: 1 1 320px; min-width: 0; }
      :where(.pedidos-tool) input:where(:not(.kakao-additions *)), :where(.pedidos-tool) select:where(:not(.kakao-additions *)) { border: 1px solid #94a3b8; border-radius: 6px; padding: 9px; max-width: 100%; width: 100%; box-sizing: border-box; background: white; color: #1e293b; }
      :where(.pedidos-tool) input[type=number]:where(:not(.kakao-additions *)), :where(.pedidos-tool) input[type=text]:where(:not(.kakao-additions *)) { width: 150px; }
      :where(.pedidos-tool) button:where(:not(.kakao-additions *)) { border: 0; border-radius: 7px; padding: 10px 16px; min-height:38px; font:inherit; font-weight:600; background: #2457c5; color: white; cursor: pointer; white-space: nowrap; }
      :where(.pedidos-tool) button:disabled:where(:not(.kakao-additions *)) { opacity: .5; cursor: not-allowed; }
      .pedidos-note { color: #475569; font-size: 13.5px; }
      .pedidos-error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-warning { background: #fffbeb; color: #92400e; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-result { margin: 14px 0; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; min-width: 0; }
      .pedidos-result-heading { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
      .pedidos-result-heading > div { min-width: 0; overflow-wrap: anywhere; }
      :where(.pedidos-tool) summary:where(:not(.kakao-additions *)) { cursor: pointer; padding: 10px 0; }
      .pedidos-preview { overflow-x: auto; width: 100%; }
      :where(.pedidos-tool) table:where(:not(.kakao-additions *)) { border-collapse: separate; border-spacing: 0; width: max-content; table-layout:fixed; font-size: 14px; }
      :where(.pedidos-tool) th:where(:not(.kakao-additions *)), :where(.pedidos-tool) td:where(:not(.kakao-additions *)) { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
      :where(.pedidos-tool) th:where(:not(.kakao-additions *)) { position: sticky; top: 0; z-index: 1; background: #eef2f7; }
      :where(.pedidos-tool) tbody tr:nth-child(even):where(:not(.kakao-additions *)) { background: #f8fafc; }
      :where(.pedidos-tool) tbody tr:hover:where(:not(.kakao-additions *)) { background:#edf3ff; }
      @media (max-width: 600px) { :where(.pedidos-tool) label:where(:not(.kakao-additions *)) { flex: 1 1 100%; min-width: 0; } :where(.pedidos-tool) input:is([type=number],[type=text]):where(:not(.kakao-additions *)) { width: 100%; } }
    `}</style>
  </section>;
}
