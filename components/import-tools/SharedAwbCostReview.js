import React, {useState} from 'react';
import styles from '../../styles/InvoiceReceipt.module.css';

const labels={ROSE:'장미',CARNATION:'카네이션',ALSTROMERIA:'알스트로',RUSCUS:'루스커스',HYDRANGEA:'수국'};
export default function SharedAwbCostReview({document}) {
  const [prepared,setPrepared]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [confirmed,setConfirmed]=useState(false),[result,setResult]=useState(null),[lineInputs,setLineInputs]=useState([]);
  const [input,setInput]=useState({gw:'',cw:'',freightAmount:'',freightCurrency:'USD',exchangeRate:'',customsTotalKRW:'',exchangeRateType:'MANUAL'});
  const update=(field,value)=>{setInput(current=>({...current,[field]:value}));setResult(null);};
  async function run(action) {
    setBusy(action);setError('');
    try {
      const response=await fetch('/api/import/receipts/shared-awb-cost',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,orderYear:document.orderYear,orderWeek:document.orderWeek,awb:document.reviewedMetadata.awb,
          baselineDigest:prepared?.baselineDigest,completeManifestConfirmed:confirmed,lineInputs,input})});
      if(action==='download'&&response.ok){
        const url=URL.createObjectURL(await response.blob()),a=window.document.createElement('a');a.href=url;
        a.download=`shared-awb-${document.orderYear}-${document.orderWeek}-${prepared.manifest.awb}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;
      }
      const data=await response.json();if(!response.ok||data.success!==true)throw new Error(data.error||'공동 AWB 작업에 실패했습니다.');
      if(action==='prepare'){setPrepared(data);setLineInputs(data.members.flatMap(member=>member.lineInputs));setConfirmed(false);setResult(null);}
      else setResult(data.result);
    }catch(e){setError(e.message);setResult(null);}finally{setBusy('');}
  }
  return <section className={styles.costPending} aria-label="공동 AWB 원가">
    <h3>공동 AWB · 전체 농장 도착원가</h3>
    <p>{document.orderYear}/{document.orderWeek} · {document.reviewedMetadata.awb} · 전체 중량·운임을 한 번만 배분합니다. 농장별 CW 입력은 필요하지 않습니다.</p>
    <button className={styles.primary} type="button" disabled={!!busy} onClick={()=>run('prepare')}>공동 AWB 전체 입고 조회</button>
    {error&&<p role="alert">{error}</p>}
    {prepared&&<>
      <p>현재 입고 {prepared.members.length}건 · 미승인 계산본 다운로드이며 기존 입고·승인 원가는 변경하지 않습니다.</p>
      <ul>{prepared.members.map(member=><li key={member.documentId}>{member.farmName} · {member.invoiceNo} · {member.rows.length}품목</li>)}</ul>
      <label><input type="checkbox" checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);setResult(null);}}/>공동 AWB의 전체 농장 송장이 모두 포함되었습니다</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,margin:'16px 0'}}>
        {[['gw','공동 GW (kg)'],['cw','공동 CW (kg)'],['freightAmount','공동 운임·서류비 합계 (USD)'],['exchangeRate','환율 (원/USD)'],['customsTotalKRW','공동 통관비 합계 (원)']].map(([field,label])=><label key={field}>{label}<input aria-label={label} type="number" min="0" step="any" value={input[field]} onChange={event=>update(field,event.target.value)}/></label>)}
        <label>비용 근거<select aria-label="공동 AWB 비용 근거" value={input.exchangeRateType} onChange={event=>update('exchangeRateType',event.target.value)}><option value="MANUAL">확인한 비용</option><option value="TEST_ONLY">시험값 · 실제 원가 아님</option></select></label>
      </div>
      <label>전체 품종 일괄 선택<select aria-label="공동 AWB 전체 품종" defaultValue="" onChange={event=>{if(event.target.value){setLineInputs(rows=>rows.map(row=>({...row,groupId:event.target.value})));setResult(null);}}}><option value="">선택</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <table><thead><tr><th>농장·송장</th><th>품목</th><th>송이</th><th>품종</th></tr></thead><tbody>
        {prepared.members.flatMap(member=>member.rows.map(row=><tr key={row.lineId}><td>{member.farmName} · {member.invoiceNo}</td><td>{row.originalName}</td><td>{row.stemQuantity}</td><td><select aria-label={`${row.originalName} 품종`} value={lineInputs.find(line=>line.lineId===row.lineId)?.groupId||''} onChange={event=>{setLineInputs(lines=>lines.map(line=>line.lineId===row.lineId?{...line,groupId:event.target.value}:line));setResult(null);}}><option value="">품종 확인</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></td></tr>))}
      </tbody></table>
      <button className={styles.primary} type="button" disabled={!!busy||!confirmed} onClick={()=>run('preview')}>공동 AWB 원가 계산</button>
      {result?.issues?.length>0&&<ul role="alert">{result.issues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>}
      {result?.status==='CALCULATED'&&<><p>운임 {result.totals.freightNative.toLocaleString()} USD · 통관비 {result.totals.customsKRW.toLocaleString()}원 · 전체 {result.lines.length}품목</p>
        <button className={styles.primary} disabled={!!busy} type="button" onClick={()=>run('download')}>공동 AWB 도착원가 엑셀 다운로드 · 미승인 계산본</button></>}
    </>}
  </section>;
}
