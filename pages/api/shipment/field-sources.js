import fs from 'node:fs/promises';
import formidable from 'formidable';
import {withAuth} from '../../../lib/auth';
import {query,sql} from '../../../lib/db';
import {fieldVolumeSql,createFieldVolumeWorkbook} from '../../../lib/shipmentFieldVolume';
import {requireOrderYear} from '../../../lib/orderUtils';
import {catalog,downloadSelection,listSources,saveSource} from '../../../lib/shipmentFieldSources';

export const config={api:{bodyParser:false,responseLimit:false}};
async function handler(req,res){
  let files={};
  try{
    const {orderYear,orderWeek}=requireOrderYear(req.query.week,req.query.year);
    res.setHeader('Cache-Control','no-store');
    if(req.method==='GET')return res.json({items:catalog(await listSources(orderYear,orderWeek))});
    if(req.method!=='POST')return res.status(405).end();
    const parsed=await formidable({maxFileSize:30*1024*1024,maxFiles:1,maxFieldsSize:1024*1024}).parse(req);
    const fields=parsed[0];files=parsed[1];
    const first=v=>Array.isArray(v)?v[0]:v;
    const file=first(files.file);
    if(file){
      if(!/\.xlsx$/i.test(file.originalFilename||''))throw Error('xlsx 물량표를 선택하세요.');
      await saveSource(orderYear,orderWeek,file.originalFilename,await fs.readFile(file.filepath));
      return res.json({items:catalog(await listSources(orderYear,orderWeek))});
    }
    const mode=first(fields.includePrevious);
    if(mode!=null&&!['true','false'].includes(mode))throw Error('1차 합산 여부를 확인하세요.');
    const includePrevious=!orderWeek.endsWith('-02')||mode!=='false';
    const selection=JSON.parse(first(fields.selection)||'[]');
    const customers=await query('SELECT CustName, OrderCode, Descr FROM Customer WHERE ISNULL(isDeleted,0)=0');
    async function renderSaved(plan){
      const scope=fieldVolumeSql(plan.products.map(p=>p.prodKey),plan.includePrevious);
      const params={year:{type:sql.NVarChar,value:orderYear},major:{type:sql.NVarChar,value:orderWeek.slice(0,2)},minor:{type:sql.Int,value:Number(orderWeek.slice(3))}};
      const [lines,farms]=await Promise.all([query(scope.lines,params),query(scope.farms,params)]);
      return createFieldVolumeWorkbook(plan,lines.recordset,farms.recordset);
    }
    const {output,name}=await downloadSelection(orderYear,orderWeek,selection,customers.recordset,{filename:first(fields.filename),text:first(fields.farmText)},renderSaved,includePrevious);
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));
    res.setHeader('Content-Type',name.endsWith('.zip')?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(output);
  }catch(e){return res.status(e.statusCode||400).json({error:e.message});}
  finally{await Promise.all(Object.values(files).flat().map(f=>fs.rm(f.filepath,{force:true})));}
}
export default withAuth(handler);
