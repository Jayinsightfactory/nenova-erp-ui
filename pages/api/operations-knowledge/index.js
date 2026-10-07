import { withAuth } from '../../../lib/auth';
import { readKnowledge, mutateKnowledge } from '../../../lib/operationsKnowledgeStore';
import { assertKnowledgeOrigin, knowledgeApiError } from '../../../lib/operationsKnowledgeApi';

export const config={api:{bodyParser:{sizeLimit:'1mb'},responseLimit:'8mb'}};
export const createKnowledgeHandler = ({read=readKnowledge,mutate=mutateKnowledge}={}) => async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.user?.accountActive===false)return res.status(403).json({success:false,error:'비활성 계정은 접근할 수 없습니다.'});
  try {
    if(req.method==='GET')return res.status(200).json({success:true,...await read()});
    if(req.method==='POST') {
      assertKnowledgeOrigin(req);
      if(Number(req.headers?.['content-length'])>1024*1024)return res.status(413).json({success:false,error:'요청이 너무 큽니다.'});
      return res.status(200).json({success:true,...await mutate(req.body,{actor:req.user})});
    }
    res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});
  } catch(error) {return knowledgeApiError(res,error);}
};
export default withAuth(createKnowledgeHandler());
