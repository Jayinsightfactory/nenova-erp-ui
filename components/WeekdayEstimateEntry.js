import {useRef,useState} from 'react';
import {parseWeekdayQuerySelection,stepWeekdayQuerySelection} from '../lib/weekdayQuerySelection.js';

export default function WeekdayEstimateEntry({renderWorkspace}) {
  const [year,setYear]=useState(String(new Date().getFullYear()));
  const [week,setWeek]=useState(''),[selected,setSelected]=useState(null),[error,setError]=useState('');
  const weekInput=useRef(null);
  function stepWeek(direction){
    const input=weekInput.current;
    if(!input)return;
    // Keep React as the owner of the value; native stepUp/Down mutates only the DOM.
    const visible=input.value;
    setWeek(current=>stepWeekdayQuerySelection(visible || current,direction));
  }
  if(selected)return renderWorkspace(selected);
  function query(event){
    event.preventDefault();
    try{setSelected(parseWeekdayQuerySelection(year,week));setError('');}
    catch(e){setError(e.message);}
  }
  return <main style={{padding:20,maxWidth:760}}>
    <h1 style={{fontSize:22,marginBottom:12}}>주광 견적서</h1>
    <p>연도와 차수를 선택한 뒤 조회하세요.</p>
    <form onSubmit={query} style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',margin:'20px 0'}}>
      <label>연도 <input aria-label="조회 연도" type="number" min="2000" max="2200" step="1" required value={year} onChange={e=>setYear(e.target.value)} style={{width:100,padding:8,font:'inherit'}}/></label>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <label>차수 <input ref={weekInput} className="weekday-week-input" aria-label="조회 차수" type="number" min="1" max="53" step="1" required value={week} onChange={e=>setWeek(e.target.value)} placeholder="예: 43" style={{width:100,padding:12,fontSize:20}}/></label>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <button type="button" className="weekday-week-step" aria-label="차수 1 증가" title="차수 1 증가" disabled={Number(week)>=53} onClick={()=>stepWeek(1)}>▲</button>
          <button type="button" className="weekday-week-step" aria-label="차수 1 감소" title="차수 1 감소" disabled={week!==''&&Number(week)<=1} onClick={()=>stepWeek(-1)}>▼</button>
        </div>
      </div>
      <button type="submit" className="primary" style={{padding:'9px 22px',font:'inherit'}}>조회</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    <p style={{color:'#536477'}}>조회한 차수와 앞뒤 차수를 함께 표시합니다. 보관한 입력 초안은 조회 후 복구됩니다.</p>
    <style jsx>{`
      .weekday-week-input { appearance:textfield; -moz-appearance:textfield; }
      .weekday-week-input::-webkit-inner-spin-button,
      .weekday-week-input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
      .weekday-week-step { min-width:56px; min-height:44px; padding:8px 16px; font-size:20px; line-height:1; border:1px solid #7895b5; border-radius:5px; background:#f3f7fd; color:#173d6d; cursor:pointer; }
      .weekday-week-step:disabled { opacity:.45; cursor:default; }
      .weekday-week-step:focus-visible { outline:3px solid #2563eb; outline-offset:2px; }
    `}</style>
  </main>;
}
