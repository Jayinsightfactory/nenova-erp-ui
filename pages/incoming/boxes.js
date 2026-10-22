import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/useApi.js';
import { filterBoxSummary, boxSummaryTotals } from '../../lib/warehouseBoxSummary.js';

const fmt = value => value == null ? '미기재' : Number(value).toLocaleString('ko-KR',{maximumFractionDigits:6});
const options = (rows, field) => [...new Set(rows.map(row=>row[field]))].sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true}));
export default function ReceiptBoxes() {
  const [year,setYear]=useState(String(new Date().getFullYear()));
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [week,setWeek]=useState(''),[country,setCountry]=useState(''),[flower,setFlower]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let live=true;setLoading(true);setError('');setData(null);
    apiGet('/api/warehouse/boxes',{year}).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};},[year,refresh]);
  const rows=data?.rows||[];
  const visible=useMemo(()=>filterBoxSummary(rows,{year,week,country,flower}),[data,year,week,country,flower]);
  const total=boxSummaryTotals(visible);
  const weeks=options(rows,'OrderWeek'),countries=options(rows,'country');
  const flowers=options(rows.filter(row=>!country||row.country===country),'flower');
  return <section className="box-page">
    <h1 data-ui-page-title>차수별 박스 입고 현황</h1>
    <p>입고 원장에 저장된 박스 수량입니다. 품목의 현재 포장규격으로 환산하지 않습니다.</p>
    <div className="filters">
      <label>연도 <select value={year} onChange={e=>{setYear(e.target.value);setWeek('');setCountry('');setFlower('');}}>{Array.from({length:15},(_,i)=>String(new Date().getFullYear()+1-i)).map(y=><option key={y}>{y}</option>)}</select></label>
      <label>세부차수 <select value={week} onChange={e=>setWeek(e.target.value)}><option value="">전체</option>{weeks.map(v=><option key={v}>{v}</option>)}</select></label>
      <label>국가 <select value={country} onChange={e=>{setCountry(e.target.value);setFlower('');}}><option value="">전체</option>{countries.map(v=><option key={v}>{v}</option>)}</select></label>
      <label>품종 <select value={flower} onChange={e=>setFlower(e.target.value)}><option value="">전체</option>{flowers.map(v=><option key={v}>{v}</option>)}</select></label>
      <button onClick={()=>setRefresh(v=>v+1)} disabled={loading}>새로고침</button>
      <a href="/incoming">입고관리</a>
    </div>
    {loading&&<p role="status">입고 박스 수량 조회 중…</p>}
    {error&&<p role="alert">조회 실패: {error}</p>}
    {data&&!loading&&<>
      <div className="total" role="status">{year}년 · 선택 범위 <strong>{fmt(total.boxes)}박스</strong> · 상세 {fmt(total.lineCount)}행</div>
      {total.missingBoxes>0&&<p role="alert">박스 미기재 {fmt(total.missingBoxes)}행이 있어 합계가 불완전합니다. 0박스로 확정하거나 임의 환산하지 않았습니다.</p>}
      <div className="table-wrap"><table><caption>연도·세부차수·국가·품종별 입고 박스</caption>
        <colgroup>{[90,100,170,220,150,130,110].map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr>{['연도','세부차수','국가','품종','입고 박스','박스 미기재 행','입고 원장 수'].map(v=><th key={v} scope="col">{v}</th>)}</tr></thead>
        <tbody>{visible.map((r,i)=><tr key={`${r.OrderYear}/${r.OrderWeek}/${r.country}/${r.flower}/${i}`}><td>{r.OrderYear}</td><td>{r.OrderWeek}</td><td>{r.country}</td><td>{r.flower}</td><td className="number">{fmt(r.boxes)}</td><td>{r.missingBoxes||'—'}</td><td>{r.receiptCount}</td></tr>)}</tbody>
      </table></div>
      {!visible.length&&<p>선택한 조건에 입고 내역이 없습니다.</p>}
      <p>원장 수는 각 품종에 포함된 입고 건수이므로 품종 간 합산하면 중복될 수 있습니다. 합포장 박스도 원장에 기록된 배분값 그대로 표시합니다.</p>
    </>}
    <style jsx>{`.box-page{padding:16px;color:#172b4d;font-size:15px}.box-page h1{font-size:22px;margin:0 0 8px}.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:16px 0}label{display:flex;gap:6px;align-items:center}select,button{font:inherit;padding:7px;border:1px solid #9aacc4;border-radius:5px;background:white;color:inherit}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #2474cc;outline-offset:2px}.total{padding:14px;background:#eaf3ff;border-radius:6px;margin-bottom:12px}.total strong{font-size:24px}.table-wrap{overflow-x:auto}table{table-layout:fixed;width:970px;border-collapse:collapse}caption{text-align:left;padding:8px}th,td{padding:9px 10px;border:1px solid #c4d2e4;text-align:center;overflow-wrap:anywhere}th{background:#e9f0fa}tbody tr:hover{background:#eef6ff}.number{font-size:18px;font-weight:700}`}</style>
  </section>;
}
