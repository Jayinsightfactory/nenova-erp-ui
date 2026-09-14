import {withAuth} from '../../../lib/auth';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from '../../../lib/salesDefectDeductionCore';
import {canDeleteFarmQuality} from '../../../lib/farmQuality';
import {deleteQualityCase,loadQuality,qualityEvents,saveQuality} from '../../../lib/farmQualityStore';
export const config={api:{bodyParser:{sizeLimit:'24kb'}}};
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(req.user.accountActive===false||![canUseDefectIncoming,canUseDefectSales,canUseDefectSupport].some(fn=>fn(req.user)))return res.status(403).json({success:false,error:'영업·수입 업무 권한이 필요합니다.'});
 try{
  if(req.method==='GET')return res.json({success:true,...(req.query.caseKey?{events:await qualityEvents(req.query.caseKey,req.query.year)}:await loadQuality(req.query)),canManage:canUseDefectIncoming(req.user),canDelete:canDeleteFarmQuality(req.user),author:{name:req.user.userName||req.user.userId,department:req.user.deptName||'부서 미지정'}});
  if(req.method==='POST'){
   if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
   return res.json({success:true,...await saveQuality(req.body,req.user)});
  }
  if(req.method==='DELETE'){
   if(!canDeleteFarmQuality(req.user))return res.status(403).json({success:false,error:'피드백 삭제는 nenovaSS3 관리자만 가능합니다.',code:'FARM_QUALITY_DELETE_ADMIN_ONLY'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
   return res.json({success:true,...await deleteQualityCase(req.body,req.user)});
  }
  res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({success:false,error:'GET/POST/DELETE만 지원합니다.'});
 }catch(e){return res.status(e.code==='QUALITY_STALE'?409:400).json({success:false,error:e.message,code:e.code==='QUALITY_STALE'?e.code:undefined});}
});
