import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PEDIDOS_COUNTRIES, generatePedidos, generatePedidosFromMatrix, readPedidosWorkbook, sanitizePedidosWeek, serializePedidosWorkbook } from '../../lib/importPedidos';
import { buildCountryOrderMatrix } from '../../lib/countryOrderSource';
import { createCountryOrderRequestGuard } from '../../lib/countryOrderPedidosAdapter';
import { importCountryLabel, importUnitLabel, importColumnLabel } from '../../lib/importToolsDisplay';

// Native React, browser-only file conversion. Parent owns menu and shared storage.
export default function PedidosTool({ active = true }) {
  const [sourceMode, setSourceMode] = useState('erp');
  const [cycles, setCycles] = useState([]);
  const [cycleKey, setCycleKey] = useState('');
  const [orderWeek, setOrderWeek] = useState('');
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

  function clearResults() {
    contextGeneration.current += 1;
    setResults(null); setContext(null); setError(''); setDownloaded(''); setBusy(false);
  }
  function invalidate(setter, value) {
    clearResults(); setter(value);
  }
  function changeSource(value) {
    if (value === sourceMode) return;
    requestGuard.current.invalidate(); setResponse(null); setLoading(false);
    invalidate(setSourceMode, value);
  }
  function changeCountry(value) {
    requestGuard.current.invalidate(); setResponse(null); setOrderWeek(''); setLoading(false);
    invalidate(setCountry, value);
  }
  function changeCycle(value) {
    if (value === cycleKey) return;
    requestGuard.current.invalidate(); setResponse(null); setOrderWeek(''); setLoading(false);
    invalidate(setCycleKey, value);
  }

  useEffect(() => {
    clearResults(); setResponse(null); setOrderWeek('');
    if (!active || sourceMode !== 'erp') { requestGuard.current.invalidate(); setLoading(false); return; }
    const selected = cycles.find(cycle => cycle.key === cycleKey) ?? cycles[0];
    const scopeKey = country && selected ? `${country}/${selected.key}` : null;
    const request = requestGuard.current.begin(scopeKey);
    const params = new URLSearchParams();
    if (country) params.set('country', country);
    if (country && cycleKey && selected) { params.set('year', String(selected.year)); params.set('majorWeek', selected.majorWeek); }
    setLoading(true);
    (async () => {
      try {
        const result = await fetch(`/api/import/tools/country-orders${params.size ? `?${params}` : ''}`, { signal: request.signal, cache: 'no-store' });
        const body = await result.json();
        if (request.signal.aborted) return;
        if (!result.ok || !body.success) throw new Error(body.message || body.error || '전산 주문 조회에 실패했습니다. 다시 조회하세요.');
        if (!request.accepts(body)) throw new Error('조회 범위가 현재 선택과 다릅니다. 다시 조회하세요.');
        if (!Array.isArray(body.cycles) || body.cycles.length !== 6 || !Array.isArray(body.rows) || !Array.isArray(body.subweeks)) throw new Error('전산 조회 응답이 불완전합니다. 다시 조회하세요.');
        setCycles(body.cycles); setResponse(country ? body : null);
        setOrderWeek(body.subweeks[0]?.orderWeek ?? '');
      } catch (err) {
        if (!request.signal.aborted) { setResponse(null); setError(err.message || '전산 주문 조회에 실패했습니다.'); }
      } finally { if (!request.signal.aborted) setLoading(false); }
    })();
    return () => requestGuard.current.invalidate();
    // cycles are response metadata, never an additional query trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sourceMode, country, cycleKey, reload]);

  const matrixState = useMemo(() => {
    if (!response || !orderWeek || loading) return { matrix: null, error: '' };
    try { return { matrix: buildCountryOrderMatrix(response, orderWeek), error: '' }; }
    catch (err) { return { matrix: null, error: err.message || '전산 행렬을 확인하지 못했습니다.' }; }
  }, [response, orderWeek, loading]);
  const matrix = matrixState.matrix;
  const selectedCycle = cycles.find(cycle => cycle.key === cycleKey) ?? cycles[0];
  const matchesScope = Boolean(matrix && response?.scope?.scopeKey === `${country}/${selectedCycle?.key}` && matrix.scope.country === country && matrix.scope.year === selectedCycle?.year && matrix.scope.orderWeek === orderWeek);
  const canGenerate = active && !loading && !busy && matchesScope && matrix.blockers.length === 0;

  function convertMatrix() {
    clearResults();
    if (!canGenerate) return;
    try {
      const outputs = generatePedidosFromMatrix(matrix);
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

  function download(output) {
    if (!active || loading || busy || !results?.includes(output) || (sourceMode === 'erp' && !canGenerate)) return;
    setError('');
    let url;
    try {
      const bytes = serializePedidosWorkbook(output.workbook);
      url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = output.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setDownloaded(`${output.filename} 다운로드를 요청했습니다.`);
    } catch (err) { setError(`다운로드 실패: ${err.message}`); }
    finally { if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  const noItems = results !== null && (results.length === 0 || results.every(output => output.itemCount === 0));
  return <section className="pedidos-tool" aria-label="국가별 발주서 파일 변환">
    <div className="pedidos-heading"><div><h2>국가별 발주서</h2><p>전산 원주문 또는 Excel 원본을 기존 국가별 양식으로 내려받으세요.</p></div><span className="pedidos-free">전산 읽기 전용 · 원장 변경 없음</span></div>
    <div className="pedidos-source" role="group" aria-label="발주 수량 원천">
      <button type="button" aria-pressed={sourceMode === 'erp'} onClick={() => changeSource('erp')}>전산에서 자동 불러오기</button>
      <button type="button" aria-pressed={sourceMode === 'upload'} onClick={() => changeSource('upload')}>Excel 원본 업로드</button>
    </div>
    {sourceMode === 'erp' ? <div className="pedidos-auto">
      <label className="pedidos-country">국가<select value={country} disabled={!cycles.length} onChange={event => changeCountry(event.target.value)}><option value="">국가 선택</option>{PEDIDOS_COUNTRIES.map(value => <option key={value} value={value}>{importCountryLabel(value)}</option>)}</select></label>
      <div className="pedidos-cycles" role="group" aria-label="오늘부터 다음 5개 대차수">{cycles.map(cycle => <button type="button" key={cycle.key} aria-pressed={selectedCycle?.key === cycle.key} onClick={() => changeCycle(cycle.key)}>{cycle.year} {cycle.majorWeek}차 <small>{cycle.startDate.slice(5).replace('-', '/')}–{cycle.endDate.slice(5).replace('-', '/')}</small></button>)}</div>
      <div className="pedidos-subweeks" role="group" aria-label="실제 주문 세부차수">{response?.subweeks.map(subweek => <button type="button" key={subweek.key} aria-pressed={orderWeek === subweek.orderWeek} onClick={() => invalidate(setOrderWeek, subweek.orderWeek)}>{subweek.orderWeek}차</button>)}</div>
      <div className="pedidos-auto-actions"><button type="button" disabled={!canGenerate} onClick={convertMatrix}>미리보기 생성</button><button type="button" className="pedidos-secondary" disabled={loading} onClick={() => { requestGuard.current.invalidate(); clearResults(); setResponse(null); setReload(value => value + 1); }}>다시 조회</button><span>{loading ? '전산 원주문 조회 중…' : response && !response.subweeks.length ? '선택 범위에 주문 없음' : !country ? '국가를 선택하면 자동으로 조회합니다.' : '세부차수의 원수량을 확인한 뒤 생성하세요.'}</span></div>
      {matrixState.error && <p role="alert" className="pedidos-error">{matrixState.error}</p>}
      {matrix && <>
        <p className="pedidos-note">{matrix.scope.year}년 {matrix.scope.orderWeek}차 · 품목 {matrix.rows.length}개 · 업체 {matrix.customers.length}개 · 수량을 환산하지 않은 원주문입니다.</p>
        {matrix.blockers.length > 0 && <div role="alert" className="pedidos-error"><strong>수량 확인 필요 · 파일 생성 차단</strong><ul>{matrix.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
        {matrix.warnings.length > 0 && <div className="pedidos-warning"><strong>확인 필요</strong><ul>{matrix.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
        <div className="pedidos-preview pedidos-matrix" tabIndex={0} role="region" aria-label="전산 품목별 업체 원수량 행렬"><table><thead><tr><th scope="col">품목</th><th scope="col">단위</th>{matrix.customers.map(customer => <th scope="col" key={customer.key} title={`${customer.name} · ${customer.key}`}>{customer.label}</th>)}<th scope="col">합계</th></tr></thead><tbody>{matrix.rows.map(row => <tr key={row.key}><th scope="row">{row.label ?? row.name}</th><td>{country === 'Netherlands' ? '스팀(송이)' : importUnitLabel(row.unit)}</td>{matrix.customers.map(customer => <td key={customer.key}>{(row.quantities[customer.key] ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 20 })}</td>)}<td><strong>{row.total.toLocaleString('ko-KR', { maximumFractionDigits: 20 })}</strong></td></tr>)}</tbody></table></div>
      </>}
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
    <p className="pedidos-note">주문·입고·재고에 자동 등록되지 않습니다. 원본 파일과 다운로드 양식은 유지됩니다.</p>
    <details className="pedidos-guide"><summary>지원 양식과 변환 기준 보기</summary><p>기존 양식은 활성 시트(없으면 첫 시트)를 읽습니다. 중국 행렬은 수량원본과 구조화 시트의 업체키·품목키·숫자 수량을 사용하며 선택 연도·차수를 확인합니다. 파일명·시트명은 차수 기준으로 유지합니다. 차수의 공백·구두점은 원본 규칙대로 제거됩니다.</p></details>
    {busy && <p role="status">Excel을 읽고 발주서를 생성하고 있습니다…</p>}
    {error && <p role="alert" className="pedidos-error">{error}</p>}
    {downloaded && <p role="status">{downloaded}</p>}
    {results !== null && <div aria-live="polite">
      <h3>2. 변환 결과 · 파일 {results.length}개</h3>
      <p>{importCountryLabel(context.country)} · {context.year}년 · {context.week}차 · {context.sourceName}</p>
      {noItems && <p role="status" className="pedidos-warning">변환할 품목이 없습니다. 선택 국가와 원본 시트·양식을 확인하세요. 일부 국가의 원본 규칙은 합계만 있는 빈 파일을 생성합니다.</p>}
      {results.map(output => <article className="pedidos-result" key={output.filename}>
        <div className="pedidos-result-heading">
          <div><h4>{output.filename}</h4><p>시트: {output.workbook.SheetNames[0]} · 원본: {output.sourceSheet}</p><div className="pedidos-totals"><span>품목 <strong>{output.itemCount.toLocaleString('ko-KR')}개</strong></span><span>총수량 <strong>{output.totalQuantity.toLocaleString('ko-KR',{maximumFractionDigits:20})} {importUnitLabel(output.unit)}</strong></span>{output.totalBoxes != null&&<span>박스 <strong>{output.totalBoxes.toLocaleString('ko-KR',{maximumFractionDigits:20})}</strong></span>}</div></div>
          <button type="button" onClick={() => download(output)}>엑셀 다운로드</button>
        </div>
        {output.totalQuantity === 0 && <p role="status" className="pedidos-note">숫자 원본의 합계가 0입니다. 정상적인 0 수량 결과도 다운로드할 수 있습니다.</p>}
        {output.warnings.length > 0 && <div className="pedidos-warning"><h5>확인 필요</h5><ul>{output.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        {output.itemCount > 0 && <details><summary>품목 미리보기 ({output.itemCount}개, 수식 계산값 표시)</summary>
          <div className="pedidos-preview" tabIndex={0} role="region" aria-label={`${output.filename} 품목 표`}>
            <table><colgroup>{output.preview.headers.map((_,i)=><col key={i} style={{width:i===0?320:120}}/>)}</colgroup><thead><tr>{output.preview.headers.map((header, i) => <th key={i} scope="col" title={String(header)}>{importColumnLabel(header)}</th>)}</tr></thead>
              <tbody>{output.preview.rows.map((row, i) => <tr key={i}>{row.map((cell, c) => <td key={c}>{cell == null ? '' : String(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>}
      </article>)}
      <p className="pedidos-note">변경량(Cambios)은 빈칸으로 유지됩니다. 다운로드 파일에는 원본 수식과 초기 계산값이 포함되며, 엑셀에서 편집하면 자동 재계산됩니다. 저장 위치는 브라우저 설정을 따릅니다.</p>
    </div>}
    <style jsx>{`
      .pedidos-tool { width: 100%; min-width: 0; color: #172b4d; font-size:14px; line-height:1.5; }
      .pedidos-source, .pedidos-cycles, .pedidos-subweeks, .pedidos-auto-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; }
      .pedidos-source button, .pedidos-cycles button, .pedidos-subweeks button, .pedidos-secondary { background:#edf2fa; color:#234775; border:1px solid #cbd5e1; }
      button[aria-pressed=true] { background:#2457c5; color:white; border-color:#2457c5; }
      .pedidos-cycles button { flex:1 1 145px; white-space:normal; }
      .pedidos-cycles small { display:block; font-weight:400; }
      .pedidos-country { max-width:260px; margin:12px 0; }
      .pedidos-auto-actions span { color:#54657d; }
      .pedidos-matrix th:first-child { position:sticky; left:0; min-width:300px; max-width:440px; white-space:normal; background:#eef2f7; z-index:2; }
      .pedidos-matrix thead th:first-child { z-index:3; }
      .pedidos-matrix tbody th { top:auto; text-align:left; }
      .pedidos-matrix td { text-align:right; }
      button:focus-visible, input:focus-visible, select:focus-visible, .pedidos-preview:focus-visible, summary:focus-visible { outline:3px solid #ee9700; outline-offset:3px; }
      .pedidos-heading { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; }
      .pedidos-heading h2 { font-size:18px; } .pedidos-heading p { margin:0; color:#54657d; }
      .pedidos-free { border-radius:6px; background:#e9f6ee; color:#21653e; padding:5px 10px; font-size:12px; font-weight:600; }
      .pedidos-guide { margin:0 0 20px; font-size:13px; color:#54657d; }
      .pedidos-totals { display:flex; gap:10px; flex-wrap:wrap; }
      .pedidos-totals span { padding:6px 10px; border-radius:6px; background:#edf3ff; color:#38577e; }
      .pedidos-totals strong { color:#17365f; font-size:16px; margin-left:6px; }
      h2, h3, h4, h5 { margin: 0 0 8px; } p { margin: 8px 0 14px; }
      fieldset { border: 1px solid #d5deeb; border-radius: 8px; padding: 16px; min-width: 0; background:#f8faff; }
      legend { font-weight:700; padding:0 6px; }
      .pedidos-fields { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
      label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; min-width: 130px; }
      .pedidos-file { flex: 1 1 320px; min-width: 0; }
      input, select { border: 1px solid #94a3b8; border-radius: 6px; padding: 9px; max-width: 100%; width: 100%; box-sizing: border-box; background: white; color: #1e293b; }
      input[type=number], input[type=text] { width: 150px; }
      button { border: 0; border-radius: 7px; padding: 10px 16px; min-height:38px; font:inherit; font-weight:600; background: #2457c5; color: white; cursor: pointer; white-space: nowrap; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .pedidos-note { color: #64748b; font-size: 13px; }
      .pedidos-error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-warning { background: #fffbeb; color: #92400e; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-result { margin: 14px 0; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; min-width: 0; }
      .pedidos-result-heading { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
      .pedidos-result-heading > div { min-width: 0; overflow-wrap: anywhere; }
      summary { cursor: pointer; padding: 10px 0; }
      .pedidos-preview { overflow-x: auto; width: 100%; }
      table { border-collapse: separate; border-spacing: 0; width: max-content; table-layout:fixed; font-size: 14px; }
      th, td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
      th { position: sticky; top: 0; z-index: 1; background: #eef2f7; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      tbody tr:hover { background:#edf3ff; }
      @media (max-width: 600px) { label { flex: 1 1 100%; min-width: 0; } input[type=number], input[type=text] { width: 100%; } }
    `}</style>
  </section>;
}
