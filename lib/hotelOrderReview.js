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
