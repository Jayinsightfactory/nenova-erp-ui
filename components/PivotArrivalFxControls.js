import { useState } from 'react';
import { normalizePivotFxRates, PIVOT_FX_CURRENCIES } from '../lib/pivotArrivalFx';

export default function PivotArrivalFxControls({ rates, onApply, disabled, rows }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const active = Object.keys(rates).length > 0;
  const failures = [...new Map(rows.filter(row=>row.ArrivalFxStatus?.startsWith('재계산 불가')).map(row=>[`${row.OrderYear}|${row.OrderWeek}|${row.ProdKey}`,row])).values()];
  const apply = () => { try { onApply(normalizePivotFxRates(draft)); setError(''); setOpen(false); } catch (cause) { setError(cause.message); } };
  return <section aria-label="도착원가 환율" style={{margin:'6px 0',padding:8,border:'1px solid #b8cce2',borderRadius:6,background:active?'#edf6ff':'#f8fafc'}}>
    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <button className="btn btn-sm" disabled={disabled} aria-expanded={open} onClick={()=>{setDraft({...rates});setError('');setOpen(!open);}}>도착원가 환율</button>
      <span role="status" style={{fontSize:13}}>{active ? `${Object.entries(rates).map(([code,rate])=>`${code} ${rate.toLocaleString('ko-KR')}원`).join(' · ')} 적용 중` : '각 원가자료의 원본 환율 사용'}</span>
      {active && <button className="btn btn-sm" disabled={disabled} onClick={()=>{onApply({});setDraft({});setError('');}}>원본 환율로 복원</button>}
      <small>조회·엑셀 전용 · 원본 저장 안 함</small>
    </div>
    {open && <div style={{marginTop:8}}>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}>{PIVOT_FX_CURRENCIES.map(code=><label key={code} style={{fontSize:12}}>{code} 1단위당 원화<br/><input aria-label={`${code} 환율`} type="number" min="0.000001" step="any" placeholder="원본 유지" value={draft[code]??''} onChange={event=>setDraft({...draft,[code]:event.target.value})} style={{width:125,padding:6}}/></label>)}<button className="btn btn-primary btn-sm" disabled={disabled} onClick={apply}>환율 적용</button><button className="btn btn-sm" onClick={()=>{setOpen(false);setError('');}}>취소</button></div>
      <p style={{fontSize:12,margin:'6px 0'}}>빈칸은 원본 유지. 조회 범위 전체에 적용합니다. 외화 비용만 변경하고 관세·국내 비용 등 원화 비용은 유지합니다. 통화는 기존 국가별 기준(네덜란드 EUR·중국 CNY·콜롬비아/태국 USD 등)을 따릅니다.</p>
      {error && <div role="alert" style={{color:'#b42318'}}>{error}</div>}
    </div>}
    {active && failures.length>0 && <details style={{fontSize:12,marginTop:6}}><summary style={{color:'#b45309',cursor:'pointer'}}>재계산 불가 {failures.length}개 품목·차수 — 해당 원가는 빈칸으로 표시 (내역 보기)</summary><ul>{failures.map(row=><li key={`${row.OrderYear}|${row.OrderWeek}|${row.ProdKey}`}>{row.OrderYear} {row.OrderWeek} · {row.ProdName} — {row.ArrivalFxStatus}</li>)}</ul></details>}
  </section>;
}
