import {withAuth} from '../../../lib/auth';
import {companyCalendar} from '../../../lib/companyCalendarStore.js';
export const config={api:{bodyParser:{sizeLimit:'16kb'},responseLimit:'2mb'}};
export const createCompanyCalendarHandler=({workspace=companyCalendar}={})=>async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie, Authorization');
  if(!req.user?.userId||req.user.accountActive===false)return res.status(403).json({success:false,code:'ACCOUNT_INACTIVE',error:'활성 로그인 계정이 필요합니다.'});
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});}
  const expected=req.method==='GET'?req.query.expectedOwnerId:req.body?.expectedOwnerId;
  if(expected!==req.user.userId)return res.status(403).json({success:false,code:'ACCOUNT_CHANGED',error:'로그인 계정이 변경되었습니다.'});
  try{
    if(req.method==='POST'){
      if(!req.headers.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
      const {expectedOwnerId,command,query}=req.body||{};
      if(!command||typeof command!=='object'||Array.isArray(command))return res.status(400).json({success:false,error:'저장할 공통 일정을 확인하세요.'});
      return res.status(200).json(await workspace(req.user,query,command));
    }
    return res.status(200).json(await workspace(req.user,req.query));
  }catch(e){return res.status(e.statusCode||500).json({success:false,error:e.statusCode?e.message:'공통 일정을 읽거나 저장하지 못했습니다.'});}
};
export default withAuth(createCompanyCalendarHandler());
