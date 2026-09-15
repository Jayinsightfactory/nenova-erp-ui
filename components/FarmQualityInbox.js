import {useEffect,useRef,useState} from 'react';
import {apiGet,apiPost} from '../lib/useApi';
import {QUALITY_KINDS,QUALITY_SIGNAL_KINDS} from '../lib/farmQuality';
import {summarizeQualityInbox,feedbackStatusLabel,feedbackNeedsRequest,feedbackPriority,compactQualityProductName} from '../lib/farmQualityInboxSummary';
import {resizeImageFile} from '../lib/catalogImageClient';
import {QUALITY_EVIDENCE_MAX_BYTES,QUALITY_EVIDENCE_MAX_FILES} from '../lib/farmQualityEvidence';
import {parseJsonResponse} from '../lib/parseJsonResponse';

const day=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const count=value=>Number(value||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
const status=feedbackStatusLabel;
const feedbackNeeded=feedbackNeedsRequest;
const productQuantity=product=>product.quantity==null||!Number.isFinite(Number(product.quantity))?'수량 확인 불가':`${count(product.quantity)} ${product.unit}`;
const commentDate=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'';};
const names=item=>[...new Set((item.sources||[]).map(row=>`${row.farmName||'농장 미지정'} · ${row.productName||'품목 미지정'}`))].join(' / ')||item.cases?.map(c=>c.title).join(' / ')||'기존 피드백';
export const inboxActive=item=>!item.excluded||(item.newSourceKeys||[]).length>0;
export function inboxTarget(item,caseKey,cases){
 const histories=item.cases||[];
 if(histories.length>1&&!caseKey)throw new Error('기록할 이력을 선택하세요.');
 const chosen=histories.find(c=>String(c.caseKey)===String(caseKey));
 if(histories.length&&!chosen)throw new Error('기록할 이력을 다시 선택하세요.');
 const full=cases.find(c=>String(c.CaseKey)===String(caseKey));
 const anchorSourceKey=full?.SourceKey??item.sourceKeys?.[0];
 if(!anchorSourceKey||!item.revision)throw new Error('원본과 목록을 새로고침해 주세요.');
 const scope=(item.exclusionScopes||[]).find(scope=>scope.caseKeys?.some(key=>String(key).toLowerCase()===String(caseKey).toLowerCase()));
 const inboxKey=full?.InboxKey||scope?.inboxKey||(item.inboxKeys?.length===1?item.inboxKeys[0]:undefined);
 return {anchorSourceKey,inboxKey,caseKey:chosen?.caseKey,revision:item.revision};
}

