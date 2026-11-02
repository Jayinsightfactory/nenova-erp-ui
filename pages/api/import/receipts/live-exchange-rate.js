import {withAuth} from '../../../../lib/auth';
import {fetchLiveInvoiceRate} from '../../../../lib/invoiceLiveExchangeRate';

export default withAuth(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false,error:'GET 요청만 지원합니다.'});}
  const currency=typeof req.query.currency==='string'?req.query.currency:'';
  if(!['USD','EUR','CNY','AUD','NZD','THB'].includes(currency))return res.status(400).json({success:false,error:'원가 통화를 확인하세요.'});
  try{return res.status(200).json({success:true,...await fetchLiveInvoiceRate(currency)});}
  catch(error){return res.status(503).json({success:false,error:error.message});}
});
