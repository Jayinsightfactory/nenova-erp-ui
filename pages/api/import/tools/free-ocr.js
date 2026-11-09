import {withAuth} from '../../../../lib/auth';
import {createRapidOcrJob,getRapidOcrJob} from '../../../../lib/importRapidOcrJobs';
export const config={api:{bodyParser:{sizeLimit:'28mb'},responseLimit:'9mb'}};
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 const uid=req.user?.userId;if(!uid||req.user?.accountActive===false)return res.status(403).json({success:false,error:'로그인 계정을 확인하세요.'});
 try{
  if(req.method==='POST'){
   if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({success:false,error:'JSON 요청이 필요합니다.'});
   if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({success:false,error:'같은 사이트에서 실행하세요.'});
   return res.status(202).json({success:true,job:await createRapidOcrJob(String(uid),req.body||{})});
  }
  if(req.method==='GET'){const job=await getRapidOcrJob(String(uid),req.query.jobId);return res.status(job?200:404).json(job?{success:true,job}:{success:false,error:'같은 계정의 OCR 작업을 찾을 수 없습니다.'});}
  return res.status(405).json({success:false,error:'GET 또는 POST만 지원합니다.'});
 }catch(e){return res.status(e.statusCode||503).json({success:false,error:e.statusCode?e.message:'무료 OCR 저장소를 사용할 수 없습니다. 파일은 유지됩니다.'});}
});
