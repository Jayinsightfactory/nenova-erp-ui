import {withAuth} from '../../../lib/auth';
import {query,withTransaction,sql} from '../../../lib/db';
import {canManageInvoiceReceipt} from '../../../lib/invoiceReceiptAccess';
import {normalizeUploadIssue,appendUploadIssue} from '../../../lib/invoiceUploadIssue';
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,error:'수입부 작업 권한이 필요합니다.'});
 if(req.method==='GET'){
  const rows=await query(`SELECT TOP (50) LogKey,CONVERT(varchar(33),ActionDtm,126)+'+09:00' AS ActionDtm,Actor,Payload FROM SystemActionLog WHERE ActionType='INVOICE_UPLOAD_ISSUE' ORDER BY LogKey DESC`);
  return res.json({success:true,rows:rows.recordset.map(r=>{let payload={};try{payload=JSON.parse(r.Payload);}catch{}return {id:r.LogKey,at:r.ActionDtm,actor:r.Actor,...payload};})});
 }
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
 const b=req.body||{};
 let payload;try{payload=normalizeUploadIssue(b);}catch(e){return res.status(400).json({success:false,error:e.message});}
 await appendUploadIssue({withTransaction,sql,actor:req.user.userId,input:payload});
 return res.json({success:true});
});
