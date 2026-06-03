import { withAuth } from '../../../lib/auth';
import {
  loadSalesRevenueMappings,
  saveSalesRevenueMapping,
} from '../../../lib/salesRevenueMappings';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      mappings: loadSalesRevenueMappings(true),
    });
  }

  if (req.method === 'POST') {
    const {
      ecountName,
      canonicalName,
      custKey,
      custName,
      custArea,
      note,
    } = req.body || {};

    if (!ecountName || !canonicalName) {
      return res.status(400).json({ success: false, error: 'ecountName, canonicalName 필요' });
    }

    const result = saveSalesRevenueMapping(ecountName, {
      canonicalName,
      custKey,
      custName,
      custArea,
      note,
    });

    if (!result.saved) {
      return res.status(500).json({ success: false, error: result.reason || '매칭 저장 실패' });
    }

    return res.status(200).json({
      success: true,
      key: result.key,
      mapping: result.mapping,
    });
  }

  return res.status(405).end();
});
