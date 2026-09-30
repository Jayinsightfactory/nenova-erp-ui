import {Fragment,useMemo,useState} from 'react';
import {buildMonthlyProfitSummary} from '../../lib/profitReportMonthly';
import {buildRaumPnlMonthlySummary} from '../../lib/raumPnlMonthly';
import {monthlyDemoWeeks} from '../../lib/mobileMonthlyDemo';
import s from './MonthlyDemoReport.module.css';
const money=value=>Math.round(value).toLocaleString('ko-KR');
const margin=value=>value==null?'—':`${(value*100).toFixed(1)}%`;
const Amount=({value})=><><span className={s.fullAmount}>{money(value)}</span><span className={s.mobileAmount} title={`${money(value)}원`}>{(value/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})}</span></>;

export default function MonthlyDemoReport({onWeek,reportId='weekly-profit',title='매출이익자료'}) {
  const [year,setYear]=useState('2026'),[month,setMonth]=useState('all'),[expanded,setExpanded]=useState(null);
  const hotel=reportId!=='weekly-profit';
  const summary=useMemo(()=>{
    const weeks=monthlyDemoWeeks(year,reportId);
    const result=buildMonthlyProfitSummary(weeks,year);
    if(hotel){
      const hotels=buildRaumPnlMonthlySummary(weeks.map(w=>({OrderYear:year,MajorWeek:w.major,QuoteDate:w.period.endDate,SaleTotal:w.totals.C,CostTotal:w.totals.I,ProfitTotal:w.totals.J})));
      result.months.forEach(m=>{const h=hotels.find(r=>r.month===m.monthKey);if(h)m.totals={C:h.sale,I:h.cost,J:h.profit,K:h.rate};});
    }
    return result;
  },[year,reportId,hotel]);
  const visible=summary.months.filter(row=>month==='all'||String(row.month)===month);
  return <section className={s.panel} aria-label={`${title} 월별 보고서`}>
    <div className={s.toolbar}>
      <label>연도 <select aria-label="월별 조회 연도" value={year} onChange={e=>{setYear(e.target.value);setExpanded(null);}}><option>2026</option><option>2025</option></select></label>
      <label>월 <select aria-label="조회 월" value={month} onChange={e=>{setMonth(e.target.value);setExpanded(null);}}><option value="all">전체</option>{summary.months.map(m=><option key={m.month} value={m.month}>{m.month}월</option>)}</select></label>
      <span><span className={s.fullAmount}>단위: 원</span><span className={s.mobileAmount}>단위: 만원</span> · 예시</span>
    </div>
    <h2 className={s.title}>{title} · 월별</h2>
    <div className={s.scroll} tabIndex={0} role="region" aria-label="월별 손익 표, 좌우 스크롤">
      <table className={s.table}><thead><tr><th>월 / 차수</th><th>매출액</th><th>{hotel?'매입액':'매출원가'}</th><th>{hotel?'순이익':'매출이익'}</th><th>이익률</th></tr></thead><tbody>
        {visible.map(row=>{
          const hasData=row.includedWeeks.length>0,open=expanded===row.month;
          return <Fragment key={row.month}><tr>
            <th scope="row">{hasData?<button aria-expanded={open} aria-controls={`month-weeks-${row.month}`} onClick={()=>setExpanded(open?null:row.month)}>{open?'▾':'▸'} {row.month}월</button>:<span>{row.month}월</span>}<small>{hasData?`${row.includedWeeks.length}개 차수`:'자료 없음'}</small></th>
            <td>{hasData?<Amount value={row.totals.C}/>:'—'}</td><td>{hasData?<Amount value={row.totals.I}/>:'—'}</td><td className={s.profit}>{hasData?<Amount value={row.totals.J}/>:'—'}</td><td>{hasData?margin(row.totals.K):'—'}</td>
          </tr>{open&&<tr id={`month-weeks-${row.month}`}><td colSpan={5} className={s.detail}>
            <table aria-label={`${row.month}월 포함 차수`}><thead><tr><th>차수 / 기간</th><th>매출액</th><th>{hotel?'매입액':'매출원가'}</th><th>{hotel?'순이익':'매출이익'}</th><th>보기</th></tr></thead><tbody>{row.includedWeeks.map(w=><tr key={w.major}><th scope="row">{Number(w.major)}차<small>{w.period.startDate} ~ {w.period.endDate}</small>{w.period.kind==='boundary'&&<small>월경계 · 종료일 귀속</small>}</th><td><Amount value={w.totals.C}/></td><td><Amount value={w.totals.I}/></td><td><Amount value={w.totals.J}/></td><td><button aria-label={`${year}년 ${Number(w.major)}차 보고서 보기`} onClick={()=>onWeek(`${year}-${w.major}`)}>보기</button></td></tr>)}</tbody></table>
          </td></tr>}</Fragment>;
        })}
      </tbody></table>
    </div>
    <p className={s.note}>예시 38·39차만 포함 · {hotel?'견적일의 월 기준':'기간 종료월 기준'}</p>
  </section>;
}
