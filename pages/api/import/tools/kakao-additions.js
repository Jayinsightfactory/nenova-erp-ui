import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { withAuth } from '../../../../lib/auth';
import { getKakaoSheetId, readSheetValues } from '../../../../lib/googleSheets';
import { readImportDay } from '../../../../lib/importKakaoAdditions';
import { classifyImportFeed, importCustomerAliases, readLatestOrderImports } from '../../../../lib/importKakaoOrderText';

export default withAuth(async (req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
  if(!canManageInvoiceReceipt(req.user)) return res.status(403).json({error:'수입부 또는 관리자만 수입방 원문을 조회할 수 있습니다.'});
  const day=req.query.day;
  if(req.query.audit !== undefined && req.query.audit !== '1') return res.status(400).json({error:'대조 옵션을 확인하세요.'});
  const options={audit:req.query.audit==='1'};
  if(day !== undefined && (typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)) return res.status(400).json({error:'조회 날짜를 확인하세요.'});
  try {
    const rows=await readSheetValues({spreadsheetId:getKakaoSheetId(),range:"'수입방 주문검토'!A:U"});
    if(day === undefined) return res.json(readLatestOrderImports(rows,new Date(),options));
    return res.json(classifyImportFeed({from:day,to:day,messages:readImportDay(rows,day)},importCustomerAliases(rows),options));
  } catch { return res.status(502).json({error:'nenovakakao 수입방 주문검토 시트를 읽지 못했습니다. 연결과 동기화 상태를 확인하세요.'}); }
});
