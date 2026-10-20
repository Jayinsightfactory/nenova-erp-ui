import fs from 'fs/promises';
import crypto from 'crypto';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { parseShillaPnlWorkbookGroups } from '../../../lib/shillaPnlParse';
import { shillaSettlementItem } from '../../../lib/shillaPnlImportPolicy';
import { loadShillaAnalysisRows, loadShillaDistributionRows } from '../../../lib/shillaReconciliationServer';
import { analyzeShillaPeriods } from '../../../lib/shillaPeriodAnalysis';
import { reconcileShilla, validateScope, itemIdentity } from '../../../lib/shillaReconciliation';
import { buildAnalysisCatalog } from '../../../lib/shillaAnalysisMatching';
export const config = { api:{bodyParser:false,responseLimit:'12mb'} };
const first = value=>Array.isArray(value)?value[0]:value;
export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({success:false,error:'POST만 지원합니다.'});
  // Multipart is not itself CSRF protection.
  const allowedOrigins=['https://nenovaweb.com'];
  if(process.env.NODE_ENV!=='production' && /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) allowedOrigins.push(`http://${req.headers.host}`);
  if(req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return res.status(403).json({success:false,error:'허용되지 않은 요청 출처입니다.'});
  const temporary = [];
  const form = formidable({maxFileSize:30*1024*1024,maxTotalFileSize:30*1024*1024,maxFiles:1,maxFieldsSize:12*1024*1024,allowEmptyFiles:false});
  form.on('fileBegin',(_name,file)=>temporary.push(file.filepath));
  try {
    const [fields,files]=await form.parse(req);
    const file=first(files.file),year=String(first(fields.year)||'');
    if(!file || !/^20\d{2}$/.test(year)) return res.status(400).json({success:false,error:'원본 엑셀과 결산 연도가 필요합니다.'});
    const bytes=await fs.readFile(file.filepath);
    const parsed=parseShillaPnlWorkbookGroups(XLSX,XLSX.read(bytes,{type:'buffer'}),{orderYear:year});
    const batches=parsed.batches || parsed.groups || [];
    if(!batches.length) return res.status(400).json({success:false,error:'신라 손익 원본의 차수별 품목을 찾지 못했습니다.'});
    const excel=batches.flatMap(b=>b.items.map(raw=>{const i=shillaSettlementItem(raw);return {...i,year,period:String(b.major),amount:i.supply,source:`${raw.source?.sheetName || ''} ${raw.source?.row || ''}행`};}));
    const db=await loadShillaAnalysisRows(year);
    const metadata={fileName:file.originalFilename,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),readAt:new Date().toISOString(),periods:batches.map(b=>({period:String(b.major),date:b.quoteDate?`${b.quoteDate.getFullYear()}-${String(b.quoteDate.getMonth()+1).padStart(2,'0')}-${String(b.quoteDate.getDate()).padStart(2,'0')}`:null,count:b.items.length,warnings:b.warnings || []})),warnings:parsed.warnings || []};
    if(first(fields.mode)==='prepare') return res.json({success:true,...metadata,dbCount:db.length,targets:buildAnalysisCatalog(db,excel).targets});
    if(first(fields.mode)!=='compare') throw new Error('지원하지 않는 분석 요청입니다.');
    const payload=JSON.parse(first(fields.payload)||'{}');
    const scope={year,from:payload.from,to:payload.to,periods:payload.periods};
    validateScope(scope);
    const available=new Set(metadata.periods.map(p=>p.period));
    if(scope.periods.some(p=>!available.has(p))) throw new Error('선택한 차수가 원본 파일에 없습니다.');
    if(payload.source?.from!==scope.from || payload.source?.to!==scope.to || payload.source?.complete!==true || payload.source?.origin!=='https://www.shillasrm.com') throw new Error('완료된 신라 입고 조회자료가 필요합니다.');
    const result=reconcileShilla({scope,db,excel,receipts:payload.receipts,mappings:payload.mappings,excelGross:payload.excelGross});
    const distribution=await loadShillaDistributionRows(year);
    const periodAnalysis=analyzeShillaPeriods({scope,rows:result.rows,distribution,periods:metadata.periods,receipts:payload.receipts});
    const sourceWarnings=metadata.periods.filter(p=>scope.periods.includes(p.period)).flatMap(p=>p.warnings);
    return res.json({success:true,...metadata,...result,periodAnalysis,sourceWarnings,complete:result.complete&&!sourceWarnings.length,receiptReadAt:payload.source.readAt});
  } catch(error) {
    return res.status(error.httpCode===413?413:400).json({success:false,error:error.code?.startsWith('E')?'분석 자료를 읽지 못했습니다. 파일과 DB 연결을 확인하세요.':error.message});
  } finally { await Promise.all(temporary.map(path=>fs.unlink(path).catch(()=>{}))); }
});
