import { hotelConvert, hotelQty } from './hotelOrderWorkspace.js';

export function hotelSourceBox(value) {
  if(!Array.isArray(value) || value.length!==4 || value.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  const [x,y,w,h]=value;
  return x>=0 && y>=0 && w>0 && h>0 && x+w<=1.001 && y+h<=1.001 ? [x,y,Math.min(w,1-x),Math.min(h,1-y)] : null;
}

export function hotelSourcePanels(rows) {
  const located=rows.map(row=>({row,box:hotelSourceBox(row.sourceBox)}));
  if(located.some(r=>!r.box))return [];
  const groups=[];
  for(const entry of [...located].sort((a,b)=>a.box[0]-b.box[0])) {
    let g=groups.at(-1);
    if(!g || entry.box[0]>g.right+.025){g={left:entry.box[0],right:entry.box[0]+entry.box[2],entries:[]};groups.push(g);}
    g.right=Math.max(g.right,entry.box[0]+entry.box[2]);g.entries.push(entry);
  }
  if(groups.length<2 || groups.length>4)return [];
  return groups.map(g=>{
    // Vision row boxes can be approximate. Keep the full vertical source so no
    // original rows disappear when an OCR box is too short or misplaced.
    const x=Math.max(0,g.left-.01),y=0,right=Math.min(1,g.right+.01),bottom=1;
    return {region:[x,y,right-x,bottom-y],rows:rows.filter(r=>g.entries.some(e=>e.row.id===r.id))};
  });
}
export function hotelBoxInRegion(box,region,inverse=false) {
  const value=hotelSourceBox(box);if(!value)return null;const [x,y,w,h]=region;
  return inverse ? hotelSourceBox([x+value[0]*w,y+value[1]*h,value[2]*w,value[3]*h]) : hotelSourceBox([(value[0]-x)/w,(value[1]-y)/h,value[2]/w,value[3]/h]);
}
export const hotelImageUrl = id => /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(String(id || '')) ? `/api/sales/hotel-order-images?id=${id}` : '';
export function hotelSavedBatches(work, side) {
  const lines=work[side] || [], batches=work.batches?.[side] || [];
  const known=new Set(batches.map(b=>b.id));
  const legacy=lines.filter(r=>!known.has(r.batchId));
  return [...(legacy.length ? [{id:'legacy',number:1,source:'기존 저장 자료',rows:legacy}] : []), ...batches.map(b=>({...b,rows:lines.filter(r=>r.batchId===b.id)}))];
}
export function hotelNextBatchNumber(work, side) {
  return Math.max(0,...hotelSavedBatches(work,side).map(b=>Number(b.number)||0))+1;
}
export function commitHotelReview(work, side, savedAt) {
  if (!['request','purchase'].includes(side) || work.frozen) throw Error('저장할 수 없는 작업입니다.');
  const review=work.pending?.[side];
  if (!review?.id || !review.rows?.length) throw Error('먼저 자료를 업로드하고 매칭 결과를 확인하세요.');
  const batches=work.batches?.[side] || [];
  if (batches.some(b=>b.id===review.id)) return work;
  if (review.rows.some(r=>r.qty==='' || !Number.isFinite(Number(r.qty)) || Number(r.qty)<0 || !r.unit)) throw Error('수량과 단위를 확인하세요.');
  const {rows,...source}=review;
  return {...work,[side]:[...(work[side]||[]),...rows.map(r=>({...r,batchId:review.id}))],allocations:{},
    pending:{...work.pending,[side]:null},batches:{...work.batches,[side]:[...batches,{...source,number:hotelNextBatchNumber(work,side),savedAt}]}};
}

export function hotelBatchMatrix(work, side, products) {
  const batches=hotelSavedBatches(work,side), grouped=new Map();
  for(const batch of batches) for(const line of batch.rows) {
    const product=products[Number(line.prodKey)];
    let qty,unit=product?.OutUnit || line.unit,error='';
    try { qty=hotelConvert(line.qty,line.unit,unit,product || {}); } catch(e) { qty=null;error=e.message; }
    const key=product ? `p:${Number(line.prodKey)}` : `r:${line.id}`;
    if(!grouped.has(key))grouped.set(key,{key,name:product?.DisplayName || product?.ProdName || line.prodName || line.inputName,unit,cells:{},total:0,error});
    const row=grouped.get(key),cell=row.cells[batch.id] || {qty:0,ids:[],error:''};
    cell.ids.push(line.id);cell.error ||= error;row.error ||= error;
    if(qty!==null){cell.qty=hotelQty(cell.qty+qty);row.total=hotelQty(row.total+qty);}
    row.cells[batch.id]=cell;
  }
  return {batches,rows:[...grouped.values()]};
}
export function editHotelBatchQuantity(work,side,batchId,key,value,products) {
  if(work.frozen || value==='' || !Number.isFinite(Number(value)) || Number(value)<0)throw Error('0 이상의 수량을 입력하세요.');
  const row=hotelBatchMatrix(work,side,products).rows.find(r=>r.key===key),cell=row?.cells[batchId];
  if(!cell || cell.error)throw Error('원본에서 품목·수량·단위를 먼저 확인하세요.');
  const lines=work[side].filter(r=>cell.ids.includes(r.id));
  const target=hotelQty(value);let remaining=target;
  const replacements=new Map(lines.map((line,i)=>{
    const oldQty=hotelConvert(line.qty,line.unit,row.unit,products[Number(line.prodKey)] || {});
    const qty=i===lines.length-1 ? remaining : Math.min(remaining,hotelQty(cell.qty>0 ? target*oldQty/cell.qty : target/lines.length));
    remaining=hotelQty(remaining-qty);
    return [line.id,{...line,qty,unit:row.unit}];
  }));
  return {...work,[side]:work[side].map(line=>replacements.get(line.id)||line),allocations:{}};
}

// Only accept a regular ruled table with exactly the expected data rows (+ optional header).
// Ambiguous scans/photos are left for the explicit alignment controls; never reorder OCR rows.
export function hotelImageRowBounds({data,width,height},count,{allowTrailingSpace=false}={}) {
  if(count<1 || width<10)return null;
  const bands=[];let lastColoredHeader=-1;
  for(let y=0;y<height;y++){
    let dark=0,colored=0;
    for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]>180 && Math.max(data[i],data[i+1],data[i+2])<220 && Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])<45)dark++;if(data[i+3]>180 && Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>60)colored++;}
    if(colored/width>.65)lastColoredHeader=y;
    if(dark/width>.65){const last=bands[bands.length-1];if(last && y-last[1]<=2)last[1]=y;else bands.push([y,y]);}
  }
  const lines=bands.map(([a,b])=>(a+b)/2);
  // Yellow header borders may be colored rather than gray. Its bottom edge is
  // still the first data boundary; do not lose the first product row.
  if(lastColoredHeader>=0 && !lines.some(y=>Math.abs(y-(lastColoredHeader+1))<=2))lines.push(lastColoredHeader+1);
  lines.sort((a,b)=>a-b);
  if(lines.length<count+1 || lines.length>count+4)return null;
  const bounds=lines.slice(-(count+1)), gaps=bounds.slice(1).map((y,i)=>y-bounds[i]);
  const median=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
  if(bounds[0]<lastColoredHeader || median<8 || gaps.some(g=>g<median*.8 || g>median*1.2) || (!allowTrailingSpace && height-bounds.at(-1)>median*.75))return null;
  // An extra same-size row could be an unparsed item or footer; do not guess.
  if(lines.length>count+2 && lines.at(-(count+2))-lines.at(-(count+3))<median*1.25)return null;
  return bounds.map(y=>y/height);
}


