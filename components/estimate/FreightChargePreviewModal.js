import { useEffect, useMemo, useState } from 'react';
import { isFreightRow, FREIGHT_ROUNDING } from '../../lib/estimateFreightPolicy';
import { freightSourceRows, buildFreightDraftRows, validateFreightDraft, groupFreightSources, freightDraftGroupIndex, combineCarnationFreight, cumulativeFreightRows } from '../../lib/estimateFreightDraft';
import styles from './FreightChargePreviewModal.module.css';
import { apiGet } from '../../lib/useApi';
import { freightEvidenceRows, freightPriceSuggestion, freightCategoryFromEvidence } from '../../lib/estimateFreightEvidence';

const fmt = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const tones = [ ['#eff6ff','#2563eb'], ['#fff1f2','#be123c'], ['#ecfdf5','#047857'], ['#fff7ed','#c2410c'], ['#f5f3ff','#7c3aed'], ['#ecfeff','#0e7490'], ['#fefce8','#a16207'], ['#fdf4ff','#a21caf'] ];
export default function FreightChargePreviewModal({ open, onClose, items = [], products = [], year, parentWeek, selectedShip, onApply, applyBusy = false, applyStatus = '' }) {
  const [excluded, setExcluded] = useState({});
  const [edits, setEdits] = useState({});
  const [rounding, setRounding] = useState(FREIGHT_ROUNDING.CEIL);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [combineCarnation, setCombineCarnation] = useState(true);
  const [history, setHistory] = useState({ scope: '', rows: [], loading: true, error: '' });
  const historyScope = `${year}|${parentWeek}|${selectedShip?.CustKey}`;
  useEffect(() => {
    if (!open) return;
    let active = true;
    setHistory({scope:historyScope,rows:[],loading:true,error:''});
    async function load() {
      const rows = [];
      try {
        // Existing EXE-parity GET only. Sequential bounded reads avoid a query burst.
        for (let week = Number(parentWeek); week >= Math.max(1, Number(parentWeek) - 7); week--) {
          if (!active) return;
          const data = await apiGet('/api/estimate', {year,week:String(week).padStart(2,'0'),custKey:selectedShip.CustKey,byDate:1,itemsOnly:1});
          if (data.success === false || !Array.isArray(data.items)) throw new Error('업체 운임 이력 응답을 확인하지 못했습니다.');
          rows.push(...data.items.map(row=>({...row,OrderYear:year,CustKey:selectedShip.CustKey})));
        }
        if (active) setHistory({scope:historyScope,rows,loading:false,error:''});
      } catch (e) { if (active) setHistory({scope:historyScope,rows:[],loading:false,error:e.message}); }
    }
    load();
    return () => { active = false; };
  }, [open, historyScope, year, parentWeek, selectedShip?.CustKey]);
  useEffect(() => { if (open) { setExcluded({}); setEdits({}); setError(''); setConfirmed(false); } }, [open, year, parentWeek, selectedShip?.CustKey, items]);
  const sources = useMemo(() => freightSourceRows(items, year, parentWeek), [items, year, parentWeek]);
  const selected = sources.filter(row => !excluded[row.sourceKey]);
  const groups = groupFreightSources(sources, excluded);
  const unknownCount = selected.filter(row => row.boxes == null).length;
  const freightProducts = products.filter(p => isFreightRow(p) && p.OutUnit === '박스');
  const historyReady = history.scope === historyScope && !history.loading && !history.error;
  const evidence = freightEvidenceRows(historyReady ? history.rows : [], {year,custKey:selectedShip?.CustKey,parentWeek});
  const existing = items.filter(row=>isFreightRow(row) && !row.EstimateKey && Number(row.Quantity)>0);
  const drafts = combineCarnationFreight(buildFreightDraftRows(selected, freightProducts, rounding, row=>freightCategoryFromEvidence(row,evidence)), sources, parentWeek, rounding, combineCarnation).map(row => {
    const saved = existing.find(item => item.OrderWeek === row.weekShort && Number(item.ProdKey) === Number(row.prodKey));
    const edited = {...row,...edits[row.key]};
    const price = freightPriceSuggestion(evidence,edited.prodKey,row.weekShort,selectedShip,freightProducts);
    return { ...row, enabled: false, ...price, ...edits[row.key], saved: Boolean(saved) };
  });
  const update = (key, values) => { setEdits(prev => ({ ...prev, [key]: { ...prev[key], ...values } })); setConfirmed(false); };
  const renderDraft = row => <div key={row.key} className={styles.inlineDraft}>
    <input type="checkbox" aria-label={row.weekShort+' '+row.name+' 등록'} checked={row.enabled} onChange={e=>update(row.key,{enabled:e.target.checked})}/>
    <select aria-label={row.weekShort+' '+row.name+' 품목'} value={row.prodKey} onChange={e=>update(row.key,{prodKey:Number(e.target.value),cost:freightPriceSuggestion(evidence,Number(e.target.value),row.weekShort,selectedShip,freightProducts).cost})}><option value="">품목 선택 · {row.name}</option>{freightProducts.map(p=><option key={p.ProdKey} value={p.ProdKey}>{p.ProdName}</option>)}</select>
    <label><input aria-label={row.weekShort+' '+row.name+' 박스'} type="number" min="0" step="any" value={row.qty} onChange={e=>update(row.key,{qty:e.target.value})}/>박스</label>
    <label><input aria-label={row.weekShort+' '+row.name+' 단가'} type="number" min="0" value={row.cost} onChange={e=>update(row.key,{cost:e.target.value})}/>원/박스</label>
    <small className={styles.draftScope}>{row.weekShort} · {row.shipmentDate.slice(5)}</small>
    {row.combined && <small style={{gridColumn:'1 / -1',color:'#1250a0'}}>1·2차 합산 {fmt(row.rawBoxes)}박스 → {row.weekShort} 한 건 등록{row.scopeError && ` · ${row.scopeError}`}</small>}
    <small style={{gridColumn:'1 / -1',color:'#475569'}} title={row.evidence}>{row.evidence}{row.saved ? ' · 기존 운임 있음: 최종 수량으로 수정 · 출고일 유지' : ''}</small>
  </div>;
  async function submit() {
    setError('');
    try {
      if (!historyReady) throw new Error('업체 운임 이력 조회 완료 후 다시 확인해 주세요.');
      if (!confirmed) throw new Error('품목별 박스수량과 등록 내용을 확인해 주세요.');
      if (selected.some(row => row.boxes == null)) throw new Error('박스 환산을 확인할 수 없는 품목이 있습니다. 해당 품목을 제외하거나 품목 정보를 확인하세요.');
      const rows = validateFreightDraft(drafts.filter(row => row.enabled), { year, parentWeek, custKey: selectedShip?.CustKey, products: freightProducts, existing });
      await onApply(rows);
    } catch (e) { setError(e.message || '운임 등록을 시작하지 못했습니다.'); }
  }
  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="운임비 추가" className={styles.backdrop}>
    <div className={styles.panel}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><h3 style={{margin:0}}>운임비 추가 · {selectedShip?.CustName} · {year}년 {parentWeek}차</h3><button disabled={applyBusy} onClick={onClose}>닫기</button></div>
      <div className={styles.topActions}>
        <label><input type="checkbox" checked={combineCarnation} onChange={e=>{setCombineCarnation(e.target.checked);setEdits(prev=>Object.fromEntries(Object.entries(prev).filter(([key])=>!key.endsWith('|카네이션 운송료'))));setConfirmed(false);}}/> 카네이션 1·2차 합산 → {String(parentWeek).padStart(2,'0')}-01 등록</label>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 박스수량·등록 차수·단가 확인</label>
        <b>등록 예상 {fmt(drafts.filter(r=>r.enabled).reduce((s,r)=>s+Number(r.qty)*Number(r.cost),0))}원</b>
        <button className="btn btn-primary" disabled={applyBusy||!historyReady||!confirmed||!drafts.some(r=>r.enabled)} onClick={submit}>{applyBusy?'등록 준비 중…':'운임비 등록 시작'}</button>
      </div>
      <p className={styles.help}>품목별 박스 확인 → 서버의 변경 전·후 확인 → 전체 저장. 기존 운임은 최종값으로 수정하고 출고일·확정 상태를 유지합니다. 다른 업체의 확정을 해제하지 않습니다.</p>
      {applyStatus && <div role="status" style={{padding:8,background:'#eff6ff',color:'#174575',whiteSpace:'pre-line'}}>{applyStatus}</div>}
      <div role="status" className={styles.help}>{!historyReady ? (history.error ? `업체 이력 조회 실패: ${history.error} · 창을 다시 열어 재시도하세요.` : '이 업체의 최근 8개 차수 운임 이력 확인 중…') : `이 업체 · ${year}년 ${Math.max(1,Number(parentWeek)-7)}~${parentWeek}차 실적 ${evidence.length}건 확인. 단가는 참고값이며 등록할 항목을 직접 선택하세요.`} 카네이션 합산은 상단에서 선택하며, 다른 운임·상차운임은 기존 차수와 출고일을 유지합니다.</div>
      {error && <div role="alert" style={{background:'#fee2e2',color:'#991b1b',padding:12,marginBottom:10}}>{error}</div>}
      <div>
        <section>
          <div className={styles.sectionHeading}><b>견적서 품목 · 박스수량 확인 ({sources.length}개)</b><b>{unknownCount ? '확인된 소계' : '선택 합계'} {fmt(selected.reduce((sum,row)=>sum+(row.boxes||0),0))}박스{unknownCount > 0 && ` · 환산 확인 ${unknownCount}개`}</b></div>
          <div className={styles.sources}>
            {groups.map((group, index) => <section key={group.label} className={styles.group} style={{'--group-bg':tones[index % tones.length][0], '--group-accent':tones[index % tones.length][1]}}>
              <div className={styles.groupHeading}><b>{group.label} <small>{group.rows.length}개</small></b><strong>{fmt(group.boxes)}박스{group.unknown > 0 && ` + 확인 ${group.unknown}개`}</strong></div>
              {drafts.filter(row=>freightDraftGroupIndex(groups,row)===index).map(renderDraft)}
              {drafts.filter(row=>freightDraftGroupIndex([group],row)===0 && freightDraftGroupIndex(groups,row)!==index).map(row=><div key={row.key} className={styles.sharedNotice}>{row.name} · {groups[freightDraftGroupIndex(groups,row)]?.label}에서 합산 설정</div>)}
              <div className={styles.rowHeading}><span>포함 · 품목명</span><span>입력수량</span><span>환산 박스</span><span>누적 합계</span></div>
            {cumulativeFreightRows(group.rows,excluded).map(row => <div key={row.sourceKey} className={styles.sourceRow} style={{background:excluded[row.sourceKey]?'#f1f5f9':row.boxes==null?'#fee2e2':'var(--group-bg)'}}>
              <input aria-label={row.ProdName+' 계산 포함'} type="checkbox" checked={!excluded[row.sourceKey]} onChange={e=>{setExcluded(prev=>({...prev,[row.sourceKey]:!e.target.checked}));setConfirmed(false);}} />
              <span className={styles.sourceName} title={`${row.ProdName} · ${row.OrderWeek} · ${row.outDate}`}>{row.ProdName}</span>
              <span className={styles.quantity}>{fmt(row.Quantity)}{row.Unit}</span><strong className={styles.boxes}>{row.boxes==null?'확인 필요':`${fmt(row.boxes)}박스`}</strong>
              <strong className={styles.boxes} title={row.cumulativeUnknown?'환산 미확인 품목 제외 소계':''}>{fmt(row.cumulativeBoxes)}박스{row.cumulativeUnknown>0?' + ?':''}</strong>
            </div>)}</section>)}
          </div>
        </section>
        <section className={styles.settings}>
          <label>잔량 처리 <select value={rounding} onChange={e=>{setRounding(e.target.value);setConfirmed(false);}}>
            <option value="CEIL">올림 (4.5 → 5)</option><option value="FLOOR">버림 (4.5 → 4)</option><option value="EXACT">실수량 유지</option>
          </select></label>
          <span className={styles.help}> 필요한 운임만 체크 · 박스수/박스당 단가 수정 가능 · 부가세 포함 단가</span>
          <div className={styles.commonFreight}><b>공통 상차운임</b>{drafts.filter(row=>freightDraftGroupIndex(groups,row)===-1).map(renderDraft)}</div>
          {existing.length>0 && <div className={styles.existing}><b>기존 운임 {existing.length}건 · 선택한 운임만 최종값 수정</b>{existing.map((r,i)=><span key={i}>{r.OrderWeek} {r.ProdName} {fmt(r.Quantity)}{r.Unit} × {fmt(r.Cost)}원</span>)}</div>}
        </section>
      </div>
    </div>
  </div>;
}
