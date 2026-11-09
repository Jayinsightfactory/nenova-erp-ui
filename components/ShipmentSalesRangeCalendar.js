import { useRef, useState } from 'react';
import { calendarDate } from '../lib/estimateShipmentDateMatrix';
import styles from './EstimateShipmentDateSales.module.css';
const days=['월','화','수','목','금','토','일'];
function monthOf(date){const value=new Date(date.slice(0,7)+'-01T00:00:00Z');return Number.isFinite(value.getTime())?value:new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1));}
function shiftMonth(date,step){const next=new Date(date);next.setUTCMonth(next.getUTCMonth()+step);return next;}
export default function ShipmentSalesRangeCalendar({ startDate,endDate,onChange }){
  const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>monthOf(startDate)),[pending,setPending]=useState(null);
  const button=useRef(null),host=useRef(null);
  function close(){setOpen(false);setPending(null);button.current?.focus();}
  function choose(date){if(!pending){setPending(date);onChange(date,date);}else{onChange(date<pending?date:pending,date<pending?pending:date);close();}}
  return <div className={styles.calendarHost} ref={host} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setPending(null);}}}>
    <button type="button" ref={button} aria-expanded={open} aria-controls="shipment-range-calendar" onClick={()=>{setMonth(monthOf(startDate));setPending(null);setOpen(!open);}}>기간 달력</button>
    {open&&<div id="shipment-range-calendar" className={styles.calendar} role="group" aria-label="출고일 기간 달력" onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      if(e.key in steps&&e.target.dataset.date){e.preventDefault();const date=new Date(e.target.dataset.date+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+steps[e.key]);host.current.querySelector(`[data-date="${calendarDate(date)}"]`)?.focus();}
    }}>
      <div className={styles.calendarNav}><button type="button" aria-label="이전 달" onClick={()=>setMonth(m=>shiftMonth(m,-1))}>◀</button><strong>{pending?'종료일을 선택하세요':'시작일과 종료일을 차례로 선택하세요'}</strong><button type="button" aria-label="다음 달" onClick={()=>setMonth(m=>shiftMonth(m,1))}>▶</button></div>
      <div className={styles.months}>{[0,1].map(offset=>{const current=shiftMonth(month,offset),y=current.getUTCFullYear(),m=current.getUTCMonth();const blank=(current.getUTCDay()+6)%7,count=new Date(Date.UTC(y,m+1,0)).getUTCDate();return <div key={offset}>
        <h4>{y}년 {m+1}월</h4><div className={styles.calendarGrid}>{days.map(d=><span key={d}>{d}</span>)}{Array.from({length:blank},(_,i)=><span key={'b'+i}/>)}
        {Array.from({length:count},(_,i)=>{const date=calendarDate(Date.UTC(y,m,i+1));return <button type="button" key={date} data-date={date} aria-label={date} aria-pressed={date===startDate||date===endDate} className={date>=startDate&&date<=endDate?styles.inRange:''} onClick={()=>choose(date)}>{i+1}</button>;})}</div>
      </div>;})}</div><button type="button" onClick={close}>달력 닫기</button>
    </div>}
  </div>;
}
