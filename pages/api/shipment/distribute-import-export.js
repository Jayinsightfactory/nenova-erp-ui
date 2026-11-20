import fs from 'fs';
import {readPalletSnapshots} from '../../../lib/shipmentImportAudit';
import {addPalletSnapshots} from '../../../lib/shipmentPallet';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { verifyFarmExport, exportFarmWorkbook } from '../../../lib/shipmentFarmWorkbook';
import { exportAllocationWorkbook } from '../../../lib/shipmentImportWorkbook.js';
import { readImportFileMetadata } from '../../../lib/shipmentImportMode.js';
import { query, sql } from '../../../lib/db';
import { requireOrderYear } from '../../../lib/orderUtils';
import { fieldVolumeSql, createFieldVolumeWorkbook } from '../../../lib/shipmentFieldVolume';
import { customerExportName } from '../../../lib/customerExportName';
import { renderUploadedFieldWorkbook, loadFieldUploadDirectory } from '../../../lib/shipmentFieldUploadAsync.cjs';
import telemetry from '../../../lib/serverWorkTelemetry.cjs';

export const config={api:{bodyParser:false,responseLimit:'40mb'}};
async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).end();
  let file;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const disconnected = () => { if (!res.writableEnded) cancel(); };
  req.once('aborted', cancel);
  res.once('close', disconnected);
  try {
    const [fields,files]=await telemetry.measure('multipart',()=>formidable({maxFileSize:30*1024*1024,maxFieldsSize:4*1024*1024,multiples:false}).parse(req));
    file=Array.isArray(files.file)?files.file[0]:files.file;
    if(!file)throw Object.assign(new Error('원본 엑셀 파일이 필요합니다.'),{statusCode:400});
    const field=name=>Array.isArray(fields[name])?fields[name][0]:fields[name];
    const mode=field('mode');
    let output,verifiedKind;
    if(mode==='field-upload') {
      if(!/\.xlsx$/i.test(file.originalFilename||''))throw new Error('바로 생성은 .xlsx 물량표를 선택하세요.');
      const metadata=readImportFileMetadata(XLSX.readFile(file.filepath,{bookProps:true,bookSheets:true}));
      if(metadata)throw Object.assign(new Error('합산본·추가분 파일은 분배 방식과 선출고 기준을 확인한 뒤 검증된 엑셀 다운로드를 사용하세요.'),{statusCode:409});
      const directory=await loadFieldUploadDirectory(async()=>{
        const result=await query("SELECT CustName, OrderCode, Descr FROM Customer WHERE ISNULL(isDeleted,0)=0");
        return result.recordset.map(row=>({CustName:row.CustName,OrderCode:row.OrderCode,customerAlias:customerExportName(row)}));
      });
      output=await telemetry.measure('fieldWorkbook',()=>renderUploadedFieldWorkbook({filepath:file.filepath,customerDirectory:directory,filename:file.originalFilename,farmText:field('farmText'),week:field('week'),year:field('year')},{signal:controller.signal}));
    } else {
      const buffer=await fs.promises.readFile(file.filepath);
      const plan=verifyFarmExport(buffer,field('exportPlan'),req.user.userId);
      verifiedKind=plan.allocation?.metadata?.kind;
      if(mode==='field-volume') {
        if(plan.kind!=='field-volume-v2')throw Object.assign(new Error('현장물량표를 생성하기 전에 다시 검증하세요.'),{statusCode:409});
        const {orderYear,orderWeek}=requireOrderYear(plan.week,plan.orderYear);
        plan.includePrevious=field('includePrevious')!=='false';
        const scope=fieldVolumeSql(plan.products.map(p=>p.prodKey),plan.includePrevious);
        const params={year:{type:sql.NVarChar,value:orderYear},major:{type:sql.NVarChar,value:orderWeek.split('-')[0]},minor:{type:sql.Int,value:Number(orderWeek.split('-')[1])}};
        const lines=await query(scope.lines,params),farms=await query(scope.farms,params);
        const weeks=plan.includePrevious?Array.from({length:Number(orderWeek.slice(3))},(_,i)=>orderWeek.slice(0,3)+String(i+1).padStart(2,'0')):[orderWeek];
        plan.pallets=addPalletSnapshots(...await Promise.all(weeks.map(w=>readPalletSnapshots(orderYear,w))));
        output=await createFieldVolumeWorkbook(plan,lines.recordset,farms.recordset);
      } else {
        if(mode || plan.kind)throw Object.assign(new Error('잘못된 다운로드 형식입니다.'),{statusCode:400});
        output=await exportAllocationWorkbook(await exportFarmWorkbook(buffer,plan),plan.allocation);
      }
    }
    if(controller.signal.aborted || res.destroyed)return;
    const name=String(file.originalFilename || '물량표.xlsx').replace(/\.xlsx$/i,'')+(mode==='field-upload'?'-신형현장물량표-업로드기준.xlsx':mode==='field-volume'?'-신형현장물량표.xlsx':verifiedKind==='FINAL'?'-합산본-최종합계.xlsx':verifiedKind==='ADDITIONAL'?'-추가분.xlsx':'-농장분배.xlsx');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(output);
  }catch(e){if(!controller.signal.aborted && !res.destroyed)return res.status(e.statusCode || 400).json({success:false,error:e.message,code:e.code||''});}
  finally{req.removeListener('aborted',cancel);res.removeListener('close',disconnected);if(file)try{await fs.promises.unlink(file.filepath);}catch{}}
}
export default withAuth(handler);
