const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'packing-history-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {api:await import('../lib/packingSharedHistory.js'),options:{root}};
}
function input(){
 const bytes=Buffer.from('%PDF-1.7 fixture');
 return {id:randomUUID(),uploadId:randomUUID(),sourceHash:createHash('sha256').update(bytes).digest('hex'),fileBase64:bytes.toString('base64'),snapshot:{fileName:'2026-42-01.pdf',fileType:'application/pdf',lastModified:1,country:'CN',lastExtraction:null,reviewConfirmed:false,legacyPackingReviewRequired:false}};
}
test('original-only upload is team-readable, immutable and idempotent',async t=>{
 const {api,options}=await setup(t),request=input();
 const saved=await api.savePackingUpload(request,'staff-a',options);
 assert.equal(saved.actor,'staff-a');assert.equal(saved.hasAnalysis,false);
 assert.deepEqual(await api.savePackingUpload(request,'staff-a',options),saved);
 assert.equal((await api.listPackingUploads(options)).length,1);
 assert.equal((await api.readPackingUpload(saved.id,options)).fileBase64,request.fileBase64);
 await assert.rejects(api.savePackingUpload({...request,snapshot:{...request.snapshot,country:'CO'}},'staff-b',options),/내용이 다릅니다/);
});
test('new staff revision preserves old revision and strips ERP write authority',async t=>{
 const {api,options}=await setup(t),request=input();await api.savePackingUpload(request,'staff-a',options);
 const next={...request,id:randomUUID(),fileBase64:undefined,snapshot:{...request.snapshot,lastExtraction:{sourceHash:request.sourceHash,result:{invoices:[{year:2026,week:'42-01',canCommit:true,operationId:'do-not-restore',items:[]}]},sourceInvoices:[]}}};
 const saved=await api.savePackingUpload(next,'staff-b',{...options,now:()=>new Date('2099-01-01')});
 assert.equal((await api.listPackingUploads(options))[0].actor,'staff-b');
 const detail=await api.readPackingUpload(saved.id,options);
 assert.equal(detail.snapshot.lastExtraction.result.invoices[0].canCommit,undefined);
 assert.equal(detail.snapshot.lastExtraction.result.invoices[0].operationId,undefined);
 assert.equal((await api.readPackingUpload(request.id,options)).hasAnalysis,false);
});
test('different years with same week never merge',async t=>{
 const {api,options}=await setup(t);
 for(const year of [2025,2026]){const request=input();request.snapshot.fileName=`${year}-42-01.pdf`;request.snapshot.lastExtraction={result:{invoices:[{year,week:'42-01'}]}};await api.savePackingUpload(request,'staff',options);}
 assert.equal((await api.listPackingUploads(options)).length,2);
});
test('rejects traversal, mismatched files, nested evidence hashes and invalid originals',async t=>{
 const {api,options}=await setup(t),request=input();
 await assert.rejects(api.readPackingUpload('../private',options),/식별자/);
 await assert.rejects(api.savePackingUpload({...request,sourceHash:'0'.repeat(64)},'staff',options),/해시/);
 await assert.rejects(api.savePackingUpload({...request,snapshot:{...request.snapshot,lastExtraction:{result:{invoices:[{pdfSourceHash:'0'.repeat(64)}]}}}},'staff',options),/원본/);
 await assert.rejects(api.savePackingUpload({...request,fileBase64:undefined,sourceHash:'1'.repeat(64)},'staff',options),/먼저/);
 await assert.rejects(api.savePackingUpload({...request,fileBase64:'===='},'staff',options));
});
test('API and UI recovery never call ERP commit; account changes are guarded',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../pages/api/import/tools/upload-history.js'),'utf8');
 assert.match(source,/withAuth/);assert.match(source,/expectedUserId/);assert.match(source,/accountActive/);
 assert.doesNotMatch(source,/getPool|mssql|receipts\/commit|usp_Stock/);
 const client=await fs.readFile(path.join(__dirname,'../lib/packingSharedHistoryClient.js'),'utf8');
 assert.doesNotMatch(client,/receipts\/|canCommit/);
});
