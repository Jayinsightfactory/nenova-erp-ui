import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { withAuth } from '../../../../lib/auth';
import { getKakaoSheetId, readSheetValues } from '../../../../lib/googleSheets';
import { todaySeoul } from '../../../../lib/importKakaoAdditions';
import { classifyImportFeed, importCustomerAliases, latestImportFeed } from '../../../../lib/importKakaoOrderText';
import { offsetImportDay, readImportArchive } from '../../../../lib/importKakaoArchive';

export default withAuth(async (req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
  if(!canManageInvoiceReceipt(req.user)) return res.status(403).json({error:'수입부 또는 관리자만 수입방 원문을 조회할 수 있습니다.'});
  const day=req.query.day;
  const rawDays=req.query.days;
  let days=14;
  if(rawDays !== undefined){
    if(typeof rawDays!=='string'||!/^\d{1,2}$/.test(rawDays)) return res.status(400).json({error:'조회 기간(일)을 확인하세요.'});
    days=Number(rawDays);
    if(days<1||days>31) return res.status(400).json({error:'조회 기간은 1~31일 범위여야 합니다.'});
  }
  if(req.query.audit !== undefined && req.query.audit !== '1') return res.status(400).json({error:'대조 옵션을 확인하세요.'});
  const options={audit:req.query.audit==='1'};
  if(day !== undefined && (typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)) return res.status(400).json({error:'조회 날짜를 확인하세요.'});
  try {
    const through = day || todaySeoul();
    const from = day || offsetImportDay(through, -(days - 1));
    const [rows, messages] = await Promise.all([
      readSheetValues({spreadsheetId:getKakaoSheetId(),range:"'수입방 주문검토'!A:U"}),
      readImportArchive(from, through),
    ]);
    const aliases = importCustomerAliases(rows);
    if (day !== undefined) return res.json(classifyImportFeed({from:day,to:day,messages},aliases,options));
    const feedOpts = { ...options, maxOrderDays: 31, windowFrom: from };
    const latest = latestImportFeed(messages, through, aliases, feedOpts);
    if (rawDays !== undefined || latest.orderDays.length >= 2 || days >= 31) return res.json({ ...latest, windowDays: days });
    const older = await readImportArchive(offsetImportDay(through, -30), offsetImportDay(from, -1));
    return res.json({ ...latestImportFeed([...messages, ...older], through, aliases, { ...options, maxOrderDays: 31, windowFrom: offsetImportDay(through, -30) }), windowDays: 31 });
  } catch { return res.status(502).json({error:'nenovakakao 수입방 원문 또는 거래처 대조 자료를 읽지 못했습니다. 조회 연결을 확인하세요.'}); }
});
