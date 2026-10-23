import {withAuth} from '../../../lib/auth.js';
import {withTransaction,sql} from '../../../lib/db.js';
import {weekdayPrintNotes} from '../../../lib/weekdayPrintNoteService.js';
export const config={api:{bodyParser:{sizeLimit:'16kb'}}};
export function createWeekdayPrintNoteHandler({transaction=withTransaction,types=sql,service=weekdayPrintNotes}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false});}
    try {
      const result=await transaction(q=>service.save(req.body,req.user,q,types));
      return res.status(200).json({success:true,erpChanged:false,...result});
    }catch(error){return res.status(error.statusCode||error.status||500).json({success:false,code:error.code||'PRINT_NOTE_FAILED',error:error.statusCode||error.status?error.message:'적요 저장에 실패했습니다. 입력을 유지한 채 다시 저장하세요.'});}
  };
}
export default withAuth(createWeekdayPrintNoteHandler());
