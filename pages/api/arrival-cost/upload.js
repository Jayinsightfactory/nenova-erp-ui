// Reviewed uploads retain original bytes; no ERP table writes.
import fs from 'node:fs';
import formidable from 'formidable';
import * as XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth.js';
import { query } from '../../../lib/db.js';
import { parseArrivalCostWorkbook } from '../../../lib/arrivalCostExcel.js';
import { createArrivalCostImport } from '../../../lib/arrivalCost.js';
import { loadMappings } from '../../../lib/parseMappings.js';
import { arrivalUploadViewScope } from '../../../lib/arrivalImportPolicy.js';
import { namedCountry,prepareSheetReviews,summarizeReview,retainUpload,readReview,writeReview,originalBytes } from '../../../lib/arrivalUploadReview.js';
import { mirrorWebUpload } from '../../../lib/workDrive.js';
export const config={api:{bodyParser:false}};
const first=v=>Array.isArray(v)?v[0]:v;
export default withAuth(async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end();}
 let record;
 try{
  const [fields,files]=await new Promise((resolve,reject)=>formidable({maxFileSize:30*1024*1024,multiples:false}).parse(req,(e,f,b)=>e?reject(e):resolve([f,b])));
  const action=first(fields.action)||'preview',year=String(first(fields.orderYear)||'');
  if(!/^20\d{2}$/.test(year))throw Error('4자리 연도를 선택하세요.');
  if(action==='preview'){
   const file=first(files.file);if(!file)throw Error('엑셀 파일을 선택하세요.');
   try{if(!/\.xlsx?$/i.test(file.originalFilename||''))throw Error('xlsx/xls 파일만 지원합니다.');const bytes0=fs.readFileSync(file.filepath);record=retainUpload(bytes0,file.originalFilename,req.user);mirrorWebUpload({buffer:bytes0,filename:file.originalFilename,user:req.user,source:'arrival-cost/upload'});}finally{try{fs.unlinkSync(file.filepath)}catch{}}
  }else{record=readReview(String(first(fields.reviewId)||''),req.user);}
  if(!['preview','review','commit'].includes(action))throw Error('지원하지 않는 작업입니다.');
  if(record.stage==='COMMITTED'&&action==='commit')return res.json(record.result);
  if(record.stage==='COMMITTED')throw Error('이미 저장된 검토입니다. 새 원본으로 분석하세요.');
  const bytes=originalBytes(record);
  const [products,farms,mappings]=await Promise.all([query('SELECT ProdKey,ProdCode,ProdName,DisplayName,FlowerName,CounName,OutUnit,BunchOf1Box,SteamOf1Box,BoxWeight,BoxCBM FROM Product WHERE isDeleted=0'),query('SELECT FarmKey,FarmName,CounKey FROM Farm WHERE isDeleted=0'),loadMappings()]);
  let reviews;
  if(action==='preview'){
   const initial=parseArrivalCostWorkbook(bytes,{fileName:record.fileName,orderYear:year,orderWeek:first(fields.orderWeek),products:products.recordset,farms:farms.recordset,mappings});
   reviews=XLSX.read(bytes,{type:'buffer'}).SheetNames.map(sheetName=>{const stat=initial.sheetStats.find(s=>s.sheetName===sheetName);return {sheetName,selected:!!stat&&!/폐기|예시|견본/i.test(sheetName),country:namedCountry(record.fileName,sheetName),orderWeek:stat?.orderWeek||first(fields.orderWeek)||'',confirmYear:false};});
  }else reviews=prepareSheetReviews(JSON.parse(first(fields.sheets)||'[]'),record.fileName);
  // Preview may contain incomplete choices; validation is shown per sheet instead of losing the original.
  let parsed;
  if(action==='preview')parsed=parseArrivalCostWorkbook(bytes,{fileName:record.fileName,orderYear:year,orderWeek:first(fields.orderWeek),products:products.recordset,farms:farms.recordset,mappings});
  else parsed=parseArrivalCostWorkbook(bytes,{fileName:record.fileName,orderYear:year,products:products.recordset,farms:farms.recordset,mappings,sheetReviews:reviews});
  const review=summarizeReview(parsed,reviews,year);
  for(const s of review.sheets)if(s.selected&&!s.country)s.issues.push('국가를 선택하세요. 검역표 문구로 국가를 정하지 않습니다.');
  review.canCommit=review.canCommit&&review.sheets.every(s=>!s.selected||!s.issues.length);
  if(action==='commit'){
   if(!review.canCommit||record.reviewDigest!==review.digest||first(fields.digest)!==review.digest)throw Error('검토 내용 또는 품목·농장이 변경됐습니다. 다시 검토하세요.');
   record.stage='COMMITTING';writeReview(record);
   const saved=await createArrivalCostImport({parsed,fileName:record.fileName,user:req.user,orderYear:year,reviewSource:{id:record.id,sha:record.sha,digest:review.digest}});
   record.stage='COMMITTED';record.result={success:true,message:`도착원가 ${saved.rowCount}건 저장·대조 완료`,...saved,viewScope:arrivalUploadViewScope(parsed.rows,record.fileName)};writeReview(record);return res.json(record.result);
  }
  record.stage='REVIEWED';record.reviewDigest=review.digest;record.year=year;record.reviews=reviews;record.attempts.push({at:new Date().toISOString(),action,digest:review.digest,canCommit:review.canCommit});writeReview(record);
  return res.json({success:true,reviewId:record.id,fileName:record.fileName,sha:record.sha,...review});
 }catch(e){if(record){record.attempts.push({at:new Date().toISOString(),error:e.message,stage:record.stage});writeReview(record);}return res.status(400).json({success:false,reviewId:record?.id,error:e.message});}
});
