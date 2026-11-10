import crypto from 'node:crypto';
import jobs from '../../../lib/customsSettlementJobs.cjs';
import {registerSettlementJob} from '../../../lib/customsSettlementRegistration';
async function registerReady(job){
  if(job?.status!=='REVIEW_READY')return;
  try{const result=await registerSettlementJob(job,{automatic:true,actor:`worker:${job.jobId}`});await jobs.recordRegistration(job.jobId,{state:result.errors.length?'RETRY':'DONE',registeredDocuments:result.registeredDocuments,results:result.results.map(({year,major,documentCount})=>({year,major,documentCount})),errors:result.errors});}
  catch{await jobs.recordRegistration(job.jobId,{state:'RETRY',error:'원천 자동등록 보류 — 재연결 후 재검증합니다.'});}
}
export const config = { api: { bodyParser: { sizeLimit: '2mb' }, responseLimit: '18mb' } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const expected = Buffer.from(process.env.ORBIT_DRIVE_INGEST_TOKEN || ''), actual = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!expected.length || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return res.status(403).json({ success: false, error: '정산 워커 인증을 확인하세요.' });
  try {
    if (req.method === 'GET') {await jobs.touchWorker();await registerReady(await jobs.pendingRegistration());return res.json({ success: true, job: await jobs.claimSettlementJob() });}
    if (req.method === 'POST') {await jobs.touchWorker();await registerReady(await jobs.finishSettlementJob(req.body || {}));return res.json({ success: true }); }
    return res.status(405).json({ success: false, error: 'GET 또는 POST만 지원합니다.' });
  } catch (error) { return res.status(error.statusCode || 503).json({ success: false, error: error.statusCode ? error.message : '정산 OCR 작업 처리에 실패했습니다.' }); }
}
