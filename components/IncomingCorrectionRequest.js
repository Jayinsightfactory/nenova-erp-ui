import WarehouseFarmSelect from './WarehouseFarmSelect.js';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {normalizedCorrection} from '../lib/warehouseCorrectionPolicy.js';
import {receiptItem,resizeReceiptItem,newReceiptItemQuantities,searchReceiptProducts,receiptSearchSuggestions,receiptRowDifferences,receiptDifferenceFields} from '../lib/incomingApprovalSimple.js';

const logLabels={pending:'진행 중',done:'완료',error:'실패',attention:'확인 필요'};
export function useIncomingWorkLog(){
  const [entries,setEntries]=useState([]);
  return {
    entries,
    reset:()=>setEntries([]),
    mark:(key,text,state='pending')=>setEntries(previous=>{
      const value={key,text,state,at:new Date()};
      const current=previous.findIndex(row=>row.key===key);
      const rows=key==='failure'?previous.map(row=>row.state==='pending'?{...row,state}:row):previous;
      return current<0?[...rows.slice(-9),value]:rows.map((row,i)=>i===current?value:row);
    }),
  };
}
export function IncomingWorkLog({entries}){
  if(!entries.length)return null;
  return <section className="incoming-work-log" aria-label="작업 로그">
    <style>{`.incoming-work-log{position:sticky;top:0;z-index:2;padding:6px 12px;background:#f8fafc;border-block:1px solid #cbd5e1;max-height:140px;overflow:auto}.incoming-work-log h4,.incoming-work-log ol{margin:4px 0}.incoming-work-log time{font-variant-numeric:tabular-nums}`}</style>
    <h4>작업 로그</h4><ol>{entries.map(entry=><li key={entry.key}>
      <time dateTime={entry.at.toISOString()}>{entry.at.toLocaleTimeString('ko-KR')}</time> · <strong>{logLabels[entry.state]}</strong> · {entry.text}
    </li>)}</ol>
    <p className="sr-only" role="status">{logLabels[entries.at(-1).state]} · {entries.at(-1).text}</p>
  </section>;
}
export function IncomingChangeSummary({before,after,products=[],farmBefore,farmAfter}){
  const rows=receiptRowDifferences(before,after), nameByKey=new Map(products.map(p=>[p.ProdKey,p.ProdName]));
  const display=(row,field)=>{
    const value=row?.[field];
    if(value==null||value==='')return '—';
    if(field==='ProdKey')return row.ProdName??nameByKey.get(value)??String(value);
    return typeof value==='number'?fmt(value):value;
  };
  const farmChanged=typeof farmBefore==='string'&&typeof farmAfter==='string'&&farmBefore.trim()!==farmAfter.trim();
  return <section aria-label="변경 항목">
    <h4>변경 항목</h4>
    {farmChanged&&<p>농장 {farmBefore} → <mark>{farmAfter}</mark></p>}
    {rows.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>입고행</th><th>변경 항목</th><th>기존</th><th>수정 후</th></tr></thead>
      <tbody>{rows.flatMap(row=>row.changed.map(field=><tr key={row.key+':'+field}>
        <td>{row.before?.OrderCode || display(row.before??row.after,'ProdKey')}</td><td>{receiptDifferenceFields[field]}</td>
        <td>{display(row.before,field)}</td><td><mark>{display(row.after,field)}</mark></td>
      </tr>))}</tbody></table></div>:!farmChanged&&<p>변경된 항목이 없습니다.</p>}
  </section>;
}

