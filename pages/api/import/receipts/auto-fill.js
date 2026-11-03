import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { resolveInvoiceHeader } from '../../../../lib/invoiceReceiptAutoFill';
import { listInvoiceFarmSources } from '../../../../lib/invoiceFarmSource.js';

export function createInvoiceHeaderHandler({queryFn=query}={}) {
  return async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,error:'입고 작업 권한이 없습니다.'});
    if(req.method==='GET'){
      try {
        const q=String(req.query?.q||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        const farms=await listInvoiceFarmSources(queryFn);
        return res.status(200).json({success:true,farms:farms.filter(f=>f.FarmName.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'').includes(q)).slice(0,50)});
      }catch{return res.status(503).json({success:false,error:'농장 검색에 실패했습니다. 입력을 유지하고 다시 검색해 주세요.'});}
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'GET, POST만 허용됩니다.'});}
    const document=req.body;
    if(!document || !/^\d{4}$/.test(String(document.orderYear||'')))return res.status(400).json({success:false,error:'인보이스 연도를 확인하세요.'});
    try {
      const farms=await listInvoiceFarmSources(queryFn);
      if(!Array.isArray(farms))throw Error('lookup failed');
      return res.status(200).json({success:true,resolution:resolveInvoiceHeader(document,farms)});
    }catch{return res.status(503).json({success:false,error:'농장 자동 연결을 조회하지 못했습니다. 입력값을 유지했습니다. 다시 시도하세요.'});}
  };
}
export default withAuth(createInvoiceHeaderHandler());
