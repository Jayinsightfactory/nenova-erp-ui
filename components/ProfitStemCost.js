import {useEffect,useRef,useState} from 'react';
const value=(n,rate=false)=>n==null||!Number.isFinite(Number(n))?'확인 필요':rate?`${(n*100).toFixed(2)}%`:Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2});
const labels={held:'원가 확인 필요',estimated:'추정 근거 포함',calculated:'송이 기준 계산'};
const cell={border:'1px solid #cbd5e1',padding:'6px 9px',textAlign:'right',whiteSpace:'nowrap'};
export default function ProfitStemCost({year,major,dirty=false}) {
  const key=`${year}:${major}`,latest=useRef(key);latest.current=key;
  const request=useRef(null),[state,setState]=useState(null);
  useEffect(()=>{request.current?.abort();setState(null);},[key,dirty]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const active=state?.key===key&&!dirty?state:null;
  async function load(){
    if(dirty)return;request.current?.abort();const controller=new AbortController();request.current=controller;
    setState({key,busy:true});
    const timer=setTimeout(()=>controller.abort('timeout'),210000);
    try{
      const base=`/api/sales/profit-stem-cost?year=${encodeURIComponent(year)}&week=${encodeURIComponent(major)}`;let jobId=null;
      while(!controller.signal.aborted){
        const response=await fetch(`${base}${jobId?`&jobId=${encodeURIComponent(jobId)}`:''}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'송이 원가 계산 실패');
        if(controller.signal.aborted||latest.current!==key)return;
        if(String(result.year)!==String(year)||Number(result.major)!==Number(major))throw Error('계산 응답의 연도·차수가 다릅니다.');
        if(result.status!=='running'){setState({key,result});return;}
        if(typeof result.jobId!=='string'||!result.jobId)throw Error('계산 작업 식별자가 없습니다.');
        jobId=result.jobId;setState({key,busy:true,progress:result.progress});
        await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(wait);reject(Error('취소됨'));};const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},2000);controller.signal.addEventListener('abort',cancel,{once:true});});
      }
    }catch(error){if(latest.current===key&&(!controller.signal.aborted||controller.signal.reason==='timeout'))setState({key,error:controller.signal.reason==='timeout'?'계산 시간이 초과되었습니다. 다시 계산하세요.':error.message});}
    finally{clearTimeout(timer);}
  }
  const report=active?.result;
  const visibleProducts=(report?.products||[]).filter(p=>!['openingQuantity','receiptQuantity','shipQuantity','adjustmentQuantity','endQuantity'].every(k=>p[k]===0));
  return <section style={{margin:'12px 0',padding:14,border:'2px solid #2563eb',borderRadius:8,background:'#f8fafc',fontSize:13}} aria-label="송이 기준 원가 계산">
    <h2 style={{fontSize:17,margin:'0 0 8px'}}>송이 기준 원가 계산 · 품목별 기초 + 입고 가중평균</h2>
    <p style={{margin:'5px 0'}}>원가 계산 수량은 송이로 통일하고 단·박스는 원문 표시로 유지합니다. 아래 기존 엑셀식 저장본을 덮어쓰지 않습니다.</p>
    <button type="button" onClick={load} disabled={active?.busy||dirty} style={{padding:'7px 12px'}}>{active?.busy?'원천 송이·도착원가 계산 중…':'송이 기준으로 계산·비교'}</button>
    {active?.busy&&<p role="status">{active.progress||'원천 조회를 시작합니다.'} · 계산은 서버 메모리에서만 수행하며 DB에 저장하지 않습니다.</p>}
    {dirty&&<p>선택 차수 또는 저장하지 않은 입력을 먼저 확인하세요. 저장본과 다른 초안은 비교하지 않습니다.</p>}
    {active?.error&&<p role="alert" style={{color:'#b91c1c'}}>계산 보류: {active.error}</p>}
    {!report&&!active?.busy&&<p style={{marginBottom:0}}>버튼을 누를 때만 SQL 원천을 조회합니다. 기존 조회 속도와 저장·확정본은 유지됩니다.</p>}
    {report&&<>
      <p>{report.year}년 {report.major}차 · 조회 {new Date(report.asOf).toLocaleString('ko-KR')} · DB 변경 없음</p>
      {report.notes.map(note=><div key={note}>• {note}</div>)}
      <div style={{overflowX:'auto',marginTop:10}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr>
        {['국가·품종','기존 기초재고액','송이 기초재고액','기존 기말재고액','송이 기말재고액','기존 수익률','송이 수익률','이익 차이','계산 상태'].map(title=><th key={title} style={{...cell,background:'#dbeafe'}}>{title}</th>)}
      </tr></thead><tbody>{[...report.rows,{category:'합계',calc:report.totals,legacy:report.legacyTotals,status:report.rows.some(r=>r.status==='held')?'held':report.rows.some(r=>r.status==='estimated')?'estimated':'calculated'}].map(row=><tr key={row.category}>
        <th style={{...cell,textAlign:'left'}}>{row.category}</th>
        {['E','F','K'].flatMap(col=>[<td key={`${col}old`} style={{...cell,color:'#64748b'}}>{value(row.legacy?.[col],col==='K')}</td>,<td key={`${col}new`} style={cell}>{value(row.calc?.[col],col==='K')}</td>])}
        <td style={cell}>{row.calc?.J!=null&&row.legacy?.J!=null?value(row.calc.J-row.legacy.J):'확인 필요'}</td><td style={{...cell,color:row.status==='held'?'#b91c1c':'#334155',textAlign:'left',whiteSpace:'normal',minWidth:170}}>{labels[row.status]}{row.reasons?.map(reason=><div key={reason}>{reason}</div>)}{row.receiptReconciliation?.delta!=null&&Math.abs(row.receiptReconciliation.delta)>1&&<div>원가 배분 차이 {value(row.receiptReconciliation.delta)}원</div>}</td>
      </tr>)}</tbody></table></div>
      <details style={{marginTop:10}}><summary>계산식과 차이 읽는 법</summary>
        <p>품목별 송이 평균원가 = (기초재고 원가 + 당차 입고 도착원가) ÷ (기초 송이수 + 입고 송이수). 다른 품목의 단가를 섞지 않습니다.</p>
        <p>기초재고액은 이전 품목 평가액, 기말재고액은 잔여 송이수 × 품목별 평균원가입니다. 매출원가 = 기초 + 당차 입고원가 + 통관비 − 기말. 기존 국가별 예외식과 합계 수익률 분모는 유지됩니다. 판매량 × 평균원가의 ‘판매마진’과 같은 지표가 아닙니다.</p>
        <p>기존 엑셀식은 국가/품종 평균·FIFO 등 기존 평가방식과 저장시점이 포함됩니다. 비교 차이는 단위 정규화와 품목별 가중평균 정책, 현재 원천과 저장시점 차이로 구분해서 확인해야 합니다. 원본 포장 15송이/단과 판매 10송이/단을 같다고 취급하지 않습니다.</p>
        <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr>{['국가·품종','기존 저장 매출원가','현재 원천 기존식 매출원가','송이식 매출원가','기존 저장 이익','송이식 이익','원가정책 변경 이익차','원천/저장시점 이익차'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.category}><th style={cell}>{r.category}</th>{[r.legacy?.I,r.currentLegacy?.I,r.calc?.I,r.legacy?.J,r.calc?.J,r.differences?.J?.policy,r.differences?.J?.source].map((n,i)=><td key={i} style={cell}>{value(n)}</td>)}</tr>)}</tbody></table></div>
      </details>
      <details style={{marginTop:10}}><summary>품목별 송이·단/박스 표시·원가 근거 {visibleProducts.length}품목</summary>
        {visibleProducts.length<report.products.length&&<p>기초·입고·출고·조정·기말이 모두 0인 {report.products.length-visibleProducts.length}품목은 표시에서 제외했습니다.</p>}
        <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr>{['품목','기초 송이','입고 송이','입고 원문 단/박스','기말 원문 수량','기말 송이','송이당 원가','기초 원가','입고 도착원가','기말 원가','근거/보류 사유'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
          <tbody>{visibleProducts.map(p=><tr key={p.prodKey}><th style={{...cell,textAlign:'left',whiteSpace:'normal'}}>{p.productName}</th>
            <td style={cell}>{value(p.openingQuantity)}</td><td style={cell}>{value(p.receiptQuantity)}</td><td style={cell}>{value(p.receiptDisplay?.bunches)}단 / {value(p.receiptDisplay?.boxes)}박스</td>
            <td style={cell}>{value(p.endingDisplayQuantity)} {p.displayUnit}</td><td style={cell}>{value(p.endQuantity)}</td><td style={cell}>{value(p.unitCost)}</td>
            <td style={cell}>{value(p.openingAmount)}</td><td style={cell}>{value(p.receiptAmount)}</td><td style={cell}>{value(p.endingAmount)}</td>
            <td style={{...cell,textAlign:'left',whiteSpace:'normal',minWidth:250}}>{p.valuationComplete?`${p.estimated?'추정 포함 · ':''}역사 원행 ${p.stemFactor?.evidenceRows||0}건 · ${value(p.stemFactor?.factor)}송이/${p.displayUnit}`:p.reasons.join(' / ')}<details><summary>단가 출처</summary>{p.sourceRefs?.map(ref=><div key={ref} style={{overflowWrap:'anywhere'}}>{ref}</div>)}</details></td>
          </tr>)}</tbody></table></div>
      </details>
    </>}
  </section>;
}
