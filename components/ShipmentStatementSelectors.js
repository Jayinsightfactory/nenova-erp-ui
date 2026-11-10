import {useEffect,useMemo,useRef,useState} from 'react';
import selection from '../lib/shipmentStatementSelection.cjs';
import styles from '../styles/ShipmentStatement.module.css';

async function favoriteRequest(options){
 const response=await fetch('/api/favorites?page='+selection.FAVORITE_PAGE,{cache:'no-store',...options}),data=await response.json();
 if(!response.ok||!data.success)throw Error(data.error||'즐겨찾기를 처리하지 못했습니다.');return data;
}
function moveFocus(event){
 if(event.target.tagName!=='BUTTON'||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
 const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(event.target);if(index<0)return;
 event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)));buttons[next]?.focus();
}
export default function ShipmentStatementSelectors({year,week,customers,manager,customer,busy,onYear,onWeek,onLoad,onManager,onCustomer}){
 const [records,setRecords]=useState([]),[favoriteReady,setFavoriteReady]=useState(false),[favoriteLoading,setFavoriteLoading]=useState(false),[favoriteError,setFavoriteError]=useState(''),[customerSearch,setCustomerSearch]=useState('');
 const mutation=useRef(false),[favoriteBusy,setFavoriteBusy]=useState(false),active=useRef(true),requestSeq=useRef(0);
 const favorites=useMemo(()=>selection.customerFavoriteKeys(records),[records]);
 const shown=selection.visibleCustomers(customers,manager,customerSearch,favorites),managers=[...new Set(customers.map(c=>c.Manager).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
 async function refreshFavorites(){
  const seq=++requestSeq.current;setFavoriteLoading(true);setFavoriteError('');
  try{const data=await favoriteRequest();if(!Array.isArray(data.favorites))throw Error('즐겨찾기 목록을 확인하지 못했습니다.');if(active.current&&seq===requestSeq.current){setRecords(data.favorites);setFavoriteReady(true);}}
  catch(e){if(active.current&&seq===requestSeq.current){setFavoriteReady(false);setFavoriteError(e.message);}}
  finally{if(active.current&&seq===requestSeq.current)setFavoriteLoading(false);}
 }
 useEffect(()=>{active.current=true;void refreshFavorites();return()=>{active.current=false;requestSeq.current++;};},[]);
 useEffect(()=>{setCustomerSearch('');},[year,week,manager]);
 async function toggleFavorite(company){
  if(mutation.current||!favoriteReady)return;mutation.current=true;setFavoriteBusy(true);setFavoriteError('');
  try{
   const keys=favorites.get(Number(company.CustKey))??[];
   if(keys.length){for(const key of keys)await favoriteRequest({method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({favoriteKey:key})});}
   else await favoriteRequest({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:selection.FAVORITE_PAGE,name:company.CustName,filterData:JSON.stringify({custKey:Number(company.CustKey)})})});
   await refreshFavorites();
  }catch(e){if(active.current){setFavoriteReady(false);setFavoriteError(e.message+' 변경 여부를 다시 확인하세요.');}}
  finally{mutation.current=false;if(active.current)setFavoriteBusy(false);}
 }
 return <section className={styles.panel} aria-label="차수 및 업체 선택">
  <div className={styles.controls}>
   <label>연도<input aria-label="연도" type="number" min="2000" max="2099" value={year} disabled={busy} onChange={e=>onYear(e.target.value)}/></label>
   <fieldset className={styles.selectorField}><legend>메인차수</legend><div className={styles.buttonRow} role="group" aria-label="메인차수 선택" onKeyDown={moveFocus}>
    {selection.nearbyWeeks(week).map(w=><button key={w} type="button" aria-label={`${w}차 선택`} aria-pressed={Number(week)===w} disabled={busy} onClick={()=>onLoad(String(w))}>{w}차</button>)}
   </div></fieldset>
   <label>직접 입력<input aria-label="메인차수" type="number" min="1" max="53" value={week} disabled={busy} onChange={e=>onWeek(e.target.value)}/></label><button disabled={busy||!year||!week} onClick={()=>onLoad()}>차수 불러오기</button>
  </div>
  <fieldset className={styles.selectorField}><legend>담당자</legend><div className={styles.buttonRow} role="group" aria-label="담당자 선택" onKeyDown={moveFocus}>
   <button type="button" disabled={busy} aria-pressed={!manager} onClick={()=>onManager('')}>전체 담당자</button>
   {managers.map(m=><button type="button" key={m} aria-label={`${m} 담당자 선택`} aria-pressed={manager===m} disabled={busy} onClick={()=>onManager(m)}>{m}</button>)}
  </div></fieldset>
  <fieldset className={styles.selectorField}><legend>업체 <span className={styles.hint}>{shown.length}개</span></legend>
   <div className={styles.controls}><label>업체 검색<input aria-label="업체 검색" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} disabled={busy}/></label><p className={styles.hint}>★를 누르면 즐겨찾는 업체가 먼저 표시됩니다. 즐겨찾기는 로그인한 담당자별로 보관됩니다.</p></div>
   {favoriteLoading&&<p role="status">즐겨찾기 확인 중…</p>}
   {favoriteError&&<div role="alert" className={styles.error}>{favoriteError} <button disabled={favoriteBusy||favoriteLoading} onClick={refreshFavorites}>즐겨찾기 상태 다시 확인</button></div>}
   <div className={styles.customerButtons} role="group" aria-label="업체 선택" onKeyDown={moveFocus}>
    {shown.map(c=><div key={c.CustKey} className={styles.customerCard} data-customer-key={c.CustKey}>
     <button type="button" aria-label={`${c.CustName} 업체 선택`} aria-pressed={String(customer)===String(c.CustKey)} disabled={busy} onClick={()=>onCustomer(String(c.CustKey))}><span>{c.CustName}</span><small>{c.DetailCount}개 분배내역</small></button>
     <button type="button" className={styles.favoriteButton} aria-label={`${c.CustName} 즐겨찾기 ${favorites.has(Number(c.CustKey))?'해제':'추가'}`} aria-pressed={favorites.has(Number(c.CustKey))} disabled={busy||!favoriteReady||favoriteLoading||favoriteBusy} onClick={()=>toggleFavorite(c)}>{favorites.has(Number(c.CustKey))?'★':'☆'}</button>
    </div>)}
   </div>
   {!customers.length?<p className={styles.hint}>차수를 불러오면 담당자와 업체 버튼이 표시됩니다.</p>:!shown.length&&<p className={styles.hint}>조건에 맞는 업체가 없습니다. 담당자 또는 검색어를 확인하세요.</p>}
  </fieldset>
 </section>;
}
