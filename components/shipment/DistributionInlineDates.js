import {useState} from 'react';
import {inlineDateModel,inlineDateInputs} from '../../lib/shipmentInlineDates.js';
import {dateQuantityUnits,dateDisplayQuantity,dateInputQuantity,datePackingSignature} from '../../lib/shipmentDateDisplayUnits.js';
const labels=['일','월','화','수','목','금','토'];
export default function DistributionInlineDates({calendar,facts,year,week,custKey,prodKey,draft,onDraft,onOpen,disabled,loading,error}){
 const [chosenUnit,setChosenUnit]=useState('');
 const model=draft?.model??inlineDateModel(calendar,facts,year,week),inputs=draft?.inputs??{},product=draft?.product??facts[0]??{};
 const units=dateQuantityUnits(product,[model.out,...model.dates.map(r=>r.ShipmentQuantity)]),presentation=units.find(p=>p.unit===(draft?.unit??chosenUnit))??units[0];
 const state=inlineDateInputs(model,inputs),unitError=!presentation?'단·송이 입수 또는 기존 수량을 확인하세요. 정확한 정수 환산이 필요합니다.':'',inputError=Object.values(draft?.errors??{}).find(Boolean)||'';
 const blocked=disabled||loading||!!error||!!model.error||!!unitError;
 const change=(timestamp,value)=>{const converted=dateInputQuantity(value,presentation),next={...inputs,[timestamp]:converted.quantity};onDraft(inlineDateInputs(model,next).dirty?{model,product,unit:presentation.unit,inputs:next,displayInputs:{...draft?.displayInputs,[timestamp]:value},errors:{...draft?.errors,[timestamp]:converted.error}}:null);};
 return <div data-testid={`inline-dates-${custKey}-${prodKey}`} style={{minWidth:430,fontSize:11}} onClick={e=>e.stopPropagation()}>
  <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}><span>{model.days.length?`${model.days[0].Timestamp.slice(0,10)} ~ ${model.days.at(-1).Timestamp.slice(0,10)}`:'차수 출고기간 조회'}</span>
   <label>수량 단위 <select aria-label={`${custKey} ${prodKey} 날짜 수량 단위`} value={presentation?.unit??''} disabled={blocked||!!draft} onChange={e=>setChosenUnit(e.target.value)} title={draft?'날짜 저장 또는 취소 후 단위를 바꿀 수 있습니다.':'원장 단위를 바꾸지 않고 단·송이로 표시합니다.'}>
    {!units.length&&<option value="">환산 확인</option>}{units.map(p=><option key={p.unit} value={p.unit}>{p.unit}</option>)}
   </select></label>
  </div>
  <div style={{display:'flex',gap:3,alignItems:'end'}}>{model.days.map((r,i)=><label key={r.Timestamp} style={{width:49,textAlign:'center',fontWeight:600}}>{r.Timestamp.slice(5,10).replace('-','/')}<br/><span style={{fontWeight:400}}>{labels[r.WeekDay-1]}</span>
   <input type="number" min="0" step="1" aria-label={`${custKey} ${prodKey} ${r.Timestamp.slice(0,10)} 출고일 수량`} title={presentation?`${presentation.unit} 정수 입력`:unitError} data-date-inline={r.Timestamp.slice(0,10)} data-display-unit={presentation?.unit??''}
    value={draft?.displayInputs?.[r.Timestamp]??dateDisplayQuantity(inputs[r.Timestamp]??model.baseline[r.Timestamp]??0,presentation)} disabled={blocked}
    onChange={e=>change(r.Timestamp,e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const row=e.currentTarget.closest('[data-testid^="inline-dates-"]');(row.querySelectorAll('input')[i+1]??row.querySelector('[data-inline-preview]'))?.focus();}}}
    style={{display:'block',width:49,height:26,textAlign:'right',border:'1px solid var(--border2)',borderRadius:3,background:state.dirty?'#fff7df':'var(--bg)'}} /></label>)}
   <button type="button" className="btn btn-sm" data-inline-preview data-ai-verify={`date-edit-${custKey}-${prodKey}`} disabled={blocked||!state.valid||!!inputError||Math.abs(state.total-model.out)>0.000001}
    onClick={()=>onOpen({signature:model.signature,packingSignature:datePackingSignature(product),unit:presentation.unit,allocations:model.days.map(r=>({timestamp:r.Timestamp,quantity:inputs[r.Timestamp]??model.baseline[r.Timestamp]??0}))})} style={{fontSize:10,padding:3}}>확인·저장</button>
  </div>
  {loading?'출고일 조회 중…':error||model.error||unitError||inputError?<span role="status">{error||model.error||unitError||inputError}</span>:<span style={{color:state.dirty?'#b45309':'var(--text3)'}}>합계 {dateDisplayQuantity(state.total,presentation)} {presentation.unit} / 출고 {dateDisplayQuantity(model.out,presentation)} {presentation.unit}{state.dirty?' · 미저장':''}</span>}
  {draft&&<button type="button" className="btn btn-sm" onClick={()=>onDraft(null)} disabled={disabled} style={{marginLeft:5,padding:'0 4px',fontSize:10}}>날짜 취소</button>}
 </div>;
}
