import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable,PassThrough} from 'node:stream';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import formidable from 'formidable';
import JSZip from 'jszip';
import {inspectAttachment,MAX_ATTACHMENT_BYTES} from '../lib/operationsKnowledgeAttachments.js';
import {assertKnowledgeOrigin,knowledgeApiError} from '../lib/operationsKnowledgeApi.js';
import {knowledgeError,isKnowledgeId} from '../lib/operationsKnowledgeSchema.js';
import {attachmentPath,ensureAttachmentRoot,ATTACHMENT_ROOT} from '../lib/operationsKnowledgeStore.js';

const source=fs.readFileSync(new URL('../pages/api/operations-knowledge/attachments.js',import.meta.url),'utf8');
const executable=source.replace(/^import .*;\r?\n/gm,'').replace('export const config=','const config=').replace('export const createAttachmentHandler=','const createAttachmentHandler=').replace('export default withAuth(createAttachmentHandler());','return createAttachmentHandler;');
const factory=new Function('fs','fsp','path','randomUUID','formidable','withAuth','readKnowledge','addKnowledgeAttachment','findKnowledgeAttachment','attachmentPath','ensureAttachmentRoot','ATTACHMENT_ROOT','assertKnowledgeOrigin','knowledgeApiError','knowledgeError','isKnowledgeId','inspectAttachment','MAX_ATTACHMENT_BYTES',executable)(fs,fsp,path,randomUUID,formidable,fn=>fn,()=>{},()=>{},()=>{},attachmentPath,ensureAttachmentRoot,ATTACHMENT_ROOT,assertKnowledgeOrigin,knowledgeApiError,knowledgeError,isKnowledgeId,inspectAttachment,MAX_ATTACHMENT_BYTES);
const itemId=randomUUID();
const response=(throwFirst=false)=>({statusCode:200,headers:{},throws:throwFirst,setHeader(key,value){this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},json(value){if(this.throws){this.throws=false;throw Error('response failed');}this.body=value;return this;}});
function multipart(fields,filename='memo.txt',content=Buffer.from('memo'),mime='text/plain') {
  const boundary='----knowledge-'+randomUUID(),parts=[];
  for(const [key,value] of Object.entries(fields))parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),content,Buffer.from(`\r\n--${boundary}--\r\n`));
  const body=Buffer.concat(parts),req=Readable.from([body]);
  req.method='POST';req.user={userId:'u1',userName:'Tester',accountActive:true};req.headers={host:'example.com','x-forwarded-proto':'https',origin:'https://example.com','content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(body.length)};
  return req;
}
const files=async root=>fsp.readdir(root).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));

test('attachment magic, MIME and unsafe content',async()=>{
  assert.equal((await inspectAttachment(Buffer.from('hello'), 'note.txt','text/plain')).kind,'text');
  await assert.rejects(()=>inspectAttachment(Buffer.from('<svg></svg>'),'note.txt','text/plain'));
  await assert.rejects(()=>inspectAttachment(Buffer.from('hello'),'note.svg','image/svg+xml'));
  await assert.rejects(()=>inspectAttachment(Buffer.from('hello'),'fake.pdf','application/pdf'));
  await assert.rejects(()=>inspectAttachment(Buffer.from('hello'),'note.txt','text/html'));
});
test('attachment download requires record-linked UUID',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'knowledge-attachment-get-'));
  try {
    const handler=factory({attachmentsRoot:root,find:async()=>{throw knowledgeError('missing',404);}});
    const res=response();await handler({method:'GET',query:{id:randomUUID()},user:{accountActive:true}},res);
    assert.equal(res.statusCode,404);assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
    const invalid=response();await handler({method:'GET',query:{id:'../../etc/passwd'},user:{accountActive:true}},invalid);assert.equal(invalid.statusCode,404);
  } finally {await fsp.rm(root,{recursive:true,force:true});}
});
test('linked private attachment streams with safe download headers',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'knowledge-attachment-stream-'));
  try {
    const id=randomUUID(),data=Buffer.from('private file');
    await fsp.writeFile(attachmentPath(id,{attachmentsRoot:root}),data);
    const handler=factory({attachmentsRoot:root,find:async requested=>{assert.equal(requested,id);return {id,originalName:'업무 기록.txt',mediaType:'text/plain',size:data.length,kind:'text'};}});
    const res=new PassThrough();res.headers={};res.setHeader=function(key,value){this.headers[key]=value;return this;};res.status=function(code){this.statusCode=code;return this;};res.json=function(body){this.body=body;this.end();return this;};
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));
    await handler({method:'GET',query:{id},user:{accountActive:true}},res);await once(res,'end');
    assert.deepEqual(Buffer.concat(chunks),data);assert.match(res.headers['Content-Disposition'],/^attachment; /);assert.match(res.headers['Content-Disposition'],/filename\*=UTF-8''/);
    assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
  } finally {await fsp.rm(root,{recursive:true,force:true});}
});
test('multipart upload commits one private file and cleans bad fields and CAS failures',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'knowledge-attachment-post-'));
  try {
    let calls=0;
    const handler=factory({attachmentsRoot:root,add:async input=>{calls++;assert.equal(input.itemId,itemId);return {revision:2,items:[],audit:[]};}});
    let res=response();await handler(multipart({itemId,expectedRevision:'1'}),res);
    assert.equal(res.statusCode,200);assert.equal(calls,1);assert.equal((await files(root)).length,1);
    assert.match((await files(root))[0],/^[0-9a-f-]{36}$/);
    res=response();await handler(multipart({itemId,expectedRevision:'1',unexpected:'x'}),res);
    assert.equal(res.statusCode,400);assert.equal(calls,1);assert.equal((await files(root)).length,1);
    const stale=factory({attachmentsRoot:root,add:async()=>{throw knowledgeError('stale',409);}});
    res=response();await stale(multipart({itemId,expectedRevision:'1'}),res);
    assert.equal(res.statusCode,409);assert.equal((await files(root)).length,1);
  } finally {await fsp.rm(root,{recursive:true,force:true});}
});
test('multipart size rejection cleans temporary file; postcommit response error preserves committed file',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'knowledge-attachment-boundary-'));
  try {
    let called=0;
    const handler=factory({attachmentsRoot:root,add:async()=>{called++;return {revision:1,items:[],audit:[]};}});
    let res=response();await handler(multipart({itemId,expectedRevision:'0'},'huge.txt',Buffer.alloc(MAX_ATTACHMENT_BYTES+1,65)),res);
    assert.equal(res.statusCode,413);assert.equal(called,0);assert.deepEqual(await files(root),[]);
    res=response(true);await handler(multipart({itemId,expectedRevision:'0'}),res);
    assert.equal(called,1);assert.equal((await files(root)).length,1);
  } finally {await fsp.rm(root,{recursive:true,force:true});}
});
test('Office ZIP rejects macro content types and oversized declared expansion',async()=>{
  const base=()=>{const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('_rels/.rels','<Relationships/>');zip.file('word/document.xml','<document/>');return zip;};
  assert.equal((await inspectAttachment(await base().generateAsync({type:'nodebuffer',compression:'DEFLATE'}),'memo.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document')).kind,'document');
  const macro=base();macro.file('[Content_Types].xml','<Types ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>');
  const macroData=await macro.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(()=>inspectAttachment(macroData,'macro.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  const bomb=base();bomb.file('word/large.bin','a'.repeat(33*1024*1024));
  const bombData=await bomb.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(()=>inspectAttachment(bombData,'bomb.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
});
