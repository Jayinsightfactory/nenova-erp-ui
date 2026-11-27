import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { withAuth } from '../../../../lib/auth';
import { readSheetValuesWithArchive } from '../../../../lib/googleSheets';
import { todaySeoul } from '../../../../lib/importKakaoAdditions';
import { classifyImportFeed, importCustomerAliases, latestImportFeed } from '../../../../lib/importKakaoOrderText';
import { offsetImportDay, readImportArchive } from '../../../../lib/importKakaoArchive';
import { query as queryErpDb } from '../../../../lib/db';
import { loadImportKakaoDbCatalog } from '../../../../lib/importKakaoDbCatalog';
import { readImportTeamRecord } from '../../../../lib/importTeamStore';
import { KAKAO_DB_PRODUCT_ALIASES_KEY, normalizeKakaoProductAliasMap } from '../../../../lib/importKakaoDbProductAliases';

function sanitizeErrorSummary(err) {
  const raw = String(err?.message || err || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.slice(0, 140);
}

function summarizeAliasSheetError(err) {
  const detail = sanitizeErrorSummary(err);
  const status = Number(err?.status || 0);
  if (err?.code === 'GSHEETS_TIMEOUT' || err?.name === 'TimeoutError' || err?.name === 'AbortError' || /시간 초과|timeout|aborted/i.test(detail)) {
    return `거래처 별칭 시트 응답 시간 초과로 원문 거래처 코드를 그대로 표시합니다.${detail ? ` (원인: ${detail})` : ''}`;
  }
  if (status === 429 || /429|RESOURCE_EXHAUSTED|quota|10,?000,?000|cell|limit|한도/i.test(detail)) {
    return `거래처 별칭 시트 용량·요청 한도 오류로 원문 거래처 코드를 그대로 표시합니다.${detail ? ` (원인: ${detail})` : ''}`;
  }
  if (status === 503 || /503|UNAVAILABLE|temporarily unavailable/i.test(detail)) {
    return `거래처 별칭 시트 일시 장애(503)로 원문 거래처 코드를 그대로 표시합니다.${detail ? ` (원인: ${detail})` : ''}`;
  }
  if (/환경변수|service account|invalid_grant|token|401|403|permission/i.test(detail)) {
    return `거래처 별칭 시트 인증·권한 오류로 원문 거래처 코드를 그대로 표시합니다.${detail ? ` (원인: ${detail})` : ''}`;
  }
  return `거래처 별칭 시트 조회 실패로 원문 거래처 코드를 그대로 표시합니다.${detail ? ` (원인: ${detail})` : ''}`;
}

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
    let aliasWarning = null;
    const loadAliases = async () => {
      try {
        const { values: rows } = await readSheetValuesWithArchive({range:"'수입방 주문검토'!A:U"});
        return importCustomerAliases(rows);
      } catch (sheetErr) {
        aliasWarning = summarizeAliasSheetError(sheetErr);
        console.warn('[kakao-additions] 거래처 별칭 시트 조회 실패(Orbit 원문 정상 응답 유지):', sanitizeErrorSummary(sheetErr));
        return new Map();
      }
    };
    const [aliases, messages, dbCatalog, aliasRecord] = await Promise.all([
      loadAliases(),
      readImportArchive(from, through),
      typeof loadImportKakaoDbCatalog === 'function' && typeof queryErpDb === 'function'
        ? loadImportKakaoDbCatalog({ queryFn: queryErpDb })
        : Promise.resolve(null),
      typeof readImportTeamRecord === 'function'
        ? readImportTeamRecord('kakao.db-product-aliases').catch(() => ({ value: {}, revision: 0 }))
        : Promise.resolve(null),
    ]);
    const productAliases = aliasRecord
      ? (typeof normalizeKakaoProductAliasMap === 'function'
          ? normalizeKakaoProductAliasMap(aliasRecord.value)
          : (aliasRecord.value && typeof aliasRecord.value === 'object' ? aliasRecord.value : {}))
      : null;
    const enrichedOptions = dbCatalog
      ? { ...options, dbCatalog, knownFarms: dbCatalog.knownFarms || [], ...(productAliases ? { productAliases } : {}), inheritContext: true }
      : (productAliases ? { ...options, productAliases } : options);
    const responseExtra = {
      ...(aliasWarning ? { aliasWarning } : {}),
      ...(dbCatalog ? { knownFarms: dbCatalog.knownFarms || [] } : {}),
      ...(aliasRecord ? { productAliases: productAliases || {}, productAliasRevision: Number(aliasRecord.revision || 0) } : {}),
    };
    if (day !== undefined) return res.json({ ...classifyImportFeed({from:day,to:day,messages},aliases,enrichedOptions), ...responseExtra });
    const feedOpts = { ...enrichedOptions, maxOrderDays: 31, windowFrom: from };
    const latest = latestImportFeed(messages, through, aliases, feedOpts);
    if (rawDays !== undefined || latest.orderDays.length >= 2 || days >= 31) return res.json({ ...latest, windowDays: days, ...responseExtra });
    const older = await readImportArchive(offsetImportDay(through, -30), offsetImportDay(from, -1));
    return res.json({ ...latestImportFeed([...messages, ...older], through, aliases, { ...enrichedOptions, maxOrderDays: 31, windowFrom: offsetImportDay(through, -30) }), windowDays: 31, ...responseExtra });
  } catch (err) {
    const detail = sanitizeErrorSummary(err);
    console.error('[kakao-additions] 수입방 Orbit 아카이브 조회 실패:', detail);
    return res.status(502).json({
      error: 'nenovakakao 수입방 원문 아카이브를 읽지 못했습니다. 조회 연결을 확인하세요.',
      ...(detail ? { detail } : {}),
    });
  }
});
