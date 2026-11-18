// In-memory synthetic history for isolated UI tests/guide capture. No disk/DB/API.
module.exports.createPackingHistoryFixture=()=>{
 const records=new Map(),files=new Map(),latest=new Map();
 const summary=r=>({id:r.id,uploadId:r.uploadId,sourceHash:r.sourceHash,at:r.at,country:r.snapshot.country,fileName:r.snapshot.fileName,hasAnalysis:Boolean(r.snapshot.lastExtraction?.result?.invoices?.length)});
 return {records,files,handle(req){
  const u=new URL(req.url());if(u.pathname!=='/api/import/tools/upload-history')return null;
  if(req.method()==='POST'){
   const b=JSON.parse(req.postData());if(b.fileBase64)files.set(b.sourceHash,b.fileBase64);
   const r={...b,at:new Date().toISOString()};records.set(r.id,r);latest.set(r.uploadId,r);
   return {success:true,record:summary(r)};
  }
  const id=u.searchParams.get('id');
  if(id){const r=records.get(id);return {success:true,record:r?{...r,fileBase64:files.get(r.sourceHash)}:null};}
  return {success:true,rows:[...latest.values()].map(summary).sort((a,b)=>b.at.localeCompare(a.at))};
 }};
};
