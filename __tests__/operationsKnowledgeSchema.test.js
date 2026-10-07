import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,validateKnowledgeValue} from '../lib/operationsKnowledgeSchema.js';

export const item=()=>({title:'주의',category:'SEASON',status:'CHECK',priority:'IMPORTANT',tags:{countries:['한국'],flowers:[],farms:[],stages:[]},situation:'상황',action:'처리',caution:'주의',checklist:'',contact:'',reviewDate:null});
test('strict command rejects server-owned and unknown fields',()=>{
  const valid={action:'CREATE_ITEM',expectedRevision:0,item:item()};
  assert.equal(validateCommand(valid).item.title,'주의');
  assert.throws(()=>validateCommand({...valid,item:{...item(),id:'client'}}));
  assert.throws(()=>validateCommand({...valid,actor:'spoof'}));
  assert.throws(()=>validateCommand({...valid,item:{...item(),tags:{...item().tags,countries:['한국','한국']}}}));
  assert.throws(()=>validateCommand({...valid,item:{...item(),reviewDate:'2026-02-30'}}));
  assert.throws(()=>validateCommand({action:'ADD_COMMENT',expectedRevision:0,itemId:'bad',body:'hi'}));
});
test('stored value rejects injected audit',()=>{
  assert.throws(()=>validateKnowledgeValue({schemaVersion:1,items:[],audit:[{action:'DELETE_ITEM'}]}));
});
test('stored attachment metadata binds extension, MIME and disposition kind',()=>{
  const now='2026-10-07T00:00:00.000Z',by={userId:'u1',userName:'Tester'};
  const attachment={id:'e5d063f4-8324-46b4-a38c-c5967db8524c',originalName:'memo.txt',mediaType:'text/plain',size:4,kind:'text',createdAt:now,author:by};
  const record={schemaVersion:1,items:[{...item(),id:'c48e886e-2706-4363-bcdc-80c5d2f973cf',comments:[],attachments:[attachment],createdAt:now,createdBy:by,updatedAt:now,updatedBy:by}],audit:[]};
  assert.doesNotThrow(()=>validateKnowledgeValue(record));
  for(const bad of [
    {...attachment,mediaType:'text/html',kind:'image'},
    {...attachment,mediaType:'image/png',kind:'image'},
    {...attachment,originalName:'memo.svg'},
    {...attachment,originalName:'../memo.txt'}
  ])assert.throws(()=>validateKnowledgeValue({...record,items:[{...record.items[0],attachments:[bad]}]}));
});
