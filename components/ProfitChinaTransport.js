import { useEffect, useRef, useState } from 'react';
import { buildChinaTransportBreakdown, parseChinaTransportScope } from '../lib/profitChinaTransport.mjs';
import WorkflowGuide from './WorkflowGuide';
import styles from './ProfitChinaTransport.module.css';

const columns=[['C','매출액'],['E','기초재고'],['F','기말재고'],['P','상품매입'],['T','운임'],['H','통관·창고 등'],['I','매출원가'],['J','이익'],['K','참고 이익률']];
const format=(value,key)=>value==null?'확인 필요':key==='K'?`${(value*100).toFixed(1)}%`:Math.round(value).toLocaleString('ko-KR');

export default function ProfitChinaTransport({ data, row, colSpan, dirty=false }) {
  const scope=parseChinaTransportScope(data?.orderYear,data?.major);
  const key=scope?`${scope.orderYear}:${scope.major}`:'';
  const [open,setOpen]=useState(false),[state,setState]=useState(null);
  const request=useRef(null),latest=useRef({key,data});latest.current={key,data};
  useEffect(()=>{request.current?.abort();setState(null);setOpen(false);},[key,data]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const active=state?.key===key&&state?.data===data?state:null;
  async function load(){
    if(!scope||dirty)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setState({key,data,busy:true});
    const timer=setTimeout(()=>controller.abort('timeout'),210000);
    try{
      let jobId=null;
      while(!controller.signal.aborted){
        const response=await fetch(`/api/sales/profit-china-transport?year=${scope.orderYear}&week=${scope.major}${jobId?`&jobId=${encodeURIComponent(jobId)}`:''}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        const evidence=await response.json();if(!response.ok||!evidence.ok)throw Error(evidence.message||'근거 조회 실패');
        if(controller.signal.aborted||latest.current.key!==key||latest.current.data!==data)return;
        if(evidence.orderYear!==scope.orderYear||evidence.major!==scope.major)throw Error('응답 연도·차수가 다릅니다.');
        if(evidence.status!=='running'){setState({key,data,evidence});break;}
        if(typeof evidence.jobId!=='string'||!evidence.jobId)throw Error('조회 작업번호가 없습니다.');
        jobId=evidence.jobId;await new Promise(resolve=>setTimeout(resolve,2000));
      }
    }catch(error){if(latest.current.key===key&&latest.current.data===data&&(!controller.signal.aborted||controller.signal.reason==='timeout'))setState({key,data,error:controller.signal.reason==='timeout'?'조회 시간 초과. 본표는 그대로 유지됩니다. 다시 조회하세요.':error.message});}
    finally{clearTimeout(timer);}
  }
  let breakdown=null,error=active?.error;
  if(active?.evidence&&!dirty){try{breakdown=buildChinaTransportBreakdown(row.calc,active.evidence,scope);}catch(e){error=e.message;}}
  return <tr className={styles.container} data-testid="china-transport-row"><td colSpan={colSpan}>
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open&&!active)load();}}>중국 배·비행기·미배정 {open?'접기':'내역 보기'}</button>
    {open&&<section aria-label="중국 운송수단별 참고 내역" className={styles.panel}>
      <header><strong>중국 합계 보존 · 운송수단별 참고 내역</strong><button type="button" onClick={load} disabled={active?.busy||dirty}>근거 다시 조회</button></header>
      <p>본표·확정본·엑셀은 변경하지 않습니다. 현재 원장으로 나눈 참고 내역이며 공통비를 배·비행기에 임의 배분하지 않습니다.</p>
      {dirty&&<p role="status">저장하지 않은 입력이 있습니다. 저장 또는 취소 후 본표를 다시 조회하세요.</p>}
      {active?.busy&&<p role="status">입고·출고·재고 원가 근거 조회 중… 본표를 변경하거나 DB에 저장하지 않습니다.</p>}
      {error&&<p role="alert">{error}</p>}
      {breakdown&&<>
        <p>{breakdown.note}</p>
        {breakdown.warnings.length>0&&<ul className={styles.warnings}>{breakdown.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}
        <div className={styles.scroll}><table><thead><tr><th>구분</th>{columns.map(([key,label])=><th key={key}>{label}{key!=='K'&&' (원)'}</th>)}</tr></thead>
          <tbody>{breakdown.rows.map(child=><tr key={child.id}><th scope="row">{child.label}</th>{columns.map(([key])=><td key={key}>{format(child.display[key],key)}</td>)}</tr>)}</tbody>
          <tfoot><tr><th scope="row">중국 본표 합계 (보존)</th>{columns.map(([key])=><td key={key}>{format(row.calc[key],key)}</td>)}</tr></tfoot>
        </table></div>
        <p className={styles.meta}>실제 농장배정 {breakdown.basisCounts.actual_farm||0}건 · 당차 입고비율 {breakdown.basisCounts.incoming_ratio||0}건 · 입고 근거 없음 {breakdown.basisCounts.no_incoming||0}건. 미배정은 공통비·차감·현재 원천과 저장본의 차이를 포함하며 음수 차이도 보존합니다.</p>
        <details><summary>매입·운임 원천과 재고 기준 보기</summary>
          <div className={styles.scroll}><table><thead><tr><th>농장</th><th>세부차수</th><th>입고번호</th><th>운임 (CNY)</th></tr></thead><tbody>{active.evidence.freight.map((item,i)=><tr key={i}><td>{item.farm||'미확인'}</td><td>{item.orderWeek}</td><td>{item.warehouseKey}</td><td>{format(item.amount,'S')}</td></tr>)}</tbody></table></div>
          <p>기초 {active.evidence.inventory?.begin?.orderYear} / {active.evidence.inventory?.begin?.week||'미확인'} · 기말 {active.evidence.inventory?.end?.orderYear} / {active.evidence.inventory?.end?.week||'미확인'}. 재고도 동일 품목 당차 입고비율을 사용합니다. 저장 당시 농장별 재고를 복원한 결과가 아닙니다.</p>
        </details>
      </>}
      <WorkflowGuide workflowId="profit-explicit-query" />
    </section>}
  </td></tr>;
}
