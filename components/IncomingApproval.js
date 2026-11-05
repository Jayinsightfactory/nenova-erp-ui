import { useEffect, useRef, useState } from 'react';
import WarehouseCorrection from './WarehouseCorrection.js';
import IncomingApprovalLinkedReview from './IncomingApprovalLinkedReview.js';
import WorkflowGuide from './WorkflowGuide.js';

const labels = { draft: '초안', requested: '검토 대기', applied: '적용 완료', rejected: '반려', cancelled: '취소' };
const fmt = n => Number(n ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
async function api(body, id) {
  const response = await fetch(`/api/warehouse/approval${id ? `?requestId=${id}` : ''}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok || !value.success) throw new Error(value.error || '입고 정정 요청 처리 실패');
  return value;
}
export default function IncomingApproval({ children, active = true }) {
  const [tab, setTab] = useState('request'), [list, setList] = useState([]), [permissions, setPermissions] = useState({});
  const [data, setData] = useState(null), [matching, setMatching] = useState({ rows: [], farms: [] });
  const [preview, setPreview] = useState(null), [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [note, setNote] = useState(''), [pending, setPending] = useState(null);
  const [editDraft,setEditDraft]=useState(false);
  const busyRef = useRef(false), detailRef = useRef(null), generation = useRef(0);
  const request = data?.request, facts = data?.facts;
  const refresh = async () => { const value = await api(); setList(value.requests); setPermissions(value.permissions); };
  useEffect(() => { if (active) refresh().catch(e => setError(e.message)); }, [active]);
  useEffect(() => { const handler = () => refresh().catch(e => setError(e.message)); window.addEventListener('incoming-approval-saved', handler); return () => window.removeEventListener('incoming-approval-saved', handler); }, []);
  useEffect(() => { const warn = e => { if (dirty || pending) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, pending]);
  const run = async fn => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { busyRef.current = false; setBusy(false); } };
  const open = async id => {
    const ticket = ++generation.current;
    const value = await api(null, id); if (ticket !== generation.current) return;
    setData(value); setMatching(value.request.matching); setPreview(null); setConfirmed(false); setDirty(false); setPending(null);
    setTimeout(() => detailRef.current?.focus(), 0);
  };
  const canLeave = () => !dirty && !pending || window.confirm('저장하지 않은 매칭 또는 확인 중인 작업이 있습니다. 목록으로 돌아갈까요?');
  const chooseTab = next => { if (busy || !canLeave()) return; setTab(next); setData(null); setDirty(false); setPreview(null); setPending(null); };
  const change = next => { setMatching(next); setDirty(true); setPreview(null); setConfirmed(false); };
  const action = name => run(async () => {
    await api({ action: name, requestId: request.requestId, revision: request.revision, matching, note });
    setMessage(name === 'saveMatching' ? '매칭을 저장했습니다. 최종 확정 전까지 ERP는 변경되지 않습니다.' : '요청 상태를 저장했습니다.');
    await open(request.requestId); await refresh();
  });
  const inspect = () => run(async () => { setPreview(null); setConfirmed(false); setPreview(await api({ action: 'preview', requestId: request.requestId, revision: request.revision })); });
  const approve = () => run(async () => {
    const body = pending ?? { action: 'approve', requestId: request.requestId, revision: request.revision, digest: preview.digest, previewToken:preview.previewToken,operationId: crypto.randomUUID(), confirmed: true };
    setPending(body);
    await api(body); setPending(null); setMessage('입고·분배·재고·견적·매출 반영을 완료했습니다.');
    await open(request.requestId); await refresh();
  });
  const editDate = (d, checked) => {
    const detail = facts.details.find(x => x.SdetailKey === d.SdetailKey);
    change({ ...matching, rows: checked ? [...matching.rows, { sdateKey: d.SdateKey, shipmentKey: detail.ShipmentKey, prodKey: detail.ProdKey, quantity: d.ShipmentQuantity, cost: d.Cost, date: d.DateText, createOrder: false }] : matching.rows.filter(r => r.sdateKey !== d.SdateKey) });
  };
  const patchRow = (index, patch) => change({ ...matching, rows: matching.rows.map((r, i) => i === index ? { ...r, ...patch } : r) });
  const visible = list.filter(r => tab === 'review' ? r.Status === 'requested' : tab === 'history' ? ['applied', 'rejected', 'cancelled'].includes(r.Status) : ['draft', 'requested'].includes(r.Status));
  const canReview = permissions.review && request?.status === 'requested';
  return <div className="incoming-approval">
    <WorkflowGuide workflowId="incoming-approval" />
    <style>{`.incoming-approval{color:#172033}.incoming-approval button,.incoming-approval input,.incoming-approval select,.incoming-approval textarea{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}.incoming-approval button{margin:4px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#172033}.incoming-approval button[aria-pressed=true]{background:#1d4ed8;color:white}.incoming-approval button:disabled{opacity:.5}.incoming-approval :focus-visible{outline:3px solid #2563eb;outline-offset:2px}.incoming-approval table{border-collapse:collapse;min-width:100%}.incoming-approval td,.incoming-approval th{padding:8px;border:1px solid #cbd5e1;text-align:left;min-width:90px;max-width:260px;overflow-wrap:anywhere}.incoming-approval .scroll{overflow-x:auto}.incoming-approval .notice{padding:12px;background:#eff6ff;border-radius:8px}.incoming-approval fieldset{min-width:0;border:1px solid #cbd5e1;margin:12px 0}.incoming-approval label{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}.incoming-approval input[type=number]{width:110px}`}</style>
    <nav aria-label="입고 정정 처리 단계" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; const buttons = [...e.currentTarget.querySelectorAll('button')], i = buttons.indexOf(document.activeElement); if (i < 0) return; e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus(); }}>
      {[['request', '수정 요청'], ['review', '매칭·확정'], ['history', '처리 이력']].map(([key, name]) => <button key={key} aria-pressed={tab === key} disabled={busy} onClick={() => chooseTab(key)}>{name}</button>)}
    </nav>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <>
      <h3>{tab === 'request' ? '수입부 수정 요청' : tab === 'review' ? '영업지원 매칭·확정' : '처리 이력'}</h3>
      <p className="notice">요청과 매칭 저장은 ERP를 변경하지 않습니다. 영업지원이 영향 내역을 확인하고 최종 확정하면 함께 반영됩니다.</p>
      <button disabled={busy} onClick={() => run(refresh)}>요청 목록 새로고침</button>
      <div className="scroll"><table><caption>입고 정정 요청 · 최근 200건</caption><thead><tr><th>요청</th><th>연도·차수</th><th>입고</th><th>상태</th><th>사유</th><th>요청자</th></tr></thead><tbody>{visible.map(r => <tr key={r.RequestId}><td><button disabled={busy} onClick={() => run(() => open(r.RequestId))}>#{r.RequestId} 열기</button></td><td>{r.correction.orderYear} / {r.correction.orderWeek}</td><td>#{r.correction.warehouseKey}</td><td>{r.reviewing && r.Status === 'requested' ? '검토 중' : labels[r.Status]}</td><td>{r.reason}</td><td>{r.RequestedBy}</td></tr>)}</tbody></table></div>
      {!visible.length && <p>해당 요청이 없습니다.</p>}
      {tab === 'request' && <section><h3>새 요청 작성</h3><p>아래 입고를 선택하고 ‘수입부 수정 요청’을 누르세요.</p>{children}</section>}
    </> : <section ref={detailRef} tabIndex={-1} aria-label="정정 요청 상세">
      <button disabled={busy} onClick={() => { if (canLeave()) { setData(null); setDirty(false); setPending(null); } }}>요청 목록으로</button>
      <h3>요청 #{request.requestId} · {labels[request.status]} · {request.correction.orderYear}/{request.correction.orderWeek}</h3>
      <p>{request.reason}</p><p>농장 {request.baseline.receipt.header.FarmName} → {request.correction.farmName}</p>
      <div className="scroll"><table><caption>입고 최종 수량</caption><thead><tr><th>품목</th><th>단위</th><th>현재</th><th>수정 후</th><th>차이</th></tr></thead><tbody>{(request.evidence?.receiptChanges ?? facts.receiptPlan.changes).map(c => <tr key={c.prodKey}><td>{c.prodName}</td><td>{c.unit}</td><td>{fmt(c.before)}</td><td>{fmt(c.after)}</td><td>{fmt(c.delta)}</td></tr>)}</tbody></table></div>
      {request.status === 'draft' && permissions.request && <button disabled={busy} onClick={() => action('submit')}>영업지원에 수정 요청</button>}
      {request.status === 'draft' && permissions.request && <button disabled={busy} onClick={() => setEditDraft(true)}>초안 수정</button>}
      {editDraft && <WarehouseCorrection selected={{...request.baseline.receipt.header,approval:true,approvalDraft:request}} onClose={()=>setEditDraft(false)} onSaved={()=>{setEditDraft(false);run(async()=>{await open(request.requestId);await refresh();});}}/>}
      {['draft', 'requested'].includes(request.status) && permissions.request && <button disabled={busy} onClick={() => action('cancel')}>요청 취소</button>}
      {canReview && <>
        {!facts.receiptPlan.detailsChanged ? <p className="notice">농장만 변경합니다. 분배 수량·재고·견적·매출 금액과 기존 확정 상태를 보존합니다.</p> : <>
          <h4>변경할 분배 선택</h4><label>업체·품목 검색<input value={search} onChange={e => setSearch(e.target.value)} /></label>
          <p>선택하지 않은 분배는 유지합니다. 수량은 증감량이 아닌 최종값입니다. 감소만 처리할 수 있으며, 다른 품목 추가는 별도로 입력합니다.</p>
          <div className="scroll"><table><thead><tr><th>선택</th><th>업체 / 차수</th><th>품목 / 단위</th><th>출고일</th><th>분배수량</th><th>판매단가</th></tr></thead><tbody>{facts.dates.filter(d => {
            const detail = facts.details.find(x => x.SdetailKey === d.SdetailKey), master = facts.masters.find(x => x.ShipmentKey === detail?.ShipmentKey), product = facts.products.find(x => x.ProdKey === detail?.ProdKey);
            return `${master?.CustName} ${product?.ProdName}`.toLowerCase().includes(search.toLowerCase());
          }).map(d => { const detail = facts.details.find(x => x.SdetailKey === d.SdetailKey), master = facts.masters.find(x => x.ShipmentKey === detail?.ShipmentKey), product = facts.products.find(x => x.ProdKey === detail?.ProdKey); return <tr key={d.SdateKey}><td><input type="checkbox" aria-label={`분배 ${d.SdateKey} 선택`} disabled={busy || !!pending} checked={matching.rows.some(r => r.sdateKey === d.SdateKey)} onChange={e => editDate(d, e.target.checked)} /></td><td>{master?.CustName}<br />{master?.OrderYear}/{master?.OrderWeek}</td><td>{product?.ProdName} / {product?.OutUnit}</td><td>{d.DateText}</td><td>{fmt(d.ShipmentQuantity)}</td><td>{fmt(d.Cost)}</td></tr>; })}</tbody></table></div>
          <fieldset disabled={busy || !!pending}><legend>선택 분배의 최종값</legend>
            <div className="scroll"><table><thead><tr><th>원행</th><th>업체·차수</th><th>대상 품목</th><th>출고일</th><th>최종수량</th><th>판매단가</th><th>대체품 주문</th><th>제외</th></tr></thead><tbody>{matching.rows.map((r, i) => <tr key={r.sdateKey ?? `new-${i}`}><td>{r.sdateKey ?? '추가'}</td><td><select aria-label={`${i + 1}행 업체 차수`} disabled={!!r.sdateKey} value={r.shipmentKey} onChange={e => patchRow(i, { shipmentKey: Number(e.target.value) })}>{facts.masters.map(m => <option key={m.ShipmentKey} value={m.ShipmentKey}>{m.CustName} {m.OrderYear}/{m.OrderWeek}</option>)}</select></td><td><select aria-label={`${i + 1}행 대상 품목`} value={r.prodKey} onChange={e => patchRow(i, { prodKey: Number(e.target.value) })}>{facts.products.map(p => <option key={p.ProdKey} value={p.ProdKey}>{p.ProdName} / {p.OutUnit}</option>)}</select></td><td><input type="date" aria-label={`${i + 1}행 출고일`} value={r.date} onChange={e => patchRow(i, { date: e.target.value })} /></td><td><input type="number" min="0" step="0.01" aria-label={`${i + 1}행 최종수량`} value={r.quantity} onChange={e => patchRow(i, { quantity: e.target.value })} /></td><td><input type="number" min="0" step="any" aria-label={`${i + 1}행 판매단가`} value={r.cost} onChange={e => patchRow(i, { cost: e.target.value })} /></td><td><label><input type="checkbox" checked={r.createOrder} onChange={e => patchRow(i, { createOrder: e.target.checked })} />주문이 없으면 양수 신규 연결</label></td><td><button onClick={() => change({ ...matching, rows: matching.rows.filter((_, n) => n !== i) })}>매칭 제외</button></td></tr>)}</tbody></table></div>
            <button disabled={!facts.masters.length} onClick={() => { const m = facts.masters[0]; change({ ...matching, rows: [...matching.rows, { sdateKey: null, shipmentKey: m.ShipmentKey, prodKey: facts.products[0].ProdKey, quantity: '', cost: '', date: '', createOrder: false }] }); }}>다른 품목 분배 추가</button>
          </fieldset>
        </>}
        <IncomingApprovalLinkedReview facts={facts} request={request} matching={matching} onChange={change} disabled={busy || !!pending}/>
        <button disabled={busy || !!pending || !dirty} onClick={() => action('saveMatching')}>매칭 임시저장</button>
        <button disabled={busy || !!pending || dirty} onClick={inspect}>입고·분배·견적·매출 영향 검토</button>
        <label>반려 사유<input maxLength={400} value={note} onChange={e => setNote(e.target.value)} /></label><button disabled={busy || !!pending || !note.trim()} onClick={() => action('reject')}>반려</button>
        {preview && <section><h4>최종 반영 전후</h4>{preview.issues.map((i, n) => <p role="alert" key={n}>{i.message}</p>)}<div className="scroll"><table><thead><tr><th>업체·차수</th><th>품목</th><th>분배</th><th>공급가</th><th>VAT</th><th>현재고 차액</th></tr></thead><tbody>{preview.groups.map(g => <tr key={g.key}><td>{g.customer} {g.year}/{g.week}</td><td>{g.product} / {g.unit}</td><td>{fmt(g.before)} → {fmt(g.after)}</td><td>{fmt(g.beforeAmount)} → {fmt(g.afterAmount)}</td><td>{fmt(g.beforeVat)} → {fmt(g.afterVat)}</td><td>{fmt(g.stockDelta)}</td></tr>)}</tbody></table></div><p>{preview.externalDocuments}</p><label><input type="checkbox" disabled={!preview.canCommit || busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />입고와 분배의 최종값·견적·매출 금액을 확인했습니다. 확정하면 함께 반영합니다.</label></section>}
        {preview?.financialSummary && <section aria-label="원가·손익 최종 검산"><h4>원가·손익 최종 검산</h4><p>저장 경로 검산 후 모든 시험 변경을 되돌렸습니다. 최종 확정 시 동일 값을 다시 검산하고 함께 저장합니다.</p>{[...(preview.financialSummary.costs?.invoices??[]),...(preview.financialSummary.costs?.freight??[])].map((c,i)=><p key={i}>원가 {i+1}: {fmt(c.beforeTotal)} → {fmt(c.afterTotal??c.beforeTotal)}원{c.preserveEconomics?' (금액 보존)':''}</p>)}{preview.financialSummary.profitAfter?.map((p,i)=>{const b=preview.financialSummary.profitBefore[i];return <div key={p.orderYear+':'+p.major}><h5>{p.orderYear}/{p.major} 손익 정정</h5><div className="scroll"><table><thead><tr><th>항목</th><th>기존</th><th>정정 후</th></tr></thead><tbody>{[['N','순수매출'],['I','매출원가'],['E','기초재고'],['F','기말재고'],['J','매출이익'],['K','이익률']].map(([k,label])=><tr key={k}><td>{label}</td><td>{b?.totals?.[k]==null?'미산정':fmt(b.totals[k]*(k==='K'?100:1))+(k==='K'?'%':'')}</td><td>{p.totals?.[k]==null?'미산정':fmt(p.totals[k]*(k==='K'?100:1))+(k==='K'?'%':'')}</td></tr>)}</tbody></table></div></div>;})}</section>}
        {!!preview?.stockPreview?.length && <details><summary>현재·후속 차수 재고 예상 ({preview.stockPreview.length}행)</summary><p>현재 저장 재고에 승인 차액을 반영한 예상입니다. 최종 확정에서 전산 재계산과 부족 검증을 다시 수행합니다.</p><div className="scroll"><table><thead><tr><th>연도·차수</th><th>품목</th><th>기존</th><th>예상</th></tr></thead><tbody>{preview.stockPreview.map(s=><tr key={`${s.StockKey}:${s.ProdKey}`}><td>{s.OrderYear}/{s.OrderWeek}</td><td>{facts.products.find(p=>p.ProdKey===s.ProdKey)?.ProdName ?? s.ProdKey}</td><td>{fmt(s.Stock)}</td><td>{fmt(s.projected)}</td></tr>)}</tbody></table></div></details>}
        {pending && <p role="alert">응답을 확인하지 못했습니다. 같은 작업번호로 결과를 다시 확인하세요.</p>}
        <button disabled={busy || !pending && (!preview?.canCommit || !confirmed || dirty)} onClick={approve}>{pending ? '같은 확정 결과 다시 확인' : '최종 확정'}</button>
      </>}
      {request.status === 'applied' && <p role="status">적용 완료 · 입고 #{request.result?.warehouseKey} · 분배 {request.result?.shipmentGroups}건 · 재고 {request.result?.stockProducts}품목 · {request.appliedAt}</p>}
    </section>}
  </div>;
}
