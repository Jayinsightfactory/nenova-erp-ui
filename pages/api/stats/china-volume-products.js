import { query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// 자동 중국물량표의 패킹 품목 후보. 선택 차수의 주문/입고에 없는 활성 중국 품목도
// 수동 매칭할 수 있도록 Product 마스터만 읽으며 ERP 원장은 변경하지 않는다.
export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const result = await query(
      `SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
         FROM Product p
        WHERE p.isDeleted = 0 AND p.CounName = N'중국'
        ORDER BY p.FlowerName, p.ProdName, p.ProdKey`
    );
    return res.status(200).json({
      success: true,
      products: result.recordset.map(row => ({
        prodKey: Number(row.ProdKey),
        prodName: row.ProdName || '',
        displayName: row.DisplayName || '',
        flower: row.FlowerName || '',
        country: row.CounName || '',
        unit: row.OutUnit || '',
        outOrders: {},
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || '중국 품목 조회 실패' });
  }
});
