export async function requestDoneKey(row){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([row.id,row.text])));
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function readRequestDone(rows,signal){
 const states={};
 for(let i=0;i<rows.length;i+=80){const response=await fetch('/api/kakao/request-done?'+new URLSearchParams({keys:rows.slice(i,i+80).map(r=>r.doneKey).join(',')}),{signal,cache:'no-store'});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'작업완료 표시를 읽지 못했습니다.');for(const state of data.states)states[state.key]=state;}
 return states;
}
