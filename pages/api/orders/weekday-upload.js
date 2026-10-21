import { withAuth } from '../../../lib/auth.js';
import { withTransaction, sql } from '../../../lib/db.js';
import { verifyJugwang, signJugwang, previewJugwang, applyJugwang } from '../../../lib/jugwangWeekdayUploadServer.js';
export const config={api:{bodyParser:{sizeLimit:'4mb'}}};
export default withAuth(async function handler(req,res) {
  if(req.method!=='POST') return res.status(405).end();
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.body.action==='preview') {
      const source=verifyJugwang(req.body.sourceToken,req.user.userId,'source');
      const plan=await withTransaction(q=>previewJugwang(q,sql,source,req.body.selections));
      return res.json({success:true,statuses:plan.statuses,planToken:signJugwang(plan,req.user.userId,'plan')});
    }
    if(req.body.action!=='apply') return res.status(400).json({success:false,error:'분석·검증 후 적용하세요.'});
    const plan=verifyJugwang(req.body.planToken,req.user.userId,'plan');
    return res.json(await withTransaction(q=>applyJugwang(q,sql,plan,req.user)));
  } catch(e) {return res.status(e.statusCode||409).json({success:false,error:e.message,code:e.code||'JUGWANG_UPLOAD_BLOCKED'});}
});
