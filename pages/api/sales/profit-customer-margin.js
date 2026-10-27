import { withAuth } from '../../../lib/auth';
import { parseMarginScope } from '../../../lib/profitCustomerMargin.mjs';
import { loadProfitCustomerMargin, previousMarginScope } from '../../../lib/profitCustomerMarginData';

export function createProfitCustomerMarginHandler({ load=loadProfitCustomerMargin, previous=previousMarginScope }={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET') {res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'GET only'});}
    try {
      const current=parseMarginScope(req.query?.year,req.query?.week);
      const hasComparison=req.query?.compareYear!==undefined || req.query?.compareWeek!==undefined;
      const explicit=hasComparison?parseMarginScope(req.query.compareYear,req.query.compareWeek):null;
      if(explicit && Number(explicit.year+explicit.major)>=Number(current.year+current.major)) return res.status(400).json({ok:false,error:'비교 차수는 선택 차수보다 이전이어야 합니다.'});
      const compare=await previous(current,explicit);
      if(Number(compare.year+compare.major)>=Number(current.year+current.major)) return res.status(400).json({ok:false,error:'비교 차수는 선택 차수보다 이전이어야 합니다.'});
      return res.status(200).json(await load(current,compare));
    } catch(error) {return res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'업체별 판매마진 조회에 실패했습니다. 저장 또는 원장 변경은 하지 않았습니다.'});}
  };
}
export default withAuth(createProfitCustomerMarginHandler());
