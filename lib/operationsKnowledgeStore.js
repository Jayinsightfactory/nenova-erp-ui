import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMPORT_TEAM_ROOT, readImportTeamRecord, writeImportTeamRecord } from './importTeamStore.js';
import { handoffActor } from './importTeamHandoffs.js';
import { KNOWLEDGE_KEY, validateCommand, knowledgeError, isKnowledgeId } from './operationsKnowledgeSchema.js';

export const ATTACHMENT_ROOT = path.join(process.cwd(),'data','runtime','operations-knowledge','attachments');
const empty = () => ({schemaVersion:1,items:[],audit:[]});
const author = actor => ({userId:String(actor.userId),userName:String(actor.userName||actor.userId)});
const valueOf = record => record.value??empty();
const snapshot = (record,legacyHandoffs) => ({revision:record.revision,items:valueOf(record).items,audit:valueOf(record).audit,legacyHandoffs});
const rootOption = root => root?{root}:{};

export async function readKnowledge({root}={}) {
  const [record,handoffs]=await Promise.all([readImportTeamRecord(KNOWLEDGE_KEY,rootOption(root)),readImportTeamRecord('checklist.handoffs',rootOption(root))]);
  const legacyHandoffs={sourceKey:'checklist.handoffs',sourceRevision:handoffs.revision,items:(handoffs.value||[]).map(row=>({
    ...row,category:'HANDOFF',readOnly:true,status:null,statusLabel:'기존 자료 · 상태 미분류',legacyStatus:row.status,
    legacyActor:(()=>{const event=handoffActor(handoffs.history,row.id);return event?{userId:event.userId,userName:event.userName,at:event.at}:null;})()
  }))};
  return snapshot(record,legacyHandoffs);
}

function changedFields(before,after) {
  const fields=[];
  for(const key of ['title','category','status','priority','situation','action','caution','checklist','contact','reviewDate'])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))fields.push(key);
  for(const key of ['countries','flowers','farms','stages'])if(JSON.stringify(before.tags[key])!==JSON.stringify(after.tags[key]))fields.push('tags.'+key);
  return fields;
}

export async function mutateKnowledge(raw,{actor,root}={}) {
  if(!actor?.userId)throw knowledgeError('로그인이 필요합니다.',401);
  const command=validateCommand(raw),record=await readImportTeamRecord(KNOWLEDGE_KEY,rootOption(root));
  if(record.revision!==command.expectedRevision)throw knowledgeError('다른 직원이 먼저 수정했습니다. 새로고침하세요.',409);
  const next=structuredClone(valueOf(record)),at=new Date().toISOString(),by=author(actor);
  let item,itemId,commentId,fields;
  if(command.action==='CREATE_ITEM') {
    if(next.items.length>=300)throw knowledgeError('지침은 최대 300건입니다.',413);
    item={...command.item,id:randomUUID(),comments:[],attachments:[],createdAt:at,createdBy:by,updatedAt:at,updatedBy:by};
    next.items.unshift(item);itemId=item.id;
  } else {
    const index=next.items.findIndex(row=>row.id===command.itemId);
    if(index<0)throw knowledgeError('지침을 찾을 수 없습니다.',404);
    item=next.items[index];itemId=item.id;
    if(command.action==='UPDATE_ITEM') {
      fields=changedFields(item,command.item);
      if(!fields.length)throw knowledgeError('변경된 내용이 없습니다.');
      next.items[index]={...item,...command.item,updatedAt:at,updatedBy:by};
    } else {
      if(item.comments.length>=100)throw knowledgeError('댓글은 항목당 최대 100건입니다.',413);
      commentId=randomUUID();item.comments.push({id:commentId,body:command.body.trim(),createdAt:at,author:by});
      item.updatedAt=at;item.updatedBy=by;
    }
  }
  const revision=record.revision+1;
  next.audit=[...next.audit,{revision,action:command.action,itemId,...(commentId?{commentId}:{}),...(fields?{changedFields:fields}:{}),at,actor:by}].slice(-500);
  const legacy=(await readKnowledge({root})).legacyHandoffs;
  const saved=await writeImportTeamRecord(KNOWLEDGE_KEY,{value:next,expectedRevision:command.expectedRevision,actor},rootOption(root));
  return {...snapshot(saved,legacy),...(saved.cleanupWarning?{cleanupWarning:saved.cleanupWarning}:{})};
}

export async function addKnowledgeAttachment({itemId,expectedRevision,metadata,actor,root}={}) {
  if(!actor?.userId)throw knowledgeError('로그인이 필요합니다.',401);
  if(!isKnowledgeId(itemId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw knowledgeError('지침 ID와 버전을 확인하세요.');
  const record=await readImportTeamRecord(KNOWLEDGE_KEY,rootOption(root));
  if(record.revision!==expectedRevision)throw knowledgeError('다른 직원이 먼저 수정했습니다. 새로고침하세요.',409);
  const next=structuredClone(valueOf(record)),item=next.items.find(row=>row.id===itemId);
  if(!item)throw knowledgeError('지침을 찾을 수 없습니다.',404);
  if(item.attachments.length>=20)throw knowledgeError('첨부는 항목당 최대 20개입니다.',413);
  const at=new Date().toISOString(),by=author(actor);
  item.attachments.push({...metadata,createdAt:at,author:by});item.updatedAt=at;item.updatedBy=by;
  next.audit=[...next.audit,{revision:record.revision+1,action:'ADD_ATTACHMENT',itemId,attachmentId:metadata.id,at,actor:by}].slice(-500);
  const legacy=(await readKnowledge({root})).legacyHandoffs;
  const saved=await writeImportTeamRecord(KNOWLEDGE_KEY,{value:next,expectedRevision,actor},rootOption(root));
  return {...snapshot(saved,legacy),...(saved.cleanupWarning?{cleanupWarning:saved.cleanupWarning}:{})};
}

export async function findKnowledgeAttachment(id,{root}={}) {
  if(!isKnowledgeId(id))throw knowledgeError('첨부를 찾을 수 없습니다.',404);
  const record=await readImportTeamRecord(KNOWLEDGE_KEY,rootOption(root));
  for(const item of valueOf(record).items) {
    const metadata=item.attachments.find(file=>file.id===id);
    if(metadata)return metadata;
  }
  throw knowledgeError('첨부를 찾을 수 없습니다.',404);
}

export function attachmentPath(id,{attachmentsRoot=ATTACHMENT_ROOT}={}) {
  if(!isKnowledgeId(id))throw knowledgeError('첨부 ID를 확인하세요.');
  return path.join(attachmentsRoot,id);
}
export async function ensureAttachmentRoot(root=ATTACHMENT_ROOT){await fs.mkdir(root,{recursive:true,mode:0o700});}
