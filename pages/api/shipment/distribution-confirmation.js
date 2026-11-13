import {withAuth} from '../../../lib/auth';
import {query,sql} from '../../../lib/db';
import {requireOrderYear} from '../../../lib/orderUtils';
import {DISTRIBUTION_CONFIRMATION_SUMMARY_SQL,confirmationRows,loadDistributionConfirmationScope} from '../../../lib/distributionConfirmationSummary';
export default withAuth(async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'확정현황 조회만 가능합니다.'});
 let scope;try{scope=requireOrderYear(req.query.week,req.query.year);}catch(e){return res.status(400).json({error:e.message});}
 try{const result=await query(DISTRIBUTION_CONFIRMATION_SUMMARY_SQL,{year:{type:sql.NVarChar,value:scope.orderYear},week:{type:sql.NVarChar,value:scope.orderWeek}});
 const categories=req.query.prodGroup!==undefined?await loadDistributionConfirmationScope(query,sql,scope,{prodGroup:req.query.prodGroup,prodKey:req.query.prodKey||null}):undefined;
 return res.json({ok:true,week:`${scope.orderYear}-${scope.orderWeek}`,rows:confirmationRows(result.recordset),categories});}
 catch{return res.status(503).json({error:'확정현황을 조회하지 못했습니다.'});}
});
