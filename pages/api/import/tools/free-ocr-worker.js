import crypto from 'node:crypto';
import {claimRapidOcrJob,finishRapidOcrJob} from '../../../../lib/importRapidOcrJobs';
export const config={api:{bodyParser:{sizeLimit:'9mb'},responseLimit:'30mb'}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 const want=process.env.ORBIT_DRIVE_INGEST_TOKEN||'',got=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const a=Buffer.from(want),b=Buffer.from(got);
 if(!a.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).json({success:false,error:'워커 인증을 확인하세요.'});
 try{
  if(req.method==='GET')return res.json({success:true,job:await claimRapidOcrJob()});
  if(req.method==='POST'){await finishRapidOcrJob(req.body||{});return res.json({success:true});}
  return res.status(405).json({success:false,error:'GET 또는 POST만 지원합니다.'});
 }catch(e){return res.status(e.statusCode||503).json({success:false,error:e.statusCode?e.message:'OCR 작업 저장에 실패했습니다.'});}
}
