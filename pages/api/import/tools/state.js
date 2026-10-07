import { withAuth } from '../../../../lib/auth';
import {readImportTeamRecord,writeImportTeamRecord,listImportTeamHistory} from '../../../../lib/importTeamStore';
import aliasSeed from '../../../../data/import-team/aliases-seed.json';
export const config={api:{bodyParser:{sizeLimit:'6mb'},responseLimit:'10mb'}};
export default withAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.user?.accountActive===false)return res.status(403).json({success:false,error:'비활성 계정은 공동 자료에 접근할 수 없습니다.'});
  try {
    if(req.method==='GET') {
      if(!req.query.key) return res.json({success:true,history:await listImportTeamHistory()});
      const record=await readImportTeamRecord(req.query.key);
      if(record.key==='packing.aliases'&&record.revision===0)record.value=aliasSeed;
      return res.json({success:true,...record});
    }
    if(req.method==='PUT') return res.json({success:true,...await writeImportTeamRecord(req.query.key,{value:req.body?.value,expectedRevision:req.body?.expectedRevision,actor:req.user})});
    res.setHeader('Allow','GET, PUT');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});
  }catch(e){return res.status(e.statusCode||500).json({success:false,error:e.statusCode?e.message:'공동 자료 저장에 실패했습니다.'});}
});
