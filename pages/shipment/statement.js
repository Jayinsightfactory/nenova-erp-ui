import {useEffect,useMemo,useRef,useState} from 'react';
import Head from 'next/head';
import {useRouter} from 'next/router';
import WorkflowGuide from '../../components/WorkflowGuide';
import ShipmentStatementGroups from '../../components/ShipmentStatementGroups';
import ShipmentStatementSelectors from '../../components/ShipmentStatementSelectors';
import core from '../../lib/shipmentStatement.cjs';
import selection from '../../lib/shipmentStatementSelection.cjs';
import labels from '../../lib/shipmentStatementLabels.cjs';
import styles from '../../styles/ShipmentStatement.module.css';

const initialWeek=()=>Math.min(53,Math.ceil((Date.now()-new Date(new Date().getFullYear(),0,1).getTime()+86400000)/604800000));
const json=async(url,options)=>{const r=await fetch(url,options),d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'요청을 처리하지 못했습니다.');return d;};
const url=s=>'/api/shipment/statement?'+new URLSearchParams(s);
const empty={defaultDay:'일',groups:[],entries:{}};
export default function ShipmentStatement(){
 const router=useRouter();
 const [year,setYear]=useState(''),[week,setWeek]=useState(''),[customers,setCustomers]=useState([]),[manager,setManager]=useState(''),[customer,setCustomer]=useState('');
 const [data,setData]=useState(null),[draft,setDraft]=useState(empty),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [selected,setSelected]=useState([]),[selectedCategories,setSelectedCategories]=useState([]),[search,setSearch]=useState(''),[bulkDay,setBulkDay]=useState('수'),[modal,setModal]=useState(''),[showPreview,setShowPreview]=useState(false);
 const seq=useRef(0),drag=useRef(null),anchor=useRef(0),dialog=useRef(null),returnFocus=useRef(null),saving=useRef(false);
 useEffect(()=>{setYear(String(new Date().getFullYear()));setWeek(String(initialWeek()));},[]);
 useEffect(()=>{const stop=()=>{drag.current=null;};window.addEventListener('pointerup',stop);window.addEventListener('blur',stop);return()=>{window.removeEventListener('pointerup',stop);window.removeEventListener('blur',stop);};},[]);
 useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{const guard=()=>{if(dirty&&!window.confirm('저장하지 않은 출고내역서 변경이 있습니다. 버리고 이동할까요?')){const error=Object.assign(new Error('출고내역서 이동 취소'),{cancelled:true});router.events.emit('routeChangeError',error);throw error;}};router.events.on('routeChangeStart',guard);return()=>router.events.off('routeChangeStart',guard);},[dirty,router]);
 useEffect(()=>{if(modal){returnFocus.current=document.activeElement;dialog.current?.showModal();}else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}},[modal]);
 const permit=()=>!dirty||window.confirm('저장하지 않은 출고내역서 변경이 있습니다. 버리고 이동할까요?');
 function clear(){seq.current++;setData(null);setDraft(empty);setDirty(false);setSelected([]);setSelectedCategories([]);setSearch('');setShowPreview(false);setError('');setMessage('');}
 function changeScope(setter,value){if(!permit())return;clear();setCustomers([]);setCustomer('');setManager('');setter(value);}
 function changeManager(value){if(value===manager||!permit())return;clear();setCustomer('');setManager(value);}
 async function list(nextWeek=week){if(!permit())return;clear();setWeek(nextWeek);setCustomers([]);setCustomer('');const id=++seq.current;setBusy(true);setError('');setMessage('');
  try{const d=await json(url({year,week:nextWeek}));if(id!==seq.current)return;setCustomers(d.customers);const managerMissing=!!manager&&!d.customers.some(c=>c.Manager===manager);if(managerMissing)setManager('');setMessage(`${d.customers.length}개 업체의 분배값을 불러왔습니다. ${managerMissing?'해당 담당자의 분배 업체가 없어 전체 담당자로 표시합니다. ':''}담당자와 업체를 선택하세요.`);}
  catch(e){if(id===seq.current)setError(e.message);}finally{setBusy(false);}
 }
 async function open(key){if(!permit())return;clear();setCustomer(key);if(!key)return;const id=++seq.current;setBusy(true);
  try{const d=await json(url({year,week,custKey:key}));if(id!==seq.current)return;setData(d);setDraft(d.draft);setMessage(d.saved?`저장본 v${d.version}을 불러왔습니다.`:'요일별 수량을 입력한 뒤 저장하세요.');}
  catch(e){if(id===seq.current)setError(e.message);}finally{setBusy(false);}
 }
 const rows=data?.source.rows??[],visible=selection.visibleRows(rows,selectedCategories,search);
 const categories=useMemo(()=>[...new Map(rows.map(r=>[r.category,{key:r.category,label:labels.categoryDisplayLabel(r)}])).values()],[rows]);
 const allocations=new Map(),problems=[];
 for(const r of rows){try{allocations.set(r.id,core.allocation(r,draft.entries[r.id],draft.defaultDay));}catch(e){problems.push(e.message);}}
 const stale=data?.stale,valid=!!data&&!stale&&rows.length>0&&!problems.length;
 const patch=next=>{setDraft(next);setDirty(true);setMessage('수정 중 · 저장 버튼을 눌러야 보관됩니다.');};
 function quantity(row,day,value){const entry={...(draft.entries[row.id]??{})};if(value==='')delete entry[day];else entry[day]=value;patch({...draft,entries:{...draft.entries,[row.id]:entry}});}
 function range(start,end,base=[]){return selection.mergeRangeSelection(visible,start,end,base);}
 function pointer(e,index){if(e.button!==0||busy||stale)return;e.preventDefault();anchor.current=index;drag.current={start:index,base:selected};setSelected(range(index,index,selected));}
 function toggle(id,index,shift){if(shift)setSelected(range(anchor.current,index,selected));else{anchor.current=index;setSelected(s=>s.includes(id)?s.filter(k=>k!==id):[...s,id]);}}
 function chooseDay(day){if(day===draft.defaultDay)return;setBulkDay(day);setModal('default');}
 function applyModal(){if(modal==='default')patch({...draft,defaultDay:bulkDay});else patch({...draft,entries:core.bulkMove(rows,draft.entries,selected,bulkDay)});setModal('');}
 async function download(saved){const s=data.source.scope;const response=await fetch(url({...s,action:'download',version:saved.version}));if(!response.ok){const d=await response.json();throw Error(d.error||'엑셀 다운로드에 실패했습니다.');}
  const blob=await response.blob(),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`${s.year}년 ${s.week}차 ${data.source.customer.name}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
 }
 async function save(exportAfter){if(!valid||saving.current)return;saving.current=true;setBusy(true);setError('');let saved;
  try{const d=await json(url(data.source.scope),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:data.version,sourceHash:data.sourceHash,draft})});saved=d.saved;setData({...data,version:saved.version,saved,stale:false});setDraft(saved.draft);setDirty(false);setMessage(`작성내용 저장 완료 · v${saved.version}`);if(exportAfter){await download(saved);setMessage(`작성내용 저장 완료 · v${saved.version} · 엑셀 다운로드 완료`);}}
  catch(e){setError((saved?'작성내용은 저장됐습니다. 엑셀은 다시 다운로드하세요. ':'')+e.message);}finally{saving.current=false;setBusy(false);}
 }
 let preview=[];if(valid&&showPreview)try{preview=core.outputBlocks({source:data.source,draft});}catch{}
 return <div className={styles.page}>
  <Head><title>출고내역서 | Nenova</title></Head>
  <header className={styles.header}><div><h1>출고내역서</h1><p>메인차수 전체 분배값을 출고요일별로 나누고 업체별 엑셀로 저장합니다.</p></div><span className={styles.badge}>출고내역서용 예정일</span></header>
  <WorkflowGuide workflowId="shipment-statement" />
  <ShipmentStatementSelectors year={year} week={week} customers={customers} manager={manager} customer={customer} busy={busy} onYear={value=>changeScope(setYear,value)} onWeek={value=>changeScope(setWeek,value)} onLoad={list} onManager={changeManager} onCustomer={open}/>
  {error&&<div role="alert" className={styles.error}>{error}</div>}<p role="status" aria-live="polite">{busy?'처리 중…':message}</p>
  {data&&<>
   <section className={styles.panel}><div className={styles.controls}><h2>{data.source.customer.name} · {data.source.scope.year}년 {data.source.scope.week}차</h2>
    <label>기본 출고요일<select aria-label="기본 출고요일" value={draft.defaultDay} disabled={busy||stale} onChange={e=>chooseDay(e.target.value)}>{core.DAYS.map(d=><option key={d}>{d}</option>)}</select></label>
    <button disabled={busy} onClick={()=>open(customer)}>다시 불러오기</button>
    <button disabled={busy||!valid} onClick={()=>save(false)}>작성내용 저장</button>
    <button className={styles.primary} disabled={busy||!valid} onClick={()=>save(true)}>저장 및 엑셀 다운로드</button>
    <button disabled={busy||!data.saved} onClick={async()=>{try{await download(data.saved);}catch(e){setError(e.message);}}}>저장본 엑셀 다시 받기</button>
   </div><p>별도로 지정하지 않은 수량은 <strong>{draft.defaultDay}요일</strong>에 배정됩니다. ERP 실제 출고일·분배 총수량·재고·매출은 변경하지 않습니다.</p>
   {stale&&<div className={styles.error} role="alert">저장 후 차수피벗 원본이 변경됐습니다. 저장본 엑셀은 다시 받을 수 있습니다. 새 원본으로 작성하려면 기존 배분을 초기화하세요. <button onClick={()=>{if(window.confirm('기존 작성본은 보관됩니다. 새 원본으로 요일 배분을 초기화할까요?')){setData({...data,stale:false});patch({...draft,entries:{}});}}}>새 원본으로 배분 초기화</button></div>}
   </section>
   <ShipmentStatementGroups key={JSON.stringify(data.source.scope)} categories={categories} groups={draft.groups} disabled={busy||stale} onChange={groups=>patch({...draft,groups})}/>
   <section className={styles.panel} aria-label="요일별 수량 편집"><div className={styles.controls}>
    <label>품목 검색<input aria-label="품목 검색" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <button disabled={busy||stale||!visible.length} onClick={()=>setSelected(current=>[...new Set([...current,...visible.map(r=>r.id)])])}>표시 품목 추가 선택</button><button onClick={()=>setSelected([])} disabled={!selected.length}>선택 해제</button><strong>{selected.length}개 선택</strong>
    <label>일괄 출고요일<select aria-label="일괄 출고요일" value={bulkDay} onChange={e=>setBulkDay(e.target.value)}>{core.DAYS.map(d=><option key={d}>{d}</option>)}</select></label><button disabled={busy||stale||!selected.length} onClick={()=>setModal('bulk')}>선택 품목 출고일 일괄 지정</button>
    <button disabled={!valid} onClick={()=>setShowPreview(!showPreview)}>{showPreview?'미리보기 접기':'엑셀 미리보기'}</button>
   </div><p className={styles.hint}>품목명을 드래그하면 기존 선택에 추가됩니다 · 품목군·검색 변경 후에도 선택이 유지됩니다 · 체크박스/Shift+선택 가능 · ↑↓·Space 키 지원</p>
   <fieldset className={styles.selectorField} disabled={busy||stale}><legend>국가·품종별 보기 <span className={styles.hint}>{selectedCategories.length?`${selectedCategories.length}개 선택`:'전체 품목군'}</span></legend><div className={styles.buttonRow} role="group" aria-label="국가 품종별 보기">
    <button type="button" aria-pressed={!selectedCategories.length} onClick={()=>setSelectedCategories([])}>전체</button>
    {categories.map(c=><button type="button" key={c.key} aria-label={`${c.label} 보기`} aria-pressed={selectedCategories.includes(c.key)} onClick={()=>setSelectedCategories(current=>selection.toggleCategoryFilter(current,c.key))}>{c.label}</button>)}
   </div><p className={styles.hint}>버튼을 여러 개 선택해 함께 표시할 수 있습니다. 품목 선택은 다른 품목군으로 이동해도 유지됩니다.</p></fieldset>
   {problems.length>0&&<div role="alert" className={styles.error}>{problems.join(' / ')}</div>}
   <div className={styles.tableWrap}><table className={styles.table}><colgroup>{[45,135,260,65,85,85,...core.DAYS.map(()=>88)].map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup><thead><tr><th>선택</th><th>품목군</th><th>품목 · 규격</th><th>단위</th><th>단가</th><th>분배수량</th>{data.source.calendar.map(d=><th key={d.day} className={draft.defaultDay===d.day?styles.default:''}>{d.day} {d.day===draft.defaultDay&&'기본'}<small>{d.date.slice(5)}</small></th>)}</tr></thead>
   <tbody>{visible.map((row,i)=><tr key={row.id} data-row-id={row.id} data-category={row.category} aria-selected={selected.includes(row.id)} className={selected.includes(row.id)?styles.selected:''} onPointerEnter={()=>{if(drag.current)setSelected(range(drag.current.start,i,drag.current.base));}}>
    <td><input type="checkbox" aria-label={`${row.name} 선택`} checked={selected.includes(row.id)} disabled={busy||stale} onChange={()=>{}} onClick={e=>toggle(row.id,i,e.shiftKey)} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const next=Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1)));e.currentTarget.closest('tbody').rows[next]?.querySelector('input[type=checkbox]')?.focus();if(e.shiftKey)setSelected(range(anchor.current,next,selected));}}}/></td>
   <td onPointerDown={e=>pointer(e,i)}>{labels.categoryDisplayLabel(row)}</td><td className={styles.product} onPointerDown={e=>pointer(e,i)} title={row.originalName}>{row.name}<small>{[...new Set(row.sources.map(s=>s.week))].join(', ')}</small></td><td>{row.unit}</td><td>{row.cost===null?'미등록':row.cost.toLocaleString('ko-KR')}</td><td><strong>{row.qty}</strong></td>
    {core.DAYS.map(day=><td key={day} className={day===draft.defaultDay?styles.default:''}><input aria-label={`${row.name} ${day}요일 수량`} type="number" min="0" step="any" value={day===draft.defaultDay?(allocations.get(row.id)?.[day]??''):draft.entries[row.id]?.[day]??''} readOnly={day===draft.defaultDay} disabled={busy||stale} placeholder={day===draft.defaultDay?'잔량':'0'} onChange={e=>quantity(row,day,e.target.value)}/></td>)}
   </tr>)}</tbody></table></div>{!rows.length&&<p>해당 차수에 양수 분배 품목이 없습니다.</p>}
   </section>
   {showPreview&&<section className={styles.panel}><h2>엑셀 미리보기</h2>{preview.map(block=><article key={block.day}><h3>{data.source.customer.name} · {block.date} ({block.day})</h3>{block.groups.map((g,i)=><div key={i}><h4>{g.country==='국내'&&g.flower==='왁스'?'운임비':`${g.name} · ${g.flower}`} ({g.unit})</h4><ul>{g.rows.map(r=><li key={r.id}>{r.name} — {r.quantity}{r.unit} / 단가 {r.cost??'미등록'}</li>)}</ul></div>)}</article>)}</section>}
  </>}
  <dialog ref={dialog} className={styles.dialog} onCancel={e=>{e.preventDefault();setModal('');}}><h2>{modal==='default'?'기본 출고요일 변경':'선택 품목 출고일 일괄 지정'}</h2>
   <p>{modal==='default'?`기본 출고요일을 ${bulkDay}요일로 바꿉니다. 직접 지정한 수량은 유지하고 미지정 잔량만 새 기본요일로 이동합니다.`:`선택한 ${selected.length}개 품목의 기존 요일 배분을 지우고, 총수량 전부를 ${bulkDay}요일로 옮깁니다.`}</p>
   <ul>{rows.filter(r=>modal==='default'||selected.includes(r.id)).map(r=>{let before,after;try{before=core.allocation(r,draft.entries[r.id],draft.defaultDay);after=modal==='default'?core.allocation(r,draft.entries[r.id],bulkDay):{[bulkDay]:r.qty};}catch{return <li key={r.id}>{r.name} · 입력 수량을 먼저 확인하세요.</li>;}const label=v=>Object.entries(v).filter(([,n])=>n>core.EPS).map(([d,n])=>`${d}${n}`).join(' ');return <li key={r.id}>{r.name}: {label(before)} → <strong>{label(after)}</strong> ({r.unit})</li>;})}</ul>
   <div className={styles.controls}><button autoFocus onClick={()=>setModal('')}>취소</button><button className={styles.primary} onClick={applyModal}>변경 적용</button></div>
  </dialog>
 </div>;
}
