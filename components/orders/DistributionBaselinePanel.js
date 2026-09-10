import { useRef, useState } from 'react';
import { parseDistributionBaseline, validateSelectedScope } from '../../lib/distributionBaseline';

const steps = ['기준 엑셀 확인', '기준 보관', '카톡 입력·분석', '변경 검토', '기존 등록·분배', '처리 결과'];
export default function DistributionBaselinePanel({ week, parsing, running, hasAnalysis, hasResult }) {
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState(null);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState('');
  const seq = useRef(0);
  const scope = useRef(week); scope.current = week;
  const matches = baseline && validateSelectedScope(baseline, week);
  const sheet = matches ? baseline.sheets[active] : null;
  const show = value => value === null || value === undefined || value === '' ? '—' : String(value);
  async function load(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    const id = ++seq.current, selected = week;
    setError(''); setBusy(true);
    try {
      if (!/^\d{4}-\d{2}-\w+$/.test(selected)) throw new Error('먼저 등록할 연도와 차수를 선택하세요.');
      if (file.size > 10485760) throw new Error('10MB 이하 엑셀을 선택하세요.');
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: true });
      const parsed = parseDistributionBaseline(workbook, { year: selected.slice(0,4), week: selected.slice(5), fileName: file.name });
      if (id !== seq.current || selected !== scope.current) return;
      setBaseline(parsed); setActive(0); setConfirmed('');
    } catch (err) { if (id === seq.current) setError(err.message || '엑셀을 읽지 못했습니다.'); }
    finally { if (id === seq.current) setBusy(false); }
  }
  function navigate(index) {
    if (index < 2) { setOpen(true); return; }
    const ids = ['','','paste-connected-input','paste-connected-preview','paste-connected-save','paste-connected-result'];
    const el = document.getElementById(ids[index]);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.focus({ preventScroll: true }); }
  }
  return <section className="baseline-panel" aria-label="물량표 연결 작업">
    <div className="baseline-toolbar">
      <button type="button" onClick={() => setOpen(v=>!v)} aria-expanded={open}>{open?'▾':'▸'} 물량표 연결해서 작업</button>
      <span>등록차수 {week || '미선택'}</span>
      <span className="baseline-note">기존 분석·등록 기능을 그대로 사용 · 엑셀 자동 덮어쓰기 없음</span>
    </div>
    {open && <>
      <nav className="baseline-steps" aria-label="작업 순서">{steps.map((label,i)=><button key={label} type="button" disabled={(i===3||i===4)&&!hasAnalysis || i===5&&!hasResult} onClick={()=>navigate(i)}>{i+1}. {label}{i===2&&parsing?' 중…':i===4&&running?' 중…':''}</button>)}</nav>
      <div className="baseline-toolbar">
        <label className="baseline-upload">{busy?'읽는 중…':'기준 엑셀 선택'}<input type="file" accept=".xlsx" onChange={load} disabled={busy||running} aria-label="기준 엑셀 선택" /></label>
        <button type="button" disabled={!matches||busy||running||baseline?.combinedUnknown} onClick={()=>setConfirmed(new Date().toLocaleString('ko-KR'))}>이 화면에서 기준 보관</button>
        <span>{confirmed&&matches?`기준 보관 ${confirmed}`:'기준 미보관'}</span>
        <input aria-label="물량표 품목 검색" placeholder="품목 검색" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>
      <p className="baseline-note">선택 파일은 브라우저에서만 읽습니다. 기준은 새로고침하면 사라집니다. 현재 전산 분배·카톡 변경과 자동 대조하는 기능은 아직 연결 전입니다.</p>
      {error&&<p role="alert">{error}</p>}
      {baseline&&!matches&&<p role="alert">선택 차수가 바뀌었습니다. 이전 기준표를 현재 차수에 적용하지 않습니다.</p>}
      {baseline?.combinedUnknown&&<p role="alert">02차 자료입니다. 01·02 합산 여부와 세부 수량 확인 전에는 기준 보관·자동 합산하지 않습니다.</p>}
      {matches&&<div className="baseline-toolbar">{baseline.sheets.map((s,i)=><button key={s.id} type="button" aria-pressed={i===active} onClick={()=>setActive(i)}>{s.name}</button>)}</div>}
      {sheet&&<div className="baseline-scroll" tabIndex={0} aria-label="기준 물량표 가로 세로 스크롤"><table><thead><tr><th className="product">품목</th>{sheet.clients.map(c=><th key={c.id} title={c.label}>{c.label}<small>{c.day||'일정 미지정'}</small></th>)}<th className="remain">엑셀 잔량</th></tr></thead><tbody>{sheet.rows.filter(r=>r.label.toLowerCase().includes(search.toLowerCase())).map(r=><tr key={r.id}><td className="product" title={r.label}>{r.label}</td>{sheet.clients.map(c=><td key={c.id}>{show(r.values[c.id])}</td>)}<td className="remain">{show(r.remaining)}</td></tr>)}</tbody></table></div>}
      {sheet&&<p className="baseline-note">{sheet.rows.length}품목 · {sheet.clients.length}열 · 수량은 원본 표기 그대로이며 단위 환산·전산 일치 판정 전입니다.</p>}
      {!!baseline?.issues?.length&&<details><summary>원본 확인사항 {baseline.issues.length}건</summary><ul>{baseline.issues.map((x,i)=><li key={i}>{typeof x==='string'?x:JSON.stringify(x)}</li>)}</ul></details>}
    </>}
    <style jsx>{`
      .baseline-panel{border:1px solid #b8c9dc;background:#f7faff;margin:0 0 10px;font-size:12px;color:#26405a}
      .baseline-toolbar,.baseline-steps{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:5px 7px}
      button,.baseline-upload{border:1px solid #9db2ca;background:white;color:#245b93;padding:4px 8px;min-height:27px;cursor:pointer;font:inherit}
      button:disabled{opacity:.5;cursor:not-allowed}button[aria-pressed=true]{background:#daeaff}
      input{font:inherit;padding:4px;border:1px solid #afc2d8}.baseline-upload{position:relative;overflow:hidden}.baseline-upload input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
      .baseline-note{font-size:11px;color:#60758b;margin:4px 7px}.baseline-steps{background:#eaf1fa;border-block:1px solid #cedbea}
      .baseline-scroll{height:450px;max-height:55vh;overflow:auto;border-top:1px solid #b7c8db;background:white}
      table{border-collapse:separate;border-spacing:0;width:max-content;table-layout:fixed;font-size:12px}th,td{min-width:72px;max-width:100px;width:72px;height:25px;padding:2px 5px;border-right:1px solid #d9e1ec;border-bottom:1px solid #d9e1ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;background:white}
      th{position:sticky;top:0;z-index:2;height:40px;text-align:center;background:#eaf0f8}small{display:block;color:#7b8b9d}.product{position:sticky;left:0;min-width:230px;max-width:230px;width:230px;text-align:left;background:#f2f6fb;z-index:1}th.product{z-index:3}.remain{position:sticky;right:0;background:#fff4d8}th.remain{z-index:3}p[role=alert]{color:#b32929;margin:5px 7px}
    `}</style>
  </section>;
}
