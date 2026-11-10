import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { SHIPMENT_EXPORT_SQL, buildShipmentExportWorkbook } from '../../../lib/shipmentExportExcel';
import XLSX from 'xlsx';

export default withAuth(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 try{
  const {orderYear,orderWeek}=requireOrderYear(req.query.week,req.query.year);
  const raw=req.query.custKey,custKey=raw===undefined?null:Number(raw);
  if(custKey!==null&&(!/^\d+$/.test(String(raw))||!Number.isSafeInteger(custKey)||custKey<=0))return res.status(400).json({success:false,error:'업체 선택을 확인하세요.'});
  const result=await query(SHIPMENT_EXPORT_SQL,{
   year:{type:sql.NVarChar,value:orderYear},week:{type:sql.NVarChar,value:orderWeek},
   major:{type:sql.NVarChar,value:orderYear+orderWeek.split('-')[0]},custKey:{type:sql.Int,value:custKey},
  });
  const wb=buildShipmentExportWorkbook(result.recordset,{orderYear,orderWeek,custKey});
  if(!wb.SheetNames.length)return res.status(404).json({success:false,error:'출고 데이터가 없습니다.'});
  const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const fileName=['출고',orderYear+'-'+orderWeek,custKey??'전체'].join('_')+'.xlsx';
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename='+encodeURIComponent(fileName));
  res.setHeader('Content-Length',buffer.length);res.setHeader('Cache-Control','private, no-store');
  return res.status(200).send(Buffer.from(buffer));
 }catch(error){
  return res.status(error.statusCode??(error.code==='INVALID_ORDER_WEEK'?400:500)).json({success:false,code:error.code,error:error.message});
 }
});
