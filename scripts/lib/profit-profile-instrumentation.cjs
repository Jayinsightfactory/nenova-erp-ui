// Used only by the diagnostic loader; repository application files stay unchanged.
const targets={
 '/pages/api/sales/profit-report.js':[['loadReportData',true],['loadCoherentLatestReport',false]],
 '/lib/profitTemplateDutyData.js':[['loadTemplateDutyContext',true],['applyTemplateDutyToReport',true]],
 '/lib/profitAverageData.js':[['loadAverageSources',true],['applyAverageFallbackToReport',true]],
 '/lib/profitReportSnapshot.js':[['loadSourceFingerprints',true],['latestSnapshots',true]],
 '/lib/profitLatestInvoiceFence.js':[['latestProfitInvoiceFence',true]],
 '/lib/arrivalInvoiceSource.js':[['loadArrivalInvoiceRows',true]],
 '/lib/pivotFreightArrival.js':[['getArrivalCostsForWeekRange',true]],
 '/lib/sourceWorkbookFx.js':[['loadSourceWorkbookFxRows',true]],
 '/lib/erpReadContext.js':[['withErpReadContext',true]],
};
function instrumentProfileSource(source,url){
 const entry=Object.entries(targets).find(([suffix])=>url.endsWith(suffix));if(!entry)return source;
 let out=source;
 for(const [name,exported]of entry[1]){
  const expression=new RegExp(`${exported?'export\\s+':''}async function ${name}\\s*\\(`);
  if(!expression.test(out))throw Error('PROFILE_SOURCE_MISMATCH:'+name);
  out=out.replace(expression,`async function __profile_${name}(`);
  if(name==='withErpReadContext'){
   out+=`\nexport async function withErpReadContext(options,work){let observed;try{return await __profile_withErpReadContext(options,async()=>{observed=currentErpReadContext();return work();});}finally{globalThis.__profitProfileContextEnd?.(observed?.caches.size??null);}}\n`;
  }else if(['getArrivalCostsForWeekRange','loadSourceWorkbookFxRows'].includes(name)){
   out+=`\n${exported?'export ':''}async function ${name}(...args){globalThis.__profitProfileCall?.('${name}',args);const result=await __profile_${name}(...args);globalThis.__profitProfileResult?.('${name}',result);return result;}\n`;
  }else out+=`\n${exported?'export ':''}async function ${name}(...args){globalThis.__profitProfileStage?.('${name}:start');try{return await __profile_${name}(...args);}finally{globalThis.__profitProfileStage?.('${name}:end');}}\n`;
 }
 return out;
}
module.exports={instrumentProfileSource};
