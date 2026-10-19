import {withAuth} from '../../../lib/auth';
import {query,withTransaction,sql} from '../../../lib/db';
import {canManageInvoiceReceipt} from '../../../lib/invoiceReceiptAccess';
export default withAuth(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,error:'수입부 작업 권한이 필요합니다.'});
 if(req.method==='GET'){
  const rows=await query(`SELECT TOP (50) LogKey,ActionDtm,Actor,Payload FROM SystemActionLog WHERE ActionType='INVOICE_UPLOAD_ISSUE' ORDER BY LogKey DESC`);
  return res.json({success:true,rows:rows.recordset.map(r=>{let payload={};try{payload=JSON.parse(r.Payload);}catch{}return {id:r.LogKey,at:r.ActionDtm,actor:r.Actor,...payload};})});
 }
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
 const b=req.body||{};
 if(!/^[0-9a-f-]{36}$/i.test(b.eventId||'')||typeof b.fileName!=='string'||b.fileName.length>260||!['UPLOAD_FAILED','MATCH_REQUIRED','TOTAL_MISMATCH'].includes(b.code)||!Number.isSafeInteger(b.count)||b.count<0||b.count>100000)return res.status(400).json({success:false,error:'문제 로그 형식을 확인하세요.'});
 const payload={eventId:b.eventId,fileName:b.fileName.replace(/[\r\n\x00]/g,''),code:b.code,count:b.count};
 await withTransaction(async q=>{
  const p={actor:{type:sql.NVarChar(100),value:req.user.userId},id:{type:sql.NVarChar(36),value:b.eventId},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(payload)}};
  // Serialized duplicate check: retry is an audit-only operation, never a receipt request.
  await q(`DECLARE @r int; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; IF @r<0 THROW 51000,N'문제 로그 잠금 대기',1;`,{resource:{type:sql.NVarChar(255),value:`invoice-upload-log:${req.user.userId}:${b.eventId}`}});
  const found=await q(`SELECT LogKey FROM SystemActionLog WHERE ActionType='INVOICE_UPLOAD_ISSUE' AND Actor=@actor AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE '{}' END,'$.eventId')=@id`,p);
  if(!found.recordset.length)await q(`INSERT INTO SystemActionLog (Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES (@actor,'INVOICE_UPLOAD_ISSUE','POST','/api/import/upload-issues','-',0,@payload,'FAIL',N'업로드 검토 필요 · 전산 입고 저장 아님','LOW')`,p);
 });
 return res.json({success:true});
});
