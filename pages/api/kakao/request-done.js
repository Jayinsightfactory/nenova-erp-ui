import {withAuth} from '../../../lib/auth';
import {createKakaoDoneStore} from '../../../lib/distributionKakaoDoneStore';
const store=createKakaoDoneStore();
const KEY=/^[a-f0-9]{64}$/;
export const config={api:{bodyParser:{sizeLimit:'8kb'}}};
export default withAuth(async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.user?.accountActive===false)return res.status(403).json({error:'비활성 계정입니다.'});
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'조회·완료 표시만 가능합니다.'});}
 if(req.method==='POST'&&req.headers.origin){
  try{const origin=new URL(req.headers.origin),host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();const protocol=String(req.headers['x-forwarded-proto']||(req.socket?.encrypted?'https':'http')).split(',')[0].trim();if(origin.origin!==protocol+'://'+host)throw Error();}
  catch{return res.status(403).json({error:'같은 사이트에서만 저장할 수 있습니다.'});}
 }
 try{
  if(req.method==='GET'){
   const keys=String(req.query.keys||'').split(',').filter(Boolean);
   if(keys.length>100||keys.some(k=>!KEY.test(k)))return res.status(400).json({error:'조회할 요청을 확인하세요.'});
   return res.json({ok:true,states:await Promise.all([...new Set(keys)].map(k=>store.read(k)))});
  }
  if(Object.keys(req.body||{}).some(k=>!['key','done','expectedRevision','requestId'].includes(k)))return res.status(400).json({error:'작업완료 표시만 저장할 수 있습니다.'});
  return res.json({ok:true,state:await store.save(req.body||{})});
 }catch(e){return res.status(e.statusCode||503).json({error:e.statusCode?e.message:'작업완료 표시를 저장하지 못했습니다.',...(e.current?{current:e.current}:{})});}
});