export function ReceiptProductSearch({index, productName, products, onSelect}) {
  const [query,setQuery]=useState(''),[composing,setComposing]=useState(false),[active,setActive]=useState(-1);
  const [remote,setRemote]=useState(null);
  const listId=useId(), keyword=query.trim();
  const local=useMemo(()=>searchReceiptProducts(keyword,products),[keyword,products]);
  const matches=local.length?local:remote?.keyword===keyword?remote.products:[];
  const useRemote=keyword.length>=2&&!composing&&!local.length;
  useEffect(()=>{
    if(!useRemote)return;
    const controller=new AbortController();
    const timeout=setTimeout(async()=>{
      try{
        const response=await fetch('/api/products/search?'+new URLSearchParams({q:keyword}),{signal:controller.signal});
        const value=await response.json();
        if(!response.ok||!value.success)throw new Error('품목 후보 조회 실패');
        const known=new Set(products.map(p=>p.ProdKey));
        if(!controller.signal.aborted)setRemote({keyword,products:receiptSearchSuggestions(keyword,(value.products??[]).filter(p=>known.has(p.ProdKey)))});
      }catch(error){
        if(!controller.signal.aborted)setRemote({keyword,products:[],error:true});
      }
    },250);
    return()=>{clearTimeout(timeout);controller.abort();};
  },[useRemote,keyword,products]);
  const choose=product=>{onSelect(product.ProdName,product);setQuery('');setActive(-1);setRemote(null);};
  useEffect(()=>{
    if(active>=0)document.getElementById(listId+'-'+active)?.scrollIntoView({block:'nearest'});
  },[active,listId]);
  return <div className="receipt-product-search">
    <input role="combobox" aria-label={`${index + 1}행 품목 검색`} placeholder="품목명·코드 검색" value={query}
      aria-autocomplete="list" aria-expanded={!!keyword} aria-controls={keyword?listId:undefined}
      aria-activedescendant={active>=0&&matches[active]?listId+'-'+active:undefined}
      onCompositionStart={()=>setComposing(true)} onCompositionEnd={event=>{setComposing(false);setQuery(event.currentTarget.value);setActive(-1);}}
      onChange={event=>{setQuery(event.target.value);setActive(-1);setRemote(null);}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.keyCode===229||composing)return;
        if(event.key==='Escape'&&keyword){event.preventDefault();event.stopPropagation();setQuery('');setActive(-1);return;}
        if(['ArrowDown','ArrowUp'].includes(event.key)&&matches.length){
          event.preventDefault();
          setActive(current=>current<0?(event.key==='ArrowDown'?0:matches.length-1):(current+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length);
        }
        if(event.key==='Enter'&&matches[active]){event.preventDefault();choose(matches[active]);}
      }}/>
    {keyword&&<div id={listId} role="listbox" className="receipt-product-results" aria-label={`${index + 1}행 품목 검색 결과`}>
      {matches.length?matches.map((product,i)=><button id={listId+'-'+i} role="option" aria-selected={active===i}
        key={product.ProdKey} type="button" onClick={()=>choose(product)}>{product.ProdName} · {product.OutUnit}</button>):
        <span role="status">{composing||useRemote&&remote?.keyword!==keyword?'품목 후보 찾는 중…':remote?.error?'품목 후보를 불러오지 못했습니다. 품목명이나 코드를 다시 입력하세요.':'검색 결과 없음'}</span>}
    </div>}
    {productName&&<div>{productName}</div>}
  </div>;
}

