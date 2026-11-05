import { buildApprovalDistributionPlan } from '../lib/incomingApprovalPolicy.js';

const fmt=n=>Number(n??0).toLocaleString('ko-KR',{maximumFractionDigits:4});
const invoiceLabels={exchangeRateKRW:'적용 환율',freightAmount:'국제 운송료',customsTotalKRW:'통관비 합계',allocationShareNumerator:'배분 분자',allocationShareDenominator:'배분 분모',otherCostPerUnitKRW:'단위당 기타 원가',grossWeightKg:'총중량(kg)',volumeWeightKg:'부피중량(kg)',bunchesPerBox:'박스당 단수'};
const fieldLabels={master:'운송 기본값',customs:'통관·부대비',exchangeRate:'환율',gw:'실중량 GW',cw:'청구중량 CW',rateUSD:'항공 운임',docFeeUSD:'서류비',invoiceUSD:'인보이스 합계',bakSangRate:'백상 단가',handlingFee:'취급비',quarantinePerItem:'품목별 검역비',domesticFreight:'국내 운송비',deductFee:'공제비',extraFee:'추가비',boxWeight:'박스 중량',boxCBM:'박스 부피',stemsPerBox:'박스당 송이',stemsPerBunch:'단당 송이',salePriceKRW:'판매단가',tariffRate:'관세율',taxableRate:'과세 환율',customsRate:'통관 환율',freightRate:'운임 단가',totalFreight:'총 운임',domesticTruck:'국내 운송비',duty:'관세',vat:'부가세'};
Object.assign(fieldLabels,invoiceLabels);
function NumericFields({value,onChange,path='',disabled,labels={}}){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{Object.entries(value).filter(([key,v])=>!['rows','lineInputs','warehouseKey','formulaVersion','costSourceId','groupId','lineId'].includes(key)&&(typeof v==='number'||v===null||v&&typeof v==='object'&&!Array.isArray(v))).map(([key,v])=>v&&typeof v==='object'?<details key={key}><summary>{labels[key]??fieldLabels[key]??key}</summary><NumericFields value={v} onChange={next=>onChange({...value,[key]:next})} path={`${path}${key}.`} disabled={disabled} labels={labels}/></details>:<label key={key}>{labels[key]??fieldLabels[key]??key}<input type="number" min="0" step="any" aria-label={`${path}${labels[key]??fieldLabels[key]??key}`} disabled={disabled} value={v??''} onChange={e=>onChange({...value,[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</div>;
}
function InvoiceLineFields({cost,onChange}){
 const schema=cost.inputSchema??{},input=cost.input??{},groupIds=schema.groupIds??[],groupLabel=id=>schema.groupLabels?.[id]??id;
 const patchInput=next=>onChange({...cost,input:{...input,...next}});
 return <>
  {!!groupIds.length&&<section aria-label="포장 그룹 원가 입력"><h5>포장 그룹별 배분 기준</h5><p>그룹 송이수는 수정 후 실제 송이 합계와 일치해야 합니다. 박스수와 중량은 확인한 값을 입력하세요.</p>
   {'groupBoxBasis' in input&&<label>박스수 기준<select aria-label="박스수 기준" value={input.groupBoxBasis} onChange={e=>patchInput({groupBoxBasis:e.target.value})}><option value="RECEIPT_LINES">입고행 박스 합계</option><option value="PACKING_GROUP">패킹 그룹 박스 합계</option></select></label>}
   {(input.costGroups??[]).map((group,index)=><fieldset key={index}><legend>포장 그룹 {index+1}</legend><label>포장 그룹<select aria-label={`포장 그룹 ${index+1}`} value={group.groupId??''} onChange={e=>patchInput({costGroups:input.costGroups.map((g,n)=>n===index?{...g,groupId:e.target.value}:g)})}><option value="">선택하세요</option>{groupIds.map(id=><option key={id} value={id}>{groupLabel(id)}</option>)}</select></label>
    <NumericFields value={Object.fromEntries((schema.groupFields??[]).map(k=>[k,group[k]??null]))} labels={schema.labels} path={`포장 그룹 ${index+1} `} onChange={next=>patchInput({costGroups:input.costGroups.map((g,n)=>n===index?{...g,...next}:g)})}/>
    <button type="button" onClick={()=>patchInput({costGroups:input.costGroups.filter((_,n)=>n!==index)})}>포장 그룹 제외</button>
   </fieldset>)}
   <button type="button" disabled={(input.costGroups?.length??0)>=groupIds.length} onClick={()=>patchInput({costGroups:[...(input.costGroups??[]),{groupId:'',...Object.fromEntries((schema.groupFields??[]).map(k=>[k,null]))}]})}>포장 그룹 추가</button>
   {'lossTreatmentConfirmed' in input&&<label><input type="checkbox" checked={input.lossTreatmentConfirmed===true} onChange={e=>patchInput({lossTreatmentConfirmed:e.target.checked})}/>통관비에 반영한 검역 손실 처리를 확인했습니다</label>}
  </section>}
  {input.lineInputs?.map((line,index)=>{const lineFields=schema.lineFields??Object.keys(line).filter(k=>k!=='lineId');return <details key={line.lineId}><summary>{cost.lineMappings.find(m=>m.sourceLineId===line.lineId)?.sourceLabel??`원문 ${index+1}행`} · 품목별 원가 입력</summary>
   {lineFields.includes('groupId')&&<label>포장 그룹<select aria-label={`품목 원가 ${index+1} 포장 그룹`} value={line.groupId??''} onChange={e=>patchInput({lineInputs:input.lineInputs.map((l,n)=>n===index?{...l,groupId:e.target.value}:l)})}><option value="">선택하세요</option>{groupIds.map(id=><option key={id} value={id}>{groupLabel(id)}</option>)}</select></label>}
   <NumericFields value={Object.fromEntries(lineFields.filter(k=>k!=='groupId').map(k=>[k,line[k]??null]))} labels={schema.labels} path={`품목 원가 ${index+1} `} onChange={next=>patchInput({lineInputs:input.lineInputs.map((l,n)=>n===index?{...l,...next}:l)})}/>
  </details>;})}
 </>;
}
export default function IncomingApprovalLinkedReview({facts,request,matching,onChange,disabled,problems={receipt:true,farm:true,cost:true}}){
  const financial=matching.financial??{costInputs:[],acknowledged:false,reason:''};
  const mappings=matching.receiptMappings??[];
  const farmGroups=matching.farmGroups??[];
  const patch=next=>onChange({...matching,...next});
  const costInputs=financial.costInputs??[];
  const patchCost=(index,next)=>patch({financial:{...financial,prepared:false,acknowledged:false,costInputs:costInputs.map((c,i)=>i===index?next:c)}});
  let groups=[];try{groups=buildApprovalDistributionPlan({matching,dates:facts.dates,details:facts.details,masters:facts.masters,products:facts.products,scope:request.correction,receiptPlan:facts.receiptPlan});}catch{}
  const product=pk=>facts.products.find(p=>p.ProdKey===pk);
  const farmTargets=new Map(groups.map(g=>[g.key,{shipmentKey:g.master.ShipmentKey,prodKey:g.product.ProdKey,quantity:g.outQuantity,detailKey:g.detail?.SdetailKey}]));
  for(const a of facts.farmAssignments){const d=facts.details.find(d=>d.SdetailKey===a.SdetailKey);if(d&&!farmTargets.has(`${d.ShipmentKey}:${d.ProdKey}`))farmTargets.set(`${d.ShipmentKey}:${d.ProdKey}`,{shipmentKey:d.ShipmentKey,prodKey:d.ProdKey,quantity:d.OutQuantity,detailKey:d.SdetailKey});}
  return <section aria-label="연결 원장 검토">
    {problems.receipt&&facts.receiptPlan.detailsChanged&&<fieldset disabled={disabled}><legend>수정 파일과 기존 입고행 연결</legend><p>수량·품목이 바뀐 행은 기존 입고행을 연결하세요. 새 행만 ‘신규 입고행’을 선택합니다. 연결되지 않은 기존 행은 제거 대상으로 검토됩니다.</p>
      <button type="button" onClick={()=>patch({receiptMappings:facts.receiptMappingSuggestions??[]})}>입고 연결 불러오기</button>
      <div className="scroll"><table><thead><tr><th>수정 파일 행</th><th>최종 품목·수량</th><th>기존 입고행</th></tr></thead><tbody>{facts.receiptPlan.after.map((row,i)=><tr key={i}><td>{i+1}</td><td>{product(row.ProdKey)?.ProdName} / {fmt(row.OutQuantity)}</td><td><select aria-label={`입고 연결 ${i+1}행`} value={mappings.find(m=>m.targetRowIndex===i)?.sourceWdetailKey??''} onChange={e=>patch({receiptMappings:[...mappings.filter(m=>m.targetRowIndex!==i),{sourceWdetailKey:e.target.value?Number(e.target.value):null,targetRowIndex:i}]})}><option value="">신규 입고행</option>{facts.receiptPlan.before.map(old=><option key={old.WdetailKey} value={old.WdetailKey}>#{old.WdetailKey} {product(old.ProdKey)?.ProdName} · {fmt(old.OutQuantity)}</option>)}</select></td></tr>)}</tbody></table></div>
    </fieldset>}
    {problems.farm&&!!farmTargets.size&&<fieldset disabled={disabled}><legend>농장별 최종 배정</legend><p>기존 농장배정이 있는 분배를 변경하면 원품목과 이동 대상의 최종 배정을 각각 확인하세요. 감소만 할 때도 합계는 수정 후 분배수량과 같아야 합니다.</p>
      <button type="button" onClick={()=>patch({farms:[],farmGroups:[...farmTargets.values()].map(g=>({shipmentKey:g.shipmentKey,prodKey:g.prodKey,assignments:g.quantity===0?[]:facts.farmAssignments.filter(a=>a.SdetailKey===g.detailKey).map(a=>({farmKey:a.FarmKey,quantity:a.ShipmentQuantity}))}))})}>농장 배정표 검토</button>
      {farmGroups.map((g,index)=>{const key=`${g.shipmentKey}:${g.prodKey}`,target=farmTargets.get(key),master=facts.masters.find(m=>m.ShipmentKey===g.shipmentKey),candidates=facts.farmCandidates?.[g.prodKey]??[];
        const change=assignments=>patch({farmGroups:farmGroups.map((x,i)=>i===index?{...g,assignments}:x)});
        return <div key={key}><h5>{master?.CustName} {master?.OrderYear}/{master?.OrderWeek} · {product(g.prodKey)?.ProdName} / 최종 {fmt(target?.quantity)} {product(g.prodKey)?.OutUnit}</h5>
          {g.assignments.map((a,i)=><div key={i}><label>농장<select aria-label={`${key} 농장 ${i+1}`} value={a.farmKey} onChange={e=>change(g.assignments.map((r,n)=>n===i?{...r,farmKey:Number(e.target.value)}:r))}>{candidates.map(f=><option key={f.FarmKey} value={f.FarmKey}>{f.FarmName}</option>)}</select></label><label>최종 배정수량<input type="number" min="0" step="0.01" aria-label={`${key} 농장 수량 ${i+1}`} value={a.quantity} onChange={e=>change(g.assignments.map((r,n)=>n===i?{...r,quantity:e.target.value}:r))}/></label><button type="button" onClick={()=>change(g.assignments.filter((_,n)=>n!==i))}>배정 제외</button></div>)}
          <button type="button" disabled={!candidates.length||target?.quantity===0} onClick={()=>change([...g.assignments,{farmKey:candidates.find(f=>!g.assignments.some(a=>a.farmKey===f.FarmKey))?.FarmKey??candidates[0].FarmKey,quantity:''}])}>농장 배정 추가</button><span>배정 합계 {fmt(g.assignments.reduce((s,a)=>s+Number(a.quantity||0),0))}</span>
        </div>;})}
    </fieldset>}
    {problems.cost&&(facts.costFacts||facts.profitPeriods?.length>0)&&<fieldset disabled={disabled}><legend>연결 원가·확정 손익 정정</legend><p>기존 원가와 확정본은 이력으로 남습니다. 최종 검토에서 새 정정본의 금액을 확인한 뒤 함께 반영합니다.</p>
      {facts.costFacts&&<button type="button" onClick={()=>patch({financial:{...financial,prepared:false,acknowledged:false,costInputs:structuredClone(facts.costInputSuggestions??[])}})}>연결 원가 검토</button>}
      {costInputs.map((cost,i)=><details key={`${cost.kind}:${cost.sourceKey}`} open><summary>{cost.kind==='INVOICE'?'인보이스 원가':'운송 원가'} · 기존 버전 {cost.expectedRevision}</summary>
        {!facts.receiptPlan.detailsChanged&&<p>농장만 변경하므로 기존 원가의 수량·단가·금액을 그대로 보존합니다.</p>}
        <fieldset disabled={!facts.receiptPlan.detailsChanged}><legend>{cost.inputSchema?.formulaLabel??'원가 검토값'}</legend>
        <NumericFields value={cost.input} onChange={input=>patchCost(i,{...cost,input})} path={`원가 ${i+1} `} labels={cost.inputSchema?.labels}/>
        {cost.kind==='INVOICE'&&<InvoiceLineFields cost={cost} onChange={next=>patchCost(i,next)}/>}
        {cost.kind==='INVOICE'&&<div className="scroll"><table><thead><tr><th>원문 품목</th><th>수정 입고행</th><th>최종 연결수량</th></tr></thead><tbody>{cost.lineMappings.map((m,n)=><tr key={`${m.sourceLineId}:${n}`}><td>{m.sourceLabel??`원문 ${n+1}행`}</td><td><select aria-label={`${cost.sourceKey} 원가 연결 ${n+1}`} value={m.targetRowIndex??''} onChange={e=>patchCost(i,{...cost,lineMappings:cost.lineMappings.map((x,j)=>j===n?{...x,targetRowIndex:e.target.value===''?null:Number(e.target.value),...(e.target.value===''?{quantity:0}:{})}:x)})}><option value="">제외 (0)</option>{facts.receiptPlan.after.map((r,j)=><option key={j} value={j}>{j+1}. {product(r.ProdKey)?.ProdName}</option>)}</select></td><td><input type="number" min="0" step="any" aria-label={`${cost.sourceKey} 원가 수량 ${n+1}`} value={m.quantity} onChange={e=>patchCost(i,{...cost,lineMappings:cost.lineMappings.map((x,j)=>j===n?{...x,quantity:e.target.value}:x)})}/><span>{m.quantityUnit==='STEM'?'송이':m.quantityUnit==='BUNCH'?'단':m.quantityUnit??'원문 단위'}</span><button type="button" onClick={()=>patchCost(i,{...cost,lineMappings:[...cost.lineMappings,{...m,targetRowIndex:null,quantity:0}]})}>다른 입고행으로 분할</button></td></tr>)}</tbody></table></div>}
        {cost.kind==='FREIGHT'&&cost.input?.rows?.map((r,n)=><details key={n}><summary>{product(facts.receiptPlan.after[r.targetRowIndex]?.ProdKey)?.ProdName} · 원가 배분 기준</summary><NumericFields value={Object.fromEntries(Object.entries(r).filter(([k])=>k!=='targetRowIndex'))} onChange={row=>patchCost(i,{...cost,input:{...cost.input,rows:cost.input.rows.map((x,j)=>j===n?{...row,targetRowIndex:r.targetRowIndex}:x)}})} path={`운송 ${n+1} `}/></details>)}
        </fieldset>
      </details>)}
      {!!facts.profitPeriods?.length&&<p>재검산할 손익: {facts.profitPeriods.map(p=>`${p.orderYear}/${p.major}${p.confirmed?' 확정본':' 계산본'}`).join(', ')}</p>}
      <label>원가·손익 정정 사유<input aria-label="원가·손익 정정 사유" maxLength={500} value={financial.reason??''} onChange={e=>patch({financial:{...financial,reason:e.target.value}})}/></label>
      <label><input type="checkbox" checked={financial.acknowledged===true} onChange={e=>patch({financial:{...financial,prepared:false,acknowledged:e.target.checked}})}/>연결 원가와 손익 정정 내용을 확인했습니다</label>
    </fieldset>}
  </section>;
}
