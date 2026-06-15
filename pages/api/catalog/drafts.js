import { withAuth } from '../../../lib/auth';
import {
  deleteCatalogDraft,
  getCatalogDraft,
  listCatalogDrafts,
  saveCatalogDraft,
} from '../../../lib/catalogDraftStore';

export default withAuth(async function handler(req, res) {
  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      if (id) {
        const draft = getCatalogDraft(String(id));
        if (!draft) return res.status(404).json({ success: false, error: '저장본을 찾을 수 없습니다.' });
        return res.status(200).json({ success: true, draft });
      }
      return res.status(200).json({ success: true, drafts: listCatalogDrafts() });
    }

    if (req.method === 'POST') {
      const { id, name, payload } = req.body || {};
      if (!payload?.lines?.length) {
        return res.status(400).json({ success: false, error: '저장할 품목이 없습니다.' });
      }
      const saved = saveCatalogDraft({
        id: id || undefined,
        name,
        payload,
        savedBy: req.user?.userName || req.user?.userId || null,
      });
      return res.status(200).json({ success: true, draft: saved });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ success: false, error: 'id 필요' });
      deleteCatalogDraft(String(id));
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
