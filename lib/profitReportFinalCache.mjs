import {isMaterializedProfitPayload,materializeProfitPayload} from './profitReportStoredCalculation.js';

const fail=message=>{throw Object.assign(new Error(message),{code:'PROFIT_FINAL_CACHE_INVALID'});};
// A final cache is displayed verbatim. Its raw calculation remains the only donor
// for future duty/average calculations: never feed a completed overlay into itself.
export function profitCacheSourcePayload(payload){
  if(payload?.cacheFinalizationVersion==null)return payload;
  const source=payload.cacheSourcePayload;
  if(payload.cacheFinalizationVersion!==1||!source||source.cacheFinalizationVersion!=null
    ||String(source.orderYear)!==String(payload.orderYear)||Number(source.major)!==Number(payload.major)
    ||!isMaterializedProfitPayload(source))fail('저장 계산본의 원천 계산 근거가 일치하지 않습니다.');
  return source;
}
export async function finalizeProfitCachePayload(raw,{orderYear,major,finalize}){
  if(raw?.cacheFinalizationVersion!=null)fail('완성된 계산본을 원천으로 다시 저장할 수 없습니다.');
  if((raw?.orderYear!=null&&String(raw.orderYear)!==String(orderYear))
    ||(raw?.major!=null&&Number(raw.major)!==Number(major)))fail('계산 원천 연도·차수가 다릅니다.');
  const source=materializeProfitPayload({...raw,orderYear:String(orderYear),major:String(major).padStart(2,'0')});
  const result=await finalize(structuredClone(source));
  if(!isMaterializedProfitPayload(result)||String(result.orderYear)!==String(orderYear)||Number(result.major)!==Number(major)
    ||result.averageFallback?.available===false)fail('최종 통관비·재고 평가 계산을 완료하지 못했습니다. 저장하지 않았습니다.');
  return {...result,cacheFinalizationVersion:1,cacheSourcePayload:source,readMode:'stored',
    financialReadPolicy:{basis:'stored',frozen:true,label:'최종 통관비·재고 평가 반영 저장 계산본'}};
}
