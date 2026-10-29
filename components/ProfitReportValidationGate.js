import {useEffect,useRef,useState} from 'react';
import {profitValidationDisplayKey,acceptsProfitValidationResponse} from '../lib/profitReportValidationGate.mjs';

export function useProfitValidationGate({year,major,rows,totals,dirty,audit}) {
  const key=profitValidationDisplayKey(year,major,rows,totals,audit);
  const current=useRef(key);current.current=key;
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const request=useRef(null);
  const [state,setState]=useState(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{request.current?.abort();setState(null);},[key,dirty]);
  const active=!dirty&&state?.key===key?state:null;
  async function run() {
    if(dirty)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    const runKey=key;setState({key:runKey,busy:true});
    try {
      const response=await fetch(`/api/sales/profit-report-validation?year=${encodeURIComponent(year)}&week=${encodeURIComponent(major)}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      const body=await response.json();
      if(!response.ok||!body.success)throw new Error(body.error||'검증 실패');
      if(controller.signal.aborted||current.current!==runKey)return;
      if(!acceptsProfitValidationResponse({runKey,currentKey:current.current,displayKey:body.displayKey,year,major,responseYear:body.year,responseMajor:body.major,aborted:controller.signal.aborted,dirty:dirtyRef.current}))throw new Error('현재 화면과 서버 저장본이 달라졌습니다. 다시 조회 후 검증하세요.');
      setState({key:runKey,result:body});
    } catch(error) {if(!controller.signal.aborted&&current.current===runKey)setState({key:runKey,error:error.message});}
  }
  return {...active,run,dirty,knownIssues:(audit?.issues || []).filter(i=>i.severity==='error'||i.severity==='warning')};
}
const labels={verified:'관측 시점 검증됨',estimated:'추정 근거 포함',held:'검증 보류'};
export function ProfitValidationRateLabel({validation,category}) {
  const item=category?validation?.result?.rows?.find(r=>r.category===category):validation?.result;
  return <small style={{display:'block',fontSize:11,color:item?.state==='verified'?'#166534':'#92400e',fontWeight:600}} title={item?.reasons?.join('\n')}>
    {validation?.dirty?'화면 변경 · 미검증':validation?.error?'검증 실패 · 참고값':item?labels[item.state]:validation?.busy?'검증 중 · 참고값':validation?.knownIssues?.some(i=>!category||!i.category||i.category===category)?'기존 경고 · 검증 보류':'검증 전 · 저장 참고값'}
  </small>;
}
export default function ProfitReportValidationGate({validation}) {
  const result=validation.result;
  return <section style={{margin:'8px 0',padding:10,border:'1px solid #f59e0b',background:'#fffbeb',fontSize:12}} aria-label="수익률 원천 검증">
    <strong>{validation.error?'검증 실패 · 판정 보류':result?labels[result.state]:'수익률 원천 검증 전'}</strong>{' '}
    <button type="button" disabled={validation.busy||validation.dirty} onClick={validation.run}>{validation.busy?'SQL 원천 대사 중…':'원천 검증'}</button>
    <div>표의 기존 수익률은 저장·확정 당시 참고값입니다. 저장 완료/확정은 원가 정확성 인증이 아닙니다. 원천 검증은 DB나 저장본을 수정하지 않습니다.</div>
    {validation.dirty&&<div>화면에 저장하지 않은 변경이 있어 현재 저장본을 인증하지 않습니다.</div>}
    {validation.error&&<div role="alert">{validation.error}</div>}
    {!result&&validation.knownIssues?.length>0&&<details><summary>저장본 확인 필요 {validation.knownIssues.length}건 · 오류 {validation.knownIssues.filter(i=>i.severity==='error').length}건 — 펼쳐서 원인 확인</summary>{validation.knownIssues.map((i,n)=><div key={n}>• {i.category?`${i.category}: `:''}{i.message}</div>)}</details>}
    {result&&<details><summary>검증 근거 {result.issues.length}건 · {new Date(result.checkedAt).toLocaleString('ko-KR')} — 펼쳐서 원인 확인</summary>
      <div>{result.boundary}</div><div>{result.sourceBoundary}</div>
      {result.issues.map((i,n)=><div key={n}>• {i.category?`${i.category}: `:''}{i.message}</div>)}
      {result.rows.filter(r=>r.reasons.length).map(r=><details key={r.category}><summary>{r.category} — {labels[r.state]}{r.estimated?' · 추정 근거 포함':''}</summary>{r.reasons.map((reason,n)=><div key={n}>• {reason}</div>)}</details>)}
    </details>}
  </section>;
}
