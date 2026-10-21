import { useEffect, useRef, useState } from 'react';
import { collectOutput, combineOutputBooks, outputPrintHtml, outputWeeks, outputFileName } from '../lib/profitRangeOutput.mjs';
import { OUTPUT_COLUMNS_KEY } from '../lib/profitColumnPreferences.mjs';
import { useProfitColumnPreferences } from '../lib/useProfitColumnPreferences';

export default function ProfitRangeOutput(props) {
  return props.columnsReady === false ? null : <OutputControls {...props} />;
}

function OutputControls({ year, major, visibleCols, columnDefs, showCategory = true, beforeOutput, disabled }) {
  const screenColumns = [...(showCategory ? ['category'] : []), ...visibleCols.filter(key => key !== 'category')];
  const { columns: outputColumns, setColumns: setOutputColumns, ready: columnsReady, storageError } = useProfitColumnPreferences(OUTPUT_COLUMNS_KEY, columnDefs.map(c => c.key), screenColumns);
  const [selected, setSelected] = useState(major ? [major] : []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [ready, setReady] = useState(false);
  const controller = useRef(null);
  const frame = useRef(null);
  const choices = useRef(null);
  const columnChoices = useRef(null);
  const printButton = useRef(null);
  let weeks = [];
  try { weeks = outputWeeks(year, major); } catch { /* no loaded report */ }
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false); setProgress(''); setError(''); setPreview(''); setSelected(major ? [major] : []);
    return () => controller.current?.abort();
  }, [year, major]);
  const selectionSignature = `${outputColumns.join(',')}|${selected.join(',')}`;
  useEffect(() => { setPreview(''); setReady(false); setProgress(''); }, [selectionSignature]);

  async function run(kind) {
    if (controller.current || disabled || !columnsReady || !outputColumns.length || !selected.length) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setPreview(''); setReady(false);
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
        setProgress(`${items.length}개 차수 인쇄 미리보기 준비 완료`);
      }
    } catch (e) {
      if (controller.current === abort) {
        if (abort.signal.aborted) setProgress('출력을 취소했습니다.');
        else { setError(e.message); setProgress(''); }
      }
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  const buttonStyle = { padding: '7px 10px', border: '1px solid #94a3b8', borderRadius: 4, cursor: 'pointer', background: '#f8fafc', color: '#17365d' };
  const unavailable = disabled || busy || !columnsReady;
  const selectedText = [...selected].sort((a, b) => Number(a) - Number(b)).map(w => `${Number(w)}차`).join(', ');
  const closeOnEscape = (e, ref) => { if (e.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } };
  return <div style={{ flexBasis: '100%', padding: '8px 0' }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <details ref={columnChoices} onKeyDown={e => closeOnEscape(e, columnChoices)}>
        <summary style={{ cursor: 'pointer', padding: 7 }}>엑셀·인쇄 항목 ({outputColumns.length}/{columnDefs.length})</summary>
        <fieldset disabled={unavailable} style={{ margin: '8px 0', maxWidth: 850 }}>
          <legend>출력할 항목 선택 · 화면 컬럼과 별도 저장</legend>
          <button type="button" style={buttonStyle} onClick={() => setOutputColumns(columnDefs.map(c => c.key))}>항목 전체 선택</button>{' '}
          <button type="button" style={buttonStyle} onClick={() => setOutputColumns([])}>항목 선택 해제</button>{' '}
          <button type="button" style={buttonStyle} onClick={() => setOutputColumns(screenColumns)}>현재 화면 컬럼 가져오기</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 0' }}>{columnDefs.map(c => <label key={c.key}>
            <input type="checkbox" checked={outputColumns.includes(c.key)} onChange={e => setOutputColumns(old => e.target.checked ? [...old, c.key] : old.filter(k => k !== c.key))} />{c.label}
          </label>)}</div>
          <p role="status" style={{ margin: 0 }}>{storageError || '자동 저장 · 같은 브라우저에서 다시 열어도 이 선택을 유지합니다.'}</p>
        </fieldset>
      </details>
      <button style={buttonStyle} onClick={() => run('excel')} disabled={unavailable || !selected.length || !weeks.length || !outputColumns.length}>엑셀 다운로드 ({selected.length}개 차수 · {selected.length}개 시트)</button>
      <details ref={choices} onKeyDown={e => closeOnEscape(e, choices)}>
        <summary style={{ cursor: 'pointer', padding: 7 }}>엑셀·인쇄 차수 선택 ({selected.length}개)</summary>
        <fieldset disabled={unavailable} style={{ margin: '8px 0', maxWidth: 850 }}>
          <legend>{year}년 · 다운로드·인쇄할 차수</legend>
          <button type="button" style={buttonStyle} onClick={() => setSelected(weeks)}>전체 선택</button>{' '}
          <button type="button" style={buttonStyle} onClick={() => setSelected([major])}>현재 차수만</button>{' '}
          <button type="button" style={buttonStyle} onClick={() => setSelected([])}>선택 해제</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '10px 0' }}>{weeks.map(w => <label key={w}>
            <input type="checkbox" checked={selected.includes(w)} onChange={e => setSelected(old => e.target.checked ? [...old, w] : old.filter(v => v !== w))} />{Number(w)}차
          </label>)}</div>
          <p>출력 대상: {selectedText || '선택 없음'} · 총 {selected.length}개 차수만 조회·다운로드·인쇄합니다.</p>
          <button ref={printButton} style={buttonStyle} onClick={() => run('print')} disabled={!selected.length || !outputColumns.length}>선택 차수 인쇄 미리보기 ({selected.length}개)</button>
          <p style={{ margin: '8px 0 0' }}>위의 엑셀·인쇄 항목 선택을 적용합니다. A3 가로 기준이며 인쇄창에서 용지를 변경할 수 있습니다.</p>
        </fieldset>
      </details>
      {busy && <button style={buttonStyle} onClick={() => controller.current?.abort()}>출력 취소</button>}
      <span role="status">{progress}</span>
    </div>
    <p style={{ margin: '6px 0' }}>엑셀·미리보기·인쇄 모두 체크한 {selected.length}개 차수만 처리합니다. 전체 선택은 1~{Number(major) || '조회'}차 전체입니다. 항목 {outputColumns.length}개 선택.</p>
    {!selected.length && <p role="alert">출력할 차수를 1개 이상 선택하세요.</p>}
    {!outputColumns.length && <p role="alert">출력할 항목을 1개 이상 선택하세요.</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error} · 부분 파일은 생성하지 않았습니다. 다시 시도하세요.</p>}
    {preview && <div>
      <button style={buttonStyle} disabled={!ready || unavailable} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}>인쇄</button>{' '}
      <button style={buttonStyle} onClick={() => { setPreview(''); printButton.current?.focus(); }}>미리보기 닫기</button>
      <iframe ref={frame} title="선택 차수 인쇄 미리보기" srcDoc={preview} onLoad={() => setReady(true)} style={{ width: '100%', height: '70vh', border: '1px solid #94a3b8', marginTop: 8 }} />
    </div>}
  </div>;
}
