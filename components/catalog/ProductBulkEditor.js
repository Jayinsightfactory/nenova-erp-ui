import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/router';
import {PRODUCT_BULK_FIELDS as fields,rectangleCells,displayProductValue,buildProductChanges,productAfterValues,parseProductInput} from '../../lib/productBulkEdit';
import styles from '../../styles/ProductBulkEditor.module.css';

export default function ProductBulkEditor({rows,products,onSaved,onClose,onDirtyChange}){
  const [drafts,setDrafts]=useState({}),[range,setRange]=useState(null),[inputs,setInputs]=useState({});
  const [editing,setEditing]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[notice,setNotice]=useState('');
  const dragging=useRef(false),table=useRef(null),router=useRouter();
  const signature=rows.map(r=>r.ProdKey).join(',');
  let changes=[],validation='';
  try{changes=buildProductChanges(products,drafts);if(changes.length>500)validation='한 번에 최대 500품목씩 저장하세요. 국가·품종으로 범위를 좁혀 입력해 주세요.';}catch(e){validation=e.message;}
  const dirty=Object.values(drafts).some(values=>Object.values(values).some(v=>String(v).trim()!==''));
  useEffect(()=>{setRange(null);setEditing(null);dragging.current=false;},[signature]);
  useEffect(()=>{onDirtyChange?.(dirty||busy);return()=>onDirtyChange?.(false);},[dirty,busy,onDirtyChange]);
  useEffect(()=>{
    const stop=()=>{dragging.current=false;};window.addEventListener('pointerup',stop);window.addEventListener('blur',stop);
    return()=>{window.removeEventListener('pointerup',stop);window.removeEventListener('blur',stop);};
  },[]);
  useEffect(()=>{
    if(!dirty&&!busy)return;
    const unload=e=>{e.preventDefault();e.returnValue='';};
    const route=()=>{if(busy||!window.confirm('저장하지 않은 품목 입력을 버리고 이동할까요?')){router.events.emit('routeChangeError');throw Error('품목 입력 보존');}};
    window.addEventListener('beforeunload',unload);router.events.on('routeChangeStart',route);
    return()=>{window.removeEventListener('beforeunload',unload);router.events.off('routeChangeStart',route);};
  },[dirty,busy,router]);
  const cells=rectangleCells(rows,range),selected=new Set(cells.map(c=>`${c.prodKey}:${c.key}`));
  function edit(prodKey,key,value){setDrafts(d=>({...d,[prodKey]:{...d[prodKey],[key]:value}}));setReview(false);setNotice('');}
  function apply(){
    try{
      if(!cells.length)throw Error('먼저 표의 셀을 드래그해서 선택하세요.');
      const applicable=cells.filter(c=>String(inputs[c.key]??'').trim()!=='');
      if(!applicable.length)throw Error('선택한 열의 입력칸에 값을 입력하세요.');
      applicable.forEach(c=>parseProductInput(c.key,inputs[c.key]));
      setDrafts(d=>{const next={...d};for(const c of applicable)next[c.prodKey]={...next[c.prodKey],[c.key]:inputs[c.key]};return next;});
      setReview(false);setError('');setNotice(`${applicable.length}개 셀에 입력했습니다. 아직 저장 전입니다.`);
    }catch(e){setError(e.message);}
  }
  function keyboard(e,row,col){
    if(e.key==='Escape'){setRange(null);return;}
    if(e.key==='Enter'||/^\d$/.test(e.key)){
      e.preventDefault();setEditing({prodKey:rows[row].ProdKey,key:fields[col].key});
      if(/^\d$/.test(e.key))edit(rows[row].ProdKey,fields[col].key,e.key);return;
    }
    const delta={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];
    if(!delta)return;e.preventDefault();
    const next={row:Math.max(0,Math.min(rows.length-1,row+delta[0])),col:Math.max(0,Math.min(fields.length-1,col+delta[1]))};
    setRange(r=>[e.shiftKey&&r?r[0]:next,next]);
    table.current?.querySelector(`[data-cell="${next.row}-${next.col}"]`)?.focus();
  }
  async function save(){
    if(busy||validation||!changes.length)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/master/products-bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})});
      const data=await response.json();
      if(!response.ok||!data.success)throw Error(data.error||'저장 결과를 확인할 수 없습니다. 다시 조회 후 확인하세요.');
      onSaved(data.saved);setDrafts({});setReview(false);setRange(null);setNotice(`${data.verifiedCount}개 품목 저장 및 대조 완료`);
    }catch(e){setError(`${e.message} 자동 재시도하지 않았습니다.`);}finally{setBusy(false);}
  }
  return <section className={styles.editor} aria-label="품목 기본값 일괄 입력" aria-busy={busy}>
    <div className={styles.heading}><div><strong>영역 선택 → 값 입력 → 변경 확인 → 저장</strong><p>셀을 드래그하거나 Shift+방향키로 선택하세요. 셀 더블클릭 또는 Enter로 개별 입력할 수도 있습니다.</p></div><button type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 입력을 버리고 닫을까요?'))onClose();}}>일괄 입력 닫기</button></div>
    <div className={styles.toolbar}>
      {fields.map(f=><label key={f.key}>{f.label}<input aria-label={`${f.label} 일괄 입력`} disabled={busy} inputMode="decimal" placeholder="변경 없으면 빈칸" value={inputs[f.key]??''} onChange={e=>setInputs({...inputs,[f.key]:e.target.value})}/></label>)}
      <button type="button" disabled={busy||!cells.length} onClick={apply}>선택 영역에 입력</button>
      <button type="button" disabled={busy||!rows.length} onClick={()=>setRange([{row:0,col:0},{row:rows.length-1,col:fields.length-1}])}>현재 목록 전체 선택</button>
      <button type="button" disabled={busy||!changes.length||!!validation} onClick={()=>{setReview(true);setError('');}}>변경 확인 · {changes.length}개 저장</button>
      <button type="button" disabled={busy||!dirty} onClick={()=>{if(window.confirm('입력한 변경값을 모두 취소할까요?')){setDrafts({});setReview(false);setError('');}}}>입력 취소</button>
    </div>
    <p className={styles.hint}>빈 입력칸은 기존 값 유지 · 0은 0으로 변경 · 1박스송이는 독립 입력(자동 곱셈 없음) · 관세 25 입력 = 25% · 최대 500품목씩 저장</p>
    <p role="status">현재 목록 {rows.length}개 · 선택 {cells.length}셀 · 저장 전 변경 {changes.length}품목 {notice&&`· ${notice}`}</p>
    {(error||validation)&&<p role="alert" className={styles.error}>{error||validation}</p>}
    {review&&<section className={styles.review} aria-label="저장 전 변경 확인">
      <strong>아래 {changes.length}개 품목을 최종값으로 저장합니다.</strong>
      <p>필터로 숨겨진 입력도 아래에 모두 표시합니다. 기존 주문·입고·출고·재고 수량은 바꾸지 않습니다. 이후 작업의 단위 환산과 원가 계산에는 바뀐 기본값이 사용됩니다.</p>
      <button type="button" disabled={busy} onClick={save}>{busy?'저장하고 전산값 대조 중…':'확인한 변경값 저장'}</button>
      <button type="button" disabled={busy} onClick={()=>setReview(false)}>계속 수정</button>
      <ul>{changes.map(c=>{const p=products.find(p=>p.ProdKey===c.prodKey),after=productAfterValues(c.expected,c.values);return <li key={c.prodKey}><b>{p?.ProdName}</b> — {Object.keys(c.values).map(k=>`${fields.find(f=>f.key===k).label}: ${displayProductValue(k,c.expected[k])||'빈칸'} → ${displayProductValue(k,c.values[k])}`).join(' / ')}{after.SteamOf1Box!==c.expected.SteamOf1Box&&` / 1박스 송이수: ${c.expected.SteamOf1Box??'빈칸'} → ${after.SteamOf1Box}`}</li>;})}</ul>
    </section>}
    <div className={styles.tableWrap}><table ref={table} className={styles.table} aria-label="품목 기본값 편집 표"><thead><tr><th>국가 · 품종</th><th>품목</th>{fields.map(f=><th key={f.key}>{f.label}</th>)}</tr></thead>
      <tbody>{rows.map((p,row)=><tr key={p.ProdKey}><td>{p.CounName} · {p.FlowerName}</td><th scope="row">{p.ProdName}</th>{fields.map((f,col)=>{
        const draft=drafts[p.ProdKey]?.[f.key],active=selected.has(`${p.ProdKey}:${f.key}`),isEditing=editing?.prodKey===p.ProdKey&&editing.key===f.key;
        return <td key={f.key} className={`${active?styles.selected:''} ${String(draft??'').trim()!==''?styles.changed:''}`} onPointerEnter={e=>{if(dragging.current&&(e.buttons&1))setRange(r=>r?[r[0],{row,col}]:null);}}>
          {isEditing?<input autoFocus aria-label={`${p.ProdName} ${f.label}`} inputMode="decimal" disabled={busy} value={draft??displayProductValue(f.key,p[f.key])} onChange={e=>edit(p.ProdKey,f.key,e.target.value)} onBlur={()=>setEditing(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();setEditing(null);}}}/>:<button type="button" data-cell={`${row}-${col}`} disabled={busy} aria-label={`${p.ProdName} ${f.label}: ${(draft??displayProductValue(f.key,p[f.key]))||'빈칸'}`} aria-pressed={active}
            onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();dragging.current=true;setRange(r=>[e.shiftKey&&r?r[0]:{row,col},{row,col}]);}}
            onClick={e=>{if(e.detail===0)setRange([{row,col},{row,col}]);}}
            onDoubleClick={()=>setEditing({prodKey:p.ProdKey,key:f.key})} onKeyDown={e=>keyboard(e,row,col)}>{(draft??displayProductValue(f.key,p[f.key]))||'—'}</button>}
        </td>;
      })}</tr>)}</tbody></table>{!rows.length&&<p>현재 필터에 맞는 품목이 없습니다.</p>}</div>
  </section>;
}
