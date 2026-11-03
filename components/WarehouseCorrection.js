import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { parseWarehousePackingWorkbook } from '../lib/warehousePackingImport.js';

const fmt=n=>Number(n??0).toLocaleString('ko-KR',{maximumFractionDigits:4});
async function api(url,body){
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
  const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'요청에 실패했습니다.');return data;
}
export default function WarehouseCorrection({selected,onClose,onSaved}){
  const dialog=useRef(null),busyRef=useRef(false),draftKey=useRef(null);
  const [data,setData]=useState(null),[mode,setMode]=useState('FARM'),[farmName,setFarmName]=useState('');
  const [file,setFile]=useState(null),[reason,setReason]=useState(''),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[draft,setDraft]=useState(null),[pending,setPending]=useState(null);
  const scope={warehouseKey:selected.WarehouseKey,orderYear:selected.OrderYear,orderWeek:selected.OrderWeek};
  const dirty=!!file||!!reason||!!data&&farmName!==data.header.FarmName;
  const load=()=>api(`/api/warehouse/correction?${new URLSearchParams(scope)}`).then(d=>{setData(d);setFarmName(d.header.FarmName);return d;});
  useEffect(()=>{
    const opener=document.activeElement;dialog.current.showModal();let active=true;
    load().then(d=>{if(!active)return;draftKey.current=`incoming.correction:${d.draftOwner}:${scope.warehouseKey}`;
      try{const stored=JSON.parse(sessionStorage.getItem(draftKey.current)||'null');if(stored)setDraft(stored);}catch{}
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;opener?.focus();};
  },[]);
  useEffect(()=>{
    if(!draftKey.current||!dirty||saved)return;
    try{sessionStorage.setItem(draftKey.current,JSON.stringify({mode,farmName,file,reason}));}catch{}
  },[mode,farmName,file,reason,saved,dirty]);
  useEffect(()=>{
    const before=e=>{if(dirty&&!saved||busyRef.current){e.preventDefault();e.returnValue='';}};
    const back=e=>{e.preventDefault();close();};
    window.addEventListener('beforeunload',before);window.addEventListener('nenova:menu-back-request',back);
    return()=>{window.removeEventListener('beforeunload',before);window.removeEventListener('nenova:menu-back-request',back);};
  });
  const close=()=>{if(busyRef.current)return;if(dirty&&!saved&&!window.confirm('입력 중인 수정안은 이 탭에 보관됩니다. 목록으로 돌아갈까요?'))return;onClose();};
  const invalidate=()=>{setPreview(null);setConfirmed(false);setPending(null);setSaved(false);setError('');};
  const perform=async fn=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{busyRef.current=false;setBusy(false);}};
  const readFile=event=>{
    const selectedFile=event.target.files?.[0];event.target.value='';if(!selectedFile)return;
    invalidate();setFile(null);
    perform(async()=>{
      if(selectedFile.size>5*1024*1024)throw new Error('5MB 이하의 파킹 엑셀을 선택하세요.');
      const {meta,rows}=parseWarehousePackingWorkbook(await selectedFile.arrayBuffer(),XLSX);
      setFile({fileName:selectedFile.name,fileMeta:meta,items:rows});
      if(meta.farmName)setFarmName(meta.farmName);
    });
  };
  const request=()=>({...scope,mode,farmName,...(mode==='REPLACE'?file:{})});
  const inspect=()=>perform(async()=>{setPreview(null);setConfirmed(false);setPending(null);const result=await api('/api/warehouse/correction',{...request(),action:'preview'});setPreview(result);});
  const save=()=>perform(async()=>{
    const payload=pending||{...request(),action:'commit',baselineDigest:preview.baselineDigest,confirmed:true,reason,operationId:crypto.randomUUID()};
    setPending(payload);
    const result=await api('/api/warehouse/correction',payload);
    setSaved(true);setConfirmed(false);setPreview(null);setPending(null);setFile(null);setReason('');
    try{sessionStorage.removeItem(draftKey.current);}catch{}
    onSaved(result);
    try{await load();}catch(e){setError(`저장은 완료됐지만 이력 재조회가 실패했습니다. 창을 닫고 다시 조회하세요. ${e.message}`);}
  });
  const restore=()=>{invalidate();setMode(draft.mode);setFarmName(draft.farmName);setFile(draft.file);setReason(draft.reason);setDraft(null);};
  return <dialog ref={dialog} aria-labelledby="correction-title" onCancel={e=>{e.preventDefault();close();}} style={{boxSizing:'border-box',width:'min(1060px, calc(100vw - 32px))',maxHeight:'90vh',overflowY:'auto',border:'1px solid #94a3b8',borderRadius:12,padding:24,color:'#172033',background:'#fff'}}>
    <style>{`.warehouse-correction button,.warehouse-correction input,.warehouse-correction select{font:inherit;padding:7px;margin:3px;max-width:100%;box-sizing:border-box}.warehouse-correction :focus-visible{outline:3px solid #2563eb;outline-offset:2px}.warehouse-correction table{border-collapse:collapse;width:max-content;min-width:100%}.warehouse-correction th,.warehouse-correction td{padding:7px 12px;border:1px solid #cbd5e1;max-width:280px;overflow-wrap:anywhere}.warehouse-correction label{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}.warehouse-correction fieldset{border:1px solid #cbd5e1;min-width:0;margin:12px 0}.warehouse-correction summary{cursor:pointer;padding:10px}`}</style>
    <div className="warehouse-correction">
      <h2 id="correction-title">입고 수정 · #{scope.warehouseKey}</h2>
      <p>{scope.orderYear}년 {scope.orderWeek} · {selected.FarmName} · {selected.InvoiceNo||'인보이스 미기재'}</p>
      <p>기존 입고를 수정합니다. 파일 교체는 파일 전체의 최종 수량을 적용합니다. 연도·차수·인보이스·AWB·입력일자와 운송비는 유지합니다.</p>
      {error&&<p role="alert" style={{color:'#b91c1c',whiteSpace:'pre-wrap'}}>{error}</p>}
      {saved&&<p role="status" style={{color:'#047857'}}>수정을 저장했습니다. 아래 수정 이력에서 결과를 확인할 수 있습니다.</p>}
      {draft&&<p>이 탭에 보관한 수정안이 있습니다. <button disabled={busy} onClick={restore}>수정안 불러오기</button><button disabled={busy} onClick={()=>{try{sessionStorage.removeItem(draftKey.current);}catch{}setDraft(null);}}>보관안 삭제</button></p>}
      {!data?<p role="status">{error?'자료를 읽지 못했습니다. 창을 닫고 다시 열어주세요.':'기존 입고와 수정 이력 조회 중…'}</p>:<>
        <fieldset disabled={busy||!!pending}><legend>수정 내용</legend>
          <label>수정 방식<select aria-label="수정 방식" value={mode} onChange={e=>{invalidate();setMode(e.target.value);setFile(null);}}><option value="FARM">농장만 수정</option><option value="REPLACE">수정 파일로 교체</option></select></label>
          <label>농장<select aria-label="수정 농장" value={farmName} onChange={e=>{invalidate();setFarmName(e.target.value);}}>
            {[...new Set([data.header.FarmName,farmName,...data.farms.map(f=>f.FarmName)])].map(name=><option key={name} value={name}>{name}</option>)}
          </select></label>
          {mode==='REPLACE'&&<p><label>수정 파킹 파일<input aria-label="수정 파킹 파일" type="file" accept=".xlsx,.xls" onChange={readFile}/></label>{file&&<span>{file.fileName} · {file.items.length}행</span>}</p>}
          <p><label style={{display:'flex'}}>수정 사유<input aria-label="수정 사유" maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} style={{flex:'1 1 240px',minWidth:0}} placeholder="예: 농장 선택 오류, 품목명 오입력 정정"/></label></p>
        </fieldset>
        <button disabled={busy||!!pending||mode==='REPLACE'&&!file} onClick={inspect}>변경 내역 미리보기</button>
        {preview&&<section aria-label="수정 미리보기">
          <h3>농장: {preview.farmBefore} → {preview.farmAfter}</h3>
          {preview.issues.map((issue,i)=><p role="alert" key={i} style={{color:'#b91c1c'}}>{issue.message}{issue.blockers?.map((b,j)=><span key={j}> · {b.orderYear}/{b.orderWeek} {b.countryFlower}</span>)}</p>)}
          <div style={{overflowX:'auto'}}><table><caption>품목별 입고 최종 수량</caption><thead><tr><th>품목</th><th>단위</th><th>기존</th><th>수정 후</th><th>증감</th></tr></thead><tbody>{preview.changes.map(c=><tr key={c.prodKey}><td>{c.prodName}</td><td>{c.unit}</td><td>{fmt(c.before)}</td><td>{fmt(c.after)}</td><td>{c.delta>0?'+':''}{fmt(c.delta)}</td></tr>)}</tbody></table></div>
          <details><summary>전체 품목·수량·금액 변경 전후 보기</summary>{[['기존',preview.before],['수정 후',preview.after]].map(([label,list])=><div key={label} style={{overflowX:'auto'}}><table><caption>{label}</caption><thead><tr>{['품목','주문코드','박스','단','송이','출고단위수량','견적단위수량','단가','총액'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{list.map((d,i)=><tr key={i}><td>{d.ProdName||preview.changes.find(c=>c.prodKey===d.ProdKey)?.prodName||d.ProdKey}</td><td>{d.OrderCode}</td>{['BoxQuantity','BunchQuantity','SteamQuantity','OutQuantity','EstQuantity','UPrice','TPrice'].map(k=><td key={k}>{fmt(d[k])}</td>)}</tr>)}</tbody></table></div>)}</details>
          {preview.canCommit&&<p><label><input type="checkbox" checked={confirmed} disabled={busy||!!pending} onChange={e=>setConfirmed(e.target.checked)}/>위 변경 내역과 기존 입고 교체를 확인했습니다.</label></p>}
        </section>}
        {pending&&<p role="alert">저장 결과를 확인하지 못했습니다. 같은 작업번호로 다시 확인하면 중복 저장되지 않습니다.</p>}
        <p><button disabled={busy||!pending&&(!preview?.canCommit||!confirmed||!reason.trim())} onClick={save}>{busy?'처리 중…':pending?'같은 저장 작업 다시 확인':'확인한 내용 저장'}</button>
          {pending&&<button disabled={busy} onClick={()=>{setPending(null);setPreview(null);setConfirmed(false);setError('다시 미리보기를 실행해 현재 입고를 확인하세요.');}}>현재 입고 다시 검토</button>}
        </p>
        <details><summary>수정 이력 ({data.history.length}건 · 최근 20건)</summary>{data.history.length?data.history.map((h,i)=><p key={i}>{new Date(h.at).toLocaleString('ko-KR')} · {h.mode==='FARM'?'농장 수정':'파일 교체'} · {h.reason} {h.fileName&&`(${h.fileName})`}</p>):<p>이 기능으로 저장한 수정 이력이 없습니다.</p>}</details>
      </>}
      <button disabled={busy} onClick={close}>목록으로 돌아가기</button>
    </div>
  </dialog>;
}
