import { canManageInvoiceReceipt } from './invoiceReceiptAccess.js';
export function receiptApiHandler(method, operation) {
  return async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!==method){res.setHeader('Allow',method);return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});}
    if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,code:'WAREHOUSE_WRITE_FORBIDDEN',error:'입고 작업은 관리자 또는 수입부 계정만 가능합니다.'});
    try{return res.status(200).json({success:true,...await operation(req)});}
    catch(error){
      const known=Number.isInteger(error.statusCode)&&error.statusCode>=400&&error.statusCode<500;
      const busy=[error,error.originalError?.info,...(error.precedingErrors||[])].some(e=>[1205,1222].includes(Number(e?.number)));
      return res.status(known?error.statusCode:busy?409:503).json({success:false,
        code:known?error.code:busy?'STOCK_GATE_BUSY':'INVOICE_OPERATION_UNAVAILABLE',
        error:known?error.message:busy?'다른 전산 작업이 진행 중입니다. 초안을 유지하고 다시 확인하세요.':'처리 결과를 확인하지 못했습니다. 초안을 유지했습니다. 등록 요청이었다면 작업 상태를 조회하세요.',
        resultUnknown:!known&&!busy});
    }
  };
}
