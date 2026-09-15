import {withAuth} from '../../../lib/auth';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from '../../../lib/salesDefectDeductionCore';
import {canDeleteFarmQuality} from '../../../lib/farmQuality';
import {deleteQualityCase,loadQuality,qualityEvents,saveQuality,saveQualityInboxEvent,setQualityInboxExclusion} from '../../../lib/farmQualityStore';
export const config={api:{bodyParser:{sizeLimit:'24kb'}}};
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(req.user.accountActive===false||![canUseDefectIncoming,canUseDefectSales,canUseDefectSupport].some(fn=>fn(req.user)))return res.status(403).json({success:false,error:'영업·수입 업무 권한이 필요합니다.'});
 try{
  if(req.method==='GET')return res.json({success:true,...(req.query.caseKey?{events:await qualityEvents(req.query.caseKey,req.query.year)}:await loadQuality(req.query)),canManage:canUseDefectIncoming(req.user),canDelete:canDeleteFarmQuality(req.user),author:{name:req.user.userName||req.user.userId,department:req.user.deptName||'부서 미지정'}});
  if(req.method==='POST'){
   if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
   if(req.body.action==='inboxEvent')return res.json({success:true,...await saveQualityInboxEvent(req.body,req.user)});
   if(['inboxExclude','inboxRestore'].includes(req.body.action))return res.json({success:true,...await setQualityInboxExclusion({...req.body,action:req.body.action==='inboxExclude'?'exclude':'restore'},req.user)});
   return res.json({success:true,...await saveQuality(req.body,req.user)});
  }
  if(req.method==='DELETE'){
   if(!canDeleteFarmQuality(req.user))return res.status(403).json({success:false,error:'피드백 삭제는 nenovaSS3 관리자만 가능합니다.',code:'FARM_QUALITY_DELETE_ADMIN_ONLY'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
   return res.json({success:true,...await deleteQualityCase(req.body,req.user)});
  }
  res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({success:false,error:'GET/POST/DELETE만 지원합니다.'});
 }catch(e){
  if(req.method==='POST')console.error('[farm-quality-save-error]',JSON.stringify({action:req.body?.action,caseKey:req.body?.caseKey||null,orderYear:req.body?.year||null,requestId:req.body?.requestId||null,actorId:req.user?.userId,error:e.message,number:e.number||e.originalError?.number||null}));
  return res.status(e.code==='INBOX_FORBIDDEN'?403:['QUALITY_STALE','INBOX_STALE','INBOX_TARGET_REQUIRED'].includes(e.code)?409:400).json({success:false,error:e.message,code:e.code==='QUALITY_STALE'||String(e.code||'').startsWith('INBOX_')?e.code:undefined,details:String(e.code||'').startsWith('INBOX_')?e.details:undefined});
 }
});
