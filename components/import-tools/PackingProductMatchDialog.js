import React, {useEffect,useMemo,useRef,useState} from 'react';
import {scoreProductSearchOptions} from '../../lib/productSearchRanking.js';
import {PACKING_COUNTRIES} from '../../lib/importPackingErpMatches.js';
import styles from '../../styles/PackingProductMatch.module.css';

export default function PackingProductMatchDialog({target,country,products,matchEntries=[],onSave,onClose,onReload,saving,error}) {
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState(null);
  const root=useRef(null), searchRef=useRef(null), opener=useRef(null);
  const available=useMemo(()=>products.filter(p=>p.country===country).map(p=>({...p,
    MappingAliases:[...(p.MappingAliases||[]),...matchEntries.filter(e=>e.country===country&&e.prodKey===p.ProdKey&&e.prodName===p.ProdName&&p.selectable).map(e=>e.description)],
  })),[products,country,matchEntries]);
  const candidates=useMemo(()=>scoreProductSearchOptions(search.trim()||target.description,available,{packingSuggestions:true}),[available,search,target.description]);
  const validSelected=available.find(p=>p.ProdKey===selected&&p.selectable);
  const selectionWarning=target.requiresReload
    ? '전산·매칭 다시 조회 후 선택 재확인'
    : selected!==null&&!validSelected
      ? '선택한 품목이 최신 목록에서 삭제되었거나, 국가가 다르거나, 선택할 수 없는 상태입니다. 전산·매칭 다시 조회 후 유효한 품목을 다시 선택하세요.'
      : '';
  useEffect(()=>{setSelected(null);setSearch('');},[target.description,country]);
  useEffect(()=>{
    opener.current=document.activeElement;
    searchRef.current?.focus();
    return ()=>{if(opener.current?.isConnected)opener.current.focus();};
  },[]);
  useEffect(()=>{if(saving)root.current?.focus();},[saving]);
  const keyboard=e=>{
    if(e.isComposing||e.nativeEvent?.isComposing)return;
    if(e.key==='Escape') {e.preventDefault();if(!saving)onClose();return;}
    if(e.key==='Tab') {
      const nodes=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
      if(!nodes.length){e.preventDefault();root.current?.focus();return;}
      const first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    if(['ArrowDown','ArrowUp'].includes(e.key)&&(e.target===searchRef.current||e.target.dataset.candidate)) {
      const nodes=[...root.current.querySelectorAll('[data-candidate]:not(:disabled)')];
      const index=nodes.indexOf(document.activeElement);
      const next=index<0?0:Math.max(0,Math.min(nodes.length-1,index+(e.key==='ArrowDown'?1:-1)));
      e.preventDefault();nodes[next]?.focus();
    }
  };
  return <div className={styles.overlay} onKeyDown={keyboard}>
    <section ref={root} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-busy={saving} aria-labelledby="packing-match-title" data-testid="packing-match-dialog">
      <header><h2 id="packing-match-title">전산 품목 검색 · 매칭</h2><button type="button" onClick={onClose} disabled={saving} aria-label="품목 매칭 닫기">닫기</button></header>
      <p className={styles.source} title={target.description}>원문: <strong>{target.description}</strong></p>
      <p className={styles.hint}>{PACKING_COUNTRIES[country]} 활성 전산 품목 · {search.trim()?'입력 검색어 기준':'원문 기준'} 추천이며 확정된 매칭이 아닙니다. 이름·길이·숫자를 확인하고 직접 선택하세요. 선택한 연결은 팀 공동 저장됩니다. 주문·입고·재고는 변경하지 않습니다.</p>
      <input ref={searchRef} className={styles.search} aria-label="전산 품목 검색" placeholder="품목명 · 코드 · 꽃 이름 검색 (↓ 후보 이동, Enter 선택)" value={search} onChange={e=>setSearch(e.target.value)} disabled={saving}/>
      <div className={styles.list} role="region" aria-label="전산 품목 검색 결과">
        {candidates.length===0&&<p>검색 결과가 없습니다. 검색어를 줄이거나 전산 품목을 다시 불러오세요.</p>}
        {candidates.map(({option:p,suggestion})=><button type="button" key={p.ProdKey} data-candidate={p.ProdKey} disabled={saving||!p.selectable} aria-pressed={selected===p.ProdKey} className={styles.candidate} onClick={()=>setSelected(p.ProdKey)} title={p.reason||p.ProdName}>
          <strong>{p.ProdName}</strong><span>{p.FlowerName} · {p.ProdCode||`번호 ${p.ProdKey}`} · {suggestion?.reason}{!p.selectable&&` · ${p.reason}`}</span>
        </button>)}
      </div>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      {selectionWarning&&<p role="alert" className={styles.error}>{selectionWarning}</p>}
      <footer><button type="button" disabled={saving} onClick={async()=>{setSelected(null);await onReload();}}>전산·매칭 다시 조회</button><span>{validSelected?.ProdName||'품목을 선택하세요'}</span><button type="button" data-testid="packing-match-save" disabled={saving||target.requiresReload||!validSelected} onClick={()=>{if(!saving&&!target.requiresReload&&validSelected)onSave(validSelected.ProdKey);}}>{saving?'저장 중…':'선택 품목 매칭 · 저장'}</button></footer>
    </section>
  </div>;
}
