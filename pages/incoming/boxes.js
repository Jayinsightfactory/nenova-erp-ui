import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi.js';
import { summarizeReceipts } from '../../lib/warehouseBoxSummary.js';

const fmt = value => value == null ? '미기재' : Number(value).toLocaleString('ko-KR',{maximumFractionDigits:6});
const options = (rows,field) => [...new Set(rows.map(r=>r[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true}));
export default function ReceiptBoxes() {
  const current=String(new Date().getFullYear());
  const [year,setYear]=useState(current),[toYear,setToYear]=useState(current);
  const [period,setPeriod]=useState('week'),[dimension,setDimension]=useState('both');
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [week,setWeek]=useState(''),[month,setMonth]=useState(''),[country,setCountry]=useState(''),[flower,setFlower]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let live=true;setLoading(true);setError('');setData(null);
    apiGet('/api/warehouse/boxes',{year,toYear}).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};},[year,toYear,refresh]);
  useEffect(()=>{const onVisible=()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1);};
    document.addEventListener('visibilitychange',onVisible);return()=>document.removeEventListener('visibilitychange',onVisible);},[]);
  const rows=data?.rows||[];
  const summary=useMemo(()=>summarizeReceipts(rows,{year,toYear,period,dimension,week,month,country,flower}),[data,year,toYear,period,dimension,week,month,country,flower]);
  const total=summary.totals;
  const years=Array.from({length:Math.max(15,+current-1998)},(_,i)=>String(+current+1-i));
  const clear=()=>{setWeek('');setMonth('');setCountry('');setFlower('');};
  const staleFilter=data&&((week&&!options(rows,'OrderWeek').includes(week))||(country&&!options(rows,'country').includes(country))||(flower&&!options(rows,'flower').includes(flower)));
  const weightText=(value,missing,mixed)=>value==null?(mixed?'혼합 별도':`미기재 ${missing}건`):`${fmt(value)}${missing?' (미기재 '+missing+'건)':''}${mixed?' + 혼합 별도':''}`;
  return <section className="box-page">
    <h1 data-ui-page-title>입고 박스·중량 현황</h1>
    <p>인보이스 입고등록 완료 후 원장 수량을 조회합니다. 차수·연도는 주문연도, 월별은 실제 입고일 기준입니다.</p>
    <div className="filters">
      <label>시작 연도 <select value={year} onChange={e=>{const v=e.target.value;setYear(v);if(+toYear<+v||+toYear-+v>9)setToYear(v);clear();}}>{years.map(y=><option key={y}>{y}</option>)}</select></label>
      <label>끝 연도 <select value={toYear} onChange={e=>{setToYear(e.target.value);clear();}}>{years.filter(y=>+y>=+year&&+y<=+year+9).map(y=><option key={y}>{y}</option>)}</select></label>
      <label>기간 구분 <select value={period} onChange={e=>setPeriod(e.target.value)}><option value="week">차수별</option><option value="month">월별</option><option value="year">연도별</option></select></label>
      <label>분류 구분 <select value={dimension} onChange={e=>setDimension(e.target.value)}><option value="both">국가·품종별</option><option value="country">국가별</option><option value="flower">품종별</option></select></label>
      <button onClick={()=>setRefresh(v=>v+1)} disabled={loading}>새로고침</button><a href="/incoming">입고관리</a>
    </div>
    <div className="filters">
      <label>세부차수 <select value={week} onChange={e=>setWeek(e.target.value)}><option value="">전체</option>{options(rows,'OrderWeek').map(v=><option key={v}>{v}</option>)}</select></label>
      <label>입고월 <select value={month} onChange={e=>setMonth(e.target.value)}><option value="">전체</option>{[...new Set(rows.map(r=>String(r.inputDate||'').slice(0,7)).filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}</select></label>
      <label>국가 <select value={country} onChange={e=>{setCountry(e.target.value);setFlower('');}}><option value="">전체</option>{options(rows,'country').map(v=><option key={v}>{v}</option>)}</select></label>
      <label>품종 <select value={flower} onChange={e=>setFlower(e.target.value)}><option value="">전체</option>{options(rows.filter(r=>!country||r.country===country),'flower').map(v=><option key={v}>{v}</option>)}</select></label>
      <button onClick={clear}>필터 초기화</button>
    </div>
    {loading&&<p role="status">입고 박스·중량 조회 중…</p>}
    {error&&<p role="alert">조회 실패: {error} 새로고침으로 다시 조회해 주세요.</p>}
    {staleFilter&&<p role="alert">선택한 필터에 해당하는 내역이 변경되었습니다. 필터 초기화 후 다시 선택해 주세요.</p>}
    {data&&!loading&&<>
      <div className="totals" role="status">
        <div>입고 박스<strong>{fmt(total.boxes)} 박스</strong><small>미기재 {total.missingBoxes}행</small></div>
        <div>입고 건수<strong>{fmt(total.receiptCount)} 건</strong><small>선택 범위의 중복 없는 입고 건</small></div>
        <div>분류 확인 GW<strong>{total.gw==null?'—':fmt(total.gw)+' kg'}</strong><small>실중량 · 미기재 {total.missingGW}건 · 혼합 별도</small></div>
        <div>분류 확인 CW<strong>{total.cw==null?'—':fmt(total.cw)+' kg'}</strong><small>청구중량 · 미기재 {total.missingCW}건 · 혼합 별도</small></div>
      </div>
      {total.missingBoxes>0&&<p role="alert">박스 미기재가 있어 박스 합계는 확인된 값만 포함합니다. 단·송이 수로 임의 환산하지 않습니다.</p>}
      <div className="table-wrap"><table><caption>{year}~{toYear}년 · {({week:'차수별',month:'월별',year:'연도별'})[period]} 입고 합계</caption>
        <colgroup>{[140,150,180,130,170,170,90,100].map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr>{['기간','국가','품종','입고 박스','GW (kg)','CW (kg)','입고 건','미기재 박스 행'].map(v=><th key={v} scope="col">{v}</th>)}</tr></thead>
        <tbody>{summary.rows.map(r=><tr key={r.key}><td>{r.period}</td><td>{r.country}</td><td>{r.flower}</td><td className="number">{fmt(r.boxes)}</td><td>{weightText(r.gw,r.missingGW,r.mixedReceipts)}</td><td>{weightText(r.cw,r.missingCW,r.mixedReceipts)}</td><td>{r.receiptCount}</td><td>{r.missingBoxes||'—'}</td></tr>)}</tbody>
      </table></div>
      {!summary.rows.length&&<p>선택한 조건에 입고 내역이 없습니다.</p>}
      {summary.mixed.length>0&&<section className="mixed"><h2>혼합 입고 중량 · {summary.mixed.length}건</h2>
        <p>GW {fmt(total.mixedGW)} kg / CW {fmt(total.mixedCW)} kg — 위 분류별 중량에 미포함. 한 입고에 여러 국가·품종이 있어 임의 배분하지 않았습니다. 필터로 일부 품종만 선택해도 아래 무게는 입고건 전체 무게입니다.</p>
        <div className="table-wrap"><table><caption>입고건별 중복 없는 전체 중량</caption><colgroup>{[110,140,190,300,150,150].map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr>{['입고번호','기간','국가','포함 품종','GW (kg)','CW (kg)'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{summary.mixed.map(r=><tr key={r.warehouseKey}><td>{r.warehouseKey}</td><td>{r.period}</td><td>{r.country}</td><td>{r.flower}{r.partial?' (일부 선택)':''}</td><td>{fmt(r.gw)}</td><td>{fmt(r.cw)}</td></tr>)}</tbody></table></div>
      </section>}
      <p>수량은 저장된 BoxQuantity 기준이며 합포장 소수도 보존합니다. 품종별 입고 건수는 서로 중복될 수 있습니다. 중량 미기재는 0kg이 아닙니다. 탭 복귀 또는 새로고침 시 최신 입고를 다시 조회합니다.</p>
    </>}
    <style jsx>{`.box-page{padding:16px;color:#172b4d;font-size:15px}.box-page h1{font-size:24px;margin:0 0 8px}.box-page h2{font-size:19px}.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:14px 0}label{display:flex;gap:6px;align-items:center}select,button{font:inherit;padding:7px;border:1px solid #9aacc4;border-radius:5px;background:white;color:inherit}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #2474cc;outline-offset:2px}.totals{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.totals>div{padding:14px 20px;background:#eaf3ff;border-radius:6px;min-width:180px}.totals strong{font-size:24px;display:block;margin:5px 0}.totals small{display:block}.table-wrap{overflow-x:auto}table{table-layout:fixed;width:auto;border-collapse:collapse}caption{text-align:left;padding:8px}th,td{padding:9px 10px;border:1px solid #c4d2e4;text-align:center;overflow-wrap:anywhere}th{background:#e9f0fa}tbody tr:hover{background:#eef6ff}.number{font-size:18px;font-weight:700}.mixed{margin-top:20px;padding:12px;background:#fff9e9;border:1px solid #e6c66c}`}</style>
  </section>;
}
