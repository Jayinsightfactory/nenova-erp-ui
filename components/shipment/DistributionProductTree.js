import {useId} from 'react';
import {distributionNavigationGroups} from '../../lib/shipmentDistributionNavigation.js';
import {distributeProductName} from '../../lib/distributeProductDisplay';
export default function DistributionProductTree({rows,favoriteKeys,groupFavorites,selectedProd,activeFamily,onSelect,onFavorite,onGroupFavorite,onFamilySelect,disabled,favoritesDisabled,search,expanded,setExpanded}){
 const id=useId();const groups=distributionNavigationGroups(rows,groupFavorites,favoriteKeys);
 return <div data-testid="distribution-product-list" aria-label="품종별 품목 탐색">
  <div style={{padding:5,fontSize:11,color:'var(--text3)'}}>★ 즐겨찾기 품종·품목 우선 · 나머지는 하단 · 품종 제목으로 펼치기/접기</div>
  {!groups.length&&<p style={{padding:12,fontSize:12}}>조건에 맞는 품목이 없습니다.</p>}
  {groups.map((g,index)=>{const open=expanded[g.key]??(!!search||g.favorite||g.favoriteCount>0);return <section key={g.key} data-testid={`product-family-${g.key}`}>
   <div style={{display:'flex',alignItems:'center',gap:3,padding:'5px 4px',background:g.favorite||g.favoriteCount?'var(--blue-bg)':'var(--bg)',borderTop:'1px solid var(--border)'}}>
    <button type="button" aria-expanded={open} aria-controls={`${id}-${index}`} aria-label={`${g.country} ${g.flower} 품목 펼치기·접기`} data-ai-verify={`family-toggle-${g.key}`}
     onClick={()=>setExpanded(v=>({...v,[g.key]:!open}))} style={{flex:1,textAlign:'left',border:0,background:'transparent',fontWeight:700,color:'var(--text1)',cursor:'pointer'}}>{open?'▾':'▸'} {g.country} · {g.flower} <span style={{fontWeight:400,fontSize:11}}>({g.rows.length})</span></button>
    <button type="button" aria-label={`${g.country}${g.flower} 품종 즐겨찾기 ${g.favorite?'해제':'추가'}`} aria-pressed={g.favorite} disabled={favoritesDisabled}
     data-ai-verify={`group-fav-${g.country}${g.flower}`} onClick={e=>onGroupFavorite({...g,label:g.country+g.flower},e)} style={{color:g.favorite?'#d97706':'var(--text3)',border:'1px solid var(--border)',borderRadius:3,background:'var(--surface)'}}>{g.favorite?'★':'☆'}</button>
    <button type="button" className="btn btn-sm" aria-pressed={activeFamily===g.key} disabled={disabled} onClick={()=>onFamilySelect(g.key)} data-ai-verify={`family-scope-${g.key}`} style={{fontSize:10,padding:'2px 4px'}}>작업 품종</button>
   </div>
   {open&&<div id={`${id}-${index}`} role="group" aria-label={`${g.country} ${g.flower} 품목`}>
    <table className="tbl" style={{fontSize:12,width:'100%'}}><tbody>{g.rows.map((p,i)=><tr key={p.ProdKey} className={selectedProd?.ProdKey===p.ProdKey?'selected':''} style={{background:p.inQty>0?'var(--blue-bg)':undefined}}>
     <td style={{minWidth:180,maxWidth:240,whiteSpace:'normal',overflowWrap:'anywhere'}}>
      <button type="button" data-product-select data-ai-verify={`product-${p.ProdKey}`} aria-pressed={selectedProd?.ProdKey===p.ProdKey} aria-label={`${p.ProdName} 선택`} title={p.DisplayName||p.ProdName} disabled={disabled}
       onClick={()=>onSelect(p)} onKeyDown={e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const list=[...e.currentTarget.closest('[data-testid=distribution-product-list]').querySelectorAll('[data-product-select]:not(:disabled)')];list[Math.max(0,Math.min(list.length-1,list.indexOf(e.currentTarget)+(e.key==='ArrowDown'?1:-1)))]?.focus();}}
       style={{padding:0,border:0,background:'transparent',color:p.inQty>0?'var(--blue)':'var(--text1)',font:'inherit',textAlign:'left',cursor:'pointer'}}>{distributeProductName(p,g.flower)}</button>
      <button type="button" className="btn btn-sm" onClick={e=>onFavorite(p,e)} disabled={favoritesDisabled} aria-label={`${p.ProdName} 즐겨찾기 ${favoriteKeys.has(Number(p.ProdKey))?'해제':'추가'}`} aria-pressed={favoriteKeys.has(Number(p.ProdKey))} style={{padding:'1px 5px',marginLeft:4,color:favoriteKeys.has(Number(p.ProdKey))?'#d97706':undefined}}>{favoriteKeys.has(Number(p.ProdKey))?'★':'☆'}</button>
     </td></tr>)}</tbody></table>
   </div>}
  </section>;})}
 </div>;
}