const kinds={FARM:'농장만 변경',PRICE:'단가만 변경',PRODUCT:'품목·수량 변경',QUANTITY:'수량만 변경',ADD:'품목·수량 추가',CANCEL:'품목·수량 취소'};
const fmt=n=>Number(n??0).toLocaleString('ko-KR',{maximumFractionDigits:4});
async function api(url,body){const res=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const data=await res.json();if(!res.ok||!data.success)throw new Error(data.error||'요청에 실패했습니다.');return data;}
export default function IncomingCorrectionRequest({selected,onClose,onSaved}){
  const dialog=useRef(null),lock=useRef(false),operation=useRef(null),submittedDraft=useRef(null),storage=useRef(null);
  const [data,setData]=useState(null),[products,setProducts]=useState([]),[kind,setKind]=useState(selected.initialCorrection?.kind??'FARM'),[farm,setFarm]=useState('');
  const [price, setPrice] = useState({sourceWdetailKey: '', unitPrice: ''});
  const [items,setItems]=useState([]),[reason,setReason]=useState(selected.initialCorrection?.reason??''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[stored,setStored]=useState(null);
  const workLog=useIncomingWorkLog();
  const scope={warehouseKey:selected.WarehouseKey,orderYear:selected.OrderYear,orderWeek:selected.OrderWeek};
  const dirty=!!reason||kind!=='FARM'||!!data&&farm!==data.header.FarmName;
  useEffect(()=>{const opener=document.activeElement;dialog.current.showModal();let alive=true;
    Promise.all([api(`/api/warehouse/correction?${new URLSearchParams(scope)}`),api('/api/products/search')]).then(([d,p])=>{if(!alive)return;const ps=p.products??p.data??[];setData(d);setProducts(ps);setFarm(d.header.FarmName);setItems(d.details.map(r=>receiptItem(r,ps)));
      const draft=selected.approvalDraft;if(draft?.correction.sourceDigest&&draft.correction.sourceDigest!==d.baselineDigest)throw new Error('초안 작성 후 입고가 변경되었습니다. 기존 요청을 취소하고 현재 입고로 새 요청을 작성하세요.');if(draft){setKind(draft.correction.editKind??(draft.correction.mode==='FARM'?'FARM':'PRODUCT'));setFarm(draft.correction.farmName);setReason(draft.reason);if(draft.correction.items)setItems(draft.correction.items);if(draft.correction.price)setPrice(draft.correction.price);}
      storage.current=`incoming.simple:${d.draftOwner}:${scope.warehouseKey}:${draft?.requestId??'new'}`;try{setStored(JSON.parse(sessionStorage.getItem(storage.current)||'null'));}catch{}
    }).catch(e=>setError(e.message));return()=>{alive=false;opener?.focus();};},[]);
  useEffect(()=>{if(storage.current&&dirty&&!saved)try{sessionStorage.setItem(storage.current,JSON.stringify({kind,farm,items,price,reason,operation:operation.current,submittedDraft:submittedDraft.current,preview}));}catch{}},[kind,farm,items,price,reason,dirty,saved]);
  useEffect(()=>{const warn=e=>{if(dirty&&!saved||lock.current){e.preventDefault();e.returnValue='';}};const back=e=>{e.preventDefault();close();};window.addEventListener('beforeunload',warn);window.addEventListener('nenova:menu-back-request',back);return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('nenova:menu-back-request',back);};},[dirty,saved]);
  const close=()=>{if(lock.current)return;if(dirty&&!saved&&!window.confirm('입력한 수정안은 이 탭에 보관됩니다. 목록으로 돌아갈까요?'))return;onClose();};
  const change=fn=>{if(submittedDraft.current||operation.current)return;fn();setPreview(null);operation.current=null;setError('');};
  const patch=(i,values)=>change(()=>setItems(rows=>rows.map((r,n)=>n===i?{...r,...values}:r)));
  const work=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');workLog.reset();try{await fn();}catch(e){setError(e.message);workLog.mark('failure',e.message,operation.current?'attention':'error');}finally{lock.current=false;setBusy(false);}};
  const priceSource = data?.details.find(row => row.WdetailKey === Number(price.sourceWdetailKey));
  const priceReady = !!priceSource && /^\d+(?:\.\d+)?$/.test(String(price.unitPrice));
  const correction=()=>({...scope,sourceDigest:data.baselineDigest,mode:kind==='FARM'?'FARM':'REPLACE',editKind:kind,farmName:kind==='FARM'?farm:data.header.FarmName,...(kind==='FARM'?{}:kind==='PRICE'?{price:{sourceWdetailKey:priceSource.WdetailKey,expectedUnitPrice:priceSource.UPrice,unitPrice:Number(price.unitPrice)}}:{fileName:'입고행 직접 정정',fileMeta:{},items})});
  const inspect=()=>work(async()=>{
    workLog.mark('preview','변경할 입고행 확인 중');
    const result=await api('/api/warehouse/approval',{action:'draftPreview',correction:correction()});
    setPreview(result);
    workLog.mark('preview',result.canCommit?'변경 요약을 확인할 수 있습니다.':'수정할 값을 다시 확인하세요.',result.canCommit?'done':'attention');
  });
  const send=()=>work(async()=>{
    // Keep the exact create operation and submitted draft for safe retry after a lost response.
    if(!submittedDraft.current){workLog.mark('draft','요청 초안 저장 중');const draft=selected.approvalDraft;operation.current??={action:draft?'saveDraft':'create',correction:correction(),reason,operationId:crypto.randomUUID(),...(draft?{requestId:draft.requestId,revision:draft.revision}:{})};try{sessionStorage.setItem(storage.current,JSON.stringify({kind,farm,items,price,reason,operation:operation.current,preview}));}catch{}
      if(operation.current.action==='saveDraft'){const current=await api(`/api/warehouse/approval?requestId=${operation.current.requestId}`);if(current.request.revision!==operation.current.revision){if(JSON.stringify(normalizedCorrection(current.request.correction))!==JSON.stringify(normalizedCorrection(operation.current.correction))||current.request.reason!==reason.trim())throw new Error('다른 사용자가 초안을 변경했습니다. 요청 목록에서 현재 내용을 다시 확인하세요.');submittedDraft.current=current.request;}}
      submittedDraft.current??=await api('/api/warehouse/approval',operation.current);try{sessionStorage.setItem(storage.current,JSON.stringify({kind,farm,items,price,reason,operation:operation.current,submittedDraft:submittedDraft.current,preview}));}catch{}}
    if(submittedDraft.current)workLog.mark('draft','요청 초안 확인 완료','done');
    const d=submittedDraft.current;workLog.mark('status','서버 요청 상태 확인 중');const current=await api(`/api/warehouse/approval?requestId=${d.requestId}`);
    workLog.mark('status','서버 요청 상태 확인 완료','done');
    if(current.request.status==='draft'){
      workLog.mark('submit','영업지원 검토 대기 요청 등록 중');
      const result=await api('/api/warehouse/approval',{action:'submit',requestId:d.requestId,revision:current.request.revision});
      if(result.status!=='requested')throw new Error('요청 등록 상태를 확인하지 못했습니다. 같은 요청 결과를 다시 확인하세요.');
    }
    else if(current.request.status!=='requested')throw new Error('요청 상태가 바뀌었습니다. 목록에서 처리 이력을 확인하세요.');
    workLog.mark('submit',`요청 #${d.requestId}이 영업지원 검토 대기로 등록됐습니다.`,'done');
    setSaved(true);try{sessionStorage.removeItem(storage.current);}catch{}onSaved({approval:true,warehouseKey:scope.warehouseKey,requestId:d.requestId});
  });
  const productFor=item=>products.find(p=>p.ProdName===item.prodName);
  return <dialog ref={dialog} aria-labelledby="simple-correction-title" onCancel={e=>{e.preventDefault();close();}} style={{width:'calc(100vw - 32px)',maxWidth:1800,maxHeight:'calc(100dvh - 32px)',boxSizing:'border-box',overflowY:'auto',padding:'clamp(12px, 1.2vw, 24px)',border:'1px solid #94a3b8',borderRadius:12,color:'#172033'}}>
    <style>{`.simple-incoming :is(button,input,select){font:inherit;padding:8px;margin:4px;max-width:100%;box-sizing:border-box}.simple-incoming :focus-visible{outline:3px solid #2563eb;outline-offset:2px}.simple-incoming{font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif;font-size:14px}.simple-incoming table{border-collapse:collapse;width:100%;min-width:700px;font-variant-numeric:tabular-nums}.simple-incoming :is(td,th){border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}.simple-incoming .receipt-product-search{min-width:180px}.simple-incoming .receipt-product-search input{width:100%;margin-left:0}.simple-incoming .receipt-product-results{display:grid;max-height:180px;overflow:auto}.simple-incoming .receipt-product-results button{margin:0;text-align:left}.simple-incoming [aria-selected=true]{background:#dbeafe;color:#0f172a}.incoming-work-log time{font-variant-numeric:tabular-nums}.incoming-work-log ol{padding-left:24px}.simple-incoming td p{margin:4px 0}.simple-incoming input[type=number]{width:105px}.simple-incoming fieldset{min-inline-size:0;border:1px solid #cbd5e1;margin:12px 0}.simple-incoming :is(p,label){max-width:100%}.simple-incoming label{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}`}</style>
    <div className="simple-incoming"><h2 id="simple-correction-title">입고 수정 요청 · #{scope.warehouseKey}</h2><p>{scope.orderYear}/{scope.orderWeek} · {selected.FarmName} · {selected.InvoiceNo||'인보이스 미기재'}</p><p>선택 농장의 기존 입고 안에서 수정합니다. 영업지원 최종 확정 전까지 원장은 바뀌지 않습니다.</p>
      <p><a target="_blank" rel="noopener noreferrer" href={`/estimate?popup=1&openFixStatus=1&year=${encodeURIComponent(scope.orderYear)}&week=${encodeURIComponent(scope.orderWeek.slice(0,2))}`}>확정 현황 확인·취소 ↗</a> · 해당 연도·차수의 견적서 확정현황을 새 창에서 엽니다.</p>
      {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}{saved&&<p role="status">영업지원에 수정 요청했습니다.</p>}
      <IncomingWorkLog entries={workLog.entries}/>
      {stored&&<p>보관한 수정안이 있습니다.<button disabled={busy} onClick={()=>{setKind(stored.kind);setFarm(stored.farm);setItems(stored.items);if(stored.price)setPrice(stored.price);setReason(stored.reason);operation.current=stored.operation??null;submittedDraft.current=stored.submittedDraft??null;setPreview(stored.preview??null);setStored(null);}}>수정안 불러오기</button></p>}
      {!data?<p>입고 조회 중…</p>:<><fieldset disabled={busy||saved||!!operation.current}><legend>무엇을 바꾸나요?</legend><label>수정 종류<select aria-label="수정 종류" value={kind} onChange={e=>change(()=>{setKind(e.target.value);setPrice({sourceWdetailKey:'',unitPrice:''});setItems(data.details.map(r=>receiptItem(r,products)));setFarm(data.header.FarmName);})}>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        {kind==='FARM'?<WarehouseFarmSelect farms={data.farms} currentFarm={data.header.FarmName} value={farm} label="변경 농장" onChange={name=>change(()=>setFarm(name))}/>:kind==='PRICE'?<>
          <p>품목·수량·농장은 유지하고 선택한 입고행의 단가와 총액만 수정합니다.</p>
          <label>입고행<select aria-label="단가 변경 입고행" value={price.sourceWdetailKey} onChange={e=>change(()=>setPrice({sourceWdetailKey:e.target.value,unitPrice:''}))}>
            <option value="">변경할 입고행 선택</option>
            {data.details.map(row=>{
              const product = products.find(p=>p.ProdKey===row.ProdKey);
              return product && <option key={row.WdetailKey} value={row.WdetailKey}>{product.ProdName} · {row.OrderCode || row.WdetailKey} · {fmt(row.UPrice)}</option>;
            })}
          </select></label>
          {priceSource&&<><p>기존 단가 {fmt(priceSource.UPrice)} · 기존 총액 {fmt(priceSource.TPrice)}</p>
            <label>새 단가<input aria-label="새 단가" type="number" min="0" step="any" value={price.unitPrice} onChange={e=>change(()=>setPrice({...price,unitPrice:e.target.value}))}/></label>
            {priceReady&&<p>수정 후 총액 {fmt(priceSource.OutQuantity*Number(price.unitPrice))}</p>}
          </>}
        </>:<><p>수량은 수정 후 최종 수량입니다. 기존 행을 취소하려면 최종 수량을 0으로 입력하세요.</p><div style={{overflowX:'auto'}}><table><thead><tr><th>기존 품목</th><th>수정 후 품목</th><th>기존 → 최종 수량</th><th>포장·금액</th></tr></thead><tbody>{items.map((item,i)=>{const old=data.details.find(r=>r.WdetailKey===item.sourceWdetailKey),p=productFor(item),unit=p?.OutUnit,field={박스:'boxQty',단:'bunchQty',송이:'steamQty'}[unit];return <tr key={item.sourceWdetailKey??`new${i}`}><td>{old?products.find(p=>p.ProdKey===old.ProdKey)?.ProdName??old.ProdKey:'추가 행'}{!old&&<button onClick={()=>change(()=>setItems(items.filter((_,n)=>n!==i)))}>추가 행 제외</button>}</td><td style={old&&p&&p.ProdKey!==old.ProdKey?{background:'#fff2c6'}:undefined}>{kind==='PRODUCT'||!old?<ReceiptProductSearch index={i} productName={item.prodName} products={products} onSelect={prodName => patch(i,{prodName})}/>:item.prodName}</td><td style={old&&field&&item[field]!==''&&item[field]!=null&&Number(item[field])!==Number(old.OutQuantity)?{background:'#fff2c6'}:undefined}>{old&&<span>{fmt(old.OutQuantity)} → </span>}<input aria-label={`${i+1}행 최종수량`} type="number" min="0" step="any" disabled={kind==='ADD'&&!!old||!field} value={field?item[field]??'':''} onChange={e=>{try{if(!old){patch(i,newReceiptItemQuantities(item,e.target.value,p,data.details));return;}const base=receiptItem(old,products);if(e.target.value===''){patch(i,{[field]:''});return;}if(Number(base[field])>0)patch(i,{...resizeReceiptItem(base,e.target.value,unit),prodName:item.prodName});else patch(i,{[field]:e.target.value});}catch(err){setError(err.message);}}}/>{unit}<br/>{kind==='CANCEL'&&<button onClick={()=>patch(i,{boxQty:0,bunchQty:0,steamQty:0,totalPrice:0})}>이 행 전량 취소</button>}</td><td><details><summary>포장 수량·금액 확인</summary>{[['boxQty','박스'],['bunchQty','단'],['steamQty','송이'],['steamOf1Box','박스당 송이'],['steamOf1Bunch','단당 송이'],['unitPrice','단가'],['totalPrice','총액']].map(([k,label])=><label key={k}>{label}<input aria-label={`${i+1}행 ${label}`} type="number" min="0" step="any" disabled={!!old&&kind!=='PRODUCT'&&!(Number(item[field])===0&&['boxQty','bunchQty','steamQty','totalPrice'].includes(k))} value={item[k]??''} onChange={e=>patch(i,{[k]:e.target.value})}/></label>)}</details>{(!old||p?.ProdKey!==old.ProdKey)&&<p>{old?'기존 입고의 포장·매입값을 제안값으로 유지합니다. 새 원가는 영업지원이 검증합니다.':item.unitPrice===''?'포장은 품목 기준으로 계산합니다. 매입 근거가 없으면 단가·총액만 확인해 입력하세요.':'같은 입고의 해당 품목 포장·매입 근거로 계산했습니다.'}</p>}</td></tr>;})}</tbody></table></div>{kind==='ADD'&&<button onClick={()=>change(()=>setItems([...items,{sourceWdetailKey:null,prodName:'',orderCode:'',boxQty:'',bunchQty:'',steamQty:'',steamOf1Box:'',steamOf1Bunch:'',unitPrice:'',totalPrice:''}]))}>품목·수량 추가</button>}</>}
        <p><label>수정 사유<input aria-label="수정 사유" value={reason} maxLength={500} onChange={e=>change(()=>setReason(e.target.value))} style={{width:600}}/></label></p></fieldset>
        {!saved&&<><button disabled={busy||!reason.trim()||!!operation.current||kind==='PRICE'&&!priceReady} onClick={inspect}>변경 요약 확인</button>{preview&&<section aria-label="요청 변경 요약"><h3>요청할 변경</h3><IncomingChangeSummary before={preview.before} after={preview.after} products={products} farmBefore={preview.farmBefore} farmAfter={preview.farmAfter}/>{preview.issues.map((i,n)=><p role="alert" key={n}>{i.message}</p>)}</section>}<button disabled={busy||!operation.current&&(!preview?.canCommit||!reason.trim())} onClick={send}>{busy?'처리 중…':operation.current?'같은 요청 결과 다시 확인':'영업지원에 수정 요청'}</button></>}
        <details><summary>수정 이력 ({data.history.length}건)</summary>{data.history.map((h,i)=><p key={i}>{h.at} · {h.reason}</p>)}</details></>}
      <button disabled={busy} onClick={close}>목록으로 돌아가기</button>
    </div>
  </dialog>;
}
