// pages/api/sales/revenue-preview.js
// POST { meta, rows } — 저장 없이 매핑 적용 미리보기만 반환

import { withAuth } from '../../../lib/auth';
import { loadSalesRevenueMappings } from '../../../lib/salesRevenueMappings';
import { makeBatchObject, viewBatchRaw } from '../../../lib/salesRevenueBatches';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  const { meta, rows } = req.body || {};
  if (!meta || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, error: 'meta, rows 필요' });
  }

  const mappings = loadSalesRevenueMappings(true);
  const previewObj = makeBatchObject(meta, rows);
  const batch = viewBatchRaw(previewObj, mappings);

  return res.status(200).json({ success: true, batch });
}

export default withAuth(handler);
