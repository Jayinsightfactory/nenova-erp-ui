import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth.js';
import { withTransaction, sql } from '../../../lib/db.js';
import { jugwangUploadScope, parseJugwangWeekdaySheet } from '../../../lib/jugwangWeekdayUpload.js';
import { readJugwangOrders, signJugwang } from '../../../lib/jugwangWeekdayUploadServer.js';
export const config={api:{bodyParser:false}};
const first=v=>Array.isArray(v)?v[0]:v;
export default withAuth(async function handler(req,res) {
  if(req.method!=='POST') return res.status(405).end();
  let file;
  try {
    const [fields,files]=await new Promise((resolve,reject)=>formidable({maxFileSize:30*1024*1024,multiples:false}).parse(req,(e,f,x)=>e?reject(e):resolve([f,x])));
    file=first(files.file);if(!file) throw new Error('원본 엑셀을 선택하세요.');
    const scope=jugwangUploadScope(first(fields.year),first(fields.week));
    const fileYear=String(file.originalFilename).match(/20\d{2}/)?.[0];
    if(fileYear&&fileYear!==scope.year) throw new Error('파일명 연도와 선택 연도가 다릅니다.');
    const bytes=await fs.readFile(file.filepath),book=XLSX.read(bytes,{type:'buffer',cellFormula:true});
    const sheets=book.SheetNames.filter((n,i)=>!book.Workbook?.Sheets?.[i]?.Hidden && n!=='_keymap');
    const sheet=first(fields.sheetName),category=first(fields.category);
    if(!sheet) return res.json({success:true,sheets});
    if(!['카네이션','장미','수국','알스트로'].includes(category)) throw new Error('적용 품종을 선택하세요.');
    scope.category=category;
    const source={...parseJugwangWeekdaySheet(XLSX,book,sheet,scope),sourceHash:createHash('sha256').update(bytes).digest('hex')};
    const orders=await withTransaction(q=>readJugwangOrders(q,sql,scope));
    return res.json({success:true,...source,orders,sourceToken:signJugwang(source,req.user.userId,'source')});
  } catch(e) {return res.status(e.statusCode||400).json({success:false,error:e.message});}
  finally {if(file?.filepath) await fs.unlink(file.filepath).catch(()=>{});}
});
