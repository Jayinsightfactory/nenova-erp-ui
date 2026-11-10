import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth';
import { verifyFarmExport, exportFarmWorkbook } from '../../../lib/shipmentFarmWorkbook';

export const config={api:{bodyParser:false,responseLimit:'40mb'}};
async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).end();
  let file;
  try {
    const [fields,files]=await formidable({maxFileSize:30*1024*1024,maxFieldsSize:4*1024*1024,multiples:false}).parse(req);
    file=Array.isArray(files.file)?files.file[0]:files.file;
    if(!file)throw Object.assign(new Error('원본 엑셀 파일이 필요합니다.'),{statusCode:400});
    const buffer=fs.readFileSync(file.filepath);
    const plan=verifyFarmExport(buffer,Array.isArray(fields.exportPlan)?fields.exportPlan[0]:fields.exportPlan,req.user.userId);
    const output=await exportFarmWorkbook(buffer,plan);
    const name=String(file.originalFilename || '물량표.xlsx').replace(/\.xlsx$/i,'')+'-농장분배.xlsx';
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(output);
  }catch(e){return res.status(e.statusCode || 400).json({success:false,error:e.message});}
  finally{if(file)try{fs.unlinkSync(file.filepath);}catch{}}
}
export default withAuth(handler);
