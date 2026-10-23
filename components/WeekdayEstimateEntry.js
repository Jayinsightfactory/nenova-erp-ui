import {useState} from 'react';
import {parseWeekdayQuerySelection} from '../lib/weekdayQuerySelection.js';

export default function WeekdayEstimateEntry({renderWorkspace}) {
  const [year,setYear]=useState(String(new Date().getFullYear()));
  const [week,setWeek]=useState(''),[selected,setSelected]=useState(null),[error,setError]=useState('');
  if(selected)return renderWorkspace(selected);
  function query(event){
    event.preventDefault();
    try{setSelected(parseWeekdayQuerySelection(year,week));setError('');}
    catch(e){setError(e.message);}
  }
  return <main style={{padding:20,maxWidth:760}}>
    <h1 style={{fontSize:22,marginBottom:12}}>주광 견적서</h1>
    <p>연도와 차수를 선택한 뒤 조회하세요.</p>
    <form onSubmit={query} style={{display:'flex',alignItems:'end',gap:12,flexWrap:'wrap',margin:'20px 0'}}>
      <label>연도 <input aria-label="조회 연도" type="number" min="2000" max="2200" step="1" required value={year} onChange={e=>setYear(e.target.value)} style={{width:100,padding:8,font:'inherit'}}/></label>
      <label>차수 <input aria-label="조회 차수" type="number" min="1" max="53" step="1" required value={week} onChange={e=>setWeek(e.target.value)} placeholder="예: 43" style={{width:90,padding:8,font:'inherit'}}/></label>
      <button type="submit" className="primary" style={{padding:'9px 22px',font:'inherit'}}>조회</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    <p style={{color:'#536477'}}>조회한 차수와 앞뒤 차수를 함께 표시합니다. 보관한 입력 초안은 조회 후 복구됩니다.</p>
  </main>;
}
