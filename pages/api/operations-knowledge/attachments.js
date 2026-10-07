import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth';
import { readKnowledge, addKnowledgeAttachment, findKnowledgeAttachment, attachmentPath, ensureAttachmentRoot, ATTACHMENT_ROOT } from '../../../lib/operationsKnowledgeStore';
import { assertKnowledgeOrigin, knowledgeApiError } from '../../../lib/operationsKnowledgeApi';
import { knowledgeError, isKnowledgeId } from '../../../lib/operationsKnowledgeSchema';
import {inspectAttachment,MAX_ATTACHMENT_BYTES} from '../../../lib/operationsKnowledgeAttachments';

export const config={api:{bodyParser:false,responseLimit:'12mb'}};
const first=value=>Array.isArray(value)?value[0]:value;
async function parse(req,uploadDir) {
  const token=randomUUID();
  const temporaryDir=path.resolve(uploadDir,token);
  if(path.dirname(temporaryDir)!==path.resolve(uploadDir))throw knowledgeError('임시 첨부 경로를 확인하세요.',500);
  await fsp.mkdir(temporaryDir,{mode:0o700});
  const form=formidable({uploadDir:temporaryDir,maxFileSize:MAX_ATTACHMENT_BYTES,maxTotalFileSize:MAX_ATTACHMENT_BYTES,maxFiles:1,multiples:false,allowEmptyFiles:false,filename:()=>randomUUID()+'.upload'});
  try {const result=await new Promise((resolve,reject)=>form.parse(req,(error,fields,files)=>error?reject(error):resolve({fields,files})));return {...result,temporaryDir};}
  catch(error){
    await fsp.rm(temporaryDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    throw knowledgeError(error.httpCode===413?'첨부는 10 MiB 이하여야 합니다.':'첨부 요청을 읽지 못했습니다.',error.httpCode===413?413:400);
  }
}
function safeDisposition(name,inline) {
  const fallback=name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100)||'download';
  return `${inline?'inline':'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
export const createAttachmentHandler=({attachmentsRoot=ATTACHMENT_ROOT,add=addKnowledgeAttachment,find=findKnowledgeAttachment,read=readKnowledge}={})=>async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.user?.accountActive===false)return res.status(403).json({success:false,error:'비활성 계정은 접근할 수 없습니다.'});
  try {
    if(req.method==='GET') {
      const id=req.query?.id;
      if(!isKnowledgeId(id))throw knowledgeError('첨부를 찾을 수 없습니다.',404);
      const metadata=await find(id),filename=attachmentPath(id,{attachmentsRoot});
      let stat;try{stat=await fsp.stat(filename);}catch(error){if(error.code==='ENOENT')throw knowledgeError('첨부를 찾을 수 없습니다.',404);throw error;}
      if(!stat.isFile()||stat.size!==metadata.size)throw knowledgeError('첨부를 읽을 수 없습니다.',500);
      res.setHeader('Content-Type',metadata.mediaType);res.setHeader('Content-Length',stat.size);
      res.setHeader('Content-Disposition',safeDisposition(metadata.originalName,metadata.kind==='image'));
      const stream=fs.createReadStream(filename);
      stream.on('error',()=>{if(!res.headersSent)knowledgeApiError(res,knowledgeError('첨부를 읽을 수 없습니다.',500));else res.destroy();});
      return stream.pipe(res);
    }
    if(req.method==='POST') {
      assertKnowledgeOrigin(req);
      await ensureAttachmentRoot(attachmentsRoot);
      let temporary=null,temporaryDir=null,final=null,committed=false;
      try {
        const parsed=await parse(req,attachmentsRoot),{fields,files}=parsed;temporaryDir=parsed.temporaryDir;
        const file=first(files.file);temporary=file?.filepath;
        if(Object.keys(fields).sort().join('|')!=='expectedRevision|itemId'||Object.keys(files).join('|')!=='file'||!temporary)throw knowledgeError('첨부 요청 필드를 확인하세요.');
        const revisionText=first(fields.expectedRevision),itemId=first(fields.itemId);
        if(!/^\d+$/.test(revisionText||'')||!isKnowledgeId(itemId))throw knowledgeError('지침 ID와 버전을 확인하세요.');
        const expectedRevision=Number(revisionText);
        if(!Number.isSafeInteger(expectedRevision))throw knowledgeError('자료 버전을 확인하세요.');
        const buffer=await fsp.readFile(temporary);
        const checked=await inspectAttachment(buffer,file.originalFilename,file.mimetype);
        const id=randomUUID();final=attachmentPath(id,{attachmentsRoot});
        await fsp.rename(temporary,final);temporary=null;
        await fsp.rm(temporaryDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});temporaryDir=null;
        const result=await add({itemId,expectedRevision,metadata:{id,originalName:file.originalFilename,mediaType:checked.mediaType,size:buffer.length,kind:checked.kind},actor:req.user});
        committed=true;
        return res.status(200).json({success:true,...result});
      } catch(error) {
        if(final&&!committed)await fsp.unlink(final).catch(()=>{});
        if(temporaryDir)await fsp.rm(temporaryDir,{recursive:true,force:true,maxRetries:5,retryDelay:50}).catch(()=>{});
        throw error;
      }
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});
  } catch(error) {return knowledgeApiError(res,error);}
};
export default withAuth(createAttachmentHandler());
