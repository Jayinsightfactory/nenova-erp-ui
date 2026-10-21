// Audit-only whitelist; extra source documents and caller actor fields are ignored.
export const uploadIssueLabels={UPLOAD_FAILED:'파일 분석·준비 실패',MATCH_REQUIRED:'품목 매칭 확인 필요',TOTAL_MISMATCH:'원문 합계와 변환 합계 불일치',REVIEW_BLOCKED:'원문·날짜 확인 단계 차단',PREPARE_BLOCKED:'입고 준비 단계 차단'};
export function normalizeUploadIssue(b={}) {
 if(!/^[0-9a-f-]{36}$/i.test(b.eventId||'')||typeof b.fileName!=='string'||b.fileName.length>260||!Object.hasOwn(uploadIssueLabels,b.code)||!Number.isSafeInteger(b.count)||b.count<0||b.count>100000)throw Error('문제 로그 형식을 확인하세요.');
 const result={eventId:b.eventId,fileName:b.fileName.replace(/[\r\n\x00]/g,''),code:b.code,count:b.count};
 if(b.detail!==undefined){if(typeof b.detail!=='string'||b.detail.length>2000)throw Error('문제 로그 상세는 2,000자 이내여야 합니다.');result.detail=b.detail.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');}
 return result;
}
export async function appendUploadIssue({withTransaction,sql,actor,input}) {
 const payload=normalizeUploadIssue(input);
 await withTransaction(async q=>{
  const p={actor:{type:sql.NVarChar(100),value:actor},id:{type:sql.NVarChar(36),value:payload.eventId},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(payload)}};
  await q(`DECLARE @r int; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; IF @r<0 THROW 51000,N'문제 로그 잠금 대기',1;`,{resource:{type:sql.NVarChar(255),value:`invoice-upload-log:${actor}:${payload.eventId}`}});
  const found=await q(`SELECT LogKey FROM SystemActionLog WHERE ActionType='INVOICE_UPLOAD_ISSUE' AND Actor=@actor AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE '{}' END,'$.eventId')=@id`,p);
  if(!found.recordset.length)await q(`INSERT INTO SystemActionLog (Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES (@actor,'INVOICE_UPLOAD_ISSUE','POST','/api/import/upload-issues','-',0,@payload,'FAIL',N'업로드 검토 필요 · 전산 입고 저장 아님','LOW')`,p);
 });
}
