import { useEffect, useMemo, useState } from 'react';
import { isFreightRow, FREIGHT_ROUNDING } from '../../lib/estimateFreightPolicy';
import { freightSourceRows, buildFreightDraftRows, validateFreightDraft } from '../../lib/estimateFreightDraft';

const fmt = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
export default function FreightChargePreviewModal({ open, onClose, items = [], products = [], year, parentWeek, selectedShip, onApply, applyBusy = false }) {
  const [excluded, setExcluded] = useState({});
  const [edits, setEdits] = useState({});
  const [rounding, setRounding] = useState(FREIGHT_ROUNDING.CEIL);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { if (open) { setExcluded({}); setEdits({}); setError(''); setConfirmed(false); } }, [open, year, parentWeek, selectedShip?.CustKey, items]);
  const sources = useMemo(() => freightSourceRows(items, year, parentWeek), [items, year, parentWeek]);
  const selected = sources.filter(row => !excluded[row.sourceKey]);
  const freightProducts = products.filter(p => isFreightRow(p) && p.OutUnit === '박스');
  const existing = items.filter(isFreightRow);
  const drafts = buildFreightDraftRows(selected, freightProducts, rounding).map(row => {
    const saved = existing.find(item => item.OrderWeek === row.weekShort && Number(item.ProdKey) === Number(row.prodKey));
    return { ...row, enabled: row.name === '현지상차운임' && !saved, cost: Number(saved?.Cost || (row.name === '현지상차운임' ? 2000 : 1500)), ...edits[row.key] };
  });
  const update = (key, values) => { setEdits(prev => ({ ...prev, [key]: { ...prev[key], ...values } })); setConfirmed(false); };
  async function submit() {
    setError('');
    try {
      if (!confirmed) throw new Error('품목별 박스수량과 등록 내용을 확인해 주세요.');
      if (selected.some(row => row.boxes == null)) throw new Error('박스 환산을 확인할 수 없는 품목이 있습니다. 해당 품목을 제외하거나 품목 정보를 확인하세요.');
      const rows = validateFreightDraft(drafts.filter(row => row.enabled), { year, parentWeek, custKey: selectedShip?.CustKey, products: freightProducts });
      await onApply(rows);
    } catch (e) { setError(e.message || '운임 등록을 시작하지 못했습니다.'); }
  }
  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="운임비 추가" style={{position:'fixed',inset:0,zIndex:1400,background:'rgba(15,23,42,.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
    <div style={{width:'min(1500px,100%)',maxHeight:'94vh',overflow:'auto',background:'#fff',borderRadius:10,padding:16}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><h3 style={{margin:0}}>운임비 추가 · {selectedShip?.CustName} · {year}년 {parentWeek}차</h3><button disabled={applyBusy} onClick={onClose}>닫기</button></div>
      <p>품목별 박스 환산과 등록할 운임을 확인하세요. 등록하면 기존 추가 품목과 동일하게 확정 해제 → 주문·분배 등록 → 원래 확정 상태 복원을 진행합니다.</p>
      {error && <div role="alert" style={{background:'#fee2e2',color:'#991b1b',padding:12,marginBottom:10}}>{error}</div>}
      <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
        <section style={{flex:'1 1 600px',minWidth:0}}>
          <b>견적서 품목 · 박스수량 확인</b>
          <table className="tbl" style={{width:'100%',fontSize:12}}><thead><tr><th>포함</th><th>차수 / 출고일</th><th>품목</th><th>견적수량</th><th>환산 박스</th></tr></thead>
            <tbody>{sources.map(row => <tr key={row.sourceKey} style={{background:excluded[row.sourceKey]?'#f1f5f9':row.boxes==null?'#fee2e2':'#eff6ff'}}>
              <td><input aria-label={row.ProdName+' 계산 포함'} type="checkbox" checked={!excluded[row.sourceKey]} onChange={e=>{setExcluded(prev=>({...prev,[row.sourceKey]:!e.target.checked}));setConfirmed(false);}} /></td>
              <td>{row.OrderWeek}<br/>{row.outDate}</td><td>{row.ProdName}</td><td>{fmt(row.Quantity)} {row.Unit}</td><td>{row.boxes==null?'환산 확인 필요':fmt(row.boxes)}</td>
            </tr>)}</tbody>
          </table>
          <b>선택 합계 {fmt(selected.reduce((sum,row)=>sum+(row.boxes||0),0))}박스</b>
        </section>
        <section style={{flex:'1 1 560px',minWidth:0}}>
          <label>잔량 처리 <select value={rounding} onChange={e=>{setRounding(e.target.value);setConfirmed(false);}}>
            <option value="CEIL">올림 (4.5 → 5)</option><option value="FLOOR">버림 (4.5 → 4)</option><option value="EXACT">실수량 유지</option>
          </select></label>
          <p style={{fontSize:12}}>상차운임·운송료는 필요한 항목만 체크하세요. 수량·단가를 직접 수정할 수 있습니다. 단가는 기존 견적서와 동일한 부가세 포함 기준입니다.</p>
          <table className="tbl" style={{width:'100%',fontSize:12}}><thead><tr><th>등록</th><th>등록 차수 / 출고일</th><th>운임 품목</th><th>박스</th><th>박스당 단가</th></tr></thead>
            <tbody>{drafts.map(row=><tr key={row.key}>
              <td><input type="checkbox" aria-label={row.weekShort+' '+row.name+' 등록'} checked={row.enabled} onChange={e=>update(row.key,{enabled:e.target.checked})}/></td>
              <td>{row.weekShort}<br/>{row.shipmentDate}</td>
              <td><select style={{maxWidth:220,width:'100%'}} aria-label={row.weekShort+' '+row.name+' 품목'} value={row.prodKey} onChange={e=>update(row.key,{prodKey:Number(e.target.value)})}><option value="">품목 선택 · {row.name}</option>{freightProducts.map(p=><option key={p.ProdKey} value={p.ProdKey}>{p.ProdName}</option>)}</select></td>
              <td><input aria-label={row.weekShort+' '+row.name+' 박스'} type="number" min="0" step="any" value={row.qty} style={{width:65}} onChange={e=>update(row.key,{qty:e.target.value})}/></td>
              <td><input aria-label={row.weekShort+' '+row.name+' 단가'} type="number" min="0" value={row.cost} style={{width:85}} onChange={e=>update(row.key,{cost:e.target.value})}/></td>
            </tr>)}</tbody>
          </table>
          <p>등록 예상금액 <b>{fmt(drafts.filter(r=>r.enabled).reduce((s,r)=>s+Number(r.qty)*Number(r.cost),0))}원</b></p>
          {existing.length>0 && <details open><summary>기존 운임 내역 {existing.length}건 · 중복 등록 제외</summary>{existing.map((r,i)=><div key={i} style={{fontSize:12,padding:3}}>{r.OrderWeek} · {r.ProdName} · {fmt(r.Quantity)}{r.Unit} × {fmt(r.Cost)}원</div>)}</details>}
          <div style={{padding:'12px 0'}}><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 품목별 박스수량·차수·운임 단가를 확인했습니다.</label></div>
          <button className="btn btn-primary" disabled={applyBusy||!confirmed||!drafts.some(r=>r.enabled)} onClick={submit}>{applyBusy?'등록 준비 중…':'운임비 등록 시작'}</button>
        </section>
      </div>
    </div>
  </div>;
}
