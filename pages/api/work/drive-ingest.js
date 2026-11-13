// pages/api/work/drive-ingest.js
// 직원 PC 데몬(Orbit work-file-uploader)이 업무 파일을 자동 업로드하는 수신 API. 토큰 인증(로그인 아님).
// 토큰: ORBIT_DRIVE_INGEST_TOKEN (서버 env 전용, 독립 회전). 데몬은 Orbit 서버에서 이 토큰을 받아 쓴다.
// multipart: file + fields(orbitUserId, userName, hostname, dir, mtime, eventType). 저장·분류는 lib/workDrive(파일 전용, MSSQL 무관).
import fs from 'fs';
import crypto from 'crypto';
import formidable from 'formidable';
import { FILE_MAX } from '../../../lib/workDrive';
import { startDriveIngestService } from '../../../lib/workDriveIngestAsync.cjs';
import { measure } from '../../../lib/serverWorkTelemetry.cjs';
import { importRemitFile } from '../../../lib/farmRemitInbox';
import { REMIT_FILE_RE } from '../../../lib/farmRemitImport';

export const config = { api: { bodyParser: false } };

function tokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN || '';
  if (!want) return { ok: false, status: 503, error: 'ORBIT_DRIVE_INGEST_TOKEN 서버 미설정' };
  const auth = String(req.headers.authorization || '');
  const got = auth.replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-orbit-ingest-token'] || '').trim();
  if (!got) return { ok: false, status: 401, error: '토큰 없음' };
  const a = Buffer.from(got), b = Buffer.from(want);
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);
  return same ? { ok: true } : { ok: false, status: 401, error: '토큰 불일치' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const t = tokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  const service=startDriveIngestService(),release=await measure('admission',()=>service.acquire(req));
  if(!release){res.setHeader('Retry-After','5');return res.status(503).json({success:false,error:'업무 파일 저장 중입니다. 잠시 후 다시 시도해 주세요.'});}
  const temporary=new Set();
  try{
    const form = formidable({ maxFileSize: FILE_MAX, maxTotalFileSize: FILE_MAX, maxFiles: 1, maxFields: 16, maxFieldsSize: 16*1024, keepExtensions: true, multiples: false });
    form.on('fileBegin',(_name,file)=>{if(file.filepath)temporary.add(file.filepath);});
    let fields,files;
    try{[fields,files]=await measure('multipart',()=>form.parse(req));}catch{return res.status(413).json({success:false,error:'업로드 파싱 실패'});}
    const f=Array.isArray(files.file)?files.file[0]:files.file;
    if(!f)return res.status(400).json({success:false,error:'file 필드 없음'});
    temporary.add(f.filepath);
    const pick=k=>Array.isArray(fields[k])?fields[k][0]:fields[k];
    const filename=pick('filename')||f.originalFilename||'';
    const stored=await measure('store',()=>service.ingest({filepath:f.filepath,filename,orbitUserId:pick('orbitUserId'),userName:pick('userName'),hostname:pick('hostname'),dir:pick('dir'),mtime:pick('mtime'),eventType:pick('eventType'),egressSnapshot:String(pick('egressSnapshot')||'')==='1'}));
    const r=stored.result;
    if(!r.ok){if(r.status===503)res.setHeader('Retry-After','5');return res.status(r.status||400).json({success:false,error:r.error});}
    // Preserve the awaited SQL import and legacy remit response. Workbook parsing occurs
    // in the storage worker; all existing SQL and duplicate decisions remain unchanged.
    let remit=null;
    if(!r.duplicate&&REMIT_FILE_RE.test(filename)&&/\.xlsx?$/i.test(filename)){
      if(stored.remitError)remit={error:stored.remitError};
      else try{remit=await measure('remit',()=>importRemitFile({parsedRows:stored.parsedRows,fileId:r.id,fileName:filename,by:'drive:'+(r.classification?.uploaderName||'')}));}
      catch(e){console.error('[drive-ingest] remit import failed');remit={error:e.message};}
    }
    return res.status(200).json({success:true,id:r.id,duplicate:r.duplicate,version:r.version,classification:r.classification,remit});
  }catch(e){
    res.setHeader('Retry-After','5');return res.status(e.status||503).json({success:false,error:'업무 파일 저장 실패. 잠시 후 다시 시도해 주세요.'});
  }finally{
    await Promise.all([...temporary].map(file=>fs.promises.unlink(file).catch(()=>{})));
    release();
  }
}
