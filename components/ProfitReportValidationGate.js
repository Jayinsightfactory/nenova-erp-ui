import {useEffect,useRef,useState} from 'react';
import {profitValidationDisplayKey,acceptsProfitValidationResponse} from '../lib/profitReportValidationGate.mjs';
import {buildProfitStatusPresentation,PROFIT_STATUS_LABELS,profitIssueImpact,profitMissingCell,profitDiagnosticText} from '../lib/profitReportStatusPresentation.mjs';
import ui from '../styles/ProfitReportToolbar.module.css';

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
  return {...active,run,dirty,currentDisplayKey:key,displayRows:rows,displayTotals:totals,knownIssues:(audit?.issues || []).filter(i=>i.severity==='error'||i.severity==='warning')};
}
const presentation = validation => buildProfitStatusPresentation({rows:validation?.displayRows,totals:validation?.displayTotals,validation});
function StatusBadge({item}) {
  return <span className={`${ui.badge} ${ui[item.state] || ''}`}>{item.label}</span>;
}
export function ProfitMissingValue({validation,row,column}) {
  const model=presentation(validation);
  const cell=profitMissingCell({row,column,rows:validation?.displayRows,totals:validation?.displayTotals,
    issues:[...(validation?.knownIssues||[]),...(model.result?.issues||[])]});
  if(!cell)return null;
  return <div className={`${ui.missingCell} ${cell.label==='수익률 해당없음'?ui.neutralCell:''}`}><strong>{cell.label}</strong><span className={ui.secondary}>{cell.reason}</span>
    {cell.source&&<><span className={ui.secondary}>{cell.source.status}</span><span className={ui.secondary}>확인 위치: {cell.source.shortLocation || cell.source.location}</span><details><summary>데이터·메뉴 상세</summary><span className={ui.secondary}>{cell.source.location}</span></details></>}
  </div>;
}
export function ProfitValidationRateLabel({validation,category}) {
  const model=presentation(validation);
  const item=category?model.items.find(row=>row.category===category):model.total;
  if(!item)return null;
  return <small className={ui.rateLabel} title={[...item.reasons,item.secondary].join('\n')} data-profit-status={item.state}>
    <StatusBadge item={item} />
    {item.estimated&&item.state!=='estimated'&&<span className={ui.secondary}>추정 근거 포함</span>}
    {item.secondary&&<span className={ui.secondary}>{item.secondary}</span>}
  </small>;
}
export default function ProfitReportValidationGate({validation}) {
  const model=presentation(validation),result=model.result;
  return <section className={ui.statusPanel} aria-label="수익률 원천 검증">
    <div className={ui.statusHeading}><strong>수익률 확인 상태</strong>
      <button type="button" className={`btn ${ui.button}`} disabled={validation.busy||validation.dirty} onClick={validation.run}>{validation.busy?'SQL 원천 대사 중…':'원천 검증'}</button>
      <span className={ui.secondary}>{result?.checkedAt?`대조 시각 ${new Date(result.checkedAt).toLocaleString('ko-KR')}`:model.common}</span>
    </div>
    <div className={ui.counts}>{Object.entries(model.counts).filter(([,count])=>count>0).map(([state,count])=><span key={state} className={`${ui.badge} ${ui[state]||''}`}>{PROFIT_STATUS_LABELS[state]} {count}</span>)}</div>
    <div>원천 대조 전은 오류라는 뜻이 아닙니다. 추정 포함은 실제 비용 확정이 아니며, 저장·확정은 원가 정확성 인증과 다릅니다. 숫자와 저장본은 변경하지 않습니다.</div>
    {validation.error&&<div role="alert">{model.common}</div>}
    {validation.dirty&&<div>{model.common}</div>}
    {model.globalIssues.length>0&&<details><summary>공통 확인사항 {model.globalIssues.length}건 — 전체 보고서 검증 제약</summary>
      <ul>{model.globalIssues.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>
      <div>공통 검증 미완료를 각 품종의 금액 오류로 단정하지 않습니다. 원천 대조가 완료되기 전에는 사용 가능으로 인증하지 않습니다.</div>
    </details>}
    <details><summary>품종별 사유·영향 자세히 보기 ({model.items.length}개)</summary>
      {result&&<div>{result.boundary} {result.sourceBoundary}</div>}
      {model.items.map(item=><div key={item.category} className={ui.statusRow}>
        <strong>{item.category}</strong>{' '}<StatusBadge item={item} />{item.estimated&&item.state!=='estimated'?' · 추정 근거 포함':''}
        <span className={ui.secondary}>{item.secondary}</span>
        {item.reasons.length>0?<ul>{item.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>:<p>개별 오류는 확인되지 않았습니다. 표시 상태와 공통 검증 제약을 함께 확인하세요.</p>}
        {item.issues.map((issue,index)=><div key={index} className={ui.secondary}>{profitIssueImpact(issue)}</div>)}
        {item.missingEvidence.length>0&&<details><summary>관세 연결 확인 {item.missingEvidence.length}건 · 품목별 원인</summary>
          <ul>{item.missingEvidence.map((evidence,index)=><li key={index}>{evidence.name || '공통 근거'}{evidence.prodKey?` (#${evidence.prodKey})`:''}: {evidence.diagnostic?.failed?.length?evidence.diagnostic.failed.map(profitDiagnosticText).join(' · '):evidence.reason}
            {evidence.diagnostic?.sourceRef&&<span className={ui.secondary}>{evidence.diagnostic.sourceRef.orderYear}년 {evidence.diagnostic.sourceRef.orderWeek} · 입고 상세 #{evidence.diagnostic.sourceRef.warehouseDetailKey} · 원문: {evidence.reason}</span>}
            {evidence.diagnostic?.actualDutyInput==='not_available_in_calculation'&&<span className={ui.secondary}>현재 계산에 사용할 실제 관세 입력·도착원가 관세 근거도 미확인입니다. SQL 원문 행 자체가 없다는 판정은 아닙니다.</span>}
          </li>)}</ul>
        </details>}
      </div>)}
    </details>
  </section>;
}
