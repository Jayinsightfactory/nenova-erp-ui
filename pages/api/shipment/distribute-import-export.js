import { readPalletSnapshots } from '../../../lib/shipmentImportAudit';
import { palletSnapshot, addPalletSnapshots } from '../../../lib/shipmentPallet';
import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth';
import { verifyFarmExport, exportFarmWorkbook } from '../../../lib/shipmentFarmWorkbook';
import { query, sql } from '../../../lib/db';
import { requireOrderYear } from '../../../lib/orderUtils';
import { fieldVolumeSql, createFieldVolumeWorkbook } from '../../../lib/shipmentFieldVolume';
import XLSX from 'xlsx';
import { parseAllocationWorkbook } from '../../../lib/shipmentImport';
import { createUploadedFieldWorkbook } from '../../../lib/shipmentFieldUpload';

export const config={api:{bodyParser:false,responseLimit:'40mb'}};
async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).end();
  let file,prior;
  try {
    const [fields,files]=await formidable({maxFileSize:30*1024*1024,maxFieldsSize:4*1024*1024,multiples:false}).parse(req);
    file=Array.isArray(files.file)?files.file[0]:files.file;
    prior=Array.isArray(files.previousFile)?files.previousFile[0]:files.previousFile;
    if(!file)throw Object.assign(new Error('원본 엑셀 파일이 필요합니다.'),{statusCode:400});
    const buffer=fs.readFileSync(file.filepath);
    const field=name=>Array.isArray(fields[name])?fields[name][0]:fields[name];
    const mode=field('mode');
    let output;
    if(mode==='field-upload') {
      if(!/\.xlsx$/i.test(file.originalFilename||''))throw new Error('바로 생성은 .xlsx 물량표를 선택하세요.');
      const workbook=XLSX.read(buffer,{type:'buffer'});
      const parsed=parseAllocationWorkbook(XLSX,workbook);
      const directory=await query("SELECT CustName, OrderCode, Descr FROM Customer WHERE ISNULL(isDeleted,0)=0");
      const selectedWeek=field('week'),selectedYear=field('year');
      const scope=selectedWeek && selectedYear ? requireOrderYear(selectedWeek,selectedYear) : null;
      const fileWeek=(file.originalFilename||'').match(/(?:^|[^0-9])(\d{2})[-－](\d{1,2})(?!\d)/);
      const sameWeek=!fileWeek || scope?.orderWeek===fileWeek[1]+'-'+fileWeek[2].padStart(2,'0');
      const saved=scope && sameWeek ? await readPalletSnapshots(scope.orderYear,scope.orderWeek) : {};
      let pallets={...saved,...palletSnapshot(XLSX,workbook,parsed.rows)};
      let previousFile;
      if(prior){const bytes=fs.readFileSync(prior.filepath);previousFile={filename:prior.originalFilename||'',buffer:bytes,rows:parseAllocationWorkbook(XLSX,XLSX.read(bytes,{type:'buffer'})).rows};}
      if(prior&&previousFile){
        const book=XLSX.read(previousFile.buffer,{type:'buffer'});
        const priorSaved=scope&&sameWeek?await readPalletSnapshots(scope.orderYear,scope.orderWeek.slice(0,2)+'-01'):{};
        pallets=addPalletSnapshots({...priorSaved,...palletSnapshot(XLSX,book,previousFile.rows)},pallets);
      }
      output=await createUploadedFieldWorkbook(buffer,parsed.rows,{previousFile,pallets,customerDirectory:directory.recordset,filename:file.originalFilename,farmText:field('farmText'),week:field('week'),year:field('year')});
    } else {
      const plan=verifyFarmExport(buffer,field('exportPlan'),req.user.userId);
      if(mode==='field-volume') {
        if(plan.kind!=='field-volume-v2')throw Object.assign(new Error('현장물량표를 생성하기 전에 다시 검증하세요.'),{statusCode:409});
        const {orderYear,orderWeek}=requireOrderYear(plan.week,plan.orderYear);
        const scope=fieldVolumeSql(plan.products.map(p=>p.prodKey));
        const params={year:{type:sql.NVarChar,value:orderYear},major:{type:sql.NVarChar,value:orderWeek.split('-')[0]},minor:{type:sql.Int,value:Number(orderWeek.split('-')[1])}};
        const lines=await query(scope.lines,params),farms=await query(scope.farms,params);
        const snapshots=await Promise.all(Array.from({length:Number(orderWeek.slice(3))},(_,i)=>readPalletSnapshots(orderYear,orderWeek.slice(0,3)+String(i+1).padStart(2,'0'))));
        plan.pallets=addPalletSnapshots(...snapshots);
        output=await createFieldVolumeWorkbook(plan,lines.recordset,farms.recordset);
      } else {
        if(mode || plan.kind)throw Object.assign(new Error('잘못된 다운로드 형식입니다.'),{statusCode:400});
        output=await exportFarmWorkbook(buffer,plan);
      }
    }
    const name=String(file.originalFilename || '물량표.xlsx').replace(/\.xlsx$/i,'')+(mode==='field-upload'?'-신형현장물량표-업로드기준.xlsx':mode==='field-volume'?'-신형현장물량표.xlsx':'-농장분배.xlsx');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(output);
  }catch(e){return res.status(e.statusCode || 400).json({success:false,error:e.message});}
  finally{for(const temp of [file,prior])if(temp)try{fs.unlinkSync(temp.filepath);}catch{}}
}
export default withAuth(handler);
