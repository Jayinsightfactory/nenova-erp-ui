import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { loadMappings } from '../../../lib/parseMappings';
import { mergeCustomerProductMappings } from '../../../lib/orderImportCustomerProductMappings';
import { reapplyImportSavedMappings } from '../../../lib/orderImportRematch';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { items, custKey } = req.body || {};
  if (!Number.isInteger(Number(custKey)) || Number(custKey) <= 0 || !Array.isArray(items)
    || items.length > 5000 || items.some(row => !row || typeof row.inputName !== 'string')) {
    return res.status(400).json({ success: false, error: '업체와 매칭할 원본 품목을 확인하세요.' });
  }
  try {
    const products = await query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName,
      FlowerName, CounName, OutUnit FROM Product WHERE isDeleted = 0 ORDER BY ProdName`);
    const savedMappings = mergeCustomerProductMappings(loadMappings(true), custKey, true);
    const result = reapplyImportSavedMappings(items, {
      allProducts: products.recordset || [], savedMappings, prodUnitMap: {}, unitCatalog: {},
    });
    return res.status(200).json({ success: true, ...result,
      availableCount: Object.values(savedMappings).filter(value => value.manual === true).length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
