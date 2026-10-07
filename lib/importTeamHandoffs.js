export const HANDOFF_KEY = 'checklist.handoffs';
export const HANDOFF_STATUSES = {OPEN:'확인 필요',IN_PROGRESS:'처리 중',DONE:'처리 완료'};
export function emptyHandoff(){return {title:'',issue:'',action:'',caution:'',checks:'',status:'OPEN',priority:'NORMAL'};}
export function validateImportHandoffs(value){
 if(!Array.isArray(value)||value.length>100)throw Error('인수인계 목록은 최대 100건까지 저장할 수 있습니다.');
 const ids=new Set();
 for(const row of value){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='action,caution,checks,id,issue,priority,status,title')throw Error('인수인계 자료 형식을 확인하세요. 계정 정보는 서버에서 기록합니다.');
  if(typeof row.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)||ids.has(row.id))throw Error('인수인계 ID가 유효하지 않거나 중복되었습니다.');
  ids.add(row.id);
  for(const key of ['title','issue','action','caution','checks'])if(typeof row[key]!=='string'||row[key].length>(key==='title'?160:2000)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row[key]))throw Error('제목은 160자, 내용은 각 2,000자 이내로 입력하세요.');
  if(!row.title.trim()||!row.issue.trim())throw Error('제목과 이슈 내용을 입력하세요.');
  if(!Object.hasOwn(HANDOFF_STATUSES,row.status)||!['NORMAL','IMPORTANT'].includes(row.priority))throw Error('진행 상태와 중요도를 확인하세요.');
 }
 return value;
}
export function handoffChanges(before,after){
 const old=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]));
 if(before.filter(row=>next.has(row.id)).map(row=>row.id).join(',')!==after.filter(row=>old.has(row.id)).map(row=>row.id).join(','))throw Object.assign(Error('기존 인수인계의 저장 순서를 바꿀 수 없습니다.'),{statusCode:400});
 const changes=[...new Set([...old.keys(),...next.keys()])].filter(id=>JSON.stringify(old.get(id))!==JSON.stringify(next.get(id))).map(id=>({id,before:old.get(id)||null,after:next.get(id)||null}));
 if(changes.length>1)throw Object.assign(Error('인수인계는 한 번에 한 항목씩 저장하세요.'),{statusCode:400});
 return changes;
}
export function handoffActor(history,id){return [...history].reverse().find(event=>event.changes?.some(change=>change.id===id));}
