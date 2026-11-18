import {useEffect,useRef,useState} from 'react';
import {applyManifestFarmChoices,farmChoiceId,FARM_COUNTRIES} from '../../lib/packingManifestReconciliation.js';
import {rankedInvoiceFarmSources,resolveInvoiceHeader} from '../../lib/invoiceReceiptAutoFill.js';
import InvoiceFarmChoices from './InvoiceFarmChoices.js';
import FarmMasterRegistration from './FarmMasterRegistration.js';
import WorkflowGuide from '../WorkflowGuide';
async function readFarms(country,q=''){
 const response=await fetch(`/api/import/receipts/auto-fill?${new URLSearchParams({country,q})}`),data=await response.json();
 if(!response.ok||!data.success)throw Error(data.error||'농장 후보를 조회하지 못했습니다.');
 return (data.farms||[]).filter(f=>f.CounName===(FARM_COUNTRIES[country]||country));
}
export default function PackingManifestFarmReview({result,country,onApply}){
 const review=result.manifest_review,[farms,setFarms]=useState([]),[q,setQ]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[showAll,setShowAll]=useState(false);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [choices,setChoices]=useState(()=>Object.fromEntries(review.rows.map(r=>[r.id,{invoiceIndex:r.invoiceIndex,farmId:r.dbFarm?farmChoiceId({FarmKey:r.dbFarm.farmKey,WarehouseKey:r.dbFarm.farmSourceWarehouseKey}):''}])));
 useEffect(()=>{let active=true;readFarms(country,q).then(rows=>{if(active){setFarms(previous=>[...new Map([...previous,...rows].map(f=>[farmChoiceId(f),f])).values()]);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[country,q]);
 useEffect(()=>{setChoices(previous=>{let changed=false;const next={...previous};for(const row of review.rows){const choice=previous[row.id],invoice=result.invoices[choice?.invoiceIndex];if(!invoice||choice?.farmId||choice?.touched)continue;const farm=resolveInvoiceHeader({rawMetadata:{supplier:invoice.supplier},reviewedMetadata:{country}},farms).farm;if(farm){changed=true;next[row.id]={...choice,farmId:farmChoiceId({FarmKey:farm.farmKey,WarehouseKey:farm.farmSourceWarehouseKey})};}}return changed?next:previous;});},[farms,country,review.rows,result.invoices]);
 const pick=(id,value)=>setChoices(previous=>({...previous,[id]:{...previous[id],...value,touched:true}}));
 const confirm=async()=>{if(busy)return;setBusy(true);setError('');try{
  const selected=review.rows.map(r=>farms.find(f=>farmChoiceId(f)===choices[r.id]?.farmId));
  const current=(await Promise.all(selected.map(f=>f?readFarms(country,f.FarmName):Promise.resolve([])))).flat();
  const next=applyManifestFarmChoices(result,choices,current,country);if(alive.current)onApply(next);
 }catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}};
 return <div><details open={review.status==='REVIEW_REQUIRED'} style={{border:'1px solid var(--border)',padding:12,borderRadius:8}}>
 <summary>명세서·송장·DB 농장 연결 {review.status==='REVIEW_REQUIRED'?'· 확인 필요':'· 연결 확인/수정'}</summary>
 <WorkflowGuide workflowId="manifest-farm-matching" initialRole="수입부"/>
 <p>원본명과 수량·금액은 유지합니다. 서로 다른 이름만 같은 송장과 DB 농장으로 연결하세요. 누락·중복 송장은 매칭으로 무시할 수 없습니다.</p>
 <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
 <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setShowAll(!showAll)}>{showAll?'이슈 항목만 보기':'자동 연결 포함 전체 보기·수정'}</button>
 <label>DB 농장 검색 <input className="form-control" value={q} onChange={e=>setQ(e.target.value)} placeholder="농장명 일부 입력"/></label>
 {review.rows.filter(row=>showAll||row.method==='REVIEW_REQUIRED'||!choices[row.id]?.farmId||choices[row.id]?.touched).map(row=>{const choice=choices[row.id]||{},invoice=result.invoices[choice.invoiceIndex],selected=farms.find(f=>farmChoiceId(f)===choice.farmId),candidates=rankedInvoiceFarmSources(farms,invoice?.supplier||row.entry.supplier,country).filter(f=>!q||f.FarmName.toLowerCase().includes(q.toLowerCase()));
 return <section key={row.id} style={{borderTop:'1px solid var(--border)',padding:'12px 0'}} aria-label={`명세서 농장 ${row.entry.supplier}`}>
  <strong>명세서: {row.entry.supplier}</strong> {row.entry.hawb&&<span>HAWB {row.entry.hawb}</span>}
  <label>연결할 송장 <select className="form-control" value={choice.invoiceIndex??''} onChange={e=>pick(row.id,{invoiceIndex:e.target.value===''?null:Number(e.target.value),farmId:''})}><option value="">송장 선택</option>{result.invoices.map((inv,i)=><option key={i} value={i}>{inv.supplier} · {inv.invoice} · {inv.invoice_total} {inv.currency}</option>)}</select></label>
  <InvoiceFarmChoices farms={candidates} searching={Boolean(q)} selected={{farmKey:selected?.FarmKey,reviewedMetadata:{farmSourceWarehouseKey:selected?.WarehouseKey}}} onSelect={farm=>pick(row.id,{farmId:farmChoiceId(farm)})}/>
  <p role="status">DB 연결: {selected?.FarmName||'후보를 눌러 선택하세요.'}</p>
  <FarmMasterRegistration key={`${row.id}:${choice.invoiceIndex??'none'}`} country={country} initialName={invoice?.supplier||row.entry.supplier} disabled={busy} onCreated={farm=>{setFarms(previous=>[...previous.filter(f=>farmChoiceId(f)!==farmChoiceId(farm)),farm]);pick(row.id,{farmId:farmChoiceId(farm)});}}/>
 </section>;})}
 </fieldset>
 {error&&<p role="alert">{error}</p>}<button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>{busy?'DB 농장 재확인 중…':'농장 연결 적용 · 계속 작업'}</button>
 </details>{review.status==='MATCHED'&&review.rows.every(row=>row.dbFarm)&&<p role="status"><span data-testid="manifest-farm-completed" style={{display:'inline-block',maxWidth:'100%'}}>농장 연결 완료 · {review.rows.length}개 송장 · 원본 수량·금액 유지</span></p>}</div>;
}
