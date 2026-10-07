import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mutateKnowledge,readKnowledge,addKnowledgeAttachment,findKnowledgeAttachment} from '../lib/operationsKnowledgeStore.js';
import {readImportTeamRecord,writeImportTeamRecord} from '../lib/importTeamStore.js';
import {item} from './operationsKnowledgeSchema.test.js';

const actor={userId:'u1',userName:'테스터'};
test('CAS, audit, comments, retirement, attachment metadata and legacy preservation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-store-'));
  try {
    const handoff={id:'c48e886e-2706-4363-bcdc-80c5d2f973cf',title:'기존',issue:'이슈',action:'',caution:'',checks:'',status:'OPEN',priority:'NORMAL'};
    await writeImportTeamRecord('checklist.handoffs',{value:[handoff],expectedRevision:0,actor},{root});
    const before=await readImportTeamRecord('checklist.handoffs',{root});
    let snapshot=await mutateKnowledge({action:'CREATE_ITEM',expectedRevision:0,item:item()},{actor,root});
    assert.equal(snapshot.revision,1);assert.equal(snapshot.items[0].createdBy.userId,'u1');
    assert.equal(snapshot.legacyHandoffs.items[0].status,null);
    await assert.rejects(()=>mutateKnowledge({action:'CREATE_ITEM',expectedRevision:0,item:item()},{actor,root}),{statusCode:409});
    const id=snapshot.items[0].id;
    snapshot=await mutateKnowledge({action:'ADD_COMMENT',expectedRevision:1,itemId:id,body:'확인함'},{actor,root});
    assert.equal(snapshot.items[0].comments[0].author.userId,'u1');
    snapshot=await mutateKnowledge({action:'UPDATE_ITEM',expectedRevision:2,itemId:id,item:{...item(),status:'RETIRED'}},{actor,root});
    assert.deepEqual(snapshot.audit[2].changedFields,['status']);
    const metadata={id:'e5d063f4-8324-46b4-a38c-c5967db8524c',originalName:'memo.txt',mediaType:'text/plain',size:2,kind:'text'};
    snapshot=await addKnowledgeAttachment({itemId:id,expectedRevision:3,metadata,actor,root});
    assert.equal(snapshot.items[0].attachments.length,1);
    assert.equal((await findKnowledgeAttachment(metadata.id,{root})).originalName,'memo.txt');
    assert.deepEqual(await readImportTeamRecord('checklist.handoffs',{root}),before);
    assert.equal((await readKnowledge({root})).items[0].status,'RETIRED');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
