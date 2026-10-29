import HotelQuantityInput from './HotelQuantityInput';
import { useEffect, useRef, useState } from 'react';
import { hotelImageUrl, hotelImageRowBounds, hotelSourceBox, hotelSourcePanels, hotelBoxInRegion } from '../lib/hotelOrderReview';

export default function HotelMatchReview(props) {
  const panels=hotelSourcePanels(props.batch.rows);
  if(panels.length)return <div className="source-panels">{panels.map((panel,i)=><section key={i}><h4>{panels.length===2?(i===0?'왼쪽 표':'오른쪽 표'):`${i+1}번 표`}</h4><ReviewPanel {...props} region={panel.region} batch={{...props.batch,alignment:props.batch.alignment?.panels?.[i] || null,sourceRowCount:panel.rows.length,rows:panel.rows.map((r,index)=>({...r,sourceRowIndex:index,sourceBox:hotelBoxInRegion(r.sourceBox,panel.region)}))}} onAlign={value=>props.onAlign({...props.batch.alignment,panels:{...props.batch.alignment?.panels,[i]:value}})} onEdit={(id,v)=>props.onEdit(id,v.sourceBox?{...v,sourceBox:hotelBoxInRegion(v.sourceBox,panel.region,true)}:v)}/></section>)}<style jsx>{`.source-panels {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start}.source-panels section {min-width:0;border:1px solid #dbe4ef;padding:4px}h4 {margin:0 0 3px;font-size:12px;color:#52637b}@media(max-width:1100px){.source-panels{grid-template-columns:1fr}}`}</style></div>;
  return <ReviewPanel {...props}/>;
}
function ReviewPanel({batch,side,blocked,onEdit,onDelete,onPick,onAlign,onLocate,region}) {
  const image=hotelImageUrl(batch.imageId),[geometry,setGeometry]=useState(null);
  const root=useRef(null),imageRef=useRef(null),[active,setActive]=useState(null),[placing,setPlacing]=useState(false),[link,setLink]=useState(null);
  const activeRow=batch.rows.find(r=>r.id===active) || batch.rows[0];
  const count=batch.sourceRowCount || Math.max(batch.rows.length,...batch.rows.map(r=>(r.sourceRowIndex??-1)+1));
  function loaded(e){
    const img=e.currentTarget,[x,y,w,h]=region || [0,0,1,1],width=img.naturalWidth*w,height=img.naturalHeight*h;
    const sampleScale=Math.min(1,900/width,6000/height),canvas=document.createElement('canvas');
    canvas.width=Math.round(width*sampleScale);canvas.height=Math.round(height*sampleScale);
    let bounds=null;
    try { const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,img.naturalWidth*x,img.naturalHeight*y,width,height,0,0,canvas.width,canvas.height);bounds=hotelImageRowBounds(ctx.getImageData(0,0,canvas.width,canvas.height),count,{allowTrailingSpace:!!region}); } catch { /* Manual alignment remains available. */ }
    setGeometry({width,height,bounds});
  }

  useEffect(()=>{const img=imageRef.current;if(img?.complete && img.naturalWidth)loaded({currentTarget:img});},[image,count,JSON.stringify(region)]);
  const automatic=geometry?.bounds?.map(y=>y*geometry.height);
  const top=batch.alignment?.top ?? automatic?.[0] ?? 0, step=batch.alignment?.step ?? (automatic ? (automatic.at(-1)-automatic[0])/count : 30);
  const bounds=Number.isFinite(batch.alignment?.top) || !automatic ? Array.from({length:count+1},(_,i)=>top+step*i) : automatic;
  const scale=geometry ? 30/Math.min(...bounds.slice(1).map((y,i)=>y-bounds[i])) : 1;
  const aligned=!!image && !!geometry && (!!automatic || Number.isFinite(batch.alignment?.top)), first=top*scale, imageOffset=Math.max(0,28-first);
  const activeIndex=activeRow?.sourceRowIndex ?? batch.rows.findIndex(r=>r.id===activeRow?.id);
  const activeBox=aligned && bounds[activeIndex+1]!==undefined ? [0,bounds[activeIndex]/geometry.height,1,(bounds[activeIndex+1]-bounds[activeIndex])/geometry.height] : hotelSourceBox(activeRow?.sourceBox);
  useEffect(()=>{
    function measure(){
      const host=root.current,img=imageRef.current,row=[...(host?.querySelectorAll("[data-source-row]")||[])].find(el=>el.dataset.sourceRow===activeRow?.id);
      if(!host||!img||!row||!activeBox){setLink(null);return;}
      const a=host.getBoundingClientRect(),b=(img.closest(".image-crop")||img).getBoundingClientRect(),c=row.getBoundingClientRect(),[x,y,w,h]=activeBox;
      setLink({x:b.left-a.left+x*b.width,y:b.top-a.top+y*b.height,w:w*b.width,h:h*b.height,toX:c.left-a.left,toY:c.top-a.top+c.height/2});
    }
    measure();const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);if(imageRef.current)observer.observe(imageRef.current);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[activeRow?.id,JSON.stringify(activeBox),geometry,batch.rows.length]);
  let previous=0;
  return <section className="comparison">
    {image && !region && <div className="link-tools">{onLocate && batch.rows.some(r=>!hotelSourceBox(r.sourceBox)) && <button data-tone="match" disabled={blocked} onClick={onLocate}>원본 위치 다시 읽기</button>}<span>행에 마우스를 올리면 원본 위치와 선으로 연결됩니다.</span><button disabled={blocked || !activeRow} aria-pressed={placing} onClick={()=>setPlacing(!placing)}>{placing ? '원본에서 해당 품목을 클릭하세요 · 취소' : '선택 행 원본 위치 지정'}</button>{activeRow && <span>선택: {activeRow.inputName}</span>}{!activeBox && <span>위치 정보가 없으면 원본 위치를 지정하세요.</span>}</div>}
    {image && <div className="tools"><a href={image} target="_blank" rel="noreferrer">원본 크게 보기</a><details><summary>줄 위치 조정{geometry && !automatic && !batch.alignment ? ' · 자동 맞춤 불가' : ''}</summary><fieldset disabled={blocked}>
      <label>첫 줄 위치 <input aria-label="원본 첫 줄 위치" type="number" min="0" value={Math.round(top)} onChange={e=>onAlign({top:Math.max(0,Number(e.target.value)),step})}/></label>
      <label>줄 간격 <input aria-label="원본 줄 간격" type="number" min="8" value={Math.round(step)} onChange={e=>onAlign({top,step:Math.max(8,Number(e.target.value))})}/></label><button onClick={()=>onAlign(null)}>자동 맞춤</button>
    </fieldset></details></div>}
    <div className="compare-scroll"><div ref={root} className={`compare-grid ${image ? 'with-image' : ''}`} data-row-aligned={aligned ? "true" : "false"}>
      {(image || batch.text) && <div className="source" style={aligned ? {paddingTop:imageOffset} : undefined}>{image ? <div className="image-crop" style={aligned ? {height:geometry.height*scale} : region&&geometry?{aspectRatio:`${geometry.width}/${geometry.height}`} : undefined}><img ref={imageRef} className={placing?'placing':''} onClick={e=>{if(!placing||blocked||!activeRow)return;const r=(e.currentTarget.closest(".image-crop")||e.currentTarget).getBoundingClientRect(),x=Math.max(0,Math.min(.98,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(.98,(e.clientY-r.top)/r.height));onEdit(activeRow.id,{sourceBox:[Math.max(0,x-.12),Math.max(0,y-.015),Math.min(.24,1-Math.max(0,x-.12)),Math.min(.03,1-Math.max(0,y-.015))]});setPlacing(false);}} style={region?{height:aligned?geometry.height*scale/region[3]:undefined,width:`${100/region[2]}%`,maxWidth:"none",position:"absolute",left:`${-region[0]/region[2]*100}%`,top:`${-region[1]/region[3]*100}%`}:aligned?{height:geometry.height*scale}:undefined} src={image} alt={`${side==='request'?'요청':'발주'} 업로드 원본`} onLoad={loaded}/></div> : <pre>{batch.text}</pre>}</div>}
      <fieldset className="matches" disabled={blocked} style={aligned ? {paddingTop:Math.max(0,first-28)} : undefined}><table aria-label="원본 대조 매칭표"><thead><tr><th>매칭 품목</th><th>수량</th><th>단위</th><th><span className="sr-only">삭제</span></th></tr></thead><tbody>
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
      .compare-scroll {overflow:auto}.compare-grid {position:relative;display:grid;grid-template-columns:minmax(160px,44%) minmax(300px,1fr);gap:4px;align-items:start}.compare-grid:not(:has(.source)) {grid-template-columns:minmax(300px,1fr)}
      .source {min-width:0}.image-crop {position:relative;overflow:hidden;width:100%} img {display:block;width:100%;height:auto;margin:0} pre {white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#f5f7fa;padding:10px;margin:0}
      .matches {border:0;padding:0;margin:0;min-width:300px} table {border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;margin:0} thead tr {height:28px} th {height:28px;box-sizing:border-box;padding:0 3px;text-align:left;background:#edf3fa;white-space:nowrap} th:nth-child(2) {width:98px} th:nth-child(3) {width:66px} th:nth-child(4) {width:28px}
      .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
    `}</style>
  </section>;
}
function Rows({row:r,gap,height,onPick,onEdit,onDelete,selected,onActivate}) {
  const warning=r.specialName ? '' : r.matchWarning || (!r.prodKey ? '매칭 필요' : '');
  return <>{gap>0 && <tr aria-hidden="true" style={{height:gap}}><td colSpan={4} className="gap"/></tr>}<tr data-source-row={r.id} className={selected?'selected':''} onMouseEnter={onActivate} onFocus={onActivate} style={{height}}>
    <td><div className="product"><button data-tone="match" id={`match-${r.id}`} title={warning || r.inputName} aria-label={`${r.inputName} 품목 매칭`} onClick={onPick}>{r.specialName ? `특수 · ${r.specialName}` : r.prodName || r.displayName || '품목 선택'}</button>{warning && <span className="warning" role="img" aria-label={warning} title={warning}>!</span>}</div></td>
    <td><HotelQuantityInput label={`${r.inputName} 수량`} title={`원본 ${r.originalQty ?? r.qty} ${r.originalUnit || r.unit}`} value={r.qty} onCommit={qty=>onEdit({qty})}/></td>
    <td><select aria-label={`${r.inputName} 단위`} value={r.unit || ''} onChange={e=>onEdit({unit:e.target.value})}><option value="">선택</option>{['박스','단','송이','대','개'].map(u=><option key={u}>{u}</option>)}</select></td>
    <td><button data-tone="danger" aria-label={`${r.inputName} 삭제`} title="행 삭제" onClick={onDelete}>×</button></td>
  </tr><style jsx>{`
    tr.selected td {background:#edf4ff} td {padding:0 2px;border-bottom:1px solid #dfe5ed;vertical-align:middle;box-sizing:border-box}.gap {padding:0;border:0}
    .product {display:flex;align-items:center;gap:4px;min-width:0}.product button {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;text-align:left}.warning {flex:none;background:#fff0cf;color:#a34e00;border-radius:50%;width:18px;height:18px;text-align:center;font-size:12px;font-weight:700}
    input,select {width:100%;height:26px;box-sizing:border-box;border:1px solid #bac8db;border-radius:6px;padding:2px 4px;font:inherit;background:white;color:#17243c} button {margin:0;min-height:26px!important;height:26px!important;max-height:26px;padding:2px 7px!important;font-size:12px!important;line-height:20px!important} :focus-visible {outline:3px solid #2871dd;outline-offset:1px}
  `}</style></>;
}
