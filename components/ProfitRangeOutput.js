import { useEffect, useRef, useState } from 'react';
import { collectOutput, combineOutputBooks, outputPrintHtml, availableOutputWeeks, outputFileName } from '../lib/profitRangeOutput.mjs';
import { OUTPUT_COLUMNS_KEY } from '../lib/profitColumnPreferences.mjs';
import { useProfitColumnPreferences } from '../lib/useProfitColumnPreferences';
import { fitProfitPrintDocument, navigateProfitCheckboxes } from '../lib/profitPrintLayout.mjs';

export default function ProfitRangeOutput(props) {
  return props.columnsReady === false ? null : <OutputControls {...props} />;
}

function OutputControls({ year, major, visibleCols, columnDefs, showCategory = true, beforeOutput, disabled, toolbarClassName, buttonClassName, rangeWeeks, requestScopeKey }) {
  const screenColumns = [...(showCategory ? ['category'] : []), ...visibleCols.filter(key => key !== 'category')];
  const { columns: outputColumns, setColumns: setOutputColumns, ready: columnsReady, storageError } = useProfitColumnPreferences(OUTPUT_COLUMNS_KEY, columnDefs.map(c => c.key), columnDefs.map(c => c.key));
  const [selected, setSelected] = useState(major ? [major] : []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const printRequest = useRef(0);
  const controller = useRef(null);
  const frame = useRef(null);
  const choices = useRef(null);
  const columnChoices = useRef(null);
  const printButton = useRef(null);
  let weeks = [];
  try { weeks = availableOutputWeeks(year, major, rangeWeeks); } catch { /* no loaded report */ }
  const rangeSignature = rangeWeeks?.join(',');
  const selectionAllowed = selected.length > 0 && selected.every(w=>weeks.includes(w));
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    printRequest.current += 1;
    setBusy(false); setProgress(''); setError(''); setPreview(''); setSelected(rangeWeeks === undefined ? (major ? [major] : []) : weeks);
    return () => controller.current?.abort();
    // Range values are normalized by the parent; reset only when its loaded scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, major, rangeSignature]);
  useEffect(() => {
    if (requestScopeKey === undefined) return;
    controller.current?.abort(); controller.current = null;
    printRequest.current += 1;
    setBusy(false); setPreview(''); setProgress('');
  }, [requestScopeKey]);
  const selectionSignature = `${outputColumns.join(',')}|${selected.join(',')}`;
  useEffect(() => { printRequest.current += 1; setPreview(''); setProgress(''); }, [selectionSignature]);

  async function run(kind) {
    if (controller.current || disabled || !columnsReady || !outputColumns.length || !selected.length || !selectionAllowed) return;
    const abort = new AbortController(); controller.current = abort;
    printRequest.current += 1;
    setBusy(true); setError(''); setPreview('');
    try {
      if (beforeOutput && !(await beforeOutput())) return;
      abort.signal.throwIfAborted();
      const { default: XLSX } = await import('xlsx-js-style');
      const items = await collectOutput({ year, major, selected, signal: abort.signal,
        onProgress: ({ done, total, week, retry }) => setProgress(`${done}/${total}차 완료 · ${Number(week)}차 ${retry ? `일시 오류 재시도 ${retry}/2 · 완료된 차수는 유지` : '조회'}`),
        fetchWeek: async (y, w, signal) => {
          const cols = outputColumns.filter(k => k !== 'category').join(',');
          const res = await fetch(`/api/sales/profit-report-output?year=${encodeURIComponent(y)}&week=${w}&cols=${encodeURIComponent(cols)}&category=${outputColumns.includes('category') ? '1' : '0'}`, { credentials: 'same-origin', signal });
          if (!res.ok) { const error = new Error(`HTTP ${res.status}`); error.status = res.status; throw error; }
          const result = await res.json();
          if (!result.success) throw new Error(result.error || '조회 실패');
          return result;
        },
      });
      abort.signal.throwIfAborted();
      if (kind === 'excel') {
        const bytes = XLSX.write(combineOutputBooks(items), { type: 'array', bookType: 'xlsx', cellStyles: true });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = outputFileName(year, major, items.map(item => item.major));
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setProgress(`선택한 ${items.length}개 차수 엑셀 생성 완료`);
      } else {
        setPreview(outputPrintHtml(items, ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })));
        setProgress(`${items.length}개 차수 · ${items.length}장 인쇄 준비 중…`);
      }
    } catch (e) {
      if (controller.current === abort) {
        if (abort.signal.aborted) setProgress('출력을 취소했습니다.');
        else { setError(e.message); setProgress(''); }
      }
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  const buttonStyle = buttonClassName ? undefined : { padding: '7px 10px', border: '1px solid #94a3b8', borderRadius: 4, cursor: 'pointer', background: '#f8fafc', color: '#17365d' };
  const unavailable = disabled || busy || !columnsReady;
  const selectedText = [...selected].sort((a, b) => Number(a) - Number(b)).map(w => `${Number(w)}차`).join(', ');
  const closeOnEscape = (e, ref) => { if (e.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } else navigateProfitCheckboxes(e); };
  async function printLoadedFrame() {
    const request = printRequest.current;
    const win = frame.current?.contentWindow;
    if (!win?.document.querySelector('.profit-print-page')) return;
    try {
      await win.document.fonts?.ready;
      if (request !== printRequest.current || frame.current?.contentWindow !== win) return;
      fitProfitPrintDocument(win.document);
      win.focus();
      win.print();
      setProgress(`선택한 ${selected.length}개 차수 · ${selected.length}장 인쇄창을 열었습니다.`);
      printButton.current?.focus();
    } catch {
      setError('인쇄창을 열지 못했습니다. 인쇄 버튼을 다시 눌러주세요.');
    }
  }
  return <div className={toolbarClassName} style={toolbarClassName ? { padding: 0 } : { flexBasis: '100%', padding: '8px 0' }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <details ref={columnChoices} style={{ maxWidth: '100%' }} onKeyDown={e => closeOnEscape(e, columnChoices)}>
        <summary className={buttonClassName} style={buttonClassName ? undefined : { cursor: 'pointer', padding: 7 }}>엑셀·인쇄 항목 ({outputColumns.length}/{columnDefs.length})</summary>
        <fieldset disabled={unavailable} style={{ margin: '8px 0', maxWidth: 850, minWidth: 0, boxSizing: 'border-box' }}>
          <legend>출력할 항목 선택 · 화면 컬럼과 별도 저장</legend>
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setOutputColumns(columnDefs.map(c => c.key))}>항목 전체 선택</button>{' '}
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setOutputColumns([])}>항목 선택 해제</button>{' '}
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setOutputColumns(screenColumns)}>현재 화면 컬럼 가져오기</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 0' }}>{columnDefs.map(c => <label key={c.key}>
            <input type="checkbox" checked={outputColumns.includes(c.key)} onChange={e => setOutputColumns(old => e.target.checked ? [...old, c.key] : old.filter(k => k !== c.key))} />{c.label}
          </label>)}</div>
          <p role="status" style={{ margin: 0 }}>{storageError || '자동 저장 · 같은 브라우저에서 다시 열어도 이 선택을 유지합니다.'}</p>
        </fieldset>
      </details>
      <button className={buttonClassName} style={buttonStyle} onClick={() => run('excel')} disabled={unavailable || !selected.length || !weeks.length || !outputColumns.length}>엑셀 다운로드 ({selected.length}개 차수 · {selected.length}개 시트)</button>
      <button data-testid="profit-print-button" ref={printButton} className={buttonClassName} style={buttonStyle} onClick={() => run('print')} disabled={unavailable || !selected.length || !weeks.length || !outputColumns.length}>인쇄 ({selected.length}개 차수 · {selected.length}장)</button>
      <details data-testid="profit-output-weeks" ref={choices} style={{ maxWidth: '100%' }} onKeyDown={e => closeOnEscape(e, choices)}>
        <summary className={buttonClassName} style={buttonClassName ? undefined : { cursor: 'pointer', padding: 7 }}>엑셀·인쇄 차수 선택 ({selected.length}개)</summary>
        <fieldset disabled={unavailable} style={{ margin: '8px 0', maxWidth: 850, minWidth: 0, boxSizing: 'border-box' }}>
          <legend>{year}년 · 다운로드·인쇄할 차수{rangeWeeks !== undefined ? ' (조회 범위 안)' : ''}</legend>
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setSelected(weeks)}>전체 선택</button>{' '}
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setSelected([major])}>현재 차수만</button>{' '}
          <button type="button" className={buttonClassName} style={buttonStyle} onClick={() => setSelected([])}>선택 해제</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '10px 0' }}>{weeks.map(w => <label key={w}>
            <input type="checkbox" checked={selected.includes(w)} onChange={e => setSelected(old => e.target.checked ? [...old, w] : old.filter(v => v !== w))} />{Number(w)}차
          </label>)}</div>
          <p>출력 대상: {selectedText || '선택 없음'} · 총 {selected.length}개 차수만 조회·다운로드·인쇄합니다.</p>
          <p style={{ margin: '8px 0 0' }}>A4 가로 · 차수당 한 장. 선택한 항목과 비고를 인쇄하며 상태 안내는 웹에서 확인합니다.</p>
        </fieldset>
      </details>
      {busy && <button className={buttonClassName} style={buttonStyle} onClick={() => controller.current?.abort()}>출력 취소</button>}
      <span role="status">{progress}</span>
    </div>
    <p style={{ margin: '6px 0' }}>엑셀·인쇄 모두 체크한 {selected.length}개 차수만 처리합니다. 전체 선택은 {rangeWeeks !== undefined ? `${Number(weeks[0]) || '조회'}~` : '1~'}{Number(major) || '조회'}차 전체입니다. 항목 {outputColumns.length}개 선택.</p>
    {!selected.length && <p role="alert">출력할 차수를 1개 이상 선택하세요.</p>}
    {!outputColumns.length && <p role="alert">출력할 항목을 1개 이상 선택하세요.</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error} · 부분 파일은 생성하지 않았습니다. 다시 시도하세요.</p>}
    {preview && <iframe data-testid="profit-print-frame" ref={frame} title="선택 차수 인쇄" srcDoc={preview} onLoad={printLoadedFrame} tabIndex={-1} aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 1200, height: 800, border: 0 }} />}
  </div>;
}
