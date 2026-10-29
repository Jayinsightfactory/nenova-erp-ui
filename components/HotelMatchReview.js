import { useEffect, useRef, useState } from 'react';
import { hotelImageUrl, hotelImageRowBounds, hotelSourceBox } from '../lib/hotelOrderReview';

export default function HotelMatchReview({batch,side,blocked,onEdit,onDelete,onPick,onAlign}) {
  const image=hotelImageUrl(batch.imageId),[geometry,setGeometry]=useState(null);
  const root=useRef(null),imageRef=useRef(null),[active,setActive]=useState(null),[placing,setPlacing]=useState(false),[link,setLink]=useState(null);
  const activeRow=batch.rows.find(r=>r.id===active) || batch.rows[0];
  const activeBox=hotelSourceBox(activeRow?.sourceBox);
  useEffect(()=>{
    function measure(){
      const host=root.current,img=imageRef.current,row=[...(host?.querySelectorAll("[data-source-row]")||[])].find(el=>el.dataset.sourceRow===activeRow?.id);
      if(!host||!img||!row||!activeBox){setLink(null);return;}
      const a=host.getBoundingClientRect(),b=img.getBoundingClientRect(),c=row.getBoundingClientRect(),[x,y,w,h]=activeBox;
      setLink({x:b.left-a.left+x*b.width,y:b.top-a.top+y*b.height,w:w*b.width,h:h*b.height,toX:c.left-a.left,toY:c.top-a.top+c.height/2});
    }
    measure();const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);if(imageRef.current)observer.observe(imageRef.current);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[activeRow?.id,JSON.stringify(activeBox),geometry,batch.rows.length]);
  const count=batch.sourceRowCount || Math.max(batch.rows.length,...batch.rows.map(r=>(r.sourceRowIndex??-1)+1));
  function loaded(e){
    const img=e.currentTarget,scale=Math.min(1,900/img.naturalWidth,6000/img.naturalHeight),canvas=document.createElement('canvas');
    canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
    let bounds=null;
    try { const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);bounds=hotelImageRowBounds(ctx.getImageData(0,0,canvas.width,canvas.height),count); } catch { /* Manual alignment remains available. */ }
    setGeometry({width:img.naturalWidth,height:img.naturalHeight,bounds});
  }
  const automatic=geometry?.bounds?.map(y=>y*geometry.height);
  const top=batch.alignment?.top ?? automatic?.[0] ?? 0, step=batch.alignment?.step ?? (automatic ? (automatic.at(-1)-automatic[0])/count : 30);
  const bounds=batch.alignment || !automatic ? Array.from({length:count+1},(_,i)=>top+step*i) : automatic;
  const scale=geometry ? Math.max(Math.min(560/geometry.width,1),30/Math.min(...bounds.slice(1).map((y,i)=>y-bounds[i]))) : 1;
  const aligned=!!image && !!geometry && (!!automatic || !!batch.alignment) && !batch.rows.some(r=>hotelSourceBox(r.sourceBox)), first=top*scale, imageOffset=Math.max(0,36-first);
  let previous=0;
  return <section className="comparison">
    {image && <div className="link-tools"><span>행에 마우스를 올리면 원본 위치와 선으로 연결됩니다.</span><button disabled={blocked || !activeRow} aria-pressed={placing} onClick={()=>setPlacing(!placing)}>{placing ? '원본에서 해당 품목을 클릭하세요 · 취소' : '선택 행 원본 위치 지정'}</button>{activeRow && <span>선택: {activeRow.inputName}</span>}{!activeBox && <span>위치 정보가 없으면 원본 위치를 지정하세요.</span>}</div>}
    {image && <div className="tools"><a href={image} target="_blank" rel="noreferrer">원본 크게 보기</a><details><summary>줄 위치 조정{geometry && !automatic && !batch.alignment && !batch.rows.some(r=>hotelSourceBox(r.sourceBox)) ? ' · 자동 맞춤 불가' : ''}</summary><fieldset disabled={blocked}>
      <label>첫 줄 위치 <input aria-label="원본 첫 줄 위치" type="number" min="0" value={Math.round(top)} onChange={e=>onAlign({top:Math.max(0,Number(e.target.value)),step})}/></label>
      <label>줄 간격 <input aria-label="원본 줄 간격" type="number" min="8" value={Math.round(step)} onChange={e=>onAlign({top,step:Math.max(8,Number(e.target.value))})}/></label><button onClick={()=>onAlign(null)}>자동 맞춤</button>
    </fieldset></details></div>}
    <div className="compare-scroll"><div ref={root} className={`compare-grid ${image ? 'with-image' : ''}`} style={aligned ? {gridTemplateColumns:`${Math.ceil(geometry.width*scale)}px minmax(440px,1fr)`} : undefined}>
      {(image || batch.text) && <div className="source" style={aligned ? {paddingTop:imageOffset} : undefined}>{image ? <img ref={imageRef} className={placing?'placing':''} onClick={e=>{if(!placing||blocked||!activeRow)return;const r=e.currentTarget.getBoundingClientRect(),x=Math.max(0,Math.min(.98,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(.98,(e.clientY-r.top)/r.height));onEdit(activeRow.id,{sourceBox:[Math.max(0,x-.12),Math.max(0,y-.015),Math.min(.24,1-Math.max(0,x-.12)),Math.min(.03,1-Math.max(0,y-.015))]});setPlacing(false);}} src={image} alt={`${side==='request'?'요청':'발주'} 업로드 원본`} onLoad={loaded}/> : <pre>{batch.text}</pre>}</div>}
      <fieldset className="matches" disabled={blocked} style={aligned ? {paddingTop:Math.max(0,first-36)} : undefined}><table aria-label="원본 대조 매칭표"><thead><tr><th>매칭 품목</th><th>수량</th><th>단위</th><th><span className="sr-only">삭제</span></th></tr></thead><tbody>
      {batch.rows.map((r,i)=>{
        const index=r.sourceRowIndex ?? i, start=aligned ? (bounds[index]??top+step*index)*scale : 0;
        const height=aligned ? ((bounds[index+1]??top+step*(index+1))-(bounds[index]??top+step*index))*scale : 30;
        const gap=aligned ? Math.max(0,start-first-previous) : 0;previous=start-first+height;
        return <Rows key={r.id} gap={gap} height={height} row={r} selected={activeRow?.id===r.id} onActivate={()=>setActive(r.id)} onPick={()=>onPick(r)} onEdit={v=>onEdit(r.id,v)} onDelete={()=>onDelete(r.id)}/>;
      })}</tbody></table></fieldset>
    {link && <svg className="source-link" aria-hidden="true"><rect x={link.x} y={link.y} width={link.w} height={link.h} rx="2"/><path d={`M ${link.x+link.w} ${link.y+link.h/2} C ${link.x+link.w+36} ${link.y+link.h/2}, ${link.toX-36} ${link.toY}, ${link.toX} ${link.toY}`}/><circle cx={link.toX} cy={link.toY} r="3"/></svg>}
    </div></div>
    <style jsx>{`
      .comparison {min-width:0}.link-tools {display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;margin:0 0 4px;color:#52637b}.link-tools button {font-size:12px}.source-link {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1}.source-link path {stroke:#1763e8;stroke-width:2;fill:none}.source-link rect {stroke:#1763e8;stroke-width:1.5;fill:#1763e820}.source-link circle {fill:#1763e8}.placing {cursor:crosshair}.tools {display:flex;align-items:center;gap:16px;margin-bottom:4px;font-size:13px}.tools details {position:relative}.tools fieldset {position:absolute;z-index:2;left:0;background:white;box-shadow:0 3px 15px #0002;min-width:300px} .tools label {display:inline-flex;align-items:center;gap:6px} .tools input {width:65px} summary {cursor:pointer}
      .compare-scroll {overflow:auto}.compare-grid {position:relative;display:grid;grid-template-columns:minmax(220px,52%) minmax(440px,1fr);gap:10px;align-items:start}.compare-grid:not(:has(.source)) {grid-template-columns:minmax(440px,1fr)}
      .source {min-width:0} img {display:block;width:100%;height:auto;margin:0} pre {white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#f5f7fa;padding:10px;margin:0}
      .matches {border:0;padding:0;margin:0;min-width:440px} table {border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;margin:0} thead tr {height:36px} th {height:36px;box-sizing:border-box;padding:0 6px;text-align:left;background:#edf3fa;white-space:nowrap} th:nth-child(2) {width:88px} th:nth-child(3) {width:76px} th:nth-child(4) {width:40px}
      .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
    `}</style>
  </section>;
}
function Rows({row:r,gap,height,onPick,onEdit,onDelete,selected,onActivate}) {
  const warning=r.matchWarning || (!r.prodKey ? '매칭 필요' : '');
  return <>{gap>0 && <tr aria-hidden="true" style={{height:gap}}><td colSpan={4} className="gap"/></tr>}<tr data-source-row={r.id} className={selected?'selected':''} onMouseEnter={onActivate} onFocus={onActivate} style={{height}}>
    <td><div className="product"><button data-tone="match" id={`match-${r.id}`} title={warning || r.inputName} aria-label={`${r.inputName} 품목 매칭`} onClick={onPick}>{r.prodName || r.displayName || '품목 선택'}</button>{warning && <span className="warning" role="img" aria-label={warning} title={warning}>!</span>}</div></td>
    <td><input aria-label={`${r.inputName} 수량`} title={`원본 ${r.originalQty ?? r.qty} ${r.originalUnit || r.unit}`} type="number" min="0" step="any" value={r.qty} onChange={e=>onEdit({qty:e.target.value})}/></td>
    <td><select aria-label={`${r.inputName} 단위`} value={r.unit || ''} onChange={e=>onEdit({unit:e.target.value})}><option value="">선택</option>{['박스','단','송이','대','개'].map(u=><option key={u}>{u}</option>)}</select></td>
    <td><button data-tone="danger" aria-label={`${r.inputName} 삭제`} title="행 삭제" onClick={onDelete}>×</button></td>
  </tr><style jsx>{`
    tr.selected td {background:#edf4ff} td {padding:0 4px;border-bottom:1px solid #dfe5ed;vertical-align:middle;box-sizing:border-box}.gap {padding:0;border:0}
    .product {display:flex;align-items:center;gap:4px;min-width:0}.product button {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;text-align:left}.warning {flex:none;background:#fff0cf;color:#a34e00;border-radius:50%;width:18px;height:18px;text-align:center;font-size:12px;font-weight:700}
    input,select {width:100%;height:26px;box-sizing:border-box;border:1px solid #bac8db;border-radius:6px;padding:2px 4px;font:inherit;background:white;color:#17243c} button {margin:0;min-height:26px!important;height:26px!important;max-height:26px;padding:2px 7px!important;font-size:12px!important;line-height:20px!important} :focus-visible {outline:3px solid #2871dd;outline-offset:1px}
  `}</style></>;
}
