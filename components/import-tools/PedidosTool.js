import React, { useState } from 'react';
import { PEDIDOS_COUNTRIES, generatePedidos, readPedidosWorkbook, sanitizePedidosWeek, serializePedidosWorkbook } from '../../lib/importPedidos';

// Native React, browser-only file conversion. Parent owns menu and shared storage.
export default function PedidosTool() {
  const [country, setCountry] = useState('');
  const [year, setYear] = useState('');
  const [week, setWeek] = useState('');
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [context, setContext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState('');

  function invalidate(setter, value) {
    setter(value); setResults(null); setContext(null); setError(''); setDownloaded('');
  }

  async function convert(event) {
    event.preventDefault(); setError(''); setResults(null); setDownloaded('');
    if (!country || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999 || !file) {
      setError('국가, 4자리 연도, 차수와 Excel 파일을 선택하세요.'); return;
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('.xlsx 또는 .xls 파일을 선택하세요.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('20MB 이하 파일을 사용하세요.'); return; }
    setBusy(true);
    try {
      const cleanWeek = sanitizePedidosWeek(week);
      const workbook = readPedidosWorkbook(await file.arrayBuffer());
      const outputs = generatePedidos(workbook, country, cleanWeek);
      setContext({ country, year, week: cleanWeek, sourceName: file.name });
      setResults(outputs);
    } catch (err) { setError(err.message || '파일 변환에 실패했습니다.'); }
    finally { setBusy(false); }
  }

  function download(output) {
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
    <h2>국가별 발주서</h2>
    <p>파일은 브라우저 안에서만 변환됩니다. ERP 주문·입고·재고 등록이나 공동 저장을 하지 않습니다.</p>
    <form onSubmit={convert}>
      <fieldset disabled={busy}>
        <legend>변환할 원본 선택</legend>
        <div className="pedidos-fields">
          <label>국가<select value={country} onChange={event => invalidate(setCountry, event.target.value)} required>
            <option value="">국가 선택</option>{PEDIDOS_COUNTRIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>연도<input type="number" min="1900" max="9999" step="1" placeholder="2026" value={year} onChange={event => invalidate(setYear, event.target.value)} required /></label>
          <label>차수<input type="text" placeholder="34-1" value={week} onChange={event => invalidate(setWeek, event.target.value)} required /></label>
          <label className="pedidos-file">Excel 원본 (.xlsx / .xls, 최대 20MB)<input type="file" accept=".xlsx,.xls" onChange={event => invalidate(setFile, event.target.files?.[0] ?? null)} required /></label>
          <button type="submit" disabled={!country || !year || !week.trim() || !file}>미리보기 생성</button>
        </div>
      </fieldset>
    </form>
    <p className="pedidos-note">활성 시트 정보가 있으면 해당 시트만, 없으면 첫 시트만 읽습니다. 연도는 작업 확인용이며 원본 파일명·시트명은 차수 기준으로 유지합니다. 차수의 공백·구두점은 원본 규칙대로 제거됩니다.</p>
    {busy && <p role="status">Excel을 읽고 발주서를 생성하고 있습니다…</p>}
    {error && <p role="alert" className="pedidos-error">{error}</p>}
    {downloaded && <p role="status">{downloaded}</p>}
    {results !== null && <div aria-live="polite">
      <h3>출력 파일 {results.length}개</h3>
      <p>{context.country} · {context.year}년 · {context.week}차 · {context.sourceName}</p>
      {noItems && <p role="status" className="pedidos-warning">변환할 품목이 없습니다. 선택 국가와 원본 시트·양식을 확인하세요. 일부 국가의 원본 규칙은 합계만 있는 빈 파일을 생성합니다.</p>}
      {results.map(output => <article className="pedidos-result" key={output.filename}>
        <div className="pedidos-result-heading">
          <div><h4>{output.filename}</h4><p>시트: {output.workbook.SheetNames[0]} · 원본: {output.sourceSheet} · {output.itemCount}품목 · 합계 {output.totalQuantity} {output.unit}{output.totalBoxes != null ? ` · ${output.totalBoxes} cajas` : ''}</p></div>
          <button type="button" onClick={() => download(output)}>Excel 다운로드</button>
        </div>
        {output.warnings.length > 0 && <div className="pedidos-warning"><h5>확인 필요</h5><ul>{output.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        {output.itemCount > 0 && <details><summary>품목 미리보기 ({output.itemCount}개, 수식 계산값 표시)</summary>
          <div className="pedidos-preview" tabIndex={0} role="region" aria-label={`${output.filename} 품목 표`}>
            <table><thead><tr>{output.preview.headers.map((header, i) => <th key={i} scope="col">{header}</th>)}</tr></thead>
              <tbody>{output.preview.rows.map((row, i) => <tr key={i}>{row.map((cell, c) => <td key={c}>{cell == null ? '' : String(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>}
      </article>)}
      <p className="pedidos-note">Cambios는 빈칸으로 유지됩니다. 다운로드 파일에는 원본 수식과 초기 계산값이 포함되며, Excel에서 편집하면 자동 재계산됩니다. 다운로드 저장 위치는 브라우저 설정을 따릅니다.</p>
    </div>}
    <style jsx>{`
      .pedidos-tool { width: 100%; min-width: 0; color: #1e293b; }
      h2, h3, h4, h5 { margin: 0 0 8px; } p { margin: 8px 0 14px; }
      fieldset { border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; min-width: 0; }
      .pedidos-fields { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
      label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; min-width: 130px; }
      .pedidos-file { flex: 1 1 320px; min-width: 0; }
      input, select { border: 1px solid #94a3b8; border-radius: 6px; padding: 9px; max-width: 100%; width: 100%; box-sizing: border-box; background: white; color: #1e293b; }
      input[type=number], input[type=text] { width: 150px; }
      button { border: 0; border-radius: 6px; padding: 11px 16px; background: #1f4e79; color: white; cursor: pointer; white-space: nowrap; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .pedidos-note { color: #64748b; font-size: 13px; }
      .pedidos-error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-warning { background: #fffbeb; color: #92400e; padding: 12px; overflow-wrap: anywhere; }
      .pedidos-result { margin: 14px 0; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; min-width: 0; }
      .pedidos-result-heading { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
      .pedidos-result-heading > div { min-width: 0; overflow-wrap: anywhere; }
      summary { cursor: pointer; padding: 10px 0; }
      .pedidos-preview { max-height: 430px; overflow: auto; width: 100%; }
      table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
      th, td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
      th { position: sticky; top: 0; z-index: 1; background: #eef2f7; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      @media (max-width: 600px) { label { flex: 1 1 100%; min-width: 0; } input[type=number], input[type=text] { width: 100%; } }
    `}</style>
  </section>;
}
