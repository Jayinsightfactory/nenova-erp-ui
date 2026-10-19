import { useEffect, useRef, useState } from 'react';
import { collectOutput, combineOutputBooks, outputPrintHtml, outputWeeks } from '../lib/profitRangeOutput.mjs';

export default function ProfitRangeOutput({ year, major, visibleCols, beforeOutput, disabled }) {
  const [selected, setSelected] = useState([major]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [ready, setReady] = useState(false);
  const controller = useRef(null);
  const frame = useRef(null);
  const choices = useRef(null);
  const printButton = useRef(null);
  let weeks = [];
  try { weeks = outputWeeks(year, major); } catch { /* no loaded report */ }
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false); setProgress(''); setError(''); setPreview(''); setSelected([major]);
    return () => controller.current?.abort();
  }, [year, major]);

  async function run(kind) {
    if (controller.current || disabled) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setPreview(''); setReady(false);
    try {
      if (beforeOutput && !(await beforeOutput())) return;
      abort.signal.throwIfAborted();
      const { default: XLSX } = await import('xlsx-js-style');
      const items = await collectOutput({ year, major, selected: kind === 'print' ? selected : undefined, signal: abort.signal,
        onProgress: ({ done, total, week }) => setProgress(`${done}/${total}차 완료 · ${Number(week)}차 조회`),
        fetchWeek: async (y, w, signal) => {
          const cols = visibleCols.filter(k => k !== 'category').join(',');
          const res = await fetch(`/api/sales/profit-report-output?year=${encodeURIComponent(y)}&week=${w}&cols=${encodeURIComponent(cols)}`, { credentials: 'same-origin', signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();
          if (!result.success) throw new Error(result.error || '조회 실패');
          return result;
        },
      });
      abort.signal.throwIfAborted();
      if (kind === 'excel') {
        const bytes = XLSX.write(combineOutputBooks(items), { type: 'array', bookType: 'xlsx', cellStyles: true });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = `매출이익_${year}_01-${major}차.xlsx`;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setProgress(`1~${Number(major)}차 엑셀 생성 완료`);
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
  return <div style={{ flexBasis: '100%', padding: '8px 0' }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button style={buttonStyle} onClick={() => run('excel')} disabled={disabled || busy || !weeks.length}>엑셀 다운로드 (1~{Number(major) || '선택'}차)</button>
      <details ref={choices} onKeyDown={e => { if (e.key === 'Escape') { choices.current.open = false; choices.current.querySelector('summary')?.focus(); } }}>
        <summary style={{ cursor: 'pointer', padding: 7 }}>인쇄 차수 선택</summary>
        <fieldset disabled={disabled || busy} style={{ margin: '8px 0', maxWidth: 850 }}>
          <legend>{year}년 · 인쇄할 차수</legend>
          <button type="button" style={buttonStyle} onClick={() => setSelected(weeks)}>전체 선택</button>{' '}
          <button type="button" style={buttonStyle} onClick={() => setSelected([])}>선택 해제</button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '10px 0' }}>{weeks.map(w => <label key={w}>
            <input type="checkbox" checked={selected.includes(w)} onChange={e => setSelected(old => e.target.checked ? [...old, w] : old.filter(v => v !== w))} />{Number(w)}차
          </label>)}</div>
          <button ref={printButton} style={buttonStyle} onClick={() => run('print')} disabled={!selected.length}>선택 차수 인쇄 미리보기</button>
          <p style={{ margin: '8px 0 0' }}>현재 표시열로 인쇄합니다. A3 가로 기준이며 인쇄창에서 용지를 변경할 수 있습니다.</p>
        </fieldset>
      </details>
      {busy && <button style={buttonStyle} onClick={() => controller.current?.abort()}>출력 취소</button>}
      <span role="status">{progress}</span>
    </div>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error} · 부분 파일은 생성하지 않았습니다. 다시 시도하세요.</p>}
    {preview && <div>
      <button style={buttonStyle} disabled={!ready} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}>인쇄</button>{' '}
      <button style={buttonStyle} onClick={() => { setPreview(''); printButton.current?.focus(); }}>미리보기 닫기</button>
      <iframe ref={frame} title="선택 차수 인쇄 미리보기" srcDoc={preview} onLoad={() => setReady(true)} style={{ width: '100%', height: '70vh', border: '1px solid #94a3b8', marginTop: 8 }} />
    </div>}
  </div>;
}
