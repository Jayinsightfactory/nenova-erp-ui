import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import formidable from 'formidable';
import {withAuth} from '../../../lib/auth';
import {query,sql,withTransaction} from '../../../lib/db';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from '../../../lib/salesDefectDeductionCore';
import {detectEvidenceImage,evidenceFileName,QUALITY_EVIDENCE_MAX_BYTES,QUALITY_EVIDENCE_MAX_FILES} from '../../../lib/farmQualityEvidence';

export const config={api:{bodyParser:false}};
const nv=value=>({type:sql.NVarChar,value}),num=value=>({type:sql.Int,value}),uid=value=>({type:sql.UniqueIdentifier,value}),bin=value=>({type:sql.VarBinary(sql.MAX),value});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const allowed=user=>user.accountActive!==false&&[canUseDefectIncoming,canUseDefectSales,canUseDefectSupport].some(fn=>fn(user));
const yearOf=value=>{const year=Number(value);if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('연도를 확인하세요.');return year;};
const sameOrigin=req=>!req.headers.origin||new URL(req.headers.origin).host===(req.headers['x-forwarded-host']||req.headers.host);

async function ready(){const r=await query("SELECT OBJECT_ID(N'dbo.WebFarmQualityEvidence',N'U') AS id");if(!r.recordset[0]?.id)throw new Error('농장 피드백 이미지 저장소 설치가 필요합니다. 관리자에게 문의하세요.');}
function parseFiles(req){const form=formidable({multiples:true,maxFiles:QUALITY_EVIDENCE_MAX_FILES,maxFileSize:QUALITY_EVIDENCE_MAX_BYTES,maxTotalFileSize:QUALITY_EVIDENCE_MAX_BYTES*QUALITY_EVIDENCE_MAX_FILES,allowEmptyFiles:false});return new Promise((resolve,reject)=>form.parse(req,(error,_fields,files)=>error?reject(error):resolve([...(Array.isArray(files.files)?files.files:files.files?[files.files]:[])])));}
async function removeTemps(files){await Promise.all((files||[]).map(file=>fs.unlink(file.filepath).catch(()=>{})));}

async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!allowed(req.user))return res.status(403).json({success:false,error:'영업·수입 업무 권한이 필요합니다.'});
 try{
  const year=yearOf(req.query.year);await ready();
  if(req.method==='GET'){
   const key=String(req.query.evidenceKey||'').toLowerCase();if(!uuid.test(key))return res.status(400).json({success:false,error:'증거 이미지를 다시 선택하세요.'});
   const r=await query(`SELECT TOP(1) e.FileName,e.MimeType,e.Content FROM dbo.WebFarmQualityEvidence e
    LEFT JOIN dbo.WebFarmQualityEvent v ON v.EventKey=e.EventKey
    LEFT JOIN dbo.WebFarmQualityCase c ON c.CaseKey=v.CaseKey
    WHERE e.EvidenceKey=@key AND e.OrderYear=@year AND ((e.EventKey IS NOT NULL AND c.OrderYear=@year) OR (e.EventKey IS NULL AND e.CreatedBy=@user AND e.ExpiresAt>SYSUTCDATETIME()))`,{key:uid(key),year:num(year),user:nv(req.user.userId)});
   const image=r.recordset[0];if(!image)return res.status(404).json({success:false,error:'이미지를 찾지 못했거나 접근 시간이 지났습니다.'});
   res.setHeader('Content-Type',image.MimeType);res.setHeader('Content-Length',Buffer.from(image.Content).length);res.setHeader('X-Content-Type-Options','nosniff');return res.send(Buffer.from(image.Content));
  }
  if(!sameOrigin(req))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
  if(req.method==='DELETE'){
   const key=String(req.query.evidenceKey||'').toLowerCase();if(!uuid.test(key))return res.status(400).json({success:false,error:'증거 이미지를 다시 선택하세요.'});
   const r=await query('DELETE dbo.WebFarmQualityEvidence WHERE EvidenceKey=@key AND OrderYear=@year AND CreatedBy=@user AND EventKey IS NULL',{key:uid(key),year:num(year),user:nv(req.user.userId)});
   return res.json({success:true,removed:Number(r.rowsAffected?.[0]||0)>0});
  }
  if(req.method==='POST'){
   let files=[];
   try{
    files=await parseFiles(req);if(!files.length)throw new Error('업로드할 이미지를 선택하거나 붙여넣으세요.');
    const prepared=[];
    for(const file of files){const content=await fs.readFile(file.filepath);const detected=detectEvidenceImage(content);if(!detected)throw new Error('JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.');prepared.push({key:crypto.randomUUID(),content,mime:detected.mime,fileName:evidenceFileName(file.originalFilename,detected.extension)});}
    await withTransaction(async q=>{
     await q('DELETE dbo.WebFarmQualityEvidence WHERE EventKey IS NULL AND ExpiresAt<SYSUTCDATETIME()');
     for(const item of prepared)await q(`INSERT dbo.WebFarmQualityEvidence(EvidenceKey,OrderYear,EventKey,FileName,MimeType,ByteSize,Content,CreatedBy,ExpiresAt)
      VALUES(@key,@year,NULL,@name,@mime,@size,@content,@user,DATEADD(hour,24,SYSUTCDATETIME()))`,{key:uid(item.key),year:num(year),name:nv(item.fileName),mime:nv(item.mime),size:num(item.content.length),content:bin(item.content),user:nv(req.user.userId)});
    });
    return res.json({success:true,images:prepared.map(item=>({evidenceKey:item.key,fileName:item.fileName,mimeType:item.mime,byteSize:item.content.length}))});
   }finally{await removeTemps(files);}
  }
  res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({success:false,error:'GET/POST/DELETE만 지원합니다.'});
 }catch(e){const tooLarge=e?.code===1009||/maxFileSize|maxTotalFileSize/i.test(String(e?.message));return res.status(tooLarge?413:400).json({success:false,error:tooLarge?'이미지 한 장은 10MB 이하만 업로드할 수 있습니다.':e.message});}
}
export default withAuth(handler);
