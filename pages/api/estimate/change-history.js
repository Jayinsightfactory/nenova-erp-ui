import {withAuth} from '../../../lib/auth';
import {estimateChangeHistory as service} from '../../../lib/estimateChangeHistory';
import core from '../../../lib/estimateChangeHistoryCore.cjs';
import disk from '../../../lib/estimateChangeHistoryStore.cjs';
import workbook from '../../../lib/estimateChangeHistoryWorkbook.cjs';
export const config={api:{bodyParser:{sizeLimit:'128kb'},responseLimit:'16mb'}};
export default withAuth(async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method==='GET'){
   const input=req.query,view=input.view||'state';
   const reads={state:()=>service.state(input),customers:()=>service.customers(input),source:()=>service.source(input),capture:()=>service.captured(input,input.id),calendar:()=>service.calendar(input)};
   if(!reads[view])throw core.fail('조회 종류를 확인하세요.');
   return res.status(200).json({success:true,data:await reads[view](),actor:{id:req.user.userId,name:req.user.userName||''}});
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});}
  const body=req.body||{},action=body.action;
  if(action==='export'||action==='preview'){
   const entries=await service.selected(body,body.ids),printDate=core.date(body.printDate,{required:true}),writer=req.user.userName||req.user.userId,token=disk.hash({entries,date:printDate,writer});
   if(action==='preview'){const file=await workbook.exportWorkbook(entries,{date:printDate,writer});return res.status(200).json({success:true,data:{entries,token,file:file.toString('base64'),generatedAt:new Date().toISOString()}});}
   if(body.previewToken!==token)throw core.fail('출력할 기록이 바뀌었습니다. 미리보기를 다시 조회하세요.',409);
   const bytes=await workbook.exportWorkbook(entries,{date:printDate,writer});
   res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(`견적_변경요청서_${body.year}_${body.week}차_${printDate}.xlsx`)}`);return res.status(200).send(bytes);
  }
  const writes={impact:service.impact,confirmProgress:service.progress,capture:service.capture,downloadRequested:service.download,confirmUpload:service.upload,recordChange:service.change,linkEntry:service.link};
  if(!writes[action])throw core.fail('기록 종류를 확인하세요.');
  return res.status(200).json({success:true,data:await writes[action](body,req.user)});
 }catch(error){const status=error.statusCode||503;if(!error.statusCode)console.error('[estimate-change-history]',error.code||error.name);return res.status(status).json({success:false,error:error.statusCode?error.message:'기록을 읽거나 저장하지 못했습니다. 다시 확인하세요.'});}
});
