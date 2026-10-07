export const KNOWLEDGE_KEY = 'knowledge.guidance';
export const CATEGORIES = ['SITUATION','CASE','SEASON','HANDOFF','CHECKLIST'];
export const STATUSES = ['CHECK','CURRENT','RETIRED'];
export const PRIORITIES = ['NORMAL','IMPORTANT'];
const FIELDS = ['title','category','status','priority','tags','situation','action','caution','checklist','contact','reviewDate'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ATTACHMENT_TYPES={
  '.jpg':['image/jpeg','image'],'.jpeg':['image/jpeg','image'],'.png':['image/png','image'],'.webp':['image/webp','image'],
  '.pdf':['application/pdf','document'],'.docx':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','document'],
  '.xlsx':['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','document'],'.csv':['text/csv','text'],'.txt':['text/plain','text']
};
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const knowledgeError = (message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const plain = value => value!==null && typeof value==='object' && !Array.isArray(value) && (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);
const exact = (value, fields) => plain(value) && Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
const str = (value,max,required=false) => typeof value==='string' && !control.test(value) && value.length<=max && (!required || !!value.trim());
const date = value => { if(value===null)return true; if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false; const parsed=new Date(value+'T00:00:00Z'); return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value; };
const author = value => exact(value,['userId','userName'])&&str(value.userId,160,true)&&str(value.userName,160,true);
const iso = value => typeof value==='string'&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
const storedAttachmentType = value => {
  if(!str(value.originalName,255,true)||/[\\/]/.test(value.originalName))return false;
  const extension=/\.[^.]+$/.exec(value.originalName)?.[0]?.toLowerCase();
  const expected=ATTACHMENT_TYPES[extension];
  return !!expected&&value.mediaType===expected[0]&&value.kind===expected[1];
};
function validateMutable(value) {
  if(!exact(value,FIELDS))throw knowledgeError('지침 필드를 확인하세요.');
  if(!str(value.title,160,true)||!CATEGORIES.includes(value.category)||!STATUSES.includes(value.status)||!PRIORITIES.includes(value.priority))throw knowledgeError('제목, 분류, 상태 또는 중요도를 확인하세요.');
  if(!exact(value.tags,['countries','flowers','farms','stages']))throw knowledgeError('태그 형식을 확인하세요.');
  for(const list of Object.values(value.tags))if(!Array.isArray(list)||list.length>20||list.some(tag=>!str(tag,80,true)||tag!==tag.trim())||new Set(list).size!==list.length)throw knowledgeError('태그는 종류별 20개, 각 80자 이내여야 합니다.');
  if(!str(value.situation,4000,true)||['action','caution','checklist'].some(key=>!str(value[key],4000))||!str(value.contact,300)||!date(value.reviewDate))throw knowledgeError('지침 내용이나 검토일을 확인하세요.');
  return value;
}
export function normalizeMutableItem(value) {
  validateMutable(value);
  return {...value,title:value.title.trim(),situation:value.situation.trim(),tags:Object.fromEntries(Object.entries(value.tags).map(([key,list])=>[key,list.map(tag=>tag.trim())]))};
}
export function validateKnowledgeValue(value) {
  if(!exact(value,['schemaVersion','items','audit'])||value.schemaVersion!==1||!Array.isArray(value.items)||value.items.length>300||!Array.isArray(value.audit)||value.audit.length>500)throw knowledgeError('저장된 지침 형식이 올바르지 않습니다.');
  const ids=new Set();
  for(const item of value.items) {
    if(!exact(item,[...FIELDS,'id','comments','attachments','createdAt','createdBy','updatedAt','updatedBy'])||!UUID.test(item.id)||ids.has(item.id))throw knowledgeError('저장된 지침 ID가 올바르지 않습니다.');
    ids.add(item.id);validateMutable(Object.fromEntries(FIELDS.map(key=>[key,item[key]])));
    if(!iso(item.createdAt)||!iso(item.updatedAt)||!author(item.createdBy)||!author(item.updatedBy)||!Array.isArray(item.comments)||item.comments.length>100||!Array.isArray(item.attachments)||item.attachments.length>20)throw knowledgeError('저장된 지침 이력이 올바르지 않습니다.');
    const childIds=new Set();
    for(const comment of item.comments) {
      if(!exact(comment,['id','body','createdAt','author'])||!UUID.test(comment.id)||childIds.has(comment.id)||!str(comment.body,2000,true)||!iso(comment.createdAt)||!author(comment.author))throw knowledgeError('댓글 이력이 올바르지 않습니다.');
      childIds.add(comment.id);
    }
    for(const attachment of item.attachments) {
      if(!exact(attachment,['id','originalName','mediaType','size','kind','createdAt','author'])||!UUID.test(attachment.id)||childIds.has(attachment.id)||!storedAttachmentType(attachment)||!Number.isSafeInteger(attachment.size)||attachment.size<1||attachment.size>10*1024*1024||!iso(attachment.createdAt)||!author(attachment.author))throw knowledgeError('첨부 이력이 올바르지 않습니다.');
      childIds.add(attachment.id);
    }
  }
  for(const event of value.audit)if(!plain(event)||!Number.isSafeInteger(event.revision)||event.revision<1||!['CREATE_ITEM','UPDATE_ITEM','ADD_COMMENT','ADD_ATTACHMENT'].includes(event.action)||!UUID.test(event.itemId)||!iso(event.at)||!author(event.actor)||Object.keys(event).some(k=>!['revision','action','itemId','commentId','attachmentId','changedFields','at','actor'].includes(k))||event.commentId!==undefined&&!UUID.test(event.commentId)||event.attachmentId!==undefined&&!UUID.test(event.attachmentId)||event.changedFields!==undefined&&(!Array.isArray(event.changedFields)||event.changedFields.some(field=>!['title','category','status','priority','situation','action','caution','checklist','contact','reviewDate','tags.countries','tags.flowers','tags.farms','tags.stages'].includes(field)))||(event.action==='ADD_COMMENT')!==(event.commentId!==undefined)||(event.action==='ADD_ATTACHMENT')!==(event.attachmentId!==undefined)||(event.action==='UPDATE_ITEM')!==(event.changedFields!==undefined))throw knowledgeError('감사 이력이 올바르지 않습니다.');
  return value;
}
export function validateCommand(body) {
  if(!plain(body)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw knowledgeError('자료 버전을 다시 확인하세요.');
  const {action}=body;
  const allowed=action==='CREATE_ITEM'?['action','expectedRevision','item']:action==='UPDATE_ITEM'?['action','expectedRevision','itemId','item']:action==='ADD_COMMENT'?['action','expectedRevision','itemId','body']:[];
  if(!allowed.length||!exact(body,allowed))throw knowledgeError('저장 명령 필드를 확인하세요.');
  if(action!=='CREATE_ITEM'&&!UUID.test(body.itemId||''))throw knowledgeError('지침 ID를 확인하세요.');
  if(action==='ADD_COMMENT') {if(!str(body.body,2000,true))throw knowledgeError('댓글은 1~2,000자로 입력하세요.');return body;}
  return {...body,item:normalizeMutableItem(body.item)};
}
export const isKnowledgeId = value => typeof value==='string'&&UUID.test(value);
