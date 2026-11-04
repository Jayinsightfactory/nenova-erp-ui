import {withAuth} from '../../../lib/auth';
import activityStore from '../../../lib/userActivityStore.cjs';
export default withAuth(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false});}
  try{
    const result=await activityStore.listEvents({date:req.query.date,limit:req.query.limit,cursor:req.query.cursor,userId:req.user.userId});
    return res.status(200).json({success:true,...result,items:result.items.map(({userId,userName,sessionId,...row})=>row)});
  }catch(error){return res.status(error.message.startsWith('INVALID_')?400:503).json({success:false,error:'버튼 작업 기록을 불러오지 못했습니다.'});}
});
