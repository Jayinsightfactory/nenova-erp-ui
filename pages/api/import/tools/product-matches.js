import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { readImportTeamRecord, writeImportTeamRecord } from '../../../../lib/importTeamStore';
import { PACKING_ERP_MATCH_KEY, PACKING_PRODUCT_SCOPE_SQL, packingErpProducts, upsertPackingErpMatch } from '../../../../lib/importPackingErpMatches';

export const config = {api:{bodyParser:{sizeLimit:'16kb'},responseLimit:'8mb'}};
export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.user?.accountActive === false) return res.status(403).json({success:false,error:'비활성 계정은 매칭 자료에 접근할 수 없습니다.'});
  if (!['GET','POST'].includes(req.method)) {
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});
  }
  try {
    const [result, record] = await Promise.all([query(PACKING_PRODUCT_SCOPE_SQL),readImportTeamRecord(PACKING_ERP_MATCH_KEY)]);
    const products = packingErpProducts(result.recordset);
    if (req.method === 'GET') return res.json({success:true,products,value:record.value,revision:record.revision});
    if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) return res.status(400).json({success:false,error:'자료 버전을 다시 조회하세요.'});
    const value = upsertPackingErpMatch(record.value,req.body,products);
    const saved = await writeImportTeamRecord(PACKING_ERP_MATCH_KEY,{value,expectedRevision:req.body.expectedRevision,actor:req.user});
    return res.json({success:true,products,value:saved.value,revision:saved.revision});
  } catch (error) {
    return res.status(error.statusCode || 500).json({success:false,error:error.statusCode ? error.message : '전산 품목·매칭 자료를 읽거나 저장하지 못했습니다. 초안을 유지하고 다시 시도하세요.'});
  }
});
