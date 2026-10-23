import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import LatestArrivalReference from '../components/LatestArrivalReference';
import {useLatestArrivalReferences} from '../lib/useLatestArrivalReferences';
function App(){
 const [year,setYear]=useState('2026'),[unit,setUnit]=useState('단');
 const items=[{prodKey:667,unit},{prodKey:866,unit:'박스'}];
 const state=useLatestArrivalReferences(year,items);
 return <main style={{padding:24,fontFamily:'sans-serif',fontSize:16}}><h1>최신 원가 통합 · 읽기 전용 검증</h1>
 <label>연도 <select value={year} onChange={e=>setYear(e.target.value)}><option>2026</option><option>2025</option></select></label>
 <label>단위 <select value={unit} onChange={e=>setUnit(e.target.value)}><option>단</option><option>송이</option><option>잘못된단위</option></select></label>
 <p>과거 확정 원가 1,200원 · 매입액 9,000원 · 이익 1,000원 · 재고 10 (보존)</p>
 <table style={{width:'100%'}}><thead><tr><th>품목</th><th>최신 원가 참고</th></tr></thead><tbody>{items.map(item=><tr key={item.prodKey}><td>품목 {item.prodKey}</td><td><LatestArrivalReference state={state} item={item}/></td></tr>)}</tbody></table>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
