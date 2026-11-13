import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import EstimateLedgerAlerts from '../components/EstimateLedgerAlerts';
function App(){
 const [scope,setScope]=useState({year:'2026',week:36,request:1});
 return <main style={{padding:20,fontFamily:'sans-serif'}}><h1>견적서 원장 연결 알림 · 연습용</h1>
 <p>운영 DB 연결 없음 · 기존 수량·금액 수정 없음</p>
 <div>{[36,42,40,41,39,37].map(week=><button key={week} onClick={()=>setScope({year:'2026',week,request:Date.now()})}>{week}차 연습</button>)}</div>
 <EstimateLedgerAlerts scope={scope}/></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
