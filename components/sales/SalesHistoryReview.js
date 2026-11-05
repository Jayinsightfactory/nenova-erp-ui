import { salesReviewItemMatchesEvent } from '../../lib/salesHistoryReviewPolicy';
import { useEffect, useRef, useState } from 'react';
import { getCurrentWeek } from '../../lib/useWeekInput';

const fmt = n => Number(n ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const won = n => `${fmt(n)}원`;
const signed = n => `${n > 0 ? '+' : ''}${won(n)}`;
const initialWeek = () => String(getCurrentWeek() || '').match(/^\d{4}-(\d{2})-/)?.[1] || '';
const keyOf = g => String(g.key ?? g.custKey ?? g.custName);
const kindLabel = { added: '추가', removed: '삭제', changed: '변경' };

export default function SalesHistoryReview({ onOpenArchive }) {
  const [week, setWeek] = useState(initialWeek);
  const [year, setYear] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [timelines, setTimelines] = useState({});
  const [search, setSearch] = useState('');
  const requestId = useRef(0);
  const context = useRef('');
  const query = (wk, yr) => new URLSearchParams({ week: wk, ...(yr ? { year: yr } : {}) });
  const load = async (wk = week, yr = year) => {
    const id = ++requestId.current;
    context.current = '';
    setBusy(true); setError(''); setData(null); setExpanded({}); setTimelines({});
    try {
      const res = await fetch(`/api/sales/registration-history?${query(wk, yr)}&review=1`);
      const body = await res.json();
      if (!res.ok || !body.success) throw Error(body.error || '조회 실패');
      if (id !== requestId.current) return;
      context.current = `${body.orderYear}|${wk}|${id}`;
      setData({ ...body, loadedWeek: wk }); setYear(String(body.orderYear));
    } catch (e) { if (id === requestId.current) setError(e.message); }
    finally { if (id === requestId.current) setBusy(false); }
  };
  useEffect(() => { load(); }, []); // 최초 선택 차수만 자동 조회
  const timeline = async (g, more = false) => {
    const k = keyOf(g), token = context.current;
    setTimelines(t => ({ ...t, [k]: { ...t[k], loading: true, error: '' } }));
    try {
      const offset = more ? timelines[k]?.nextOffset ?? 0 : 0;
      const res = await fetch(`/api/sales/registration-history?${query(data.loadedWeek, data.orderYear)}&customerTimeline=1&custKey=${encodeURIComponent(g.custKey)}&offset=${offset}`);
      const body = await res.json();
      if (!res.ok || !body.success) throw Error(body.error || '수정 이력 조회 실패');
      if (context.current !== token) return;
      setTimelines(t => ({ ...t, [k]: { ...body, loading: false, entries: [...(more ? t[k]?.entries || [] : []), ...body.entries], observations: more ? t[k]?.observations || [] : body.observations || [] } }));
    } catch (e) { if (context.current === token) setTimelines(t => ({ ...t, [k]: { ...t[k], loading: false, error: e.message } })); }
  };
  const toggle = g => {
    const k = keyOf(g);
    setExpanded(e => ({ ...e, [k]: !e[k] }));
    if (!expanded[k] && !timelines[k] && g.custKey != null) timeline(g);
  };
  const groups = (data?.byCust || []).filter(g => `${g.custName} ${g.items.map(i => i.prodName).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const itemCount = (data?.byCust || []).reduce((n,g) => n + g.items.length, 0);
  const incomplete = data?.missingWeeks?.length > 0;
  return <main className="sales-review">
    <header><div><p className="eyebrow">판매등록 히스토리</p><h1>차이 있는 업체만 확인하세요</h1><p className="muted">품목명 기준으로 비교합니다. 업체를 누르면 변경 품목과 화요일 최종분배 이후 수정자·시각을 볼 수 있습니다. (한국시간)</p></div>
      <button onClick={onOpenArchive}>전산 스냅샷 · 전체 기록</button></header>
    <form className="toolbar" onSubmit={e => { e.preventDefault(); load(); }}>
      <label>연도 <input aria-label="연도" type="number" min="2000" max="2100" placeholder="자동" value={year} onChange={e => setYear(e.target.value)} /></label>
      <label>차수 <input aria-label="차수" value={week} onChange={e => setWeek(e.target.value)} placeholder="44" required /></label>
      <button className="primary" disabled={busy}>{busy ? '조회 중…' : '조회 · 새로고침'}</button>
      <input className="search" aria-label="업체 또는 품목 검색" placeholder="업체·품목 검색" value={search} onChange={e => setSearch(e.target.value)} />
    </form>
    {error && <p role="alert" className="warning">{error}</p>}
    {data && <>
      <section className="workspace">
        <aside className="baseline"><p className="eyebrow">이카운트 판매등록 기준</p><h2>{data.noEcount ? '원본 미수집' : won(data.baseTotal)}</h2>
          <strong>{data.noEcount ? '해당 차수의 이카운트 판매자료 없음' : `${data.saleDate} 판매등록 원본`}</strong>
          <p className="muted">수집된 이카운트 판매등록 원본과 비교합니다. 수집 이후 이카운트 수정분은 다음 수집 후 반영됩니다.</p>
          {data.baseline.map(b => <div className="baseline-stamp" key={b.week}><b>{b.week}</b><span>{b.type === 'ECOUNT' ? '이카운트 수집 시각' : '판매등록확정'}<br />{b.takenAt}<br />{b.confirmedBy ? `기준 확인: ${b.confirmedBy}` : ''}</span></div>)}
          <small>이카운트 판매등록 값을 수정하지 않는 조회 화면입니다.</small>
        </aside>
        <div className="review-content"><div className="summary"><div><span>현재 전산 매출{incomplete ? ' (비교 가능 차수)' : ''}</span><strong>{won(data.currTotal)}</strong></div><div><span>기준 대비 차액</span><strong className={data.currTotal-data.baseTotal < 0 ? 'negative' : 'positive'}>{data.noEcount ? '비교 불가' : signed(data.currTotal-data.baseTotal)}</strong></div><div><span>확인할 차이</span><strong>{data.noEcount ? '비교 대기' : `${data.byCust.length}개 업체 · ${itemCount}개 품목`}</strong><small>총 차액이 0원이어도 품목별 차이는 표시합니다.</small></div></div>
      {data.sourceStatus === 'YELLOW' && <p className="warning">이카운트 수집 원본에 검증 주의 표시가 있습니다. 수집 시각과 원본을 함께 확인하세요.</p>}
      {data.noEcount && <p className="warning">{data.saleDate} 이카운트 판매 원본이 아직 수집되지 않았습니다. 전산 스냅샷으로 대체해 차이를 판정하지 않습니다.</p>}
      {(data.provisional || incomplete) && <p className="warning">{incomplete ? `기준 없는 차수 ${data.missingWeeks.join(', ')}는 비교에서 제외했습니다. ` : ''}{data.provisional ? '판매등록확정 이외의 기준이 포함되어 있습니다. 이카운트 등록 당시 값과 맞는지 기준을 먼저 확인하세요.' : ''}</p>}
      <div className="list-title"><h2>{data.loadedWeek}차 · 불일치 업체 <em>{data.byCust.length}</em></h2><span className="muted">금액 차이가 큰 순 · VAT 포함</span></div>
      {!busy && groups.length === 0 && <div className="empty">{search ? '검색 결과가 없습니다.' : data.noEcount ? '이카운트 원본 수집 후 불일치 업체를 확인할 수 있습니다.' : incomplete ? '비교 가능한 차수에는 차이가 없습니다. 기준 없는 차수는 확인이 필요합니다.' : '기준과 다른 업체·품목이 없습니다.'}</div>}
      {groups.map(g => { const k = keyOf(g), t = timelines[k]; const entries = (t?.entries || []).filter(e => g.items.some(i => salesReviewItemMatchesEvent(i,e)));
        return <article key={k} className="customer">
          <button className="customer-head" aria-expanded={!!expanded[k]} onClick={() => toggle(g)}><span className="cust-name"><span className="chevron">{expanded[k] ? '▾' : '▸'}</span>{g.custName}<small>{g.items.length}개 품목 변경{g.custKey == null ? ' · 업체 매칭 확인 필요' : ''}</small></span><span className="cust-values"><span>판매등록 기준<b>{won(g.baseTotal)}</b></span><span>현재 전산<b>{won(g.currTotal)}</b></span><span>차액<b className={g.delta < 0 ? 'negative' : 'positive'}>{signed(g.delta)}</b></span></span></button>
          {expanded[k] && <div className="customer-body"><div className="table-scroll"><table><thead><tr><th rowSpan="2">품목 / 구분</th><th colSpan="3" className="base-cell">이카운트 판매등록 기준</th><th colSpan="3">현재 전산</th><th rowSpan="2">금액 차이</th></tr><tr><th className="base-cell">단가</th><th className="base-cell">견적수량</th><th className="base-cell">금액</th><th>단가</th><th>견적수량</th><th>금액</th></tr></thead><tbody>{g.items.map((i,n) => <tr key={`${i.rowType}-${i.refKey}-${n}`}><td><strong>{i.prodName}</strong><small>{kindLabel[i.kind]} · {(i.after || i.before)?.estType}</small>{i.before?.outQty != null && i.after?.outQty != null && i.before.outQty !== i.after.outQty && <small>출고수량 {fmt(i.before?.outQty)} → {fmt(i.after?.outQty)}</small>}</td>{['before','after'].map(side => <ReactFragment key={side} item={i[side]} base={side==='before'} other={i[side==='before'?'after':'before']} />)}<td className={(i.after?.total ?? 0)-(i.before?.total ?? 0)<0?'negative':'positive'}><b>{signed((i.after?.total ?? 0)-(i.before?.total ?? 0))}</b></td></tr>)}</tbody></table></div>
          <section className="timeline"><h3>화요일 최종분배 이후 수정 이력</h3><p className="muted">현재 차이가 있는 품목의 기록입니다. 기록이 없는 수정자·시각은 추정하지 않습니다.</p>
          {g.custKey == null && <p className="warning">이카운트 업체와 전산 업체의 연결을 확인해야 수정 이력을 조회할 수 있습니다.</p>}
          {t?.error && <p role="alert" className="warning">{t.error} <button onClick={() => timeline(g)}>다시 조회</button></p>}
          {t?.missingWeeks?.length > 0 && <p className="warning">{t.missingWeeks.join(', ')}: 화요일 최종분배 기록이 없어 추적 시작 시각을 확인할 수 없습니다.</p>}
          {entries.map(e => <div className="event" key={`${e.OrderWeek}-${e.ShipHistoryKey}`}><div><time>{e.changeDtm}</time><strong>{e.changeUser || e.ChangeID || '수정자 기록 없음'}</strong>{e.changeUser && e.ChangeID && <small>{e.ChangeID}</small>}</div><div><b>{e.ProdName}</b><p>{e.ChangeType} · {fmt(e.BeforeValue)} → <strong>{fmt(e.AfterValue)}</strong></p>{e.shipmentDtm && <small>출고일 {e.shipmentDtm.slice(0,10)} · {e.OrderWeek}</small>}{e.Descr && <p className="muted">{e.Descr}</p>}</div></div>)}
          {(t?.observations || []).filter(e => g.items.some(i => salesReviewItemMatchesEvent(i,e))).length > 0 && <details className="observations" open={entries.length === 0}><summary>스냅샷에서 확인된 단가·수량·금액 변화 (수정 시각·수정자와 별개)</summary>
            {(t?.observations || []).filter(e => g.items.some(i => salesReviewItemMatchesEvent(i,e))).sort((a,b) => b.changeDtm.localeCompare(a.changeDtm)).map(e => <div className="event" key={e.eventKey}><div><time>{e.changeDtm}</time><strong>차이 확인 시각</strong><small>수정자·실제 수정 시각은 이 기록으로 확인 불가</small></div><div><b>{e.prodName} · {kindLabel[e.kind]}</b><p>단가 {e.before ? won(e.before.unitPrice) : '없음'} → {e.after ? won(e.after.unitPrice) : '없음'}</p><p>견적수량 {fmt(e.before?.estQty)} → {fmt(e.after?.estQty)} {(e.after || e.before)?.unit}</p><p>금액 {won(e.before?.total)} → {won(e.after?.total)}</p></div></div>)}
          </details>}
          {t?.loading && <p role="status">수정 기록 조회 중…</p>}
          {t && !t.loading && !t.error && entries.length === 0 && <p className="empty">이 페이지에 해당 품목의 수정 기록이 없습니다. 단가·차감 변경 또는 삭제된 상세는 원장 이력에 수정자·시각이 남지 않을 수 있습니다. 위 표의 현재 차이는 계속 확인해야 합니다.</p>}
          {t?.hasMore && <button disabled={t.loading} onClick={() => timeline(g,true)}>이전 수정 기록 더 보기</button>}
          </section></div>}
        </article>;
      })}
      </div></section>
    </>}
    <style jsx>{`
      .sales-review{padding:28px;max-width:1600px;margin:auto;color:#172b4d;font-size:16px}header,.toolbar,.list-title{display:flex;align-items:center;justify-content:space-between;gap:18px}header{margin-bottom:24px}h1{font-size:28px;margin:6px 0 12px}h2{font-size:24px;margin:12px 0}h3{font-size:19px}.eyebrow{font-size:14px;font-weight:700;color:#315bb5;margin:0}.muted{color:#64748b;font-size:14px;line-height:1.6}button,input{font:inherit;border:1px solid #cbd5e1;border-radius:9px;padding:11px 14px;background:white}button{cursor:pointer}button:disabled{opacity:.6;cursor:wait}button:focus-visible,input:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}.toolbar{justify-content:flex-start;flex-wrap:wrap;background:#f1f5f9;padding:16px;border-radius:12px;margin-bottom:24px}.toolbar label{display:flex;gap:10px;align-items:center}.toolbar input{width:130px}.toolbar .search{width:240px;margin-left:auto}.primary{background:#2353cd;color:white;border-color:#2353cd}.workspace{display:grid;align-items:start;grid-template-columns:320px 1fr;gap:22px}.review-content{min-width:0}.baseline{position:sticky;top:20px;background:#eef4ff;border:1px solid #b9cef8;border-radius:14px;padding:24px}.baseline h2{font-size:30px}.baseline-stamp{display:flex;gap:16px;font-size:13px;padding:12px 0;border-top:1px solid #d6e2fa;line-height:1.7}.baseline button{width:100%;font-size:14px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:16px}.summary>div{border:1px solid #dbe2eb;border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:16px;background:white}.summary>div:last-child{grid-column:1/-1}.summary strong{font-size:28px}.summary span,small{color:#64748b}.positive{color:#be3541}.negative{color:#2353cd}.warning{padding:16px;border:1px solid #f3cf7a;background:#fff9e9;color:#80571c;border-radius:10px;line-height:1.6}.list-title{margin:24px 0 12px}.list-title h2{font-size:20px}.list-title em{font-style:normal;color:#2353cd}.customer{border:1px solid #dbe2eb;border-radius:12px;background:#fff;margin-bottom:12px;overflow:hidden}.customer-head{border:0;border-radius:0;width:100%;display:flex;justify-content:space-between;align-items:center;text-align:left;padding:24px;gap:24px}.customer-head:hover{background:#f8faff}.cust-name{font-size:23px;font-weight:700}.cust-name small{display:block;font-size:14px;font-weight:400;margin:8px 0 0 24px}.chevron{color:#5371a5;margin-right:12px}.cust-values{display:flex;gap:32px;text-align:right}.cust-values span{font-size:13px;color:#64748b}.cust-values b{display:block;font-size:20px;margin-top:9px}.customer-body{border-top:1px solid #e2e8f0;padding:20px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:920px;font-size:15px}th,td{padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:right}th{font-size:13px;color:#52647d;background:#f8fafc}th:first-child,td:first-child{text-align:left}td small{display:block;margin-top:6px;font-size:12px}.base-cell{background:#eff5ff}.timeline{margin-top:28px}.event{display:grid;grid-template-columns:210px 1fr;gap:24px;border-left:3px solid #b7ccf8;padding:16px 22px;margin:12px 0;background:#f8fafc;border-radius:0 10px 10px 0}.event time,.event strong,.event small{display:block}.event time{font-size:14px;color:#52647d;margin-bottom:8px}.event p{margin:8px 0}.event p strong{display:inline}.empty{padding:28px;background:#f8fafc;color:#64748b;border-radius:10px;line-height:1.7}@media(max-width:900px){.sales-review{padding:16px}.workspace{grid-template-columns:1fr}.baseline{position:static}.customer-head{align-items:flex-start;flex-direction:column}.cust-values{width:100%;justify-content:space-between;gap:10px}.cust-values b{font-size:17px}.summary strong{font-size:23px}header{align-items:flex-start;flex-direction:column}.toolbar .search{margin:0;width:100%}.event{grid-template-columns:1fr;gap:10px}.list-title{align-items:flex-start;flex-direction:column;gap:0}}
    `}</style>
  </main>;
}

// Multiple cells keep the before/after columns aligned without adding a DOM wrapper.
function ReactFragment({ item, base, other }) {
  const cell = { background: base ? '#eff5ff' : undefined, padding:'14px 12px', borderBottom:'1px solid #e2e8f0', textAlign:'right', whiteSpace:'nowrap' };
  return <><td style={{...cell, fontWeight: JSON.stringify(item?.unitPrices || [item?.unitPrice]) !== JSON.stringify(other?.unitPrices || [other?.unitPrice]) ? 700 : 400}}>{item ? (item.unitPrices?.length > 1 ? item.unitPrices.map(won).join(' / ') : won(item.unitPrice)) : '—'}</td><td style={{...cell, fontWeight:item?.estQty!==other?.estQty?700:400}}>{item ? `${fmt(item.estQty)} ${item.unit}` : '—'}{item?.priceQuantities?.length > 1 && <small style={{display:'block',fontSize:12,marginTop:6}}>{item.priceQuantities.map(p=>`${won(p.unitPrice)} × ${fmt(p.qty)}`).join(' / ')}</small>}</td><td style={cell}>{item ? won(item.total) : '—'}</td></>;
}
