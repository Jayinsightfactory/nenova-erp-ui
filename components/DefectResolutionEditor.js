import DefectCostLookup from './DefectCostLookup';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { defectResolution, resolutionDescriptor } from '../lib/defectResolution.js';
import { parseDefectSourceExport } from '../lib/defectSourceExport.js';

const endpoint = '/api/sales/defect-deductions';
const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))).map(b => b.toString(16).padStart(2, '0')).join('');

export default function DefectResolutionEditor({ row, year, week, admin, disabled, onSaved, onBusy }) {
  const issue = defectResolution(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cost, setCost] = useState('');
  const [edit, setEdit] = useState(null);
  const [kind, setKind] = useState('product');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [source, setSource] = useState(null);
  const [sourceSearch, setSourceSearch] = useState('');
  const [message, setMessage] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const editButton = useRef(null);
  const searchInput = useRef(null);
  useEffect(() => { if (edit) searchInput.current?.focus(); }, [Boolean(edit)]);
  const cancelEdit = () => {
    const dirty = edit && Object.entries(edit).some(([key,value]) => String(value ?? '') !== String(row[key] ?? ''));
    if (dirty && !window.confirm('저장하지 않은 매칭·수량 변경을 취소할까요?')) return;
    setEdit(null); editButton.current?.focus();
  };
  const locked = disabled || busy;
  const run = async operation => {
    setBusy(true); onBusy?.(true); setError('');
    try { await operation(); } catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy?.(false); }
  };
  const saveCost = () => run(async () => {
    await apiPost(endpoint, { action: 'manual-cost-save', year, week, deductionKey: row.deductionKey,
      cost, expectedRowVersionNo: row.rowVersionNo, expectedEstimateUnit: row.distributionCostUnit,
      custKey: row.custKey, prodKey: row.prodKey });
    await onSaved();
  });
  const openEdit = () => run(async () => {
    const data = await apiPost(endpoint, { action: 'manage-edit', year, week, rows: [resolutionDescriptor(row)], changes: {}, preview: true });
    if (data.rows?.[0]?.noteOnly) throw Error('이미 처리한 이력이 있어 업체·품목·수량을 바꿀 수 없습니다. 기존 견적과 원문을 대조하거나 이번 등록을 보류하세요.');
    setEdit({ custKey: row.custKey, customerName: row.customerName, prodKey: row.prodKey, productName: row.productName, quantity: row.quantity, sourceUnit: row.sourceUnit });
  });
  const searchCandidates = () => run(async () => {
    const data = await apiGet(endpoint, { view: 'lookups', kind, q: search });
    setCandidates(data[kind === 'customer' ? 'customers' : 'products'] || []);
  });
  const saveEdit = () => run(async () => {
    const changes = Object.fromEntries(Object.entries(edit).filter(([key, value]) => String(value ?? '') !== String(row[key] ?? '')));
    if (!Object.keys(changes).length) throw Error('변경할 업체·품목·수량을 입력하세요.');
    const payload = { action: 'manage-edit', year, week, rows: [resolutionDescriptor(row)], changes };
    await apiPost(endpoint, { ...payload, preview: true });
    await apiPost(endpoint, { ...payload, preview: false });
    setEdit(null); await onSaved();
  });
  const readSource = file => run(async () => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw Error('원문 파일은 20MB 이하로 선택하세요.');
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(bytes);
    const messages = parseDefectSourceExport(text);
    setSource({ hash: await sha256(bytes), messages }); setMessage(null); setConfirmed(false);
  });
  const release = () => run(async () => {
    if (!source || !message || !confirmed || reason.trim().length < 10) throw Error('원문 메시지를 선택하고 대조 결과를 10자 이상 입력한 뒤 일치 확인을 체크하세요.');
    if (Number(message.stamp.match(/^(\d{4})년/)?.[1]) !== Number(row.orderYear)) throw Error('선택한 메시지의 연도가 원장 연도와 다릅니다. 같은 연도 원문을 선택하세요.');
    const evidence = { sourceSha256: source.hash, messageSha256: await sha256(message.content), messageOrdinal: message.ordinal,
      sourceYear: Number(row.orderYear), sourceWeek: row.orderWeek, custKey: row.custKey, prodKey: row.prodKey,
      quantity: row.quantity, sourceUnit: row.sourceUnit, reason: reason.trim() };
    const payload = { action: 'review-source', mode: row.verifiedLinkedEstimate ? 'confirm-linked' : 'release', year, week,
      rows: [{ deductionKey: row.deductionKey, expectedRowVersionNo: row.rowVersionNo, evidence }] };
    await apiPost(endpoint, { ...payload, preview: true });
    await apiPost(endpoint, { ...payload, preview: false });
    await onSaved();
  });
  const records = (row.existingEstimateRecords || []).filter(r => Number(r.prodKey ?? r.ProdKey) === Number(row.prodKey));
  return <section className="resolver">
    <strong>{issue.title}</strong><p>{issue.action}</p>
    {row.registrationError && <p className="reason">사유: {row.registrationError}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {issue.kind === 'cost' && <DefectCostLookup row={row} year={year} week={week} disabled={locked} onBusy={onBusy} onSaved={onSaved} />}
    {issue.kind === 'cost' && (row.manualCostEditable ? <div className="actions">
      <label>단가 (원/{row.distributionCostUnit || row.sourceUnit}) <input aria-label={`${row.customerName} 단가`} inputMode="decimal" value={cost} disabled={locked} onChange={e => setCost(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCost(); } }} /></label>
      <button type="button" disabled={locked || !cost.trim()} onClick={saveCost}>단가 저장하고 재검사</button>
    </div> : <p>현재 자료는 단가만 저장할 수 없습니다. 아래 매칭·입력을 확인하고 재검사하세요.</p>)}
    {['match', 'cost', 'source', 'other', 'unit'].includes(issue.kind) && <button ref={editButton} type="button" disabled={locked} onClick={openEdit}>업체·품목 매칭 / 수량 수정</button>}
    {edit && <fieldset disabled={locked} onKeyDown={e => { if (e.key === 'Escape' && !locked) { e.preventDefault(); cancelEdit(); } }}>
      <legend>원본: {row.customerName} / {row.productName} / {row.quantity}{row.sourceUnit}</legend>
      <div className="actions"><select aria-label="검색 대상" value={kind} onChange={e => { setKind(e.target.value); setCandidates([]); }}><option value="product">품목</option><option value="customer">업체</option></select>
        <input ref={searchInput} aria-label="업체 품목 검색" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCandidates(); } }} />
        <button type="button" onClick={searchCandidates}>검색</button></div>
      <div className="candidates" onKeyDown={e => { if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return; const buttons = [...e.currentTarget.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); if (buttons.length) { e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); } }}>
        {candidates.map(item => <button type="button" key={item.CustKey || item.ProdKey} onClick={() => { setEdit({ ...edit, ...(kind === 'customer' ? { custKey: item.CustKey, customerName: item.CustName } : { prodKey: item.ProdKey, productName: item.ProdName }) }); setCandidates([]); }}>{item.CustName || `${item.CounName || ''} ${item.FlowerName || ''} ${item.ProdName || ''}`}</button>)}
      </div>
      <p>선택: {edit.customerName} / {edit.productName}</p>
      <div className="actions"><label>수량 <input aria-label="정정 수량" type="number" min="0.0001" step="any" value={edit.quantity} onChange={e => setEdit({ ...edit, quantity: e.target.value })} /></label>
        <label>단위 <select value={edit.sourceUnit} onChange={e => setEdit({ ...edit, sourceUnit: e.target.value })}>{[...new Set([edit.sourceUnit, '단', '박스', '스팀(대)'])].filter(Boolean).map(u => <option key={u}>{u}</option>)}</select></label>
        <button type="button" onClick={saveEdit}>수정 저장하고 재검사</button><button type="button" onClick={cancelEdit}>수정 취소</button></div>
    </fieldset>}
    {(issue.kind === 'source' || issue.kind === 'existing') && <details><summary>원문·기존 견적 비교</summary>
      <p>입력 원차수: {row.orderYear}년 {row.orderWeek}차 · {row.quantity}{row.sourceUnit}</p>
      <p className="original">원장 비고: {row.note || '저장된 원문 없음'}</p>
      {records.length ? records.map(r => <p key={r.estimateKey}>기존 견적 #{r.estimateKey} · {r.orderYear}년 {r.orderWeek}차 · {r.productName} · {r.quantity}{r.unit} · {r.cost}원</p>) : <p>이번 차수의 같은 품목 견적이 조회되지 않았습니다.</p>}
      {issue.kind === 'source' && (admin ? <fieldset disabled={locked}><legend>관리자 원문 대조</legend>
        <p>불량 공유방 TXT를 선택하세요. 원문은 이 창에서만 읽고, 서버에는 해시·메시지 번호·대조 결과를 기록합니다.</p>
        <input aria-label="불량방 원문 파일" type="file" accept=".txt" onChange={e => readSource(e.target.files?.[0])} />
        {source && <><input aria-label="원문 메시지 검색" placeholder="원문 업체명 또는 품목 검색" value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} />
          <select aria-label="대조할 원문 메시지" value={message?.ordinal || ''} onChange={e => { setMessage(source.messages.find(m => m.ordinal === Number(e.target.value))); setConfirmed(false); }}><option value="">메시지를 선택하세요</option>{source.messages.filter(m => sourceSearch.trim() && m.content.toLowerCase().includes(sourceSearch.trim().toLowerCase())).slice(0,100).map(m => <option key={m.ordinal} value={m.ordinal}>#{m.ordinal} {m.stamp} {m.content.slice(0,100)}</option>)}</select></>}
        {message && <pre>{message.stamp}{'\n'}{message.content}</pre>}
        <label>대조 결과·재등록 사유 <textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 원차수·업체·품목·수량·단위가 선택한 원문과 일치합니다.</label>
        <button type="button" disabled={!confirmed || !message || reason.trim().length < 10} onClick={release}>원문 대조 저장하고 재검사</button>
      </fieldset> : <p>과거 취소·원문 불일치 해제는 관리자 대조가 필요합니다. 이 항목을 이번 등록에서 보류하고 정상 건을 등록할 수 있습니다.</p>)}
    </details>}
    <style jsx>{`
      .resolver { padding:12px; background:#fff8eb; border-top:1px solid #f5d49d; font-size:13px; }
      p { margin:6px 0; overflow-wrap:anywhere; } .reason { color:#735426; } .error { color:#a11616; }
      .actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0; }
      button,input,select,textarea { font:inherit; padding:6px 8px; border:1px solid #94a3b8; border-radius:4px; max-width:100%; }
      button { background:white; cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
      :is(button,input,select,textarea,summary):focus-visible { outline:3px solid #2563eb; outline-offset:2px; }
      input[type=checkbox] { margin:8px; } fieldset { min-width:0; margin:10px 0; border:1px solid #d5b579; }
      label { display:block; } textarea { display:block; width:100%; min-height:64px; } select { min-width:110px; }
      details { margin-top:10px; } summary { cursor:pointer; padding:6px; } pre,.original { white-space:pre-wrap; overflow-wrap:anywhere; }
      .candidates { display:grid; gap:4px; margin:8px 0; } .candidates button { text-align:left; }
    `}</style>
  </section>;
}
