import {CLOUD_MAPPING_KEY,cloudMappingFarm,validateCloudMappingValue,validateCloudMappingEntry} from './cloudCostMappings.js';
import {readImportTeamRecord,writeImportTeamRecord} from './importTeamStore.js';
import {readNativeCostSource} from './nativeReceiptCost.js';

export function createCloudCostMappingHandler({authorize,queryFn,types,readRecord=readImportTeamRecord,writeRecord=writeImportTeamRecord,readSource=readNativeCostSource}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.user?.accountActive===false||!authorize(req.user))return res.status(403).json({success:false,error:'수입부 원가 매칭 권한이 필요합니다.'});
  if(!['GET','POST'].includes(req.method))return res.status(405).json({success:false,error:'GET/POST만 지원합니다.'});
  try{
   const request=req.method==='GET'?{...req.query,warehouseKeys:String(req.query.warehouseKeys??'').split(',').filter(Boolean).map(Number)}:req.body;
   if(!Array.isArray(request?.warehouseKeys)||!request.warehouseKeys.length||request.warehouseKeys.length>100||request.warehouseKeys.some(k=>!Number.isSafeInteger(k)||k<=0)||new Set(request.warehouseKeys).size!==request.warehouseKeys.length)throw Object.assign(Error('선택 입고 목록을 확인하세요.'),{statusCode:400});
   const products=new Set();
   for(const warehouseKey of request.warehouseKeys){
    const source=await readSource({queryFn,types,input:{orderYear:request.orderYear,orderWeek:request.orderWeek,warehouseKey}});
    if(source.country!=='CN'||!cloudMappingFarm(source.farmName))throw Object.assign(Error('중국 CLOUD 입고에만 매칭을 저장할 수 있습니다.'),{statusCode:400});
    source.lines.forEach(l=>{if(l.prodKey>0&&[0,false].includes(l.productDeleted))products.add(l.prodKey);});
   }
   const current=await readRecord(CLOUD_MAPPING_KEY);
   const value=current.value??{version:1,entries:[]};validateCloudMappingValue(value);
   let saved=current;
   if(req.method==='POST'){
    if(!Array.isArray(request.entries)||!request.entries.length||request.entries.length>1000)throw Object.assign(Error('저장할 품목 매칭을 선택하세요.'),{statusCode:400});
    const selected=request.entries.map(e=>validateCloudMappingEntry(e));
    if(new Set(selected.map(e=>e.prodKey)).size!==selected.length||selected.some(e=>!products.has(e.prodKey)))throw Object.assign(Error('현재 입고의 활성 품목만 중복 없이 저장하세요.'),{statusCode:400});
    const keys=new Set(selected.map(e=>e.prodKey));
    const next={version:1,entries:[...value.entries.filter(e=>!keys.has(e.prodKey)),...selected]};validateCloudMappingValue(next);
    saved=await writeRecord(CLOUD_MAPPING_KEY,{value:next,expectedRevision:request.expectedRevision,actor:req.user});
   }
   return res.json({success:true,revision:saved.revision,entries:(saved.value?.entries??value.entries).filter(e=>products.has(e.prodKey)),scope:{country:'CN',farm:'CLOUDLAND'},persisted:req.method==='POST'});
  }catch(e){const status=[400,403,404,409,413,422].includes(e.statusCode)?e.statusCode:503;return res.status(status).json({success:false,error:status===503?'공유 매칭을 저장·조회하지 못했습니다. 입력은 유지됩니다.':e.message});}
 };
}