// Location recovery must never replace edited quantities, units or product mappings.
export function recoverHotelSourceRows(rows, candidates) {
  const token=r=>`${String(r.inputName||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')}|${Number(r.originalQty??r.qty)}`;
  const keys=new Map();
  for(const r of rows)keys.set(token(r),(keys.get(token(r))||0)+1);
  const positions=new Map();
  for(const r of candidates){const box=hotelSourceBox(r.sourceBox);if(!box)continue;const key=token(r),values=positions.get(key)||new Map();values.set(JSON.stringify(box),box);positions.set(key,values);}
  const missing=rows.filter(r=>!hotelSourceBox(r.sourceBox));
  if(!missing.length)return rows;
  if(missing.some(r=>!String(r.inputName||'').trim() || !Number.isFinite(Number(r.originalQty??r.qty)) || keys.get(token(r))!==1 || positions.get(token(r))?.size!==1))return null;
  return rows.map(r=>hotelSourceBox(r.sourceBox)?r:{...r,sourceBox:[...positions.get(token(r)).values()][0]});
}
export function recoverHotelWorkLocations(work, peers) {
  if(work.frozen)return work;
  let next=work;
  for(const side of ['request','purchase']){
    const sources=[...(work.pending?.[side]?[work.pending[side]]:[]),...hotelSavedBatches(work,side)];
    for(const source of sources){
      if(!hotelImageUrl(source.imageId)||!source.rows.some(r=>!hotelSourceBox(r.sourceBox)))continue;
      const candidates=[];
      for(const peer of peers){
        if(String(peer.year)!==String(work.year)||peer.week!==work.week)continue;
        for(const peerSide of ['request','purchase'])for(const b of [...(peer.pending?.[peerSide]?[peer.pending[peerSide]]:[]),...hotelSavedBatches(peer,peerSide)])if(b.imageId===source.imageId)candidates.push(...b.rows);
      }
      const rows=recoverHotelSourceRows(source.rows,candidates);if(!rows)continue;
      if(next.pending?.[side]?.id===source.id)next={...next,pending:{...next.pending,[side]:{...next.pending[side],rows}}};
      else {const byId=new Map(rows.map(r=>[r.id,r]));next={...next,[side]:next[side].map(r=>byId.get(r.id)||r)};}
    }
  }
  return next;
}
