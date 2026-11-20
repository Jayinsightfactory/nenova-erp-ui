import React,{useEffect,useRef,useState} from 'react';
import styles from '../../styles/InvoiceReceipt.module.css';
const endpoint='/api/import/receipts/colombia-week-cost';
const labels={ROSE:'장미',CARNATION:'카네이션',ALSTROMERIA:'알스트로',RUSCUS:'루스커스',HYDRANGEA:'수국'};
const numeric=value=>value===''||value==null?null:Number(value);
export default function ColombiaWeekCostReview({orderYear,orderWeek}){
 const [prepared,setPrepared]=useState(null),[inputs,setInputs]=useState({}),[choices,setChoices]=useState({}),[decisions,setDecisions]=useState({}),[assignments,setAssignments]=useState({});
 const [customs,setCustoms]=useState({sourceId:'',mode:'FORMULA',amountKRW:'',confirmed:false,awbs:[]}),[pools,setPools]=useState([]),[result,setResult]=useState(null),[versions,setVersions]=useState([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setPrepared(null);setResult(null);setInputs({});setChoices({});setDecisions({});setAssignments({});setPools([]);setCustoms({sourceId:'',mode:'FORMULA',amountKRW:'',confirmed:false,awbs:[]});setVersions([]);setError('');setNotice('');setBusy('');return()=>{generation.current++;};},[orderYear,orderWeek]);
 const scope={country:'CO',orderYear:String(orderYear),orderWeek};
 const edit=(setter,value)=>{setter(value);setResult(null);setNotice('');};
 async function call(action,extra={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,action,...extra}),cache:'no-store'});
  if(!response.ok){const data=await response.json();throw Error(data.error||'통합 원가 요청에 실패했습니다.');}return response;
 }
 async function run(action){
  const token=generation.current;setBusy(action);setError('');setNotice('');
  try{
   const lineInputs=Object.entries(choices).map(([lineId,groupId])=>({lineId,groupId}));
   const payload={lineInputs,awbAssignments:Object.values(assignments),baselineDigest:prepared?.baselineDigest,expenseDecisions:Object.values(decisions),versionHash:result?.versionHash,
    awbInputs:(prepared?.awbs??[]).map(({awb})=>({awb,input:{...inputs[awb],freightCurrency:'USD',exchangeRateType:'MANUAL',gw:numeric(inputs[awb]?.gw),cw:numeric(inputs[awb]?.cw),freightAmount:numeric(inputs[awb]?.freightAmount),exchangeRate:numeric(inputs[awb]?.exchangeRate),fullBoxCounts:Object.fromEntries(Object.entries(inputs[awb]?.fullBoxCounts??{}).map(([key,value])=>[key,numeric(value)]))}})),
    customsPools:pools};
   const response=await call(action,payload);if(token!==generation.current)return;
   if(action==='prepare'){
    const data=await response.json();if(token!==generation.current)return;setPrepared(data);setResult(null);
    setInputs(current=>Object.fromEntries(data.awbs.map(a=>[a.awb,current[a.awb]??{gw:'',cw:'',freightAmount:'',exchangeRate:'',fullBoxCounts:{}}])));
   }else if(action==='preview'){const data=await response.json();if(token===generation.current)setResult(data.calculation);}
   else{await download(response,token);if(token===generation.current){const history=await (await call('versions')).json();if(token===generation.current)setVersions(history.versions);}}
  }catch(e){if(token===generation.current)setError(e.message);}finally{if(token===generation.current)setBusy('');}
 }
 async function download(response,token){
  const blob=await response.blob();if(token!==generation.current)return;
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]??`colombia-${orderYear}-${orderWeek}.xlsx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  setNotice(`파일 전달 요청 · ${blob.size.toLocaleString()}바이트 · SHA-256 ${response.headers.get('X-Workbook-SHA256')}. 실제 저장 완료는 앱 저장창에서 확인하세요.`);
 }
 async function history(open){const token=generation.current;setBusy('history');setError('');try{const response=await call(open?'openVersion':'versions',open?{versionHash:open}:{});if(token!==generation.current)return;if(open)await download(response,token);else{const data=await response.json();if(token===generation.current)setVersions(data.versions);}}catch(e){if(token===generation.current)setError(e.message);}finally{if(token===generation.current)setBusy('');}}
 const allRows=prepared?.members.flatMap(m=>m.rows)??[];
 return <section className={styles.card} data-testid="colombia-week-cost">
  <h3>콜롬비아 {orderYear}/{orderWeek} 전체 입고 통합 원가</h3>
  <p>일반꽃·수국을 한 시트에 포함합니다. 운임·중량은 AWB별, 공유 통관비는 같은 근거에서 한 번만 계산합니다. 입고·재고는 변경하지 않습니다.</p>
  <fieldset disabled={!!busy}><button type="button" onClick={()=>run('prepare')}>1. 차수 전체 입고 조회 / 귀속 적용</button>{' '}<button type="button" onClick={()=>history()}>보관 원본 이력 조회</button>
  {prepared&&<>
   <p>입고 {prepared.members.length}건 · 상품 {allRows.length}행 · AWB {prepared.awbs.length}개. 금액·수량은 원장에서 읽기 전용입니다.</p>
   {prepared.issues.map((issue,i)=><div role="alert" key={`${issue.code}-${i}`}><strong>확인 필요 #{issue.warehouseKey}</strong> {issue.message}{issue.code==='LINE_GROUP_REQUIRED'&&<select aria-label={`${issue.lineId} 품종 귀속`} value={choices[issue.lineId]??''} onChange={e=>edit(setChoices,{...choices,[issue.lineId]:e.target.value})}><option value="">품종 선택</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>}</div>)}
   {prepared.issues.filter(issue=>issue.code==='RECEIPT_AWB_REQUIRED').map(issue=>{const value=assignments[issue.warehouseKey]??{warehouseKey:issue.warehouseKey,awb:'',sourceId:'',confirmed:false};const update=(field,next)=>edit(setAssignments,{...assignments,[issue.warehouseKey]:{...value,[field]:next}});return <fieldset key={issue.warehouseKey}><legend>#{issue.warehouseKey} AWB 귀속 확인 (원장 수정 없음)</legend><label>원문 AWB<input value={value.awb} onChange={e=>update('awb',e.target.value)}/></label><label>귀속 증빙 식별자<input value={value.sourceId} onChange={e=>update('sourceId',e.target.value)}/></label><label><input type="checkbox" checked={value.confirmed} onChange={e=>update('confirmed',e.target.checked)}/>원문 귀속을 확인했습니다.</label></fieldset>;})}
   <details><summary>전체 입고·품목 원문 보기</summary>{prepared.members.map(member=><details key={member.warehouseKey}><summary>#{member.warehouseKey} {member.farmName} · {member.invoiceNo} · {member.awb}</summary><table><thead><tr><th>품목</th><th>송이</th><th>단가 USD</th><th>금액 USD</th></tr></thead><tbody>{member.rows.map(row=><tr key={row.lineId}><td>{row.originalName}</td><td>{row.stemQuantity}</td><td>{row.unitPrice}</td><td>{row.lineAmount}</td></tr>)}</tbody></table></details>)}</details>
   {prepared.awbs.map(({awb,members,headerEvidence})=>{const groups=[...new Set(members.flatMap(m=>m.lineInputs.map(l=>l.groupId)).filter(Boolean))],value=inputs[awb]??{};const update=(field,next)=>edit(setInputs,{...inputs,[awb]:{...value,[field]:next}});return <fieldset key={awb}><legend>2. AWB {awb} · {members.length}개 입고</legend>
    <p>아래는 AWB 전체 원문 기준으로 입력하세요. 개별 입고의 부분 중량을 전체로 간주하지 않습니다.</p>
    <details><summary>입고 헤더 중량 근거</summary>{headerEvidence.map(row=><p key={row.warehouseKey}>#{row.warehouseKey} GW {row.gw??'미기재'} / CW {row.cw??'미기재'}</p>)}</details>
    {[['gw','GW kg'],['cw','CW kg'],['freightAmount','운임 합계 USD'],['exchangeRate','환율 KRW/USD']].map(([field,label])=><label key={field} style={{display:'inline-block',marginRight:12}}>{label}<input type="number" min="0" step="any" value={value[field]??''} onChange={e=>update(field,e.target.value)}/></label>)}
    {groups.length>1&&<div><p>혼합 품종은 확인된 FB 환산 박스수만 입력합니다. 실물 QB/HB 개수를 그대로 대입하지 마세요.</p>{groups.map(id=><label key={id}>{labels[id]} FB<input type="number" min="0" step="any" value={value.fullBoxCounts?.[id]??''} onChange={e=>update('fullBoxCounts',{...value.fullBoxCounts,[id]:e.target.value})}/></label>)}</div>}
   </fieldset>;})}
   {prepared.excluded.length>0&&<details open><summary>원장 비용·중량 근거 {prepared.excluded.length}행</summary>{prepared.excluded.map(row=>{const decision=decisions[row.wdetailKey]??{wdetailKey:row.wdetailKey,awb:row.awb,confirmed:true,treatment:'INCLUDED_IN_AWB_INPUT',evidence:''};return <div key={row.wdetailKey}><p>#{row.warehouseKey}/{row.wdetailKey} {row.name} · 수량 {row.quantity} · 금액 {row.amount} · AWB {row.awb}</p>{Number(row.amount)!==0&&<><select aria-label={`비용 ${row.wdetailKey} 처리`} value={decision.treatment} onChange={e=>edit(setDecisions,{...decisions,[row.wdetailKey]:{...decision,treatment:e.target.value}})}><option value="INCLUDED_IN_AWB_INPUT">해당 AWB 입력 합계에 포함</option><option value="NOT_APPLICABLE">본 원가 제외 (근거 필수)</option></select><input aria-label={`비용 ${row.wdetailKey} 확인 근거`} placeholder="통화·중복·합계 포함/제외 증빙 근거" value={decision.evidence} onChange={e=>edit(setDecisions,{...decisions,[row.wdetailKey]:{...decision,evidence:e.target.value}})}/></>}</div>;})}</details>}
   <fieldset><legend>3. 통관비 근거별 대상 지정</legend><p>별도 AWB 비용은 별도 근거로 추가하세요. 실제 공유 증빙일 때만 여러 AWB를 선택하여 GW 비율로 한 번 귀속합니다.</p>
    <label>증빙 식별자<input value={customs.sourceId} onChange={e=>edit(setCustoms,{...customs,sourceId:e.target.value})}/></label><select aria-label="통관비 기준" value={customs.mode} onChange={e=>edit(setCustoms,{...customs,mode:e.target.value})}><option value="FORMULA">기존 원가양식 수식 (예상 비용)</option><option value="TOTAL">확인된 실제 합계</option></select>
    {customs.mode==='TOTAL'&&<label>통관비 KRW<input type="number" min="0" step="any" value={customs.amountKRW} onChange={e=>edit(setCustoms,{...customs,amountKRW:e.target.value})}/></label>}
    <label><input type="checkbox" checked={customs.confirmed} onChange={e=>edit(setCustoms,{...customs,confirmed:e.target.checked})}/>대상 AWB와 중복 없는 동일 통관 근거를 확인했습니다.</label>
    {prepared.awbs.map(({awb})=><label key={awb}><input type="checkbox" checked={customs.awbs.includes(awb)} onChange={e=>edit(setCustoms,{...customs,awbs:e.target.checked?[...customs.awbs,awb]:customs.awbs.filter(value=>value!==awb)})}/>{awb}</label>)}
    <button type="button" disabled={!customs.confirmed||!customs.sourceId.trim()||!customs.awbs.length||(customs.mode==='TOTAL'&&numeric(customs.amountKRW)===null)} onClick={()=>{edit(setPools,[...pools,{...customs,amountKRW:numeric(customs.amountKRW)}]);setCustoms({sourceId:'',mode:'FORMULA',amountKRW:'',confirmed:false,awbs:[]});}}>확인한 통관 근거 추가</button>
    {pools.map((pool,i)=><p key={i}>{pool.sourceId} · {pool.awbs.join(', ')} · {pool.mode==='FORMULA'?'기존 수식 예상':`${pool.amountKRW} KRW`} <button type="button" onClick={()=>edit(setPools,pools.filter((_,index)=>index!==i))}>이 계산에서 제외</button></p>)}
   </fieldset>
   <button type="button" onClick={()=>run('preview')}>4. 통합 계산 검증</button>{' '}<button type="button" disabled={result?.status!=='CALCULATED'} onClick={()=>run('download')}>5. 단일 시트 엑셀 다운로드 · 원본 버전 보관</button>
   {result&&<p role="status">{result.status==='CALCULATED'?'계산 검증 통과':'확인 필요'} · {result.receiptCount}개 입고 / {result.lines.length}행 · 버전 {result.versionHash.slice(0,12)}{result.issues.map((issue,i)=><span key={i}> {issue.message}</span>)}</p>}
  </>}
  {versions.map(version=><p key={version.versionHash}>{version.createdAt} · {version.bytes.toLocaleString()}바이트 · {version.versionHash.slice(0,12)} <button type="button" onClick={()=>history(version.versionHash)}>보관 당시 원본 다시 다운로드</button></p>)}
  </fieldset>{busy&&<p role="status">처리 중…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status" style={{overflowWrap:'anywhere'}}>{notice}</p>}
 </section>;
}
