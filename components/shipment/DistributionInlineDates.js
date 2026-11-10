import {inlineDateModel,inlineDateInputs} from '../../lib/shipmentInlineDates.js';
const labels=['일','월','화','수','목','금','토'];
export default function DistributionInlineDates({calendar,facts,year,week,custKey,prodKey,draft,onDraft,onOpen,disabled,loading,error}){
 const model=draft?.model??inlineDateModel(calendar,facts,year,week),inputs=draft?.inputs??{},state=inlineDateInputs(model,inputs),blocked=disabled||loading||!!error||!!model.error;
 return <div data-testid={`inline-dates-${custKey}-${prodKey}`} style={{minWidth:430,fontSize:11}} onClick={e=>e.stopPropagation()}>
  <div style={{display:'flex',gap:3,alignItems:'end'}}>{model.days.map((r,i)=><label key={r.Timestamp} style={{width:49,textAlign:'center',fontWeight:600}}>{labels[r.WeekDay-1]}<br/><span style={{fontWeight:400}}>{r.Timestamp.slice(5,10).replace('-','/')}</span>
   <input type="number" min="0" step="0.001" aria-label={`${custKey} ${prodKey} ${r.Timestamp.slice(0,10)} 출고일 수량`} data-date-inline={r.Timestamp.slice(0,10)} value={inputs[r.Timestamp]??model.baseline[r.Timestamp]??0} disabled={blocked}
    onChange={e=>{const next={...inputs,[r.Timestamp]:e.target.value};onDraft(inlineDateInputs(model,next).dirty?{model,inputs:next}:null);}}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const row=e.currentTarget.closest('[data-testid^="inline-dates-"]');(row.querySelectorAll('input')[i+1]??row.querySelector('[data-inline-preview]'))?.focus();}}}
    style={{display:'block',width:49,height:26,textAlign:'right',border:'1px solid var(--border2)',borderRadius:3,background:state.dirty?'#fff7df':'var(--bg)'}} /></label>)}
   <button type="button" className="btn btn-sm" data-inline-preview data-ai-verify={`date-edit-${custKey}-${prodKey}`} disabled={blocked||!state.valid||Math.abs(state.total-model.out)>0.000001} onClick={()=>onOpen(draft?{signature:model.signature,allocations:model.days.map(r=>({timestamp:r.Timestamp,quantity:inputs[r.Timestamp]??model.baseline[r.Timestamp]??0}))}:null)} style={{fontSize:10,padding:3}}>확인·저장</button>
  </div>
  {loading?'출고일 조회 중…':error||model.error?<span role="status">{error||model.error}</span>:<span style={{color:state.dirty?'#b45309':'var(--text3)'}}>합계 {state.total} / 출고 {model.out}{state.dirty?' · 미저장':''}</span>}
  {draft&&<button type="button" className="btn btn-sm" onClick={()=>onDraft(null)} disabled={disabled} style={{marginLeft:5,padding:'0 4px',fontSize:10}}>날짜 취소</button>}
 </div>;
}
