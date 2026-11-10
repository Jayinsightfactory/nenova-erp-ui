import {useState} from 'react';
import {inlineDateModel,inlineDateInputs} from '../../lib/shipmentInlineDates.js';
import {majorInlineDateModel} from '../../lib/shipmentMajorInlineDates.js';
import {dateQuantityUnits,dateDisplayQuantity,dateInputQuantity,datePackingSignature} from '../../lib/shipmentDateDisplayUnits.js';
const labels=['일','월','화','수','목','금','토'];
const cell={padding:'0 2px',height:24,textAlign:'right',whiteSpace:'nowrap',resize:'none'};
export default function DistributionInlineDates({calendar,facts,majorFacts,year,week,custKey,prodKey,draft,onDraft,onOpen,disabled,loading,error}){
 const [chosenUnit,setChosenUnit]=useState('');
 const selected=String(week).slice(-5),majorLabel=selected.slice(0,2)+'차';
 const model=draft?.model??inlineDateModel(calendar,facts,year,week),inputs=draft?.inputs??{},product=draft?.product??facts[0]??majorFacts?.[0]??{};
 const major=majorInlineDateModel(calendar,majorFacts,year,week,custKey,prodKey);
 const matching=major.rows.find(r=>r.week===selected),stale=matching&&(matching.model.signature!==model.signature||datePackingSignature(matching.facts[0])!==datePackingSignature(product));
 const unitValues=major.rows.length?major.rows.flatMap(r=>[r.model.out,...r.model.dates.map(d=>d.ShipmentQuantity)]):[model.out,...model.dates.map(r=>r.ShipmentQuantity)];
 const units=dateQuantityUnits(product,unitValues),presentation=units.find(p=>p.unit===(draft?.unit??chosenUnit))??units[0];
 const state=inlineDateInputs(model,inputs),unitError=!presentation?'단·송이 입수 또는 기존 수량을 확인하세요. 정확한 정수 환산이 필요합니다.':'',inputError=Object.values(draft?.errors??{}).find(Boolean)||'';
 const comparisonError=stale||(!matching&&facts.length)?'선택 차수 분배가 변경되었습니다. 다시 조회하세요.':major.error;
 const blocked=disabled||loading||!!error||!!model.error||!!unitError||!!comparisonError;
 const rows=major.rows.some(r=>r.week===selected)?major.rows:[...major.rows,{week:selected,model,facts}].sort((a,b)=>a.week.localeCompare(b.week));
 const change=(timestamp,value)=>{const converted=dateInputQuantity(value,presentation),next={...inputs,[timestamp]:converted.quantity};onDraft(inlineDateInputs(model,next).dirty?{model,product,unit:presentation.unit,inputs:next,displayInputs:{...draft?.displayInputs,[timestamp]:value},errors:{...draft?.errors,[timestamp]:converted.error}}:null);};
 const show=value=>dateDisplayQuantity(value,presentation)||'—';
 const issue=error||comparisonError||model.error||unitError||inputError;
 return <div data-testid={`inline-dates-${custKey}-${prodKey}`} style={{minWidth:510,fontSize:11,lineHeight:1.15}} onClick={e=>e.stopPropagation()}>
  <table aria-label={`${majorLabel} 세부차수별 출고일 수량`} style={{borderCollapse:'collapse',width:'100%',margin:0,tableLayout:'fixed'}}>
   <thead><tr>
    <th style={{...cell,width:55,textAlign:'left'}}><select aria-label={`${custKey} ${prodKey} 날짜 수량 단위`} value={presentation?.unit??''} disabled={blocked||!!draft} onChange={e=>setChosenUnit(e.target.value)} title={draft?'날짜 저장 또는 취소 후 단위를 바꿀 수 있습니다.':'원장 단위를 바꾸지 않고 단·송이로 표시합니다.'}>
     {!units.length&&<option value="">단위</option>}{units.map(p=><option key={p.unit} value={p.unit}>{p.unit}</option>)}
    </select></th>
    {model.days.map(r=><th key={r.Timestamp} scope="col" style={{...cell,width:44,textAlign:'center',fontWeight:400}}>{r.Timestamp.slice(5,10).replace('-','/')} {labels[r.WeekDay-1]}</th>)}
    <th scope="col" style={{...cell,width:66}}>총수량</th>
    <th style={{...cell,width:64}}>출고일</th>
   </tr></thead>
   <tbody>{rows.map(row=>{const active=row.week===selected;return <tr key={row.week} data-subweek-row={row.week} aria-label={`${row.week}${active?' 선택 차수':' 조회 전용'}`} style={{background:active?'var(--bg-blue)':'transparent'}}>
    <th scope="row" style={{...cell,textAlign:'left',fontWeight:active?700:400}}>{row.week}</th>
    {model.days.map((r,i)=><td key={r.Timestamp} style={cell}>{active?<input type="number" min="0" step="1" aria-label={`${custKey} ${prodKey} ${r.Timestamp.slice(0,10)} 출고일 수량`} title={presentation?`${presentation.unit} 정수 입력`:unitError} data-date-inline={r.Timestamp.slice(0,10)} data-display-unit={presentation?.unit??''}
     value={draft?.displayInputs?.[r.Timestamp]??dateDisplayQuantity(inputs[r.Timestamp]??model.baseline[r.Timestamp]??0,presentation)} disabled={blocked}
     onChange={e=>change(r.Timestamp,e.target.value)}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const root=e.currentTarget.closest('[data-testid^="inline-dates-"]');(root.querySelectorAll('input')[i+1]??root.querySelector('[data-inline-preview]'))?.focus();}if(e.key==='Escape'&&draft){e.preventDefault();onDraft(null);}}}
     style={{display:'block',boxSizing:'border-box',width:'100%',minWidth:34,height:23,padding:'0 2px',textAlign:'right',border:'1px solid var(--border2)',borderRadius:3,background:state.dirty?'#fff7df':'var(--bg)'}} />:show(row.model.baseline[r.Timestamp]??0)}</td>)}
    <td data-subweek-total={row.week} style={{...cell,fontWeight:700}}>{show(row.model.out)}</td><td style={cell}>{active&&<button type="button" className="btn btn-sm" data-inline-preview data-ai-verify={`date-edit-${custKey}-${prodKey}`} disabled={blocked||!state.valid||!!inputError||Math.abs(state.total-model.out)>0.000001}
     onClick={()=>onOpen({signature:model.signature,packingSignature:datePackingSignature(product),unit:presentation.unit,allocations:model.days.map(r=>({timestamp:r.Timestamp,quantity:inputs[r.Timestamp]??model.baseline[r.Timestamp]??0}))})} style={{fontSize:10,padding:'2px 3px'}}>확인·저장</button>}</td>
   </tr>;})}</tbody>
   <tfoot><tr style={{fontWeight:700,borderTop:'1px solid var(--border2)'}}><th scope="row" style={{...cell,textAlign:'left'}}>{majorLabel} 합계</th>
    {model.days.map(r=>{const value=(major.dayTotals[r.Timestamp]??0)-(matching?.model.baseline[r.Timestamp]??0)+Number(inputs[r.Timestamp]??model.baseline[r.Timestamp]??0);return <td key={r.Timestamp} data-major-day={r.Timestamp.slice(0,10)} style={cell}>{comparisonError||!state.valid?'—':show(value)}</td>;})}
    <td data-major-total style={{...cell,color:'var(--blue)',fontSize:13}}>{comparisonError?'—':show(major.total)}</td><td style={cell}>{draft&&<button type="button" className="btn btn-sm" title="미저장 날짜 취소" onClick={()=>onDraft(null)} disabled={disabled} style={{padding:'1px 3px',fontSize:10}}>날짜 취소</button>}</td>
   </tr></tfoot>
  </table>
  {(loading||issue||state.dirty&&Math.abs(state.total-model.out)>.000001)&&<span role="status">{loading?'출고일 조회 중…':issue||`날짜 합계 ${show(state.total)} / 출고 ${show(model.out)} ${presentation?.unit??''}`}</span>}
 </div>;
}
