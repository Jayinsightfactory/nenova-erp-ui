import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { loadDriveMatchHistory } from '../../../../lib/driveMatchHistory';

// 업무드라이브 원가자료로 이미 저장된 품명→품목 이력 조회(읽기 전용).
export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 가능합니다.' }); }
  if (!canManageInvoiceReceipt(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
  try { return res.status(200).json({ success: true, ...await loadDriveMatchHistory({ queryFn: query, types: sql, country: req.query.country }) }); }
  catch (error) { return res.status(error.statusCode === 400 ? 400 : 503).json({ success: false, error: error.statusCode === 400 ? error.message : '과거 매칭 이력을 조회하지 못했습니다. 후보는 이름 비교만으로 표시합니다.' }); }
});
