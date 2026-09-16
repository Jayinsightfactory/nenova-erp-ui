// Identity is intentionally exact: no role, casing or whitespace bypass.
export function assertQualityRequestEditor(event,userId){
 if(!event||event.Kind!=='REQUEST')throw Object.assign(new Error('원본 요청을 선택하세요.'),{code:'INBOX_INVALID'});
 if(typeof userId!=='string'||!userId||event.AuthorId!==userId)throw Object.assign(new Error('요청 작성자만 수정할 수 있습니다.'),{code:'INBOX_FORBIDDEN'});
}
export function projectQualityRequestEvents(events,userId){
 // Scoped GET rows include CaseKey; unscoped fixtures may omit it on both rows.
 const identity=(event,key)=>JSON.stringify([event.CaseKey==null?null:String(event.CaseKey).toLowerCase(),String(key)]);
 const latest=new Map();
 for(const event of events){
  if(event.Kind!=='REQUEST_EDIT'||event.RequestEventKey==null)continue;
  const key=identity(event,event.RequestEventKey),previous=latest.get(key);
  if(!previous||BigInt(event.EventKey)>BigInt(previous.EventKey))latest.set(key,event);
 }
 return events.map(event=>{
  if(event.Kind!=='REQUEST')return {...event,CanEditRequest:false};
  const edit=latest.get(identity(event,event.EventKey));
  return {...event,OriginalBody:event.OriginalBody??event.Body,Body:edit?edit.Body:event.Body,RequestEdited:!!edit||event.RequestEdited===true,
   CanEditRequest:typeof userId==='string'&&!!userId&&event.AuthorId===userId};
 });
}
