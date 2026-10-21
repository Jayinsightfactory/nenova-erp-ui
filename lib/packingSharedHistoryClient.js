import {normalizePackingWorkSnapshot} from './packingWorkDraft.js';
const ENDPOINT='/api/import/tools/upload-history';
export function createPackingHistoryClient(userId,{request=fetch}={}){
 const files=new WeakMap();let tail=Promise.resolve();
 return {save(snapshot){
  // Capture before queuing: later review edits must not mutate this revision.
  const normalized=normalizePackingWorkSnapshot(snapshot);
  const file=normalized.file;delete normalized.file;
  const captured=structuredClone(normalized);
  let state=files.get(file);
  if(!state){state={uploadId:crypto.randomUUID(),stored:false};files.set(file,state);}
  const run=async()=>{
   if(!state.sourceHash){
    const bytes=await file.arrayBuffer();
    state.sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   }
   const body={id:crypto.randomUUID(),uploadId:state.uploadId,sourceHash:state.sourceHash,snapshot:captured,expectedUserId:String(userId)};
   if(!state.stored)body.fileBase64=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('원본 파일을 읽을 수 없습니다.'));reader.readAsDataURL(file);
   });
   const response=await request(ENDPOINT,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();
   if(!response.ok||!data.success)throw Error(data.error||'팀 업로드 이력 보관 실패');
   state.stored=true;return data.record;
  };
  const pending=tail.then(run);tail=pending.catch(()=>{});return pending;
 }};
}
export async function loadPackingHistory(id,{request=fetch}={}){
 const response=await request(`${ENDPOINT}?id=${encodeURIComponent(id)}`,{cache:'no-store',credentials:'same-origin'});
 const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'업로드 이력 불러오기 실패');
 const {snapshot,fileBase64}=data.record;
 const bytes=Uint8Array.from(atob(fileBase64),char=>char.charCodeAt(0));
 const file=new File([bytes],snapshot.fileName,{type:snapshot.fileType,lastModified:snapshot.lastModified});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==data.record.sourceHash)throw Error('보관 원본 검증에 실패했습니다.');
 return normalizePackingWorkSnapshot({...snapshot,file});
}
