import { randomUUID } from 'node:crypto';
import { withAuth } from '../../../lib/auth';
import { withTransaction, sql } from '../../../lib/db';
import { acquireErpEditLease, assertErpEditGuard, advanceErpEditGuard, releaseErpEditLease } from '../../../lib/erpEditPresence.js';
import { assertDirectionalGateCapability, lockDirectionalGate } from '../../../lib/estimateDirectionalQuantity.js';
import { distributionDateScope, distributionDateSnapshot, readDistributionDateContext, planDistributionDates, executeDistributionDateSave, dateDistributionError } from '../../../lib/shipmentDistributionDates.js';

export default withAuth(async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).end();
  try{
    const input=req.method==='GET'?req.query:req.body;
    const scope=distributionDateScope(input);
    const result=await withTransaction(async tQ=>{
      if(req.method==='GET'){
        const context=await readDistributionDateContext(tQ,sql,scope);
        let blocked='';
        try{planDistributionDates(context,context.dates.map(r=>({timestamp:r.Timestamp,quantity:r.ShipmentQuantity})));}catch(e){blocked=e.message;}
        return {success:true,context,snapshot:distributionDateSnapshot(context),blocked};
      }
      await assertDirectionalGateCapability(tQ);await lockDirectionalGate(tQ);
      if(input.preview===true){
        const context=await readDistributionDateContext(tQ,sql,scope);
        if(input.snapshot!==distributionDateSnapshot(context))throw dateDistributionError('다른 화면에서 변경되었습니다. 다시 조회하세요.','STALE_DATA');
        return {success:true,plan:planDistributionDates(context,input.allocations)};
      }
      if(input.confirm!==true)throw dateDistributionError('변경 미리보기를 확인한 후 저장하세요.');
      const leaseScope={orderYear:scope.orderYear,orderWeek:scope.orderWeek.slice(0,2),custKey:scope.custKey};
      const clientId=`distribution-dates:${randomUUID()}`;
      const acquired=await acquireErpEditLease(tQ,leaseScope,req.user,{clientId,pageCode:'shipment-distribution-dates',takeover:false,forceTakeover:false});
      const editGuard={clientId,leaseToken:acquired?.lease?.leaseToken};
      await assertErpEditGuard(tQ,leaseScope,req.user,{editGuard});
      const saved=await executeDistributionDateSave(tQ,sql,scope,input,req.user?.userId);
      await advanceErpEditGuard(tQ,leaseScope,req.user,{editGuard});
      await releaseErpEditLease(tQ,leaseScope,req.user,{editGuard});
      return saved;
    },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
    return res.status(200).json(result);
  }catch(e){return res.status(e.statusCode||500).json({success:false,code:e.code||'DATE_SAVE_FAILED',error:e.message});}
});