export default function FarmQualityInbox({data,year,from,to,search='',focus,onDirty,onBusy,refresh}){
 const [filter,setFilter]=useState('ALL'),[unit,setUnit]=useState('ALL'),[selected,setSelected]=useState(null),[caseKey,setCaseKey]=useState('');
 const [body,setBody]=useState(''),[kind,setKind]=useState('COMMENT'),[eventDate,setEventDate]=useState(day),[dueDate,setDueDate]=useState(''),[appliedWeek,setAppliedWeek]=useState(''),[reason,setReason]=useState('');
 const [events,setEvents]=useState([]),[historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState('');
 const [images,setImages]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[stale,setStale]=useState(false);
 const lock=useRef(false),pending=useRef(null),historySeq=useRef(0),fileInput=useRef(null);
 const dirty=Boolean(body||reason||images.length);
 useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
 useEffect(()=>{onBusy(busy);},[busy,onBusy]);
 useEffect(()=>()=>{historySeq.current++;onDirty(false);onBusy(false);},[]);
 const items=data.inbox?.items||[],fullCases=data.cases||[];
 const units=[...new Set(items.flatMap(item=>(item.sources||[]).map(row=>row.unit)).filter(Boolean))];
 const visible=items.filter(item=>{
  const text=[names(item),...(item.sources||[]).map(row=>row.customerName),...(item.cases||[]).map(c=>c.title)].join(' ').toLowerCase();
  const inPeriod=!item.firstWeek||item.lastWeek>=Number(from)&&item.firstWeek<=Number(to);
  return text.includes(search.trim().toLowerCase())&&inPeriod&&(unit==='ALL'||item.sources?.some(row=>row.unit===unit));
 });
 const matches=(item,value)=>value==='EXCLUDED'?!inboxActive(item):inboxActive(item)&&(value==='ALL'||value==='NEW'&&feedbackNeeded(item)||value==='MANUAL'&&!item.patternKinds?.length||value==='SUSPECTED'&&item.suspectedRecurrence||item.cases?.some(c=>c.status===value));
 const rows=visible.filter(item=>matches(item,filter)).sort((a,b)=>feedbackPriority(a)-feedbackPriority(b)||Number(b.lastWeek||0)-Number(a.lastWeek||0)||String(a.key).localeCompare(String(b.key)));
 const board=filter==='ALL';
 const columns=board?['NEW','WAITING','ANSWERED','RECURRED'].map(code=>({code,label:status(code),items:rows.filter(item=>matches(item,code))})):[{code:filter,label:({MANUAL:'수동·과거',SUSPECTED:'재발 의심',EXCLUDED:'제외됨'})[filter]||status(filter),items:rows}];
 const otherCount=board?rows.filter(item=>!columns.some(column=>column.items.includes(item))).length:0;
 const selectedSummary=selected?summarizeQualityInbox(selected):null;
 const chosen=selected?.cases?.find(c=>String(c.caseKey)===String(caseKey));
 const full=fullCases.find(c=>String(c.CaseKey)===String(caseKey));
 const capabilities=selected?.capabilities||{};
 const canManage=Boolean(data.canManage&&capabilities.canManage!==false);
 const availableKinds=Object.entries(QUALITY_KINDS).filter(([key])=>(key==='COMMENT'||canManage)&&(!selected?.cases?.length?['COMMENT','REQUEST'].includes(key):!['EXCLUDE','RESTORE'].includes(key)));
 const evidenceUrl=image=>`/api/sales/farm-quality-evidence?year=${year}&evidenceKey=${encodeURIComponent(image.EvidenceKey||image.evidenceKey)}`;
 async function loadHistory(key){
  const id=++historySeq.current;setEvents([]);setHistoryError('');if(!key){setHistoryLoading(false);return;}
  setHistoryLoading(true);try{const result=await apiGet('/api/sales/farm-quality',{year,caseKey:key});if(id===historySeq.current)setEvents(result.events||[]);}catch(e){if(id===historySeq.current)setHistoryError(e.message);}finally{if(id===historySeq.current)setHistoryLoading(false);}
 }
 function openItem(item){
  if(lock.current)return;if(dirty&&!window.confirm('작성 내용과 첨부 이미지를 비우고 다른 피드백을 볼까요?'))return;
  const target=item.cases?.length===1?item.cases[0].caseKey:'';
  setSelected(item);setCaseKey(target);setBody('');setReason('');setImages([]);setKind('COMMENT');setError('');setMessage('');setStale(false);pending.current=null;loadHistory(target);
 }
 useEffect(()=>{if(focus){const item=items.find(item=>item.key===focus.key);if(item)openItem(item);}},[focus]);
 function selectHistory(value){if(lock.current)return;if(dirty){if(!window.confirm('작성 내용과 첨부 이미지를 비우고 기록 대상을 바꿀까요?'))return;setBody('');setReason('');setImages([]);}setCaseKey(value);setKind('COMMENT');pending.current=null;loadHistory(value);}
 async function evidenceRequest(url,options){const response=await fetch(url,{credentials:'include',...options});const result=await parseJsonResponse(response);if(!response.ok)throw new Error(result.error||'이미지 처리에 실패했습니다.');return result;}
 async function upload(files){
  if(lock.current)return;const picked=[...(files||[])].filter(file=>file.type.startsWith('image/'));if(!picked.length)return;
  if(images.length+picked.length>QUALITY_EVIDENCE_MAX_FILES){setError(`이미지는 최대 ${QUALITY_EVIDENCE_MAX_FILES}장까지 첨부할 수 있습니다.`);return;}
  lock.current=true;setBusy(true);setError('');try{const form=new FormData();for(const file of picked){if(file.size>QUALITY_EVIDENCE_MAX_BYTES*4)throw new Error('원본 이미지 한 장은 40MB 이하만 선택하세요.');form.append('files',await resizeImageFile(file,{maxSize:1920,quality:.88}));}const result=await evidenceRequest(`/api/sales/farm-quality-evidence?year=${year}`,{method:'POST',body:form});setImages(previous=>[...previous,...(result.images||[])]);pending.current=null;}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);if(fileInput.current)fileInput.current.value='';}
 }
 function paste(event){const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();upload(files);}}
 async function removeImage(image){if(lock.current)return;lock.current=true;setBusy(true);try{await evidenceRequest(evidenceUrl(image),{method:'DELETE'});setImages(previous=>previous.filter(item=>item.evidenceKey!==image.evidenceKey));pending.current=null;}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
 async function mutate(action){
  if(lock.current||!selected||stale)return;
  setError('');let payload;
  try{
   const target=inboxTarget(selected,caseKey,fullCases),caseVersion=chosen?.version??full?.Version;
   const selectedScope=selected.exclusionScopes?.find(scope=>String(scope.inboxKey).toLowerCase()===String(target.inboxKey).toLowerCase());
   const inboxVersion=selectedScope?.version;
   if(selected.inboxKeys?.length>1&&(!target.inboxKey||!target.caseKey))throw new Error('변경할 인박스에 연결된 이력을 선택하세요.');
   if(action==='inboxEvent'){
    if(!capabilities.canComment)throw new Error('현재 피드백에 기록할 권한이 없습니다.');
    if(!body.trim())throw new Error('내용을 입력하세요.');
    if(!availableKinds.some(([key])=>key===kind))throw new Error('기록 종류를 다시 선택하세요.');
    if(historyLoading||historyError)throw new Error('선택한 이력을 먼저 불러와 주세요.');
    payload={action,year,target,caseVersion,inboxVersion,kind,body,eventDate:kind==='COMMENT'?'':eventDate,dueDate:kind==='REQUEST'?dueDate:'',appliedWeek:kind==='APPLY'?appliedWeek:'',evidenceKeys:images.map(image=>image.evidenceKey)};
   }else{
    if(!data.canManage||!(action==='inboxExclude'?capabilities.canExclude:capabilities.canRestore))throw new Error('제외/복원 권한이 없습니다.');
    if(!reason.trim())throw new Error('제외 또는 복원 사유를 입력하세요.');
    payload={action,year,target,caseVersion,inboxVersion,reason};
   }
  }catch(e){setError(e.message);return;}
  const signature=JSON.stringify(payload);if(pending.current?.signature!==signature)pending.current={signature,payload,requestId:crypto.randomUUID()};
  lock.current=true;setBusy(true);
  try{
   const result=await apiPost('/api/sales/farm-quality',{...pending.current.payload,requestId:pending.current.requestId});
   // A committed acknowledgement is displayed before any optional refresh.
   if(result.event){const acknowledged={...result.event,Evidence:result.event.Evidence?.length?result.event.Evidence:images.map(image=>({EvidenceKey:image.evidenceKey,FileName:image.fileName}))};setEvents(previous=>previous.some(e=>e.EventKey===acknowledged.EventKey)?previous:[...previous,acknowledged]);}
   setMessage(result.replayed?'저장 완료 · 이미 처리된 기록입니다.':'저장 완료 · 기록이 반영되었습니다.');
   if(action==='inboxEvent'){setBody('');setImages([]);}else setReason('');
   pending.current=null;
   const updated=result.inbox?.items?.find(item=>item.sourceKeys?.includes(payload.target.anchorSourceKey))||result.inbox?.item||(result.inbox?.key?result.inbox:null);
   if(updated){setSelected(updated);setStale(false);}else setStale(true);
   if(result.caseKey)setCaseKey(result.caseKey);
   Promise.resolve(refresh()).then(ok=>{if(!ok)setError('저장은 완료됐지만 목록을 새로고침하지 못했습니다.');}).catch(()=>setError('저장은 완료됐지만 목록을 새로고침하지 못했습니다.'));
  }catch(e){if(e.code==='INBOX_STALE'||e.code==='QUALITY_STALE'){setStale(true);pending.current=null;}setError(`${e.message} 입력 내용과 첨부 이미지는 유지됩니다.`);}finally{lock.current=false;setBusy(false);}
 }
 function reviewLatest(){
  const latest=items.find(item=>item.key===selected?.key)||items.find(item=>item.sourceKeys?.some(key=>selected?.sourceKeys?.includes(key)));
  if(!latest){setError('현재 목록에서 피드백을 찾지 못했습니다. 새로고침해 주세요.');return;}
  setSelected(latest);setStale(false);pending.current=null;
  if(!latest.cases?.some(c=>String(c.caseKey)===String(caseKey))){setCaseKey('');loadHistory('');}
 }
 return <section className="inbox" aria-label="통합 피드백 목록">
  <div className="filters">{[['ALL','전체 활성'],...['NEW','WAITING','ANSWERED','OBSERVING','CLOSED','RECURRED'].map(code=>[code,status(code)]),['SUSPECTED','재발 의심'],['MANUAL','수동·과거'],['EXCLUDED','제외됨']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label} {visible.filter(item=>matches(item,value)).length}</button>)}<label>단위 <select value={unit} onChange={e=>setUnit(e.target.value)}><option value="ALL">전체 단위</option>{units.map(value=><option key={value}>{value}</option>)}</select></label></div>
  <small>진행 상태는 저장된 이력 기준입니다. 새 불량은 별도로 표시되며, 원본 확인 상태와 관계없이 기록할 수 있습니다.</small>
  {!data.inbox&&<p role="status">통합 피드백 목록을 불러오는 중입니다.</p>}
  {board&&otherCount>0&&<small className="other-status">그 외 상태 {otherCount}개 · 개선 관찰·완료 등은 위 상태 버튼에서 확인하세요.</small>}
  <div className={`workspace ${selected?'expanded':''}`}><div className={`rows ${board?'board':'single'}`} aria-label={board?'상태별 4열 보드':'선택 상태 목록'}>{columns.map(column=><section className={`board-column column-${column.code}`} key={column.code} aria-label={`${column.label} 목록`}><h3>{column.label}<span>{column.items.length}</span></h3><div className="column-cards">{column.items.map(item=>{const summary=summarizeQualityInbox(item);return <button disabled={busy} aria-pressed={selected?.key===item.key} className={`row ${selected?.key===item.key?'selected':''}`} key={item.key} onClick={()=>openItem(item)}>
   <span className="summary-column"><strong>{summary.title}</strong><span className="badges workflow">{summary.statuses.map(state=><b className={`status-${state.code}`} key={state.code}>{state.label}{state.count>1?` ${state.count}건`:''}</b>)}{summary.newCount>0&&<small>새 불량 {summary.newCount}</small>}{summary.reviewRequired&&<b>원본 확인 필요</b>}{!inboxActive(item)&&<b>제외됨</b>}</span><small>{summary.overview} · {summary.totalsText}</small>{summary.latest&&<span className="latest-comment" title={`${summary.latest.Body} · ${summary.latest.AuthorName||'작성자 미상'} · ${commentDate(summary.latest.CreatedAt)}`}>{summary.latest.Body}</span>}</span>
   <span className="products-column">{summary.topGroups.map(group=><span className="product-group" key={group.unit}>{group.products.map(product=><span className="product-line" key={product.key}><span title={product.name}><b>{compactQualityProductName(product.name)}</b> · {productQuantity({...product,unit:group.unit})}{product.share!=null&&<small> · {count(product.share)}%</small>}</span><small className="week-breakdown">{product.weekText}</small></span>)}{group.remaining>0&&<small>외 {group.remaining}개 품목 · 상세에서 전체 보기</small>}</span>)}{!summary.topGroups.length&&<small>현재 집계할 품목 없음 · 상세 이력 확인</small>}</span>
  </button>;})}{data.inbox&&!column.items.length&&<p className="empty-column">해당 상태의 피드백이 없습니다.</p>}</div></section>)}</div>
  {selected&&<aside><div className="heading"><h2>{selectedSummary.title}</h2><button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('작성 내용을 비우고 닫을까요?'))return;setSelected(null);setBody('');setReason('');setImages([]);historySeq.current++;}}>닫기</button></div>
   <details className="full-products"><summary>전체 품목별 불량 내역 · {selectedSummary.products.length}개</summary><div className="sources">{selectedSummary.products.map(product=><div key={product.key}><b>{product.name} · {productQuantity(product)}</b><span>{product.share!=null?`${count(product.share)}% (같은 단위 불량수량 비중) · `:''}원본 {product.count}건</span><small>{product.weekText}</small></div>)}</div></details>
   <details className="request-suggestion"><summary>요청 문구 제안 · 자동 발송되지 않음</summary><p>{selectedSummary.requestText}</p><small>참고용 문구입니다. 외부 발송이나 요청 이력 저장은 자동으로 실행되지 않습니다.</small></details>
   <details><summary>원본 근거 {selected.sourceCount}건 · 패턴 {selected.patternKinds?.length||0}개</summary><p>{selected.patternKinds?.map(key=>QUALITY_SIGNAL_KINDS[key]||key).join(' · ')}</p>{selected.sourceReviewRequired&&<p className="warning">{selected.sourceReviewReasons?.join(' · ')} · 피드백 기록 가능</p>}<div className="sources">{selected.sources?.map((row,index)=><div key={`${row.sourceKey}-${index}`}><b>{row.orderWeek} · {row.farmName||'농장 미지정'} · {row.productName}</b><span>업체 {row.customerName||'거래처 미상'} · {row.quantity==null||!Number.isFinite(Number(row.quantity))?'수량 확인 불가':`${count(row.quantity)} ${row.unit}`}</span>{(row.historical||row.isHistorical)&&<small>과거 연결 원본</small>}{row.reasons?.length>0&&<small>{row.reasons.join(' · ')}</small>}</div>)}</div></details>
   {selected.cases?.length>0&&<label>조회·기록 대상 이력 <select aria-label="기록 대상 이력" disabled={busy} value={caseKey} onChange={e=>selectHistory(e.target.value)}><option value="">이력을 선택하세요</option>{selected.cases.map((c,index)=><option key={c.caseKey} value={c.caseKey}>{c.title} · {status(c.status)} · 이력 {index+1}</option>)}</select></label>}
   {selected.cases?.length>1&&!caseKey&&<p className="warning">여러 기존 이력이 연결되어 있습니다. 조회하고 기록할 대상을 직접 선택하세요.</p>}
   <div className="events" aria-live="polite">{historyLoading?<p>이력 불러오는 중…</p>:events.map((event,index)=><article key={event.EventKey||index}><b>{QUALITY_KINDS[event.Kind]||({EXCLUDE:'제외',RESTORE:'복원'})[event.Kind]||'기록'} · {event.AuthorName}</b><small>{event.CreatedAt?new Date(event.CreatedAt).toLocaleString('ko-KR'):''}</small><p>{event.Body}</p>{event.EventDate&&<small>업무일 {String(event.EventDate).slice(0,10)}</small>}{event.DueDate&&<small>답변기한 {String(event.DueDate).slice(0,10)}</small>}<div className="images">{event.Evidence?.map(image=><a href={evidenceUrl(image)} key={image.EvidenceKey} target="_blank" rel="noreferrer"><img src={evidenceUrl(image)} alt={image.FileName||'증거 이미지'}/></a>)}</div></article>)}</div>
   {historyError&&<p role="alert">{historyError} <button onClick={()=>loadHistory(caseKey)}>이력 다시 조회</button></p>}
   {message&&<p role="status" className="success">{message}</p>}{error&&<p role="alert" className="warning">{error}</p>}
   {stale&&<div className="warning">최신 원본과 이력을 다시 확인한 뒤 저장하세요. 입력 내용은 유지됩니다. <button disabled={busy} onClick={async()=>{await refresh();}}>목록 새로고침</button> <button disabled={busy} onClick={reviewLatest}>최신 대상 확인</button></div>}
   <fieldset disabled={busy} onPaste={paste}><legend>피드백 기록</legend><label>기록 종류<select value={kind} onChange={e=>setKind(e.target.value)}>{availableKinds.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{kind!=='COMMENT'&&<label>업무일<input type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label>}{kind==='REQUEST'&&<label>답변기한<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>}{kind==='APPLY'&&<label>적용 차수<input type="number" min="1" max="53" value={appliedWeek} onChange={e=>setAppliedWeek(e.target.value)}/></label>}<label>내용<textarea maxLength="4000" value={body} onChange={e=>setBody(e.target.value)}/></label><div className="images">{images.map(image=><figure key={image.evidenceKey}><img src={evidenceUrl(image)} alt={image.fileName||'첨부 예정 이미지'}/><button onClick={()=>removeImage(image)}>첨부 제거</button></figure>)}</div><input hidden ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>upload(e.target.files)}/><button onClick={()=>fileInput.current?.click()}>증거 이미지 첨부 · Ctrl+V</button><button className="primary" disabled={stale||historyLoading||Boolean(historyError)||!body.trim()||!capabilities.canComment||Boolean(selected.cases?.length&&!caseKey)} onClick={()=>mutate('inboxEvent')}>{busy?'저장 중…':'이력 저장'}</button></fieldset>
   {data.canManage&&(capabilities.canExclude||capabilities.canRestore)&&<fieldset disabled={busy}><legend>목록 제외 · 복원</legend>{selected.exclusionScopes?.map(scope=><p key={scope.inboxKey}>{scope.caseKeys?.map(key=>selected.cases?.find(c=>c.caseKey===key)?.title||'기존 이력').join(' / ')} · {scope.excluded?'제외됨':'활성'}{scope.reason?` · ${scope.reason}`:''}</p>)}{selected.exclusionReason&&<p>최근 제외·복원 사유: {selected.exclusionReason}</p>}<label>사유<input maxLength="1000" value={reason} onChange={e=>setReason(e.target.value)}/></label>{capabilities.canExclude&&<button disabled={stale||!reason.trim()} onClick={()=>mutate('inboxExclude')}>사유를 남기고 제외</button>}{capabilities.canRestore&&<button disabled={stale||!reason.trim()} onClick={()=>mutate('inboxRestore')}>사유를 남기고 복원</button>}</fieldset>}
  </aside>}</div>
  <style jsx>{`
   .inbox{font-size:13px;min-width:0}.filters{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.filters label{margin-left:auto}button,input,select,textarea{font:inherit;color:#19304f;border:1px solid #c4d2e5;border-radius:5px;padding:5px 7px;background:white;max-width:100%;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true],.primary{background:#205db5;color:white}.workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;height:calc(100vh - 248px);min-height:450px;margin-top:7px}.workspace.expanded{grid-template-columns:minmax(0,1fr) minmax(400px,32%)}.rows{overflow:auto;display:grid;align-content:start;gap:4px}.row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) auto;gap:4px 10px;text-align:left;padding:8px;border-left:4px solid #819dc1;min-width:0}.row.selected{border-color:#205db5;background:#eef5ff;color:#19304f}.row>strong{overflow-wrap:anywhere}.badges{display:flex;gap:4px;flex-wrap:wrap}.badges b{font-size:11px;background:#fff1cf;color:#75520b;border-radius:4px;padding:2px 4px}.patterns{grid-column:1/-1;color:#5b6d82;font-size:11px}.histories{grid-column:1/-1;display:flex;gap:5px;flex-wrap:wrap;font-size:12px}.histories span{background:#edf3fa;padding:3px 5px;border-radius:4px;min-width:0;max-width:100%}.latest-comment{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;line-height:1.25;color:#50637b}aside{min-width:0;overflow:auto;border:1px solid #c4d2e5;border-radius:6px;padding:8px;background:#fff}.heading{display:flex;gap:7px;align-items:flex-start;justify-content:space-between}h2{font-size:14px;margin:0 0 8px;overflow-wrap:anywhere}.heading button{flex-shrink:0}label{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin:5px 0}aside label{flex-direction:column;align-items:stretch}.sources{max-height:220px;overflow:auto}.sources>div{display:grid;gap:3px;border-bottom:1px solid #dce5ef;padding:6px;overflow-wrap:anywhere}.events{max-height:300px;overflow:auto}.events article{background:#f0f6fc;border-left:3px solid #739aca;padding:6px;margin:5px 0}.events small{display:block;color:#65748a}.events p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}.images{display:flex;gap:5px;flex-wrap:wrap}.images img{width:90px;height:65px;object-fit:cover}.images figure{margin:0;display:grid}.warning{background:#fff2da;color:#78530c;padding:7px;overflow-wrap:anywhere}.success{background:#e5f6ea;color:#23673a;padding:7px}fieldset{border:1px solid #d4e0ed;border-radius:5px;margin:8px 0;padding:7px;min-width:0}fieldset>button{margin:3px}textarea{width:100%;height:70px;resize:vertical}summary{cursor:pointer;padding:6px;background:#f4f7fc}details p{overflow-wrap:anywhere}
   .row,.row-labels{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) minmax(0,.9fr)}.row{align-items:start;padding:10px;gap:12px}.row-labels{display:grid;gap:12px;padding:7px 14px;background:#edf3fa;color:#4c607b;font-weight:600;position:sticky;top:0;z-index:1}.summary-column,.products-column,.progress-column,.product-group,.product-line,.comment{display:grid;gap:5px;min-width:0;overflow-wrap:anywhere}.summary-column>strong{font-size:14px}.row small{font-size:12px;color:#50637b;line-height:1.4}.products-column,.progress-column{border-left:1px solid #dce5ef;padding-left:10px}.product-line{gap:2px}.product-group+.product-group{border-top:1px solid #dce5ef;padding-top:6px}.latest-comment{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.5}.badges .status-WAITING{background:#e8f0ff;color:#24559a}.badges .status-ANSWERED,.badges .status-OBSERVING{background:#e5f4f2;color:#24655d}.badges .status-CLOSED{background:#e7f2e8;color:#35673d}.badges .status-RECURRED{background:#ffe8e5;color:#9b392f}.request-suggestion p{white-space:pre-wrap}.full-products,.request-suggestion{margin-bottom:7px}.row:focus-visible{outline:3px solid #205db5;outline-offset:-3px}
   .row,.row-labels{grid-template-columns:minmax(260px,29%) minmax(0,1fr);gap:8px}.row{padding:6px 8px}.row-labels{padding:5px 12px}.summary-column,.products-column,.product-group{gap:3px}.workflow{align-items:center}.workflow b{font-size:12px;padding:3px 6px}.workflow small{font-size:11px}.products-column{padding-left:8px}.product-line{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;align-items:baseline;line-height:1.45}.row small{line-height:1.3}.latest-comment{font-size:12px;line-height:1.3;-webkit-line-clamp:1}.week-breakdown{font-variant-numeric:tabular-nums}.expanded .product-line{grid-template-columns:minmax(0,1fr)}
   @media(max-width:1100px){.workspace.expanded{grid-template-columns:minmax(0,1fr) minmax(350px,42%)}.row{grid-template-columns:minmax(0,1fr)}.row-labels{display:none}.products-column,.progress-column{border-left:0;border-top:1px solid #dce5ef;padding:6px 0 0}.patterns,.histories{grid-column:1}}
   .product-line{grid-template-columns:minmax(180px,320px) minmax(0,1fr)}
   .rows.board{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;overflow:hidden;align-content:stretch;min-height:0}.rows.single{grid-template-columns:minmax(0,1fr);overflow:hidden;align-content:stretch}.board-column{display:flex;flex-direction:column;min-width:0;min-height:0;background:#f2f5fa;border:1px solid #d4e0ed;border-radius:6px;overflow:hidden}.board-column h3{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;margin:0;padding:9px 10px;font-size:14px;background:#fff1cf;color:#75520b}.board-column h3 span{background:#fff9;padding:2px 7px;border-radius:10px}.column-WAITING h3{background:#e8f0ff;color:#24559a}.column-ANSWERED h3{background:#e5f4f2;color:#24655d}.column-RECURRED h3{background:#ffe8e5;color:#9b392f}.column-cards{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:5px;padding:5px;scrollbar-gutter:stable}.column-cards .row{flex-shrink:0;grid-template-columns:minmax(0,1fr);padding:7px;gap:5px}.column-cards .products-column{border-left:0;border-top:1px solid #dce5ef;padding:5px 0 0}.column-cards .product-line{grid-template-columns:minmax(0,1fr);gap:0}.column-cards .product-group{gap:4px}.column-cards .row small{font-size:11px}.column-cards .summary-column>strong{font-size:13px}.empty-column{font-size:12px;color:#69798c;margin:8px}.other-status{display:block;margin-top:4px}.workspace.expanded .rows.board{grid-template-columns:repeat(4,minmax(220px,1fr));overflow-x:auto}
   @media(max-width:1100px){.rows.board{grid-template-columns:repeat(4,minmax(240px,1fr));overflow-x:auto}}
   @media(max-width:760px){.workspace,.workspace.expanded{height:auto;grid-template-columns:minmax(0,1fr);min-height:0}.rows.board,.workspace.expanded .rows.board{height:560px;max-height:none;grid-template-columns:repeat(4,minmax(260px,85vw));overflow-x:auto}.rows.single{height:420px}.row,.product-line{grid-template-columns:minmax(0,1fr)}aside{max-height:none}.filters label{margin-left:0;width:100%}.events{max-height:260px}}
  `}</style>
 </section>;
}
