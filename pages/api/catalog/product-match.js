// POST — 카탈로그 품목명·대표 이미지를 매칭 데이터로 영구 저장

import { withAuth } from '../../../lib/auth';
import { persistCatalogMatch } from '../../../lib/catalogMatchPersist.js';

export default withAuth(function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    prodKey,
    prodName,
    engName,
    korName,
    flowerName,
    counName,
    imageId,
    force,
  } = req.body || {};

  if (!prodKey) {
    return res.status(400).json({ success: false, error: 'prodKey 필요' });
  }

  const result = persistCatalogMatch({
    prodKey,
    prodName,
    engName,
    korName,
    flowerName,
    counName,
    imageId: imageId || null,
    force: force !== false,
  });

  if (!result.saved && result.reason === 'empty-payload') {
    return res.status(400).json({ success: false, error: '저장할 이름 또는 이미지가 없습니다.' });
  }

  if (result.mapping?.reason === 'fallback-suspect') {
    return res.status(409).json({
      success: false,
      error: result.mapping.warning,
      reason: 'fallback-suspect',
      hint: 'force=true 로 재요청하면 강제 저장됩니다.',
    });
  }

  return res.status(200).json({
    success: true,
    key: result.key,
    imagePrimary: result.imagePrimary,
  });
});
