import React, {useEffect,useState} from 'react';
import WorkflowGuide from '../WorkflowGuide';
import {calculateCoOriginalCustoms} from '../../lib/coOriginalCostInputs.js';
import styles from '../../styles/InvoiceReceipt.module.css';

const labels={ROSE:'장미',CARNATION:'카네이션',ALSTROMERIA:'알스트로',RUSCUS:'루스커스',HYDRANGEA:'수국'};
const MASTER_LABELS={CO:'콜카장 누적 원가자료',CO_HYDRANGEA:'수국 누적 원가자료'};
const scopeLabels={MAIN:'콜카장 (장미·카네이션·알스트로·루스커스)',HYDRANGEA:'수국'};

/**
 * 공동 AWB 원가. 두 가지 입구를 같은 계산 코어로 쓴다.
 * - document: 저장된 인보이스 문서의 AWB (기존)
 * - native: 기존 입고(읽기 전용)에서 같은 차수 콜롬비아 농장 전체를 묶음 (도착원가 작업)
 */
export default function SharedAwbCostReview({document,native=null}) {
  const orderYear=native?native.orderYear:document.orderYear,orderWeek=native?native.orderWeek:document.orderWeek;
  const endpoint=native?'/api/import/receipts/native-shared-cost':'/api/import/receipts/shared-awb-cost';
  const [prepared,setPrepared]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [confirmed,setConfirmed]=useState(false),[result,setResult]=useState(null),[lineInputs,setLineInputs]=useState([]);
  const [awbText,setAwbText]=useState(''),[scope,setScope]=useState('MAIN'),[fullBox,setFullBox]=useState({});
  const [input,setInput]=useState({gw:'',cw:'',freightAmount:'',freightCurrency:'USD',exchangeRate:'',customsTotalKRW:'',customsMode:'FORMULA',exchangeRateType:'MANUAL'});
  const [rateStatus,setRateStatus]=useState(''),[rateRetry,setRateRetry]=useState(0);
  const update=(field,value)=>{setInput(current=>({...current,[field]:value}));setResult(null);};
  const awb=native?awbText:document.reviewedMetadata.awb;

  // 서버에 보관된 누적 원가자료(과거 차수 시트 유지). 있으면 다운로드할 때 이번 차수 시트를 붙여 계속 쌓는다.
  const [masters,setMasters]=useState({}),[appendToMaster,setAppendToMaster]=useState(true),[masterNote,setMasterNote]=useState('');
  const loadMasters=async()=>{
    const next={};
    for(const key of Object.keys(MASTER_LABELS)){
      try{const r=await fetch(`/api/import/receipts/cost-master?country=${key}`,{cache:'no-store'});const d=await r.json();next[key]=d.success?d:{exists:false,sheetNames:[]};}
      catch{next[key]={exists:false,sheetNames:[]};}
    }
    setMasters(next);
  };
  useEffect(()=>{loadMasters();},[]);
  async function seedMaster(key,event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setBusy('seed');setError('');setMasterNote('');
    try {
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
      const exists=masters[key]?.exists;
      const replace=exists?window.confirm(`서버에 이미 ${MASTER_LABELS[key]}가 있습니다. 이 파일로 교체할까요? (이전 파일은 서버에 백업됩니다)`):false;
      if(exists&&!replace)return;
      const r=await fetch('/api/import/receipts/cost-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seed',country:key,fileBase64:btoa(binary),replace})});
      const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'누적 파일을 올리지 못했습니다.');
      setMasterNote(`${MASTER_LABELS[key]} ${d.sheetNames.length}개 시트를 서버에 보관했습니다.`);loadMasters();
    }catch(e){setError(e.message);}finally{setBusy('');}
  }

  const groupIds=[...new Set(lineInputs.map(line=>line.groupId).filter(Boolean))];
  const masterKey=groupIds.length&&groupIds.every(id=>id==='HYDRANGEA')?'CO_HYDRANGEA':'CO';
  const master=masters[masterKey];
  const rowBoxes=Object.fromEntries(groupIds.map(id=>[id,(prepared?.members||[]).flatMap(m=>m.rows).filter(row=>lineInputs.find(line=>line.lineId===row.lineId)?.groupId===id).reduce((sum,row)=>sum+(Number(row.boxQuantity)||0),0)]));
  const needsFullBox=groupIds.length>1;
  const customs=calculateCoOriginalCustoms(input.gw,groupIds);
  // 환율을 비워 두면 USD 현재 시세 +15원을 자동 조회한다(사용자가 입력하면 조회하지 않음).
  useEffect(()=>{
    if(!prepared || String(input.exchangeRate).trim())return;
    const controller=new AbortController();setRateStatus('USD 현재 시세 +15원 조회 중…');
    fetch('/api/import/receipts/live-exchange-rate?currency=USD',{cache:'no-store',credentials:'same-origin',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'환율 조회 실패');return data;})
      .then(quote=>{if(controller.signal.aborted)return;setInput(current=>String(current.exchangeRate).trim()?current:{...current,exchangeRate:quote.rate,
        exchangeRateType:'LIVE_MARKET_PLUS_15',exchangeRateQuoteAt:quote.quoteAt,exchangeRateSource:quote.source,
        exchangeRateSourceUrl:quote.sourceUrl,exchangeRateMarketRate:quote.marketRate,exchangeRateAdjustmentKRW:15});
        setRateStatus(`${quote.source} · ${quote.quoteAt} · 시세 ${quote.marketRate} +15원 = ${quote.rate}원`);setResult(null);})
      .catch(e=>{if(e.name!=='AbortError')setRateStatus(`환율 자동 조회 실패: ${e.message} · 다시 조회하거나 직접 입력하세요.`);});
    return()=>controller.abort();
  },[prepared,input.exchangeRate,rateRetry]);
  const body=(action,extra={})=>JSON.stringify({action,orderYear,orderWeek,awb,...(native?{scope}:{}),
    baselineDigest:prepared?.baselineDigest,completeManifestConfirmed:confirmed,lineInputs,
    input:{...input,...(needsFullBox?{fullBoxCounts:Object.fromEntries(groupIds.map(id=>[id,fullBox[id]===''||fullBox[id]==null?null:Number(fullBox[id])]))}:{})},...extra});

  async function run(action) {
    setBusy(action);setError('');
    try {
      const append=action==='download'&&appendToMaster&&master?.exists;
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:action==='prepare'?JSON.stringify({action,orderYear,orderWeek,awb,...(native?{scope}:{}),lineInputs}):body(action,append?{appendToMaster:true}:{})});
      if(action==='download'&&response.ok){
        const url=URL.createObjectURL(await response.blob()),a=window.document.createElement('a');a.href=url;
        const sheet=decodeURIComponent(response.headers.get('X-Cost-Master-Sheet')||'');
        a.download=append&&sheet?`${masterKey==='CO_HYDRANGEA'?'콜롬비아_수국':'콜롬비아_콜카장'}_원가자료_누적_${sheet}.xlsx`:`shared-awb-${orderYear}-${orderWeek}-${prepared.manifest.awb}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
        if(append){setMasterNote(`${MASTER_LABELS[masterKey]}에 ${sheet} 시트를 ${response.headers.get('X-Cost-Master-Replaced')==='true'?'교체':'추가'}했습니다.`);loadMasters();}
        return;
      }
      const data=await response.json();if(!response.ok||data.success!==true)throw new Error(data.error||'공동 AWB 작업에 실패했습니다.');
      if(action==='prepare'){setPrepared(data);setLineInputs(data.members.flatMap(member=>member.lineInputs));setConfirmed(false);setResult(null);setFullBox({});}
      else setResult(data.result);
    }catch(e){setError(e.message);setResult(null);}finally{setBusy('');}
  }
  const awbReady=!native||/^\d{11}$/.test(awbText.replace(/[\s-]/g,''));
  const downloadReady=!(appendToMaster&&masters[masterKey]===undefined);
  return <section className={styles.costPanel} aria-label={native?'기존 입고 콜롬비아 전체 농장 원가':'공동 AWB 원가'}>
    <h3>{native?'콜롬비아 전체 농장 · 한 번에 도착원가':'공동 AWB · 전체 농장 도착원가'}</h3>
    <WorkflowGuide workflowId="shared-awb-cost" initialRole="수입부" />
    <p>{orderYear}/{orderWeek}{native?' · 기존 입고에서 같은 차수 콜롬비아 농장을 모두 묶어':` · ${awb} ·`} 전체 중량·운임을 한 번만 배분합니다. 농장별 CW 입력은 필요하지 않습니다.</p>
    {native&&<div style={{display:'flex',flexWrap:'wrap',gap:12,margin:'8px 0'}}>
      <label>계산 범위<select aria-label="계산 범위" value={scope} onChange={event=>{setScope(event.target.value);setPrepared(null);setResult(null);}}>{Object.entries(scopeLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>AWB 번호 (11자리)<input aria-label="AWB 번호" value={awbText} placeholder="160-17338005" onChange={event=>{setAwbText(event.target.value);setPrepared(null);setResult(null);}}/></label>
    </div>}
    <button className={styles.primary} type="button" disabled={!!busy||!awbReady} onClick={()=>run('prepare')}>{native?'콜롬비아 전체 입고 조회':'공동 AWB 전체 입고 조회'}</button>
    {error&&<p role="alert">{error}</p>}
    {prepared&&<>
      <p>현재 입고 {prepared.members.length}건 · 미승인 계산본 다운로드이며 기존 입고·승인 원가는 변경하지 않습니다.</p>
      {prepared.excluded?.length>0&&<div role="status"><p>계산에서 제외한 행 {prepared.excluded.length}개 (금액에 포함되지 않음):</p>
        <ul>{prepared.excluded.map(row=><li key={`${row.warehouseKey}-${row.wdetailKey}`}>{row.farmName} · {row.invoiceNo} · {row.name} · {row.stems}송이 · {row.amount} · {row.reason}</li>)}</ul></div>}
      <ul>{prepared.members.map(member=><li key={member.documentId}>{member.farmName} · {member.invoiceNo} · {member.rows.length}품목</li>)}</ul>
      <label><input type="checkbox" checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);setResult(null);}}/>{native?'이 차수·범위의 전체 농장 입고가 모두 포함되었습니다':'공동 AWB의 전체 농장 송장이 모두 포함되었습니다'}</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,margin:'16px 0'}}>
        {[['gw','공동 GW (kg)'],['cw','공동 CW (kg)'],['freightAmount','공동 운임·서류비 합계 (USD)'],['exchangeRate','환율 (원/USD)']].map(([field,label])=><label key={field}>{label}<input aria-label={label} type="number" min="0" step="any" value={input[field]} onChange={event=>{update(field,event.target.value);if(field==='exchangeRate')update('exchangeRateType','MANUAL');}}/></label>)}
        <label>통관비 기준<select aria-label="통관비 기준" value={input.customsMode} onChange={event=>update('customsMode',event.target.value)}><option value="FORMULA">기존 42-1 원가표 수식 자동 계산</option><option value="TOTAL">확인한 합계 직접 입력</option></select></label>
        <label>공동 통관비 합계 (원)<input aria-label="공동 통관비 합계 (원)" type="number" min="0" step="any" readOnly={input.customsMode==='FORMULA'} value={input.customsMode==='FORMULA'?customs.total??'':input.customsTotalKRW} placeholder="GW·품종 입력 시 자동 계산" onChange={event=>update('customsTotalKRW',event.target.value)}/></label>
        <label>비용 근거<select aria-label="공동 AWB 비용 근거" value={input.exchangeRateType} onChange={event=>update('exchangeRateType',event.target.value)}><option value="MANUAL">확인한 비용</option><option value="LIVE_MARKET_PLUS_15">현재 시세 +15원 자동 환율</option><option value="TEST_ONLY">시험값 · 실제 원가 아님</option></select></label>
      </div>
      <p role="status">{rateStatus} <button type="button" className={styles.secondary} onClick={()=>{update('exchangeRate','');setRateRetry(n=>n+1);}}>현재 환율 다시 조회</button></p>
      {input.customsMode==='FORMULA'&&<p>{customs.source} · {customs.groupCount}종류. 원본 기본값 계산본이며 실제 청구 확정액은 아닙니다.</p>}
      <label>전체 품종 일괄 선택<select aria-label="공동 AWB 전체 품종" defaultValue="" onChange={event=>{if(event.target.value){setLineInputs(rows=>rows.map(row=>({...row,groupId:event.target.value})));setResult(null);}}}><option value="">선택</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      {native&&<button type="button" disabled={!!busy} onClick={()=>{setLineInputs(rows=>rows.map(row=>({...row,groupId:row.suggestedGroupId||row.groupId})));setResult(null);}}>추천 품종 적용 (표에서 확인하세요)</button>}
      {needsFullBox&&<fieldset><legend>품종별 FB 환산 박스수 (원본 패킹 기준 · 실물 박스수를 그대로 쓰지 않습니다)</legend>
        {groupIds.map(id=><label key={id} style={{marginRight:12}}>{labels[id]} (입고 실물 {rowBoxes[id]}박스)<input aria-label={`${labels[id]} FB 환산 박스수`} type="number" min="0" step="any" value={fullBox[id]??''} onChange={event=>{setFullBox(current=>({...current,[id]:event.target.value}));setResult(null);}}/></label>)}</fieldset>}
      <div style={{maxHeight:420,overflow:'auto'}}><table><thead><tr><th>농장·송장</th><th>품목</th><th>송이</th><th>품종</th></tr></thead><tbody>
        {prepared.members.flatMap(member=>member.rows.map(row=><tr key={row.lineId}><td>{member.farmName} · {member.invoiceNo}</td><td>{row.originalName}</td><td>{row.stemQuantity}</td><td><select aria-label={`${row.originalName} 품종`} value={lineInputs.find(line=>line.lineId===row.lineId)?.groupId||''} onChange={event=>{setLineInputs(lines=>lines.map(line=>line.lineId===row.lineId?{...line,groupId:event.target.value}:line));setResult(null);}}><option value="">품종 확인</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></td></tr>))}
      </tbody></table></div>
      <button className={styles.primary} type="button" disabled={!!busy||!confirmed} onClick={()=>run('preview')}>{native?'콜롬비아 전체 원가 계산':'공동 AWB 원가 계산'}</button>
      {result?.issues?.length>0&&<ul role="alert">{result.issues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>}
      {result?.status==='CALCULATED'&&<><p>운임 {result.totals.freightNative.toLocaleString()} USD · 통관비 {result.totals.customsKRW.toLocaleString()}원 · 전체 {result.lines.length}품목</p>
        <section aria-label="누적 원가자료">
          <p>{master?.exists?`${MASTER_LABELS[masterKey]}: ${master.sheetNames.length}개 시트 · 마지막 ${master.sheetNames.at(-1)} · ${String(master.updatedAt||'').slice(0,16).replace('T',' ')}`:`서버에 ${MASTER_LABELS[masterKey]}가 없습니다. 기존 누적 파일을 한 번 올리면 이후 차수는 자동으로 쌓입니다.`}</p>
          {master?.exists&&<label><input type="checkbox" checked={appendToMaster} onChange={event=>setAppendToMaster(event.target.checked)}/>다운로드할 때 {MASTER_LABELS[masterKey]}에 이번 차수({orderWeek}) 시트 추가 · 같은 차수는 그 시트만 교체</label>}
          <label>{master?.exists?`${MASTER_LABELS[masterKey]} 교체`:`${MASTER_LABELS[masterKey]} 올리기`} <input aria-label={`${MASTER_LABELS[masterKey]} 파일`} type="file" accept=".xlsx" disabled={!!busy} onChange={event=>seedMaster(masterKey,event)}/></label>
          {masterNote&&<p role="status">{masterNote}</p>}
        </section>
        <button className={styles.primary} disabled={!!busy||!downloadReady} type="button" onClick={()=>run('download')}>{appendToMaster&&master?.exists?'누적 도착원가 엑셀 다운로드 · 이번 차수 시트 추가':(native?'콜롬비아 전체 도착원가 엑셀 다운로드 · 미승인 계산본':'공동 AWB 도착원가 엑셀 다운로드 · 미승인 계산본')}</button></>}
    </>}
  </section>;
}
