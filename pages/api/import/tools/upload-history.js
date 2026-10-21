import {withAuth} from '../../../../lib/auth';
import {listPackingUploads,readPackingUpload,savePackingUpload} from '../../../../lib/packingSharedHistory';
export const config={api:{bodyParser:{sizeLimit:'72mb'},responseLimit:'72mb'}};
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.user?.accountActive===false)return res.status(403).json({success:false,error:'비활성 계정입니다.'});
 try{
  if(req.method==='GET')return res.json({success:true,...(req.query.id?{record:await readPackingUpload(req.query.id)}:{rows:await listPackingUploads()})});
  if(req.method==='POST'){
   if(String(req.body?.expectedUserId||'')!==String(req.user.userId))return res.status(409).json({success:false,error:'로그인 계정이 변경되었습니다. 새로고침하세요.'});
   if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({success:false,error:'JSON 요청이 필요합니다.'});
   if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({success:false,error:'같은 사이트에서 요청하세요.'});
   return res.json({success:true,record:await savePackingUpload(req.body,req.user.userId)});
  }
  res.setHeader('Allow','GET, POST');return res.status(405).end();
 }catch(e){return res.status(e.statusCode||500).json({success:false,error:e.statusCode?e.message:'업로드 이력 보관/조회에 실패했습니다. 현재 작업은 유지됩니다.'});}
});
