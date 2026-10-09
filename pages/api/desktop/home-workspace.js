import {withAuth} from '../../../lib/auth';
import {desktopHomeWorkspace} from '../../../lib/desktopHomeWorkspace.js';
export const config={api:{bodyParser:{sizeLimit:'16kb'},responseLimit:'2mb'}};
export const createDesktopHomeHandler=({workspace=desktopHomeWorkspace}={})=>async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie, Authorization');
  if(!req.user?.userId||req.user.accountActive===false)return res.status(403).json({success:false,code:'ACCOUNT_INACTIVE',error:'활성 로그인 계정이 필요합니다.'});
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});}
  const expected=req.method==='GET'?req.query.expectedOwnerId:req.body?.expectedOwnerId;
  if(expected!==undefined&&expected!==req.user.userId)return res.status(403).json({success:false,code:'ACCOUNT_CHANGED',error:'로그인 계정이 변경되었습니다.'});
  try {
    if(req.method==='POST'){
      if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
      const {expectedOwnerId,...command}=req.body||{};
      return res.status(200).json(await workspace(req.user,req.query,command));
    }
    return res.status(200).json(await workspace(req.user,req.query));
  }catch(e){return res.status(e.statusCode||500).json({success:false,error:e.statusCode?e.message:'개인 업무를 불러오거나 저장하지 못했습니다.'});}
};
export default withAuth(createDesktopHomeHandler());
