import {withAuth} from '../../../lib/auth';
import {outputScope} from '../../../lib/profitRangeOutput.mjs';
import {loadReportData,loadWeeklyReportPayload} from './profit-report';
import {collectIndependentAudit,readIndependentSources} from '../../../lib/profitIndependentAuditSource';
import {materializeProfitPayload,profitDisplayCalculation} from '../../../lib/profitReportStoredCalculation';
import {auditProfitFormulas} from '../../../lib/profitFormulaAudit.mjs';
import {auditReportSqlLineage} from '../../../lib/profitSqlLineageAudit.mjs';
import {loadProfitReportSourceReconciliation} from '../../../lib/profitReportSourceReconciliation';
import {buildProfitValidationGate} from '../../../lib/profitReportValidationGate.mjs';
import {applyTemplateDutyToReport,clearTemplateDutyCache} from '../../../lib/profitTemplateDutyData';

// Explicit verification only. Never refresh a snapshot or execute a mutation here.
export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({success:false,error:'GET만 허용합니다.'});
  let scope;
  try {scope=outputScope(req.query.year,req.query.week);} catch(error) {return res.status(400).json({success:false,error:error.message});}
  const controller=new AbortController();
  const cancel=()=>{if(!res.writableEnded)controller.abort();};
  res.on('close',cancel);
  const deadline=setTimeout(()=>{
    controller.abort();
    if(!res.writableEnded)res.status(503).json({success:false,state:'held',error:'원천 검증이 50초 내 완료되지 않아 판정을 보류했습니다. 저장본은 유지됩니다. 잠시 후 다시 시도하세요.'});
  },50000);
  try {
    const audit=await collectIndependentAudit(scope,controller.signal);
    controller.signal.throwIfAborted();
    // Explicit verification must not certify the normal-view 60s cache. Both
    // projections below share the newly started context; final hash checks races.
    clearTemplateDutyCache();
    const [raw,saved]=await Promise.all([loadReportData(scope.major,scope.year),loadWeeklyReportPayload(scope.major,scope.year)]);
    controller.signal.throwIfAborted();
    const rawLive=materializeProfitPayload({...raw,orderYear:scope.year,major:scope.major});
    const live=await applyTemplateDutyToReport(rawLive,scope.year,scope.major);
    const sources=await loadProfitReportSourceReconciliation({year:scope.year,major:scope.major,report:rawLive,signal:controller.signal});
    const final=await readIndependentSources(scope,controller.signal);
    const integrity={...audit.integrity,status:audit.integrity?.sourceHash===final.hash?audit.integrity.status:'STALE'};
    const stock=audit.weeks.find(w=>Number(w.major)===Number(scope.major));
    const display={...profitDisplayCalculation(saved),audit:saved.audit,templateDuty:saved.templateDuty};
    const result=buildProfitValidationGate({year:scope.year,major:scope.major,display,live,rawLive,
      formula:auditProfitFormulas(rawLive,rawLive.rows,rawLive.totals),lineage:auditReportSqlLineage(rawLive,stock?.sqlLineage),stock,sources,integrity});
    controller.signal.throwIfAborted();
    return res.status(200).json({success:true,...result,sourceBoundary:sources.boundary});
  } catch(error) {
    if(controller.signal.aborted)return;
    console.error('[profit-report-validation]',error.code||error.name);
    return res.status(500).json({success:false,state:'held',error:'원천 검증 조회 실패 — 수익률을 정상 판정하지 않았습니다. 저장값은 변경하지 않았습니다.'});
  } finally {clearTimeout(deadline);res.removeListener('close',cancel);}
});
