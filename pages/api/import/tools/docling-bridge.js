// pages/api/import/tools/docling-bridge.js
// owner PC docling 워커 전용 브리지(기술레이더 1호 채택).
// 서버(Cafe24)에는 python이 없으므로 워커가 여기로 폴링해 PDF를 받아 docling으로 표를 뽑아 되돌린다.
// 인증: 로그인 아님 — ORBIT_DRIVE_INGEST_TOKEN(기존 feature-data-ingest와 같은 서버 전용 토큰) 재사용.
// GET  ?action=claim → 대기 작업 1건(sha, country, pdfBase64) 또는 {job:null}
// GET  ?action=stats → 큐/결과 개수(모니터링)
// POST {sha, ok, markdown, tables, sec, error?, worker?} → 결과 저장
// DB 무관(파일 저장만). PDF는 owner PC(사내)로만 전달되며 외부 서비스로 나가지 않는다.
import crypto from 'node:crypto';
import {claimDoclingJob,saveDoclingResult,doclingQueueStats} from '../../../../lib/importDoclingBridge';

export const config={api:{bodyParser:{sizeLimit:'10mb'},responseLimit:'30mb'}};

function tokenOk(req){
  const want=process.env.ORBIT_DRIVE_INGEST_TOKEN||'';
  if(!want)return {ok:false,status:503,error:'ORBIT_DRIVE_INGEST_TOKEN 서버 미설정'};
  const got=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()||String(req.headers['x-orbit-ingest-token']||'').trim();
  if(!got)return {ok:false,status:401,error:'토큰 없음'};
  const a=Buffer.from(got),b=Buffer.from(want);
  return a.length===b.length&&crypto.timingSafeEqual(a,b)?{ok:true}:{ok:false,status:401,error:'토큰 불일치'};
}

export default async function handler(req,res){
  const t=tokenOk(req);
  if(!t.ok)return res.status(t.status).json({success:false,error:t.error});
  res.setHeader('Cache-Control','private, no-store');
  try{
    if(req.method==='GET'){
      if(req.query?.action==='stats')return res.status(200).json({success:true,...await doclingQueueStats()});
      const job=await claimDoclingJob();
      return res.status(200).json({success:true,job:job||null});
    }
    if(req.method==='POST'){
      await saveDoclingResult(req.body||{});
      return res.status(200).json({success:true});
    }
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({success:false,error:'GET 또는 POST 요청만 지원합니다.'});
  }catch(e){
    return res.status(e.statusCode||500).json({success:false,error:e.message||'docling 브리지 처리 실패'});
  }
}
