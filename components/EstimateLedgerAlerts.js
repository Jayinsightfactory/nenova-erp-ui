import React,{useEffect,useState} from 'react';
import {apiGet} from '../lib/useApi';

const labels={'deleted-product-shipment':'삭제 품목에 출고 남음','deleted-product-estimate':'삭제 품목에 견적·차감 남음','missing-linked-deduction':'연결된 차감 없음'};
const number=value=>value==null?'확인 필요':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:4});
export default function EstimateLedgerAlerts({scope}) {
  const [attempt,setAttempt]=useState(0),[state,setState]=useState({});
  const key=scope?`${scope.year}/${scope.week}/${scope.request}`:'';
  useEffect(()=>{
    let active=true;
    if(!scope)return ()=>{active=false;};
    setState({key,loading:true});
    apiGet('/api/estimate/ledger-alerts',{year:scope.year,week:scope.week}).then(data=>{
      if(!data?.success)throw new Error(data?.error || '알림 조회 실패');
      if(active)setState({key,data});
    }).catch(error=>{if(active)setState({key,error:error.message || '알림 조회 실패'});});
    return ()=>{active=false;};
  },[key,attempt]); // key captures successful/current list request scope, never customer filtering.
  if(!scope)return null;
  const current=state.key===key?state:{};
  const data=current.data;
  return <section className="no-print" aria-label="원장 연결 알림" style={{margin:'8px 0',padding:10,border:`1px solid ${data?.total?'#e6a23c':'#c8d2df'}`,borderRadius:5,background:data?.total?'#fff8e8':'#f5f8fc'}}>
    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
      <strong>원장 연결 알림 · {scope.year}년 {scope.week}차 전체 업체</strong>
      <span role="status">{current.error?'확인 실패':!data?'확인 중…':data.total?`확인 필요 ${data.total}건`:'확인 범위 내 잔존·연결 누락 0건'}</span>
      <button type="button" className="btn btn-sm" disabled={current.loading} onClick={()=>setAttempt(n=>n+1)}>다시 확인</button>
    </div>
    {current.error && <p role="alert">{current.error} — 확인되지 않은 상태이며, 문제없음을 뜻하지 않습니다.</p>}
    {data?.linkedDeductionCheck==='unavailable' && <p role="alert">웹 불량차감 연결 기록을 조회할 수 없어 차감 누락 검사는 하지 못했습니다.</p>}
    {data?.total>0 && <details open><summary>업체·품목·수량·금액 확인</summary>
      <p>삭제 품목은 견적·매출에서 빠질 수 있습니다. 연결 차감 없음은 삭제 확정이 아니므로 원문과 대조하세요. 자동 수정하거나 삭제를 차단하지 않습니다.</p>
      <div style={{overflowX:'auto'}}><table className="data-table" style={{width:'100%',minWidth:650}}><thead><tr>{['확인할 내용','세부차수','업체','품목','수량','공급가액','원장 키'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>
        {data.rows.map(row=><tr key={`${row.Kind}:${row.ReferenceKey}:${row.DeductionKey || ''}`}><td>{labels[row.Kind]}</td><td>{row.OrderWeek}</td><td>{row.CustName || `업체 #${row.CustKey}`}</td><td>{row.ProdName || `품목 #${row.ProdKey} (품목 원본 없음)`}</td><td>{number(row.Quantity)} {row.Unit || '(단위 확인)'}</td><td>{row.Amount==null?'연결 원문 확인':`${number(row.Amount)}원`}</td><td>{row.ReferenceKey}</td></tr>)}
      </tbody></table></div>
      {data.total>data.rows.length && <p>전체 {data.total}건 중 {data.rows.length}건 표시(종류별 최대 200건).</p>}
    </details>}
    <small>현재 SQL 원장과 웹 연결 기록 기준 · 업체·요일 필터와 무관 · 과거 기록이나 연결 키가 없는 삭제는 감지할 수 없으며, 삭제자·삭제 시각은 추측하지 않습니다.</small>
  </section>;
}
