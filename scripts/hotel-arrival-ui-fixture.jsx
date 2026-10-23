import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import ArrivalFxControls from '../components/raum/ArrivalFxControls';
import HotelArrivalCostReference from '../components/raum/HotelArrivalCostReference';
function App(){
 const [rates,setRates]=useState({});
 const ref={sourceKind:'INVOICE',currency:'USD',exchangeRate:1000,rawCost:1200,cost:1200,rawUnit:'단',unit:'단',fixedPerUnitKRW:200,farm:'TEST FARM',sourceFile:'격리 시험 인보이스',orderYear:'2026'};
 const item={prodKey:1,costPrice:900,arrivalHistory:[{...ref,week:'40-1',referenceKey:'a',cost:1200},{...ref,week:'42-1',referenceKey:'b',cost:1200}]};
 return <main style={{fontFamily:'sans-serif',padding:20}}><h2>도착원가 UI 격리 검증 · DB 연결 없음</h2>
 <table style={{borderCollapse:'collapse',width:900}}><thead><tr><th>품목</th><th style={{width:480,background:'#ecfeff'}}>해당 차수 도착원가<ArrivalFxControls onApply={setRates}/></th><th>매입액</th><th>이익</th></tr></thead><tbody><tr><td>시험 수국</td><td><HotelArrivalCostReference item={item} rates={rates}/></td><td>9,000</td><td>1,000</td></tr></tbody></table></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
